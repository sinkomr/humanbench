-- M2.1 (ROADMAP M2.1; DESIGN §11.2, §12, R-11.1, R-12.1; ROADMAP A6, AI.26): the foundation every
-- other migration builds on.
--
-- 1. hb_definer: the restricted role that OWNS every function. It is not a superuser, does not
--    bypass RLS and owns no table, so a SECURITY DEFINER function runs with exactly the table
--    grants and RLS policies written for it below, and nothing else (R-11.1: item_keys is read only
--    by definer functions "owned by a restricted role"). The migration role (`postgres`) only
--    creates functions through `set local role hb_definer`.
-- 2. Schema `hb`: private helpers. Not exposed over the API; nobody but hb_definer can use it.
-- 3. Default privileges: nothing `postgres` creates in `public` reaches anon, authenticated or
--    service_role unless a migration grants it (the Supabase default grants everything).
-- 4. Pure JSON helpers the table CHECK constraints use (a payload carries no key-bearing field;
--    no stored client JSON carries a `brief_prefs` key, AI.26).
--
-- Conventions for every later migration (a test enforces them from the catalog):
--   * create functions between "set local role hb_definer" and "reset role"
--   * every function: "set search_path = ''" and schema-qualified names (pgcrypto is `extensions.`)
--   * RPCs in `public` are SECURITY DEFINER and granted to anon, authenticated explicitly;
--     helpers live in `hb` and are granted to nobody
--   * every table: RLS enabled, no policy for anon or authenticated

do $$
begin
  if not exists (select 1 from pg_catalog.pg_roles where rolname = 'hb_definer') then
    create role hb_definer nologin;
  end if;
end
$$;

-- PostgreSQL 16+: creating a role does not make the creator a member of it.
grant hb_definer to postgres;

create schema if not exists hb authorization hb_definer;
revoke all on schema hb from public;

grant usage on schema extensions to hb_definer;
grant usage on schema public to hb_definer;
-- Temporary: lets hb_definer create the functions in `public`. Revoked at the end of this file;
-- every migration that adds functions repeats the pair.
grant create on schema public to hb_definer;

-- Nothing new is reachable by default. Tables, sequences and functions that `postgres` creates in
-- `public` carry no grant for the API roles (they are granted explicitly, table by table), and
-- functions that hb_definer creates carry no EXECUTE for PUBLIC either.
alter default privileges for role postgres in schema public revoke all on tables from anon, authenticated, service_role;
alter default privileges for role postgres in schema public revoke all on sequences from anon, authenticated, service_role;
alter default privileges for role postgres in schema public revoke all on functions from anon, authenticated, service_role;
alter default privileges for role hb_definer revoke execute on functions from public;

set local role hb_definer;

-- True if any object anywhere in `j` (arrays and nested objects included) has a key matching the
-- case-insensitive regular expression `p_re`. A recursive walk instead of a jsonpath so that the
-- match is case-insensitive and cannot be thrown by an odd value.
create function hb.json_has_key(j jsonb, p_re text)
returns boolean
language sql immutable parallel safe
set search_path = ''
as $$
  with recursive walk(v) as (
    select j
    union all
    select c.child
    from walk w
    cross join lateral (
      select e.value as child
        from pg_catalog.jsonb_each(case when pg_catalog.jsonb_typeof(w.v) = 'object' then w.v else '{}'::jsonb end) e
      union all
      select a.value as child
        from pg_catalog.jsonb_array_elements(case when pg_catalog.jsonb_typeof(w.v) = 'array' then w.v else '[]'::jsonb end) a
    ) c
  )
  select exists (
    select 1
      from walk w
     cross join lateral pg_catalog.jsonb_object_keys(case when pg_catalog.jsonb_typeof(w.v) = 'object' then w.v else '{}'::jsonb end) k
     where k ~* p_re
  )
$$;

-- AI.26 / R-17.1 / R-17.12: the notes settings never reach the server. True when `j` is clean.
create function hb.no_brief_prefs(j jsonb)
returns boolean
language sql immutable parallel safe
set search_path = ''
as $$ select not hb.json_has_key(j, '^brief_prefs$') $$;

-- R-11.1 / DESIGN §11.2: "payloads never include keys, rationales or parameters". The names the
-- bank's G1 already forbids in a render spec (key, keys, ans, answer(s), correct, solution(s)) plus
-- the item_keys column names. True when `j` is clean. The bank's own check is stricter (camelCase
-- words, stems); this one is the database's last line.
--
-- SECURITY DEFINER because items.payload's CHECK runs as whoever writes the row: the bank pipeline
-- (service_role) must be able to run it without being given the hb schema. It is the one function
-- outside `public` that an API role may execute.
create function hb.no_key_fields(j jsonb)
returns boolean
language sql immutable parallel safe security definer
set search_path = ''
as $$
  select not hb.json_has_key(j, '^(key|keys|ans|answer|answers|correct|solution|solutions|tolerance|option_weights|rationale)$')
$$;

revoke all on function hb.json_has_key(jsonb, text) from public;
revoke all on function hb.no_brief_prefs(jsonb) from public;
revoke all on function hb.no_key_fields(jsonb) from public;
grant execute on function hb.no_key_fields(jsonb) to service_role;

reset role;

revoke create on schema public from hb_definer;
