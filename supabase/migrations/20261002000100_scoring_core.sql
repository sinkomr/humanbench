-- M2.2 (ROADMAP M2.2; DESIGN §7.1, §7.2, §11.2, R-11.1, R-12.1; ROADMAP A2, A8, A9, A17): the scoring
-- core, a PL/pgSQL port of web/src/engine (irt.ts, linalg.ts, scorer.ts). Pure functions in schema hb:
-- nothing here reads a table except hb.sigma_init() (one settings row), and nobody but hb_definer can
-- run any of it. The RPCs of the next migrations use it; the tests hold it to the app's engine.
--
--   observations   a jsonb array in the golden-vector wire schema (types.ts "Observation"):
--                  {kind: 2pl | 3pl | grm | gaussian | testlet, axis, ...}; hb.parse_obs validates it
--                  with the rules of scorer.ts checkObservation
--   hb.obs_terms   log-likelihood, score, expected and observed information of ONE observation at a θ
--   hb.map_theta   the correlated-factor MAP and Laplace covariance (A2: Newton with observed information
--                  where Σ⁻¹ + diag(observed) is positive definite, else Fisher scoring, step halving with
--                  the 2⁻⁴⁶ slack, stop on an accepted step < 1e-8, at most 50 iterations)
--   hb.eap_by_axis the per-axis grid EAP (61 equal-weight points on [-4, 4]) of an observation set
--   hb.eap_from_ll the same posterior from a stored per-axis log-likelihood on the grid: what
--                  sessions.state holds (DESIGN §11.2 "a per-session, per-axis EAP on a 61-point grid")
--
-- Parity: scoring.core.db.test.ts runs every case of the bank's golden vectors (scoring_v2.json, 84
-- cases: 2PL, 3PL, GRM, Gaussian and testlet terms, per-case Σ) and requires θ, cov, EAP and the log
-- posterior to agree to 1e-6 (A2), and the testlet terms to 1e-9. The code follows the TypeScript
-- operation by operation, so the two agree to rounding in practice.
--
-- PostgreSQL differences from JavaScript that the code guards (the TypeScript relies on IEEE
-- behaviour that PostgreSQL turns into errors):
--   * exp() of a very negative number, and a product that underflows to 0, RAISE "value out of range:
--     underflow"; so every exp() argument is floored (-700 inside likelihood terms, where the result only
--     enters a log of a sum or a product with something of order 1; -230 for posterior weights) and a
--     weight below 1e-100 is skipped where it would be multiplied by something small. What this changes
--     is below 1e-100 in absolute terms.
--   * there is no log1p or expm1; hb.log1p and hb.expm1 use a Taylor series for |x| < 1e-4.
--   * the functions carry `set search_path = ''` (the conventions of the foundation migration), which
--     keeps PostgreSQL from inlining them, so the hot loops write their arithmetic out instead of
--     calling the small helpers.
--
-- Matrices are flat double precision arrays in row-major order: element (i, j), 1-based, is a[(i-1)*n + j].

-- A validated observation list as parallel arrays (index i = observation i), the shape the loops want
-- (hb.parse_obs). Created here, by the migration role, and not between `set local role hb_definer` and
-- `reset role` with the functions: hb_definer owns no relation or type it could redefine (a test checks it).
--   axis    1-based position in the axis order
--   pa..py  see hb.obs_terms; off/len locate the GRM thresholds / testlet triples in ext
create type hb.obs_set as (
  n int,
  kind int[],
  axis int[],
  pa double precision[],
  pb double precision[],
  pc double precision[],
  py double precision[],
  off int[],
  len int[],
  ext double precision[]
);

set local role hb_definer;

-- ------------------------------------------------------------------------------------------- axes
-- The canonical axis order of engine/axes.ts (index into θ and Σ). A test compares it with AXIS_CODES.
create function hb.axis_codes()
returns text[]
language sql immutable parallel safe
set search_path = ''
as $$ select array['MAT','LR','LG','RC','VOC','QR','SPA','WM','RT','PS','FER','CAL','KST','KHU','KAP','EMO','CRE']::text[] $$;

-- 1-based position of an axis code in hb.axis_codes(); null for anything else.
create function hb.axis_index(p_code text)
returns int
language sql immutable parallel safe
set search_path = ''
as $$ select pg_catalog.array_position(hb.axis_codes(), p_code) $$;

-- ----------------------------------------------------------------------------------- scalar helpers
create function hb.log1p(x double precision)
returns double precision
language sql immutable parallel safe
set search_path = ''
as $$
  select case
    when pg_catalog.abs(x) < 1e-30::double precision then x
    when pg_catalog.abs(x) < 1e-4::double precision then x - x * x / 2 + x * x * x / 3 - x * x * x * x / 4
    else pg_catalog.ln(1 + x) end
$$;

create function hb.expm1(x double precision)
returns double precision
language sql immutable parallel safe
set search_path = ''
as $$
  select case
    when pg_catalog.abs(x) < 1e-30::double precision then x
    when pg_catalog.abs(x) < 1e-4::double precision then x + x * x / 2 + x * x * x / 6 + x * x * x * x / 24
    else pg_catalog.exp(least(greatest(x, -700::double precision), 700::double precision)) - 1 end
$$;

-- σ(z) = 1/(1 + e^-z), never overflowing or underflowing (irt.ts logistic).
create function hb.sigmoid(z double precision)
returns double precision
language sql immutable parallel safe
set search_path = ''
as $$
  select case when z >= 0 then 1 / (1 + pg_catalog.exp(- least(z, 700::double precision)))
              else pg_catalog.exp(greatest(z, -700::double precision)) / (1 + pg_catalog.exp(greatest(z, -700::double precision))) end
$$;

-- log σ(z) = -log(1 + e^-z) (irt.ts logLogistic).
create function hb.log_sigmoid(z double precision)
returns double precision
language sql immutable parallel safe
set search_path = ''
as $$
  select case when z >= 0 then - hb.log1p(pg_catalog.exp(- least(z, 700::double precision)))
              else z - hb.log1p(pg_catalog.exp(greatest(z, -700::double precision))) end
$$;

-- ------------------------------------------------------------------------------------------ EAP grid
-- t_i = -4 + i * 8/60 for i = 0..60, the last point exactly 4 (engine/scorer.ts eapAxis).
create function hb.eap_grid()
returns double precision[]
language sql immutable parallel safe
set search_path = ''
as $$
  select pg_catalog.array_agg(case when i = 60 then 4::double precision else -4::double precision + i * (8::double precision / 60) end order by i)
    from pg_catalog.generate_series(0, 60) g (i)
$$;

-- -------------------------------------------------------------------------------- the testlet rule
-- The γ quadrature of irt.ts (M3.9): z_i = -8 + i/4 for i = 0..64 and log weights normalised to sum 1.
create function hb.testlet_z()
returns double precision[]
language sql immutable parallel safe
set search_path = ''
as $$ select pg_catalog.array_agg(-8::double precision + i * 0.25::double precision order by i) from pg_catalog.generate_series(0, 64) g (i) $$;

create function hb.testlet_logw()
returns double precision[]
language sql immutable parallel safe
set search_path = ''
as $$
  with zs as (select -8::double precision + i * 0.25::double precision as z from pg_catalog.generate_series(0, 64) g (i)),
       t as (select pg_catalog.ln(pg_catalog.sum(pg_catalog.exp(-0.5 * z * z))) as lt from zs)
  select pg_catalog.array_agg(-0.5 * zs.z * zs.z - t.lt order by zs.z) from zs, t
$$;

-- log(Σ exp(v_i)) without overflow; arguments below the maximum are floored at -700.
create function hb.logsumexp(p_v double precision[])
returns double precision
language plpgsql immutable parallel safe
set search_path = ''
as $$
declare
  v_mx double precision := - 'Infinity'::double precision;
  v_s double precision := 0;
  n int := coalesce(pg_catalog.array_length(p_v, 1), 0);
begin
  for i in 1..n loop
    if p_v[i] > v_mx then v_mx := p_v[i]; end if;
  end loop;
  for i in 1..n loop
    v_s := v_s + pg_catalog.exp(greatest(p_v[i] - v_mx, -700::double precision));
  end loop;
  return v_mx + pg_catalog.ln(v_s);
end
$$;

-- A testlet block (1 to 8 2PL items sharing γ ~ N(0, τ²)) at θ: log L, d log L/dθ, the observed information
-- E_π[O] - Var_π[S], and (p_info) the expected information over the 2^n response patterns. irt.ts
-- testletDerivatives. p_ext holds the items as (a, b, y) triples from element p_off + 1.
-- The pattern sum is done in logs; a pattern whose probability is below 1e-100 contributes nothing (the
-- TypeScript multiplies probabilities that underflow to 0 in the same cases).
create function hb.testlet_terms(
  p_theta double precision, p_tau double precision, p_ext double precision[], p_off int, p_n int, p_info boolean,
  out o_ll double precision, out o_score double precision, out o_oinfo double precision, out o_info double precision)
language plpgsql immutable parallel safe
set search_path = ''
as $$
declare
  c_nodes constant int := 65;
  v_z double precision[] := hb.testlet_z();
  v_logw double precision[] := hb.testlet_logw();
  v_lw double precision[] := pg_catalog.array_fill(0::double precision, array[c_nodes]);
  v_s double precision[] := pg_catalog.array_fill(0::double precision, array[c_nodes]);
  v_o double precision[] := pg_catalog.array_fill(0::double precision, array[c_nodes]);
  v_pa double precision[] := pg_catalog.array_fill(0::double precision, array[c_nodes]);
  v_lgp double precision[];
  v_lgq double precision[];
  v_a double precision;
  v_b double precision;
  v_y double precision;
  v_t double precision;
  v_x double precision;
  v_e double precision;
  v_inv double precision;
  v_pj double precision;
  v_qj double precision;
  v_l1 double precision;
  v_l double precision;
  v_si double precision;
  v_oi double precision;
  v_pai double precision;
  v_pi double precision;
  v_es double precision := 0;
  v_ess double precision := 0;
  v_eo double precision := 0;
  v_ya double precision;
  v_prob double precision;
  v_num double precision;
  v_lt double precision;
  v_base int;
begin
  if p_info then
    v_lgp := pg_catalog.array_fill(0::double precision, array[c_nodes * p_n]);
    v_lgq := pg_catalog.array_fill(0::double precision, array[c_nodes * p_n]);
  end if;
  for i in 1..c_nodes loop
    v_t := p_theta + p_tau * v_z[i];
    v_l := 0;
    v_si := 0;
    v_oi := 0;
    v_pai := 0;
    for j in 1..p_n loop
      v_base := p_off + 3 * (j - 1);
      v_a := p_ext[v_base + 1];
      v_b := p_ext[v_base + 2];
      v_y := p_ext[v_base + 3];
      v_x := v_a * (v_t - v_b);
      v_e := pg_catalog.exp(- least(pg_catalog.abs(v_x), 700::double precision));
      v_inv := 1 / (1 + v_e);
      if v_x >= 0 then
        v_pj := v_inv;
        v_qj := v_e * v_inv;
      else
        v_pj := v_e * v_inv;
        v_qj := v_inv;
      end if;
      v_l1 := hb.log1p(v_e);
      if v_y = 1 then
        v_l := v_l + (case when v_x >= 0 then - v_l1 else v_x - v_l1 end);
      else
        v_l := v_l + (case when v_x >= 0 then - v_x - v_l1 else - v_l1 end);
      end if;
      v_si := v_si + v_a * (v_y - v_pj);
      v_oi := v_oi + v_a * v_a * v_pj * v_qj;
      v_pai := v_pai + v_a * v_pj;
      if p_info then
        v_lgp[(i - 1) * p_n + j] := case when v_x >= 0 then - v_l1 else v_x - v_l1 end;
        v_lgq[(i - 1) * p_n + j] := case when v_x >= 0 then - v_x - v_l1 else - v_l1 end;
      end if;
    end loop;
    v_lw[i] := v_logw[i] + v_l;
    v_s[i] := v_si;
    v_o[i] := v_oi;
    v_pa[i] := v_pai;
  end loop;

  o_ll := hb.logsumexp(v_lw);
  for i in 1..c_nodes loop
    v_pi := pg_catalog.exp(greatest(v_lw[i] - o_ll, -700::double precision));
    if v_pi < 1e-100::double precision then continue; end if;
    v_es := v_es + v_pi * v_s[i];
    v_ess := v_ess + v_pi * v_s[i] * v_s[i];
    v_eo := v_eo + v_pi * v_o[i];
  end loop;
  o_score := v_es;
  o_oinfo := v_eo - (v_ess - v_es * v_es);
  o_info := 'NaN'::double precision;

  if p_info then
    o_info := 0;
    for m in 0..(1 << p_n) - 1 loop
      v_ya := 0;
      for j in 1..p_n loop
        if ((m >> (j - 1)) & 1) = 1 then v_ya := v_ya + p_ext[p_off + 3 * (j - 1) + 1]; end if;
      end loop;
      v_prob := 0;
      v_num := 0;
      for i in 1..c_nodes loop
        v_lt := v_logw[i];
        for j in 1..p_n loop
          v_lt := v_lt + (case when ((m >> (j - 1)) & 1) = 1 then v_lgp[(i - 1) * p_n + j] else v_lgq[(i - 1) * p_n + j] end);
        end loop;
        v_pi := pg_catalog.exp(greatest(v_lt, -700::double precision)); -- w_i * L_i(y)
        if v_pi < 1e-100::double precision then continue; end if;
        v_prob := v_prob + v_pi;
        v_num := v_num + v_pi * (v_ya - v_pa[i]);
      end loop;
      if v_prob >= 1e-100::double precision then
        o_info := o_info + (v_num * v_num) / v_prob;
      end if;
    end loop;
  end if;
end
$$;

-- ------------------------------------------------------------------------------ one observation
-- Kinds: 1 = 2pl, 2 = 3pl, 3 = grm, 4 = gaussian, 5 = testlet (hb.parse_obs). The parameters are those of
-- the wire schema: p_a, p_b, p_c, p_y are (a, b, c, y) for 2PL/3PL, (a, -, -, category) for the GRM
-- whose thresholds are p_ext[p_off + 1 .. p_off + p_len], (lam, d, sigma, x) for a Gaussian term, and
-- (-, -, tau, -) for a testlet whose p_len items are triples in p_ext.
-- p_want: 1 = o_ll only, 2 = also o_score and o_oinfo, 3 = also o_info (the expected information).
-- Without p_want 3, o_info is NaN for the kinds that need extra work for it (GRM, testlet, 3PL's is cheap).
create function hb.obs_terms(
  p_kind int, p_theta double precision, p_a double precision, p_b double precision, p_c double precision, p_y double precision,
  p_ext double precision[], p_off int, p_len int, p_want int,
  out o_ll double precision, out o_score double precision, out o_info double precision, out o_oinfo double precision)
language plpgsql immutable parallel safe
set search_path = ''
as $$
declare
  c_log_2pi constant double precision := pg_catalog.ln(2 * pg_catalog.pi());
  z double precision;
  s double precision;
  q double precision;
  p double precision;
  u double precision;
  r double precision;
  lc double precision;
  lv double precision;
  mx double precision;
  m int;
  cat int;
  v_z double precision[];
  v_lp double precision[];
  v_cum double precision[];
  v_sc double precision[];
  v_gap double precision;
  v_t record;
begin
  o_score := 0;
  o_info := 'NaN'::double precision;
  o_oinfo := 0;
  if p_kind = 1 then
    z := p_a * (p_theta - p_b);
    o_ll := case when p_y = 1 then hb.log_sigmoid(z) else hb.log_sigmoid(- z) end;
    if p_want >= 2 then
      s := hb.sigmoid(z);
      q := hb.sigmoid(- z);
      o_score := p_a * (p_y - s);
      o_info := p_a * p_a * s * q;
      o_oinfo := o_info;
    end if;
  elsif p_kind = 2 then
    z := p_a * (p_theta - p_b);
    if p_y = 0 then
      o_ll := hb.log1p(- p_c) + hb.log_sigmoid(- z);
    else
      lc := pg_catalog.ln(p_c);
      lv := hb.log1p(- p_c) + hb.log_sigmoid(z);
      mx := greatest(lc, lv);
      o_ll := mx + pg_catalog.ln(pg_catalog.exp(greatest(lc - mx, -700::double precision)) + pg_catalog.exp(greatest(lv - mx, -700::double precision)));
    end if;
    if p_want >= 2 then
      s := hb.sigmoid(z);
      q := hb.sigmoid(- z);
      p := p_c + (1 - p_c) * s;
      o_score := (p_a * (p_y - p) * s) / p;
      -- s * s underflows (an error here) where s < 1e-154; the information there is below 1e-100
      o_info := case when s < 1e-100::double precision then 0 else (p_a * p_a * s * s * (1 - p_c) * q) / p end;
      if p_y = 0 then
        o_oinfo := p_a * p_a * s * q;
      else
        u := (1 - p_c) * s;
        o_oinfo := (p_a * p_a * u * q * (s * (u + 2 * p_c) - p_c)) / (p * p);
      end if;
    end if;
  elsif p_kind = 3 then
    m := p_len;
    cat := p_y::int;
    v_z := pg_catalog.array_fill(0::double precision, array[m]);
    for j in 1..m loop
      v_z[j] := p_a * (p_theta - p_ext[p_off + j]);
    end loop;
    v_lp := pg_catalog.array_fill(0::double precision, array[m + 1]); -- log P(y = j) at j + 1
    v_lp[1] := hb.log_sigmoid(- v_z[1]);
    for j in 1..m - 1 loop
      v_gap := p_a * (p_ext[p_off + j + 1] - p_ext[p_off + j]);
      v_lp[j + 1] := hb.log_sigmoid(v_z[j]) + hb.log_sigmoid(- v_z[j + 1]) + pg_catalog.ln(- hb.expm1(- v_gap));
    end loop;
    v_lp[m + 1] := hb.log_sigmoid(v_z[m]);
    o_ll := v_lp[cat + 1];
    if p_want >= 2 then
      -- P*(>= j) for j = 0..m + 1 at index j + 1
      v_cum := pg_catalog.array_fill(0::double precision, array[m + 2]);
      v_cum[1] := 1;
      for j in 1..m loop
        v_cum[j + 1] := hb.sigmoid(v_z[j]);
      end loop;
      v_cum[m + 2] := 0;
      o_score := p_a * (1 - v_cum[cat + 1] - v_cum[cat + 2]);
      -- observed information a² (v_y + v_{y+1}), v_j = σ(z_j) σ(-z_j) for 1 <= j <= m
      r := 0;
      for j in cat..cat + 1 loop
        if j >= 1 and j <= m then
          r := r + hb.sigmoid(v_z[j]) * hb.sigmoid(- v_z[j]);
        end if;
      end loop;
      o_oinfo := p_a * p_a * r;
      if p_want >= 3 then
        o_info := 0;
        for j in 0..m loop
          if v_lp[j + 1] > -230 then -- a category with probability below e^-230 adds less than 1e-100
            u := p_a * (1 - v_cum[j + 1] - v_cum[j + 2]);
            if pg_catalog.abs(u) > 1e-100::double precision then -- u * u would underflow below it
              o_info := o_info + pg_catalog.exp(v_lp[j + 1]) * u * u;
            end if;
          end if;
        end loop;
      end if;
    end if;
  elsif p_kind = 4 then
    r := (p_y - p_a * p_theta - p_b) / p_c;
    o_ll := -0.5 * r * r - pg_catalog.ln(p_c) - 0.5 * c_log_2pi;
    if p_want >= 2 then
      o_score := (p_a * (p_y - p_a * p_theta - p_b)) / (p_c * p_c);
      o_info := (p_a * p_a) / (p_c * p_c);
      o_oinfo := o_info;
    end if;
  elsif p_kind = 5 then
    select t.* into v_t from hb.testlet_terms(p_theta, p_c, p_ext, p_off, p_len, p_want >= 3) t;
    o_ll := v_t.o_ll;
    if p_want >= 2 then
      o_score := v_t.o_score;
      o_oinfo := v_t.o_oinfo;
      o_info := v_t.o_info;
    end if;
  else
    raise exception 'unknown observation kind %', p_kind using errcode = '22023';
  end if;
end
$$;

-- --------------------------------------------------------------------------------- observation set
-- (the type hb.obs_set is created at the top of this file; see there)

create function hb.bad_obs(p_message text)
returns void
language plpgsql immutable
set search_path = ''
as $$
begin
  raise exception 'invalid observation: %', p_message using errcode = '22023';
end
$$;

-- A finite JSON number (jsonb cannot hold NaN or Infinity).
create function hb.obs_num(p_e jsonb, p_key text)
returns double precision
language plpgsql immutable
set search_path = ''
as $$
begin
  if pg_catalog.jsonb_typeof(p_e -> p_key) is distinct from 'number' then
    perform hb.bad_obs(p_key || ' must be a number');
  end if;
  return (p_e ->> p_key)::double precision;
end
$$;

-- Validates and unpacks an observation array with the rules of scorer.ts checkObservation: exactly the
-- fields of its kind, a known axis among the first p_k, 0 < c < 1, binary y, GRM thresholds strictly
-- increasing with y in 0..m, sigma > 0, a testlet of 1 to 8 items with exactly a, b, y, tau >= 0 and
-- |a| tau <= 3. 22023 (invalid_parameter_value) otherwise.
create function hb.parse_obs(p_obs jsonb, p_k int default 17)
returns hb.obs_set
language plpgsql immutable
set search_path = ''
as $$
declare
  v hb.obs_set;
  e jsonb;
  n int;
  i int := 0;
  v_kind text;
  v_axis int;
  v_a double precision;
  v_b double precision;
  v_c double precision;
  v_y double precision;
  m int;
  prev double precision;
  v_thr jsonb;
  v_items jsonb;
  v_item jsonb;
  v_tau double precision;
begin
  if p_obs is null or pg_catalog.jsonb_typeof(p_obs) is distinct from 'array' then
    perform hb.bad_obs('observations must be an array');
  end if;
  n := pg_catalog.jsonb_array_length(p_obs);
  v.n := n;
  v.kind := pg_catalog.array_fill(0, array[n]);
  v.axis := pg_catalog.array_fill(0, array[n]);
  v.pa := pg_catalog.array_fill(0::double precision, array[n]);
  v.pb := pg_catalog.array_fill(0::double precision, array[n]);
  v.pc := pg_catalog.array_fill(0::double precision, array[n]);
  v.py := pg_catalog.array_fill(0::double precision, array[n]);
  v.off := pg_catalog.array_fill(0, array[n]);
  v.len := pg_catalog.array_fill(0, array[n]);
  v.ext := '{}'::double precision[];
  for e in select x.value from pg_catalog.jsonb_array_elements(p_obs) x loop
    i := i + 1;
    if pg_catalog.jsonb_typeof(e) is distinct from 'object' then
      perform hb.bad_obs('observation must be an object');
    end if;
    v_kind := e ->> 'kind';
    if pg_catalog.jsonb_typeof(e -> 'axis') is distinct from 'string' then
      perform hb.bad_obs('axis must be an axis code');
    end if;
    v_axis := hb.axis_index(e ->> 'axis');
    if v_axis is null then
      perform hb.bad_obs('unknown axis code ' || (e ->> 'axis'));
    end if;
    if v_axis > p_k then
      perform hb.bad_obs('axis ' || (e ->> 'axis') || ' outside the first ' || p_k || ' axes');
    end if;
    v.axis[i] := v_axis;
    v.off[i] := coalesce(pg_catalog.array_length(v.ext, 1), 0);
    if v_kind = '2pl' then
      if (e - 'kind' - 'axis' - 'a' - 'b' - 'y') <> '{}'::jsonb or not (e ?& array['a', 'b', 'y']) then
        perform hb.bad_obs('a 2pl observation needs exactly the fields a, b, y');
      end if;
      v.kind[i] := 1;
      v.pa[i] := hb.obs_num(e, 'a');
      v.pb[i] := hb.obs_num(e, 'b');
      v_y := hb.obs_num(e, 'y');
      if v_y <> 0 and v_y <> 1 then perform hb.bad_obs('binary response y must be 0 or 1'); end if;
      v.py[i] := v_y;
    elsif v_kind = '3pl' then
      if (e - 'kind' - 'axis' - 'a' - 'b' - 'c' - 'y') <> '{}'::jsonb or not (e ?& array['a', 'b', 'c', 'y']) then
        perform hb.bad_obs('a 3pl observation needs exactly the fields a, b, c, y');
      end if;
      v.kind[i] := 2;
      v.pa[i] := hb.obs_num(e, 'a');
      v.pb[i] := hb.obs_num(e, 'b');
      v_c := hb.obs_num(e, 'c');
      if not (v_c > 0 and v_c < 1) then perform hb.bad_obs('3PL guessing parameter must be in (0, 1)'); end if;
      v.pc[i] := v_c;
      v_y := hb.obs_num(e, 'y');
      if v_y <> 0 and v_y <> 1 then perform hb.bad_obs('binary response y must be 0 or 1'); end if;
      v.py[i] := v_y;
    elsif v_kind = 'grm' then
      if (e - 'kind' - 'axis' - 'a' - 'b' - 'y') <> '{}'::jsonb or not (e ?& array['a', 'b', 'y']) then
        perform hb.bad_obs('a grm observation needs exactly the fields a, b, y');
      end if;
      v.kind[i] := 3;
      v_a := hb.obs_num(e, 'a');
      if not (v_a > 0) then perform hb.bad_obs('GRM discrimination must be positive'); end if;
      v.pa[i] := v_a;
      v_thr := e -> 'b';
      if pg_catalog.jsonb_typeof(v_thr) is distinct from 'array' or pg_catalog.jsonb_array_length(v_thr) < 1 then
        perform hb.bad_obs('GRM needs at least one threshold');
      end if;
      m := pg_catalog.jsonb_array_length(v_thr);
      prev := null;
      for j in 0..m - 1 loop
        if pg_catalog.jsonb_typeof(v_thr -> j) is distinct from 'number' then perform hb.bad_obs('GRM threshold is not a number'); end if;
        v_b := (v_thr ->> j)::double precision;
        if prev is not null and not (v_b > prev) then perform hb.bad_obs('GRM thresholds must be strictly increasing'); end if;
        prev := v_b;
        v.ext := v.ext || v_b;
      end loop;
      v.len[i] := m;
      v_y := hb.obs_num(e, 'y');
      if v_y <> pg_catalog.trunc(v_y) or v_y < 0 or v_y > m then perform hb.bad_obs('GRM category y must be an integer in 0..m'); end if;
      v.py[i] := v_y;
    elsif v_kind = 'gaussian' then
      if (e - 'kind' - 'axis' - 'lam' - 'd' - 'sigma' - 'x') <> '{}'::jsonb or not (e ?& array['lam', 'd', 'sigma', 'x']) then
        perform hb.bad_obs('a gaussian observation needs exactly the fields lam, d, sigma, x');
      end if;
      v.kind[i] := 4;
      v.pa[i] := hb.obs_num(e, 'lam');
      v.pb[i] := hb.obs_num(e, 'd');
      v_c := hb.obs_num(e, 'sigma');
      if not (v_c > 0) then perform hb.bad_obs('Gaussian sigma must be positive'); end if;
      v.pc[i] := v_c;
      v.py[i] := hb.obs_num(e, 'x');
    elsif v_kind = 'testlet' then
      if (e - 'kind' - 'axis' - 'tau' - 'items') <> '{}'::jsonb or not (e ?& array['tau', 'items']) then
        perform hb.bad_obs('a testlet observation needs exactly the fields tau, items');
      end if;
      v.kind[i] := 5;
      v_tau := hb.obs_num(e, 'tau');
      if v_tau < 0 then perform hb.bad_obs('testlet tau must be >= 0'); end if;
      v.pc[i] := v_tau;
      v_items := e -> 'items';
      if pg_catalog.jsonb_typeof(v_items) is distinct from 'array' or pg_catalog.jsonb_array_length(v_items) < 1 or pg_catalog.jsonb_array_length(v_items) > 8 then
        perform hb.bad_obs('a testlet has 1 to 8 items');
      end if;
      m := pg_catalog.jsonb_array_length(v_items);
      for j in 0..m - 1 loop
        v_item := v_items -> j;
        if pg_catalog.jsonb_typeof(v_item) is distinct from 'object' or (v_item - 'a' - 'b' - 'y') <> '{}'::jsonb or not (v_item ?& array['a', 'b', 'y']) then
          perform hb.bad_obs('a testlet item needs exactly the fields a, b, y');
        end if;
        v_a := hb.obs_num(v_item, 'a');
        v_b := hb.obs_num(v_item, 'b');
        v_y := hb.obs_num(v_item, 'y');
        if pg_catalog.abs(v_a) * v_tau > 3 then perform hb.bad_obs('testlet item |a| tau must be <= 3'); end if;
        if v_y <> 0 and v_y <> 1 then perform hb.bad_obs('binary response y must be 0 or 1'); end if;
        v.ext := v.ext || array[v_a, v_b, v_y];
      end loop;
      v.len[i] := m;
    else
      perform hb.bad_obs('unknown observation kind ' || coalesce(v_kind, 'null'));
    end if;
  end loop;
  return v;
end
$$;

-- ------------------------------------------------------------------------------- linear algebra
-- Cholesky factor L (lower triangle, flat) of a symmetric matrix, reading its lower triangle; null if a
-- pivot is not strictly positive (linalg.ts tryCholesky).
create function hb.mat_chol(a double precision[], n int)
returns double precision[]
language plpgsql immutable parallel safe
set search_path = ''
as $$
declare
  l double precision[] := pg_catalog.array_fill(0::double precision, array[n * n]);
  d double precision;
  s double precision;
  ljj double precision;
begin
  for j in 1..n loop
    d := a[(j - 1) * n + j];
    for k in 1..j - 1 loop
      d := d - l[(j - 1) * n + k] * l[(j - 1) * n + k];
    end loop;
    if not (d > 0) or d >= 'Infinity'::double precision then
      return null;
    end if;
    ljj := pg_catalog.sqrt(d);
    l[(j - 1) * n + j] := ljj;
    for i in j + 1..n loop
      s := a[(i - 1) * n + j];
      for k in 1..j - 1 loop
        s := s - l[(i - 1) * n + k] * l[(j - 1) * n + k];
      end loop;
      l[(i - 1) * n + j] := s / ljj;
    end loop;
  end loop;
  return l;
end
$$;

-- Solves (L Lᵀ) x = b given the Cholesky factor L (linalg.ts choleskySolve).
create function hb.mat_chol_solve(l double precision[], b double precision[], n int)
returns double precision[]
language plpgsql immutable parallel safe
set search_path = ''
as $$
declare
  y double precision[] := pg_catalog.array_fill(0::double precision, array[n]);
  x double precision[] := pg_catalog.array_fill(0::double precision, array[n]);
  s double precision;
begin
  for i in 1..n loop
    s := b[i];
    for k in 1..i - 1 loop
      s := s - l[(i - 1) * n + k] * y[k];
    end loop;
    y[i] := s / l[(i - 1) * n + i];
  end loop;
  for i in reverse n..1 loop
    s := y[i];
    for k in i + 1..n loop
      s := s - l[(k - 1) * n + i] * x[k];
    end loop;
    x[i] := s / l[(i - 1) * n + i];
  end loop;
  return x;
end
$$;

-- (L Lᵀ)⁻¹, exactly symmetric (linalg.ts choleskyInverse).
create function hb.mat_chol_inverse(l double precision[], n int)
returns double precision[]
language plpgsql immutable parallel safe
set search_path = ''
as $$
declare
  cols double precision[] := pg_catalog.array_fill(0::double precision, array[n * n]); -- column j at (j-1)*n + i
  e double precision[];
  x double precision[];
  inv double precision[] := pg_catalog.array_fill(0::double precision, array[n * n]);
  v double precision;
begin
  for j in 1..n loop
    e := pg_catalog.array_fill(0::double precision, array[n]);
    e[j] := 1;
    x := hb.mat_chol_solve(l, e, n);
    for i in 1..n loop
      cols[(j - 1) * n + i] := x[i];
    end loop;
  end loop;
  for i in 1..n loop
    for j in 1..i loop
      v := (cols[(j - 1) * n + i] + cols[(i - 1) * n + j]) / 2;
      inv[(i - 1) * n + j] := v;
      inv[(j - 1) * n + i] := v;
    end loop;
  end loop;
  return inv;
end
$$;

-- log|L Lᵀ| = 2 Σ log L_ii (linalg.ts choleskyLogDet).
create function hb.mat_chol_logdet(l double precision[], n int)
returns double precision
language plpgsql immutable parallel safe
set search_path = ''
as $$
declare
  s double precision := 0;
begin
  for i in 1..n loop
    s := s + pg_catalog.ln(l[(i - 1) * n + i]);
  end loop;
  return 2 * s;
end
$$;

-- ---------------------------------------------------------------------------------- the posterior
-- Σ_j log p(y_j | θ_axis(j)) over an observation set (scorer.ts loglik).
create function hb.obs_loglik(p_set hb.obs_set, p_theta double precision[])
returns double precision
language plpgsql immutable parallel safe
set search_path = ''
as $$
declare
  total double precision := 0;
  t double precision;
  z double precision;
  a double precision;
  c double precision;
  lc double precision;
  lv double precision;
  mx double precision;
  v_kind int;
  v_term record;
begin
  for i in 1..p_set.n loop
    t := p_theta[p_set.axis[i]];
    v_kind := p_set.kind[i];
    if v_kind = 1 then
      z := p_set.pa[i] * (t - p_set.pb[i]);
      if p_set.py[i] = 1 then
        total := total + (case when z >= 0 then - hb.log1p(pg_catalog.exp(- least(z, 700::double precision))) else z - hb.log1p(pg_catalog.exp(greatest(z, -700::double precision))) end);
      else
        total := total + (case when z <= 0 then - hb.log1p(pg_catalog.exp(greatest(z, -700::double precision))) else - z - hb.log1p(pg_catalog.exp(- least(z, 700::double precision))) end);
      end if;
    elsif v_kind = 2 then
      a := p_set.pa[i];
      c := p_set.pc[i];
      z := a * (t - p_set.pb[i]);
      if p_set.py[i] = 0 then
        total := total + hb.log1p(- c) + (case when z <= 0 then - hb.log1p(pg_catalog.exp(greatest(z, -700::double precision))) else - z - hb.log1p(pg_catalog.exp(- least(z, 700::double precision))) end);
      else
        lc := pg_catalog.ln(c);
        lv := hb.log1p(- c) + (case when z >= 0 then - hb.log1p(pg_catalog.exp(- least(z, 700::double precision))) else z - hb.log1p(pg_catalog.exp(greatest(z, -700::double precision))) end);
        mx := greatest(lc, lv);
        total := total + mx + pg_catalog.ln(pg_catalog.exp(greatest(lc - mx, -700::double precision)) + pg_catalog.exp(greatest(lv - mx, -700::double precision)));
      end if;
    else
      select o.o_ll into v_term from hb.obs_terms(v_kind, t, p_set.pa[i], p_set.pb[i], p_set.pc[i], p_set.py[i], p_set.ext, p_set.off[i], p_set.len[i], 1) o;
      total := total + v_term.o_ll;
    end if;
  end loop;
  return total;
end
$$;

-- Per-axis sums of the score, the expected information (only when p_want_info) and the observed
-- information of an observation set at θ (scorer.ts derivatives). Without p_want_info the expected
-- information of a term whose observed information differs from it (GRM, testlet) is left out, and o_info
-- must not be used; the MAP asks for it only where it needs it.
create function hb.obs_derivs(
  p_set hb.obs_set, p_theta double precision[], p_k int, p_want_info boolean,
  out o_score double precision[], out o_info double precision[], out o_oinfo double precision[])
language plpgsql immutable parallel safe
set search_path = ''
as $$
declare
  t double precision;
  z double precision;
  a double precision;
  c double precision;
  y double precision;
  s double precision;
  q double precision;
  p double precision;
  u double precision;
  e double precision;
  inv double precision;
  ax int;
  v_kind int;
  v_term record;
begin
  o_score := pg_catalog.array_fill(0::double precision, array[p_k]);
  o_info := pg_catalog.array_fill(0::double precision, array[p_k]);
  o_oinfo := pg_catalog.array_fill(0::double precision, array[p_k]);
  for i in 1..p_set.n loop
    ax := p_set.axis[i];
    t := p_theta[ax];
    v_kind := p_set.kind[i];
    if v_kind <= 2 then
      a := p_set.pa[i];
      y := p_set.py[i];
      z := a * (t - p_set.pb[i]);
      e := pg_catalog.exp(- least(pg_catalog.abs(z), 700::double precision));
      inv := 1 / (1 + e);
      if z >= 0 then
        s := inv;
        q := e * inv;
      else
        s := e * inv;
        q := inv;
      end if;
      if v_kind = 1 then
        o_score[ax] := o_score[ax] + a * (y - s);
        u := a * a * s * q;
        o_info[ax] := o_info[ax] + u;
        o_oinfo[ax] := o_oinfo[ax] + u;
      else
        c := p_set.pc[i];
        p := c + (1 - c) * s;
        o_score[ax] := o_score[ax] + (a * (y - p) * s) / p;
        if s >= 1e-100::double precision then -- below it s * s would underflow, and the term is below 1e-100
          o_info[ax] := o_info[ax] + (a * a * s * s * (1 - c) * q) / p;
        end if;
        if y = 0 then
          o_oinfo[ax] := o_oinfo[ax] + a * a * s * q;
        else
          u := (1 - c) * s;
          o_oinfo[ax] := o_oinfo[ax] + (a * a * u * q * (s * (u + 2 * c) - c)) / (p * p);
        end if;
      end if;
    else
      select o.o_score, o.o_info, o.o_oinfo into v_term
        from hb.obs_terms(v_kind, t, p_set.pa[i], p_set.pb[i], p_set.pc[i], p_set.py[i], p_set.ext, p_set.off[i], p_set.len[i], case when p_want_info then 3 else 2 end) o;
      o_score[ax] := o_score[ax] + v_term.o_score;
      o_oinfo[ax] := o_oinfo[ax] + v_term.o_oinfo;
      if p_want_info then
        o_info[ax] := o_info[ax] + v_term.o_info;
      end if;
    end if;
  end loop;
end
$$;

-- log N(θ; μ, Σ) with the normalising constant, given the Cholesky factor of Σ (scorer.ts priorLogpdf).
create function hb.prior_logpdf(p_l double precision[], p_logdet double precision, p_mu double precision[], p_theta double precision[], p_k int)
returns double precision
language plpgsql immutable parallel safe
set search_path = ''
as $$
declare
  r double precision[] := pg_catalog.array_fill(0::double precision, array[p_k]);
  x double precision[];
  quad double precision := 0;
begin
  for i in 1..p_k loop
    r[i] := p_theta[i] - p_mu[i];
  end loop;
  x := hb.mat_chol_solve(p_l, r, p_k);
  for i in 1..p_k loop
    quad := quad + r[i] * x[i];
  end loop;
  return -0.5 * (p_k * pg_catalog.ln(2 * pg_catalog.pi()) + p_logdet + quad);
end
$$;

-- The correlated-factor MAP θ and Laplace covariance (DESIGN §7.2; the A2 convention of scorer.ts mapTheta,
-- read the module comment there). Prior N(p_mu, p_sigma), p_sigma flat k×k. o_cov is flat k×k, exactly
-- symmetric. 22023 for an invalid observation, a mu/Sigma of the wrong size, or a Sigma that is not
-- symmetric positive definite.
create function hb.map_theta(
  p_obs jsonb, p_mu double precision[], p_sigma double precision[],
  p_max_iter int default 50, p_tol double precision default 1e-8,
  out o_theta double precision[], out o_cov double precision[], out o_n_iter int, out o_lp double precision)
language plpgsql immutable parallel safe
set search_path = ''
as $$
declare
  c_slack constant double precision := 1.4210854715202004e-14; -- 2^-46, the halving test's slack
  c_max_halvings constant int := 30;
  k int := coalesce(pg_catalog.array_length(p_mu, 1), 0);
  v_set hb.obs_set;
  v_l0 double precision[];
  v_prec double precision[];
  v_logdet double precision;
  v_theta double precision[];
  v_cur double precision;
  v_d record;
  v_g double precision[];
  v_pr double precision[];
  v_h double precision[];
  v_l double precision[];
  v_step double precision[];
  v_cand double precision[];
  v_cand_lp double precision;
  v_accept_at double precision;
  v_s double precision;
  v_halvings int;
  v_accepted double precision[];
  v_max_step double precision;
  v_x double precision;
begin
  if p_max_iter is null or p_max_iter < 1 then
    raise exception 'maxIter must be an integer >= 1' using errcode = '22023';
  end if;
  if k < 1 or pg_catalog.array_length(p_sigma, 1) is distinct from k * k then
    raise exception 'mu must have K >= 1 entries and sigma be K x K' using errcode = '22023';
  end if;
  for i in 1..k loop
    for j in i + 1..k loop
      if not (pg_catalog.abs(p_sigma[(i - 1) * k + j] - p_sigma[(j - 1) * k + i]) <= 1e-12::double precision) then
        raise exception 'sigma must be symmetric' using errcode = '22023';
      end if;
    end loop;
  end loop;
  v_l0 := hb.mat_chol(p_sigma, k);
  if v_l0 is null then
    raise exception 'sigma must be positive definite' using errcode = '22023';
  end if;
  v_logdet := hb.mat_chol_logdet(v_l0, k);
  v_prec := hb.mat_chol_inverse(v_l0, k);
  v_set := hb.parse_obs(p_obs, k);

  v_theta := p_mu;
  v_cur := hb.obs_loglik(v_set, v_theta) + hb.prior_logpdf(v_l0, v_logdet, p_mu, v_theta, k);
  o_n_iter := 0;
  while o_n_iter < p_max_iter loop
    o_n_iter := o_n_iter + 1;
    select * into v_d from hb.obs_derivs(v_set, v_theta, k, false);
    -- g = score - Σ⁻¹ (θ - μ)
    v_pr := pg_catalog.array_fill(0::double precision, array[k]);
    v_g := pg_catalog.array_fill(0::double precision, array[k]);
    for i in 1..k loop
      v_x := 0;
      for j in 1..k loop
        v_x := v_x + v_prec[(i - 1) * k + j] * (v_theta[j] - p_mu[j]);
      end loop;
      v_g[i] := v_d.o_score[i] - v_x;
    end loop;
    v_accept_at := v_cur - c_slack * (1 + pg_catalog.abs(v_cur));
    v_accepted := null;
    -- candidate 1: Newton, H = Σ⁻¹ + diag(observed information), if it is positive definite;
    -- candidate 2: Fisher scoring, H = Σ⁻¹ + diag(expected information), always positive definite
    for cand in 1..2 loop
      if cand = 1 then
        v_h := v_prec;
        for i in 1..k loop
          v_h[(i - 1) * k + i] := v_h[(i - 1) * k + i] + v_d.o_oinfo[i];
        end loop;
        v_l := hb.mat_chol(v_h, k);
        if v_l is null then continue; end if;
      else
        select * into v_d from hb.obs_derivs(v_set, v_theta, k, true);
        v_h := v_prec;
        for i in 1..k loop
          v_h[(i - 1) * k + i] := v_h[(i - 1) * k + i] + v_d.o_info[i];
        end loop;
        v_l := hb.mat_chol(v_h, k);
        if v_l is null then
          raise exception 'matrix is not positive definite' using errcode = '22023';
        end if;
      end if;
      v_step := hb.mat_chol_solve(v_l, v_g, k);
      v_s := 1;
      v_halvings := 0;
      v_cand := pg_catalog.array_fill(0::double precision, array[k]);
      for i in 1..k loop
        v_cand[i] := v_theta[i] + v_step[i];
      end loop;
      v_cand_lp := hb.obs_loglik(v_set, v_cand) + hb.prior_logpdf(v_l0, v_logdet, p_mu, v_cand, k);
      while not (v_cand_lp >= v_accept_at) and v_halvings < c_max_halvings loop
        v_s := v_s * 0.5;
        for i in 1..k loop
          v_cand[i] := v_theta[i] + v_s * v_step[i];
        end loop;
        v_cand_lp := hb.obs_loglik(v_set, v_cand) + hb.prior_logpdf(v_l0, v_logdet, p_mu, v_cand, k);
        v_halvings := v_halvings + 1;
      end loop;
      if v_cand_lp >= v_accept_at then
        v_accepted := pg_catalog.array_fill(0::double precision, array[k]);
        for i in 1..k loop
          v_accepted[i] := v_s * v_step[i];
        end loop;
        exit;
      end if;
    end loop;
    if v_accepted is null then
      exit; -- no step gives an ascent: θ is the MAP to floating-point resolution
    end if;
    v_theta := v_cand;
    v_cur := v_cand_lp;
    v_max_step := 0;
    for i in 1..k loop
      v_max_step := greatest(v_max_step, pg_catalog.abs(v_accepted[i]));
    end loop;
    if v_max_step < p_tol then
      exit;
    end if;
  end loop;

  select * into v_d from hb.obs_derivs(v_set, v_theta, k, true);
  v_h := v_prec;
  for i in 1..k loop
    v_h[(i - 1) * k + i] := v_h[(i - 1) * k + i] + v_d.o_info[i];
  end loop;
  v_l := hb.mat_chol(v_h, k);
  if v_l is null then
    raise exception 'matrix is not positive definite' using errcode = '22023';
  end if;
  o_theta := v_theta;
  o_cov := hb.mat_chol_inverse(v_l, k);
  o_lp := v_cur;
end
$$;

-- Posterior mean and sd on the 61-point grid from a log-likelihood already summed over the observations
-- of one axis, under the prior N(p_mu, p_var) (scorer.ts eapAxis: weights exp(l - max l), normalised).
-- A null or empty log-likelihood is the prior alone.
create function hb.eap_from_ll(p_ll double precision[], p_mu double precision, p_var double precision, out o_mean double precision, out o_sd double precision)
language plpgsql immutable parallel safe
set search_path = ''
as $$
declare
  v_grid double precision[] := hb.eap_grid();
  v_lw double precision[] := pg_catalog.array_fill(0::double precision, array[61]);
  v_mx double precision := - 'Infinity'::double precision;
  v_w double precision[] := pg_catalog.array_fill(0::double precision, array[61]);
  v_total double precision := 0;
  v_var double precision := 0;
begin
  for i in 1..61 loop
    v_lw[i] := -0.5 * (v_grid[i] - p_mu) * (v_grid[i] - p_mu) / p_var + coalesce(p_ll[i], 0);
    if v_lw[i] > v_mx then v_mx := v_lw[i]; end if;
  end loop;
  for i in 1..61 loop
    v_w[i] := pg_catalog.exp(greatest(v_lw[i] - v_mx, -230::double precision));
    v_total := v_total + v_w[i];
  end loop;
  o_mean := 0;
  for i in 1..61 loop
    v_w[i] := v_w[i] / v_total;
    o_mean := o_mean + v_w[i] * v_grid[i];
  end loop;
  for i in 1..61 loop
    v_var := v_var + v_w[i] * (v_grid[i] - o_mean) * (v_grid[i] - o_mean);
  end loop;
  o_sd := pg_catalog.sqrt(greatest(v_var, 0::double precision));
end
$$;

-- The log-likelihood of one scored 2PL/3PL response at the 61 grid points (model 1 = 2PL, 2 = 3PL).
create function hb.grid_ll(p_kind int, p_a double precision, p_b double precision, p_c double precision, p_y double precision)
returns double precision[]
language plpgsql immutable parallel safe
set search_path = ''
as $$
declare
  v_grid double precision[] := hb.eap_grid();
  v_out double precision[] := pg_catalog.array_fill(0::double precision, array[61]);
  v_term record;
begin
  for i in 1..61 loop
    select o.o_ll into v_term from hb.obs_terms(p_kind, v_grid[i], p_a, p_b, p_c, p_y, '{}'::double precision[], 0, 0, 1) o;
    v_out[i] := v_term.o_ll;
  end loop;
  return v_out;
end
$$;

-- The per-axis grid EAP of an observation set: {axis, mean, sd} for every axis with at least one
-- observation, in axis order; the prior of axis k is N(mu_k, sigma_kk) (scorer.ts eapByAxis).
create function hb.eap_by_axis(p_obs jsonb, p_mu double precision[], p_sigma double precision[])
returns table (axis text, mean double precision, sd double precision)
language plpgsql immutable parallel safe
set search_path = ''
as $$
declare
  k int := coalesce(pg_catalog.array_length(p_mu, 1), 0);
  v_set hb.obs_set := hb.parse_obs(p_obs, k);
  v_grid double precision[] := hb.eap_grid();
  v_ll double precision[];
  v_has boolean;
  v_e record;
begin
  if k < 1 or pg_catalog.array_length(p_sigma, 1) is distinct from k * k then
    raise exception 'mu must have K >= 1 entries and sigma be K x K' using errcode = '22023';
  end if;
  for ax in 1..k loop
    v_has := false;
    for i in 1..v_set.n loop
      if v_set.axis[i] = ax then v_has := true; exit; end if;
    end loop;
    if not v_has then continue; end if;
    v_ll := pg_catalog.array_fill(0::double precision, array[61]);
    for g in 1..61 loop
      for i in 1..v_set.n loop
        if v_set.axis[i] = ax then
          v_ll[g] := v_ll[g] + (select o.o_ll from hb.obs_terms(v_set.kind[i], v_grid[g], v_set.pa[i], v_set.pb[i], v_set.pc[i], v_set.py[i], v_set.ext, v_set.off[i], v_set.len[i], 1) o);
        end if;
      end loop;
    end loop;
    select * into v_e from hb.eap_from_ll(v_ll, p_mu[ax], p_sigma[(ax - 1) * k + ax]);
    axis := (hb.axis_codes())[ax];
    mean := v_e.o_mean;
    sd := v_e.o_sd;
    return next;
  end loop;
end
$$;

reset role;

-- -------------------------------------------------------------------------------------- the prior
-- Σ_init v2 (ROADMAP A8, engine/axes.ts initialSigma(), bank golden/sigma_v2.json) and the mean of the
-- population prior. Both are settings, so M4.8's re-estimate is a new row, not a new migration; a test
-- compares them with the app's. They are not secrets.
insert into public.app_config (key, value, description) values
  ('scoring.sigma_version', '"sigma-v2-2026-09-26"', 'version of the prior covariance below (engine/axes.ts SIGMA_VERSION); stored with a posterior so it can be re-scored'),
  ('scoring.sigma',
   '[[1,0.55,0.6,0.35,0.35,0.6,0.5,0.4,0.28,0.2,0.35,0.2,0.45,0.45,0.45,0.3,0.23],[0.55,1,0.55,0.6,0.35,0.35,0.35,0.4,0.28,0.2,0.35,0.2,0.45,0.45,0.45,0.3,0.23],[0.6,0.55,1,0.35,0.35,0.35,0.35,0.4,0.28,0.2,0.35,0.2,0.45,0.45,0.45,0.3,0.23],[0.35,0.6,0.35,1,0.6,0.35,0.35,0.35,0.2,0.3,0.35,0.2,0.35,0.6,0.35,0.3,0.23],[0.35,0.35,0.35,0.6,1,0.35,0.35,0.35,0.2,0.2,0.35,0.2,0.35,0.6,0.35,0.4,0.23],[0.6,0.35,0.35,0.35,0.35,1,0.35,0.35,0.2,0.2,0.4,0.2,0.35,0.35,0.35,0.3,0.23],[0.5,0.35,0.35,0.35,0.35,0.35,1,0.55,0.2,0.2,0.35,0.2,0.35,0.35,0.35,0.3,0.23],[0.4,0.4,0.4,0.35,0.35,0.35,0.55,1,0.2,0.2,0.35,0.2,0.35,0.35,0.35,0.3,0.23],[0.28,0.28,0.28,0.2,0.2,0.2,0.2,0.2,1,0.55,0.2,0.2,0.2,0.2,0.2,0.2,0.2],[0.2,0.2,0.2,0.3,0.2,0.2,0.2,0.2,0.55,1,0.2,0.2,0.2,0.2,0.2,0.2,0.2],[0.35,0.35,0.35,0.35,0.35,0.4,0.35,0.35,0.2,0.2,1,0.2,0.4,0.35,0.35,0.3,0.23],[0.2,0.2,0.2,0.2,0.2,0.2,0.2,0.2,0.2,0.2,0.2,1,0.2,0.2,0.2,0.2,0.2],[0.45,0.45,0.45,0.35,0.35,0.35,0.35,0.35,0.2,0.2,0.4,0.2,1,0.55,0.55,0.3,0.23],[0.45,0.45,0.45,0.6,0.6,0.35,0.35,0.35,0.2,0.2,0.35,0.2,0.55,1,0.55,0.4,0.23],[0.45,0.45,0.45,0.35,0.35,0.35,0.35,0.35,0.2,0.2,0.35,0.2,0.55,0.55,1,0.3,0.23],[0.3,0.3,0.3,0.3,0.4,0.3,0.3,0.3,0.2,0.2,0.3,0.2,0.3,0.4,0.3,1,0.55],[0.23,0.23,0.23,0.23,0.23,0.23,0.23,0.23,0.2,0.2,0.23,0.2,0.23,0.23,0.23,0.55,1]]',
   'prior covariance (correlation) of the 17 axes in axis order, sigma-v2 (ROADMAP A8); the prior mean is 0 on every axis');

set local role hb_definer;

-- The prior as flat arrays for hb.map_theta: μ = 0, Σ from the setting above.
create function hb.sigma_init()
returns double precision[]
language sql stable
set search_path = ''
as $$
  select pg_catalog.array_agg(v.value::double precision order by r.ord, v.ord)
    from public.app_config c,
         lateral pg_catalog.jsonb_array_elements(c.value) with ordinality r (value, ord),
         lateral pg_catalog.jsonb_array_elements_text(r.value) with ordinality v (value, ord)
   where c.key = 'scoring.sigma'
$$;

create function hb.mu_init()
returns double precision[]
language sql immutable parallel safe
set search_path = ''
as $$ select pg_catalog.array_fill(0::double precision, array[17]) $$;

reset role;
