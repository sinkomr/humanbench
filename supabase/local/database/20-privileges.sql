-- The `public` schema's default grants, as a Supabase project ships them (ROADMAP M2.0).
--
-- This file is what makes the local database a faithful trap: on Supabase, every table, sequence
-- and function that `postgres` (the migration role) creates in `public` is granted to anon,
-- authenticated and service_role BY DEFAULT. A migration that forgets
--   alter table ... enable row level security;
--   revoke all on all tables in schema public from anon, authenticated;
--   revoke execute on function ... from public, anon, authenticated;
-- leaves the table readable by anyone holding the public anon key. The harness reproduces that, so
-- the M2.4 negative tests ("anon cannot select any table", "anon can EXECUTE only whitelisted
-- RPCs") fail locally when a migration forgets. PostgreSQL itself additionally grants EXECUTE on
-- new functions to PUBLIC; that default is left as it is.
--
-- Verify against the live project at M2.6 (ROADMAP): written from Supabase's documented defaults.

-- `postgres` manages the schema's grants (it can pass CREATE on `public` to a role that is to own a
-- SECURITY DEFINER function); the API roles may use it but not create in it.
alter schema public owner to postgres;
grant usage on schema public to postgres, anon, authenticated, service_role;

alter default privileges for role postgres in schema public
  grant all on tables to postgres, anon, authenticated, service_role;
alter default privileges for role postgres in schema public
  grant all on sequences to postgres, anon, authenticated, service_role;
alter default privileges for role postgres in schema public
  grant all on functions to postgres, anon, authenticated, service_role;

alter default privileges for role supabase_admin in schema public
  grant all on tables to postgres, anon, authenticated, service_role;
alter default privileges for role supabase_admin in schema public
  grant all on sequences to postgres, anon, authenticated, service_role;
alter default privileges for role supabase_admin in schema public
  grant all on functions to postgres, anon, authenticated, service_role;

do $$
begin
  execute format('grant all on database %I to postgres', current_database());
end
$$;
