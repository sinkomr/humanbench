-- M2.2 (ROADMAP M2.2; DESIGN §6.iii, §7.4, §7.7, §11.2, R-7.4, R-11.1; ROADMAP A9, A11, A18): server-side
-- item selection, replacing the random baseline of M2.1. The criterion, the exclusions and the
-- balancing are those of the app's selector (web/src/engine/selector.ts), applied to the bank's rows
-- instead of generated candidates.
--
-- A live slot (hb.rank_live):
--   1. candidates: live, not practice-only items that have a key and a dichotomous parameter row, on an
--      axis the call allows (p_axes, the current segment, null = all) whose posterior sd is still
--      >= selection.stop_sd (0.3, §7.4 "per-axis early stop"), that the session cannot already have
--      seen (the item, its family, its sibling group: in this session, in the save the session started
--      from, and the groups of the families in that save), and whose exposure is under the cap;
--   2. the criterion, §7.4: w_k * I_j(theta_k) * Var(theta_k) / E[T_j] with theta_k and Var(theta_k) the
--      session's EAP mean and variance on the axis (hb.session_posteriors), I_j the Fisher information
--      of the ITEM's model (2PL a²PQ; 3PL with its c; 2PL-testlet times selection.testlet_info_factor,
--      0.8, §7.1), w_k = 1 for the axes allowed, E[T_j] = hb.item_median_time_s;
--   3. one candidate per family_id (the best), as the app keeps one per family;
--   4. coverage floor, §7.4: while an allowed axis has fewer than selection.coverage_floor (3) items
--      (this session's, plus those of the save's seen_items on the axis), only those axes compete;
--   5. content balancing, the app's balanceFamilies: per axis only the candidates of the generator
--      family(ies) least served so far this session compete (matrices and series alternate on MAT), so
--      the criterion, which prefers the cheaper family, cannot leave an axis measured by one family;
--   6. randomesque: the top selection.top_k (5) by score, score desc then item_id, and one at random.
--
-- The exposure cap, §6.iii "an item's exposure rate may not exceed 0.25 of sessions": an item may be
-- served while (its sessions + 1) <= cap * max(sessions so far, selection.exposure_min_sessions). The
-- minimum keeps the first sessions from being refused every item (one session of one is a rate of 1), and
-- is the number of sessions at which the cap starts to bind. hb.serve_next increments the counter under
-- that same limit in one statement, so two sessions racing for the last place cannot both have it.
--
-- A pretest slot (DESIGN §6.iii "Seeding new items"): each session reserves at most selection.pretest_share
-- (10%) of its slots for items in status 'pretest': slot n+1 may be one only while (pretest so far + 1) <=
-- share * (n + 1), and then with probability selection.pretest_prob (0.5, so the slots are not at fixed
-- positions). The item is chosen by Thompson sampling on the expected information gain about its
-- difficulty b: each candidate draws b' ~ N(b, se_b²) (se_b from item_parameters, else
-- selection.pretest_default_se_b = 1, the prior sd of §6.ii), and the candidate with the largest
-- 0.5 * ln(1 + se_b² * I(theta; b')) wins, I being the Fisher information of the item at the session's
-- current estimate on its axis. A pretest answer is stored with pretest = true and counts for no score.
-- The client cannot tell a pretest item from a live one: item_view shows neither status nor flag.
--
-- Not here, because the app's selector gets them from the session flow: the remaining-time test
-- (remainingS), and the exposure cap and facet weights of AI.21b (goals sessions, Part 2, only if approved).

insert into public.app_config (key, value, description) values
  ('selection.exposure_cap',          '0.25', 'DESIGN §6.iii: an item may be served to at most this fraction of sessions'),
  ('selection.exposure_min_sessions', '20',   'the cap is applied to max(sessions so far, this), so it starts to bind after this many sessions: with the cap of 0.25, 5 sessions may see an item before then'),
  ('selection.top_k',                 '5',    'DESIGN §6.iii randomesque: one of the best k by information per second is served (selector.ts RANDOMESQUE_K)'),
  ('selection.coverage_floor',        '3',    'DESIGN §7.4: an allowed axis with fewer items than this (this session plus the save''s earlier ones) is served before the others (selector.ts COVERAGE_FLOOR)'),
  ('selection.stop_sd',               '0.3',  'DESIGN §7.4: an axis whose posterior sd is below this is done and gets no more items (selector.ts STOP_SD)'),
  ('selection.testlet_info_factor',   '0.8',  'DESIGN §7.1: a 2PL-testlet item counts for this fraction of a 2PL one''s information (selector.ts TESTLET_INFO_FACTOR)'),
  ('selection.pretest_share',         '0.1',  'DESIGN §6.iii: at most this fraction of a session''s items are pretest items'),
  ('selection.pretest_prob',          '0.5',  'when a pretest slot is open, the chance it is taken at this item'),
  ('selection.pretest_default_se_b',  '1',    'sd of the prior on b of a pretest item whose parameter row has no se_b (DESIGN §6.ii)');

set local role hb_definer;

-- -------------------------------------------------------------------------------- information
-- Fisher information of an item at theta by the item's own model (A9; selector.ts itemInformation):
-- 2PL a² P Q, 3PL a² (P - c)² (1 - P) / (P (1 - c)²), and the 2PL-testlet's times p_factor. For a
-- logit so negative that the 3PL's s² would underflow the information is below 1e-100 and is 0.
create function hb.item_info(p_model text, p_a double precision, p_b double precision, p_c double precision, p_theta double precision, p_factor double precision)
returns double precision
language plpgsql immutable parallel safe
set search_path = ''
as $$
declare
  z double precision := p_a * (p_theta - p_b);
  s double precision := hb.sigmoid(z);
  q double precision := hb.sigmoid(- z);
begin
  if p_model = '3pl' then
    if s < 1e-100::double precision then return 0; end if;
    return (p_a * p_a * s * s * (1 - p_c) * q) / (p_c + (1 - p_c) * s);
  end if;
  return (case when p_model = '2pl_testlet' then p_factor else 1 end) * (p_a * p_a * s * q);
end
$$;

-- The exposure limit in sessions: cap * max(sessions so far, minimum). An item whose count is n may be
-- served again if n + 1 <= this.
create function hb.exposure_limit()
returns double precision
language sql stable
set search_path = ''
as $$
  select hb.cfg_num('selection.exposure_cap', 0.25)
         * greatest((select pg_catalog.count(*) from public.sessions)::double precision, hb.cfg_int('selection.exposure_min_sessions', 20)::double precision)
$$;

-- The axes a call is restricted to (the current segment): null = all, else a non-empty list of axis codes,
-- sorted and without repeats. 400 invalid_axes otherwise.
create function hb.check_axes(p_axes text[])
returns text[]
language plpgsql stable
set search_path = ''
as $$
begin
  if p_axes is null then
    return null;
  end if;
  if pg_catalog.cardinality(p_axes) = 0 or pg_catalog.cardinality(p_axes) > 64
     or exists (select 1 from pg_catalog.unnest(p_axes) a where a is null or not (a = any (hb.axis_codes()))) then
    perform hb.fail(400, 'invalid_axes', 'p_axes is a list of axis codes: ' || pg_catalog.array_to_string(hb.axis_codes(), ', '));
  end if;
  return array(select distinct a from pg_catalog.unnest(p_axes) a order by a);
end
$$;

-- ------------------------------------------------------------------------------------ candidates
-- The items this session may be served now, of status p_status ('live' or 'pretest'), with what the ranking
-- needs: the item's parameters, E[T], the session's posterior on its axis and the item's exposure count.
-- p_exclude: items to leave out (ones that a concurrent session has just used up). See the header for the
-- conditions. Columns are prefixed o_ so they cannot clash with the tables' columns in the body.
create function hb.candidate_items(p_s public.sessions, p_axes text[], p_status text, p_exclude text[])
returns table (
  o_item_id text, o_family_id text, o_sibling_group text, o_axis text, o_gkey text,
  o_model text, o_a double precision, o_b double precision, o_c double precision, o_se_b double precision,
  o_mean double precision, o_sd double precision, o_et double precision, o_n_sessions bigint)
language plpgsql stable
set search_path = ''
as $$
declare
  v_state jsonb := coalesce(p_s.state, '{}'::jsonb);
  v_seen_items text[] := array(select x from pg_catalog.jsonb_array_elements_text(case when pg_catalog.jsonb_typeof(v_state -> 'seen_items') = 'array' then v_state -> 'seen_items' else '[]'::jsonb end) x);
  v_seen_fams text[] := array(select x from pg_catalog.jsonb_array_elements_text(case when pg_catalog.jsonb_typeof(v_state -> 'seen_families') = 'array' then v_state -> 'seen_families' else '[]'::jsonb end) x);
  v_limit double precision := hb.exposure_limit();
  v_stop double precision := hb.cfg_num('selection.stop_sd', 0.3);
  v_excl text[] := coalesce(p_exclude, '{}'::text[]);
begin
  return query
  with post as (
    select * from hb.session_posteriors(v_state)
  ),
  used as (
    select e.item_id, e.family_id, e.sibling_group from public.exposure_log e where e.session_id = p_s.session_id
  ),
  seen_item as (
    select x as item_id from pg_catalog.unnest(v_seen_items) x
    union
    select u.item_id from used u
  ),
  seen_fam as (
    select x as family_id from pg_catalog.unnest(v_seen_fams) x
    union
    select i.family_id from public.items i join seen_item si on si.item_id = i.item_id
    union
    select u.family_id from used u
  ),
  bad_group as (
    select f.sibling_group from public.item_families f join seen_fam sf on sf.family_id = f.family_id
    union
    select u.sibling_group from used u
  )
  select i.item_id, i.family_id, f.sibling_group, f.axis, coalesce(f.generator, ''),
         p.model, p.a, p.b, p.c, p.se_b,
         po.mean, po.sd,
         -- hb.item_median_time_s written out: a function call per row costs more than the rest of the row (50,000
         -- rows: 0.6 s); the length-based prior is computed only for an item that has neither time
         coalesce(
           case when pg_catalog.jsonb_typeof(p.extra -> 'median_time_s') = 'number' and (p.extra ->> 'median_time_s')::double precision > 0
                then (p.extra ->> 'median_time_s')::double precision end,
           case when pg_catalog.jsonb_typeof(p.extra -> 'expected_time_s') = 'number' and (p.extra ->> 'expected_time_s')::double precision > 0
                then (p.extra ->> 'expected_time_s')::double precision end,
           hb.item_prior_time_s(i.payload)),
         coalesce(x.n_sessions, 0)
    from public.items i
    join public.item_families f on f.family_id = i.family_id
    join post po on po.axis = f.axis
    join lateral (
      select ip.model, ip.a, ip.b, ip.c, ip.se_b, ip.extra
        from public.item_parameters ip
       where ip.item_id = i.item_id and (p_s.param_version is null or ip.param_version = p_s.param_version)
       order by ip.created_at desc
       limit 1) p on true
    left join public.item_exposure x on x.item_id = i.item_id
   where i.status = p_status
     and not f.practice_only
     and (p_axes is null or f.axis = any (p_axes))
     and po.sd >= v_stop
     and p.model in ('2pl', '2pl_testlet', '3pl')
     and p.a is not null and p.b is not null
     and (p.model <> '3pl' or (p.c is not null and p.c > 0 and p.c < 1))
     and exists (select 1 from public.item_keys k where k.item_id = i.item_id)
     and coalesce(x.n_sessions, 0) + 1 <= v_limit
     and not (i.item_id = any (v_excl))
     and not exists (select 1 from seen_item si where si.item_id = i.item_id)
     and not exists (select 1 from seen_fam sf where sf.family_id = i.family_id)
     and not exists (select 1 from bad_group bg where bg.sibling_group = f.sibling_group);
end
$$;

-- ----------------------------------------------------------------------------------- live slots
-- The top selection.top_k candidates of a live slot, best first (see the header, 2 to 6): o_rank is the
-- 0-based position. The pick is one of these at random (hb.pick_item).
create function hb.rank_live(p_s public.sessions, p_axes text[], p_exclude text[])
returns table (o_item_id text, o_family_id text, o_axis text, o_gkey text, o_score double precision, o_info double precision, o_rank int)
language plpgsql stable
set search_path = ''
as $$
declare
  v_floor int := hb.cfg_int('selection.coverage_floor', 3);
  v_top_k int := greatest(hb.cfg_int('selection.top_k', 5), 1);
  v_factor double precision := hb.cfg_num('selection.testlet_info_factor', 0.8);
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
    select c.*, k.info, k.info * c.o_sd * c.o_sd / c.o_et as score
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
    select s.o_family_id as family_id from scored s group by s.o_family_id having pg_catalog.count(*) > 1
  ),
  best as (
    select s.* from scored s where s.o_family_id not in (select d.family_id from dup_family d)
    union all
    (select distinct on (s.o_family_id) s.*
       from scored s
      where s.o_family_id in (select d.family_id from dup_family d)
      order by s.o_family_id, s.score desc, s.o_item_id)
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
    select distinct b.o_axis as axis
      from best b
      left join given g on g.axis = b.o_axis
     where coalesce(g.n, 0) < v_floor
  ),
  restricted as (
    select b.* from best b
     where not exists (select 1 from under) or b.o_axis in (select u.axis from under u)
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
      left join served sv on sv.axis = r.o_axis and sv.gkey = r.o_gkey
  ),
  least_served as (
    select c.o_axis as axis, pg_catalog.min(c.n_served) as m from counted c group by c.o_axis
  ),
  balanced as (
    select c.* from counted c join least_served l on l.axis = c.o_axis where c.n_served <= l.m
  ),
  top as (
    select b.o_item_id, b.o_family_id, b.o_axis, b.o_gkey, b.score, b.info
      from balanced b
     order by b.score desc, b.o_item_id
     limit v_top_k
  )
  select t.o_item_id, t.o_family_id, t.o_axis, t.o_gkey, t.score, t.info,
         (pg_catalog.row_number() over (order by t.score desc, t.o_item_id))::int - 1
    from top t
   order by t.score desc, t.o_item_id;
end
$$;

-- ---------------------------------------------------------------------------------- pretest slots
-- Thompson sampling on the expected information gain about b (see the header). Volatile: the draws.
create function hb.thompson_pick(p_s public.sessions, p_axes text[], p_exclude text[])
returns text
language plpgsql volatile
set search_path = ''
as $$
declare
  v_default_se double precision := greatest(hb.cfg_num('selection.pretest_default_se_b', 1), 1e-6::double precision);
  v_pick text;
begin
  with cand as materialized (
    select c.*, coalesce(nullif(c.o_se_b, 0), v_default_se) as se,
           pg_catalog.sqrt(-2 * pg_catalog.ln(1 - pg_catalog.random())) * pg_catalog.cos(2 * pg_catalog.pi() * pg_catalog.random()) as z
      from hb.candidate_items(p_s, p_axes, 'pretest', p_exclude) c
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

-- ------------------------------------------------------------------------------------ the pick
-- One item for the next slot, or null when there is none. A live slot: one of the top k at random. A
-- pretest slot: the Thompson sample's best.
create function hb.pick_item(p_s public.sessions, p_axes text[] default null, p_pretest boolean default false, p_exclude text[] default null)
returns text
language plpgsql volatile
set search_path = ''
as $$
declare
  v_pick text;
begin
  if p_pretest then
    return hb.thompson_pick(p_s, p_axes, p_exclude);
  end if;
  select r.o_item_id into v_pick from hb.rank_live(p_s, p_axes, p_exclude) r order by pg_catalog.random() limit 1;
  return v_pick;
end
$$;

-- The item the session should answer next: the one served and not yet answered (a reload gets the same
-- item), else a newly picked one, logged as an exposure. {done: true, reason} when the session has had its
-- items ('item_limit'), every allowed axis is done ('axes_done') or the bank has nothing left for it
-- ('no_items').
create function hb.serve_next(p_s public.sessions, p_axes text[] default null)
returns jsonb
language plpgsql volatile
set search_path = ''
as $$
declare
  v_pending record;
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
    return hb.item_view(v_pending.item_id, v_pending.seq);
  end if;

  if p_s.n_served >= hb.cfg_int('session.max_items', 200) then
    return pg_catalog.jsonb_build_object('done', true, 'reason', 'item_limit');
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
    -- statement return nothing, and the next attempt picks again without that item
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
  return hb.item_view(v_pick, v_seq);
end
$$;

reset role;
