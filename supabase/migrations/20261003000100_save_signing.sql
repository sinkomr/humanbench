-- M2.3 (ROADMAP M2.3; DESIGN §8 "Tamper evidence", §13, R-8.1, R-11.1, R-12.1; ROADMAP A6, A16, AI.26): per-session
-- HMAC saves, the Vault signing key with `kid` rotation, and the unverified path.
--
-- What is signed (A16). `finish` returns the finished session as a save-v1 session object; it now also carries
--
--     "sig": {"alg": "HMAC-SHA256", "kid": "<key id>", "mac": "<base64url, no padding>", "anon_id": "hb_..."}
--
--     mac = HMAC-SHA256(K[kid], UTF-8 bytes of the RFC 8785 canonical JSON of
--                       {"anon_id": <sig.anon_id>, "kind": "hb.session.v1", "session": <the session without sig>})
--
-- So the MAC covers the session's own data and the anon_id the server issued it to, and nothing else: not the
-- file around it, so editing preferences, the seen lists, the posterior cache or merging with other files never
-- changes a session's verdict (AI.26: `brief_prefs` is not a part of any session, and the server rejects a file
-- that holds it). The anon_id travels in the sig because a merge may give the file another one.
--
-- The server signs exactly one thing: a session it built from its own rows, at `finish` (hb.session_signed). No
-- RPC takes a file, a session or any text from the caller and signs it, so a file that holds sessions the server
-- never issued cannot be made to look signed (A16: "the server refuses to sign a file that contains any unverified
-- session" holds by construction; a test lists the callers of the signer from the catalog). Calibration reads the
-- database's rows and never an upload (A16), so nothing a person sends can enter it, signed or not.
--
-- The unverified path (DESIGN §8). `verify_save` accepts any save and tells, per session, "verified" or
-- "unverified" with a reason: unsigned (an offline-MVP file, a hand-written one), bad_signature (edited, or
-- another anon_id), unknown_key (its kid has no key), malformed. An unverified session is still the person's to
-- display and keep; it is never counted anywhere on the server. rescore, delete_my_data and start_session's
-- anon_id adoption all need a verified session that the server also holds (hb.session_owned).
--
-- The key. It lives in the Vault as the secret `save_hmac.<kid>` (any text of at least 32 characters; its UTF-8
-- bytes are the HMAC key). `app_config` `sig.current_kid` names the key that signs new sessions. Rotation:
--   1. create the secret `save_hmac.<new kid>` in the Vault;
--   2. set `sig.current_kid` to the new kid: new sessions are signed with it, sessions signed with the old kid keep
--      verifying as long as its secret exists;
--   3. delete the old secret only to retire a key on purpose (a leaked one): everything signed with it is then
--      "unverified: unknown_key".
-- No key, or a key shorter than 32 characters, means no signature: `finish` still returns the session, unsigned,
-- and nothing verifies. This migration creates no secret (CLAUDE.md: no real secrets in the repo); M2.6 creates the
-- real one, and the local database gets a random throw-away one (supabase/local/database/50-signing-key.sql).
--
-- Who can read the key. Only hb.mac_sign, a SECURITY DEFINER function owned by its own role (hb_signer), which
-- alone may select from the Vault. It returns a MAC, never the key. hb_definer, which owns every other function and
-- therefore every RPC, can call it and cannot read the Vault: a bug in any RPC cannot return a key.
--
-- Canonical JSON. hb.jcs is RFC 8785 (I-JSON input): keys in UTF-16 code unit order, no whitespace, strings as
-- PostgreSQL writes them (the same escapes as ECMAScript), numbers as ECMAScript prints the nearest double. A test
-- compares it with the app's src/save/jcs.ts on random values; the server and the client agree on the bytes.
--
-- Limits: a session over sig.max_session_bytes, or nested deeper than 24 levels, is "malformed" and costs no
-- canonicalisation; verify_save takes at most verify.max_sessions sessions and rate.verifies_per_day calls per
-- hashed client address and day.

-- ------------------------------------------------------------------------------ the signer role
do $$
begin
  if not exists (select 1 from pg_catalog.pg_roles where rolname = 'hb_signer') then
    create role hb_signer nologin;
  end if;
end
$$;

grant hb_signer to postgres;

-- The three things the signer needs, each separately (supabase/README.md, pitfall 3). Revoked again from the
-- schema `hb` below: it needs it only to create its function there.
grant usage on schema extensions to hb_signer;
grant usage on schema vault to hb_signer;
grant select on table vault.decrypted_secrets to hb_signer;

-- PostgreSQL lets PUBLIC execute a new function unless the creating role's defaults say otherwise.
alter default privileges for role hb_signer revoke execute on functions from public;

set local role hb_definer;
grant usage, create on schema hb to hb_signer;
reset role;

set local role hb_signer;

-- HMAC-SHA256 of p_msg under the Vault secret `save_hmac.<p_kid>`, base64url without padding. Null when the kid is
-- malformed, has no secret, or its secret is shorter than 32 characters (a weak key signs nothing and verifies
-- nothing). The key is read here and goes nowhere else.
create function hb.mac_sign(p_kid text, p_msg text)
returns text
language sql stable security definer
set search_path = ''
as $$
  select pg_catalog.translate(
           pg_catalog.rtrim(
             pg_catalog.encode(
               extensions.hmac(pg_catalog.convert_to(p_msg, 'UTF8'), pg_catalog.convert_to(s.decrypted_secret, 'UTF8'), 'sha256'),
               'base64'),
             '='),
           '+/', '-_')
    from vault.decrypted_secrets s
   where p_kid ~ '^[0-9A-Za-z._-]{1,64}$'
     and s.name = 'save_hmac.' || p_kid
     and pg_catalog.char_length(s.decrypted_secret) >= 32
$$;

revoke all on function hb.mac_sign(text, text) from public;
grant execute on function hb.mac_sign(text, text) to hb_definer;

reset role;

set local role hb_definer;
revoke usage, create on schema hb from hb_signer;
reset role;

-- ------------------------------------------------------------------------------------ settings
insert into public.app_config (key, value, description) values
  ('sig.current_kid',      '"k2026a"', 'kid of the Vault secret `save_hmac.<kid>` that signs new sessions (M2.3). Rotate by creating the new secret first, then changing this; delete an old secret only to retire that key. No secret, no signature'),
  ('sig.max_session_bytes','262144',   'a session larger than this (as JSON text) is "malformed" when verified: a real one is 10 to 60 KB'),
  ('verify.max_sessions',  '200',      'most sessions in a save passed to verify_save'),
  ('rate.verifies_per_day','60',       'verify_save calls per hashed IP per UTC day');

-- ------------------------------------------------------------------------------- the functions
grant create on schema public to hb_definer;
set local role hb_definer;

-- A string as the sequence of its UTF-16 code units (a code point above U+FFFF is a surrogate pair), which is the
-- order RFC 8785 sorts keys in. It differs from the order of code points, for example for U+FB33 against U+1F600.
create function hb.utf16_units(p_text text)
returns int[]
language sql immutable
set search_path = ''
as $$
  select coalesce(pg_catalog.array_agg(u.unit order by g.i, u.k), '{}'::int[])
    from pg_catalog.generate_series(1, pg_catalog.char_length(p_text)) g (i)
   cross join lateral (select pg_catalog.ascii(pg_catalog.substr(p_text, g.i, 1)) as cp) c
   cross join lateral (
     select 0 as k, case when c.cp < 65536 then c.cp else 55296 + ((c.cp - 65536) >> 10) end as unit
     union all
     select 1, 56320 + ((c.cp - 65536) & 1023) where c.cp >= 65536
   ) u
$$;

-- A number as ECMAScript's Number.prototype.toString prints the double nearest to it (RFC 8785 §3.2.2.3): the
-- shortest digits that read back as the same double, laid out by the rules of ECMA-262 §6.1.6.1.20.
-- extra_float_digits is pinned because the digits come from float8's text form, which is the shortest round-trip
-- form only for a positive setting (PostgreSQL's default, but a role or a client may change it).
create function hb.jcs_number(p_n numeric)
returns text
language plpgsql immutable
set extra_float_digits = 1
set search_path = ''
as $$
declare
  v_f double precision;
  v_text text;
  v_neg boolean;
  v_m text[];
  v_int text;
  v_digits text;
  v_n int;
  v_k int;
  v_head numeric;
  v_cand numeric;
  v_same boolean;
begin
  if p_n = 0 then
    return '0';
  end if;
  v_f := p_n::double precision; -- out of range raises: the caller treats the value as unusable
  if v_f = 0 then
    return '0';
  end if;
  v_text := v_f::text;
  v_neg := pg_catalog.left(v_text, 1) = '-';
  if v_neg then
    v_text := pg_catalog.substr(v_text, 2);
  end if;
  v_m := pg_catalog.regexp_match(v_text, '^([0-9]*)(?:\.([0-9]*))?(?:e([+-]?[0-9]+))?$');
  if v_m is null then
    perform hb.fail(400, 'invalid_number');
  end if;
  v_int := coalesce(v_m[1], '');
  v_digits := v_int || coalesce(v_m[2], '');
  v_n := pg_catalog.char_length(v_int) + coalesce(v_m[3], '0')::int; -- the value is 0.<digits> x 10^n
  while pg_catalog.left(v_digits, 1) = '0' and pg_catalog.char_length(v_digits) > 1 loop
    v_digits := pg_catalog.substr(v_digits, 2);
    v_n := v_n - 1;
  end loop;
  v_digits := pg_catalog.rtrim(v_digits, '0');
  v_k := pg_catalog.char_length(v_digits);
  if v_k = 0 then
    return '0';
  end if;
  -- PostgreSQL's shortest-digits routine never takes a decimal that lies exactly on the edge of the numbers that
  -- read back as this double (it prints 1e23 as 9.999999999999999e+22); ECMAScript reads ties to even and does
  -- take it. Such an edge is an integer of 54 bits or so, so only magnitudes from 1e16 can have one: look for
  -- a shorter string that reads back as the same double, the shortest first.
  if v_n >= 17 and v_k > 1 then
    <<shorter>>
    for j in 1 .. v_k - 1 loop
      v_head := pg_catalog.substr(v_digits, 1, j)::numeric;
      for pass in 1 .. 2 loop
        -- the nearer of head and head + 1 first
        v_cand := v_head + case when (pg_catalog.substr(v_digits, j + 1, 1) >= '5') = (pass = 1) then 1 else 0 end;
        begin
          v_same := (v_cand::text || 'e' || (v_n - j)::text)::double precision = pg_catalog.abs(v_f);
        exception when numeric_value_out_of_range then
          v_same := false; -- 2e308 is not a number a double can be
        end;
        if v_same then
          v_n := v_n + (pg_catalog.char_length(v_cand::text) - j); -- 99 + 1 = 100 is one digit longer
          v_digits := pg_catalog.rtrim(v_cand::text, '0');
          v_k := pg_catalog.char_length(v_digits);
          exit shorter;
        end if;
      end loop;
    end loop;
  end if;
  return case when v_neg then '-' else '' end ||
    case
      when v_k <= v_n and v_n <= 21 then v_digits || pg_catalog.repeat('0', v_n - v_k)
      when 0 < v_n and v_n <= 21 then pg_catalog.substr(v_digits, 1, v_n) || '.' || pg_catalog.substr(v_digits, v_n + 1)
      when -6 < v_n and v_n <= 0 then '0.' || pg_catalog.repeat('0', - v_n) || v_digits
      else
        pg_catalog.substr(v_digits, 1, 1) || case when v_k > 1 then '.' || pg_catalog.substr(v_digits, 2) else '' end
        || 'e' || case when v_n - 1 < 0 then '-' else '+' end || pg_catalog.abs(v_n - 1)::text
    end;
end
$$;

-- RFC 8785 canonical JSON of a jsonb value. A jsonb scalar's text form is already what RFC 8785 asks for in a
-- string (the escapes are those of ECMAScript's JSON.stringify), in true, false and null, and in an integer of up
-- to 15 digits; every other number goes through hb.jcs_number. Nesting beyond 24 levels raises (400 too_deep);
-- callers that can meet client data catch it.
create function hb.jcs(p_json jsonb, p_depth int default 0)
returns text
language plpgsql immutable
set search_path = ''
as $$
declare
  v_type text := pg_catalog.jsonb_typeof(p_json);
begin
  if p_depth > 24 then
    perform hb.fail(400, 'too_deep');
  end if;
  if v_type = 'object' then
    return '{' || coalesce((
      select pg_catalog.string_agg(
               pg_catalog.to_jsonb(e.key)::text || ':' ||
               case e.t
                 when 'string' then e.value::text
                 when 'boolean' then e.value::text
                 when 'null' then 'null'
                 when 'number' then case when e.value::text ~ '^-?[0-9]{1,15}$' then e.value::text else hb.jcs_number((e.value #>> '{}')::numeric) end
                 else hb.jcs(e.value, p_depth + 1)
               end,
               ',' order by hb.utf16_units(e.key))
        from (select x.key, x.value, pg_catalog.jsonb_typeof(x.value) as t from pg_catalog.jsonb_each(p_json) x) e), '') || '}';
  elsif v_type = 'array' then
    return '[' || coalesce((
      select pg_catalog.string_agg(
               case e.t
                 when 'string' then e.value::text
                 when 'boolean' then e.value::text
                 when 'null' then 'null'
                 when 'number' then case when e.value::text ~ '^-?[0-9]{1,15}$' then e.value::text else hb.jcs_number((e.value #>> '{}')::numeric) end
                 else hb.jcs(e.value, p_depth + 1)
               end,
               ',' order by e.ord)
        from (select x.value, x.ord, pg_catalog.jsonb_typeof(x.value) as t from pg_catalog.jsonb_array_elements(p_json) with ordinality x (value, ord)) e), '') || ']';
  elsif v_type = 'number' then
    return case when p_json::text ~ '^-?[0-9]{1,15}$' then p_json::text else hb.jcs_number((p_json #>> '{}')::numeric) end;
  end if;
  return p_json::text;
end
$$;

-- The bytes the MAC is computed over, and the MAC: null when the kid has no usable key. Raises on a value that
-- cannot be canonicalised (too deep, a number outside the double range).
create function hb.session_mac(p_kid text, p_anon_id text, p_body jsonb)
returns text
language sql stable
set search_path = ''
as $$
  select hb.mac_sign(p_kid, hb.jcs(pg_catalog.jsonb_build_object('anon_id', p_anon_id, 'kind', 'hb.session.v1', 'session', p_body)))
$$;

-- schema/save-v1.json "session_sig": a closed object of the four fields.
create function hb.valid_session_sig(p_sig jsonb)
returns boolean
language sql immutable
set search_path = ''
as $$
  select case when pg_catalog.jsonb_typeof(p_sig) = 'object' then
    (p_sig - 'alg' - 'kid' - 'mac' - 'anon_id') = '{}'::jsonb
    and p_sig ?& array['alg', 'kid', 'mac', 'anon_id']
    and pg_catalog.jsonb_typeof(p_sig -> 'alg') = 'string' and (p_sig ->> 'alg') = 'HMAC-SHA256'
    and pg_catalog.jsonb_typeof(p_sig -> 'kid') = 'string' and (p_sig ->> 'kid') ~ '^[0-9A-Za-z._-]{1,64}$'
    and pg_catalog.jsonb_typeof(p_sig -> 'mac') = 'string' and (p_sig ->> 'mac') ~ '^[0-9A-Za-z+/=._-]+$' and pg_catalog.char_length(p_sig ->> 'mac') <= 512
    and pg_catalog.jsonb_typeof(p_sig -> 'anon_id') = 'string' and (p_sig ->> 'anon_id') ~ '^hb_[0-9A-Za-z]{16,17}$'
  else false end
$$;

-- What the server says of a session object it was sent: 'verified', or why not. The MAC is checked against the
-- anon_id the sig itself names; whether that is the caller's is hb.session_owned's business. Never raises.
--   unsigned       no sig (an offline-MVP file, a hand-written one)
--   malformed      not an object, a sig that is not the closed object of the schema, too large, too deep, or a
--                  value that cannot be canonicalised
--   unknown_key    the sig's kid has no usable key (never issued here, or retired)
--   bad_signature  the session or its anon_id differ from what was signed, or the MAC is not the server's
-- The two MACs are compared through their SHA-256 digests, so the time the comparison takes says nothing about how
-- many leading characters of a guess were right.
create function hb.session_verdict(p_session jsonb)
returns text
language plpgsql stable
set search_path = ''
as $$
declare
  v_sig jsonb;
  v_expected text;
begin
  if pg_catalog.jsonb_typeof(p_session) is distinct from 'object' then
    return 'malformed';
  end if;
  v_sig := p_session -> 'sig';
  if v_sig is null or pg_catalog.jsonb_typeof(v_sig) = 'null' then
    return 'unsigned';
  end if;
  if not hb.valid_session_sig(v_sig) then
    return 'malformed';
  end if;
  if pg_catalog.octet_length(p_session::text) > hb.cfg_int('sig.max_session_bytes', 262144) then
    return 'malformed';
  end if;
  begin
    v_expected := hb.session_mac(v_sig ->> 'kid', v_sig ->> 'anon_id', p_session - 'sig');
  exception when others then
    return 'malformed';
  end;
  if v_expected is null then
    return 'unknown_key';
  end if;
  if extensions.digest(v_expected, 'sha256') = extensions.digest(v_sig ->> 'mac', 'sha256') then
    return 'verified';
  end if;
  return 'bad_signature';
end
$$;

-- Does this session of an upload belong to p_anon_id (the caller's, named in the call)? All of: the server holds
-- the session, finished, issued to that anon_id; the sig binds the same anon_id; and the sig verifies, so the
-- upload is the session as the server issued it. This is the seam of M2.1 (the unsigned check), now the HMAC of
-- A16. The cheap, indexed checks come first: a session the server never issued costs no canonicalisation.
create or replace function hb.session_owned(p_session jsonb, p_anon_id text)
returns boolean
language plpgsql stable
set search_path = ''
as $$
begin
  if p_anon_id is null or pg_catalog.jsonb_typeof(p_session) is distinct from 'object' then
    return false;
  end if;
  if (p_session #>> '{sig,anon_id}') is distinct from p_anon_id then
    return false;
  end if;
  if not exists (
    select 1 from public.sessions s
     where s.session_id = p_session ->> 'session_id' and s.anon_id = p_anon_id and s.finished_at is not null) then
    return false;
  end if;
  return hb.session_verdict(p_session) = 'verified';
end
$$;

-- Does this save hold a session the server issued to p_anon_id and signed for it? start_session adopts the
-- anon_id of a save, and delete_my_data deletes, on it. Merged files are fine: it asks only about the one id named,
-- whatever else the file holds. Only the first verify.max_sessions sessions of the file are looked at, so a file
-- padded with thousands of entries cannot make the server verify thousands of MACs.
create or replace function hb.save_proves_anon(p_save jsonb, p_anon_id text)
returns boolean
language sql stable
set search_path = ''
as $$
  select p_anon_id is not null
     and pg_catalog.jsonb_typeof(p_save -> 'sessions') = 'array'
     and exists (
       select 1
         from pg_catalog.jsonb_array_elements(p_save -> 'sessions') with ordinality e (value, ord)
        where e.ord <= hb.cfg_int('verify.max_sessions', 200)
          and pg_catalog.jsonb_typeof(e.value) = 'object' and hb.session_owned(e.value, p_anon_id))
$$;

-- The finished session as `finish` hands it over: hb.session_object plus its sig. Without a usable key for
-- sig.current_kid (none created, a short one, a value that cannot be canonicalised, a session over
-- sig.max_session_bytes) the session comes unsigned,
-- which is "unverified" everywhere, rather than a finish that fails and loses the person's results. An unfinished
-- session is never signed.
create function hb.session_signed(p_session_id text)
returns jsonb
language plpgsql stable
set search_path = ''
as $$
declare
  s public.sessions;
  v_obj jsonb := hb.session_object(p_session_id);
  v_kid text := hb.cfg_text('sig.current_kid', null);
  v_mac text;
begin
  select * into s from public.sessions x where x.session_id = p_session_id;
  if not found or s.finished_at is null or v_kid is null then
    return v_obj;
  end if;
  -- what hb.session_verdict would call "malformed" is not signed either: a MAC nobody can verify is no use to the person
  if pg_catalog.octet_length(v_obj::text) > hb.cfg_int('sig.max_session_bytes', 262144) then
    return v_obj;
  end if;
  begin
    v_mac := hb.session_mac(v_kid, s.anon_id, v_obj);
  exception when others then
    v_mac := null;
  end;
  if v_mac is null then
    return v_obj;
  end if;
  return v_obj || pg_catalog.jsonb_build_object('sig',
    pg_catalog.jsonb_build_object('alg', 'HMAC-SHA256', 'kid', v_kid, 'mac', v_mac, 'anon_id', s.anon_id));
end
$$;

-- verify_save(p_save): the unverified path as an API. Accepts any save-v1 file (bar the notes settings, which the
-- client strips, AI.26) and says per session whether the server issued it as it stands. A file full of unverified
-- sessions is not an error: it is the person's own data, to show and keep. Nothing in it is stored.
create function public.verify_save(p_save jsonb)
returns jsonb
language plpgsql security definer
set search_path = ''
as $$
declare
  v_anon text;
  v_rows jsonb;
begin
  v_anon := hb.check_save(p_save);
  if pg_catalog.jsonb_array_length(p_save -> 'sessions') > hb.cfg_int('verify.max_sessions', 200) then
    perform hb.fail(413, 'too_many_sessions', 'At most ' || hb.cfg_int('verify.max_sessions', 200) || ' sessions per call.');
  end if;
  perform hb.rate_hit('verify_save', hb.ip_key('verify_save'), hb.cfg_int('rate.verifies_per_day', 60));

  select coalesce(pg_catalog.jsonb_agg(
           pg_catalog.jsonb_build_object(
             'session_id', case when (e.value ->> 'session_id') ~ '^s_[0-9A-Za-z]{8,32}$' then e.value ->> 'session_id' end,
             'status', case when e.verdict = 'verified' then 'verified' else 'unverified' end,
             'reason', case when e.verdict = 'verified' then null else e.verdict end)
           order by e.ord), '[]'::jsonb)
    into v_rows
    from (
      select x.value, x.ord, hb.session_verdict(x.value) as verdict
        from pg_catalog.jsonb_array_elements(p_save -> 'sessions') with ordinality x (value, ord)) e;

  return pg_catalog.jsonb_build_object(
    'anon_id', v_anon,
    'sessions', v_rows,
    'n_verified', (select pg_catalog.count(*) from pg_catalog.jsonb_array_elements(v_rows) r where r ->> 'status' = 'verified'),
    'n_unverified', (select pg_catalog.count(*) from pg_catalog.jsonb_array_elements(v_rows) r where r ->> 'status' = 'unverified'));
end
$$;

revoke all on function public.verify_save(jsonb) from public, anon, authenticated, service_role;
grant execute on function public.verify_save(jsonb) to anon, authenticated;

reset role;
revoke create on schema public from hb_definer;
