-- M5.1 (ROADMAP M5.1, M4.8; DESIGN §3 rows 11 and 12, §7.1 "Fermi" and "Calibration", §14.3 M5 "Brier computed
-- server-side", §14.6 ex. 8 and 9, R-11.1): the 80% intervals of a session's Fermi answers, scored on the server as the
-- app scores them, and recorded with the session.
--
-- WHAT. Every Fermi answer is a best guess and an 80% interval (20261015000200_continuous_items.sql). hb.fermi_eval already
-- tells, per answer, whether the interval holds the truth (o_hit), the truth's weight and the interval's Gneiting-Raftery
-- score; nothing summed them. Two functions now do, exactly as web/src/tasks/fermi/scoring.ts summarise() and the bank's
-- hb.fermi.scoring.summarise do (the golden summaries of fermi_scoring_v1.json; scripts/db/fermi-intervals.db.test.ts):
--   hb.fermi_summary(p_pairs)          a list [{key, response}, ...] -> {n, hits, total_weight, mean_abs_error_dex,
--                                      median_abs_error_dex, hit_rate, in_the_large, mean_interval_score_dex,
--                                      interval_brier} over the valid answers (null when there is none). hit_rate is the
--                                      WEIGHTED share of intervals that held the truth, in_the_large = 0.8 - hit_rate
--                                      (positive: intervals too narrow), interval_brier the weighted mean of (0.8 - hit)^2:
--                                      the Brier score of the 80% statements, computed server-side (§14.3 M5).
--   hb.fermi_session_summary(sid)      the same over a session's answered Fermi items (live or archived rows, through
--                                      hb.responses_of; an item the nightly QA quarantined is left out, as every score
--                                      leaves it out), with "v": 1; null without a valid Fermi answer.
-- public.finish is re-created with exactly one change: a session with Fermi answers keeps that summary in
-- sessions.state.fermi_intervals, beside the posterior and the integrity evidence.
--
-- WHAT IT IS FOR. A record for the M4.8 calibration and the nightly monitoring: DESIGN §3 row 12 and §7.1 list the
-- interval hit rate beside the Brier score of the confidence ratings, and leave open whether hits enter theta_CAL (ROADMAP
-- owner decision (11) of 2026-10-13: "whether Fermi interval hits enter Calibration (M4.8)"; M4.8 did not decide it). So
-- NOTHING READS IT TO SCORE: rescore's Calibration stays the confidence ratings' alone, and no reply carries it. It is a
-- function of the truths (a hit says on which side of an interval end the truth lies), so like the posterior and the
-- integrity evidence it stays on the server (R-11.1; owner decision 2026-10-01).

-- hb_definer re-creates public.finish (it owns it), so it may create in `public` for this file only.
grant create on schema public to hb_definer;
set local role hb_definer;

-- The summary of a list of Fermi answers [{key, response}, ...], in list order, over the answers hb.fermi_eval finds valid.
-- The means are weighted by the truth's weight (scoring.ts summarise; the median of |e| is not), 0.8 is INTERVAL_COVERAGE
-- (tasks/fermi/scoring.ts, the bank's hb.fermi.truth.INTERVAL_COVERAGE).
create function hb.fermi_summary(p_pairs jsonb)
returns jsonb
language sql immutable parallel safe
set search_path = ''
as $$
  with e as (
    select o, f.*
      from pg_catalog.jsonb_array_elements(case when pg_catalog.jsonb_typeof(p_pairs) = 'array' then p_pairs else '[]'::jsonb end)
           with ordinality as p (el, o)
     cross join lateral hb.fermi_eval(p.el -> 'key', p.el -> 'response') f
     where f.o_valid
  ), t as (
    select pg_catalog.count(*)::int as n,
           pg_catalog.sum(case when o_hit then 1 else 0 end)::int as hits,
           pg_catalog.sum(o_weight) as tw,
           pg_catalog.sum(o_weight * pg_catalog.abs(o_error)) as w_abs,
           pg_catalog.sum(o_weight * case when o_hit then 1 else 0 end) as w_hit,
           pg_catalog.sum(o_weight * o_interval_score) as w_score,
           pg_catalog.sum(o_weight * (0.8::double precision - case when o_hit then 1 else 0 end) ^ 2) as w_brier,
           pg_catalog.percentile_cont(0.5) within group (order by pg_catalog.abs(o_error)) as med
      from e
  )
  select case when t.n = 0 or not (t.tw > 0) then null else pg_catalog.jsonb_build_object(
           'n', t.n,
           'hits', t.hits,
           'total_weight', t.tw,
           'mean_abs_error_dex', t.w_abs / t.tw,
           'median_abs_error_dex', t.med,
           'hit_rate', t.w_hit / t.tw,
           'in_the_large', 0.8::double precision - t.w_hit / t.tw,
           'mean_interval_score_dex', t.w_score / t.tw,
           'interval_brier', t.w_brier / t.tw) end
    from t
$$;

-- A session's Fermi answers, summed (the header): the answered items of item_type fermi_estimate that are not quarantined,
-- in the order they were answered, live or archived.
create function hb.fermi_session_summary(p_session_id text)
returns jsonb
language sql stable
set search_path = ''
as $$
  select case when x.s is null then null else pg_catalog.jsonb_build_object('v', 1) || x.s end
    from (
      select hb.fermi_summary(coalesce(pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object('key', ik.key, 'response', r.response) order by r.seq), '[]'::jsonb)) as s
        from hb.responses_of(p_session_id) r
        join public.items i on i.item_id = r.item_id
        join public.item_keys ik on ik.item_id = i.item_id
       where i.item_type = 'fermi_estimate'
         and i.status <> 'quarantined'
         and r.response is not null
    ) x
$$;

-- public.finish as in 20261001000600_rpc_session.sql, with the one change: the new state also holds the session's Fermi
-- interval summary (state.fermi_intervals) when it has Fermi answers.
create or replace function public.finish(p_token text, p_flags jsonb default null)
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
  v_state jsonb;
  v_fermi jsonb;
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

    v_state := coalesce(s.state, '{}'::jsonb)
      || pg_catalog.jsonb_build_object('eap', hb.eap_summary(s.state));
    v_state := v_state || pg_catalog.jsonb_build_object('posterior', hb.session_posterior(s.session_id), 'integrity', hb.session_integrity(s.session_id));
    v_fermi := hb.fermi_session_summary(s.session_id);
    if v_fermi is not null then
      v_state := v_state || pg_catalog.jsonb_build_object('fermi_intervals', v_fermi);
    end if;
    update public.sessions
       set finished_at = pg_catalog.now(),
           state = v_state,
           flags = v_flags || pg_catalog.jsonb_build_object(
             'server_too_fast', v_too_fast,
             'server_avg_item_ms', case when v_avg_ms is null then null else pg_catalog.round(v_avg_ms::numeric, 0) end)
     where session_id = s.session_id;
    update public.sessions set calibration_eligible = hb.is_eligible(s.session_id) where session_id = s.session_id;
  end if;

  return pg_catalog.jsonb_build_object(
    'session', hb.session_signed(s.session_id),
    'anon_id', s.anon_id,
    'n_responses', (select x.n_answered from public.sessions x where x.session_id = s.session_id));
end
$$;

revoke all on function hb.fermi_summary(jsonb), hb.fermi_session_summary(text) from public, anon, authenticated, service_role;

reset role;
revoke create on schema public from hb_definer;
