# Supabase: migrations, and the local database they are tested on

DESIGN §11.2 and §12 put HumanBench's data, keys and scoring in a Supabase Postgres: tables with
RLS and no policies for `anon`, `SECURITY DEFINER` RPCs, a Vault-held HMAC key. ROADMAP A6 says the
SQL is written and tested **locally** until the user creates a project (M2.6), so everything here
runs on a throw-away PostgreSQL 17 on the developer's machine or the CI runner. Nothing in this
directory is ever applied to a hosted project by the tooling; deploying is M2.6, which is the user's.

```
supabase/
  migrations/             <YYYYMMDDHHMMSS>_<snake_case>.sql, from M2.1; the only files that are deployed
  local/                  the stand-in for what a Supabase project provides; local only, never deployed
    cluster/00-roles.sql    roles, role settings (once per cluster)
    database/10-…40-….sql   extensions, default grants, auth helpers, Vault shim (per database)
web/scripts/db/           the harness (TypeScript): engine, template, request()/rpc(), tests
```

## Running it

From `web/`:

```zsh
npm run test:db
```

runs every `*.db.test.ts` (about 10 s: one cluster for the run, one cloned database per test file).
`npm test` never starts a database; its `scripts/db/*.test.ts` files check the wiring and the pure
parts. CI runs both (the `db` job).

```zsh
npm run db:up
```

starts a cluster with the shim and `supabase/migrations`, prints three `KEY=value` lines
(`HB_DB_URL` as the migration role `postgres`, `HB_DB_URL_AUTHENTICATOR`, `HB_DB_URL_SUPERUSER`) and
runs until Ctrl-C, which stops it and deletes its data. This is how another client connects, for
example the bank's Python (M2.5). The passwords are random per run.

```zsh
npm run db:reap
```

stops and removes clusters whose process died without cleaning up (see Consequences). Every start
does this first, so it is rarely needed by hand.

### Writing a DB test

```ts
import { afterAll, beforeAll, expect, it } from 'vitest'
import { ANON, type TestDb } from './harness'
import { exposedSurface, names } from './surface'
import { PERMISSION_DENIED, openTestDb, rejectedWith } from './vitest'

let db: TestDb
beforeAll(async () => { db = await openTestDb() })   // a fresh clone of shim + supabase/migrations
afterAll(async () => { await db.close() })

// `sessions` and `start_session` are what M2.1 adds; M2.4 writes tests like these.
it('anon cannot select a table', async () => {
  expect(await rejectedWith(db.query(ANON, 'select * from public.sessions'))).toBe(PERMISSION_DENIED)
  expect((await exposedSurface(db, 'anon')).tables).toEqual([])
})
it('anon can call a whitelisted RPC, and only those', async () => {
  expect(await db.rpc(ANON, 'start_session', { p_device: { class: 'desktop' } })).toBeTruthy()
  expect(names((await exposedSurface(db, 'anon')).functions)).toEqual(['public.start_session'])
})
```

- `db.request(ctx, fn)` is one PostgREST request: `BEGIN`, the role's `ALTER ROLE … SET` settings
  (anon: `statement_timeout = 3s`), `SET LOCAL ROLE`, `request.jwt.claims`, `request.headers`
  (`x-forwarded-for` for the IP rate limit), your code, `COMMIT`; an error rolls back. The
  connection is `authenticator`, as PostgREST's is.
- `db.rpc(ctx, 'fn', { arg: … })` is `POST /rpc/fn`: the JSON body goes through `json_to_record`, so
  types convert as PostgREST converts them. It resolves to the scalar, or to an array of row
  objects for a set-returning function, and rejects with the Postgres error (`.code` is the SQLSTATE).
- `db.owner` is `postgres` (the migration role), `db.sudo` the superuser: for arranging data and
  inspecting, never for the behaviour under test.
- `openTestDb({ migrationsDir })` builds a template from another directory (used by the fixtures).
- `exposedSurface(db, role)` lists what a role can touch in `public` (or the schemas you pass), from
  the catalog (`has_*_privilege`): tables with their privileges (column grants and PostgreSQL 17's
  `maintain` included), sequences, and every function it may EXECUTE, extension members too.

## ADR M2.0: the local Postgres engine

Status: accepted, 2026-09-30 (ROADMAP M2.0). Revisit if the native binaries stop being published.

### Context

M2.1–M2.5 need a database before any Supabase project exists (A6: no cloud or paid resources). The
SQL under test relies on: RLS and per-role grants; roles (`anon`, `authenticated`, `service_role`,
`authenticator`); `SECURITY DEFINER` functions with `search_path = ''`; PL/pgSQL (the 61-point EAP
grid and the correlated MAP, M2.2); `pgcrypto` (HMAC-SHA256 for the signed saves, DESIGN §8 and A16;
`digest` for the hashed IP); a Vault. The engine also has to be

1. the same major version as Supabase's default (17), so behaviour matches;
2. a real server on TCP, because the bank's Python (`psycopg`, M2.5) must connect to it too;
3. installable by `npm ci` on the Mac and on a CI runner, with no Docker, no brew and no cloud;
4. fast to start, and native, because PL/pgSQL scoring is what M2.2 benchmarks against 3 s.

### Decision

**Real PostgreSQL 17.10 binaries from the npm packages `@embedded-postgres/<platform>`**
(`darwin-arm64`, `darwin-x64`, `linux-arm64`, `linux-x64`; MIT; pinned to one exact version in
`web/package.json` `optionalDependencies`, so `npm ci` fetches only the machine's own, about 145 MB).
`web/scripts/db/engine.ts` runs `initdb` and `postgres` itself: a temp directory
`<tmp>/hb-pg-XXXXXX`, a free port on 127.0.0.1 only, no Unix socket, SCRAM with a random password,
`fsync` off, UTC, `C` collation. The client is `pg` (node-postgres).

### Alternatives considered

| Option | Verdict | Why |
|---|---|---|
| `brew install postgresql@17` | not used | Same server, but it needs the user to install it (PROGRESS.md, "Needs you"), and CI would need a second path. |
| Docker, `supabase start` | not used | Needs Docker Desktop and pulls a dozen images; A6. |
| pip `pgserver` 0.1.4 (PostgreSQL 16.2, last release 2024) and its fork `pixeltable-pgserver` 0.6.0 | rejected | The wheels ship `plpgsql` and `pgvector` only: no `pgcrypto` (checked in the wheels' `extension/` directories), so no HMAC in SQL. They do ship `psql` and `pg_dump`. |
| PGlite 0.5.8 (WASM, PostgreSQL 18.3) | rejected as primary, kept as the fallback | Smoke-tested: RLS, roles, `SECURITY DEFINER`, PL/pgSQL and `pgcrypto` all work. But it is one in-process connection, so Python cannot connect (2), it is 32-bit WASM, and it is major 18 (1). |
| The `embedded-postgres` npm wrapper | rejected, its binaries are used | Same binaries, but importing it registers `async-exit-hook`, whose `beforeExit` handler calls `process.exit(0)`. A failing vitest run then exits 0, so CI would pass on failing tests (observed while building this). The wrapper is about 30 lines; the harness does those directly. |

### Consequences

- The `-beta.17` in the package version is the packager's number; the server is PostgreSQL 17.10.
  Upgrading the minor is a version bump plus `npm run test:db`.
- **No `psql`, `pg_dump` or `pg_restore`** in the npm binaries (only `initdb`, `pg_ctl`, `postgres`).
  M2.5's "restore round trip tested locally" must either use a `pg_dump` 17 found on `PATH` (the
  GitHub runners have one; skip with a message when absent) or test the round trip with a logical
  dump through `psycopg`/`COPY`. M2.5 decides; this harness does not provide `pg_dump`.
- The packages create their shared-library symlinks in a `postinstall` script, which npm is about to
  stop running unreviewed. `prepareBinaries()` creates any missing link itself.
- A run killed by the workflow watchdog (SIGKILL) leaves its postmaster running. Every cluster
  directory holds a marker with its owner's pid; `reapStaleClusters()` (run by every start and by
  `npm run db:reap`) stops postmasters whose owner is dead and removes their directories, and only
  `hb-pg-*` directories with a marker. Tested with a real `kill -9` (`cli.db.test.ts`).
- The binaries are about 130 MB per platform in `node_modules`, and `npm test` needs them too
  (`engine.test.ts` resolves the package and checks the executables). `npm ci` takes only the
  machine's own, from `optionalDependencies`; `package-lock.json` pins all four with integrity
  hashes.
- Verified on macOS (arm64). Linux x64 is covered by the CI `db` job, not by a local run.

## What the shim mirrors

Everything below is written from Supabase's documented defaults, not exported from a project.

| Piece | Local behaviour |
|---|---|
| Roles | `anon`, `authenticated` (NOLOGIN, NOINHERIT), `service_role` (also BYPASSRLS), `authenticator` (LOGIN, NOINHERIT, member of the three), `postgres` (not a superuser: CREATEROLE, CREATEDB, BYPASSRLS; member of the three with ADMIN OPTION, and ADMIN OPTION on `authenticator`, so `alter role anon set statement_timeout = ...` works as Supabase documents it), `supabase_admin` (the superuser) |
| Migrations | Run as `postgres`, one file per implicit transaction, in file-name order, as the Supabase CLI does. File names must be `<14 digits>_<snake_case>.sql`. Test databases are clones of the migrated template and give `postgres` the same CREATE on the database, so a test can create a schema or a trusted extension. |
| Per-request settings | `statement_timeout` anon 3 s, authenticated 8 s, authenticator 8 s; `search_path = "$user", public, extensions`. `request()` applies them per request, as PostgREST does. |
| `extensions` schema | Owned by `postgres`; `pgcrypto` installed there, so migrations call `extensions.hmac(...)` |
| Default grants in `public` | Everything `postgres` creates is granted to anon, authenticated and service_role until the migration revokes it, and functions keep PostgreSQL's EXECUTE for PUBLIC. A forgetful migration leaks here as it would there (`20-privileges.sql`, tested with a leaky fixture). |
| `auth` | `auth.jwt()`, `uid()`, `role()`, `email()`, reading `request.jwt.claims` |
| Vault | `vault.secrets`, `vault.decrypted_secrets`, `create_secret()`, `update_secret()`; usable only by `postgres` and roles it grants. The secret is stored encrypted with a **public constant key of the shim**, which is not a secret. |
| Stricter than Supabase | A migration whose `GRANT` or `REVOKE` Postgres reports as not applied (it only warns, e.g. no grant option) fails the harness: such a revoke would silently leave an object exposed. |

## What it does not

PostgREST itself (routing, `Prefer` headers, `db-max-rows`, the schema cache); pgsodium (the real
Vault cryptography); the Supavisor pooler (transaction pooling: an RPC must not rely on session
state outside its own transaction); `pg_cron`, `pg_net`, Realtime, Storage and the `auth` tables;
Supabase's event triggers; the platform's CPU, memory and network (the p95 < 300 ms check is M2.6,
against the live project); collation (`C` here); and the exact PostgreSQL minor version.

**Verify against the live project at M2.6** and fix `supabase/local/` if they differ: the role
attributes and memberships (in particular `postgres`'s ADMIN OPTION on the API roles and on
`authenticator`); the per-role timeouts and search_path; the default privileges in
`public`; who owns `public` and `extensions`; which roles may use the `vault` schema; the minor version.

## Pitfalls the harness found (for M2.1 and M2.3)

Each is covered by a test in `web/scripts/db/*.db.test.ts`.

1. A table, sequence or function created in `public` is granted to the API roles by default. Enable
   RLS, `revoke all … from anon, authenticated`, and for each function
   `revoke execute … from public, anon, authenticated` before granting the whitelist. Revoking from
   `public` alone is not enough: anon holds its own default grant, and the function stays callable.
2. `pgcrypto` lives in `extensions`. Under `search_path = ''`, `hmac(...)` is "does not exist";
   write `extensions.hmac(...)`.
3. Creating a role does not make the creator a member of it. To give a function to a restricted
   owner: `grant that_role to postgres;`, a temporary `grant create on schema public to that_role;`,
   `alter function … owner to that_role;`, `revoke create …`. The owner then needs
   `usage on schema extensions`, `usage on schema vault` and `select on vault.decrypted_secrets`,
   each separately. See the "M2.3 pattern" test in `shim.db.test.ts`.
4. A `GRANT` or `REVOKE` by a role without the right only warns and changes nothing (the harness
   fails the migration).
5. `SET ROLE` is checked against the session user, `authenticator`, which belongs to all three API
   roles. So SECURITY INVOKER code run as anon or authenticated **can** `set local role service_role`
   (BYPASSRLS): a function that runs SQL built from its arguments is not confined to the request's
   role, and M2.1 must not write one. SECURITY DEFINER code cannot use `SET ROLE` at all (42501). A
   caller cannot reach `postgres` or `supabase_admin`.
6. A PL/pgSQL RPC that runs longer than 3 s as `anon` is cancelled (`57014`), including the
   `finish` correlated-MAP port in M2.2. The role's limit can be raised with `alter role anon set
   statement_timeout = '…'` in a migration (the shim lets `postgres` do that, as Supabase documents).
7. `create extension` with no schema clause installs into `public`, because `public` precedes
   `extensions` on `postgres`'s search_path. Every function of the extension is then an RPC anyone
   with the anon key can call (pg_trgm's `set_limit` changes session state). Write
   `create extension … with schema extensions`; `exposedSurface` lists extension members so a test
   notices.

## Secrets

None. Every password is random per run and dies with the cluster; the Vault shim's key is a public
constant; the Vault values in tests are fake strings. `web/scripts/db/wiring.test.ts` fails on a JWT,
an API-key shape, a non-local database URL or a hosted-Supabase host in any file under this directory
or `web/scripts/db/`, test files included (only `wiring.test.ts` itself is skipped: it holds the
patterns). Answer keys and `item_keys` data are never committed to this repo
(CLAUDE.md); the fixtures hold no keys.
