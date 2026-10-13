-- M3.11 (ROADMAP M3.11 phase 2; DESIGN §3 rows 3 and 4, §6.iii, §7.1, §7.4, §11.2, R-7.4, R-11.1; ROADMAP A9, A11):
-- item sets. The questions of one passage (or of one logic game) are served together.
--
-- Before this, the selector kept one candidate per family_id and never served a family twice in a session. The
-- questions of a passage share one family (A11: the family is the passage), so a person was served one question
-- of a passage and never the rest, and after one question of each passage the axis answered `no_items`
-- (supabase/README.md, "The second load: not made").
--
-- The rule, in four parts:
--
--   1. WHAT A SET IS. The live, servable questions of one family_id whose item_type is one of
--      selection.set_item_types ('mc_passage', 'mc_logic_game'). The item type is the bank's own statement that
--      the question is read against a shared text; it does not depend on the parameter row, so a four-option
--      passage question stored as a 3PL is a set member like a five-option one stored as a 2PL-testlet. An item of
--      any other type is served as before, one per family: nothing changes for the procedural pool or for text
--      multiple choice (hb.rank_live gives the same ranking, scores and ties for them).
--   2. THE ORDER is the item_id, compared byte by byte (collation "C"): stable across sessions and persons, and
--      under the bank's control (it numbers a passage's questions q1, q2, ...; zero-padded from ten on). The
--      first question in that order is the set's ENTRY.
--   3. ENTERING A SET. A set competes for a live slot as ONE unit, with the criterion of §7.4 for the unit:
--      (sum of its questions' information) * Var(theta) / (sum of their E[T]), each question's information by its
--      own model (a 2PL-testlet's times selection.testlet_info_factor, 0.8, §7.1: the discount for the shared
--      text). The reading time belongs in the entry's E[T]. The coverage floor, content balancing and the
--      randomesque top k treat the unit like an item, and the item picked is the entry. A set is a candidate only
--      whole: every servable question of it must be one this session may be served (so a set is never entered at
--      its second question because the first is at the exposure cap or lost a race).
--   4. INSIDE A SET. While the last item served to the session is a question of a set and the call allows its
--      axis, the next item is the set's next question in order, before anything else is considered: no other
--      item, no pretest slot, no per-axis stop (posterior sd < selection.stop_sd) and no exposure cap can come
--      between two questions of a passage. A question that ran out of time or was let go does not end the set. A
--      call whose p_axes leaves the axis out (the client moved to another part) ends it: the rest is never
--      served to this person, in this session or a later one (the family is one they have been served).
--
-- EXPOSURE IS COUNTED PER PASSAGE. The 0.25 cap of §6.iii is applied where a set is entered: the entry's row of
-- item_exposure is the number of sessions that were served the passage, and it is increased under the cap by
-- the same single statement as for any item (two sessions racing for the last place cannot both have it). The
-- later questions are counted without a limit of their own, so their rows say how many sessions reached them.
--
-- SCORING IS UNCHANGED, and counts questions: each answer is scored against its own key by hb.score_response,
-- enters the session's grid EAP (hb.eap_add_response) and the MAP at finish as a dichotomous answer by its own
-- model (a 2PL-testlet as a 2PL, as the app does; grouping a set's answers into one testlet term with its random
-- effect is M3.9's), and rescore() counts each toward rescore.min_axis_items. Two passages of three questions are
-- six answers on the axis.
--
-- WHAT A REPLY GAINS (hb.served_view), and nothing else:
--   * `set: {position, of}` next to `seq` and `item`, for a question of a set of two or more: its place among
--     the set's questions served to this session (1 for the first) and how many the session will be served in
--     all. The client needs it to keep the passage on screen between two questions and not to end a part in the
--     middle of a passage. It is a function of the bank's rows and of what was served, never of an answer (and
--     it is not named `index`, the name of a key's field); a family_id is still in no reply.
--   * `item.media.attribution`, for a set question whose payload has a `media` object without one: the family's
--     `source.attribution` (the credit line a licence such as CC BY requires to be shown with the text). It is the
--     bank's public source line, cut to 1,000 characters.
-- No key, tolerance, rationale, parameter, status or verdict is added to any reply (R-11.1), and the accepted
-- adaptive channel (ROADMAP A24-sec) gets narrower, not wider: inside a set the next item does not depend on
-- the answers.
--
-- PRETEST SLOTS do not take set questions (hb.thompson_pick leaves them out): a question picked alone would open
-- its passage in the middle of the session's pretest budget. Pretesting a passage needs a rule of its own; until
-- then a set question is served only when it is live.

insert into public.app_config (key, value, description) values
  ('selection.set_item_types', '["mc_passage","mc_logic_game"]', 'DESIGN §7.1: the item types whose questions are served as a set, all the live questions of one family_id together and in item_id order (a passage, a logic game)');

set local role hb_definer;

-- The item types served as sets (the setting; the default when it is missing or not a list).
create function hb.set_item_types()
returns text[]
language sql stable
set search_path = ''
as $$
  select case when pg_catalog.jsonb_typeof(c.v) = 'array'
              then array(select x from pg_catalog.jsonb_array_elements_text(c.v) x)
              else array['mc_passage', 'mc_logic_game']::text[] end
    from (select hb.cfg('selection.set_item_types') as v) c
$$;

-- The servable questions of a set, in order: the live items of the family whose type is a set type, that have
-- a key and a dichotomous parameter row for the session's parameter version (the conditions of
-- hb.candidate_items that do not depend on the session). o_pos is 1 for the entry. Empty for a family that is
-- not a set, is practice-only or has no such question.
create function hb.set_questions(p_family_id text, p_param_version text)
returns table (o_item_id text, o_pos int)
language sql stable
set search_path = ''
as $$
  select i.item_id, (pg_catalog.row_number() over (order by i.item_id collate pg_catalog."C"))::int
    from public.items i
    join public.item_families f on f.family_id = i.family_id
    join lateral (
      select ip.model, ip.a, ip.b, ip.c
        from public.item_parameters ip
       where ip.item_id = i.item_id and (p_param_version is null or ip.param_version = p_param_version)
       order by ip.created_at desc
       limit 1) p on true
   where i.family_id = p_family_id
     and i.status = 'live'
     and not f.practice_only
     and i.item_type = any (hb.set_item_types())
     and p.model in ('2pl', '2pl_testlet', '3pl')
     and p.a is not null and p.b is not null
     and (p.model <> '3pl' or (p.c is not null and p.c > 0 and p.c < 1))
     and exists (select 1 from public.item_keys k where k.item_id = i.item_id)
   order by i.item_id collate pg_catalog."C"
$$;

-- What a session is handed of an item it is served: hb.item_view, and for a question of a set its place in
-- the set and the source line of the shared text (see the header, "What a reply gains").
create function hb.served_view(p_s public.sessions, p_item_id text, p_seq int)
returns jsonb
language plpgsql stable
set search_path = ''
as $$
declare
  v_view jsonb := hb.item_view(p_item_id, p_seq);
  v record;
  v_index int;
  v_served int;
  v_left int;
begin
  select i.item_type, i.family_id, f.source ->> 'attribution' as attribution
    into v
    from public.items i join public.item_families f on f.family_id = i.family_id
   where i.item_id = p_item_id;
  if not found or not (v.item_type = any (hb.set_item_types())) then
    return v_view;
  end if;
  if v.attribution is not null and pg_catalog.btrim(v.attribution) <> ''
     and pg_catalog.jsonb_typeof(v_view #> '{item,media}') = 'object'
     and not ((v_view #> '{item,media}') ? 'attribution') then
    v_view := pg_catalog.jsonb_set(v_view, '{item,media,attribution}', pg_catalog.to_jsonb(pg_catalog.left(pg_catalog.btrim(v.attribution), 1000)));
  end if;
  select pg_catalog.count(*) filter (where e.seq <= p_seq), pg_catalog.count(*)
    into v_index, v_served
    from public.exposure_log e
   where e.session_id = p_s.session_id and e.family_id = v.family_id;
  select pg_catalog.count(*) into v_left
    from hb.set_questions(v.family_id, p_s.param_version) q
   where not exists (select 1 from public.exposure_log e where e.session_id = p_s.session_id and e.item_id = q.o_item_id);
  if v_served + v_left >= 2 then
    v_view := v_view || pg_catalog.jsonb_build_object('set', pg_catalog.jsonb_build_object('position', v_index, 'of', v_served + v_left));
  end if;
  return v_view;
end
$$;

-- hb.rank_live as in 20261002000300_selection.sql, with a set as one unit (the header, 3). For candidates that
-- are not set questions every step is the one of before: the same criterion, one candidate per family, the
-- coverage floor, the balancing and the top k.
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
  v_state jsonb := coalesce(p_s.state, '{}'::jsonb);
  v_seen_items text[] := array(select x from pg_catalog.jsonb_array_elements_text(case when pg_catalog.jsonb_typeof(v_state -> 'seen_items') = 'array' then v_state -> 'seen_items' else '[]'::jsonb end) x);
begin
  return query
  with cand as (
    select * from hb.candidate_items(p_s, p_axes, 'live', p_exclude)
  ),
  -- the criterion. hb.item_info written out (with its underflow guard: a 3PL item whose s would square to
  -- nothing has no information worth a number): a function call per row is the largest cost of the row
  scored as (
    select c.o_item_id as item_id, c.o_family_id as family_id, c.o_axis as axis, c.o_gkey as gkey, c.o_sd as sd, c.o_et as et,
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
             from (select c.o_a * (c.o_mean - c.o_b) as v, pg_catalog.exp(- least(pg_catalog.abs(c.o_a * (c.o_mean - c.o_b)), 700::double precision)) as e) z) w) k
  ),
  -- one candidate per family_id, the best; a sort only for the families that have more than one candidate
  dup_family as (
    select s.family_id from scored s where not s.in_set group by s.family_id having pg_catalog.count(*) > 1
  ),
  -- a set: its questions together, entered at its first; only when every servable question of it is a candidate
  set_unit as (
    select q.entry as item_id, g.family_id, g.axis, g.gkey, g.info, g.info * g.sd * g.sd / g.et as score
      from (
        select s.family_id, pg_catalog.min(s.axis) as axis, pg_catalog.min(s.gkey) as gkey, pg_catalog.min(s.sd) as sd,
               pg_catalog.sum(s.info) as info, pg_catalog.sum(s.et) as et, pg_catalog.count(*) as n
          from scored s
         where s.in_set
         group by s.family_id) g
     cross join lateral (
       select pg_catalog.count(*) as n, pg_catalog.min(sq.o_item_id) filter (where sq.o_pos = 1) as entry
         from hb.set_questions(g.family_id, p_s.param_version) sq) q
     where g.n = q.n and q.entry is not null
  ),
  best as (
    select s.item_id, s.family_id, s.axis, s.gkey, s.info, s.score
      from scored s
     where not s.in_set and s.family_id not in (select d.family_id from dup_family d)
    union all
    (select distinct on (s.family_id) s.item_id, s.family_id, s.axis, s.gkey, s.info, s.score
       from scored s
      where not s.in_set and s.family_id in (select d.family_id from dup_family d)
      order by s.family_id, s.score desc, s.item_id)
    union all
    select u.item_id, u.family_id, u.axis, u.gkey, u.info, u.score from set_unit u
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

-- hb.thompson_pick as before, without the questions of sets (the header, "Pretest slots").
create or replace function hb.thompson_pick(p_s public.sessions, p_axes text[], p_exclude text[])
returns text
language plpgsql volatile
set search_path = ''
as $$
declare
  v_default_se double precision := greatest(hb.cfg_num('selection.pretest_default_se_b', 1), 1e-6::double precision);
  v_types text[] := hb.set_item_types();
  v_pick text;
begin
  with cand as materialized (
    select c.*, coalesce(nullif(c.o_se_b, 0), v_default_se) as se,
           pg_catalog.sqrt(-2 * pg_catalog.ln(1 - pg_catalog.random())) * pg_catalog.cos(2 * pg_catalog.pi() * pg_catalog.random()) as z
      from hb.candidate_items(p_s, p_axes, 'pretest', p_exclude) c
     where not exists (select 1 from public.items it where it.item_id = c.o_item_id and it.item_type = any (v_types))
  )
  select g.o_item_id into v_pick
    from (
      select c.o_item_id,
             0.5 * pg_catalog.ln(1 + c.se * c.se * hb.item_info(c.o_model, c.o_a, c.o_b + c.se * c.z, c.o_c, c.o_mean, 1)) as gain
        from cand c
    ) g
   order by g.gain desc, g.o_item_id
   limit 1;
  return v_pick;
end
$$;

-- hb.serve_next as before, with the set that is under way served first (the header, 4), and hb.served_view for
-- what is handed over.
create or replace function hb.serve_next(p_s public.sessions, p_axes text[] default null)
returns jsonb
language plpgsql volatile
set search_path = ''
as $$
declare
  v_pending record;
  v_last record;
  v_pick text;
  v_pre boolean := false;
  v_try boolean;
  v_n_pre int;
  v_seq int;
  v_family text;
  v_group text;
  v_excl text[] := '{}';
  v_limit double precision;
  v_got bigint;
begin
  select e.seq, e.item_id into v_pending
    from public.exposure_log e
   where e.session_id = p_s.session_id
     and not exists (select 1 from public.responses r where r.session_id = e.session_id and r.seq = e.seq)
   order by e.seq
   limit 1;
  if found then
    return hb.served_view(p_s, v_pending.item_id, v_pending.seq);
  end if;

  if p_s.n_served >= hb.cfg_int('session.max_items', 200) then
    return pg_catalog.jsonb_build_object('done', true, 'reason', 'item_limit');
  end if;

  -- the set that is under way: its next question, whatever else could be picked
  select e.family_id, e.sibling_group, e.pretest, i.item_type, f.axis into v_last
    from public.exposure_log e
    join public.items i on i.item_id = e.item_id
    join public.item_families f on f.family_id = i.family_id
   where e.session_id = p_s.session_id
   order by e.seq desc
   limit 1;
  if found and not v_last.pretest and v_last.item_type = any (hb.set_item_types()) and (p_axes is null or v_last.axis = any (p_axes)) then
    select q.o_item_id into v_pick
      from hb.set_questions(v_last.family_id, p_s.param_version) q
     where not exists (select 1 from public.exposure_log e where e.session_id = p_s.session_id and e.item_id = q.o_item_id)
     order by q.o_pos
     limit 1;
    if v_pick is not null then
      -- counted, without a cap of its own: the cap was applied where the set was entered
      insert into public.item_exposure as x (item_id, n_sessions) values (v_pick, 1)
      on conflict (item_id) do update set n_sessions = x.n_sessions + 1;
      v_seq := p_s.n_served + 1;
      insert into public.exposure_log (session_id, seq, item_id, family_id, sibling_group, pretest)
      values (p_s.session_id, v_seq, v_pick, v_last.family_id, v_last.sibling_group, false);
      update public.sessions set n_served = v_seq where session_id = p_s.session_id;
      return hb.served_view(p_s, v_pick, v_seq);
    end if;
  end if;

  -- a pretest slot is open while (pretest so far + 1) <= share * (slot number); then it is taken at random
  select pg_catalog.count(*) into v_n_pre from public.exposure_log e where e.session_id = p_s.session_id and e.pretest;
  v_try := (v_n_pre + 1) <= hb.cfg_num('selection.pretest_share', 0.1) * (p_s.n_served + 1) + 1e-9
           and pg_catalog.random() < hb.cfg_num('selection.pretest_prob', 0.5);
  v_limit := hb.exposure_limit();

  for attempt in 1..4 loop
    v_pick := null;
    v_pre := false;
    if v_try then
      v_pick := hb.pick_item(p_s, p_axes, true, v_excl);
      v_pre := v_pick is not null;
    end if;
    if v_pick is null then
      v_pick := hb.pick_item(p_s, p_axes, false, v_excl);
    end if;
    if v_pick is null then
      exit;
    end if;
    -- the cap, enforced where the counter changes: a concurrent session that took the last place makes this
    -- statement return nothing, and the next attempt picks again without that item (for a set: without the set)
    v_got := null;
    insert into public.item_exposure as x (item_id, n_sessions) values (v_pick, 1)
    on conflict (item_id) do update set n_sessions = x.n_sessions + 1 where x.n_sessions + 1 <= v_limit
    returning x.n_sessions into v_got;
    exit when v_got is not null;
    v_excl := v_excl || v_pick;
    v_pick := null;
  end loop;

  if v_pick is null then
    return pg_catalog.jsonb_build_object('done', true, 'reason',
      case when exists (
             select 1 from hb.session_posteriors(p_s.state) po
              where (p_axes is null or po.axis = any (p_axes)) and po.sd >= hb.cfg_num('selection.stop_sd', 0.3))
           then 'no_items' else 'axes_done' end);
  end if;

  select i.family_id, f.sibling_group into v_family, v_group
    from public.items i join public.item_families f on f.family_id = i.family_id where i.item_id = v_pick;
  v_seq := p_s.n_served + 1;
  insert into public.exposure_log (session_id, seq, item_id, family_id, sibling_group, pretest)
  values (p_s.session_id, v_seq, v_pick, v_family, v_group, v_pre);
  update public.sessions set n_served = v_seq where session_id = p_s.session_id;
  return hb.served_view(p_s, v_pick, v_seq);
end
$$;

reset role;
