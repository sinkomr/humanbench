-- Extensions as a Supabase project has them (ROADMAP M2.0). Per database, run as superuser, in the
-- template database every test database is cloned from.
--
-- Supabase installs pgcrypto in the `extensions` schema, so migrations call extensions.hmac(),
-- extensions.digest() and extensions.gen_random_bytes() (DESIGN §11.2: per-session HMAC saves,
-- hashed IP + salt). A migration that calls them unqualified under `search_path = ''` fails here
-- exactly as it would there.

create schema if not exists extensions;
-- Owned by `postgres`, which installs extensions there on Supabase and can pass access on to a
-- restricted role: a role that owns a SECURITY DEFINER function calling extensions.hmac() needs
-- USAGE on this schema, and a GRANT by a role without the right only warns and does nothing.
alter schema extensions owner to postgres;
grant usage on schema extensions to postgres, anon, authenticated, service_role;

create extension if not exists pgcrypto with schema extensions;
