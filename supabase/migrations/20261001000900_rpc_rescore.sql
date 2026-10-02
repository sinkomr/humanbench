-- M2.1 (ROADMAP M2.1 "Amended (Phase AI Part 2; ... add it during M2.1)"; DESIGN §7.8, §8 merge step 3,
-- R-17.4, R-17.5; ROADMAP A2, A12, A16, A21, AI.8): rescore(save).
--
-- Re-scores a person's server sessions from the raw responses the server holds, with the retest
-- model of DESIGN §7.8 (engine/retest.ts, retest_v1), and returns the own-axis, practice-adjusted
-- EAP per axis and per facet.
--
--   * Which sessions: those the save lists that the server issued to the CALLER's anon_id (the
--     anon_id of the save: hb.session_owned, in which a sig.anon_id may only repeat it, never replace
--     it) and that are finished. Their responses come from the database, never from the upload (A16:
--     calibration uses database rows only). Others are counted as unknown_sessions and contribute
--     nothing. M2.3 will additionally require each session's MAC (same hb.session_owned seam).
--   * Which responses score: dichotomous items (2PL, 2PL-testlet scored as 2PL as in the app, 3PL)
--     with a stored correct 0/1 and a parameter row, not pretest, not on a quarantined item (DESIGN
--     §4.5), and only in calibration-eligible sessions (A21: ineligible sessions still count as
--     practice exposures). Block observations (GRM, Gaussian: RT, span, coding, reading) are not
--     scored on the server before M2.2, and the notes never read them (R-17.4); they are counted
--     under skipped.block.
--   * Practice (§7.8): the test number s of an axis is the position of the session among the person's
--     sessions that took the axis (a response on any of its items, scored or not). Every observation
--     is re-expressed on the trait: b - rho_k(s), rho_k(s) = rho_max_k (1 - exp(-(s-1)/1.2)).
--   * eap[axis]: the unidimensional grid EAP of engine/scorer.ts eapAxis (61 equal-weight points on
--     [-4, 4]) on that axis's adjusted observations under the population prior N(0, 1): the own-axis
--     posterior A21 asks for, not the correlated MAP.
--   * facets[axis][facet]: the EAP on the facet's observations with the axis posterior (mean, sd^2)
--     as the prior (A12, viz/facets.ts, but with the own-axis posterior in place of the correlated MAP
--     until M2.2). Returned with n.
--
-- What it does NOT return (R-11.1, DESIGN §10: no correctness feedback on finite-bank items; owner
-- decision 2026-10-01: "rescore must also not leak single-answer verdicts"). finish() no longer carries
-- the server's verdict on an answer, so a score is the one place the verdicts still show, and a posterior
-- mean of one or two answers IS those answers (one right answer moves the mean up, one wrong one down).
-- So:
--   * an axis is returned only with at least rescore.min_axis_items (5) scored items over the save's
--     eligible sessions, a facet only with at least rescore.min_facet_items (5; A12 shows a facet from
--     5 items). Below that the call returns the count under `withheld`, which says nothing about
--     right or wrong;
--   * mean and sd are rounded: the mean to a multiple of rescore.mean_step (0.1), the sd UP to a
--     multiple of rescore.sd_step (0.05), both in SD units. The 0.1 is well under the posterior sd of
--     a finished session (0.3 to 0.7), so nothing the blob shows changes;
--   * the call is limited per client address (rate.rescores_per_day, 20) and per anon_id
--     (rate.rescores_per_anon_day, 10; only calls that name a session of that anon_id count, so nobody
--     can use up the calls of an id they merely know).
-- These do not make a difference of two calls harmless: a script that adds one more one-answer session
-- to its save and compares the two results can still read that answer's sign (n >= 5 and a 0.1 step
-- leave a single answer's shift, median 0.15 at n = 30, mostly above the step). What bounds it is the
-- number of sessions an address may start (5 a day) and these call limits, about 4 answers a day per
-- address instead of the 200 per session that the finish reply would have given; a minimum session size
-- for a session to count is M2.2's (hb.is_eligible). See supabase/README.md.
--
-- Item parameters: the param_version in app_config, else each item's latest row.
--
-- PostgreSQL raises "value out of range: underflow" when exp() returns 0 (JavaScript returns 0), so every
-- exp() argument is floored: -700 inside the log-likelihood terms (the result only enters ln(1 + ...)),
-- -230 for posterior weights (a weight below e^-230 of the largest is nothing; the floor keeps the products
-- in the variance away from the underflow error as well).

grant create on schema public to hb_definer;
set local role hb_definer;

create function public.rescore(p_save jsonb)
returns jsonb
language plpgsql security definer
set search_path = ''
as $$
declare
  v_anon text;
  v_tau double precision := hb.cfg_num('retest.tau', 1.2);
  v_rho jsonb := coalesce(hb.cfg('retest.rho_max'), '{}'::jsonb);
  v_param text := hb.cfg_text('param_version', null);
  -- what is published (R-11.1): never fewer than one item, never a negative step
  v_min_axis int := greatest(hb.cfg_int('rescore.min_axis_items', 5), 1);
  v_min_facet int := greatest(hb.cfg_int('rescore.min_facet_items', 5), 1);
  v_mean_step double precision := greatest(hb.cfg_num('rescore.mean_step', 0.1), 0);
  v_sd_step double precision := greatest(hb.cfg_num('rescore.sd_step', 0.05), 0);
  v_result jsonb;
begin
  v_anon := hb.check_save(p_save);
  if pg_catalog.jsonb_array_length(p_save -> 'sessions') > hb.cfg_int('rescore.max_sessions', 40) then
    perform hb.fail(413, 'too_many_sessions', 'At most ' || hb.cfg_int('rescore.max_sessions', 40) || ' sessions per call.');
  end if;
  perform hb.rate_hit('rescore', hb.ip_key('rescore'), hb.cfg_int('rate.rescores_per_day', 20));
  -- Per anon_id too, so that changing the address between calls does not reset the count. Only a call
  -- that holds a session of this anon_id is counted: the id alone is in every copy of the person's
  -- file, and a stranger who knew it must not be able to use up its calls. (A raise below rolls the
  -- address count back with it, as for every limit.)
  if exists (
    select 1 from pg_catalog.jsonb_array_elements(p_save -> 'sessions') e
     where pg_catalog.jsonb_typeof(e) = 'object' and hb.session_owned(e, v_anon)) then
    perform hb.rate_hit('rescore_anon', hb.day_key('rescore_anon|' || v_anon), hb.cfg_int('rate.rescores_per_anon_day', 10));
  end if;

  v_result := (
    with
    -- the save's sessions, once each, in the order sent (of a repeated entry, one the caller owns wins)
    req as (
      select x.session_id, x.value, x.ord
        from (
          select s.value ->> 'session_id' as session_id,
                 s.value,
                 s.ord,
                 pg_catalog.row_number() over (partition by s.value ->> 'session_id' order by hb.session_owned(s.value, v_anon) desc, s.ord) as dup
            from pg_catalog.jsonb_array_elements(p_save -> 'sessions') with ordinality s (value, ord)
           where pg_catalog.jsonb_typeof(s.value) = 'object' and (s.value ->> 'session_id') is not null
        ) x
       where x.dup = 1
    ),
    -- issued to the caller's anon_id (never to the one a sig names) and finished
    known as (
      select ss.session_id,
             pg_catalog.to_char(ss.started_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"') as started_utc,
             ss.calibration_eligible
        from req
        join public.sessions ss on ss.session_id = req.session_id
       where ss.finished_at is not null and hb.session_owned(req.value, v_anon)
    ),
    resp as (
      select k.session_id, k.started_utc, k.calibration_eligible, r.pretest, r.correct,
             i.status as item_status, f.axis, f.facet, p.model, p.a, p.b, p.c
        from known k
        join public.responses r on r.session_id = k.session_id
        join public.items i on i.item_id = r.item_id
        join public.item_families f on f.family_id = i.family_id
        left join lateral (
          select ip.model, ip.a, ip.b, ip.c
            from public.item_parameters ip
           where ip.item_id = r.item_id and (v_param is null or ip.param_version = v_param)
           order by ip.created_at desc
           limit 1
        ) p on true
    ),
    cls as (
      select resp.*,
             case
               when pretest then 'pretest'
               when item_status = 'quarantined' then 'quarantined'
               when not calibration_eligible then 'ineligible_session'
               when model is null then 'no_params'
               when model not in ('2pl', '2pl_testlet', '3pl') then 'block'
               when correct is null then 'unscored'
               when a is null or b is null or (model = '3pl' and c is null) then 'no_params'
               else 'scored'
             end as outcome
        from resp
    ),
    -- test numbers (§7.8): every session that took the axis, scored or not, in time order
    taken as (
      select distinct axis, session_id, started_utc from resp
    ),
    ord as (
      select t.axis, t.session_id,
             pg_catalog.row_number() over (partition by t.axis order by t.started_utc collate "C", t.session_id collate "C") as s
        from taken t
    ),
    rho as (
      select o.axis, o.session_id, o.s,
             - coalesce((v_rho ->> o.axis)::double precision, 0) * (pg_catalog.exp(- (o.s - 1) / v_tau) - 1) as rho
        from ord o
    ),
    obs as (
      select c.axis, coalesce(c.facet, '') as facet, c.a, c.b - r.rho as b, c.c, c.correct as y
        from cls c
        join rho r on r.axis = c.axis and r.session_id = c.session_id
       where c.outcome = 'scored'
    ),
    grid as (
      select g.i, case when g.i = 60 then 4::double precision else -4::double precision + g.i * (8::double precision / 60) end as g
        from pg_catalog.generate_series(0, 60) g (i)
    ),
    -- log-likelihood of the observations of one (axis, facet) at each grid point: the 2PL/3PL terms of
    -- engine/irt.ts, in the same numerically stable form (log sigmoid, log-sum-exp)
    fll as (
      select o.axis, o.facet, gr.i, gr.g,
             pg_catalog.sum(
               case
                 when o.c is null then case when o.y = 1 then lz.pos else lz.neg end
                 when o.y = 0 then pg_catalog.ln(1 - o.c) + lz.neg
                 else mm.m + pg_catalog.ln(pg_catalog.exp(greatest(uv.u - mm.m, -700)) + pg_catalog.exp(greatest(uv.v - mm.m, -700)))
               end) as ll
        from obs o
       cross join grid gr
       cross join lateral (select o.a * (gr.g - o.b) as z) zz
       cross join lateral (
         select case when zz.z >= 0 then - pg_catalog.ln(1 + pg_catalog.exp(greatest(- zz.z, -700))) else zz.z - pg_catalog.ln(1 + pg_catalog.exp(greatest(zz.z, -700))) end as pos,
                case when zz.z <= 0 then - pg_catalog.ln(1 + pg_catalog.exp(greatest(zz.z, -700))) else - zz.z - pg_catalog.ln(1 + pg_catalog.exp(greatest(- zz.z, -700))) end as neg
       ) lz
       cross join lateral (
         select case when o.c is null then 0::double precision else pg_catalog.ln(o.c) end as u,
                case when o.c is null then 0::double precision else pg_catalog.ln(1 - o.c) + lz.pos end as v
       ) uv
       cross join lateral (select greatest(uv.u, uv.v) as m) mm
       group by o.axis, o.facet, gr.i, gr.g
    ),
    axis_ll as (
      select axis, i, g, pg_catalog.sum(ll) as ll from fll group by axis, i, g
    ),
    axis_w as (
      select a.axis, a.i, a.g,
             pg_catalog.exp(greatest(lw.v - pg_catalog.max(lw.v) over (partition by a.axis), -230)) as w
        from axis_ll a
       cross join lateral (
         select - 0.5 * (a.g - hb.axis_prior_mean(a.axis)) * (a.g - hb.axis_prior_mean(a.axis)) / hb.axis_prior_var(a.axis) + a.ll as v
       ) lw
    ),
    axis_mean as (
      select axis, pg_catalog.sum(w) as tw, pg_catalog.sum(w * g) / pg_catalog.sum(w) as mean from axis_w group by axis
    ),
    axis_raw as (
      select m.axis, m.mean,
             pg_catalog.sqrt(greatest(pg_catalog.sum(w.w * (w.g - m.mean) * (w.g - m.mean)) / m.tw, 0)) as sd,
             (select pg_catalog.count(*) from obs o where o.axis = m.axis) as n
        from axis_mean m join axis_w w on w.axis = m.axis
       group by m.axis, m.mean, m.tw
    ),
    -- an axis with too few scored items is not published (R-11.1), and neither are its facets
    axis_est as (
      select * from axis_raw where n >= v_min_axis
    ),
    facet_w as (
      select f.axis, f.facet, f.i, f.g,
             pg_catalog.exp(greatest(lw.v - pg_catalog.max(lw.v) over (partition by f.axis, f.facet), -230)) as w
        from fll f
        join axis_est e on e.axis = f.axis
       cross join lateral (
         select - 0.5 * (f.g - e.mean) * (f.g - e.mean) / greatest(e.sd * e.sd, 1e-12) + f.ll as v
       ) lw
       where f.facet <> ''
    ),
    facet_mean as (
      select axis, facet, pg_catalog.sum(w) as tw, pg_catalog.sum(w * g) / pg_catalog.sum(w) as mean from facet_w group by axis, facet
    ),
    facet_raw as (
      select m.axis, m.facet, m.mean,
             pg_catalog.sqrt(greatest(pg_catalog.sum(w.w * (w.g - m.mean) * (w.g - m.mean)) / m.tw, 0)) as sd,
             (select pg_catalog.count(*) from obs o where o.axis = m.axis and o.facet = m.facet) as n
        from facet_mean m join facet_w w on w.axis = m.axis and w.facet = m.facet
       group by m.axis, m.facet, m.mean, m.tw
    ),
    facet_est as (
      select * from facet_raw where n >= v_min_facet
    )
    select pg_catalog.jsonb_build_object(
      'retest_version', 'retest_v1',
      'param_version', v_param,
      'sessions', coalesce((
        select pg_catalog.jsonb_agg(
                 pg_catalog.jsonb_build_object(
                   'session_id', q.session_id,
                   'known', k.session_id is not null,
                   'calibration_eligible', k.calibration_eligible,
                   'ordinals', coalesce((select pg_catalog.jsonb_object_agg(r.axis, r.s) from rho r where r.session_id = q.session_id), '{}'::jsonb),
                   'rho', coalesce((select pg_catalog.jsonb_object_agg(r.axis, r.rho) from rho r where r.session_id = q.session_id), '{}'::jsonb),
                   'n_scored', (select pg_catalog.count(*) from cls c where c.session_id = q.session_id and c.outcome = 'scored'))
                 order by q.ord)
          from req q left join known k on k.session_id = q.session_id), '[]'::jsonb),
      -- mean and sd only above the minimum count, rounded (see the header)
      'eap', coalesce((
        select pg_catalog.jsonb_object_agg(e.axis, pg_catalog.jsonb_build_object(
                 'mean', hb.quantise_round(e.mean, v_mean_step), 'sd', hb.quantise_up(e.sd, v_sd_step), 'n', e.n))
          from axis_est e), '{}'::jsonb),
      'facets', coalesce((
        select pg_catalog.jsonb_object_agg(x.axis, x.facets)
          from (
            select e.axis,
                   pg_catalog.jsonb_object_agg(e.facet, pg_catalog.jsonb_build_object(
                     'mean', hb.quantise_round(e.mean, v_mean_step), 'sd', hb.quantise_up(e.sd, v_sd_step), 'n', e.n)) as facets
              from facet_est e group by e.axis) x), '{}'::jsonb),
      -- what was held back, as counts of scored items only (the count does not depend on right or wrong)
      'withheld', pg_catalog.jsonb_build_object(
        'eap', coalesce((select pg_catalog.jsonb_object_agg(a.axis, a.n) from axis_raw a where a.n < v_min_axis), '{}'::jsonb),
        'facets', coalesce((
          select pg_catalog.jsonb_object_agg(x.axis, x.facets)
            from (
              select f.axis, pg_catalog.jsonb_object_agg(f.facet, f.n) as facets
                from facet_raw f where f.n < v_min_facet group by f.axis) x), '{}'::jsonb)),
      'limits', pg_catalog.jsonb_build_object(
        'min_axis_items', v_min_axis, 'min_facet_items', v_min_facet, 'mean_step', v_mean_step, 'sd_step', v_sd_step),
      'skipped', coalesce((
        select pg_catalog.jsonb_object_agg(c.outcome, c.n)
          from (select outcome, pg_catalog.count(*) as n from cls where outcome <> 'scored' group by outcome) c), '{}'::jsonb)
        || pg_catalog.jsonb_build_object(
             'unknown_sessions', (select pg_catalog.count(*) from req) - (select pg_catalog.count(*) from known))));
  return v_result;
end
$$;

revoke all on function public.rescore(jsonb) from public, anon, authenticated, service_role;
grant execute on function public.rescore(jsonb) to anon, authenticated;

reset role;
revoke create on schema public from hb_definer;
