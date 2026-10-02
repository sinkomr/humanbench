-- Local stand-in for the roles a Supabase project ships with (ROADMAP M2.0, A6).
--
-- Cluster-wide; the harness runs this once per throw-away cluster, as the cluster superuser
-- (`supabase_admin`, as on Supabase). It is NOT a migration and never reaches a real project.
--
-- No password is set here. The harness gives `postgres` and `authenticator` a random password per
-- run (web/scripts/db/harness.ts); the NOLOGIN roles have none, as on Supabase.
--
-- Verify against the live project at M2.6 (ROADMAP): the attribute lists below follow Supabase's
-- documented defaults, not an export of a real project.

-- The three API roles PostgREST switches to with SET LOCAL ROLE, from the request's JWT.
create role anon nologin noinherit;
create role authenticated nologin noinherit;
create role service_role nologin noinherit bypassrls;

-- PostgREST's own login role: it can do nothing itself (NOINHERIT) but may become an API role.
create role authenticator noinherit login;
grant anon, authenticated, service_role to authenticator;

-- The role Supabase runs migrations and the SQL editor as. It is NOT a superuser: it can create
-- roles and databases and bypasses RLS, but it cannot create untrusted extensions, read files or
-- run COPY PROGRAM, so a migration that needs more fails here as it would there.
create role postgres login createrole createdb bypassrls;
-- WITH ADMIN OPTION: since PostgreSQL 16 CREATEROLE alone no longer lets a role alter roles it did
-- not create, and the roles above were created by the superuser. Supabase documents
-- `alter role anon|authenticated|authenticator set statement_timeout = ...` as the way to change
-- the API timeouts, run as `postgres`, so it must work here (a `finish` RPC may need it, M2.2).
-- `authenticator` gets the admin right only, not membership: that is all ALTER ROLE needs.
grant anon, authenticated, service_role to postgres with admin option;
grant authenticator to postgres with admin option, inherit false, set false;

-- Per-request limits PostgREST applies from `ALTER ROLE ... SET` (the harness's request() does the
-- same). A PL/pgSQL RPC that takes longer than 3 s as anon is cancelled on Supabase too (M2.2).
alter role anon set statement_timeout = '3s';
alter role authenticated set statement_timeout = '8s';
alter role authenticator set statement_timeout = '8s';
alter role authenticator set lock_timeout = '8s';

-- Supabase puts `extensions` on every API role's search_path. SECURITY DEFINER functions must
-- still pin `search_path = ''` and schema-qualify (ROADMAP M2.1).
alter role anon set search_path = "$user", public, extensions;
alter role authenticated set search_path = "$user", public, extensions;
alter role service_role set search_path = "$user", public, extensions;
alter role authenticator set search_path = "$user", public, extensions;
alter role postgres set search_path = "$user", public, extensions;
