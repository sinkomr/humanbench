-- M2.2 (ROADMAP M2.2, M3.12, "Owner decisions 2026-10-16"; DESIGN §7.4, R-7.4, §11.2): inside a part, rank the
-- candidates by information alone, not information per second. The same criterion as the app's selector
-- (web/src/engine/selector.ts criterion, SELECTION_TIME_EXPONENT), which web/scripts/db/selection.db.test.ts holds this
-- file to under both settings.
--
-- WHY. The owner asked whether "information per second" is right inside a part; the lead's answer, accepted: hard items
-- take longer (a stratum 6 matrix 70-95 s, a stratum 6 logical reasoning item about 114 s against 73 s at stratum 4), so
-- dividing by E[T] pulls a strong taker back from the hard strata to quicker, easier items once the start-up is over:
-- with matrices 1.3.0, series 1.4.0, rotation 1.4.0 and quant 1.4.0 the Spatial part of a taker at theta = +2.5 did not
-- get harder at all. Inside a part the time is already rationed elsewhere, and all of that stays: the part's budget and
-- the minimum of six answered (client), the per-question caps, the hard stop, and E[T] in what fits in the time left.
-- Simulated before and after: `npm run sim:cat -- --part e` (ROADMAP "Owner decisions 2026-10-16").
--
-- THE CHANGE. score = info * Var(theta_k) / E[T]^p with p = app_config selection.time_exponent, 0 (new): information
-- alone. hb.rank_live is re-created from 20261016000100_cross_skill_aim.sql with exactly that change, in the two places
-- a score is made (an item, and a passage set's summed information over its summed time). power(et, 0) = 1 and
-- power(et, 1) = et exactly, so either setting is the same arithmetic as the app's.
--
-- TO SWITCH IT BACK: selection.time_exponent = 1 (information per second, as from 20261002000300_selection.sql), and
-- SELECTION_TIME_EXPONENT = 1 in the app, so the device's own parts and the served ones rank alike.
--
-- WHAT IS NOT CHANGED. Every score, the posterior, the aim, the start-up window, exposure caps, seen lists, family and
-- sibling exclusion, sets, the coverage floor, the balancing and the randomesque top k. No key or item content is read
-- or returned that was not before; replies keep their shape (ROADMAP A24-sec: which item comes next already depended on
-- the answers; it still depends on nothing else).

insert into public.app_config (key, value, description) values
  ('selection.time_exponent', '0', 'engine/selector.ts SELECTION_TIME_EXPONENT: the exponent of E[T] in the criterion info * Var / E[T]^p inside a part; 0: information alone (from 2026-10-16, owner decision); 1: information per second, as before');

set local role hb_definer;

-- hb.rank_live as in 20261016000100_cross_skill_aim.sql, with the one change: the score divides by E[T]^p, p the setting.
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
  v_p double precision := greatest(coalesce(hb.cfg_num('selection.time_exponent', 0), 0), 0::double precision);
begin
  return query
  with cand as (
    select c.*, coalesce(am.aim, c.o_mean) as o_aim
      from hb.candidate_items(p_s, p_axes, 'live', p_exclude) c
      left join hb.session_aims(p_s.state, p_axes) am on am.axis = c.o_axis
  ),
  scored as (
    select c.o_item_id as item_id, c.o_family_id as family_id, c.o_axis as axis, c.o_gkey as gkey, c.o_sd as sd, c.o_et as et, c.o_b as b,
           k.info, k.info * c.o_sd * c.o_sd / pg_catalog.power(c.o_et, v_p) as score,
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
    select q.entry as item_id, g.family_id, g.axis, g.gkey, g.info, g.info * g.sd * g.sd / pg_catalog.power(g.et, v_p) as score, g.b
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
