-- M2.2 (ROADMAP M2.2, A24-sec; DESIGN §7.4 "Cross-skill aim", R-7.4, R-11.1; lead's task of 2026-10-17, "device-task
-- scores inform the online parts' starting points"): the device's timed blocks lend their estimates to the aim of the
-- served parts. Selection only. The same aim as the app's (web/src/engine/xskill.ts deviceEstimate, deviceEvidence),
-- which web/scripts/db/device.db.test.ts holds this file to.
--
-- WHY. The server never sees the timed blocks (reaction time, the memory spans, coding, reading): they run and are scored
-- on the device (supabase/README.md, backend/session.ts). So the cross-skill aim of 20261016000100_cross_skill_aim.sql
-- borrowed nothing from them: Working Memory, Reaction Time and Processing Speed said nothing about where a served part
-- should start, although Σ correlates them with the reasoning skills (§3: WM-Gf .40, RT-Gf .28).
--
-- public.device_estimates(p_token, p_estimates) (NEW RPC, anon and authenticated). The app sends, after each timed
-- block, its estimate of that block's skill: [{axis, mean, sd}, ...], the per-skill posterior of the session's blocks
-- of that skill under the skill's scoring prior N(hb.axis_prior_mean, hb.axis_prior_var) (the {mean, sd} summary the
-- server keeps of its own skills at finish). Never a trial, a time or an answer. Checked and bounded here, because the
-- client is not trusted:
--   * the session must be open (hb.session_for_token); at most 3 entries, each an object of exactly axis, mean, sd;
--     no axis twice; axis one of selection.device_axes (["WM","RT","PS"]: the skills the server never serves);
--     mean and sd numbers, sd > 0; anything else is 400 invalid_estimates;
--   * mean is clamped to [-4, 4] (the grid); sd is raised to selection.device_sd_min (0.3) when smaller, so no estimate
--     claims more precision than a block can give (the per-axis stop is 0.3; RT at reliability .85 is about 0.39);
--   * the estimate becomes one Gaussian term, the message of hb.prior_state: lam = 1/sd^2 - 1/v0, x = (mean/sd^2 -
--     m0/v0)/lam with (m0, v0) the prior's own moments on the grid; an sd at or above the prior's grid sd (lam <= 1e-9)
--     says nothing and the axis's entry is removed; lam is then at most 1/sd_min^2 - 1/v0 and x is clamped to [-4, 4];
--   * stored in sessions.state.device[axis] = {mean, sd, lam, x}; a later call replaces that axis's entry;
--   * at most selection.device_max_calls (20) calls a session (429 too_many_estimates); state.device_calls counts them.
-- The reply is {"recorded": [the axes of the call]}: nothing derived, no score.
--
-- hb.session_aims (re-created from 20261016000100_cross_skill_aim.sql with exactly one change): besides `prior` it adds
-- `device` to the axis's grid, the same Gaussian term -lam (x - t)^2 / 2. So a WM estimate sends WM's message through
-- Σ_sel to the reasoning parts like any other skill's answers would.
--
-- WHAT IS NOT CHANGED. Every score: state.device is read by hb.session_aims alone. hb.session_axis_post,
-- hb.session_posteriors, the per-axis stop, finish, the MAP and rescore never read it, so a client cannot move a score
-- with it; the device's own scores of these skills stay the device's (unsigned, A16). The worst a made-up estimate can
-- do is aim its own session's first questions badly, which the start-up step corrects within a question or two
-- (ROADMAP A24-sec: selection already depends on what the client sends).
--
-- TO SWITCH IT OFF: selection.device_axes = [] (every call is then 400; the app ignores a failure) or
-- selection.borrow_strength = 0.

insert into public.app_config (key, value, description) values
  ('selection.device_axes',      '["WM","RT","PS"]', 'engine/xskill.ts DEVICE_AXES: the skills whose device estimates public.device_estimates takes for the aim (the timed blocks the server never serves); [] switches it off'),
  ('selection.device_sd_min',    '0.3', 'engine/xskill.ts DEVICE_SD_MIN: a device estimate''s sd is raised to this, so no estimate claims more precision than a block gives'),
  ('selection.device_max_calls', '20',  'engine/xskill.ts DEVICE_MAX_CALLS: device_estimates calls a session may make');

grant create on schema public to hb_definer;
set local role hb_definer;

-- The device's estimates for the aim (the header). Replaces state.device[axis] per entry; the reply names the axes.
create function public.device_estimates(p_token text, p_estimates jsonb)
returns jsonb
language plpgsql security definer
set search_path = ''
as $$
declare
  s public.sessions;
  v_axes jsonb := case when pg_catalog.jsonb_typeof(hb.cfg('selection.device_axes')) = 'array' then hb.cfg('selection.device_axes') else '[]'::jsonb end;
  v_sd_min double precision := greatest(hb.cfg_num('selection.device_sd_min', 0.3), 1e-6::double precision);
  v_calls int;
  v_device jsonb;
  v_seen text[] := '{}';
  v_el jsonb;
  v_axis text;
  v_mean double precision;
  v_sd double precision;
  v_e0 record;
  v_v0 double precision;
  v_lam double precision;
  v_x double precision;
begin
  perform hb.reject_brief_prefs(p_estimates);
  s := hb.session_for_token(p_token);
  if pg_catalog.jsonb_typeof(p_estimates) is distinct from 'array' or pg_catalog.jsonb_array_length(p_estimates) not between 1 and 3 then
    perform hb.fail(400, 'invalid_estimates', 'p_estimates: a list of 1 to 3 {axis, mean, sd}.');
  end if;
  v_calls := case when pg_catalog.jsonb_typeof(s.state -> 'device_calls') = 'number' then (s.state ->> 'device_calls')::int else 0 end;
  if v_calls >= hb.cfg_int('selection.device_max_calls', 20) then
    perform hb.fail(429, 'too_many_estimates');
  end if;
  v_device := case when pg_catalog.jsonb_typeof(s.state -> 'device') = 'object' then s.state -> 'device' else '{}'::jsonb end;
  for v_el in select e from pg_catalog.jsonb_array_elements(p_estimates) e loop
    if pg_catalog.jsonb_typeof(v_el) is distinct from 'object'
       or (v_el - 'axis' - 'mean' - 'sd') <> '{}'::jsonb
       or pg_catalog.jsonb_typeof(v_el -> 'axis') is distinct from 'string'
       or pg_catalog.jsonb_typeof(v_el -> 'mean') is distinct from 'number'
       or pg_catalog.jsonb_typeof(v_el -> 'sd') is distinct from 'number' then
      perform hb.fail(400, 'invalid_estimates', 'each estimate is exactly {axis, mean, sd}, mean and sd numbers.');
    end if;
    v_axis := v_el ->> 'axis';
    if not (v_axes ? v_axis) or v_axis = any (v_seen) then
      perform hb.fail(400, 'invalid_estimates', 'axis: one of selection.device_axes, once.');
    end if;
    v_seen := v_seen || v_axis;
    -- bounded as numeric first, so a number past the range of a double is clamped, not an error
    if not ((v_el ->> 'sd')::numeric > 0) then
      perform hb.fail(400, 'invalid_estimates', 'sd must be positive.');
    end if;
    v_mean := least(greatest((v_el ->> 'mean')::numeric, -4), 4)::double precision;
    v_sd := greatest(least((v_el ->> 'sd')::numeric, 1000000)::double precision, v_sd_min);
    -- the message of (mean, sd) under the axis's scoring prior, its grid moments divided out (hb.prior_state)
    select * into v_e0 from hb.eap_from_ll(null, hb.axis_prior_mean(v_axis), hb.axis_prior_var(v_axis));
    v_v0 := v_e0.o_sd * v_e0.o_sd;
    v_lam := case when v_v0 > 0 then 1 / (v_sd * v_sd) - 1 / v_v0 end;
    if v_lam is null or not (v_lam > 1e-9) then
      v_device := v_device - v_axis;
      continue;
    end if;
    v_x := (v_mean / (v_sd * v_sd) - v_e0.o_mean / v_v0) / v_lam;
    v_lam := least(v_lam, 1 / (v_sd_min * v_sd_min) - 1 / v_v0);
    v_x := least(greatest(v_x, -4::double precision), 4::double precision);
    v_device := v_device || pg_catalog.jsonb_build_object(v_axis, pg_catalog.jsonb_build_object('mean', v_mean, 'sd', v_sd, 'lam', v_lam, 'x', v_x));
  end loop;
  update public.sessions
     set state = coalesce(state, '{}'::jsonb) || pg_catalog.jsonb_build_object('device', v_device, 'device_calls', v_calls + 1)
   where session_id = s.session_id;
  return pg_catalog.jsonb_build_object('recorded', pg_catalog.to_jsonb(v_seen));
end
$$;

-- Where each axis's items are aimed: hb.session_aims as in 20261016000100_cross_skill_aim.sql, with the one change that
-- the device's estimates (state.device) add their Gaussian term to the axis's grid as the earlier sessions' do.
create or replace function hb.session_aims(p_state jsonb, p_axes text[] default null)
returns table (axis text, aim double precision)
language plpgsql stable
set search_path = ''
as $$
declare
  v_codes text[] := hb.axis_codes();
  v_grid double precision[] := hb.eap_grid();
  k int := pg_catalog.array_length(v_codes, 1);
  v_f2 double precision := greatest(hb.cfg_num('selection.aim_prior_sd_factor', 2), 1e-6::double precision) ^ 2;
  v_s double precision := least(greatest(hb.cfg_num('selection.borrow_strength', 0.75), 0::double precision), 1::double precision);
  v_sig double precision[] := hb.sigma_init();
  v_state jsonb := coalesce(p_state, '{}'::jsonb);
  v_mu double precision[];
  v_var double precision[];
  v_cov double precision[];
  v_ll double precision[];
  v_one double precision[];
  v_has boolean[];
  v_lam double precision[];
  v_x double precision[];
  v_node jsonb;
  v_n int;
  v_e record;
  v_e0 record;
  v_v double precision;
  v_v0 double precision;
  v_J int[];
  n int;
  v_mat double precision[];
  v_chol double precision[];
  v_w double precision[];
  v_u double precision[];
  v_pm double precision;
  v_pv double precision;
  v_shift double precision;
  v_expl double precision;
begin
  -- without a Sigma of the right size there is nothing to borrow through
  if v_sig is null or pg_catalog.array_length(v_sig, 1) is distinct from k * k then
    v_s := 0;
  end if;
  v_mu := array(select hb.axis_prior_mean(c) from pg_catalog.unnest(v_codes) with ordinality u (c, o) order by o);
  v_var := array(select hb.axis_prior_var(c) from pg_catalog.unnest(v_codes) with ordinality u (c, o) order by o);
  v_cov := pg_catalog.array_fill(0::double precision, array[k * k]);
  for i in 1..k loop
    for j in 1..k loop
      if i = j then
        v_cov[(i - 1) * k + j] := v_f2 * v_var[i];
      elsif v_s > 0 then
        v_cov[(i - 1) * k + j] := v_f2 * v_s * v_sig[(i - 1) * k + j] / pg_catalog.sqrt(v_sig[(i - 1) * k + i] * v_sig[(j - 1) * k + j]) * pg_catalog.sqrt(v_var[i] * v_var[j]);
      end if;
    end loop;
  end loop;

  -- each axis's grid: this session's answers, and the earlier sessions' Gaussian term (state.prior)
  v_ll := pg_catalog.array_fill(0::double precision, array[k * 61]);
  v_has := pg_catalog.array_fill(false, array[k]);
  v_lam := pg_catalog.array_fill(0::double precision, array[k]);
  v_x := pg_catalog.array_fill(0::double precision, array[k]);
  for i in 1..k loop
    v_node := v_state #> array['eap', v_codes[i]];
    if pg_catalog.jsonb_typeof(v_node -> 'll') = 'array' and pg_catalog.jsonb_array_length(v_node -> 'll') = 61 and coalesce((v_node ->> 'n')::int, 0) > 0 then
      v_one := array(select x::double precision from pg_catalog.jsonb_array_elements_text(v_node -> 'll') x);
      for g in 1..61 loop
        v_ll[(i - 1) * 61 + g] := v_one[g];
      end loop;
      v_has[i] := true;
    end if;
    v_node := v_state #> array['prior', v_codes[i]];
    if pg_catalog.jsonb_typeof(v_node -> 'lam') = 'number' and pg_catalog.jsonb_typeof(v_node -> 'x') = 'number' and (v_node ->> 'lam')::double precision > 0 then
      for g in 1..61 loop
        v_ll[(i - 1) * 61 + g] := v_ll[(i - 1) * 61 + g] - 0.5 * (v_node ->> 'lam')::double precision * ((v_node ->> 'x')::double precision - v_grid[g]) ^ 2;
      end loop;
      v_has[i] := true;
    end if;
    v_node := v_state #> array['device', v_codes[i]];
    if pg_catalog.jsonb_typeof(v_node -> 'lam') = 'number' and pg_catalog.jsonb_typeof(v_node -> 'x') = 'number' and (v_node ->> 'lam')::double precision > 0 then
      for g in 1..61 loop
        v_ll[(i - 1) * 61 + g] := v_ll[(i - 1) * 61 + g] - 0.5 * (v_node ->> 'lam')::double precision * ((v_node ->> 'x')::double precision - v_grid[g]) ^ 2;
      end loop;
      v_has[i] := true;
    end if;
    -- 1. its message
    if v_has[i] then
      select * into v_e from hb.eap_from_ll(v_ll[(i - 1) * 61 + 1:i * 61], v_mu[i], v_cov[(i - 1) * k + i]);
      select * into v_e0 from hb.eap_from_ll(null, v_mu[i], v_cov[(i - 1) * k + i]);
      v_v := v_e.o_sd * v_e.o_sd;
      v_v0 := v_e0.o_sd * v_e0.o_sd;
      if v_v > 0 and v_v0 > 0 and 1 / v_v - 1 / v_v0 > 1e-9 then
        v_lam[i] := 1 / v_v - 1 / v_v0;
        v_x[i] := (v_e.o_mean / v_v - v_e0.o_mean / v_v0) / v_lam[i];
      end if;
    end if;
  end loop;

  for kk in 1..k loop
    -- only the axes asked for (hb.rank_live passes its p_axes; null: every axis)
    continue when p_axes is not null and not (v_codes[kk] = any (p_axes));
    axis := v_codes[kk];
    -- 2. the conditional prior given the other axes' messages
    v_pm := v_mu[kk];
    v_pv := v_cov[(kk - 1) * k + kk];
    v_J := case when v_s > 0 then array(select j from pg_catalog.generate_series(1, k) j where j <> kk and v_lam[j] > 0 order by j) else '{}'::int[] end;
    n := coalesce(pg_catalog.array_length(v_J, 1), 0);
    if n > 0 then
      v_mat := pg_catalog.array_fill(0::double precision, array[n * n]);
      for a in 1..n loop
        for b in 1..n loop
          v_mat[(a - 1) * n + b] := v_cov[(v_J[a] - 1) * k + v_J[b]] + case when a = b then 1 / v_lam[v_J[a]] else 0 end;
        end loop;
      end loop;
      v_chol := hb.mat_chol(v_mat, n);
      if v_chol is not null then
        v_w := hb.mat_chol_solve(v_chol, array(select v_x[v_J[a]] - v_mu[v_J[a]] from pg_catalog.generate_series(1, n) a order by a), n);
        v_u := hb.mat_chol_solve(v_chol, array(select v_cov[(v_J[a] - 1) * k + kk] from pg_catalog.generate_series(1, n) a order by a), n);
        v_shift := 0;
        v_expl := 0;
        for a in 1..n loop
          v_shift := v_shift + v_cov[(kk - 1) * k + v_J[a]] * v_w[a];
          v_expl := v_expl + v_cov[(kk - 1) * k + v_J[a]] * v_u[a];
        end loop;
        v_pm := v_mu[kk] + v_shift;
        v_pv := greatest(v_cov[(kk - 1) * k + kk] - v_expl, 1e-9 * v_cov[(kk - 1) * k + kk]);
      end if;
    end if;
    -- 3. the axis's own answers under it
    if v_has[kk] then
      select * into v_e from hb.eap_from_ll(v_ll[(kk - 1) * 61 + 1:kk * 61], v_pm, v_pv);
      aim := v_e.o_mean;
    else
      aim := v_pm;
    end if;
    return next;
  end loop;
end
$$;
reset role;
revoke create on schema public from hb_definer;

revoke all on function public.device_estimates(text, jsonb) from public, anon, authenticated, service_role;
grant execute on function public.device_estimates(text, jsonb) to anon, authenticated;
