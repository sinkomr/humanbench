-- M2.1 (ROADMAP M2.1; DESIGN §8 "Optional server mirror", §13, R-12.1; ROADMAP A16, AI.26): the
-- server mirror and deletion.
--
--   mirror_put(p_token, p_save, p_phrase)  store the person's save; the first put returns a 12-word
--                                          recovery phrase, once; later puts must present it
--   mirror_get(p_anon_id, p_phrase)        restore on a new device: anon_id + phrase, no session
--   delete_my_data(p_anon_id, p_phrase, p_save)
--                                          delete everything stored for an anon_id, proved by the
--                                          recovery phrase or by a save file (DESIGN §13)
--
-- AI.26 / R-17.1: every one of them rejects a payload that holds a `brief_prefs` key anywhere, and the
-- mirror table itself refuses such a blob, so the mirror holds the save without the notes settings.
-- The client strips them before upload (toUploadPayload, M2.7); the server rejects what slips through
-- instead of silently editing a person's backup.
--
-- Only SHA-256(phrase) is stored. A wrong phrase and an unknown anon_id look the same: both return
-- {found: false} / {deleted: false}, and both are counted against the caller's address (counts are
-- kept, so these return instead of raising).

grant create on schema public to hb_definer;
set local role hb_definer;

create function public.mirror_put(p_token text, p_save jsonb, p_phrase text default null)
returns jsonb
language plpgsql security definer
set search_path = ''
as $$
declare
  s public.sessions;
  v_anon text;
  v_bytes int;
  v_row public.mirror;
  v_phrase text;
  v_n int;
begin
  s := hb.session_for_token(p_token, true);
  v_anon := hb.check_save(p_save);
  if v_anon <> s.anon_id then
    perform hb.fail(403, 'anon_id_mismatch', 'The save belongs to a different anon_id than this session.');
  end if;
  v_bytes := pg_catalog.octet_length(p_save::text);
  if v_bytes > hb.cfg_int('mirror.max_bytes', 524288) then
    perform hb.fail(413, 'save_too_large', 'The server backup holds up to ' || hb.cfg_int('mirror.max_bytes', 524288) || ' bytes.');
  end if;
  perform hb.rate_hit('mirror_put', hb.ip_key('mirror_put'), hb.cfg_int('rate.mirror_puts_per_day', 30));

  select * into v_row from public.mirror m where m.anon_id = v_anon for update;
  if found then
    if not hb.phrase_ok(p_phrase, v_row.phrase_hash) then
      return pg_catalog.jsonb_build_object('stored', false, 'error', 'wrong_phrase');
    end if;
    update public.mirror set blob = p_save, size_bytes = v_bytes, updated_at = pg_catalog.now() where anon_id = v_anon;
    return pg_catalog.jsonb_build_object('stored', true, 'anon_id', v_anon, 'size_bytes', v_bytes);
  end if;

  if (select pg_catalog.count(*) from public.mirror) >= hb.cfg_int('mirror.max_rows', 5000) then
    perform hb.fail(507, 'mirror_full', 'The server backup is not taking new saves right now.');
  end if;
  v_phrase := hb.new_phrase();
  insert into public.mirror (anon_id, phrase_hash, blob, size_bytes)
  values (v_anon, hb.phrase_hash(v_phrase), p_save, v_bytes)
  on conflict (anon_id) do nothing;
  get diagnostics v_n = row_count;
  if v_n = 0 then
    perform hb.fail(409, 'mirror_exists', 'A backup for this anon_id was just created; present its phrase.');
  end if;
  return pg_catalog.jsonb_build_object('stored', true, 'anon_id', v_anon, 'size_bytes', v_bytes, 'recovery_phrase', v_phrase);
end
$$;

create function public.mirror_get(p_anon_id text, p_phrase text)
returns jsonb
language plpgsql security definer
set search_path = ''
as $$
declare
  v_row public.mirror;
begin
  perform hb.rate_hit('mirror_get', hb.ip_key('mirror_get'), hb.cfg_int('rate.mirror_gets_per_day', 60));
  if p_anon_id is not null and p_anon_id ~ '^hb_[0-9A-Za-z]{16,17}$' then
    select * into v_row from public.mirror m where m.anon_id = p_anon_id;
  end if;
  if hb.phrase_ok(p_phrase, v_row.phrase_hash) then
    return pg_catalog.jsonb_build_object('found', true, 'save', v_row.blob,
      'updated_utc', pg_catalog.to_char(v_row.updated_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"'));
  end if;
  return pg_catalog.jsonb_build_object('found', false);
end
$$;

-- Deletes the sessions (and with them responses, exposure log, reports, survey) and the mirror of one
-- anon_id. Proof, either of: the recovery phrase of its mirror; or a save file that lists a session the
-- server issued to that anon_id (hb.save_proves_anon: since M2.3 the session must also carry the server's
-- MAC for that anon_id). The anon_id inside the file does not matter, only the sessions: a merged
-- file proves each of the ids its sessions were issued to. Nothing about the proof is revealed on
-- failure, and each failure counts against the address, which is refused once it has used up its
-- failures (the same counter as the phrase).
create function public.delete_my_data(p_anon_id text, p_phrase text default null, p_save jsonb default null)
returns jsonb
language plpgsql security definer
set search_path = ''
as $$
declare
  v_row public.mirror;
  v_ip text := hb.ip_key('phrase_fail');
  v_proved boolean := false;
  v_sessions int := 0;
  v_mirror int := 0;
begin
  if p_anon_id is null or p_anon_id !~ '^hb_[0-9A-Za-z]{16,17}$' then
    perform hb.fail(400, 'invalid_anon_id');
  end if;
  if p_phrase is null and p_save is null then
    perform hb.fail(400, 'invalid_request', 'Send the recovery phrase or a save file.');
  end if;
  perform hb.rate_hit('delete_my_data', hb.ip_key('delete_my_data'), hb.cfg_int('rate.deletes_per_day', 10));

  if p_save is not null then
    perform hb.check_save(p_save);
  end if;

  if p_phrase is not null then
    select * into v_row from public.mirror m where m.anon_id = p_anon_id;
    v_proved := hb.phrase_ok(p_phrase, v_row.phrase_hash);
  end if;
  if not v_proved and p_save is not null then
    if hb.rate_count('phrase_fail_ip', v_ip) >= hb.cfg_int('rate.phrase_failures_per_ip_day', 60) then
      perform hb.fail(429, 'rate_limited', 'too many wrong proofs today');
    end if;
    v_proved := hb.save_proves_anon(p_save, p_anon_id);
    if not v_proved then
      perform hb.rate_bump('phrase_fail_ip', v_ip);
    end if;
  end if;
  if not v_proved then
    return pg_catalog.jsonb_build_object('deleted', false);
  end if;

  delete from public.mirror where anon_id = p_anon_id;
  get diagnostics v_mirror = row_count;
  delete from public.sessions where anon_id = p_anon_id;
  get diagnostics v_sessions = row_count;
  return pg_catalog.jsonb_build_object('deleted', true, 'sessions', v_sessions, 'mirror', v_mirror > 0);
end
$$;

revoke all on function public.mirror_put(text, jsonb, text) from public, anon, authenticated, service_role;
revoke all on function public.mirror_get(text, text) from public, anon, authenticated, service_role;
revoke all on function public.delete_my_data(text, text, jsonb) from public, anon, authenticated, service_role;
grant execute on function public.mirror_put(text, jsonb, text) to anon, authenticated;
grant execute on function public.mirror_get(text, text) to anon, authenticated;
grant execute on function public.delete_my_data(text, text, jsonb) to anon, authenticated;

reset role;
revoke create on schema public from hb_definer;
