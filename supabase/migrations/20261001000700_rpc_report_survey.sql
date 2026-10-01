-- M2.1 (ROADMAP M2.1; DESIGN §4.5, §13, R-12.1; ROADMAP AI.26): report_problem and submit_survey.
--
--   report_problem(p_token, p_kind, p_item_id, p_detail)
--       The "Report a problem" button. Five item categories (wrong_key, ambiguous, typo, offensive,
--       broken; the item must be one this session was served, so a report cannot be aimed at an item
--       the person never saw) and the sixth, notes_requested ("someone asked me for my notes",
--       AI.26): it carries no item and no text, is stored as a flag of its own and never counts
--       toward item quarantine (DESIGN §4.5 counts item flags only).
--   submit_survey(p_token, p_age_band, p_english_first)
--       The optional two-question survey (DESIGN §13): voluntary, stored apart from the session,
--       for DIF only. A repeat replaces the earlier answer. Nothing is stored for two nulls.
--
-- Both accept a finished session's token for post_finish_minutes.

grant create on schema public to hb_definer;
set local role hb_definer;

create function public.report_problem(
  p_token text,
  p_kind text,
  p_item_id text default null,
  p_detail text default null
)
returns jsonb
language plpgsql security definer
set search_path = ''
as $$
declare
  s public.sessions;
  v_detail text := nullif(pg_catalog.btrim(p_detail), '');
begin
  s := hb.session_for_token(p_token, true);
  if p_kind is null or p_kind not in ('wrong_key', 'ambiguous', 'typo', 'offensive', 'broken', 'notes_requested') then
    perform hb.fail(400, 'invalid_kind', 'kind is one of wrong_key, ambiguous, typo, offensive, broken, notes_requested.');
  end if;

  if p_kind = 'notes_requested' then
    if p_item_id is not null or v_detail is not null then
      perform hb.fail(400, 'invalid_report', 'This report carries no item and no text.');
    end if;
  else
    if p_item_id is null then
      perform hb.fail(400, 'invalid_report', 'An item report names the item.');
    end if;
    if pg_catalog.char_length(coalesce(v_detail, '')) > 500 then
      perform hb.fail(413, 'detail_too_long', 'At most 500 characters.');
    end if;
    if not exists (select 1 from public.exposure_log e where e.session_id = s.session_id and e.item_id = p_item_id) then
      perform hb.fail(404, 'item_not_served', 'This session was not served that item.');
    end if;
  end if;

  if (select pg_catalog.count(*) from public.flags f where f.session_id = s.session_id and f.source = 'user')
       >= hb.cfg_int('session.max_reports', 20) then
    perform hb.fail(429, 'rate_limited', 'reports');
  end if;

  -- One report of a kind per session and item (the partial unique indexes); a repeat is a no-op.
  insert into public.flags (item_id, session_id, kind, detail, source)
  values (p_item_id, s.session_id, p_kind, v_detail, 'user')
  on conflict do nothing;
  return pg_catalog.jsonb_build_object('recorded', true);
end
$$;

create function public.submit_survey(
  p_token text,
  p_age_band text default null,
  p_english_first boolean default null
)
returns jsonb
language plpgsql security definer
set search_path = ''
as $$
declare
  s public.sessions;
begin
  s := hb.session_for_token(p_token, true);
  if p_age_band is not null and p_age_band not in ('18-24', '25-34', '35-44', '45-54', '55-64', '65+') then
    perform hb.fail(400, 'invalid_age_band', 'age_band is one of 18-24, 25-34, 35-44, 45-54, 55-64, 65+.');
  end if;
  if p_age_band is null and p_english_first is null then
    return pg_catalog.jsonb_build_object('recorded', false);
  end if;
  insert into public.survey as v (session_id, age_band, english_first)
  values (s.session_id, p_age_band, p_english_first)
  on conflict (session_id) do update set age_band = excluded.age_band, english_first = excluded.english_first;
  return pg_catalog.jsonb_build_object('recorded', true);
end
$$;

revoke all on function public.report_problem(text, text, text, text) from public, anon, authenticated, service_role;
revoke all on function public.submit_survey(text, text, boolean) from public, anon, authenticated, service_role;
grant execute on function public.report_problem(text, text, text, text) to anon, authenticated;
grant execute on function public.submit_survey(text, text, boolean) to anon, authenticated;

reset role;
revoke create on schema public from hb_definer;
