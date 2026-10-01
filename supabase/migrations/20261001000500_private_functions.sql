-- M2.1 (ROADMAP M2.1; DESIGN §8, §11.2, §13, R-11.1, R-12.1; ROADMAP A9, A11, A16, A18, AI.26): the
-- private helpers (schema hb) the RPCs of the next migrations are built from. Nobody but
-- hb_definer can run them; the API reaches them only through the SECURITY DEFINER RPCs in `public`.
--
-- Seams that later tasks replace with `create or replace function` (same signature):
--   hb.pick_item(sessions)       M2.2: information per second, axis weights, the 0.25 exposure cap,
--                                pretest slots (here: a random eligible live item)
--   hb.is_eligible(text)         M2.2: server-side lz* and too-fast evidence (here: the §13 flag
--                                count over what the client reported, plus the server's time check)
--   hb.session_owned(jsonb,text) M2.3: the per-session HMAC (here: the server issued that
--                                session_id to that anon_id)
--
-- Errors are RAISEd with a PostgREST status as the SQLSTATE (PT400, PT401, ...): the message is a
-- short code (`rate_limited`, `invalid_session`, ...), the detail says why in words. Failures that
-- must be counted (a wrong recovery phrase) are returned, not raised, because a raise rolls back the
-- counter.

grant create on schema public to hb_definer;
set local role hb_definer;

-- ---------------------------------------------------------------------------------- settings
create function hb.cfg(p_key text)
returns jsonb
language sql stable
set search_path = ''
as $$ select c.value from public.app_config c where c.key = p_key $$;

create function hb.cfg_int(p_key text, p_default int)
returns int
language sql stable
set search_path = ''
as $$ select coalesce((hb.cfg(p_key) #>> '{}')::int, p_default) $$;

create function hb.cfg_num(p_key text, p_default double precision)
returns double precision
language sql stable
set search_path = ''
as $$ select coalesce((hb.cfg(p_key) #>> '{}')::double precision, p_default) $$;

create function hb.cfg_text(p_key text, p_default text)
returns text
language sql stable
set search_path = ''
as $$ select coalesce(hb.cfg(p_key) #>> '{}', p_default) $$;

-- ------------------------------------------------------------------------------------ errors
-- RAISE with a PostgREST-mapped SQLSTATE ('PT' + HTTP status). Never returns.
create function hb.fail(p_status int, p_code text, p_detail text default null)
returns void
language plpgsql
set search_path = ''
as $$
begin
  if p_detail is null then
    raise exception using errcode = pg_catalog.format('PT%s', p_status), message = p_code;
  end if;
  raise exception using errcode = pg_catalog.format('PT%s', p_status), message = p_code, detail = p_detail;
end
$$;

-- ------------------------------------------------------------------------------------- randomness
-- A random string over [0-9A-Za-z]: rejection sampling, so every character is uniform.
create function hb.rand_b62(p_len int)
returns text
language plpgsql volatile
set search_path = ''
as $$
declare
  c_alphabet constant text := '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz';
  v_out text := '';
  v_buf bytea;
  v_b int;
begin
  while pg_catalog.char_length(v_out) < p_len loop
    v_buf := extensions.gen_random_bytes(32);
    for i in 0..31 loop
      v_b := pg_catalog.get_byte(v_buf, i);
      if v_b < 248 then -- 248 = 4 * 62: the remaining bytes would make some characters likelier
        v_out := v_out || pg_catalog.substr(c_alphabet, (v_b % 62) + 1, 1);
        exit when pg_catalog.char_length(v_out) >= p_len;
      end if;
    end loop;
  end loop;
  return v_out;
end
$$;

-- The opaque session token: 128 random bits, base64url, prefixed so a secret scanner can see it.
create function hb.new_token()
returns text
language sql volatile
set search_path = ''
as $$
  select 'hbt_' || pg_catalog.rtrim(
    pg_catalog.translate(pg_catalog.encode(extensions.gen_random_bytes(16), 'base64'), '+/', '-_'), '=')
$$;

create function hb.token_hash(p_token text)
returns bytea
language sql immutable
set search_path = ''
as $$ select extensions.digest(p_token, 'sha256') $$;

-- 12 words from recovery_words, 10 bits each, from 24 random bytes (65,536 is a multiple of 1,024,
-- so the draw is uniform).
create function hb.new_phrase()
returns text
language plpgsql volatile
set search_path = ''
as $$
declare
  v_buf bytea := extensions.gen_random_bytes(24);
  v_words text[] := '{}';
  v_word text;
begin
  for i in 0..11 loop
    select w.word into v_word from public.recovery_words w
     where w.idx = ((pg_catalog.get_byte(v_buf, 2 * i) * 256 + pg_catalog.get_byte(v_buf, 2 * i + 1)) % 1024);
    v_words := v_words || v_word;
  end loop;
  return pg_catalog.array_to_string(v_words, ' ');
end
$$;

-- SHA-256 of the phrase as typed: case, spaces and line breaks do not matter.
create function hb.phrase_hash(p_phrase text)
returns bytea
language sql immutable
set search_path = ''
as $$
  select extensions.digest(
    pg_catalog.lower(pg_catalog.regexp_replace(pg_catalog.btrim(coalesce(p_phrase, '')), '\s+', ' ', 'g')), 'sha256')
$$;

-- ------------------------------------------------------------------------------------ rate limits
create function hb.today()
returns date
language sql stable
set search_path = ''
as $$ select (pg_catalog.now() at time zone 'utc')::date $$;

-- The client address as the API gateway reports it (headers PostgREST puts in request.headers).
-- Which header and which entry is the client is a setting, to be verified on the hosted project
-- (supabase/README.md, M2.6). 'unknown' when the header is absent: one shared bucket, which fails
-- closed.
create function hb.client_ip()
returns text
language plpgsql stable
set search_path = ''
as $$
declare
  v_headers jsonb;
  v_raw text;
  v_parts text[];
  v_hop int;
  v_n int;
begin
  begin
    v_headers := nullif(pg_catalog.current_setting('request.headers', true), '')::jsonb;
  exception when others then
    v_headers := null;
  end;
  v_raw := v_headers ->> hb.cfg_text('rate.ip_header', 'x-forwarded-for');
  if v_raw is null or pg_catalog.btrim(v_raw) = '' then
    return 'unknown';
  end if;
  v_parts := pg_catalog.regexp_split_to_array(pg_catalog.btrim(v_raw), '\s*,\s*');
  v_n := pg_catalog.array_length(v_parts, 1);
  v_hop := hb.cfg_int('rate.ip_hop', 1);
  if v_hop > 0 then
    return v_parts[least(v_hop, v_n)];
  end if;
  return v_parts[greatest(v_n + v_hop + 1, 1)];
end
$$;

-- hash(value, today's salt). The salt is random per UTC day and purged with the counts, so a hash
-- cannot be recomputed from the value afterwards or matched across days.
create function hb.day_key(p_value text)
returns text
language plpgsql volatile
set search_path = ''
as $$
declare
  v_day date := hb.today();
  v_salt bytea;
begin
  select s.salt into v_salt from public.rate_salts s where s.day = v_day;
  if v_salt is null then
    insert into public.rate_salts (day, salt) values (v_day, extensions.gen_random_bytes(32)) on conflict (day) do nothing;
    select s.salt into v_salt from public.rate_salts s where s.day = v_day;
  end if;
  return pg_catalog.encode(extensions.digest(p_value || '|' || pg_catalog.encode(v_salt, 'hex'), 'sha256'), 'hex');
end
$$;

-- The caller's key for a kind of limit: hash(client address, scope, today's salt).
create function hb.ip_key(p_scope text)
returns text
language sql volatile
set search_path = ''
as $$ select hb.day_key(hb.client_ip() || '|' || p_scope) $$;

-- Counts one hit today and returns the new count.
create function hb.rate_bump(p_kind text, p_key text)
returns int
language plpgsql volatile
set search_path = ''
as $$
declare
  v_n int;
begin
  insert into public.rate_limits as r (kind, key_hash, day, n) values (p_kind, p_key, hb.today(), 1)
  on conflict (kind, key_hash, day) do update set n = r.n + 1
  returning r.n into v_n;
  return v_n;
end
$$;

-- Counts one hit and raises 429 when it is over the limit (the raise rolls the count back, so only
-- hits that were allowed are counted).
create function hb.rate_hit(p_kind text, p_key text, p_limit int)
returns int
language plpgsql volatile
set search_path = ''
as $$
declare
  v_n int := hb.rate_bump(p_kind, p_key);
begin
  if v_n > p_limit then
    perform hb.fail(429, 'rate_limited', p_kind);
  end if;
  return v_n;
end
$$;

create function hb.rate_count(p_kind text, p_key text)
returns int
language sql stable
set search_path = ''
as $$
  select coalesce((select r.n from public.rate_limits r where r.kind = p_kind and r.key_hash = p_key and r.day = hb.today()), 0)
$$;

-- DESIGN §11.2 "purged every 48 h": keep today and yesterday (UTC) only. Called by start_session,
-- and by the nightly job (M2.5).
create function hb.purge_expired()
returns jsonb
language plpgsql volatile
set search_path = ''
as $$
declare
  v_limits int;
  v_salts int;
begin
  delete from public.rate_limits where day < hb.today() - 1;
  get diagnostics v_limits = row_count;
  delete from public.rate_salts where day < hb.today() - 1;
  get diagnostics v_salts = row_count;
  return pg_catalog.jsonb_build_object('rate_limits', v_limits, 'rate_salts', v_salts);
end
$$;

-- ----------------------------------------------------------------------------------- validation
-- AI.26 / R-17.1: the notes settings never reach the server. 400 when `j` holds a brief_prefs key.
create function hb.reject_brief_prefs(j jsonb)
returns void
language plpgsql immutable
set search_path = ''
as $$
begin
  if not hb.no_brief_prefs(j) then
    perform hb.fail(400, 'brief_prefs_not_accepted', 'Notes settings stay on the device. Send the data without brief_prefs.');
  end if;
end
$$;

-- schema/save-v1.json "device": coarse class only (§8 privacy), a closed object.
create function hb.valid_device(d jsonb)
returns boolean
language sql immutable
set search_path = ''
as $$
  select case when pg_catalog.jsonb_typeof(d) = 'object' then
    (d - 'class' - 'input' - 'os_family' - 'browser_family' - 'refresh_hz_est' - 'timer_res_ms' - 'viewport') = '{}'::jsonb
    and d ?& array['class', 'input', 'os_family', 'browser_family', 'refresh_hz_est', 'timer_res_ms', 'viewport']
    and pg_catalog.jsonb_typeof(d -> 'class') = 'string' and (d ->> 'class') in ('desktop', 'tablet', 'phone', 'other')
    and pg_catalog.jsonb_typeof(d -> 'input') = 'string' and (d ->> 'input') in ('mouse', 'touch', 'keyboard', 'pen', 'other')
    and pg_catalog.jsonb_typeof(d -> 'os_family') = 'string' and (d ->> 'os_family') ~ '^[A-Za-z][A-Za-z _-]{0,31}$'
    and pg_catalog.jsonb_typeof(d -> 'browser_family') = 'string' and (d ->> 'browser_family') ~ '^[A-Za-z][A-Za-z _-]{0,31}$'
    and case pg_catalog.jsonb_typeof(d -> 'refresh_hz_est')
          when 'null' then true
          when 'number' then (d ->> 'refresh_hz_est')::numeric > 0
          else false end
    and case pg_catalog.jsonb_typeof(d -> 'timer_res_ms')
          when 'null' then true
          when 'number' then (d ->> 'timer_res_ms')::numeric >= 0
          else false end
    and case when pg_catalog.jsonb_typeof(d -> 'viewport') = 'array' and pg_catalog.jsonb_array_length(d -> 'viewport') = 2 then
          pg_catalog.jsonb_typeof(d -> 'viewport' -> 0) = 'number' and (d -> 'viewport' ->> 0) ~ '^[0-9]{1,6}$'
          and pg_catalog.jsonb_typeof(d -> 'viewport' -> 1) = 'number' and (d -> 'viewport' ->> 1) ~ '^[0-9]{1,6}$'
        else false end
  else false end
$$;

-- schema/save-v1.json "flags": snake_case names, number / boolean / null values, at most 40.
create function hb.valid_flags(f jsonb)
returns boolean
language sql immutable
set search_path = ''
as $$
  select case when pg_catalog.jsonb_typeof(f) = 'object' then
    (select pg_catalog.count(*) from pg_catalog.jsonb_each(f)) <= 40
    and not exists (
      select 1 from pg_catalog.jsonb_each(f) e
       where e.key !~ '^[a-z][a-z0-9_]{0,63}$' or pg_catalog.jsonb_typeof(e.value) not in ('number', 'boolean', 'null'))
  else false end
$$;

-- A flag value that says "yes": true, or a number above 0.
create function hb.truthy(j jsonb)
returns boolean
language sql immutable
set search_path = ''
as $$
  select case pg_catalog.jsonb_typeof(j)
           when 'boolean' then (j #>> '{}')::boolean
           when 'number' then (j #>> '{}')::numeric > 0
           else false end
$$;

-- ---------------------------------------------------------------------------------- the session
-- The session a token opens, row-locked so a session's calls run one at a time. 401 for a token
-- that is malformed, unknown or expired, with the same message for each; 409 when the session is
-- finished and the call needs it open.
create function hb.session_for_token(p_token text, p_allow_finished boolean default false)
returns public.sessions
language plpgsql volatile
set search_path = ''
as $$
declare
  s public.sessions;
begin
  if p_token is null or p_token !~ '^hbt_[A-Za-z0-9_-]{22}$' then
    perform hb.fail(401, 'invalid_session');
  end if;
  select * into s from public.sessions x where x.token_hash = hb.token_hash(p_token) for update;
  if not found then
    perform hb.fail(401, 'invalid_session');
  end if;
  if s.finished_at is null then
    if pg_catalog.now() > s.started_at + pg_catalog.make_interval(mins => hb.cfg_int('session.ttl_minutes', 720)) then
      perform hb.fail(401, 'invalid_session', 'expired');
    end if;
  else
    if not p_allow_finished then
      perform hb.fail(409, 'session_finished');
    end if;
    if pg_catalog.now() > s.finished_at + pg_catalog.make_interval(mins => hb.cfg_int('session.post_finish_minutes', 1440)) then
      perform hb.fail(401, 'invalid_session', 'expired');
    end if;
  end if;
  return s;
end
$$;

-- ---------------------------------------------------------------------------------------- scoring
-- 10^n as an exact integer (numeric's ^ returns a value padded with zero decimals).
create function hb.pow10(p_n int)
returns numeric
language sql immutable
set search_path = ''
as $$ select ('1' || pg_catalog.repeat('0', p_n))::numeric $$;

-- What a person typed, as an exact fraction (DESIGN §3 row 6; the grammar of the bank's
-- hb.gen.quant.entry.parse_entry and the app's tasks/quant/numeric.ts, the same one):
-- surrounding spaces, tabs, line breaks and no-break spaces ignored; U+2212 is "-"; at most 32
-- characters; one leading sign; an optional "$" and an optional trailing "%", both ignored; then a
-- plain integer or decimal (42, -7, 12.5, .5, 3.), an integer with thousands commas (1,533), a
-- fraction a/b with b > 0, or a mixed number (2 1/3). Anything else gives nulls.
create function hb.parse_entry(p_raw text, out o_num numeric, out o_den numeric)
language plpgsql immutable
set search_path = ''
as $$
declare
  c_ws constant text := E' \t\n\r\f\u000b\u00a0';
  s text;
  v_neg boolean;
  m text[];
begin
  o_num := null;
  o_den := null;
  if p_raw is null then
    return;
  end if;
  s := pg_catalog.replace(pg_catalog.btrim(p_raw, c_ws), E'\u2212', '-');
  if s = '' or pg_catalog.char_length(s) > 32 then
    return;
  end if;
  v_neg := pg_catalog.left(s, 1) = '-';
  if pg_catalog.left(s, 1) in ('+', '-') then
    s := pg_catalog.substr(s, 2);
  end if;
  if pg_catalog.left(s, 1) = '$' then
    s := pg_catalog.substr(s, 2);
  end if;
  if pg_catalog.right(s, 1) = '%' then
    s := pg_catalog.left(s, pg_catalog.char_length(s) - 1);
  end if;
  s := pg_catalog.btrim(s, c_ws);

  m := pg_catalog.regexp_match(s, '^([0-9]+)(?:\.([0-9]*))?$');
  if m is not null then
    o_num := (m[1] || coalesce(m[2], ''))::numeric;
    o_den := hb.pow10(pg_catalog.char_length(coalesce(m[2], '')));
  else
    m := pg_catalog.regexp_match(s, '^\.([0-9]+)$');
    if m is not null then
      o_num := m[1]::numeric;
      o_den := hb.pow10(pg_catalog.char_length(m[1]));
    else
      m := pg_catalog.regexp_match(s, '^([0-9]{1,3}(?:,[0-9]{3})+)(?:\.([0-9]*))?$');
      if m is not null then
        o_num := (pg_catalog.replace(m[1], ',', '') || coalesce(m[2], ''))::numeric;
        o_den := hb.pow10(pg_catalog.char_length(coalesce(m[2], '')));
      else
        m := pg_catalog.regexp_match(s, E'^(?:([0-9]+)[ \t]+)?([0-9]+)[ \t]*/[ \t]*([0-9]+)$');
        if m is not null and m[3]::numeric <> 0 then
          o_den := m[3]::numeric;
          o_num := coalesce(m[1], '0')::numeric * o_den + m[2]::numeric;
        end if;
      end if;
    end if;
  end if;
  if o_num is not null and v_neg then
    o_num := -o_num;
  end if;
end
$$;

-- A decimal or integer as an exact fraction.
create function hb.dec_to_frac(p_n numeric, out o_num numeric, out o_den numeric)
language sql immutable
set search_path = ''
as $$
  select p_n * hb.pow10(pg_catalog.scale(p_n)), hb.pow10(pg_catalog.scale(p_n))
$$;

-- The key's target value ("p/q", "p", or a number) as a fraction; nulls when it is none of those.
create function hb.key_fraction(p_value jsonb, out o_num numeric, out o_den numeric)
language plpgsql immutable
set search_path = ''
as $$
declare
  v_text text := p_value #>> '{}';
  m text[];
begin
  o_num := null;
  o_den := null;
  if v_text is null then
    return;
  end if;
  m := pg_catalog.regexp_match(v_text, '^(-?[0-9]+)/([0-9]+)$');
  if m is not null then
    if m[2]::numeric <> 0 then
      o_num := m[1]::numeric;
      o_den := m[2]::numeric;
    end if;
  elsif v_text ~ '^-?[0-9]+(\.[0-9]+)?([eE][-+]?[0-9]+)?$' then
    select f.o_num, f.o_den into o_num, o_den from hb.dec_to_frac(v_text::numeric) f;
  end if;
end
$$;

-- Does the typed entry meet the key {value, tol: {abs | rel}} (or the item's tolerance column)? Exact
-- rational arithmetic, as the bank's within_tolerance. Without a tolerance, only equality counts.
create function hb.numeric_correct(p_entry text, p_key jsonb, p_tolerance jsonb)
returns boolean
language plpgsql immutable
set search_path = ''
as $$
declare
  e record;
  t record;
  v_tol jsonb := coalesce(p_key -> 'tol', p_tolerance);
  v_diff numeric;
  v_bound record;
begin
  select * into e from hb.parse_entry(p_entry);
  select * into t from hb.key_fraction(p_key -> 'value');
  if e.o_num is null or t.o_num is null then
    return false;
  end if;
  v_diff := pg_catalog.abs(e.o_num * t.o_den - t.o_num * e.o_den); -- |entry - target| * den_e * den_t
  if pg_catalog.jsonb_typeof(v_tol) = 'object' and v_tol ? 'abs' and pg_catalog.jsonb_typeof(v_tol -> 'abs') in ('number', 'string') then
    select * into v_bound from hb.dec_to_frac((v_tol ->> 'abs')::numeric);
    return v_diff * v_bound.o_den <= v_bound.o_num * e.o_den * t.o_den;
  elsif pg_catalog.jsonb_typeof(v_tol) = 'object' and v_tol ? 'rel' and pg_catalog.jsonb_typeof(v_tol -> 'rel') in ('number', 'string') then
    select * into v_bound from hb.dec_to_frac((v_tol ->> 'rel')::numeric);
    return v_diff * v_bound.o_den <= v_bound.o_num * pg_catalog.abs(t.o_num) * e.o_den;
  end if;
  return v_diff = 0;
end
$$;

-- Scores one response against the item's key, server side (R-11.1: the key never leaves). A key is
-- {index} (the option position), {letter} or {value, tol} (ROADMAP A18). A response that is not
-- valid for the key (null, wrong type, out of range, unparseable) scores 0, as the bank's families
-- do; an item with no key row (a block, scored by M2.2) is unscored: nulls. option_weights (SJT)
-- set the score by the chosen option.
create function hb.score_response(p_item_id text, p_response jsonb, out o_correct smallint, out o_score real)
language plpgsql stable
set search_path = ''
as $$
declare
  k record;
  v_idx numeric;
  v_valid boolean := false;
  v_text text;
  v_ok boolean;
begin
  o_correct := null;
  o_score := null;
  select ik.key, ik.tolerance, ik.option_weights,
         pg_catalog.jsonb_array_length(case when pg_catalog.jsonb_typeof(i.payload -> 'options') = 'array' then i.payload -> 'options' else '[]'::jsonb end) as n_opt
    into k
    from public.item_keys ik join public.items i on i.item_id = ik.item_id
   where ik.item_id = p_item_id;
  if not found then
    return;
  end if;

  if k.key ? 'index' then
    if pg_catalog.jsonb_typeof(p_response) = 'number' then
      v_idx := (p_response #>> '{}')::numeric;
      v_valid := v_idx = pg_catalog.trunc(v_idx) and v_idx >= 0 and (k.n_opt = 0 or v_idx < k.n_opt);
    end if;
    v_ok := v_valid and v_idx = (k.key ->> 'index')::numeric;
    o_correct := case when v_ok then 1 else 0 end;
    if pg_catalog.jsonb_typeof(k.option_weights) = 'array' then
      o_score := case when v_valid and v_idx < pg_catalog.jsonb_array_length(k.option_weights)
                      then (k.option_weights ->> v_idx::int)::real else 0 end;
    else
      o_score := o_correct::real;
    end if;
  elsif k.key ? 'letter' then
    v_ok := pg_catalog.jsonb_typeof(p_response) = 'string'
            and pg_catalog.upper(pg_catalog.btrim(p_response #>> '{}')) = pg_catalog.upper(k.key ->> 'letter');
    o_correct := case when v_ok then 1 else 0 end;
    o_score := o_correct::real;
  elsif k.key ? 'value' then
    v_text := case when pg_catalog.jsonb_typeof(p_response) in ('string', 'number') then p_response #>> '{}' end;
    v_ok := coalesce(hb.numeric_correct(v_text, k.key, k.tolerance), false);
    o_correct := case when v_ok then 1 else 0 end;
    o_score := o_correct::real;
  end if;
end
$$;

-- ------------------------------------------------------------------------------------ selection
-- M2.1 baseline (M2.2 replaces this body): a random live item that is not practice-only and that the
-- session cannot already have seen: not the same item, not in the same sibling group (A11/A18), and
-- not in the save the session started from (its seen items, its seen families and those families'
-- sibling groups).
create function hb.pick_item(p_s public.sessions)
returns text
language plpgsql volatile
set search_path = ''
as $$
declare
  v_items text[] := array(select pg_catalog.jsonb_array_elements_text(case when pg_catalog.jsonb_typeof(p_s.state -> 'seen_items') = 'array' then p_s.state -> 'seen_items' else '[]'::jsonb end));
  v_fams text[] := array(select pg_catalog.jsonb_array_elements_text(case when pg_catalog.jsonb_typeof(p_s.state -> 'seen_families') = 'array' then p_s.state -> 'seen_families' else '[]'::jsonb end));
  v_groups text[];
  v_pick text;
begin
  select coalesce(pg_catalog.array_agg(distinct f.sibling_group), '{}') into v_groups
    from public.item_families f where f.family_id = any (v_fams);
  select i.item_id into v_pick
    from public.items i
    join public.item_families f on f.family_id = i.family_id
   where i.status = 'live'
     and not f.practice_only
     and not (i.item_id = any (v_items))
     and not (f.family_id = any (v_fams))
     and not (f.sibling_group = any (v_groups))
     and not exists (
       select 1 from public.exposure_log e
        where e.session_id = p_s.session_id and (e.item_id = i.item_id or e.sibling_group = f.sibling_group))
   order by pg_catalog.random()
   limit 1;
  return v_pick;
end
$$;

-- What a client may see of an item: its id, type, time limit and the render payload (stem, media,
-- options). A whitelist projection, read from the payload column that already cannot hold a key
-- field. No key, no tolerance, no rationale, no parameters, no status.
create function hb.item_view(p_item_id text, p_seq int)
returns jsonb
language sql stable
set search_path = ''
as $$
  select pg_catalog.jsonb_build_object('seq', p_seq, 'item',
           pg_catalog.jsonb_build_object('item_id', i.item_id, 'item_type', i.item_type, 'time_limit_s', i.time_limit_s)
           || coalesce((select pg_catalog.jsonb_object_agg(e.key, e.value)
                          from pg_catalog.jsonb_each(i.payload) e
                         where e.key in ('stem', 'media', 'options')), '{}'::jsonb))
    from public.items i where i.item_id = p_item_id
$$;

-- The item the session should answer next: the one served and not yet answered (a reload gets the
-- same item), else a newly picked one, logged as an exposure. {done: true, reason} when the session
-- has had its items or the bank has nothing left for it.
create function hb.serve_next(p_s public.sessions)
returns jsonb
language plpgsql volatile
set search_path = ''
as $$
declare
  v_pending record;
  v_pick text;
  v_seq int;
  v_family text;
  v_group text;
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
  v_pick := hb.pick_item(p_s);
  if v_pick is null then
    return pg_catalog.jsonb_build_object('done', true, 'reason', 'no_items');
  end if;

  select i.family_id, f.sibling_group into v_family, v_group
    from public.items i join public.item_families f on f.family_id = i.family_id where i.item_id = v_pick;
  v_seq := p_s.n_served + 1;
  insert into public.exposure_log (session_id, seq, item_id, family_id, sibling_group)
  values (p_s.session_id, v_seq, v_pick, v_family, v_group);
  update public.sessions set n_served = v_seq where session_id = p_s.session_id;
  insert into public.item_exposure as x (item_id, n_sessions) values (v_pick, 1)
  on conflict (item_id) do update set n_sessions = x.n_sessions + 1;
  return hb.item_view(v_pick, v_seq);
end
$$;

-- ----------------------------------------------------------------------------- the finished session
-- Calibration eligibility (DESIGN §13; M2.2 adds the server-side person-fit and evidence). Not
-- eligible: not finished or nothing answered; the server's own time check failed (a session
-- averaging under session.min_avg_ms per item); the client reported person misfit; or two or more
-- integrity flags: one per flagged response for each of visibility_hidden, paste, too_fast, plus one
-- for each session-level uniform_rt and hard_item_accuracy (engine/integrity.ts calibrationEligible).
create function hb.is_eligible(p_session_id text)
returns boolean
language plpgsql stable
set search_path = ''
as $$
declare
  s public.sessions;
  v_count int;
begin
  select * into s from public.sessions x where x.session_id = p_session_id;
  if not found or s.finished_at is null or s.n_answered < 1 then
    return false;
  end if;
  if hb.truthy(s.flags -> 'server_too_fast') or hb.truthy(s.flags -> 'person_fit') then
    return false;
  end if;
  select pg_catalog.count(*) into v_count
    from public.responses r
   cross join (values ('visibility_hidden'), ('paste'), ('too_fast')) k (kind)
   where r.session_id = p_session_id and hb.truthy(r.client_flags -> k.kind);
  v_count := v_count
    + (case when hb.truthy(s.flags -> 'uniform_rt') then 1 else 0 end)
    + (case when hb.truthy(s.flags -> 'hard_item_accuracy') then 1 else 0 end);
  return v_count < 2;
end
$$;

-- The session as a save-v1 session object (schema/save-v1.json "session", DESIGN §8), built from the
-- rows the server holds: responses as [item_id, pretest, response, correct, rt_ms, confidence].
-- No sig yet: the per-session HMAC is M2.3.
create function hb.session_object(p_session_id text)
returns jsonb
language sql stable
set search_path = ''
as $$
  select pg_catalog.jsonb_build_object(
    'session_id', s.session_id,
    'started_utc', pg_catalog.to_char(s.started_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"'),
    'duration_s', pg_catalog.round(extract(epoch from coalesce(s.finished_at, pg_catalog.now()) - s.started_at)::numeric, 3),
    'device', s.device,
    'flags', s.flags,
    'responses', coalesce((
      select pg_catalog.jsonb_agg(
               pg_catalog.jsonb_build_array(r.item_id, case when r.pretest then 1 else 0 end, r.response, r.correct, r.rt_ms, r.confidence)
               order by r.seq)
        from public.responses r where r.session_id = s.session_id), '[]'::jsonb))
    from public.sessions s where s.session_id = p_session_id
$$;

-- ------------------------------------------------------------------------------------ a save
-- A save passed to an RPC (schema/save-v1.json, DESIGN §8): a JSON object of bounded size, free of
-- brief_prefs (AI.26), with a well-formed anon_id and a sessions array. Returns the anon_id; 400 or 413
-- otherwise. Deeper checks (every session, every response) are the caller's business.
create function hb.check_save(p_save jsonb)
returns text
language plpgsql stable
set search_path = ''
as $$
declare
  v_anon text;
begin
  if p_save is null or pg_catalog.jsonb_typeof(p_save) <> 'object' then
    perform hb.fail(400, 'invalid_save', 'A save file is a JSON object.');
  end if;
  if pg_catalog.octet_length(p_save::text) > hb.cfg_int('save.max_bytes', 2097152) then
    perform hb.fail(413, 'save_too_large');
  end if;
  perform hb.reject_brief_prefs(p_save);
  v_anon := p_save ->> 'anon_id';
  if v_anon is null or v_anon !~ '^hb_[0-9A-Za-z]{16,17}$' then
    perform hb.fail(400, 'invalid_save', 'anon_id is missing or malformed.');
  end if;
  if pg_catalog.jsonb_typeof(p_save -> 'sessions') is distinct from 'array' then
    perform hb.fail(400, 'invalid_save', 'sessions must be an array.');
  end if;
  return v_anon;
end
$$;

-- A list of ids from a save (seen_items, seen_families): an array of short strings, at most
-- save.max_seen of them. Returns it, or an empty array when absent. 400 otherwise.
create function hb.check_id_list(p_list jsonb, p_name text)
returns jsonb
language plpgsql stable
set search_path = ''
as $$
begin
  if p_list is null then
    return '[]'::jsonb;
  end if;
  if pg_catalog.jsonb_typeof(p_list) <> 'array' or pg_catalog.jsonb_array_length(p_list) > hb.cfg_int('save.max_seen', 20000) then
    perform hb.fail(400, 'invalid_save', p_name || ' must be an array of at most ' || hb.cfg_int('save.max_seen', 20000) || ' ids.');
  end if;
  if exists (select 1 from pg_catalog.jsonb_array_elements(p_list) e
              where pg_catalog.jsonb_typeof(e) <> 'string' or pg_catalog.char_length(e #>> '{}') > 256) then
    perform hb.fail(400, 'invalid_save', p_name || ' must hold id strings of at most 256 characters.');
  end if;
  return p_list;
end
$$;

-- Checks a recovery phrase against a stored hash and counts a failure per client address and day.
-- Returns false on a mismatch, without raising, so that the count is kept; raises 429 once the
-- address has used up its failures. p_hash is null when there is no such mirror (the same answer and
-- the same cost as a wrong phrase). There is no per-anon_id lockout on purpose: a phrase is 120 random
-- bits, so guessing is hopeless, and a lockout would let anyone who knows an anon_id block its owner.
create function hb.phrase_ok(p_phrase text, p_hash bytea)
returns boolean
language plpgsql volatile
set search_path = ''
as $$
declare
  v_ip text := hb.ip_key('phrase_fail');
  v_given bytea := hb.phrase_hash(p_phrase);
begin
  if hb.rate_count('phrase_fail_ip', v_ip) >= hb.cfg_int('rate.phrase_failures_per_ip_day', 60) then
    perform hb.fail(429, 'rate_limited', 'too many wrong phrases today');
  end if;
  if p_hash is not null and p_phrase is not null and v_given = p_hash then
    return true;
  end if;
  perform hb.rate_bump('phrase_fail_ip', v_ip);
  return false;
end
$$;

-- The population prior of a single axis for the own-axis EAP (DESIGN §7.8, ROADMAP A2, A8, A21):
-- N(0, 1), the unit diagonal of Sigma_init. The location and scale are provisional until M4.8, so
-- they live in one place.
create function hb.axis_prior_mean(p_axis text)
returns double precision
language sql immutable
set search_path = ''
as $$ select 0::double precision $$;

create function hb.axis_prior_var(p_axis text)
returns double precision
language sql immutable
set search_path = ''
as $$ select 1::double precision $$;

-- ------------------------------------------------------------------------------- ownership proof
-- Does this save session belong to this anon_id? M2.1: the server issued that session_id to that
-- anon_id (96 random bits, held only by the person's own save). M2.3 replaces this with the
-- per-session HMAC (ROADMAP A16): until then it is only as strong as keeping the save private.
create function hb.session_owned(p_session jsonb, p_anon_id text)
returns boolean
language sql stable
set search_path = ''
as $$
  select exists (
    select 1 from public.sessions s
     where s.session_id = p_session ->> 'session_id'
       and s.anon_id = coalesce(p_session #>> '{sig,anon_id}', p_anon_id))
$$;

reset role;
revoke create on schema public from hb_definer;
