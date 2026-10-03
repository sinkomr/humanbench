-- M2.2 (ROADMAP M2.2; DESIGN §10, §11.2, §13, R-11.1; ROADMAP A16): the seen lists of a session come from the
-- server's own rows, never from the client. Post-merge audit fix (wf7).
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
-- So the lists are no longer read from the save at all. The save is still checked (an invalid one is still
-- 400, the anon_id still needs its proof) and its lists are still validated, but what keeps an item away from a
-- session is what this server knows it served to the session's anon_id:
--
--   * an anon_id the save proved (hb.save_proves_anon): every item in the exposure log of the sessions of that
--     anon_id, and in the compacted arrays of those that hb db archive has archived (format 1, position 1),
--     unanswered items included (a person who was served an item has seen it), and the families of those items;
--   * a new anon_id (no save, an unproven one, an offline file): nothing, as it has no sessions.
--
-- The cost: a person who lost their server rows (deleted them, or whose rows were purged) and whose file is
-- not signed gets items they may have met. Items they met on another device under the same anon_id are known
-- to the server, so a restore on a new device loses nothing. The offline version serves procedural items only,
-- which are not in the server's bank.

set local role hb_definer;

-- What this server has served to an anon_id: {items: [...], families: [...]}, sorted, without repeats.
-- Called by start_session with the anon_id the session will have (a fresh one has no rows).
create function hb.seen_by_anon(p_anon_id text)
returns jsonb
language sql stable
set search_path = ''
as $$
  with mine as (
    select s.session_id from public.sessions s where s.anon_id = p_anon_id
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
  ids as (
    select l.item_id from live l
    union
    select r.item_id from archived r where r.item_id is not null
  ),
  fams as (
    select l.family_id from live l
    union
    select i.family_id from public.items i join ids on ids.item_id = i.item_id
  )
  select pg_catalog.jsonb_build_object(
    'items',    coalesce((select pg_catalog.jsonb_agg(d.item_id order by d.item_id) from ids d), '[]'::jsonb),
    'families', coalesce((select pg_catalog.jsonb_agg(f.family_id order by f.family_id) from fams f), '[]'::jsonb))
$$;

reset role;

-- start_session as in 20261001000600_rpc_session.sql, with the one change: the lists in sessions.state are
-- hb.seen_by_anon(the session's anon_id), whatever the save listed. (`create or replace` keeps the owner and
-- the grants.)
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
    -- validated, as before, and then not used: the save's lists decide nothing (see the header)
    perform hb.check_id_list(p_save -> 'seen_items', 'seen_items');
    perform hb.check_id_list(p_save -> 'seen_families', 'seen_families');
  end if;

  -- The rate limit counts only calls that get this far (a rejected payload costs nothing).
  perform hb.purge_expired();
  perform hb.rate_hit('start_session', hb.ip_key('start_session'), hb.cfg_int('rate.sessions_per_day', 5));

  if v_claimed is not null and hb.save_proves_anon(p_save, v_claimed) then
    v_anon := v_claimed;
    v_adopted := true;
  else
    v_anon := 'hb_' || hb.rand_b62(16);
  end if;
  -- What keeps an item away from this session is what the server served to this anon_id, not what a save says.
  v_seen := hb.seen_by_anon(v_anon);
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
