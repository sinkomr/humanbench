-- TEST FIXTURE (web/scripts/db, never applied anywhere else): a migration that installs an
-- extension with no schema clause. `public` is on `postgres`'s search_path and comes before
-- `extensions`, so pg_trgm lands in `public`, and the default grants (plus PUBLIC's EXECUTE) make
-- its functions callable by anon through PostgREST. The harness's exposedSurface() must list them.
create extension pg_trgm;
