-- M2.2 (ROADMAP M2.2; DESIGN §7.2, §11.2, §13, R-11.1, R-12.1; ROADMAP A2, A9, A21): what a session
-- keeps while it runs and what it computes when it ends, built on the scoring core of the previous
-- migration. All of it is server-side: nothing here is returned to a client (see supabase/README.md,
-- "Scoring and selection (M2.2)").
--
--   in-session EAP   sessions.state.eap[axis] = {n, ll}: the log-likelihood of the session's scored answers
--                    on the 61-point grid (DESIGN §11.2 "a per-session, per-axis EAP on a 61-point grid,
--                    stored in sessions.state"). submit adds one answer to it (hb.eap_add_response); the
--                    selector reads the posterior mean and sd from it (hb.session_posteriors). The
--                    posterior is the grid EAP under the population prior of one axis, N(0, 1) (A21).
--   the MAP          at finish: the correlated MAP and Laplace covariance of the session's answers under
--                    Σ_init (hb.session_posterior), stored in sessions.state.posterior. NOT returned: the
--                    person's scores come from rescore(), which withholds and rounds what would read out a
--                    single answer (R-11.1, owner decision 2026-10-01).
--   the evidence     at finish: the §13 checks the server can make from its own rows (hb.integrity_evidence):
--                    too-fast correct answers by the server clock, uniform response times, accuracy on hard
--                    items, and person fit lz*; stored in sessions.state.integrity, merged with what the
--                    client reported by hb.is_eligible into sessions.calibration_eligible.
--   blind eligibility  hb.is_eligible(session, true): the same count WITHOUT the checks that read the key
--                    (a correct and fast answer, hard-item accuracy, person fit). A fast answer counts
--                    whether it was right or not. It depends on times and on what the client reported,
--                    never on which answers were right, and it is the only eligibility rescore() reads.
--
-- Which answers count: the ones rescore() counts (hb.session_obs): not pretest (zero weight until the item is
-- calibrated, DESIGN §6.iii), not on a quarantined item, with a scored 0/1, an item parameter row of a
-- dichotomous model (2PL, 2PL-testlet scored as a 2PL as the app does, 3PL) and an answer inside the item's
-- answer space (hb.response_fits). Blocks (GRM, Gaussian) are not scored on the server.
--
-- The checks of §13 run on the server so that a client cannot omit them, but their outcome is a function of
-- which answers were right: it is stored and used for the calibration, never shown (not in finish, not in the
-- session's flags). rescore() must not use it, because a score reply that differs with eligibility would be
-- a reply that differs with one answer's verdict: it reads the blind eligibility (above) only, in which a
-- session is dropped for what the script chose (its times, its flags) and not for what it got right.

insert into public.app_config (key, value, description) values
  ('integrity.too_fast_ratio',         '0.25', 'DESIGN §13: a correct answer in less than this fraction of the item''s median time is too fast (engine/integrity.ts TOO_FAST_RATIO); the time is the server''s clock'),
  ('integrity.too_fast_min_median_s',  '20',   'DESIGN §13: the too-fast check applies to items whose median time is above this many seconds'),
  ('integrity.uniform_rt_max_sd',      '0.1',  'DESIGN §13: the sd of ln(time) below this is implausibly uniform (UNIFORM_RT_MAX_SD)'),
  ('integrity.uniform_rt_min_ratio',   '2',    'the uniform-time check applies when the items'' expected times span at least this ratio (UNIFORM_RT_MIN_TIME_RATIO)'),
  ('integrity.uniform_rt_min_items',   '5',    'and at least this many timed items (UNIFORM_RT_MIN_ITEMS)'),
  ('integrity.hard_item_margin',       '1.5',  'DESIGN §13: an item is hard when b > theta + this (HARD_ITEM_MARGIN)'),
  ('integrity.hard_item_alpha',        '0.01', 'level of the exact test on accuracy on hard items (HARD_ITEM_ALPHA)'),
  ('integrity.lz_star_max',            '-2',   'DESIGN §13: person fit lz* below this is flagged (LZ_STAR_MAX)'),
  ('integrity.lz_star_min_items',      '20',   'person fit needs at least this many scored 2PL/3PL answers (LZ_STAR_MIN_ITEMS)'),
  ('integrity.person_fit_prior_sd',    '3',    'sd of the weak prior N(0, sd^2) behind the per-axis modal theta of lz* and the hard-item test (PERSON_FIT_PRIOR_SD)');

set local role hb_definer;

-- ------------------------------------------------------------------------------- item times
-- E[T] of DESIGN §7.4 in seconds: the norms median when the calibration has one (item_parameters.extra
-- median_time_s, M4), else the bank's expected_time_s, else the length-based prior "25 s + 4 s per 50
-- words" of the stem. p_extra is item_parameters.extra, p_payload items.payload.
create function hb.item_expected_time_s(p_extra jsonb, p_payload jsonb)
returns double precision
language sql immutable parallel safe
set search_path = ''
as $$
  select coalesce(
    case when pg_catalog.jsonb_typeof(p_extra -> 'expected_time_s') = 'number' and (p_extra ->> 'expected_time_s')::double precision > 0
         then (p_extra ->> 'expected_time_s')::double precision end,
    25::double precision + 4::double precision * (
      case when pg_catalog.btrim(coalesce(p_payload ->> 'stem', '')) = '' then 0
           else pg_catalog.array_length(pg_catalog.regexp_split_to_array(pg_catalog.btrim(p_payload ->> 'stem'), '\s+'), 1) end) / 50.0)
$$;

-- The length-based prior alone: 25 s + 4 s per 50 words of the stem (DESIGN §7.4).
create function hb.item_prior_time_s(p_payload jsonb)
returns double precision
language sql immutable parallel safe
set search_path = ''
as $$
  select 25::double precision + 4::double precision * (
    case when pg_catalog.btrim(coalesce(p_payload ->> 'stem', '')) = '' then 0
         else pg_catalog.array_length(pg_catalog.regexp_split_to_array(pg_catalog.btrim(p_payload ->> 'stem'), '\s+'), 1) end) / 50.0
$$;

-- The median the too-fast check and the selector use: the norms median when there is one.
create function hb.item_median_time_s(p_extra jsonb, p_payload jsonb)
returns double precision
language sql immutable parallel safe
set search_path = ''
as $$
  select coalesce(
    case when pg_catalog.jsonb_typeof(p_extra -> 'median_time_s') = 'number' and (p_extra ->> 'median_time_s')::double precision > 0
         then (p_extra ->> 'median_time_s')::double precision end,
    hb.item_expected_time_s(p_extra, p_payload))
$$;

-- --------------------------------------------------------------------------- in-session EAP
-- {mean, sd, n} of one axis from the grid log-likelihood in the session state. An axis with no scored answer
-- has its prior, N(mean, var) exactly, as the app's selector uses it (selector.ts sessionPosterior: the
-- marginal prior for an axis without observations), not the grid's rounding of it.
create function hb.session_axis_post(p_state jsonb, p_axis text, out o_mean double precision, out o_sd double precision, out o_n int)
language plpgsql immutable parallel safe
set search_path = ''
as $$
declare
  v_ll double precision[];
  v_e record;
  v_node jsonb := p_state #> array['eap', p_axis];
begin
  o_n := 0;
  if pg_catalog.jsonb_typeof(v_node -> 'll') = 'array' then
    v_ll := array(select x::double precision from pg_catalog.jsonb_array_elements_text(v_node -> 'll') x);
    o_n := coalesce((v_node ->> 'n')::int, 0);
  end if;
  if o_n = 0 then
    o_mean := hb.axis_prior_mean(p_axis);
    o_sd := pg_catalog.sqrt(hb.axis_prior_var(p_axis));
    return;
  end if;
  select * into v_e from hb.eap_from_ll(v_ll, hb.axis_prior_mean(p_axis), hb.axis_prior_var(p_axis));
  o_mean := v_e.o_mean;
  o_sd := v_e.o_sd;
end
$$;

-- Every axis's posterior for the selector, in axis order.
create function hb.session_posteriors(p_state jsonb)
returns table (axis text, mean double precision, sd double precision, n int)
language plpgsql immutable parallel safe
set search_path = ''
as $$
declare
  v_codes text[] := hb.axis_codes();
  v_p record;
begin
  for i in 1..pg_catalog.array_length(v_codes, 1) loop
    select * into v_p from hb.session_axis_post(p_state, v_codes[i]);
    axis := v_codes[i];
    mean := v_p.o_mean;
    sd := v_p.o_sd;
    n := v_p.o_n;
    return next;
  end loop;
end
$$;

-- The session state with one more scored answer in the EAP of its axis. Unchanged (the same state back)
-- for a pretest answer, an unscored one, an item without a dichotomous parameter row, a quarantined item
-- and an answer outside the item's answer space: the answers that no score counts (see the header).
create function hb.eap_add_response(p_s public.sessions, p_item_id text, p_response jsonb, p_correct smallint, p_pretest boolean)
returns jsonb
language plpgsql stable
set search_path = ''
as $$
declare
  v record;
  v_new double precision[];
  v_old double precision[];
  v_n int := 0;
  v_state jsonb := coalesce(p_s.state, '{}'::jsonb);
begin
  if p_pretest or p_correct is null then
    return p_s.state;
  end if;
  select f.axis, i.status, p.model, p.a, p.b, p.c, ik.key,
         pg_catalog.jsonb_array_length(case when pg_catalog.jsonb_typeof(i.payload -> 'options') = 'array' then i.payload -> 'options' else '[]'::jsonb end) as n_opt
    into v
    from public.items i
    join public.item_families f on f.family_id = i.family_id
    join public.item_keys ik on ik.item_id = i.item_id
    join lateral (
      select ip.model, ip.a, ip.b, ip.c
        from public.item_parameters ip
       where ip.item_id = i.item_id and (p_s.param_version is null or ip.param_version = p_s.param_version)
       order by ip.created_at desc
       limit 1) p on true
   where i.item_id = p_item_id;
  if not found or v.status = 'quarantined' or v.model not in ('2pl', '2pl_testlet', '3pl') or v.a is null or v.b is null then
    return p_s.state;
  end if;
  if v.model = '3pl' and (v.c is null or not (v.c > 0 and v.c < 1)) then
    return p_s.state;
  end if;
  if not hb.response_fits(v.key, v.n_opt, p_response) then
    return p_s.state;
  end if;

  v_new := hb.grid_ll(case when v.model = '3pl' then 2 else 1 end, v.a, v.b, coalesce(v.c, 0.5), p_correct::double precision);
  if pg_catalog.jsonb_typeof(v_state #> array['eap', v.axis, 'll']) = 'array' then
    v_old := array(select x::double precision from pg_catalog.jsonb_array_elements_text(v_state #> array['eap', v.axis, 'll']) x);
    v_n := coalesce((v_state #>> array['eap', v.axis, 'n'])::int, 0);
    for i in 1..61 loop
      v_new[i] := v_new[i] + v_old[i];
    end loop;
  end if;
  v_state := pg_catalog.jsonb_set(v_state, '{eap}', coalesce(v_state -> 'eap', '{}'::jsonb), true);
  return pg_catalog.jsonb_set(v_state, array['eap', v.axis], pg_catalog.jsonb_build_object('n', v_n + 1, 'll', pg_catalog.to_jsonb(v_new)), true);
end
$$;

-- What a finished session keeps of its EAP: {axis: {n, mean, sd}}, not the grids (17 axes of 61 numbers
-- are 20 kB a session; the summary is a tenth of a kilobyte).
create function hb.eap_summary(p_state jsonb)
returns jsonb
language plpgsql immutable
set search_path = ''
as $$
declare
  v_out jsonb := '{}'::jsonb;
  v_axis text;
  v_p record;
begin
  if pg_catalog.jsonb_typeof(p_state -> 'eap') is distinct from 'object' then
    return v_out;
  end if;
  for v_axis in select k from pg_catalog.jsonb_object_keys(p_state -> 'eap') k loop
    select * into v_p from hb.session_axis_post(p_state, v_axis);
    v_out := v_out || pg_catalog.jsonb_build_object(v_axis, pg_catalog.jsonb_build_object('n', v_p.o_n, 'mean', pg_catalog.round(v_p.o_mean::numeric, 6), 'sd', pg_catalog.round(v_p.o_sd::numeric, 6)));
  end loop;
  return v_out;
end
$$;

-- ------------------------------------------------------------------ the session's observations
-- The answers of a session that count, as the observation list of hb.map_theta (see the header), in the
-- order they were given. Also the input of the integrity evidence below.
create function hb.session_obs(p_session_id text)
returns jsonb
language sql stable
set search_path = ''
as $$
  select coalesce(pg_catalog.jsonb_agg(
           case when p.model = '3pl'
                then pg_catalog.jsonb_build_object('kind', '3pl', 'axis', f.axis, 'a', p.a, 'b', p.b, 'c', p.c, 'y', r.correct)
                else pg_catalog.jsonb_build_object('kind', '2pl', 'axis', f.axis, 'a', p.a, 'b', p.b, 'y', r.correct) end
           order by r.seq), '[]'::jsonb)
    from public.sessions s
    join public.responses r on r.session_id = s.session_id
    join public.items i on i.item_id = r.item_id
    join public.item_families f on f.family_id = i.family_id
    join public.item_keys ik on ik.item_id = i.item_id
    join lateral (
      select ip.model, ip.a, ip.b, ip.c
        from public.item_parameters ip
       where ip.item_id = i.item_id and (s.param_version is null or ip.param_version = s.param_version)
       order by ip.created_at desc
       limit 1) p on true
   where s.session_id = p_session_id
     and not r.pretest
     and r.correct is not null
     and i.status <> 'quarantined'
     and p.model in ('2pl', '2pl_testlet', '3pl')
     and p.a is not null and p.b is not null
     and (p.model <> '3pl' or (p.c is not null and p.c > 0 and p.c < 1))
     and hb.response_fits(ik.key, pg_catalog.jsonb_array_length(case when pg_catalog.jsonb_typeof(i.payload -> 'options') = 'array' then i.payload -> 'options' else '[]'::jsonb end), r.response)
$$;

-- The correlated MAP and Laplace covariance of the session under Σ_init, for sessions.state.posterior:
-- {v, sigma_version, param_version, n_obs, n_by_axis, theta (17), cov (17 x 17 flat), n_iter, log_posterior},
-- numbers rounded to 6 decimals (below any use of them; the golden parity is of hb.map_theta itself).
-- A session without a counted answer has n_obs 0 and nothing else. Never raises: a failure is recorded as
-- {v, error: <SQLSTATE>} so that finish still closes the session.
create function hb.session_posterior(p_session_id text)
returns jsonb
language plpgsql stable
set search_path = ''
as $$
declare
  v_obs jsonb := hb.session_obs(p_session_id);
  v_n int := pg_catalog.jsonb_array_length(v_obs);
  v_map record;
  v_by_axis jsonb;
begin
  if v_n = 0 then
    return pg_catalog.jsonb_build_object('v', 1, 'n_obs', 0);
  end if;
  select * into v_map from hb.map_theta(v_obs, hb.mu_init(), hb.sigma_init());
  select coalesce(pg_catalog.jsonb_object_agg(t.axis, t.n), '{}'::jsonb) into v_by_axis
    from (select e ->> 'axis' as axis, pg_catalog.count(*) as n from pg_catalog.jsonb_array_elements(v_obs) e group by 1) t;
  return pg_catalog.jsonb_build_object(
    'v', 1,
    'sigma_version', hb.cfg_text('scoring.sigma_version', null),
    'param_version', (select s.param_version from public.sessions s where s.session_id = p_session_id),
    'n_obs', v_n,
    'n_by_axis', v_by_axis,
    'theta', (select pg_catalog.jsonb_agg(pg_catalog.round(x::numeric, 6) order by o) from pg_catalog.unnest(v_map.o_theta) with ordinality t (x, o)),
    'cov', (select pg_catalog.jsonb_agg(pg_catalog.round(x::numeric, 6) order by o) from pg_catalog.unnest(v_map.o_cov) with ordinality t (x, o)),
    'n_iter', v_map.o_n_iter,
    'log_posterior', pg_catalog.round(v_map.o_lp::numeric, 6));
exception when others then
  return pg_catalog.jsonb_build_object('v', 1, 'error', sqlstate);
end
$$;

-- ------------------------------------------------------------------------- person fit and tails
-- P(X >= x) for X = the number of successes among independent Bernoulli(p_i): the exact
-- Poisson-binomial tail by the O(n²) convolution (engine/integrity.ts poissonBinomialUpperTail). Mass
-- and probabilities below 1e-100 are dropped, which a product that underflows would raise on and which
-- changes the tail by less than 1e-98.
create function hb.pb_upper_tail(p_ps double precision[], p_x int)
returns double precision
language plpgsql immutable parallel safe
set search_path = ''
as $$
declare
  n int := coalesce(pg_catalog.array_length(p_ps, 1), 0);
  v_pmf double precision[] := array[1::double precision];
  v_next double precision[];
  v_tail double precision := 0;
begin
  if p_x <= 0 then return 1; end if;
  if p_x > n then return 0; end if;
  for i in 1..n loop
    v_next := pg_catalog.array_fill(0::double precision, array[i + 1]);
    for k in 1..i loop -- v_pmf[k] is P(X = k - 1) before item i
      if v_pmf[k] >= 1e-100::double precision then
        -- a factor below 1e-100 would multiply into an underflow; the term it makes is below 1e-100 too
        if 1 - p_ps[i] >= 1e-100::double precision then
          v_next[k] := v_next[k] + v_pmf[k] * (1 - p_ps[i]);
        end if;
        if p_ps[i] >= 1e-100::double precision then
          v_next[k + 1] := v_next[k + 1] + v_pmf[k] * p_ps[i];
        end if;
      end if;
    end loop;
    v_pmf := v_next;
  end loop;
  for k in reverse n..p_x loop
    v_tail := v_tail + v_pmf[k + 1];
  end loop;
  return least(1::double precision, v_tail);
end
$$;

-- Snijders' lz* and Drasgow's lz for 2PL/3PL answers at the per-axis estimates theta, with r0 the
-- estimator's term per axis (engine/integrity.ts lzStar; the notation is there). Axes are 1-based
-- indexes into theta and r0. o_lz_star is null where the corrected variance is zero to rounding.
create function hb.lz_star(
  p_axis int[], p_kind int[], p_a double precision[], p_b double precision[], p_c double precision[], p_y double precision[],
  p_theta double precision[], p_r0 double precision[],
  out o_lz_star double precision, out o_lz double precision)
language plpgsql immutable parallel safe
set search_path = ''
as $$
declare
  n int := coalesce(pg_catalog.array_length(p_axis, 1), 0);
  v_num double precision[] := pg_catalog.array_fill(0::double precision, array[17]);
  v_den double precision[] := pg_catalog.array_fill(0::double precision, array[17]);
  v_has boolean[] := pg_catalog.array_fill(false, array[17]);
  v_p double precision[] := pg_catalog.array_fill(0::double precision, array[n]);
  v_q double precision[] := pg_catalog.array_fill(0::double precision, array[n]);
  v_w double precision[] := pg_catalog.array_fill(0::double precision, array[n]);
  v_r double precision[] := pg_catalog.array_fill(0::double precision, array[n]);
  v_cc double precision[];
  v_t double precision;
  v_z double precision;
  v_s double precision;
  v_pq double precision;
  v_big_w double precision := 0;
  v_v0 double precision := 0;
  v_v double precision := 0;
  v_numerator double precision;
  v_wt double precision;
  v_t1 record;
  v_t0 record;
  k int;
begin
  for i in 1..n loop
    k := p_axis[i];
    v_t := p_theta[k];
    v_z := p_a[i] * (v_t - p_b[i]);
    if p_kind[i] = 1 then
      v_p[i] := hb.sigmoid(v_z);
      v_q[i] := hb.sigmoid(- v_z);
      v_w[i] := v_z;
      v_r[i] := p_a[i];
    else
      v_s := hb.sigmoid(v_z);
      v_p[i] := p_c[i] + (1 - p_c[i]) * v_s;
      v_q[i] := (1 - p_c[i]) * hb.sigmoid(- v_z);
      select o.o_ll into v_t1 from hb.obs_terms(2, v_t, p_a[i], p_b[i], p_c[i], 1, '{}'::double precision[], 0, 0, 1) o;
      select o.o_ll into v_t0 from hb.obs_terms(2, v_t, p_a[i], p_b[i], p_c[i], 0, '{}'::double precision[], 0, 0, 1) o;
      v_w[i] := v_t1.o_ll - v_t0.o_ll;
      v_r[i] := (p_a[i] * v_s) / v_p[i];
    end if;
    v_big_w := v_big_w + (case when p_y[i] = 1 then v_q[i] else - v_p[i] end) * v_w[i];
    v_pq := v_p[i] * v_q[i];
    v_has[k] := true;
    if v_pq >= 1e-100::double precision then -- below it the products underflow, and the terms are below 1e-90
      v_v0 := v_v0 + v_w[i] * v_w[i] * v_pq;
      v_num[k] := v_num[k] + v_r[i] * v_pq * v_w[i];
      v_den[k] := v_den[k] + v_r[i] * v_r[i] * v_pq;
    end if;
  end loop;
  v_cc := pg_catalog.array_fill(0::double precision, array[17]);
  v_numerator := v_big_w;
  for k2 in 1..17 loop
    v_cc[k2] := case when v_den[k2] > 0 then v_num[k2] / v_den[k2] else 0 end;
    if v_has[k2] then
      v_numerator := v_numerator + v_cc[k2] * p_r0[k2];
    end if;
  end loop;
  for i in 1..n loop
    v_pq := v_p[i] * v_q[i];
    if v_pq >= 1e-100::double precision then
      v_wt := v_w[i] - v_cc[p_axis[i]] * v_r[i];
      v_v := v_v + v_wt * v_wt * v_pq;
    end if;
  end loop;
  o_lz_star := case when v_v > 1e-10::double precision * v_v0 then v_numerator / pg_catalog.sqrt(v_v) else null end;
  o_lz := case when v_v0 > 0 then v_big_w / pg_catalog.sqrt(v_v0) else null end;
end
$$;

-- ---------------------------------------------------------------------------- the evidence
-- The §13 checks the server makes from its own rows, for a session (finished or not), as the jsonb that
-- finish stores in sessions.state.integrity. engine/integrity.ts is the reference; the differences:
--   * times are the server's clock (response created_at minus the item's served_at), not the client's
--     rt_ms: a client cannot make a session look slow. E[T] is hb.item_median_time_s (too fast) and
--     hb.item_expected_time_s (uniform times);
--   * the answers are those that count (the header): an answer outside the item's answer space is no
--     answer, in the fit statistics as in the score;
--   * visibility_hidden and paste cannot be seen by the server, only reported by the client.
--   * too_fast_any is the too-fast list WITHOUT the condition that the answer was right: the time check that does
--     not depend on the key, used by the blind eligibility (hb.is_eligible, p_blind). too_fast (the app's check)
--     keeps only the correct ones.
--   * the fit statistics (hard items, person fit) are computed in a block of their own: if they fail, the rest of
--     the evidence is kept and the failure is recorded as fit_error, so that a failure that depends on the
--     answers cannot change the blind eligibility.
-- {v, n_scored, too_fast: {n, items}, too_fast_any: {n, items}, uniform_rt: {applies, flagged, n_items, time_ratio,
--  sd_log_rt}, hard_item_accuracy: {flagged, n_hard, n_correct, p_value}, person_fit: {flagged, n_items, lz_star, lz},
--  fit_error?: <SQLSTATE>}
create function hb.integrity_evidence(p_session_id text)
returns jsonb
language plpgsql stable
set search_path = ''
as $$
declare
  c_ratio constant double precision := hb.cfg_num('integrity.too_fast_ratio', 0.25);
  c_min_median constant double precision := hb.cfg_num('integrity.too_fast_min_median_s', 20);
  c_uni_sd constant double precision := hb.cfg_num('integrity.uniform_rt_max_sd', 0.1);
  c_uni_ratio constant double precision := hb.cfg_num('integrity.uniform_rt_min_ratio', 2);
  c_uni_items constant int := hb.cfg_int('integrity.uniform_rt_min_items', 5);
  c_margin constant double precision := hb.cfg_num('integrity.hard_item_margin', 1.5);
  c_alpha constant double precision := hb.cfg_num('integrity.hard_item_alpha', 0.01);
  c_lz_max constant double precision := hb.cfg_num('integrity.lz_star_max', -2);
  c_lz_items constant int := hb.cfg_int('integrity.lz_star_min_items', 20);
  c_prior_sd constant double precision := hb.cfg_num('integrity.person_fit_prior_sd', 3);
  s public.sessions;
  r record;
  v_param text;
  -- scored answers (dichotomous, counted)
  v_ids text[] := '{}';
  v_axis int[] := '{}';
  v_kind int[] := '{}';
  v_a double precision[] := '{}';
  v_b double precision[] := '{}';
  v_c double precision[] := '{}';
  v_y double precision[] := '{}';
  v_obs jsonb := '[]'::jsonb;
  v_n int := 0;
  -- too fast (the app's check: correct answers only) and too fast whatever the answer was (the blind check)
  v_fast_ids text[] := '{}';
  v_fast_any_ids text[] := '{}';
  v_fit_error text;
  -- uniform times over every non-pretest answer
  v_logs double precision[] := '{}';
  v_et_min double precision;
  v_et_max double precision;
  v_timed int := 0;
  v_mean double precision;
  v_ss double precision := 0;
  v_sd double precision;
  v_applies boolean;
  v_ratio double precision;
  -- person fit and hard items
  v_map record;
  v_theta double precision[];
  v_r0 double precision[] := pg_catalog.array_fill(0::double precision, array[17]);
  v_lz_star double precision;
  v_lz_val double precision;
  v_ps double precision[] := '{}';
  v_n_hard int := 0;
  v_n_correct int := 0;
  v_p_value double precision := 1;
  v_t double precision;
  v_z double precision;
  v_sig double precision[];
  v_mu double precision[];
  v_fit_flag boolean := false;
  v_hard_flag boolean := false;
  v_et double precision;
begin
  select * into s from public.sessions x where x.session_id = p_session_id;
  if not found then
    return null;
  end if;
  v_param := s.param_version;

  for r in
    select rs.seq, rs.item_id, rs.correct, rs.response,
           greatest(extract(epoch from rs.created_at - e.served_at)::double precision, 0::double precision) as elapsed_s,
           f.axis, i.status, i.payload, p.model, p.a, p.b, p.c, p.extra, ik.key
      from public.responses rs
      join public.exposure_log e on e.session_id = rs.session_id and e.seq = rs.seq
      join public.items i on i.item_id = rs.item_id
      join public.item_families f on f.family_id = i.family_id
      left join public.item_keys ik on ik.item_id = rs.item_id
      left join lateral (
        select ip.model, ip.a, ip.b, ip.c, ip.extra
          from public.item_parameters ip
         where ip.item_id = i.item_id and (v_param is null or ip.param_version = v_param)
         order by ip.created_at desc
         limit 1) p on true
     where rs.session_id = p_session_id and not rs.pretest
     order by rs.seq
  loop
    -- uniform times: every answer with a time
    if r.elapsed_s > 0 then
      v_timed := v_timed + 1;
      v_logs := v_logs || pg_catalog.ln(r.elapsed_s * 1000)::double precision;
      v_et := hb.item_expected_time_s(r.extra, r.payload);
      v_et_min := least(coalesce(v_et_min, v_et), v_et);
      v_et_max := greatest(coalesce(v_et_max, v_et), v_et);
    end if;
    -- the rest is about answers that count
    if r.correct is null or r.status = 'quarantined' or r.model is null or r.model not in ('2pl', '2pl_testlet', '3pl') or r.a is null or r.b is null
       or (r.model = '3pl' and (r.c is null or not (r.c > 0 and r.c < 1)))
       or not hb.response_fits(r.key, pg_catalog.jsonb_array_length(case when pg_catalog.jsonb_typeof(r.payload -> 'options') = 'array' then r.payload -> 'options' else '[]'::jsonb end), r.response) then
      continue;
    end if;
    v_n := v_n + 1;
    v_ids := v_ids || r.item_id;
    v_axis := v_axis || hb.axis_index(r.axis);
    v_kind := v_kind || (case when r.model = '3pl' then 2 else 1 end);
    v_a := v_a || r.a;
    v_b := v_b || r.b;
    v_c := v_c || coalesce(r.c, 0.5);
    v_y := v_y || r.correct::double precision;
    v_obs := v_obs || pg_catalog.jsonb_build_array(case when r.model = '3pl'
      then pg_catalog.jsonb_build_object('kind', '3pl', 'axis', r.axis, 'a', r.a, 'b', r.b, 'c', r.c, 'y', r.correct)
      else pg_catalog.jsonb_build_object('kind', '2pl', 'axis', r.axis, 'a', r.a, 'b', r.b, 'y', r.correct) end);
    -- too fast: an answer under a quarter of the median, on an item whose median is over 20 s; the app's check
    -- keeps the correct ones, the blind list (too_fast_any) every one
    v_et := hb.item_median_time_s(r.extra, r.payload);
    if v_et > c_min_median and r.elapsed_s < c_ratio * v_et then
      v_fast_any_ids := v_fast_any_ids || r.item_id;
      if r.correct = 1 then
        v_fast_ids := v_fast_ids || r.item_id;
      end if;
    end if;
  end loop;

  -- uniform times
  v_ratio := case when v_timed > 0 then v_et_max / v_et_min end;
  if v_timed >= 2 then
    select pg_catalog.avg(x) into v_mean from pg_catalog.unnest(v_logs) x;
    select pg_catalog.sum((x - v_mean) * (x - v_mean)) into v_ss from pg_catalog.unnest(v_logs) x;
    v_sd := pg_catalog.sqrt(v_ss / (v_timed - 1));
  end if;
  v_applies := v_timed >= c_uni_items and v_ratio is not null and v_ratio >= c_uni_ratio;

  -- person fit and hard items, at the per-axis Bayes modal theta under a weak prior
  if v_n > 0 then
    begin
      v_mu := pg_catalog.array_fill(0::double precision, array[17]);
      v_sig := pg_catalog.array_fill(0::double precision, array[289]);
      for k in 1..17 loop
        v_sig[(k - 1) * 17 + k] := c_prior_sd * c_prior_sd;
        v_r0[k] := 0;
      end loop;
      select * into v_map from hb.map_theta(v_obs, v_mu, v_sig);
      v_theta := v_map.o_theta;
      for k in 1..17 loop
        v_r0[k] := - v_theta[k] / (c_prior_sd * c_prior_sd);
      end loop;
      select o.o_lz_star, o.o_lz into v_lz_star, v_lz_val from hb.lz_star(v_axis, v_kind, v_a, v_b, v_c, v_y, v_theta, v_r0) o;
      v_fit_flag := v_n >= c_lz_items and v_lz_star is not null and v_lz_star < c_lz_max;

      for i in 1..v_n loop
        v_t := v_theta[v_axis[i]];
        if v_b[i] > v_t + c_margin then
          v_z := v_a[i] * (v_t - v_b[i]);
          v_ps := v_ps || (case when v_kind[i] = 2 then v_c[i] + (1 - v_c[i]) * hb.sigmoid(v_z) else hb.sigmoid(v_z) end);
          v_n_hard := v_n_hard + 1;
          v_n_correct := v_n_correct + v_y[i]::int;
        end if;
      end loop;
      if v_n_hard > 0 then
        v_p_value := hb.pb_upper_tail(v_ps, v_n_correct);
      end if;
      v_hard_flag := v_p_value < c_alpha;
    exception when others then
      -- the blind part of the evidence stays; the eligibility that reads the fit takes this as "could not be computed"
      v_fit_error := sqlstate;
      v_fit_flag := false;
      v_hard_flag := false;
      v_n_hard := 0;
      v_n_correct := 0;
      v_p_value := 1;
      v_lz_star := null;
      v_lz_val := null;
    end;
  end if;

  return pg_catalog.jsonb_build_object(
    'v', 1,
    'n_scored', v_n,
    'too_fast', pg_catalog.jsonb_build_object('n', pg_catalog.cardinality(v_fast_ids), 'items', pg_catalog.to_jsonb(v_fast_ids)),
    'too_fast_any', pg_catalog.jsonb_build_object('n', pg_catalog.cardinality(v_fast_any_ids), 'items', pg_catalog.to_jsonb(v_fast_any_ids)),
    'uniform_rt', pg_catalog.jsonb_build_object('applies', v_applies, 'flagged', v_applies and v_sd is not null and v_sd < c_uni_sd,
                    'n_items', v_timed, 'time_ratio', v_ratio, 'sd_log_rt', v_sd),
    'hard_item_accuracy', pg_catalog.jsonb_build_object('flagged', v_hard_flag, 'n_hard', v_n_hard, 'n_correct', v_n_correct, 'p_value', v_p_value),
    'person_fit', pg_catalog.jsonb_build_object('flagged', v_fit_flag, 'n_items', v_n, 'lz_star', v_lz_star, 'lz', v_lz_val))
    || (case when v_fit_error is null then '{}'::jsonb else pg_catalog.jsonb_build_object('fit_error', v_fit_error) end);
end
$$;

-- The evidence for sessions.state.integrity; never raises (a failure is recorded as {v, error: <SQLSTATE>}, which
-- hb.is_eligible reads as "not eligible", so that finish still closes the session).
create function hb.session_integrity(p_session_id text)
returns jsonb
language plpgsql stable
set search_path = ''
as $$
begin
  return coalesce(hb.integrity_evidence(p_session_id), '{}'::jsonb);
exception when others then
  return pg_catalog.jsonb_build_object('v', 1, 'error', sqlstate);
end
$$;

-- ----------------------------------------------------------------------- calibration eligibility
-- DESIGN §13: a session is calibration-eligible unless the flags count to 2 or more, or person fit is
-- flagged. The flags are counted as the app counts them (engine/integrity.ts calibrationEligible): one per
-- flagged response for each of visibility_hidden, paste and too_fast, plus one for each of the session-level
-- uniform_rt and hard_item_accuracy. A flag counts if the client reported it OR the server's evidence
-- (sessions.state.integrity, written by finish) raised it, once. Not eligible either: a session that is not
-- finished or has no answer; one whose time, by the server clock, averaged under session.min_avg_ms
-- (server_too_fast); one whose client reported person misfit. The client's own verdict
-- ("calibration_eligible: true" in its flags) is not taken.
--
-- p_blind (default false) is the eligibility that rescore() reads (R-11.1; owner decision 2026-10-01: rescore
-- must not leak single-answer verdicts). The full eligibility is a function of which answers were right: a
-- correct answer under a quarter of the median is a flag and a wrong one is not, and person fit and
-- accuracy on hard items read the key. A script that controls every other flag (paste: true on one answer)
-- and puts one fast answer in a session therefore gets "eligible" exactly when that answer was wrong, and
-- would read it out of anything that differs with the eligibility, such as which sessions a score includes.
-- The blind count leaves out what reads the key and takes the rest as it is:
--   * too fast: an answer under a quarter of the median counts whether it was right or not
--     (evidence too_fast_any; the client's own too_fast flag as before);
--   * person fit and accuracy on hard items: the server's evidence is not read, only the client's report
--     of the flag (the client chooses it, so the report is not a function of the answers);
--   * everything else is as above (times, client flags, server_too_fast, uniform_rt).
-- A failure to compute the fit statistics (evidence.fit_error) does not touch the blind result. It is a
-- weaker integrity check than the full one, by design: it is what a score may depend on. The calibration
-- (A16) reads the full one, calibration_eligible.
create function hb.is_eligible(p_session_id text, p_blind boolean default false)
returns boolean
language plpgsql stable
set search_path = ''
as $$
declare
  s public.sessions;
  v_ev jsonb;
  v_fast text[];
  v_count int;
  v_path text[] := case when p_blind then array['too_fast_any', 'items'] else array['too_fast', 'items'] end;
begin
  select * into s from public.sessions x where x.session_id = p_session_id;
  if not found or s.finished_at is null or s.n_answered < 1 then
    return false;
  end if;
  v_ev := coalesce(s.state -> 'integrity', '{}'::jsonb);
  if v_ev ? 'error' or (not p_blind and v_ev ? 'fit_error') then
    return false; -- the evidence could not be computed: the session does not enter a calibration
  end if;
  if hb.truthy(s.flags -> 'server_too_fast') or hb.truthy(s.flags -> 'person_fit')
     or (not p_blind and hb.truthy(v_ev #> '{person_fit,flagged}')) then
    return false;
  end if;
  v_fast := array(
    select x from pg_catalog.jsonb_array_elements_text(
      case when pg_catalog.jsonb_typeof(v_ev #> v_path) = 'array' then v_ev #> v_path else '[]'::jsonb end) x);
  select coalesce(pg_catalog.sum(
           (case when hb.truthy(r.client_flags -> 'visibility_hidden') then 1 else 0 end)
         + (case when hb.truthy(r.client_flags -> 'paste') then 1 else 0 end)
         + (case when hb.truthy(r.client_flags -> 'too_fast') or r.item_id = any (v_fast) then 1 else 0 end)), 0)
    into v_count
    from public.responses r
   where r.session_id = p_session_id;
  v_count := v_count
    + (case when hb.truthy(s.flags -> 'uniform_rt') or hb.truthy(v_ev #> '{uniform_rt,flagged}') then 1 else 0 end)
    + (case when hb.truthy(s.flags -> 'hard_item_accuracy') or (not p_blind and hb.truthy(v_ev #> '{hard_item_accuracy,flagged}')) then 1 else 0 end);
  return v_count < 2;
end
$$;

reset role;
