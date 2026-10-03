-- M2.2 (ROADMAP M2.2; DESIGN §7.7, §8, §10, §11.2, §13, R-11.1; ROADMAP A11, A16): the seen lists of a session.
-- Post-merge audit fix (wf7), reviewed and amended in wf9.
--
-- Found by the audit of the merged M2.1/M2.2: start_session took `seen_items` and `seen_families` from the
-- caller's save "without proof" and the selector excluded them from every pick. A script that listed every item
-- but one chose which item it was served first (ranked 41 of 90 at the prior; 12 items below it were excluded
-- too), and a chosen first item is what makes the one remaining channel on a verdict (which item comes next
-- depends on the answers so far; supabase/README.md, "What the next item tells") cheap to read: the script does
-- not wait for the item it wants to turn up, it asks for it. Proving the save does not help: the lists sit
-- outside the per-session MAC, and any person holds a signed session (they just finished one).
--
-- This does not touch that channel, which is an ACCEPTED risk (ROADMAP A24-sec, owner decision 2026-10-02) and
-- stays as it is. It keeps the client from steering randomesque selection and the 0.25 exposure cap, the
-- protections A24-sec counts on, by choosing which item it is served.
--
-- What keeps an item away from a session is now what this server knows, in two parts:
--
--   1. What it SERVED. The exposure log of every session of every anon_id the save proves (hb.save_proved_anons:
--      a signed session the server holds, issued to that id; a file merged from two devices proves both ids, R-8.1),
--      and the compacted arrays of those that hb db archive has archived, unanswered items included (a person
--      who was served an item has seen it), and the families of those items. A new anon_id (no save, an unproven
--      one, an offline file) has been served nothing.
--   2. What the file says it has seen, for PROCEDURAL families only: `item_families.source.type` is 'procedural'
--      (the bank's own flag for a generated family), and no item of the family carries authored content,
--      `provenance.finite_content`, as the reading gate questions do. The answers of such a family are computed by generators that are public (A1,
--      A11), so a client that steers which of its items it is served learns no key by it, and the lists are the
--      only record of what the person was shown OUTSIDE a server session: the reveal's three worked examples (a
--      matrix, a series and a quantitative item shown with their solutions, DESIGN §10, whose families the app
--      writes to `seen_families` so that a person who has seen a worked solution does not meet that question type,
--      or a near-isomorph of it, as a counted item later, §7.7), and whatever an offline or static-fallback session
--      served (a procedural family_id is one function in both repos, so a family the person met there is a family
--      of this bank, A11). Only ids that the bank itself knows and calls procedural count, so the state stays
--      bounded by the bank, and a file can name no finite-bank item or family: a client cannot enumerate their
--      family ids, and it cannot use a list to pick among the items it is served.
--
-- The cost: a person who lost their server rows (deleted them, or whose rows were purged) and whose file is
-- not signed gets finite-bank items they may have met (their procedural families still stay out). Items they met
-- on another device under the same anon_id, or under any id their file proves, are known to the server, so a
-- restore on a new device loses nothing.

set local role hb_definer;

-- The anon_ids a save proves: each id named by the `sig.anon_id` of a session of the file for which hb.session_owned
-- holds (the server holds the session, finished, issued to that id; the sig binds the same id; the MAC verifies). As
-- hb.save_proves_anon, only the first verify.max_sessions sessions are looked at and a file over verify.max_work
-- proves nothing; a candidate id is verified until one session of it holds, and a session whose sig names another id
-- costs one comparison. Sorted, without repeats; empty for a file that proves nothing.
create function hb.save_proved_anons(p_save jsonb)
returns text[]
language sql stable
set search_path = ''
as $$
  select case when pg_catalog.jsonb_typeof(p_save -> 'sessions') = 'array' and hb.save_work_ok(p_save) then
    coalesce((
      select pg_catalog.array_agg(c.anon_id order by c.anon_id)
        from (
          select distinct (e.value #>> '{sig,anon_id}') as anon_id
            from pg_catalog.jsonb_array_elements(p_save -> 'sessions') with ordinality e (value, ord)
           where e.ord <= hb.cfg_int('verify.max_sessions', 200)
             and pg_catalog.jsonb_typeof(e.value) = 'object'
             and (e.value #>> '{sig,anon_id}') is not null
        ) c
       where exists (
         select 1
           from pg_catalog.jsonb_array_elements(p_save -> 'sessions') with ordinality s (value, ord)
          where s.ord <= hb.cfg_int('verify.max_sessions', 200)
            and pg_catalog.jsonb_typeof(s.value) = 'object'
            and (s.value #>> '{sig,anon_id}') = c.anon_id
            and hb.session_owned(s.value, c.anon_id))
    ), '{}'::text[])
  else '{}'::text[] end
$$;

-- The lists a new session starts with, {items: [...], families: [...]}, sorted, without repeats: what this server
-- served to the anon_ids p_anon_ids (the ids the save proved) and the families of those items, and what p_save
-- lists of procedural items and families that the bank knows (the second part of the header).
create function hb.seen_for_session(p_anon_ids text[], p_save jsonb)
returns jsonb
language sql stable
set search_path = ''
as $$
  with mine as (
    select s.session_id from public.sessions s where s.anon_id = any (p_anon_ids)
  ),
  live as (
    select e.item_id, e.family_id
      from public.exposure_log e
      join mine m on m.session_id = e.session_id
  ),
  archived as (
    select a.elem ->> 1 as item_id
      from public.response_archive ra
      join mine m on m.session_id = ra.session_id
      cross join lateral pg_catalog.jsonb_array_elements(ra.items) as a(elem)
  ),
  served_ids as (
    select l.item_id from live l
    union
    select r.item_id from archived r where r.item_id is not null
  ),
  served_fams as (
    select l.family_id from live l
    union
    select i.family_id from public.items i join served_ids on served_ids.item_id = i.item_id
  ),
  said_items as (
    select e.value #>> '{}' as item_id
      from pg_catalog.jsonb_array_elements(case when pg_catalog.jsonb_typeof(p_save -> 'seen_items') = 'array' then p_save -> 'seen_items' else '[]'::jsonb end) e
     where pg_catalog.jsonb_typeof(e.value) = 'string'
  ),
  said_fams as (
    select e.value #>> '{}' as family_id
      from pg_catalog.jsonb_array_elements(case when pg_catalog.jsonb_typeof(p_save -> 'seen_families') = 'array' then p_save -> 'seen_families' else '[]'::jsonb end) e
     where pg_catalog.jsonb_typeof(e.value) = 'string'
  ),
  -- what the file names, as families of the bank: by family id, or by the family of an item of the bank
  said as (
    select f.family_id from said_fams f
    union
    select i.family_id from public.items i join said_items si on si.item_id = i.item_id
  ),
  -- the families among them that are procedural, with no authored content (a list may hold 20,000 ids)
  open_fams as (
    select f.family_id
      from public.item_families f
      join said s on s.family_id = f.family_id
     where (f.source ->> 'type') = 'procedural'
       and not exists (select 1 from public.items x where x.family_id = f.family_id and x.provenance ? 'finite_content')
  ),
  open_items as (
    select i.item_id
      from public.items i
      join said_items si on si.item_id = i.item_id
      join open_fams o on o.family_id = i.family_id
  ),
  all_ids as (
    select d.item_id from served_ids d
    union
    select o.item_id from open_items o
  ),
  all_fams as (
    select f.family_id from served_fams f
    union
    select o.family_id from open_fams o
  )
  select pg_catalog.jsonb_build_object(
    'items',    coalesce((select pg_catalog.jsonb_agg(d.item_id order by d.item_id) from all_ids d), '[]'::jsonb),
    'families', coalesce((select pg_catalog.jsonb_agg(f.family_id order by f.family_id) from all_fams f), '[]'::jsonb))
$$;

reset role;

-- start_session as in 20261001000600_rpc_session.sql, with the one change: the lists in sessions.state are
-- hb.seen_for_session(the anon_ids the save proves, the save), not the save's own lists. (`create or replace`
-- keeps the owner and the grants.)
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
          pg_catalog.jsonb_build_object('v', 1, 'seen_items', v_seen -> 'items', 'seen_families', v_seen -> 'families'));

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
