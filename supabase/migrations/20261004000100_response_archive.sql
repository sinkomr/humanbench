-- M2.5 (ROADMAP M2.5; DESIGN §11.3, §11.4, §11.5, F11; R-11.1, R-12.1; ROADMAP A6, AI.26): the nightly
-- archive and compaction.
--
-- DESIGN §11.3: "responses older than 30 days are exported (Parquet) ..., then compacted in the DB to one JSONB
-- array per session". The estimate there counts the responses table only; the exposure log (one row per item
-- served, with its own three indexes) is as big again, so this compacts both. The bank's `hb db archive` does the
-- export and decides what is old; this file is the database half, so that the part that deletes is in one place
-- and tested with the rest of the schema.
--
--   public.response_archive   one row per archived session: the session's exposure-log and response rows as
--                             a JSONB array of positional arrays (format 1, below), with the SHA-256 of that
--                             array and where the Parquet export of it went. ON DELETE CASCADE from sessions,
--                             so delete_my_data (which deletes the session) deletes the archive too (DESIGN §13).
--   hb.archive_items(sid)     the array of a session, built from the live rows
--   hb.archive_sha(items)     its digest
--   hb.archive_session(...)   the compaction of one session: archives it and deletes the live rows, in one
--                             statement's worth of work, and only if the session is dead (past its token's
--                             lifetime), consistent, not archived, and unchanged since the export (the digest)
--   hb.responses_of(sid)      the session's answers as `responses` rows, live or archived: what every reader of
--                             an old session's answers must use
--
-- Readers of old answers. rescore(save) re-scores a person's server sessions "from the raw responses the server
-- holds" (M2.1), and it does so for sessions of any age: a person who retests after four months sends the save
-- with the first session in it. If the first session's responses had been compacted away, rescore would have
-- scored one session fewer and, through hb.is_eligible, counted none of its client flags: a silent change of the
-- person's results. So rescore and hb.is_eligible, the only functions that read the answers of a session that
-- may be old, now read hb.responses_of (below; their bodies are those of M2.1 and M2.2 with that one change,
-- which web/scripts/db/migrations.test.ts checks against the earlier files), and archive.db.test.ts compares
-- rescore's reply and every eligibility before and after compaction. The functions of an active
-- session (submit, finish, next_item: integrity evidence, the grid, selection) read the live tables, because a
-- session is archived only after its token has expired. Nothing reads the exposure log of an old session.
--
-- Access (R-12.1): like every table, RLS on and no grant or policy for anon or authenticated. The compaction runs
-- as the migration role (`postgres`, the SUPABASE_DB_URL of the nightly job), the owner of the tables; the
-- functions are not SECURITY DEFINER and nobody else can call them. The nightly job, and the calibration job it
-- will run (M4.10), connect as that role and read old answers through hb.responses_of. service_role (an API key:
-- the bank's `hb load push`) cannot: like every API role it has no USAGE on schema hb (tested), so it cannot call
-- hb.responses_of. It may SELECT public.response_archive itself (it has BYPASSRLS), which is the raw arrays in an
-- internal format; hb_definer may too, for rescore.
--
-- Format 1 of an element of `items` (one per item served, in serving order), 12 positions:
--   0 seq   1 item_id   2 pretest (0/1)   3 served_us   4 response   5 correct   6 score   7 rt_ms
--   8 confidence   9 client_flags   10 answered_us   11 response_was_sql_null (1, else null)
-- served_us and answered_us are microseconds after sessions.started_at (an unanswered item has null at 4..10),
-- so the timestamps come back exactly. Positions 4 and 11 keep the difference between a JSON null response and
-- no value at all. score travels as the shortest text that reads back as the same real.

create table public.response_archive (
  session_id text primary key references public.sessions (session_id) on delete cascade,
  format smallint not null default 1 check (format = 1),
  n_served int not null check (n_served >= 1),
  n_answered int not null check (n_answered >= 0 and n_answered <= n_served),
  items jsonb not null check (pg_catalog.jsonb_typeof(items) = 'array' and hb.no_brief_prefs(items)),
  items_sha256 text not null check (items_sha256 ~ '^[0-9a-f]{64}$'),
  -- the release tag or file the Parquet export of this session went to (the archive is not the only copy)
  export_ref text not null check (export_ref <> ''),
  archived_at timestamptz not null default now()
);
comment on table public.response_archive is
  'Sessions whose exposure-log and response rows were compacted (hb db archive, M2.5; format 1 in the migration). Read through hb.responses_of(); the array format is internal.';

alter table public.response_archive enable row level security;
revoke all on table public.response_archive from public, anon, authenticated, service_role;
grant select on public.response_archive to hb_definer, service_role;
create policy hb_definer_read on public.response_archive for select to hb_definer using (true);

set local role hb_definer;

-- ------------------------------------------------------------------------------------ the array
create function hb.archive_items(p_session_id text)
returns jsonb
language sql stable
set search_path = ''
as $$
  select coalesce(pg_catalog.jsonb_agg(
           pg_catalog.jsonb_build_array(
             e.seq,
             e.item_id,
             case when e.pretest then 1 else 0 end,
             (extract(epoch from e.served_at - s.started_at) * 1000000)::bigint,
             r.response,
             r.correct,
             case when r.score is null then null else (r.score::text)::numeric end,
             r.rt_ms,
             r.confidence,
             r.client_flags,
             case when r.seq is null then null else (extract(epoch from r.created_at - s.started_at) * 1000000)::bigint end,
             case when r.seq is not null and r.response is null then 1 end)
           order by e.seq), '[]'::jsonb)
    from public.sessions s
    join public.exposure_log e on e.session_id = s.session_id
    left join public.responses r on r.session_id = e.session_id and r.seq = e.seq
   where s.session_id = p_session_id
$$;

create function hb.archive_sha(p_items jsonb)
returns text
language sql immutable
set search_path = ''
as $$ select pg_catalog.encode(pg_catalog.sha256(pg_catalog.convert_to(p_items::text, 'UTF8')), 'hex') $$;

-- ------------------------------------------------------------------------------ the compaction
-- Archives one session and deletes its live rows (the exposure log; the responses go with it, by the foreign
-- key). Returns what it did:
--   archived     done
--   missing      no such session
--   already      it has an archive row (nothing is deleted; a leftover live row is not touched)
--   empty        it has no exposure-log rows
--   too_recent   the session's token is still valid (an active or just-finished session is never compacted)
--   inconsistent a response whose item or pretest flag differs from its exposure row (the archive keeps one of
--                each, so it cannot hold both)
--   changed      the rows are not the ones whose digest the caller exported
-- The session row is locked first, as every RPC locks it, so a delete_my_data waits for the compaction (and then
-- deletes the archive row with the session) and a compaction waits for it.
create function hb.archive_session(p_session_id text, p_expected_sha text, p_export_ref text)
returns text
language plpgsql
set search_path = ''
as $$
declare
  s public.sessions;
  v_items jsonb;
  v_live_until timestamptz;
begin
  select * into s from public.sessions x where x.session_id = p_session_id for update;
  if not found then
    return 'missing';
  end if;
  if exists (select 1 from public.response_archive a where a.session_id = s.session_id) then
    return 'already';
  end if;
  v_live_until := case
    when s.finished_at is null then s.started_at + pg_catalog.make_interval(mins => hb.cfg_int('session.ttl_minutes', 720))
    else s.finished_at + pg_catalog.make_interval(mins => hb.cfg_int('session.post_finish_minutes', 1440))
  end;
  if pg_catalog.now() <= v_live_until then
    return 'too_recent';
  end if;
  v_items := hb.archive_items(s.session_id);
  if pg_catalog.jsonb_array_length(v_items) = 0 then
    return 'empty';
  end if;
  if exists (
    select 1 from public.responses r join public.exposure_log e on e.session_id = r.session_id and e.seq = r.seq
     where r.session_id = s.session_id and (r.item_id <> e.item_id or r.pretest <> e.pretest)) then
    return 'inconsistent';
  end if;
  if p_expected_sha is null or hb.archive_sha(v_items) <> p_expected_sha then
    return 'changed';
  end if;
  insert into public.response_archive (session_id, n_served, n_answered, items, items_sha256, export_ref)
  values (
    s.session_id,
    pg_catalog.jsonb_array_length(v_items),
    (select pg_catalog.count(*) from pg_catalog.jsonb_array_elements(v_items) x(el) where (x.el ->> 10) is not null)::int,
    v_items, p_expected_sha, p_export_ref);
  delete from public.exposure_log where session_id = s.session_id;
  return 'archived';
end
$$;

-- ---------------------------------------------------------------------------- the one reader
-- A session's answers as rows of `responses`: the live rows, plus the archived ones expanded (format 1). A
-- plpgsql-free SQL function with the session's id as its argument, so a join to it is one index lookup per
-- session whichever table holds the rows.
create function hb.responses_of(p_session_id text)
returns table (
  session_id text, seq int, item_id text, response jsonb, correct smallint, score real, rt_ms int,
  confidence smallint, pretest boolean, client_flags jsonb, created_at timestamptz)
language sql stable
set search_path = ''
as $$
  select r.session_id, r.seq, r.item_id, r.response, r.correct, r.score, r.rt_ms, r.confidence, r.pretest,
         r.client_flags, r.created_at
    from public.responses r
   where r.session_id = p_session_id
  union all
  select a.session_id,
         (x.el ->> 0)::int,
         x.el ->> 1,
         case when (x.el ->> 11) = '1' then null else x.el -> 4 end,
         (x.el ->> 5)::smallint,
         (x.el ->> 6)::real,
         (x.el ->> 7)::int,
         (x.el ->> 8)::smallint,
         (x.el ->> 2)::int = 1,
         x.el -> 9,
         s.started_at + ((x.el ->> 10)::bigint) * interval '1 microsecond'
    from public.response_archive a
    join public.sessions s on s.session_id = a.session_id
   cross join lateral pg_catalog.jsonb_array_elements(a.items) as x(el)
   where a.session_id = p_session_id and (x.el ->> 10) is not null
$$;

revoke all on function hb.archive_items(text), hb.archive_sha(jsonb), hb.archive_session(text, text, text),
  hb.responses_of(text) from public, anon, authenticated, service_role;

reset role;

-- The readers (the bodies are those of the earlier migrations, with `hb.responses_of(...)` in place of the
-- table; `create or replace` keeps the owner and the grants). hb.is_eligible: 20261002000200_session_scoring.sql.
-- public.rescore: 20261001000900_rpc_rescore.sql.
grant create on schema public to hb_definer;
set local role hb_definer;

create or replace function hb.is_eligible(p_session_id text, p_blind boolean default false)
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
    from hb.responses_of(p_session_id) r;
  v_count := v_count
    + (case when hb.truthy(s.flags -> 'uniform_rt') or hb.truthy(v_ev #> '{uniform_rt,flagged}') then 1 else 0 end)
    + (case when hb.truthy(s.flags -> 'hard_item_accuracy') or (not p_blind and hb.truthy(v_ev #> '{hard_item_accuracy,flagged}')) then 1 else 0 end);
  return v_count < 2;
end
$$;

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
    -- the answers that count. facet_ok: the facet counts the answer only if the same session holds at
    -- least v_min_facet counted answers on the facet (the axis counts it either way); no facet, never
    obs as (
      select c.axis, coalesce(c.facet, '') as facet, c.a, c.b - r.rho as b, c.c, c.correct as y,
             (c.facet is not null and pg_catalog.count(*) over (partition by c.session_id, c.axis, c.facet) >= v_min_facet) as facet_ok
        from cls c
        join rho r on r.axis = c.axis and r.session_id = c.session_id
       where c.outcome = 'scored'
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
    -- every axis here is published; a facet is computed only under one of them
    facet_w as (
      select f.axis, f.facet, f.i, f.g,
             pg_catalog.exp(greatest(lw.v - pg_catalog.max(lw.v) over (partition by f.axis, f.facet), -230)) as w
        from fll f
        join axis_raw e on e.axis = f.axis
       cross join lateral (
         select - 0.5 * (f.g - e.mean) * (f.g - e.mean) / greatest(e.sd * e.sd, 1e-12) + f.ll as v
       ) lw
       where f.facet <> '' and f.facet_ok
    ),
    facet_mean as (
      select axis, facet, pg_catalog.sum(w) as tw, pg_catalog.sum(w * g) / pg_catalog.sum(w) as mean from facet_w group by axis, facet
    ),
    facet_raw as (
      select m.axis, m.facet, m.mean,
             pg_catalog.sqrt(greatest(pg_catalog.sum(w.w * (w.g - m.mean) * (w.g - m.mean)) / m.tw, 0)) as sd,
             (select pg_catalog.count(*) from obs o where o.axis = m.axis and o.facet = m.facet and o.facet_ok) as n
        from facet_mean m join facet_w w on w.axis = m.axis and w.facet = m.facet
       group by m.axis, m.facet, m.mean, m.tw
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
