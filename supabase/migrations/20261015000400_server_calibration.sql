-- M2.1 (ROADMAP M2.1, rescore; owner decision 2026-10-13 "yeah, lets add calibration to the live score if they submit
-- sufficient confidence data"; DESIGN §3 row 12, §7.1 "Calibration", §7.8, §10, R-11.1): rescore computes the Calibration
-- skill (CAL) of the sessions the server scored, from their rated answers, with the app's own observation model.
--
-- One change to public.rescore (as last re-created by 20261015000200_continuous_items.sql, the remaining families) and two config rows; nothing else. calibration.db.test.ts
-- holds the body to the earlier one with exactly these edits, and the numbers to the app's engine.
--
--   * Rated answers. A session's valid scored answers (the outcome 'scored' or 'short_axis' of the earlier body: a counted
--     session, not pretest, not quarantined, with parameters and a server verdict, inside the item's answer space) that
--     carry a confidence (`responses.confidence`, 0 to 100; null = the optional scale was left unset). The per-axis
--     minimum does not apply: the session's calibration is one sum over all of them.
--   * The observation (tasks/calibration.ts calibrationObservation, tasks/priors.ts CAL_NORMS, tasks/family.ts
--     gaussianObservationSigma): the session's Brier score B = mean of (c - y)^2, c = confidence / 100, enters as
--     x = -B ~ N(lam theta + d, SE^2 + tau_res^2) with lam = brier_sd sqrt(reliability), d = -brier_mean, tau_res =
--     residual_sd and SE = sqrt(sample variance of the terms / n). Re-expressed at the session's practice gain as any
--     Gaussian observation (engine/retest.ts adjustObservation: d + lam rho), CAL's rho from retest.rho_max like every axis;
--     the sessions that "took" CAL for the practice model are those that measured it. On the own-axis grid of every axis.
--   * The minimum (rescore.min_cal_items, 10 = CAL_NORMS.min_responses; at least 2, for the SE): a session adds a
--     calibration observation only from that many rated answers. CAL is returned (rounded, as every axis) when some session
--     measured it; otherwise, when there are rated answers, their count is under withheld.eap.CAL. `n` of CAL is the number
--     of rated answers used. cal.norms holds CAL_NORMS (the numbers are the app's: calibration.db.test.ts compares them);
--     with cal.norms removed, rescore returns no CAL.
--
-- What rescore tells (R-11.1): one more rounded posterior. Unlike an axis score, this one is a sum whose weights the client
-- chooses: an answer rated 50% adds 0.25 whatever its verdict, so a session of nine such answers and one rated 100% is a
-- calibration score that moves by a whole Brier step with that one verdict. The verdict channel this opens is reported to
-- the owner with the change (ROADMAP, owner decision 2026-10-13); it is of the kind the adaptive selection already has
-- (A24-sec), and rescore's per-anon_id and per-address limits bound it.

insert into public.app_config (key, value, description) values
  ('rescore.min_cal_items', '10', 'a session adds a Calibration observation in rescore only from this many rated answers (answers with a confidence among its valid scored ones); tasks/priors.ts CAL_NORMS.min_responses, why ten. At least 2 (the session''s own SE)'),
  ('cal.norms', '{"version":"cal-v0","brier_mean":0.21,"brier_sd":0.06,"reliability":0.6,"residual_sd":0.02}', 'tasks/priors.ts CAL_NORMS (provisional until M4.8): the population location and scale of -Brier and the residual SD of the session calibration observation; remove the row to stop rescore returning Calibration');

grant create on schema public to hb_definer;
set local role hb_definer;

create or replace function public.rescore(p_save jsonb)
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
  -- Calibration (header): never from fewer than one rated answer a session, and at least two for its own SE
  v_min_cal int := greatest(hb.cfg_int('rescore.min_cal_items', 10), 2);
  v_cal jsonb := hb.cfg('cal.norms');
  v_owned text[];
  v_result jsonb;
begin
  v_anon := hb.check_save(p_save);
  if pg_catalog.jsonb_array_length(p_save -> 'sessions') > hb.cfg_int('rescore.max_sessions', 40) then
    perform hb.fail(413, 'too_many_sessions', 'At most ' || hb.cfg_int('rescore.max_sessions', 40) || ' sessions per call.');
  end if;
  -- Before the count, so that no call runs for long enough to be cancelled (a cancelled call rolls its count back)
  perform hb.check_save_work(p_save);
  perform hb.rate_hit('rescore', hb.ip_key('rescore'), hb.cfg_int('rate.rescores_per_day', 20));
  -- Per anon_id too, so that changing the address between calls does not reset the count. Only a call
  -- that holds a session of this anon_id is counted: the id alone is in every copy of the person's
  -- file, and a stranger who knew it must not be able to use up its calls. (A raise below rolls the
  -- address count back with it, as for every limit.)
  select coalesce(pg_catalog.array_agg(distinct e ->> 'session_id'), '{}'::text[]) into v_owned
    from pg_catalog.jsonb_array_elements(p_save -> 'sessions') e
   where hb.session_owned(e, v_anon);
  if pg_catalog.cardinality(v_owned) > 0 then
    perform hb.rate_hit('rescore_anon', hb.day_key('rescore_anon|' || v_anon), hb.cfg_int('rate.rescores_per_anon_day', 10));
  end if;

  v_result := (
    with
    -- the save's sessions, once each, in the order sent
    req as (
      select x.session_id, x.ord
        from (
          select s.value ->> 'session_id' as session_id,
                 s.ord,
                 pg_catalog.row_number() over (partition by s.value ->> 'session_id' order by s.ord) as dup
            from pg_catalog.jsonb_array_elements(p_save -> 'sessions') with ordinality s (value, ord)
           where pg_catalog.jsonb_typeof(s.value) = 'object' and (s.value ->> 'session_id') is not null
        ) x
       where x.dup = 1
    ),
    -- issued to the caller's anon_id (never to the one a sig names), finished, and verified (v_owned)
    known as (
      select ss.session_id,
             pg_catalog.to_char(ss.started_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"') as started_utc,
             hb.is_eligible(ss.session_id, true) as counts
        from req
        join public.sessions ss on ss.session_id = req.session_id
       where ss.finished_at is not null and ss.session_id = any (v_owned)
    ),
    resp as (
      select k.session_id, k.started_utc, k.counts, r.pretest, r.correct, r.confidence,
             i.status as item_status, f.axis, f.facet, p.model, p.a, p.b, p.c,
             -- hb.key_fits_model written out (a function call per row is the largest cost of the row)
             coalesce((p.model = 'gaussian' and ik.key ? 'true_value') or (p.model = 'grm' and ik.key ? 'ratings'), false) as scored_here,
             hb.response_fits(ik.key,
               pg_catalog.jsonb_array_length(case when pg_catalog.jsonb_typeof(i.payload -> 'options') = 'array' then i.payload -> 'options' else '[]'::jsonb end),
               r.response) as in_space,
             -- the observation of a Gaussian or GRM answer (hb.response_obs); null for every other answer
             case when p.model in ('gaussian', 'grm') then
               hb.response_obs(f.axis, p.model, p.a, p.b, p.c, p.extra, ik.key,
                 pg_catalog.jsonb_array_length(case when pg_catalog.jsonb_typeof(i.payload -> 'options') = 'array' then i.payload -> 'options' else '[]'::jsonb end),
                 r.response, r.correct) end as cobs
        from known k
        cross join lateral hb.responses_of(k.session_id) r
        join public.items i on i.item_id = r.item_id
        join public.item_families f on f.family_id = i.family_id
        left join public.item_keys ik on ik.item_id = r.item_id
        left join lateral (
          select ip.model, ip.a, ip.b, ip.c, ip.extra
            from public.item_parameters ip
           where ip.item_id = r.item_id and (v_param is null or ip.param_version = v_param)
           order by ip.created_at desc
           limit 1
        ) p on true
    ),
    cls0 as (
      select resp.*,
             case
               when pretest then 'pretest'
               when item_status = 'quarantined' then 'quarantined'
               when not counts then 'ineligible_session'
               when model is null then 'no_params'
               -- a Gaussian or GRM item the server scores (a Fermi truth, a rating profile): invalid when outside the answer
               -- space, else scored when it has an observation. One without such a key is a block, scored on the device.
               when scored_here then case when not in_space then 'invalid' when cobs is null then 'no_params' else 'scored' end
               when model not in ('2pl', '2pl_testlet', '3pl') then 'block'
               when correct is null then 'unscored'
               when a is null or b is null or (model = '3pl' and c is null) then 'no_params'
               -- known wrong to anybody, so no answer at all (hb.response_fits); never right or wrong
               when not in_space then 'invalid'
               else 'scored'
             end as outcome
        from resp
    ),
    -- a session's answers on an axis count only if the session holds at least v_min_axis of them
    -- (R-11.1: what a session adds to a score is a sum of that many answers, never one)
    cls as (
      select c.session_id, c.started_utc, c.counts, c.correct, c.confidence, c.axis, c.facet, c.model, c.a, c.b, c.c, c.cobs,
             case
               when c.outcome = 'scored' and c.n_axis < v_min_axis then 'short_axis'
               else c.outcome
             end as outcome
        from (
          select cls0.*,
                 pg_catalog.count(*) filter (where cls0.outcome = 'scored') over (partition by cls0.session_id, cls0.axis) as n_axis
            from cls0
        ) c
    ),
    -- Calibration (header): the rated answers of a session, those with a confidence among its valid scored answers
    -- (the per-axis minimum does not apply: a session's calibration is one sum over all of them), and the session's
    -- Brier score B, the sample variance of its terms (c - y)^2, and their count
    cal_sess as (
      select c.session_id, c.started_utc, pg_catalog.count(*) as n,
             pg_catalog.avg(t.t) as brier,
             coalesce(pg_catalog.var_samp(t.t), 0) as var
        from cls c
       cross join lateral (select (c.confidence::double precision / 100 - c.correct::double precision) * (c.confidence::double precision / 100 - c.correct::double precision) as t) t
       where c.outcome in ('scored', 'short_axis') and c.confidence is not null and c.correct in (0, 1)
       group by c.session_id, c.started_utc
    ),
    -- test numbers (§7.8): every session that took the axis, scored or not, in time order; for Calibration, the sessions
    -- that measured it (as the app's re-score: an observation only from v_min_cal rated answers)
    taken as (
      select distinct axis, session_id, started_utc from resp
      union
      select 'CAL', s.session_id, s.started_utc from cal_sess s where v_cal is not null and s.n >= v_min_cal
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
    -- the answers that count, each under its drill-down facet (hb.drill_facet: a quant template's answers count
    -- under its topic group). facet_ok: the facet counts the answer only if the same session holds at least
    -- v_min_facet counted answers on that facet (the axis counts it either way); no facet, never
    obs as (
      select c.axis, coalesce(c.facet, '') as facet, c.a, c.b, c.c, c.y, c.cobs,
             (c.facet is not null and pg_catalog.count(*) over (partition by c.session_id, c.axis, c.facet) >= v_min_facet) as facet_ok
        from (
          select c0.session_id, c0.axis, hb.drill_facet(c0.axis, c0.facet) as facet, c0.a, c0.b - r.rho as b, c0.c, c0.correct as y,
                 case when c0.cobs is not null then hb.obs_shift(c0.cobs, r.rho) end as cobs
            from cls c0
            join rho r on r.axis = c0.axis and r.session_id = c0.session_id
           where c0.outcome = 'scored'
        ) c
    ),
    grid as (
      select g.i, case when g.i = 60 then 4::double precision else -4::double precision + g.i * (8::double precision / 60) end as g
        from pg_catalog.generate_series(0, 60) g (i)
    ),
    -- the grid log-likelihood of each continuous observation, once
    cgrid as materialized (
      select o.axis, o.facet, o.facet_ok, hb.obs_grid_ll(o.cobs) as ll
        from obs o
       where o.cobs is not null
    ),
    -- log-likelihood of the observations of one (axis, facet, facet_ok) at each grid point: the 2PL/3PL
    -- terms of engine/irt.ts, in the same numerically stable form (log sigmoid, log-sum-exp), and the
    -- continuous terms of the scoring core
    fll as (
      select t.axis, t.facet, t.facet_ok, t.i, t.g, pg_catalog.sum(t.ll) as ll
        from (
          select o.axis, o.facet, o.facet_ok, gr.i, gr.g,
                 case
                   when o.c is null then case when o.y = 1 then lz.pos else lz.neg end
                   when o.y = 0 then pg_catalog.ln(1 - o.c) + lz.neg
                   else mm.m + pg_catalog.ln(pg_catalog.exp(greatest(uv.u - mm.m, -700)) + pg_catalog.exp(greatest(uv.v - mm.m, -700)))
                 end as ll
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
           where o.cobs is null
          union all
          select cg.axis, cg.facet, cg.facet_ok, gr.i, gr.g, cg.ll[gr.i + 1]
            from cgrid cg
           cross join grid gr
        ) t
       group by t.axis, t.facet, t.facet_ok, t.i, t.g
    ),
    -- the calibration observation of each session that measured it (tasks/calibration.ts calibrationObservation,
    -- tasks/priors.ts CAL_NORMS): x = -B ~ N(lam theta + d, SE^2 + tau_res^2), lam = brier_sd sqrt(reliability),
    -- d = -brier_mean, SE = sqrt(var / n); re-expressed on the trait at the session's practice gain as
    -- engine/retest.ts adjustObservation does a Gaussian one (d + lam rho)
    cal_obs as (
      select - s.brier as x, p.lam, - p.brier_mean + p.lam * r.rho as d,
             pg_catalog.sqrt(s.var / s.n + p.res * p.res) as sigma, s.n
        from cal_sess s
        join rho r on r.axis = 'CAL' and r.session_id = s.session_id
       cross join lateral (
         select (v_cal ->> 'brier_sd')::double precision * pg_catalog.sqrt((v_cal ->> 'reliability')::double precision) as lam,
                (v_cal ->> 'brier_mean')::double precision as brier_mean,
                (v_cal ->> 'residual_sd')::double precision as res
       ) p
       where v_cal is not null and s.n >= v_min_cal
    ),
    cal_ll as (
      select 'CAL'::text as axis, gr.i, gr.g,
             pg_catalog.sum(-0.5 * ((o.x - o.lam * gr.g - o.d) / o.sigma) * ((o.x - o.lam * gr.g - o.d) / o.sigma)) as ll
        from cal_obs o cross join grid gr
       group by gr.i, gr.g
    ),
    axis_ll as (
      select axis, i, g, pg_catalog.sum(ll) as ll from fll group by axis, i, g
      union all
      select axis, i, g, ll from cal_ll
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
             case when m.axis = 'CAL' then (select pg_catalog.sum(o.n) from cal_obs o)::bigint
                  else (select pg_catalog.count(*) from obs o where o.axis = m.axis) end as n
        from axis_mean m join axis_w w on w.axis = m.axis
       group by m.axis, m.mean, m.tw
    ),
    -- every axis here has a session with at least v_min_axis answers on it (obs holds no others), so
    -- every axis here is published; a facet is computed only under one of them. Its prior is the axis
    -- posterior WITHOUT the facet's counted answers (leave-facet-out, viz/facets.ts; UX review D4), and its
    -- answers are then added once. On this grid both steps are exact (log weights: prior + axis_ll - facet_ll,
    -- then + facet_ll), so the product IS the axis posterior: a facet's mean and sd are its axis's to the last
    -- digit, and only n, the facet's counted answers, is its own.
    facet_raw as (
      select o.axis, o.facet, e.mean, e.sd, pg_catalog.count(*) as n
        from obs o
        join axis_raw e on e.axis = o.axis
       where o.facet <> '' and o.facet_ok
       group by o.axis, o.facet, e.mean, e.sd
    )
    select pg_catalog.jsonb_build_object(
      'retest_version', 'retest_v1',
      'param_version', v_param,
      'sessions', coalesce((
        select pg_catalog.jsonb_agg(
                 pg_catalog.jsonb_build_object(
                   'session_id', q.session_id,
                   'known', k.session_id is not null,
                   'ordinals', coalesce((select pg_catalog.jsonb_object_agg(r.axis, r.s) from rho r where r.session_id = q.session_id), '{}'::jsonb),
                   'rho', coalesce((select pg_catalog.jsonb_object_agg(r.axis, r.rho) from rho r where r.session_id = q.session_id), '{}'::jsonb),
                   'n_scored', (select pg_catalog.count(*) from cls c where c.session_id = q.session_id and c.outcome = 'scored'))
                 order by q.ord)
          from req q left join known k on k.session_id = q.session_id), '[]'::jsonb),
      -- mean and sd only above the minimum count, rounded (see the header)
      'eap', coalesce((
        select pg_catalog.jsonb_object_agg(e.axis, pg_catalog.jsonb_build_object(
                 'mean', hb.quantise_round(e.mean, v_mean_step), 'sd', hb.quantise_up(e.sd, v_sd_step), 'n', e.n))
          from axis_raw e), '{}'::jsonb),
      'facets', coalesce((
        select pg_catalog.jsonb_object_agg(x.axis, x.facets)
          from (
            select e.axis,
                   pg_catalog.jsonb_object_agg(e.facet, pg_catalog.jsonb_build_object(
                     'mean', hb.quantise_round(e.mean, v_mean_step), 'sd', hb.quantise_up(e.sd, v_sd_step), 'n', e.n)) as facets
              from facet_raw e group by e.axis) x), '{}'::jsonb),
      -- what was held back, as counts of valid answers only (the count does not depend on right or wrong):
      -- an axis no session of which holds enough, and a facet (of an axis that is returned) the same
      'withheld', pg_catalog.jsonb_build_object(
        'eap', coalesce((
          select pg_catalog.jsonb_object_agg(w.axis, w.n)
            from (
              select c.axis, pg_catalog.count(*) as n
                from cls c
               where c.outcome in ('scored', 'short_axis')
                 and not exists (select 1 from axis_raw a where a.axis = c.axis)
               group by c.axis
              union all
              -- rated answers that measured no Calibration (no session with v_min_cal of them): their count only
              select 'CAL', pg_catalog.sum(s.n)::bigint
                from cal_sess s
               where v_cal is not null and not exists (select 1 from axis_raw a where a.axis = 'CAL')
              having pg_catalog.count(*) > 0) w), '{}'::jsonb),
        'facets', coalesce((
          select pg_catalog.jsonb_object_agg(x.axis, x.facets)
            from (
              select h.axis, pg_catalog.jsonb_object_agg(h.facet, h.n) as facets
                from (
                  select o.axis, o.facet, pg_catalog.count(*) as n
                    from obs o
                   where o.facet <> ''
                   group by o.axis, o.facet
                  having not pg_catalog.bool_or(o.facet_ok)) h
               group by h.axis) x), '{}'::jsonb)),
      'limits', pg_catalog.jsonb_build_object(
        'min_axis_items', v_min_axis, 'min_facet_items', v_min_facet, 'min_cal_items', v_min_cal, 'mean_step', v_mean_step, 'sd_step', v_sd_step),
      'skipped', coalesce((
        select pg_catalog.jsonb_object_agg(c.outcome, c.n)
          from (
            -- a session that is not scored for its integrity looks like one that is too short (the reason is not told)
            select case when outcome in ('ineligible_session', 'short_axis') then 'not_counted' else outcome end as outcome, pg_catalog.count(*) as n
              from cls where outcome <> 'scored' group by 1) c), '{}'::jsonb)
        || pg_catalog.jsonb_build_object(
             'unknown_sessions', (select pg_catalog.count(*) from req) - (select pg_catalog.count(*) from known))));
  return v_result;
end
$$;

reset role;
revoke create on schema public from hb_definer;
