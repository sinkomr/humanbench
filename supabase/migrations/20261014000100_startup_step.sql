-- M2.2 (ROADMAP M2.2, A9, A24-sec; DESIGN §6.iii, §7.4, §11.2, R-7.4, R-11.1), amended after the owner's full
-- session of 2026-10-12 ("was the test i took adaptive? ... it seemed like it didnt"; "many of the questions are
-- too easy"): the start-up of a part's item selection, and where its items are aimed. The same rule as the
-- app's selector (web/src/engine/startup.ts, web/src/engine/selector.ts), which
-- web/scripts/db/startup.db.test.ts holds this file to on the same answer sequences.
--
-- WHY. hb.rank_live picked the item with the most information per second at the session's posterior mean, the
-- EAP under the N(0, 1) prior. With items of discrimination about 1 one answer weighs at most a quarter of the
-- prior, so after a run of correct answers the mean has barely moved, and the criterion divides by time, which
-- favours the quicker, easier items. In the owner's session every part began near b = -1 to 0 and, with 64 of 67
-- right, had reached only b = +1.0 to +1.2 by its last question, while the pool held items up to b = 3 and above.
--
-- THE RULE, in two parts. Neither changes a score.
--
--   1. THE START-UP (hb.startup_targets). A run of answers that are all correct (or all wrong) has no finite
--      maximum-likelihood estimate. Until the session's scored answers on an axis are mixed, the next item is
--      aimed one step beyond the last one:
--        * the first item on an axis is picked as before;
--        * while every scored, non-pretest answer of this session on the axis is correct, the target is the
--          difficulty b of the last unit answered plus selection.startup_step (1: one stratum); while every one
--          is wrong, minus that; clamped to [selection.startup_min, selection.startup_max];
--        * at the first reversal the start-up is over for the axis in this session, for good.
--      A UNIT is an item, or the questions of one set (a passage) together: its b is the mean of its scored
--      questions', it counts as correct when all of them were answered correctly, as wrong when none was, and
--      anything in between is a reversal. An answer the session's score does not count (hb.eap_add_response: a
--      pretest answer, one with no verdict, one outside the item's answer space such as a question that ran out
--      of time or was let go, one on a quarantined item) is not an answer here either: it neither steps nor
--      reverses.
--      While an axis has a target, only the units whose b is within selection.startup_window (0.5) of it compete
--      for a live slot, or, when the session has none there, the nearest ones. The filter comes AFTER
--      hb.candidate_items, so the exposure cap, the seen lists and the family and sibling exclusions are what
--      they were, and BEFORE the choice of one candidate per family, the coverage floor, the balancing of
--      generator families and the randomesque top k, which then work on what is left as before.
--   2. THE AIM (hb.session_aims). Once the start-up is over the criterion decides alone, and its information is
--      evaluated not at the posterior mean but at the EAP under a prior selection.aim_prior_sd_factor (2) times
--      as wide: the scoring prior pulls the mean of a strong record a full stratum toward 0, which is right for a
--      score and wrong for placing the next item. The variance in the criterion is still the scoring posterior's,
--      as is the per-axis stop (selection.stop_sd) and every score. A factor of 1 gives the posterior mean back.
--
-- SETS. A passage is entered as one unit and its questions follow in order whatever is answered (the rule of
-- 20261013000100_item_sets.sql, unchanged): the start-up acts only where a set is entered, on the set's mean b.
--
-- TO SWITCH IT OFF: selection.startup_step = 0 (no targets) and selection.aim_prior_sd_factor = 1.
--
-- WHAT A CLIENT CAN LEARN (ROADMAP A24-sec, the accepted adaptive channel). Which item comes next already depended
-- on whether the last answer was right. During the start-up that dependence is plainer (a harder item follows a
-- correct answer, an easier one a miss) and lasts until the first reversal; nothing new is put in a reply, and
-- the bounds of A24-sec are the ones in force: the exposure cap, the top k at random, the session rate limit.
-- Pretest slots (hb.thompson_pick) are not touched.

insert into public.app_config (key, value, description) values
  ('selection.startup_step',         '1',    'DESIGN §7.4, startup.ts STARTUP_STEP: until the first reversal on an axis the next item is aimed this far above the last one after correct answers, below after misses; 0 switches the start-up off'),
  ('selection.startup_window',       '0.5',  'startup.ts STARTUP_WINDOW: during the start-up the items within this of the target compete (or the nearest)'),
  ('selection.startup_min',          '-3.5', 'startup.ts STARTUP_MIN: the start-up target is never below this'),
  ('selection.startup_max',          '3.5',  'startup.ts STARTUP_MAX: the start-up target is never above this'),
  ('selection.aim_prior_sd_factor',  '2',    'startup.ts SELECTION_PRIOR_SD_FACTOR: the information of a candidate is evaluated at the EAP under a prior this many times as wide as the scoring prior; 1 is the posterior mean');

set local role hb_definer;

-- Where each axis's items are aimed: the EAP mean of the session's grid log-likelihood under the wider selection
-- prior. An axis with no scored answer has its prior mean, as hb.session_axis_post gives it.
create function hb.session_aims(p_state jsonb)
returns table (axis text, aim double precision)
language plpgsql stable
set search_path = ''
as $$
declare
  v_codes text[] := hb.axis_codes();
  v_f double precision := greatest(hb.cfg_num('selection.aim_prior_sd_factor', 2), 1e-6::double precision);
  v_node jsonb;
  v_ll double precision[];
  v_e record;
begin
  for i in 1..pg_catalog.array_length(v_codes, 1) loop
    axis := v_codes[i];
    aim := hb.axis_prior_mean(axis);
    v_node := coalesce(p_state, '{}'::jsonb) #> array['eap', axis];
    if pg_catalog.jsonb_typeof(v_node -> 'll') = 'array' and coalesce((v_node ->> 'n')::int, 0) > 0 then
      v_ll := array(select x::double precision from pg_catalog.jsonb_array_elements_text(v_node -> 'll') x);
      select * into v_e from hb.eap_from_ll(v_ll, hb.axis_prior_mean(axis), hb.axis_prior_var(axis) * v_f * v_f);
      aim := v_e.o_mean;
    end if;
    return next;
  end loop;
end
$$;

-- The start-up target of each axis that has one (the header, 1): a row per axis whose scored answers in this
-- session all say the same thing. No row: the axis has no scored answer yet, or its start-up is over.
create function hb.startup_targets(p_s public.sessions)
returns table (axis text, target double precision)
language sql stable
set search_path = ''
as $$
  with answered as (
    -- this session's answers that its score counts, exactly those hb.eap_add_response adds to the EAP: not a
    -- pretest answer, with a verdict, on an item that is not quarantined and has a dichotomous parameter row for
    -- the session's parameter version, and inside the item's answer space (so not one that ran out of time)
    select r.seq, f.axis, r.correct, p.b,
           case when i.item_type = any (hb.set_item_types()) then 'set:' || i.family_id else 'item:' || i.item_id end as unit
      from public.responses r
      join public.items i on i.item_id = r.item_id
      join public.item_families f on f.family_id = i.family_id
      join public.item_keys ik on ik.item_id = i.item_id
      join lateral (
        select ip.model, ip.a, ip.b, ip.c
          from public.item_parameters ip
         where ip.item_id = i.item_id and (p_s.param_version is null or ip.param_version = p_s.param_version)
         order by ip.created_at desc
         limit 1) p on true
     where r.session_id = p_s.session_id and not r.pretest and r.correct is not null
       and i.status <> 'quarantined'
       and p.model in ('2pl', '2pl_testlet', '3pl') and p.a is not null and p.b is not null
       and (p.model <> '3pl' or (p.c is not null and p.c > 0 and p.c < 1))
       and hb.response_fits(ik.key, pg_catalog.jsonb_array_length(case when pg_catalog.jsonb_typeof(i.payload -> 'options') = 'array' then i.payload -> 'options' else '[]'::jsonb end), r.response)
  ),
  unit as (
    select a.axis, a.unit, pg_catalog.min(a.seq) as first_seq, pg_catalog.avg(a.b) as b,
           pg_catalog.sum(a.correct) as n_correct, pg_catalog.count(*) as n
      from answered a
     group by a.axis, a.unit
  ),
  said as (
    select u.axis,
           pg_catalog.count(*) filter (where u.n_correct = u.n) as n_up,
           pg_catalog.count(*) filter (where u.n_correct = 0) as n_down,
           pg_catalog.count(*) filter (where u.n_correct > 0 and u.n_correct < u.n) as n_mixed,
           (pg_catalog.array_agg(u.b order by u.first_seq desc))[1] as last_b
      from unit u
     group by u.axis
  )
  select s.axis,
         least(hb.cfg_num('selection.startup_max', 3.5),
               greatest(hb.cfg_num('selection.startup_min', -3.5),
                        s.last_b + case when s.n_up > 0 then 1 else -1 end * hb.cfg_num('selection.startup_step', 1)))
    from said s
   where hb.cfg_num('selection.startup_step', 1) > 0
     and s.n_mixed = 0
     and (s.n_up = 0 or s.n_down = 0)
$$;

-- hb.rank_live as in 20261013000100_item_sets.sql (a set is one unit), with the information of a candidate
-- evaluated at the axis's aim, and with the start-up filter between the candidates and the choice of one per
-- family. With selection.startup_step = 0 and selection.aim_prior_sd_factor = 1 it ranks exactly as before.
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
begin
  return query
  with cand as (
    -- o_aim: where the axis's items are aimed, the estimate under the wider selection prior (the header, 2)
    select c.*, coalesce(am.aim, c.o_mean) as o_aim
      from hb.candidate_items(p_s, p_axes, 'live', p_exclude) c
      left join hb.session_aims(p_s.state) am on am.axis = c.o_axis
  ),
  -- the criterion. hb.item_info written out (with its underflow guard: a 3PL item whose s would square to
  -- nothing has no information worth a number): a function call per row is the largest cost of the row
  scored as (
    select c.o_item_id as item_id, c.o_family_id as family_id, c.o_axis as axis, c.o_gkey as gkey, c.o_sd as sd, c.o_et as et, c.o_b as b,
           k.info, k.info * c.o_sd * c.o_sd / c.o_et as score,
           exists (select 1 from public.items it where it.item_id = c.o_item_id and it.item_type = any (v_types)) as in_set
      from cand c
     cross join lateral (
       select (case when c.o_model = '3pl' then (case when w.s < 1e-100::double precision then 0::double precision
                                                       else (c.o_a * c.o_a * w.s * w.s * (1 - c.o_c) * w.q) / (c.o_c + (1 - c.o_c) * w.s) end)
                    else (case when c.o_model = '2pl_testlet' then v_factor else 1::double precision end) * (c.o_a * c.o_a * w.s * w.q) end) as info
         from (
           select case when z.v >= 0 then 1 / (1 + z.e) else z.e / (1 + z.e) end as s,
                  case when z.v >= 0 then z.e / (1 + z.e) else 1 / (1 + z.e) end as q
             from (select c.o_a * (c.o_aim - c.o_b) as v, pg_catalog.exp(- least(pg_catalog.abs(c.o_a * (c.o_aim - c.o_b)), 700::double precision)) as e) z) w) k
  ),
  -- a set: its questions together, entered at its first; only when every servable question of it is a candidate.
  -- Its difficulty, for the start-up, is the mean of its questions'
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
  -- everything that could take the slot: single items, and sets as units
  unit as (
    select s.item_id, s.family_id, s.axis, s.gkey, s.info, s.score, s.b, false as is_set from scored s where not s.in_set
    union all
    select u.item_id, u.family_id, u.axis, u.gkey, u.info, u.score, u.b, true from set_unit u
  ),
  -- the start-up (the header, 1): on an axis that has a target, the units within the window of it, or the nearest
  dist as (
    select u.*, t.target, pg_catalog.abs(u.b - t.target) as d
      from unit u
      left join hb.startup_targets(p_s) t on t.axis = u.axis
  ),
  nearest as (
    select d.axis, pg_catalog.min(d.d) as m from dist d where d.target is not null group by d.axis
  ),
  aimed as (
    select d.item_id, d.family_id, d.axis, d.gkey, d.info, d.score, d.is_set
      from dist d
      left join nearest n on n.axis = d.axis
     where d.target is null or d.d <= greatest(v_window, n.m) + 1e-9::double precision
  ),
  -- one candidate per family_id, the best; a sort only for the families that have more than one candidate
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
  -- items already given on each axis: this session's scored ones and the save's earlier ones
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
    select f.axis, coalesce(f.generator, '') as gkey, pg_catalog.count(*) as n
      from public.exposure_log e
      join public.item_families f on f.family_id = e.family_id
     where e.session_id = p_s.session_id and not e.pretest
     group by f.axis, coalesce(f.generator, '')
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
