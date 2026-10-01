-- TEST FIXTURE: `postgres` does not own the `auth` schema and has no grant option on it, so this
-- GRANT does nothing and Postgres only WARNs. The harness must refuse the migration.
grant usage on schema auth to authenticated;
