-- M2.1 (ROADMAP M2.1; DESIGN §11.2, §13, R-11.1, R-12.1; ROADMAP A16, AI.26): the session RPCs.
--
--   start_session(p_device, p_save)  -> {session_id, token, anon_id, anon_id_adopted, ...}   the token is shown once
--   next_item(p_token)               -> {seq, item} | {done, reason}         the pending item, or a new one
--   submit(p_token, p_item_id, ...)  -> {ack, seq, next}                     scores in SQL, no verdict returned
--   finish(p_token, p_flags)         -> {session, calibration_eligible, ...} the session as a save-v1 session
--
-- All are SECURITY DEFINER, owned by hb_definer, with search_path = '' and EXECUTE for anon and
-- authenticated only. Each rejects a payload that holds a brief_prefs key anywhere (AI.26). No
-- response carries a key, a tolerance, a rationale, a parameter or a verdict on an answer.
--
-- The anon_id: a label, not a credential (it is in the person's file and may be seen by others). The
-- server continues the anon_id of a save only when the save proves it, i.e. holds a session this server
-- issued to that anon_id (hb.save_proves_anon). Otherwise it issues a fresh one and says so
-- (anon_id_adopted: false), and the client re-keys its file. Never adopting an unproven id is what keeps
-- a stranger who knows someone's anon_id from getting sessions, a mirror or a deletion under it.
--
-- Limits (DESIGN §11.2): 5 start_session calls a day per hashed(IP + daily salt); 200 items a
-- session; an average of at least 2 s per answered item (checked from the server's own clock, after
-- 10 answers). All the numbers are rows of app_config.

grant create on schema public to hb_definer;
set local role hb_definer;

create function public.start_session(p_device jsonb, p_save jsonb default null)
returns jsonb
language plpgsql security definer
set search_path = ''
as $$
declare
  v_anon text;
  v_claimed text;
  v_adopted boolean := false;
  v_seen_items jsonb := '[]'::jsonb;
  v_seen_families jsonb := '[]'::jsonb;
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
    v_seen_items := hb.check_id_list(p_save -> 'seen_items', 'seen_items');
    v_seen_families := hb.check_id_list(p_save -> 'seen_families', 'seen_families');
  end if;

  -- The rate limit counts only calls that get this far (a rejected payload costs nothing).
  perform hb.purge_expired();
  perform hb.rate_hit('start_session', hb.ip_key('start_session'), hb.cfg_int('rate.sessions_per_day', 5));

  -- The seen lists only keep items away from this session, so they need no proof; the anon_id does.
  if v_claimed is not null and hb.save_proves_anon(p_save, v_claimed) then
    v_anon := v_claimed;
    v_adopted := true;
  else
    v_anon := 'hb_' || hb.rand_b62(16);
  end if;
  v_session_id := 's_' || hb.rand_b62(16);
  v_token := hb.new_token();
  insert into public.sessions (session_id, anon_id, token_hash, bank_version, param_version, device, state)
  values (v_session_id, v_anon, hb.token_hash(v_token), v_bank, v_params, p_device,
          pg_catalog.jsonb_build_object('v', 1, 'seen_items', v_seen_items, 'seen_families', v_seen_families));

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

create function public.next_item(p_token text)
returns jsonb
language plpgsql security definer
set search_path = ''
as $$
declare
  s public.sessions;
begin
  s := hb.session_for_token(p_token);
  return hb.serve_next(s);
end
$$;

-- One answer. The item must be one this session was served and not yet answered (a repeat of an
-- answered item is acknowledged and changes nothing, so a retry after a lost reply is safe). The
-- answer is scored here, against the key that never leaves the database; the reply says only that it
-- was received (and, unless p_next is false, hands over the next item in the same round trip).
create function public.submit(
  p_token text,
  p_item_id text,
  p_response jsonb,
  p_rt_ms integer,
  p_confidence integer default null,
  p_client_flags jsonb default null,
  p_next boolean default true
)
returns jsonb
language plpgsql security definer
set search_path = ''
as $$
declare
  s public.sessions;
  v_exp public.exposure_log;
  v_flags jsonb := coalesce(p_client_flags, '{}'::jsonb);
  v_prior_s double precision;
  v_n int;
  v_avg_ms double precision;
  v_correct smallint;
  v_score real;
  v_out jsonb;
begin
  perform hb.reject_brief_prefs(p_response);
  perform hb.reject_brief_prefs(p_client_flags);
  s := hb.session_for_token(p_token);

  if p_item_id is null or pg_catalog.char_length(p_item_id) > 256 then
    perform hb.fail(400, 'invalid_item');
  end if;
  if p_rt_ms is null or p_rt_ms < 0 or p_rt_ms > 3600000 then
    perform hb.fail(400, 'invalid_rt', 'rt_ms is milliseconds, 0 to 3,600,000.');
  end if;
  if p_confidence is not null and (p_confidence < 0 or p_confidence > 100) then
    perform hb.fail(400, 'invalid_confidence', 'confidence is a percentage, 0 to 100.');
  end if;
  if not hb.valid_flags(v_flags) then
    perform hb.fail(400, 'invalid_flags', 'client_flags: snake_case names with number, boolean or null values, at most 40.');
  end if;
  if pg_catalog.octet_length(coalesce(p_response::text, '')) + pg_catalog.octet_length(v_flags::text) > hb.cfg_int('payload.max_response_bytes', 65536) then
    perform hb.fail(413, 'response_too_large');
  end if;

  select * into v_exp from public.exposure_log e where e.session_id = s.session_id and e.item_id = p_item_id;
  if not found then
    perform hb.fail(404, 'item_not_served', 'This session was not served that item.');
  end if;

  if not exists (select 1 from public.responses r where r.session_id = s.session_id and r.seq = v_exp.seq) then
    -- DESIGN §11.2: an average under session.min_avg_ms per answered item blocks the session. The
    -- clock is the server's (served_at to now), not the client's rt_ms.
    select coalesce(pg_catalog.sum(extract(epoch from r.created_at - e.served_at)), 0) into v_prior_s
      from public.responses r join public.exposure_log e on e.session_id = r.session_id and e.seq = r.seq
     where r.session_id = s.session_id;
    v_n := s.n_answered + 1;
    v_avg_ms := (v_prior_s + extract(epoch from pg_catalog.now() - v_exp.served_at)) * 1000.0 / v_n;
    if v_n >= hb.cfg_int('session.min_avg_after', 10) and v_avg_ms < hb.cfg_int('session.min_avg_ms', 2000) then
      perform hb.fail(429, 'too_fast', 'Answers are coming in faster than a person reads the items.');
    end if;

    select sc.o_correct, sc.o_score into v_correct, v_score from hb.score_response(p_item_id, p_response) sc;
    insert into public.responses (session_id, seq, item_id, response, correct, score, rt_ms, confidence, pretest, client_flags)
    values (s.session_id, v_exp.seq, p_item_id, p_response, v_correct, v_score, p_rt_ms, p_confidence::smallint, v_exp.pretest, v_flags);
    update public.sessions set n_answered = n_answered + 1 where session_id = s.session_id;
  end if;

  v_out := pg_catalog.jsonb_build_object('ack', true, 'seq', v_exp.seq);
  if coalesce(p_next, true) then
    v_out := v_out || pg_catalog.jsonb_build_object('next', hb.serve_next(s));
  end if;
  return v_out;
end
$$;

-- Closes the session and returns it as a save-v1 session object, ready for the client to merge into
-- its save (the per-session signature is M2.3). p_flags is the client's integrity report (the §8
-- session flags); the server adds its own time check and decides calibration eligibility (§13).
create function public.finish(p_token text, p_flags jsonb default null)
returns jsonb
language plpgsql security definer
set search_path = ''
as $$
declare
  s public.sessions;
  v_flags jsonb := coalesce(p_flags, '{}'::jsonb);
  v_total_s double precision;
  v_avg_ms double precision;
  v_too_fast boolean;
  v_eligible boolean;
begin
  perform hb.reject_brief_prefs(p_flags);
  s := hb.session_for_token(p_token, true);
  if not hb.valid_flags(v_flags) then
    perform hb.fail(400, 'invalid_flags', 'flags: snake_case names with number, boolean or null values, at most 40.');
  end if;

  if s.finished_at is null then
    select coalesce(pg_catalog.sum(extract(epoch from r.created_at - e.served_at)), 0) into v_total_s
      from public.responses r join public.exposure_log e on e.session_id = r.session_id and e.seq = r.seq
     where r.session_id = s.session_id;
    v_avg_ms := case when s.n_answered > 0 then v_total_s * 1000.0 / s.n_answered end;
    v_too_fast := s.n_answered >= hb.cfg_int('session.min_avg_after', 10) and v_avg_ms < hb.cfg_int('session.min_avg_ms', 2000);
    update public.sessions
       set finished_at = pg_catalog.now(),
           flags = v_flags || pg_catalog.jsonb_build_object(
             'server_too_fast', v_too_fast,
             'server_avg_item_ms', case when v_avg_ms is null then null else pg_catalog.round(v_avg_ms::numeric, 0) end)
     where session_id = s.session_id;
    v_eligible := hb.is_eligible(s.session_id);
    update public.sessions
       set calibration_eligible = v_eligible,
           flags = flags || pg_catalog.jsonb_build_object('calibration_eligible', v_eligible)
     where session_id = s.session_id;
  end if;

  select x.calibration_eligible into v_eligible from public.sessions x where x.session_id = s.session_id;
  return pg_catalog.jsonb_build_object(
    'session', hb.session_object(s.session_id),
    'anon_id', s.anon_id,
    'calibration_eligible', v_eligible,
    'n_responses', (select x.n_answered from public.sessions x where x.session_id = s.session_id));
end
$$;

-- ------------------------------------------------------------------------------ who may call what
revoke all on function public.start_session(jsonb, jsonb) from public, anon, authenticated, service_role;
revoke all on function public.next_item(text) from public, anon, authenticated, service_role;
revoke all on function public.submit(text, text, jsonb, integer, integer, jsonb, boolean) from public, anon, authenticated, service_role;
revoke all on function public.finish(text, jsonb) from public, anon, authenticated, service_role;
grant execute on function public.start_session(jsonb, jsonb) to anon, authenticated;
grant execute on function public.next_item(text) to anon, authenticated;
grant execute on function public.submit(text, text, jsonb, integer, integer, jsonb, boolean) to anon, authenticated;
grant execute on function public.finish(text, jsonb) to anon, authenticated;

reset role;
revoke create on schema public from hb_definer;
