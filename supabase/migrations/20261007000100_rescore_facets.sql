-- M2.1 (ROADMAP M2.1, A12, A23; DESIGN §9.6, §7.8, R-11.1; UX review D4, a provisional default): the facets that
-- rescore returns, as the app's drill-down computes them (viz/facets.ts).
--
-- Two changes to public.rescore (20261004000100_response_archive.sql), nothing else; migrations.test.ts and
-- web/scripts/db/facets.test.ts hold the body to the earlier one with exactly these two edits.
--
--   1. Leave-facet-out prior (UX review D4, UX-072, DATA-02). The facet estimate was the EAP on the facet's answers with
--      the AXIS posterior as its prior, and that posterior already holds them: the facet's answers counted twice, so
--      every facet came out narrower than its axis. The prior for a facet is now the axis posterior without the
--      facet's counted answers, and the facet's answers are added once. rescore's axis posterior is the own-axis grid
--      EAP (61 points on [-4, 4], prior N(axis_prior_mean, axis_prior_var)), so both steps are exact on the grid:
--      prior + axis_ll - facet_ll, then + facet_ll. The product is the axis posterior itself, so a facet's mean and
--      sd are its axis's, to the last digit, and only n is the facet's own. (The app does the same on the correlated
--      posterior, with a Laplace cavity: its facets land on about their axis.) Facets can differ from their axis only
--      once the model has a person-by-facet variance (AI.20's τ); until then a facet says no more than its axis.
--   2. Quant topic groups (UX review D4, DATA-14). A quant item's facet is its generator template (18 of them, 2 to 5
--      variants each, A11), which almost never reaches rescore.min_facet_items answers in one session. Answers on QR
--      now count under the template's topic group (hb.drill_facet, the six groups of tasks/quant/topics.ts, A23):
--      for the per-session minimum, for n, and as the key of facets[QR] and withheld.facets[QR]. A facet id that is
--      no template (and every facet of another axis) stays as it is.
--
-- What rescore tells (R-11.1, the owner decision of 2026-10-01): nothing new. A facet's mean and sd are its axis's,
-- which the reply holds already; a facet is still returned only from a session's v_min_facet counted answers on it,
-- and only under an axis that is returned.
--
-- hb.drill_facet mirrors drillFacet (viz/facets.ts) and QUANT_GROUPS (tasks/quant/topics.ts, group_version g1); the
-- tests compare them template by template. A template that moves to another group, or a new group, is a new
-- group_version there and a new migration here.

grant create on schema public to hb_definer;
set local role hb_definer;

create function hb.drill_facet(p_axis text, p_facet text)
returns text
language sql immutable strict parallel safe
set search_path = ''
as $$
  select case
           when p_axis = 'QR' then coalesce((
             select m.grp
               from (values
                 ('arith', 'quant/arith_fractions_percent'),
                 ('fraction', 'quant/arith_fractions_percent'),
                 ('fraction_of', 'quant/arith_fractions_percent'),
                 ('percent', 'quant/arith_fractions_percent'),
                 ('ratio', 'quant/ratios_rates_averages'),
                 ('rate', 'quant/ratios_rates_averages'),
                 ('mean', 'quant/ratios_rates_averages'),
                 ('linear_eq', 'quant/linear'),
                 ('system', 'quant/linear'),
                 ('exponent', 'quant/powers_quadratics'),
                 ('quadratic', 'quant/powers_quadratics'),
                 ('probability', 'quant/probability_counting'),
                 ('counting', 'quant/probability_counting'),
                 ('arith_series', 'quant/series_number'),
                 ('geom_series', 'quant/series_number'),
                 ('modular', 'quant/series_number'),
                 ('recip', 'quant/series_number'),
                 ('symmetric', 'quant/series_number')
               ) as m (template, grp)
              where m.template = p_facet), p_facet)
           else p_facet
         end
$$;

revoke all on function hb.drill_facet(text, text) from public, anon, authenticated, service_role;

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
      select k.session_id, k.started_utc, k.counts, r.pretest, r.correct,
             i.status as item_status, f.axis, f.facet, p.model, p.a, p.b, p.c,
             hb.response_fits(ik.key,
               pg_catalog.jsonb_array_length(case when pg_catalog.jsonb_typeof(i.payload -> 'options') = 'array' then i.payload -> 'options' else '[]'::jsonb end),
               r.response) as in_space
        from known k
        cross join lateral hb.responses_of(k.session_id) r
        join public.items i on i.item_id = r.item_id
        join public.item_families f on f.family_id = i.family_id
        left join public.item_keys ik on ik.item_id = r.item_id
        left join lateral (
          select ip.model, ip.a, ip.b, ip.c
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
      select c.session_id, c.started_utc, c.counts, c.correct, c.axis, c.facet, c.model, c.a, c.b, c.c,
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
    -- the answers that count, each under its drill-down facet (hb.drill_facet: a quant template's answers count
    -- under its topic group). facet_ok: the facet counts the answer only if the same session holds at least
    -- v_min_facet counted answers on that facet (the axis counts it either way); no facet, never
    obs as (
      select c.axis, coalesce(c.facet, '') as facet, c.a, c.b, c.c, c.y,
             (c.facet is not null and pg_catalog.count(*) over (partition by c.session_id, c.axis, c.facet) >= v_min_facet) as facet_ok
        from (
          select c0.session_id, c0.axis, hb.drill_facet(c0.axis, c0.facet) as facet, c0.a, c0.b - r.rho as b, c0.c, c0.correct as y
            from cls c0
            join rho r on r.axis = c0.axis and r.session_id = c0.session_id
           where c0.outcome = 'scored'
        ) c
    ),
    grid as (
      select g.i, case when g.i = 60 then 4::double precision else -4::double precision + g.i * (8::double precision / 60) end as g
        from pg_catalog.generate_series(0, 60) g (i)
    ),
    -- log-likelihood of the observations of one (axis, facet, facet_ok) at each grid point: the 2PL/3PL
    -- terms of engine/irt.ts, in the same numerically stable form (log sigmoid, log-sum-exp)
    fll as (
      select o.axis, o.facet, o.facet_ok, gr.i, gr.g,
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
       group by o.axis, o.facet, o.facet_ok, gr.i, gr.g
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
               group by c.axis) w), '{}'::jsonb),
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
        'min_axis_items', v_min_axis, 'min_facet_items', v_min_facet, 'mean_step', v_mean_step, 'sd_step', v_sd_step),
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
