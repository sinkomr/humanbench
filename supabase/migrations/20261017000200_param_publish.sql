-- M4.10 (ROADMAP M4.10, M2.5, A16; DESIGN §6.iii step 5 "write new item_parameters rows (versioned), re-score recent
-- sessions, and publish bank_version", §7.8 "always re-score from raw responses with current item parameters", §11.4,
-- §12, §13, R-11.1, R-12.1): the database half of publishing a new parameter set. The bank's nightly calibration
-- (`hb.calib.job`, run by `hb db nightly`) fits the parameters, writes the rows of a new param_version, records the run in
-- calibration_runs and sets app_config param_version (and bank_version when it quarantined items) in one transaction;
-- then it re-scores the recent finished sessions with this function, one session a transaction.
--
-- WHAT A NEW PARAMETER SET REACHES BY ITSELF. Every reader of item_parameters takes the row of a param_version: a new
-- session records app_config param_version at start_session and is selected and scored with it to the end; rescore(save)
-- reads app_config param_version at every call, so a person's published scores follow the new set at their next view,
-- from the raw answers (§7.8). Nothing else is needed for them.
--
-- WHAT IT DOES NOT REACH: what finish kept of a session. sessions.state.eap ({n, mean, sd} an axis: what hb.prior_state
-- reads to aim a returning person's next session), state.posterior (the correlated MAP), state.integrity (the §13 evidence:
-- accuracy on hard items and person fit read b) and calibration_eligible (which the next calibration reads) were computed
-- under the session's own param_version. hb.rescore_session(sid) re-computes all four from the session's answers under
-- the current app_config param_version, exactly as submit and finish compute them (the same functions, the same order:
-- hb.eap_add_response folded over the answers in seq order, then hb.eap_summary, hb.session_posterior,
-- hb.session_integrity, hb.is_eligible), records the version in sessions.param_version and state.rescored, and fills
-- state.fermi_intervals (20261017000100_fermi_intervals.sql) for a session that finished before it existed. Only a
-- finished session whose answers are still live is re-scored (an archived one keeps its summary: hb.session_obs and the
-- evidence read the live tables, and the archive is past the 30 days the nightly job calls recent); anything kept in
-- state besides those keys (the seen lists, `prior`) stays as it is. The session row is locked as every RPC locks it.
-- Returns what it did: rescored, missing, unfinished, archived.
--
-- Access (R-12.1): not SECURITY DEFINER and revoked from every API role, like hb.archive_session: only the migration role
-- (`postgres`, the SUPABASE_DB_URL of the nightly job, a member of hb_definer) calls it. No reply of any RPC changes.

set local role hb_definer;

create function hb.rescore_session(p_session_id text)
returns text
language plpgsql
set search_path = ''
as $$
declare
  s public.sessions;
  v_s public.sessions;
  v_param text := hb.cfg_text('param_version', null);
  v_state jsonb;
  v_fermi jsonb;
  r record;
begin
  select * into s from public.sessions x where x.session_id = p_session_id for update;
  if not found then
    return 'missing';
  end if;
  if s.finished_at is null then
    return 'unfinished';
  end if;
  if exists (select 1 from public.response_archive a where a.session_id = s.session_id) then
    return 'archived';
  end if;

  -- the grid EAP of every axis, built answer by answer as submit built it, under the current parameter set
  v_s := s;
  v_s.param_version := v_param;
  v_s.state := coalesce(s.state, '{}'::jsonb) - 'eap';
  for r in select x.item_id, x.response, x.correct, x.pretest from public.responses x where x.session_id = s.session_id order by x.seq loop
    v_s.state := hb.eap_add_response(v_s, r.item_id, r.response, r.correct, r.pretest);
  end loop;

  -- the posterior and the evidence read the session's param_version from its row
  update public.sessions set param_version = v_param where session_id = s.session_id;
  v_state := (coalesce(s.state, '{}'::jsonb) - 'fermi_intervals')
    || pg_catalog.jsonb_build_object(
         'eap', hb.eap_summary(v_s.state),
         'posterior', hb.session_posterior(s.session_id),
         'integrity', hb.session_integrity(s.session_id),
         'rescored', pg_catalog.jsonb_build_object('param_version', v_param, 'at', pg_catalog.now()));
  v_fermi := hb.fermi_session_summary(s.session_id);
  if v_fermi is not null then
    v_state := v_state || pg_catalog.jsonb_build_object('fermi_intervals', v_fermi);
  end if;
  update public.sessions set state = v_state where session_id = s.session_id;
  update public.sessions set calibration_eligible = hb.is_eligible(s.session_id) where session_id = s.session_id;
  return 'rescored';
end
$$;

revoke all on function hb.rescore_session(text) from public, anon, authenticated, service_role;

reset role;
