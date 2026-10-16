-- M2.2 (ROADMAP M2.2, A9, A24-sec; DESIGN §3 "Initial Σ", §7.4 "Cross-skill aim", §7.8, §11.2, R-7.4, R-11.1; owner request
-- 2026-10-15): the cross-skill start of a part. The same aim as the app's selector (web/src/engine/xskill.ts,
-- web/src/engine/selector.ts selectionAim), which web/scripts/db/xskill.db.test.ts holds this file to on the same answers.
--
-- WHY. The owner: "a user does very well on the quantitative series of questions, so when we shift over to science or
-- logic or other similar families of questions, we start at a higher difficulty level. if they get it wrong, of course
-- the adaptive nature drops the difficulty down from there. but not every test taker needs to start every family of
-- questions at the same difficulty level." Until now hb.session_aims (20261014000100_startup_step.sql) aimed each axis
-- at the EAP of its OWN answers, and an axis with none at its prior mean, 0: the per-axis EAP ignores the other axes by
-- design (§11.2), and nothing else in selection read Sigma. The owner, near-perfect on every part, began every part at
-- stratum 2 to 3 (the items nearest 0; the criterion's division by time prefers the quicker, easier one). A returning
-- person also began every part at 0: a session's state starts empty, whatever the person did before.
--
-- THE AIM (hb.session_aims, re-created; selection only). Each axis is aimed at the EAP of its own answers under the
-- CONDITIONAL prior of the axis given the answers on every other axis, through the selection prior
-- Sigma_sel = f^2 R(s): the scoring Sigma (app_config scoring.sigma, hb.sigma_init) with its correlations multiplied by
-- selection.borrow_strength s (0.75, chosen by simulation: engine/xskill.ts XSKILL_BORROW), on the diagonal the own-axis prior variance (hb.axis_prior_var), and the whole widened
-- by f = selection.aim_prior_sd_factor (2, the wider aim of 20261014000100). In three steps:
--   1. every other axis j with answers sends a Gaussian message: the grid posterior of its answers under
--      N(mu_j, Sigma_sel_jj) has mean m and variance v, the prior alone on the same grid m0 and v0; the prior divided out
--      leaves precision lam = 1/v - 1/v0 and location x = (m/v - m0/v0)/lam (an axis with lam <= 1e-9 sends none);
--   2. the conditional prior of axis k is the Gaussian regression on them: mean mu_k + S_kJ (S_JJ + diag(1/lam))^-1 (x - mu)_J,
--      variance S_kk - S_kJ (S_JJ + diag(1/lam))^-1 S_Jk (never below 1e-9 S_kk);
--   3. the aim is the grid EAP of the axis's own answers under it, or its mean when the axis has none.
-- So a part's first item is aimed where the rest of the session says the skill is likely to be, and the axis's own
-- answers take over as they come. The start-up step of 20261014000100 is untouched: it steps from the first item's b,
-- so a miss there drops a stratum at once. With s = 0, or with no answer on another axis, the aim is exactly that of
-- 20261014000100.
--
-- RETURNING PEOPLE (start_session, re-created with one change; hb.prior_state). A new session's state also holds
-- `prior` (only when there is something in it): what the selection.prior_sessions (10) most recent sessions of the
-- anon_ids the save proves (hb.save_proved_anons, the ids whose served items the seen lists already keep out) say of
-- each axis, read from those sessions' own state.eap (the {n, mean, sd} that finish keeps there, or the grid of a
-- session never finished; the nightly compaction archives the answers, not the state). Per session and axis that is
-- one Gaussian term, what the session's posterior says beyond the prior, as the app reads an earlier session
-- (engine/xskill.ts sessionEvidence); their sum is one Gaussian, kept as {n, lam, x} an axis (a few numbers, not a
-- grid). hb.session_aims adds -lam (x - t)^2 / 2 to the axis's grid: the earlier sessions are evidence for the aim,
-- nothing else. A file that proves no id has none; a stranger's file proves nothing.
--
-- WHAT IS NOT CHANGED. Every score: hb.session_axis_post, hb.session_posteriors (the criterion's variance, the per-axis
-- stop selection.stop_sd), finish and rescore read state.eap alone with the N(0, 1) per-axis prior, as before; `prior`
-- is read by hb.session_aims only. So a profile with peaks and dips is reported as it was measured, not pulled toward its
-- average. The exposure cap, the seen lists, family and sibling exclusion, sets, the coverage floor, the balancing and
-- the randomesque top k are where they were. hb.rank_live is re-created with one change: it passes its p_axes to
-- hb.session_aims, which then works out the aim of those axes only (one small Cholesky an axis asked for).
-- Sigma is read from app_config at every call, so when the nightly re-estimate of §3 writes a new scoring.sigma the
-- selection uses it at once.
--
-- TO SWITCH IT OFF: selection.borrow_strength = 0 (no borrowing across axes) and selection.prior_sessions = 0 (no
-- earlier sessions).
--
-- WHAT A CLIENT CAN LEARN (ROADMAP A24-sec, the accepted adaptive channel). Which item comes next already depended on
-- the answers so far; it now depends on them across parts too, and on the person's earlier sessions (whose scores
-- rescore publishes, rounded). Nothing new is put in a reply; the bounds of A24-sec are the ones in force.

insert into public.app_config (key, value, description) values
  ('selection.borrow_strength', '0.75', 'engine/xskill.ts XSKILL_BORROW: the correlations of Sigma used to aim a part''s items are this times the scoring ones (1: Sigma as it is; 0: each axis on its own answers, as before 2026-10-15); 0.75 by simulation (ROADMAP, owner decisions 2026-10-15)'),
  ('selection.prior_sessions',  '10', 'session/earlier.ts EARLIER_SESSIONS_MAX: a new session''s aim starts from what this many most recent sessions of the ids its save proves say of each axis; 0: none');

set local role hb_definer;

-- What the most recent selection.prior_sessions sessions of p_anon_ids say of each axis, for the aim (the header,
-- RETURNING PEOPLE): {"prior": {axis: {"n": answers, "lam": precision, "x": location}}}, or {} when they say nothing
-- (so a new session's state has the key only when it holds something). Each session is read as the app reads an
-- earlier session (engine/xskill.ts sessionEvidence, message): per axis its own posterior under the axis's prior
-- N(mu, var) (the {n, mean, sd} summary finish keeps in state.eap, or, for a session never finished, its grid there)
-- with the grid prior's own moments (m0, v0) divided out: lam = 1/sd^2 - 1/v0, x = (mean/sd^2 - m0/v0)/lam. The terms
-- of the sessions add up: lam = sum lam_i, x = sum lam_i x_i / lam.
create function hb.prior_state(p_anon_ids text[])
returns jsonb
language plpgsql stable
set search_path = ''
as $$
declare
  v_codes text[] := hb.axis_codes();
  v_acc jsonb := '{}'::jsonb;
  v_state jsonb;
  v_axis text;
  v_node jsonb;
  v_mean double precision;
  v_sd double precision;
  v_n int;
  v_lam double precision;
  v_x double precision;
  v_e record;
  v_e0 record;
  v_old jsonb;
  v_l0 double precision;
begin
  for v_state in
    select s.state
      from public.sessions s
     where s.anon_id = any (coalesce(p_anon_ids, '{}'::text[]))
       and pg_catalog.jsonb_typeof(s.state -> 'eap') = 'object'
     order by s.started_at desc, s.session_id
     limit greatest(hb.cfg_int('selection.prior_sessions', 10), 0)
  loop
    for v_axis, v_node in select e.key, e.value from pg_catalog.jsonb_each(v_state -> 'eap') e where e.key = any (v_codes) order by e.key loop
      v_n := case when pg_catalog.jsonb_typeof(v_node -> 'n') = 'number' then (v_node ->> 'n')::int else 0 end;
      continue when v_n <= 0;
      select * into v_e0 from hb.eap_from_ll(null, hb.axis_prior_mean(v_axis), hb.axis_prior_var(v_axis));
      if pg_catalog.jsonb_typeof(v_node -> 'll') = 'array' and pg_catalog.jsonb_array_length(v_node -> 'll') = 61 then
        -- a session that was never finished: its grid
        select * into v_e from hb.eap_from_ll(array(select x::double precision from pg_catalog.jsonb_array_elements_text(v_node -> 'll') x), hb.axis_prior_mean(v_axis), hb.axis_prior_var(v_axis));
        v_mean := v_e.o_mean;
        v_sd := v_e.o_sd;
      elsif pg_catalog.jsonb_typeof(v_node -> 'mean') = 'number' and pg_catalog.jsonb_typeof(v_node -> 'sd') = 'number' then
        -- a finished one: the summary finish kept
        v_mean := (v_node ->> 'mean')::double precision;
        v_sd := (v_node ->> 'sd')::double precision;
      else
        continue;
      end if;
      continue when not (v_sd > 0 and v_e0.o_sd > 0);
      v_lam := 1 / (v_sd * v_sd) - 1 / (v_e0.o_sd * v_e0.o_sd);
      continue when not (v_lam > 1e-9);
      v_x := (v_mean / (v_sd * v_sd) - v_e0.o_mean / (v_e0.o_sd * v_e0.o_sd)) / v_lam;
      v_old := v_acc -> v_axis;
      if v_old is not null then
        v_l0 := (v_old ->> 'lam')::double precision;
        v_x := (v_l0 * (v_old ->> 'x')::double precision + v_lam * v_x) / (v_l0 + v_lam);
        v_lam := v_l0 + v_lam;
        v_n := v_n + (v_old ->> 'n')::int;
      end if;
      v_acc := v_acc || pg_catalog.jsonb_build_object(v_axis, pg_catalog.jsonb_build_object('n', v_n, 'lam', v_lam, 'x', v_x));
    end loop;
  end loop;
  return case when v_acc = '{}'::jsonb then '{}'::jsonb else pg_catalog.jsonb_build_object('prior', v_acc) end;
end
$$;

-- Where each axis's items are aimed (the header, THE AIM): a row per axis asked for (every axis when p_axes is null), in
-- axis order. Replaces the one-argument hb.session_aims of 20261014000100_startup_step.sql; a call with the state alone
-- still answers for every axis.
drop function hb.session_aims(jsonb);

create function hb.session_aims(p_state jsonb, p_axes text[] default null)
returns table (axis text, aim double precision)
language plpgsql stable
set search_path = ''
as $$
declare
  v_codes text[] := hb.axis_codes();
  v_grid double precision[] := hb.eap_grid();
  k int := pg_catalog.array_length(v_codes, 1);
  v_f2 double precision := greatest(hb.cfg_num('selection.aim_prior_sd_factor', 2), 1e-6::double precision) ^ 2;
  v_s double precision := least(greatest(hb.cfg_num('selection.borrow_strength', 0.75), 0::double precision), 1::double precision);
  v_sig double precision[] := hb.sigma_init();
  v_state jsonb := coalesce(p_state, '{}'::jsonb);
  v_mu double precision[];
  v_var double precision[];
  v_cov double precision[];
  v_ll double precision[];
  v_one double precision[];
  v_has boolean[];
  v_lam double precision[];
  v_x double precision[];
  v_node jsonb;
  v_n int;
  v_e record;
  v_e0 record;
  v_v double precision;
  v_v0 double precision;
  v_J int[];
  n int;
  v_mat double precision[];
  v_chol double precision[];
  v_w double precision[];
  v_u double precision[];
  v_pm double precision;
  v_pv double precision;
  v_shift double precision;
  v_expl double precision;
begin
  -- without a Sigma of the right size there is nothing to borrow through
  if v_sig is null or pg_catalog.array_length(v_sig, 1) is distinct from k * k then
    v_s := 0;
  end if;
  v_mu := array(select hb.axis_prior_mean(c) from pg_catalog.unnest(v_codes) with ordinality u (c, o) order by o);
  v_var := array(select hb.axis_prior_var(c) from pg_catalog.unnest(v_codes) with ordinality u (c, o) order by o);
  v_cov := pg_catalog.array_fill(0::double precision, array[k * k]);
  for i in 1..k loop
    for j in 1..k loop
      if i = j then
        v_cov[(i - 1) * k + j] := v_f2 * v_var[i];
      elsif v_s > 0 then
        v_cov[(i - 1) * k + j] := v_f2 * v_s * v_sig[(i - 1) * k + j] / pg_catalog.sqrt(v_sig[(i - 1) * k + i] * v_sig[(j - 1) * k + j]) * pg_catalog.sqrt(v_var[i] * v_var[j]);
      end if;
    end loop;
  end loop;

  -- each axis's grid: this session's answers, and the earlier sessions' Gaussian term (state.prior)
  v_ll := pg_catalog.array_fill(0::double precision, array[k * 61]);
  v_has := pg_catalog.array_fill(false, array[k]);
  v_lam := pg_catalog.array_fill(0::double precision, array[k]);
  v_x := pg_catalog.array_fill(0::double precision, array[k]);
  for i in 1..k loop
    v_node := v_state #> array['eap', v_codes[i]];
    if pg_catalog.jsonb_typeof(v_node -> 'll') = 'array' and pg_catalog.jsonb_array_length(v_node -> 'll') = 61 and coalesce((v_node ->> 'n')::int, 0) > 0 then
      v_one := array(select x::double precision from pg_catalog.jsonb_array_elements_text(v_node -> 'll') x);
      for g in 1..61 loop
        v_ll[(i - 1) * 61 + g] := v_one[g];
      end loop;
      v_has[i] := true;
    end if;
    v_node := v_state #> array['prior', v_codes[i]];
    if pg_catalog.jsonb_typeof(v_node -> 'lam') = 'number' and pg_catalog.jsonb_typeof(v_node -> 'x') = 'number' and (v_node ->> 'lam')::double precision > 0 then
      for g in 1..61 loop
        v_ll[(i - 1) * 61 + g] := v_ll[(i - 1) * 61 + g] - 0.5 * (v_node ->> 'lam')::double precision * ((v_node ->> 'x')::double precision - v_grid[g]) ^ 2;
      end loop;
      v_has[i] := true;
    end if;
    -- 1. its message
    if v_has[i] then
      select * into v_e from hb.eap_from_ll(v_ll[(i - 1) * 61 + 1:i * 61], v_mu[i], v_cov[(i - 1) * k + i]);
      select * into v_e0 from hb.eap_from_ll(null, v_mu[i], v_cov[(i - 1) * k + i]);
      v_v := v_e.o_sd * v_e.o_sd;
      v_v0 := v_e0.o_sd * v_e0.o_sd;
      if v_v > 0 and v_v0 > 0 and 1 / v_v - 1 / v_v0 > 1e-9 then
        v_lam[i] := 1 / v_v - 1 / v_v0;
        v_x[i] := (v_e.o_mean / v_v - v_e0.o_mean / v_v0) / v_lam[i];
      end if;
    end if;
  end loop;

  for kk in 1..k loop
    -- only the axes asked for (hb.rank_live passes its p_axes; null: every axis)
    continue when p_axes is not null and not (v_codes[kk] = any (p_axes));
    axis := v_codes[kk];
    -- 2. the conditional prior given the other axes' messages
    v_pm := v_mu[kk];
    v_pv := v_cov[(kk - 1) * k + kk];
    v_J := case when v_s > 0 then array(select j from pg_catalog.generate_series(1, k) j where j <> kk and v_lam[j] > 0 order by j) else '{}'::int[] end;
    n := coalesce(pg_catalog.array_length(v_J, 1), 0);
    if n > 0 then
      v_mat := pg_catalog.array_fill(0::double precision, array[n * n]);
      for a in 1..n loop
        for b in 1..n loop
          v_mat[(a - 1) * n + b] := v_cov[(v_J[a] - 1) * k + v_J[b]] + case when a = b then 1 / v_lam[v_J[a]] else 0 end;
        end loop;
      end loop;
      v_chol := hb.mat_chol(v_mat, n);
      if v_chol is not null then
        v_w := hb.mat_chol_solve(v_chol, array(select v_x[v_J[a]] - v_mu[v_J[a]] from pg_catalog.generate_series(1, n) a order by a), n);
        v_u := hb.mat_chol_solve(v_chol, array(select v_cov[(v_J[a] - 1) * k + kk] from pg_catalog.generate_series(1, n) a order by a), n);
        v_shift := 0;
        v_expl := 0;
        for a in 1..n loop
          v_shift := v_shift + v_cov[(kk - 1) * k + v_J[a]] * v_w[a];
          v_expl := v_expl + v_cov[(kk - 1) * k + v_J[a]] * v_u[a];
        end loop;
        v_pm := v_mu[kk] + v_shift;
        v_pv := greatest(v_cov[(kk - 1) * k + kk] - v_expl, 1e-9 * v_cov[(kk - 1) * k + kk]);
      end if;
    end if;
    -- 3. the axis's own answers under it
    if v_has[kk] then
      select * into v_e from hb.eap_from_ll(v_ll[(kk - 1) * 61 + 1:kk * 61], v_pm, v_pv);
      aim := v_e.o_mean;
    else
      aim := v_pm;
    end if;
    return next;
  end loop;
end
$$;

-- hb.rank_live as in 20261015000200_continuous_items.sql, with the one change: the axes it ranks are passed on to
-- hb.session_aims, so only their aims are worked out.
create or replace function hb.rank_live(p_s public.sessions, p_axes text[], p_exclude text[])
returns table (o_item_id text, o_family_id text, o_axis text, o_gkey text, o_score double precision, o_info double precision, o_rank int)
language plpgsql stable
set search_path = ''
as $$
declare
  v_floor int := hb.cfg_int('selection.coverage_floor', 3);
  v_top_k int := greatest(hb.cfg_int('selection.top_k', 5), 1);
  v_factor double precision := hb.cfg_num('selection.testlet_info_factor', 0.8);
  v_types text[] := hb.set_item_types();
  v_window double precision := greatest(hb.cfg_num('selection.startup_window', 0.5), 0::double precision);
  v_state jsonb := coalesce(p_s.state, '{}'::jsonb);
  v_seen_items text[] := array(select x from pg_catalog.jsonb_array_elements_text(case when pg_catalog.jsonb_typeof(v_state -> 'seen_items') = 'array' then v_state -> 'seen_items' else '[]'::jsonb end) x);
  v_balance jsonb := case when pg_catalog.jsonb_typeof(hb.cfg('selection.balance_item_type_axes')) = 'array' then hb.cfg('selection.balance_item_type_axes') else '[]'::jsonb end;
begin
  return query
  with cand as (
    select c.*, coalesce(am.aim, c.o_mean) as o_aim
      from hb.candidate_items(p_s, p_axes, 'live', p_exclude) c
      left join hb.session_aims(p_s.state, p_axes) am on am.axis = c.o_axis
  ),
  scored as (
    select c.o_item_id as item_id, c.o_family_id as family_id, c.o_axis as axis, c.o_gkey as gkey, c.o_sd as sd, c.o_et as et, c.o_b as b,
           k.info, k.info * c.o_sd * c.o_sd / c.o_et as score,
           exists (select 1 from public.items it where it.item_id = c.o_item_id and it.item_type = any (v_types)) as in_set
      from cand c
     cross join lateral (
       select (case when c.o_model = 'gaussian' then ((c.o_extra ->> 'lam')::double precision / (c.o_extra ->> 'sigma')::double precision) ^ 2
                    when c.o_model = 'grm' then hb.grm_info(c.o_a, c.o_extra -> 'thresholds', c.o_aim)
                    when c.o_model = '3pl' then (case when w.s < 1e-100::double precision then 0::double precision
                                                       else (c.o_a * c.o_a * w.s * w.s * (1 - c.o_c) * w.q) / (c.o_c + (1 - c.o_c) * w.s) end)
                    else (case when c.o_model = '2pl_testlet' then v_factor else 1::double precision end) * (c.o_a * c.o_a * w.s * w.q) end) as info
         from (
           select case when z.v >= 0 then 1 / (1 + z.e) else z.e / (1 + z.e) end as s,
                  case when z.v >= 0 then z.e / (1 + z.e) else 1 / (1 + z.e) end as q
             from (select coalesce(c.o_a * (c.o_aim - c.o_b), 0) as v, pg_catalog.exp(- least(pg_catalog.abs(coalesce(c.o_a * (c.o_aim - c.o_b), 0)), 700::double precision)) as e) z) w) k
  ),
  set_unit as (
    select q.entry as item_id, g.family_id, g.axis, g.gkey, g.info, g.info * g.sd * g.sd / g.et as score, g.b
      from (
        select s.family_id, pg_catalog.min(s.axis) as axis, pg_catalog.min(s.gkey) as gkey, pg_catalog.min(s.sd) as sd,
               pg_catalog.sum(s.info) as info, pg_catalog.sum(s.et) as et, pg_catalog.count(*) as n, pg_catalog.avg(s.b) as b
          from scored s
         where s.in_set
         group by s.family_id) g
     cross join lateral (
       select pg_catalog.count(*) as n, pg_catalog.min(sq.o_item_id) filter (where sq.o_pos = 1) as entry
         from hb.set_questions(g.family_id, p_s.param_version) sq) q
     where g.n = q.n and q.entry is not null
  ),
  unit as (
    select s.item_id, s.family_id, s.axis, s.gkey, s.info, s.score, s.b, false as is_set from scored s where not s.in_set
    union all
    select u.item_id, u.family_id, u.axis, u.gkey, u.info, u.score, u.b, true from set_unit u
  ),
  dist as (
    select u.*, t.target, pg_catalog.abs(u.b - t.target) as d
      from unit u
      left join hb.startup_targets(p_s) t on t.axis = u.axis
  ),
  nearest as (
    select d.axis, pg_catalog.min(d.d) as m from dist d where d.target is not null group by d.axis
  ),
  aimed as (
    -- a unit with no difficulty (a Gaussian or GRM item) has nothing to aim: the window does not apply to it
    select d.item_id, d.family_id, d.axis, d.gkey, d.info, d.score, d.is_set
      from dist d
      left join nearest n on n.axis = d.axis
     where d.target is null or d.b is null or d.d <= greatest(v_window, n.m) + 1e-9::double precision
  ),
  dup_family as (
    select s.family_id from aimed s where not s.is_set group by s.family_id having pg_catalog.count(*) > 1
  ),
  best as (
    select s.item_id, s.family_id, s.axis, s.gkey, s.info, s.score
      from aimed s
     where not s.is_set and s.family_id not in (select d.family_id from dup_family d)
    union all
    (select distinct on (s.family_id) s.item_id, s.family_id, s.axis, s.gkey, s.info, s.score
       from aimed s
      where not s.is_set and s.family_id in (select d.family_id from dup_family d)
      order by s.family_id, s.score desc, s.item_id)
    union all
    select u.item_id, u.family_id, u.axis, u.gkey, u.info, u.score from aimed u where u.is_set
  ),
  given as (
    select f.axis, pg_catalog.count(*) as n
      from (
        select e.item_id from public.exposure_log e where e.session_id = p_s.session_id and not e.pretest
        union
        select x from pg_catalog.unnest(v_seen_items) x
      ) it
      join public.items i on i.item_id = it.item_id
      join public.item_families f on f.family_id = i.family_id
     group by f.axis
  ),
  under as (
    select distinct b.axis
      from best b
      left join given g on g.axis = b.axis
     where coalesce(g.n, 0) < v_floor
  ),
  restricted as (
    select b.* from best b
     where not exists (select 1 from under) or b.axis in (select u.axis from under u)
  ),
  served as (
    -- the balancing key of every item served (the key of hb.candidate_items)
    select f.axis, coalesce(f.generator, '') || case when v_balance ? f.axis then '|' || i.item_type else '' end as gkey, pg_catalog.count(*) as n
      from public.exposure_log e
      join public.item_families f on f.family_id = e.family_id
      join public.items i on i.item_id = e.item_id
     where e.session_id = p_s.session_id and not e.pretest
     group by 1, 2
  ),
  counted as (
    select r.*, coalesce(sv.n, 0) as n_served
      from restricted r
      left join served sv on sv.axis = r.axis and sv.gkey = r.gkey
  ),
  least_served as (
    select c.axis, pg_catalog.min(c.n_served) as m from counted c group by c.axis
  ),
  balanced as (
    select c.* from counted c join least_served l on l.axis = c.axis where c.n_served <= l.m
  ),
  top as (
    select b.item_id, b.family_id, b.axis, b.gkey, b.score, b.info
      from balanced b
     order by b.score desc, b.item_id
     limit v_top_k
  )
  select t.item_id, t.family_id, t.axis, t.gkey, t.score, t.info,
         (pg_catalog.row_number() over (order by t.score desc, t.item_id))::int - 1
    from top t
   order by t.score desc, t.item_id;
end
$$;


reset role;

-- start_session as in 20261005000100_server_seen_lists.sql, with the one change: the new session's state also holds
-- `prior` when the ids the save proves have sessions that say something (the header, RETURNING PEOPLE). (`create or
-- replace` keeps the owner and the grants.)
grant create on schema public to hb_definer;
set local role hb_definer;

create or replace function public.start_session(p_device jsonb, p_save jsonb default null)
returns jsonb
language plpgsql security definer
set search_path = ''
as $$
declare
  v_anon text;
  v_claimed text;
  v_proved text[] := '{}'::text[];
  v_adopted boolean := false;
  v_seen jsonb;
  v_session_id text;
  v_token text;
  v_bank text := hb.cfg_text('bank_version', null);
  v_params text := hb.cfg_text('param_version', null);
begin
  perform hb.reject_brief_prefs(p_device);
  if not hb.valid_device(p_device) then
    perform hb.fail(400, 'invalid_device', 'device must be the coarse object of the save format (schema/save-v1.json).');
  end if;

  if p_save is not null then
    v_claimed := hb.check_save(p_save);
    -- validated for form, as before; which of the ids count is hb.seen_for_session's business
    perform hb.check_id_list(p_save -> 'seen_items', 'seen_items');
    perform hb.check_id_list(p_save -> 'seen_families', 'seen_families');
  end if;

  -- The rate limit counts only calls that get this far (a rejected payload costs nothing).
  perform hb.purge_expired();
  perform hb.rate_hit('start_session', hb.ip_key('start_session'), hb.cfg_int('rate.sessions_per_day', 5));

  -- The ids the save proves: the one it claims is continued only if it is among them, and every one of them says
  -- what this person has been served (a file merged from two devices holds sessions of two ids).
  if p_save is not null then
    v_proved := hb.save_proved_anons(p_save);
  end if;
  if v_claimed is not null and v_claimed = any (v_proved) then
    v_anon := v_claimed;
    v_adopted := true;
  else
    v_anon := 'hb_' || hb.rand_b62(16);
  end if;
  -- What keeps an item away from this session is what the server served to the person and the procedural
  -- families the file names (see the header), not the rest of what a save says.
  v_seen := hb.seen_for_session(v_proved, p_save);
  v_session_id := 's_' || hb.rand_b62(16);
  v_token := hb.new_token();
  insert into public.sessions (session_id, anon_id, token_hash, bank_version, param_version, device, state)
  values (v_session_id, v_anon, hb.token_hash(v_token), v_bank, v_params, p_device,
          pg_catalog.jsonb_build_object('v', 1, 'seen_items', v_seen -> 'items', 'seen_families', v_seen -> 'families')
            || hb.prior_state(v_proved));

  return pg_catalog.jsonb_build_object(
    'session_id', v_session_id,
    'token', v_token,
    'anon_id', v_anon,
    'anon_id_adopted', v_adopted,
    'bank_version', v_bank,
    'param_version', v_params,
    'limits', pg_catalog.jsonb_build_object('max_items', hb.cfg_int('session.max_items', 200)));
end
$$;

reset role;
revoke create on schema public from hb_definer;
