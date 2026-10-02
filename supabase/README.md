# Supabase: migrations, and the local database they are tested on

DESIGN §11.2 and §12 put HumanBench's data, keys and scoring in a Supabase Postgres: tables with
RLS and no policies for `anon`, `SECURITY DEFINER` RPCs, a Vault-held HMAC key. ROADMAP A6 says the
SQL is written and tested **locally** until the user creates a project (M2.6), so everything here
runs on a throw-away PostgreSQL 17 on the developer's machine or the CI runner. Nothing in this
directory is ever applied to a hosted project by the tooling; deploying is M2.6, which is the user's.

```
supabase/
  migrations/             <YYYYMMDDHHMMSS>_<snake_case>.sql; the only files that are deployed (M2.1: the schema and the RPCs)
  local/                  the stand-in for what a Supabase project provides; local only, never deployed
    cluster/00-roles.sql    roles, role settings (once per cluster)
    database/10-…50-….sql   extensions, default grants, auth helpers, Vault shim, a throw-away signing key (per database)
web/scripts/db/           the harness (TypeScript): engine, template, request()/rpc(), tests
  shm.ts, shm/            macOS only: the System V shared-memory and semaphore shim (C) and how it is built (see the ADR)
  guard.ts                the watcher that cleans up after a SIGKILL
```

## Running it

From `web/`:

```zsh
npm run test:db
```

runs every `*.db.test.ts` (about 40 s: one cluster for the run, one cloned database per test file).
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

Two environment variables, both optional:

| Variable | Values | Does |
|---|---|---|
| `HB_PG_SHM` | `auto` (default), `sysv`, `shim` | How the server gets its System V shared memory and semaphores. `auto`: on macOS the shim below (built once, a few seconds), elsewhere the host's; on macOS also the host's, with a warning, if the shim cannot be built or the built one does not start in this process tree. `sysv`: the host's, everywhere. `shim`: macOS only, and an error if it cannot be built or does not start. |
| `HB_PG_GUARD` | `0` | No guard process per cluster (the tests of the reaper need an orphan to stay). |

The first start on macOS needs the Xcode command line tools (`cc`, `codesign`; `xcode-select --install`
if they are missing). Without `cc` the harness warns and uses the host's shared memory, which works
until the kernel's accounting is leaked (see the ADR).

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

**Amendment 2026-10-01: independent of the host's System V IPC.** On the owner's Mac every
start failed with `could not create shared memory segment: Cannot allocate memory`
(`shmget(size=56)`, in `initdb` too). Postgres takes one System V segment even with
`shared_memory_type=mmap`, a 56-byte header that locks the data directory; macOS leaks the kernel's
accounting of those segments when a postmaster is killed (`ipcs` is empty, `kern.sysv.shmall`
stays used up), and only a reboot frees it. The watchdog kills runs with SIGKILL, and `shmmni` is 32
for all runs at once, so this was going to recur. On macOS Postgres also keeps its process semaphores
in System V sets (the binary imports `semget`, `semctl`, `semop`; 7 sets of 20 per cluster), whose keys
come from the data directory's inode, new for every run, so the sets of a killed postmaster stay
listed by `ipcs` for good (about 620 killed runs until `semget` fails, at `kern.sysv.semmns=87381`).
The harness now never asks the macOS kernel for System V shared memory or semaphores:

- **The shim** (`web/scripts/db/shm/hb_shm_shim.c`, built by `shm.ts` with the system `cc`): a small
  library (about 400 lines of C) that replaces `shmget`, `shmat`, `shmdt`, `shmctl`, `semget`, `semop`
  and `semctl` in the server process. Segments are anonymous shared mappings, which the kernel releases
  when the process dies. Semaphores are 64-bit atomic words (value and last pid) in one shared mapping
  made when the library loads, so before the postmaster's first fork; a blocked `semop` polls with a
  short growing sleep, a signal ends it with `EINTR`, and removing a set wakes the waiters with `EIDRM`.
  It is lock-free on purpose: no process can die holding a lock the others wait for. It is loaded with
  `DYLD_INSERT_LIBRARIES`, which macOS ignores for hardened-runtime binaries, so the harness runs a
  **copy** of `postgres` re-signed ad hoc (`codesign --force --sign -`); the npm package's files are
  never touched. `initdb` starts `postgres` through `/bin/sh`, which strips `DYLD_*`, so the copy sits
  behind a two-line wrapper script (`env DYLD_INSERT_LIBRARIES=… postgres.real`; `exec` keeps the
  pid). The overlay (`node_modules/.cache/humanbench-pg/<key>/`, else `<tmp>/hb-pgbin-<uid>/<key>/`) is
  keyed by the shim source, the architectures and the binaries, built in a temp directory and renamed
  into place, so concurrent runs share it safely.
- **Every architecture of the binary.** The npm packages' `postgres` is universal (x86_64 and arm64)
  and the kernel, not the harness, picks the slice: a process started under Rosetta (an x86_64 python
  or shell above the test run, as on the owner's Mac) starts the x86_64 slice, which cannot load an
  arm64-only library. The library is built with a `-arch` for every slice found in the binary's Mach-O
  header, and the build and every later start check that the overlay's `postgres -V` runs (else
  `auto` falls back to the host's IPC with a warning).
- **What is run is trusted only if it is ours**: the cache directory (created `0700`) and everything in
  the overlay must be owned by the current user, not be a symbolic link and not be writable by group
  or others; otherwise a cache directory is skipped and an overlay is rebuilt. Overlays of other keys
  that finished building more than a week ago are removed after a build.
- **`shared_memory_type=mmap` and `dynamic_shared_memory_type=mmap`** on every platform, for the server
  and (`initdb -c`) for `initdb`, whose bootstrap and single-user runs read the `postgresql.conf` that
  `initdb` writes with `posix`: the main segment is an anonymous mapping and the dynamic segments are
  files in the data directory, so no POSIX shared-memory object survives a kill either.
- Linux (CI) runs the package binaries as they are, with only those two settings added: its kernel
  limits are large. (A SIGKILL of a whole process tree there leaves the cluster's SysV semaphore sets,
  as for any Postgres; the keys are reused and the limits are large, so nothing breaks.)

A segment or semaphore set of the shim exists only in the process that created it and its forked
children, which is all Postgres on Unix needs (it forks every child, creates its semaphores in the
postmaster and never re-attaches by id). What it gives up is the kernel's second lock on a data
directory: `postmaster.pid` still guards it. The tests: C probes run the seven calls as Postgres makes
them, in both architectures where the machine can run them (a forked child writing to the shared
memory, a forked child posting a semaphore a parent waits for, `EINTR`, `EIDRM`, 2000 posts from
four processes; `shm.test.ts`); `shim.db.test.ts` checks that the running server holds no System V
segment and no semaphore set; `cleanup.db.test.ts` kills a whole process group with SIGKILL and checks
the host again.

### Alternatives considered

| Option | Verdict | Why |
|---|---|---|
| `brew install postgresql@17` | not used | Same server, but it needs the user to install it (PROGRESS.md, "Needs you"), and CI would need a second path. |
| Docker, `supabase start` | not used | Needs Docker Desktop and pulls a dozen images; A6. |
| pip `pgserver` 0.1.4 (PostgreSQL 16.2, last release 2024) and its fork `pixeltable-pgserver` 0.6.0 | rejected | The wheels ship `plpgsql` and `pgvector` only: no `pgcrypto` (checked in the wheels' `extension/` directories), so no HMAC in SQL. They do ship `psql` and `pg_dump`. |
| PGlite 0.5.8 (WASM, PostgreSQL 18.3) | rejected, also as the answer to the shared-memory failure | Smoke-tested: RLS, roles, `SECURITY DEFINER`, PL/pgSQL and `pgcrypto` all work. But it is one in-process connection, so Python cannot connect (2), it is 32-bit WASM, and it is major 18 (1). Re-checked on 2026-10-01 against the failure above: **`statement_timeout` is not enforced** (`set statement_timeout = '300ms'; select pg_sleep(2)` runs the full 2 s, no signals in WASM), so the 3 s / 8 s API limits and the "a 6 s RPC as anon is cancelled" tests cannot run; there is one backend, so the lock and race tests (`robustness.db.test.ts`) would pass without testing anything; and there is no authentication, so the SCRAM and wrong-password tests would go too. Passing the suite would have meant deleting its hardest tests. |
| `shared_memory_type=mmap` alone | not enough | Checked: `shmget(size=56)` for the data-directory lock is still made, and fails the same way. |
| Raise `kern.sysv.shmall` | not possible | Needs root and a reboot (`/etc/sysctl.conf`, as PostgreSQL's macOS notes say), and the leak would eat the larger limit as well. |
| Interpose `shmget` & co. and `semget` & co. (the shim) | **chosen for macOS** | See the amendment above. |
| Process-shared pthread mutex and condition variable for the shim's semaphores | not used | A process killed while holding the mutex (a SIGKILL, a crash exit) would leave the others waiting for good; atomics with a polling wait cannot. |
| `ipcrm` the cluster's sets from the guard and the reaper | not used | The keys are the data directory's inode plus a counter, which cannot be told from another running cluster's by `ipcs` alone (no creator pid on macOS); removing the wrong set would break a live run. Not having the sets is simpler. |
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
- **Nothing outlives a run**, in four layers (`engine.ts`, `guard.ts`; `cleanup.db.test.ts` ends a real
  cluster's owner each way): (1) `stop()`, idempotent and safe to call twice at once; (2) the process
  `exit` hook (`process.exit()`, an uncaught error) and SIGINT / SIGTERM / SIGHUP handlers, which stop
  every live cluster and then re-raise the signal when nothing else handles it, so the exit status stays
  the signal's; (3) for SIGKILL, which cannot be handled (the workflow watchdog, `kill -9`, the OOM
  killer), a **guard**: a small detached node process per cluster that polls its owner and, once it is
  gone, stops the postmaster (SIGQUIT, then SIGKILL) and removes the directory, and exits by itself when
  the directory is gone; (4) the reaper, for the case that the guard died too (the whole process tree
  killed, a reboot): every cluster directory holds a marker with its owner's pid;
  `reapStaleClusters()` (run by every start and by `npm run db:reap`) stops postmasters whose owner is
  dead and removes their directories, and only `hb-pg-*` directories. The guard and the
  reaper signal a pid from `postmaster.pid` only if its command line says `postgres`. A directory with
  no marker at all (a start killed between `mkdtemp` and the marker, or a cleanup that removed the
  marker and could not remove the rest) holds no process, since the marker is written before anything
  starts, so it is removed once it has not changed for 10 minutes; a marker that exists but cannot be
  read is never touched. The reaper is tested with a real `kill -9` and the guard off
  (`cli.db.test.ts`, `HB_PG_GUARD=0`).
- The guard and the exit hooks also kill whatever else works in the data directory: `initdb` takes it
  as `-D`, but the `postgres --boot` and `--single` it starts get it only as `PGDATA` in their
  environment, so they are found with `ps -E` (macOS) as well as by command line. The hook cases of
  `cleanup.db.test.ts` run with the guard off and look at the host the moment the process has ended,
  so they fail if the `exit` or signal handlers are removed.
- The binaries are about 130 MB per platform in `node_modules`, and `npm test` needs them too
  (`engine.test.ts` resolves the package and checks the executables). `npm ci` takes only the
  machine's own, from `optionalDependencies`; `package-lock.json` pins all four with integrity
  hashes.
- Verified on macOS (arm64), with the shim, on a machine whose System V shared memory is used up, also
  from a Rosetta (x86_64) shell above the test run (the postgres slice is then x86_64). Linux
  x64 (no shim) is covered by the CI `db` job, not by a local run.
- The `-beta.N` in the pinned `@embedded-postgres/*` versions is the packager's build number, and every
  release of the packages carries it (npm has no other); the server is the stable PostgreSQL 17.10.
  The harness adds no dependency for the shared-memory fix.

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
| Signing key | `50-signing-key.sql` creates the Vault secret `save_hmac.k2026a` from 32 random bytes **when the database is created**: it is written to no file, and dies with the cluster. A project gets its own at M2.6 (see M2.3 below); without one a database signs nothing. Tests that need the unsigned path, a second key or a retired one change the secrets of their own clone. |
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

## M2.1: the schema and the RPCs

ROADMAP M2.1, DESIGN §8, §11.2, §12, §13, R-11.1, R-12.1; ADRs A11, A16, A18; Phase AI (AI.2, AI.26).
Written and tested here only (A6); nothing is applied to a project until M2.6.

### The files

| Migration | Holds |
|---|---|
| `…100_foundation` | the role `hb_definer`, schema `hb`, default privileges revoked (for the API roles and for PUBLIC), the JSON helpers the CHECK constraints use |
| `…200_bank_tables` | `app_config`, `item_families`, `items`, `item_keys`, `item_parameters`, `calibration_runs` (DESIGN §12) |
| `…300_session_tables` | `sessions`, `responses`, `flags` (§12) and `exposure_log`, `item_exposure`, `rate_limits`, `rate_salts`, `survey`, `mirror`, `recovery_words` |
| `…400_recovery_words` | the 1,024 words of the recovery phrase |
| `…500_private_functions` | the helpers in `hb` (settings, errors, randomness, rate limits, validation, scoring, selection, the session object) |
| `…600_rpc_session` | `start_session`, `next_item`, `submit`, `finish` |
| `…700_rpc_report_survey` | `report_problem`, `submit_survey` |
| `…800_rpc_mirror_delete` | `mirror_put`, `mirror_get`, `delete_my_data` |
| `…900_rpc_rescore` | `rescore` |
| `…M2.2 20261002000100_scoring_core` | the PL/pgSQL port of the scorer: `hb.map_theta`, `hb.eap_by_axis`, `hb.obs_terms`, the linear algebra, Σ_init as a setting |
| `…M2.2 20261002000200_session_scoring` | the in-session EAP, the MAP and the §13 evidence at `finish`, `hb.is_eligible` |
| `…M2.2 20261002000300_selection` | `hb.rank_live`, `hb.thompson_pick`, `hb.pick_item`, `hb.serve_next` |
| `…M2.3 20261003000100_save_signing` | the role `hb_signer` and `hb.mac_sign`, RFC 8785 canonical JSON (`hb.jcs`), `hb.session_signed`, `hb.session_verdict`, the HMAC form of `hb.session_owned`, `verify_save`, the `sig.*` settings |

### Who can do what (R-11.1, R-12.1)

- Every table has RLS enabled, **no policy** for `anon`, `authenticated` or PUBLIC and **no grant** to them. A
  plain `select` from any table is `42501` permission denied. The default privileges that Supabase gives
  `postgres`-created objects are revoked in the first migration, and so is PostgreSQL's own EXECUTE for PUBLIC on a
  new function: a function a later migration creates outside `set local role hb_definer` is callable by nobody
  (tested), not by everybody. That default is global (no `IN SCHEMA`: a per-schema revoke cannot take PUBLIC's
  EXECUTE away), so a migration that installs an extension grants the functions it needs.
- Every function is owned by **`hb_definer`**: `nologin`, not a superuser, no `BYPASSRLS`, owns no table. It reads
  and writes through select/insert/update grants and policies written for it (the bank tables are select-only:
  the RPCs never write a key, a parameter or an item). `item_keys` is read by `public.submit` (through
  `hb.score_response`) and by nothing else.
- Functions in `public` are the RPCs: `SECURITY DEFINER`, `search_path = ''`, EXECUTE for `anon` and
  `authenticated` only. Helpers live in schema `hb`, which no API role can use; EXECUTE is revoked from PUBLIC on every
  function by default (`alter default privileges for role hb_definer`). The one exception is `hb.no_key_fields`,
  which `service_role` needs because `items.payload`'s CHECK constraint runs as the writer.
- One function is owned by another role: **`hb.mac_sign`**, by `hb_signer` (`nologin`, no table, no schema `create`). It alone may
  read the Vault, and it returns a MAC, never a key; `hb_definer`, which owns every RPC, can call it and cannot read the
  Vault (tested: `select … from vault.decrypted_secrets` as `hb_definer` is `42501`). A bug in any RPC therefore cannot return the
  signing key. See M2.3.
- `service_role` (the bank pipeline, M2.5) can write the bank tables, the calibration log and `flags`, and read
  sessions, responses, exposures and surveys. It cannot touch `mirror`, the rate tables or any RPC.

**Writing a migration** (a test checks all of it from the SQL text, `migrations.test.ts`, and from the catalog,
`schema.db.test.ts`): create tables as `postgres` with RLS enabled and explicit grants; create functions between
`grant create on schema public to hb_definer; set local role hb_definer;` and `reset role; revoke create on schema
public from hb_definer;`, each with `set search_path = ''`; qualify everything (pgcrypto is `extensions.`); grant EXECUTE
of an RPC to `anon, authenticated` by name; replace a function with `create or replace` (the migration role is a
member of `hb_definer`, so it may).

### Tables

| Table | Holds | Notes |
|---|---|---|
| `item_families`, `items`, `item_keys`, `item_parameters` | the bank (DESIGN §12) | `items.payload` is only `stem`, `media`, `options`, with no key-like field name anywhere inside (CHECK). `sibling_group` defaults to `family_id` (trigger). `item_parameters.a/b/c/se_b` are `double precision`, not `real`, so the bank's values are stored without rounding. Plus the AI.2 columns `topic`, `curriculum_level`, `notation`, `ladder_probe`, `practice_only` and `items.server_tags` |
| `sessions` | one row per session | the token is stored as its SHA-256 only; `device`, `flags`, `state` carry a CHECK that no object inside has a `brief_prefs` key |
| `exposure_log`, `item_exposure` | every item served, in order; a counter per item | a row in the log without a response is the pending item; the counters feed the 0.25 exposure cap (M2.2) |
| `responses` | answers (§12) | `correct` and `score` are filled by the server |
| `flags` | reports and the nightly job's findings | `kind` of a user report is one of five item categories or `notes_requested`, which has no item and no text (CHECK) |
| `rate_limits`, `rate_salts` | counts per `hash(client address, kind, daily salt)` | no address is stored; both purged after 48 h |
| `survey` | the optional two answers | keyed by `session_id` only, no `anon_id` |
| `mirror` | the optional server backup | the blob has a CHECK against `brief_prefs`; only SHA-256 of the recovery phrase is stored |
| `recovery_words`, `app_config`, `calibration_runs` | reference data, settings, the calibration log | |

There is **no table, column or function for the notes** (AI.26: a schema grep finds none). The notes
settings, `brief_prefs`, never reach the server: the client removes them before every upload
(`toUploadPayload`, M2.7), every RPC that takes JSON rejects a payload with that key anywhere in it, in any
letter case, with `400 brief_prefs_not_accepted`, and the tables above refuse it by CHECK. The mirror therefore holds
the save as the client stripped it; the server rejects instead of silently editing a person's backup.

### The RPCs

All are called as `anon` (the public key) through PostgREST; arguments are named `p_…`.

| RPC | Does | Returns |
|---|---|---|
| `start_session(p_device, p_save)` | validates the device (the closed object of `schema/save-v1.json`), takes the seen lists of a save and, **only if the save proves it**, its `anon_id` (see Identity and proofs); counts one of the 5 a day for the client | `{session_id, token, anon_id, anon_id_adopted, bank_version, param_version, limits}`. The token (128 random bits, `hbt_…`) is shown once. `anon_id_adopted: false` means the server issued a new `anon_id` and the client re-keys its file to it |
| `next_item(p_token, p_axes)` | the pending item (a reload gets the same one), else a new one, chosen as in M2.2 below; `p_axes` restricts the pick to the axes of the client's current segment (null = all) | `{seq, item: {item_id, item_type, time_limit_s, stem, media, options}}` or `{done: true, reason: 'item_limit' \| 'axes_done' \| 'no_items'}` |
| `submit(p_token, p_item_id, p_response, p_rt_ms, p_confidence, p_client_flags, p_next, p_axes)` | scores in SQL against the key; stores the answer and adds it to the session's grid EAP (`hb.eap_add_response`); repeats are acknowledged and change nothing; blocks a session whose average, by the server clock, is under 2 s an item after 10 answers | `{ack, seq, next}` (`next` as `next_item`, unless `p_next` is false). **No verdict on the answer** |
| `finish(p_token, p_flags)` | closes the session, merges the client's integrity report with the server's time check, and, at the first call, keeps the correlated MAP and the server's §13 evidence in `sessions.state` and decides `calibration_eligible` (M2.2) | `{session, anon_id, n_responses}`; `session` is a `save-v1` session object built from the rows (validated against the schema by a test) **with its `sig`** (M2.3; unsigned while the Vault holds no key). Its response tuples always carry **`correct: null`**: the owner decided on 2026-10-01 that a save never holds the server's verdict on an answer (see The verdict on each answer). Neither the eligibility nor the MAP is returned or put in the session's flags (M2.2 below) |
| `report_problem(p_token, p_kind, p_item_id, p_detail)` | the five item categories (the item must be one this session was served), or `notes_requested` (no item, no text; never counts toward quarantine) | `{recorded}` |
| `submit_survey(p_token, p_age_band, p_english_first)` | the voluntary two answers | `{recorded}` |
| `rescore(p_save)` | re-scores the save's sessions from the **database's** rows with the DESIGN §7.8 retest model; returns an axis or facet only from sessions that each hold 5 scored answers on it, rounded; see below | `{retest_version, param_version, sessions, eap, facets, withheld, limits, skipped}` |
| `mirror_put(p_token, p_save, p_phrase)` | stores the save for the session's `anon_id`; the first put returns a 12-word recovery phrase, once, and later puts must present it | `{stored, anon_id, size_bytes, recovery_phrase?}` or `{stored: false, error: 'wrong_phrase'}` |
| `mirror_get(p_anon_id, p_phrase)` | restore on a new device | `{found, save?, updated_utc?}`; a wrong phrase and an unknown id look the same |
| `delete_my_data(p_anon_id, p_phrase, p_save)` | deletes the sessions (with responses, exposures, reports, survey) and the mirror of an `anon_id`, proved by the phrase or by a save listing a session the server issued to that `anon_id` and signed for it; a wrong proof counts against the address | `{deleted, sessions?, mirror?}` |
| `verify_save(p_save)` | the unverified path (M2.3): says per session whether the server issued it as it stands; stores nothing; 60 calls a day per client address | `{anon_id, sessions: [{session_id, status: 'verified' \| 'unverified', reason}], n_verified, n_unverified}`; `reason` is `unsigned`, `bad_signature`, `unknown_key` or `malformed` |

**Identity and proofs.** An `anon_id` is a label, not a credential: it is in the person's file, and a file name or a
screenshot may show it. Nothing is done for an `anon_id` on its name alone.

- The server issues `anon_id`s. `start_session` continues the one in a save only when the save lists a session this
  server issued to **that** `anon_id`, finished and signed for it (`hb.save_proves_anon`; M2.3: the MAC must verify). Otherwise the session gets a new `anon_id`
  (`anon_id_adopted: false`): an offline file, a made-up id, somebody else's id. The seen lists of such a save still
  count; they only keep items away from the new session. An offline-MVP user therefore gets a new `anon_id` at the
  first server session, and the client re-keys the file (M2.7); the offline sessions stay unverified (A16).
- `mirror_put` accepts only a save whose `anon_id` is the one of the session's token, so nobody can create, or squat
  on, the mirror of an `anon_id` they hold no session for.
- `delete_my_data` is proved by the recovery phrase or by a save with a session issued to the `anon_id` named in the
  call, finished and signed for it. The `anon_id` written inside the file does not matter (a merged file proves each id its
  sessions belong to), and the `sig.anon_id` of a session must be the id being proved *and* is under the MAC, so it cannot be
  changed to another (tested with a stranger's own session carrying the victim's id: the MAC does not fit).
- What the proof is worth: the sig is the server's MAC over the session and the `anon_id` (M2.3), and the server also holds the
  row. A session id alone, or a session that is edited in any way, proves nothing. But the MAC lives in the person's file, so
  **a save file is still a credential**: whoever holds one can delete, rescore and continue it. The HMAC proves that the server
  issued a session to an `anon_id`; it is not a stronger secret than holding the file. Keep saves private.

**`rescore`** (Phase AI amendment, ROADMAP A21/AI.8). For each session of the save that the server issued to **the
`anon_id` of the save** (the caller's; a `sig.anon_id` on a session may only repeat it, exactly as in `hb.session_owned`)
and finished, it reads the responses from the database and returns, per axis, the own-axis, practice-adjusted EAP
`{mean, sd, n}` (61 equal-weight grid points on [-4, 4], prior N(0, 1); *not* the correlated MAP) and, per facet, the
EAP on the facet's items with the axis posterior as its prior (viz/facets.ts, A12). Only sessions that are eligible
*blind* are scored (`hb.is_eligible(session, true)`, below: the eligibility without the checks that read the key); a
session that is not still counts as a test of the axis (practice, `ordinals`, `rho`). Pretest
responses and responses on quarantined items (DESIGN §4.5) are left out; block observations (RT, span, coding,
reading) are not scored on the server before M2.2 and are counted under `skipped.block`. A response outside the item's
answer space (an index that is no option, a letter that is none, an entry that is no number; `hb.response_fits`) is
not an answer: it is counted under `skipped.invalid`, enters no number and reaches no minimum (it is stored, and
`submit` scores it 0 as before). A session of the save that
was issued to another `anon_id`, is unfinished or is unknown counts under `skipped.unknown_sessions` and adds nothing;
that includes the sessions of a *merged* file that were issued to an `anon_id` other than the file's own (a merge keeps
the smaller id and the sessions keep the id they bind in `sig.anon_id`). Which id a client rescores for a person who
holds two is for M2.7 to settle; the MAC of M2.3 binds each session to its own `anon_id` (`sig.anon_id`), so a merge never
moves a session to another; the client sets the file's `anon_id` to the id it wants rescored.

*What `rescore` does not tell* (R-11.1, DESIGN §10; owner decision 2026-10-01, "`rescore` must also not leak
single-answer verdicts"). With the verdict gone from `finish`, the score is the one place a script could still read
its answers: a posterior mean from one answer *is* that answer (right moves it up, wrong down). So:

| Rule | Setting | Value | Why this value |
|---|---|---|---|
| a session's answers on an axis count only if **that session** holds this many scored answers on the axis; an axis is returned if one session counts | `rescore.min_axis_items` | 5 | the count at which the app itself shows a facet (A12; `FACET_MIN_ITEMS`, checked by a test); the posterior sd is still 0.7 there, so one answer is one of five terms and no longer the whole of the value. What any session adds to a published number is a sum of at least five of its answers, never one: a count over the whole save would let a script add a session of one answer and read it out of the difference. The answers of a shorter session are practice only (`ordinals`, `rho`) and are counted under `skipped.not_counted`. An axis nobody counts: the call returns the count of valid answers under `withheld.eap` and nothing else |
| the same for a facet, and a facet is returned only under an axis that is returned | `rescore.min_facet_items` | 5 | A12 |
| the mean is rounded to a multiple of | `rescore.mean_step` | 0.1 | a tenth of an SD unit, well under the posterior sd of a finished session (0.3 to 0.7), so what the blob shows does not change |
| the sd is rounded **up** to a multiple of | `rescore.sd_step` | 0.05 | rounding up never understates the uncertainty (a "show uncertainty" rule of the blob) |
| calls per client address a day | `rate.rescores_per_day` | 20 | 5 sessions a day and a few views of each result fit with room to spare (it was 200) |
| calls per `anon_id` a day | `rate.rescores_per_anon_day` | 10 | stops a script that changes its address between calls. Only a call whose save holds a session issued to that `anon_id` is counted, so a stranger who knows an id cannot use up its calls (an `anon_id` is a label, not a credential) |

The reply says what it applied (`limits`), and what it held back as counts of scored items (`withheld`; a count of
items does not depend on whether they were right), so that the client can say "needs 5 items" and not "no data".
`rescore.min_axis_items`, `min_facet_items` below 1 or a negative step are read as 1 and 0; a step of 0 means no
rounding and exists for the parity tests, which compare the algorithm with the app's engine to 1e-9 (the
roadmap's "matches the client to 1e-6" holds to within the published rounding: half a step for the mean, a step for
the sd).

*What this closes, and what it does not.* The review of the first version found two ways to read a single answer out
of `rescore`, and both are closed.

1. **Padding.** A script that answers 4 items with an index of -1 (or `"x"` for a letter, or `"n/a"` for a number) and
   1 item for real knows the verdict of the four, so the mean of a 5-item axis was the real answer's verdict: in the
   review, 84% of the time in one call with no reference at all, 40 axis readings from one session, 90% by
   differencing against an all-wrong baseline. Such an answer is outside the answer space of every item, and nothing is
   learnt about the key from saying so (it depends on the kind of key and on the number of options the client is shown,
   never on the key's value), so it is not an answer: it reaches no minimum and enters no number.
2. **Differencing.** Score a session of 5 or more answers, add one session with a single answer to the save, rescore, and
   read the sign of the change (a single answer moves the mean by about 0.5 at 5 items already scored, 0.2 at 20, 0.15
   at 30, more than the 0.1 step until about 50). A session now counts toward an axis, and toward a facet, only with its
   own 5 answers on it, so the difference of two calls is a difference of sums of at least five answers.

*What is left.* A well-formed answer that is wrong with near certainty. For a typed number, any entry that parses is in
the answer space, so a script can answer 4 numeric items with `99999999` and put one real answer in a fifth: the axis's
mean then reads out that one answer's verdict, in the same way as with the invalid padding (the review's measurements are
the bound, 84% in one call, less when the padding is not certain). The server can tell such an entry from a poor wrong
one only by comparing it with the key, which would make the count depend on the key. This is limited to axes that have
typed-number items (a multiple-choice item has no answer that is known wrong), and bounded by the 5 sessions an address
may start a day, the 20 calls a day per address and the 10 per `anon_id`: one reading per axis (and per facet, with five
numeric items each) per session. Closing it takes noise on the numbers, which the owner has not decided on. The server-side
evidence of M2.2 would catch a padded session of 20 answers or more (it is a misfit), but it cannot be used here: *which*
sessions that evidence drops is a function of which answers were right, and a score reply that differs with it differs with
a verdict. (The first M2.2 version did read it, and a script could set one flag itself, answer one item at once and see
whether its session was scored: `n_scored`, the presence of `eap[axis]` and `withheld` all differ with the answer. Found by
review, closed by the next paragraph.) **`rescore` reads the blind eligibility only**: the same flag count as the
calibration's without what reads the key. A fast answer (under a quarter of the median, on items whose median is over 20 s)
is a flag whether or not it was right, and the server's person fit and accuracy on hard items are not read, only the
client's report of them. A session is then dropped for what the caller chose (its times, its flags) and never for what it
got right, so nothing in the reply differs with a verdict through the eligibility. The reply still does not say why a
session was not counted: it carries no per-session `calibration_eligible`, and the answers of a session that was not
counted are under `skipped.not_counted` together with those of the sessions that are too short. The cost is a weaker filter:
a session with two answers that were fast by the server's clock is not scored, wrong or right (the app's own check is about
correct answers, which a client without the key cannot know), and a misfit session is scored like any other. What the
key-reading checks find stays in `sessions.calibration_eligible`, which only the calibration reads (A16). A session of
unknown answers (all valid) is only an aggregate: differencing two such sessions gives a difference of two sums of five
verdicts, not one.

`rescore` is held to the app's engine: `rescore.db.test.ts` compares it with `rescoreRetest` and `eapAxis` to 1e-9
over generated sessions (practice, ineligible sessions, quarantine, order) with the minimum counts and the rounding
switched off, and tests the withholding, the rounding and the limits with the published settings.

### Errors

Errors carry a PostgREST status as the SQLSTATE (`PT400`, `PT401`, …); the message is a short code and the detail says
why. `400` invalid input (`invalid_device`, `invalid_save`, `invalid_flags`, `brief_prefs_not_accepted`, …); `401
invalid_session` (malformed, unknown or expired token: one answer for all three); `403 anon_id_mismatch`; `404
item_not_served`; `409 session_finished`; `413` too large; `429 rate_limited` / `too_fast`; `507 mirror_full`.
A wrong recovery phrase is **returned** (`found: false`, `deleted: false`, `stored: false`), not raised, because
a raise would roll back the failure count that limits guessing (60 a day per client address; there is no lockout per
`anon_id`, which would let anyone who knows an id block its owner). A wrong save proof in `delete_my_data` is counted
the same way, in the same counter.

**A save with U+0000 in a string cannot be sent.** I-JSON, and the app's save validator, allow a `\u0000` escape inside a
string (a typed answer, say); PostgreSQL's `jsonb` does not. The database refuses such a parameter itself (`22P05`,
not a `PT` code, PostgREST answers 400) before any RPC runs, for `mirror_put`, `start_session`, `rescore`,
`delete_my_data` and `submit` alike (tested, `robustness.db.test.ts`). The client's upload payload
(`toUploadPayload`, M2.7) has to refuse such a save, or drop the character, before the call.

### Settings (`public.app_config`)

The limits and priors are rows, not constants: `rate.*` (5 sessions a day, 30 mirror puts, 20 rescores, …),
`session.*` (200 items, 2000 ms average, 10 answers before it is checked, token lifetimes), `payload.*`,
`save.*`, `mirror.*`, `rescore.*`, `retest.tau` and `retest.rho_max` (equal to `RHO_MAX_PRIOR` in
`engine/retest.ts`, checked by a test), the M2.2 `selection.*` (cap, floor, stop, top k, pretest share; equal to the app's
constants where it has them), `integrity.*` (the §13 thresholds of `engine/integrity.ts`) and `scoring.sigma` /
`scoring.sigma_version` (Σ_init v2, equal to `initialSigma()`), and `bank_version` / `param_version` once the bank pipeline writes them. The rate
limits use `x-forwarded-for` (`rate.ip_header`) and its **last** entry (`rate.ip_hop` = -1): a proxy appends the address it saw,
so the entries before it are whatever the caller wrote, and a script that varies the first entry would get a new bucket on
every call (the limits of 5 sessions a day, 60 wrong proofs, the deletes and mirror puts, and the global `mirror.max_rows`
would mean nothing). A request without the header shares one bucket and fails closed. M2.6 sets the hop to the entry the
platform's outermost proxy appended for the client (`-2` if a CDN adds its own address after it).

There is no setting for the verdict on each answer (see below).

### The verdict on each answer (R-11.1 against DESIGN §8: decided 2026-10-01)

Two lines of the design collide. DESIGN §8 says the response tuple of a saved session holds `correct`, "filled from the
server's scoring RPC ... so that offline re-scoring works". R-11.1 and DESIGN §10 say keys stay on the server and there
is "no correctness feedback on finite-bank items (key leakage)". A `finish` reply that carries `correct` for every
answer is that feedback in bulk: a script answers every item with option k, finishes, reads which answers were right,
and a few sessions pin down the key of each item, 200 items a session. Only the address limit (5 sessions a day per
client) slows it.

**The owner chose R-11.1** (ROADMAP, "Owner decisions 2026-10-01"): saves never carry per-item correctness for
server-scored items. The tuple has `correct: null` (the schema allows it), always; the switch of the first draft
(`finish.include_correct`) is deleted, so a setting cannot bring the leak back (tested: a row under the old name does
nothing). The rows keep their verdicts for the server, and a person gets their scores from `rescore`, which
re-scores from the database's rows (A16: calibration uses DB rows, never uploads) and returns the per-axis and
per-facet EAPs, withholding and rounding what would read out a single answer (above). DESIGN §8 still describes the
tuple with `correct` filled; this is a deviation the owner has accepted, to be reflected in DESIGN at the next edit.

### What the next tasks fill in

- **M2.2** is below: scoring, selection, pretest slots and eligibility.
- **M2.3** (done, below) adds the per-session HMAC: `finish` signs the session, `rescore`, `delete_my_data` and
  `start_session` verify it, editing preferences never changes it.
- **M2.4** repeats the acceptance as its own tests (M2.1 already tests that `anon` reaches no table and only the RPCs, a
  25-item session reply holds no key, the brief_prefs rejection and the limits).
- **M2.5** connects the bank (`hb load push` writes the four bank tables as `service_role`; the column names are
  checked against `hb.load.push.COLUMNS` when the bank repo is next door) and the nightly job (`hb.purge_expired()` is
  also run by `start_session`). A restore must go into a project that already has the migrations applied (data only):
  `hb_definer` is a cluster-level role and a single-database dump does not carry it.
- **M2.7** is the front end: `toUploadPayload()`, the mirror and deletion UI, the report button.

### To verify against the live project (M2.6)

In addition to the list above: that `postgres` may `create role`, `grant hb_definer to postgres`, `create schema … authorization
hb_definer` and set default privileges for `hb_definer`; that `extensions` lets `hb_definer` and `hb_signer` use pgcrypto; that `postgres` may `create role hb_signer`, grant it
`usage` on `vault` and `select` on `vault.decrypted_secrets` (the local shim lets `postgres` pass these on; the hosted Vault may
differ, M2.3); that
**only `public` is an exposed schema** (Settings, API), so `hb` and the tables' helpers are unreachable; which request
header carries the client address and which entry of it (`rate.ip_header`, `rate.ip_hop`; the default, -1, is the last
entry, which a script cannot forge; if a CDN sits in front and appends its own address, the right entry is -2, or the header
the CDN sets itself; the first entry is right only if the gateway overwrites the header). A wrong choice shows at once as
one shared bucket for many people, not as an open door; that PostgREST maps `PT4xx`
SQLSTATEs to those HTTP statuses; that signing up is disabled (the RPCs also work for `authenticated`, so a signed-up
user would have the same reach as `anon`, no more); the anon and authenticated statement timeouts (3 s / 8 s; the
`rescore` of 40 sessions of 100 answers takes about 0.3 s here).

## M2.2: scoring, selection, pretest slots and eligibility

ROADMAP M2.2, DESIGN §6.iii, §7.2, §7.4, §7.7, §11.2, §13, R-7.4, R-11.1; ADRs A2, A8, A9, A11, A17, A18.
Three migrations (the table above); nothing here is applied to a project before M2.6.

### The scoring core, held to the app (`scoring-core.db.test.ts`)

`hb.map_theta(obs jsonb, mu, sigma)` is a PL/pgSQL port of `engine/scorer.ts` `mapTheta` (the A2 convention: Newton with
the observed information where Σ⁻¹ + diag(observed) is positive definite, else Fisher scoring, step halving with the 2⁻⁴⁶
slack, stop on an accepted step under 1e-8, 50 iterations) for all five observation kinds of the wire schema (2PL, 3PL, GRM,
Gaussian, testlet), and `hb.eap_by_axis` of `eapByAxis`. Both run **every case of `golden/scoring_v2.json`** (84 cases, the
copy in `web/src/engine/__fixtures__/`, A17) and agree on θ, the Laplace covariance, the per-axis EAP and the log posterior to
**1e-6** (the file's tolerance), the testlet terms to 1e-9, with generated inputs for each observation kind against
`engine/irt.ts`, and Cholesky, solve, inverse and log-determinant against `engine/linalg.ts`. A MAP with K = 17 and 150
observations takes about 10 ms. The prior is Σ_init v2, a setting (`scoring.sigma`, with `scoring.sigma_version`) that a test
compares with `initialSigma()` and the bank's `sigma_v2.json`, and μ = 0.

PostgreSQL is stricter than JavaScript in one way that matters here: `exp()` that underflows, and a product that underflows to
0, are errors (`value out of range: underflow`), where JavaScript returns 0. Every `exp()` argument is floored (-700 inside
likelihood terms, -230 for posterior weights) and a weight or probability below 1e-100 is skipped where it would be
multiplied by something small. What that changes is below 1e-100 in absolute terms; the extreme golden cases (a = 100,
b = ±50, |z| ≈ 5,000) are among the 84. `hb.log1p` and `hb.expm1` exist because PostgreSQL has neither.

### What a session keeps, and what it computes at the end

| When | What | Where | Reaches a client? |
|---|---|---|---|
| each `submit` | the answer's log-likelihood on the 61-point grid, added to the axis's | `sessions.state.eap[axis] = {n, ll}` | no |
| each pick | the posterior mean and sd of each axis from that: the grid EAP under N(0, 1); an axis without an answer is its prior exactly (as the app's selector) | `hb.session_posteriors` | only through which item comes next |
| `finish` | the correlated MAP and covariance of the session's counted answers under Σ_init | `sessions.state.posterior` (θ, the 17 × 17 covariance, `n_by_axis`, 6 decimals) | **no** |
| `finish` | the §13 evidence the server can compute (below), with the time check that does not read the key (`too_fast_any`) | `sessions.state.integrity` | **no** |
| `finish` | `calibration_eligible` | `sessions.calibration_eligible` | **no** |
| `finish` | the grids are replaced by a summary `{axis: {n, mean, sd}}` | `sessions.state.eap` | no |

Which answers count (in the EAP, the MAP and the evidence alike; the same as `rescore`'s): not pretest, not on a quarantined
item, a scored 0/1, an item parameter row of a dichotomous model (a 2PL-testlet item is scored as a 2PL, as the app does until
M3.9 groups testlets), and an answer inside the item's answer space (`hb.response_fits`). Blocks (GRM, Gaussian) are not scored
on the server.

**Why none of it is returned.** The MAP, the fit statistics and the eligibility are functions of which answers were right.
`finish` used to return `calibration_eligible`, and with the server's evidence in it that would be one bit per session about the
answers: two fast answers plus one self-reported flag make the threshold, and the bit says whether a particular answer was
right. The owner's decision of 2026-10-01 (R-11.1, DESIGN §10) is that a script must not read its verdicts out of its own
session. So `finish` returns `{session, anon_id, n_responses}`, the session's flags hold only what the client sent and the
server's time check, and `rescore` (the one place with the withholding and the rounding) is where a person gets scores.
`rescore` may not use the eligibility either, for the same reason, and reads a form of it that does not depend on the answers
(below). (The M2.1 notes, and DESIGN §11.2, had `finish` returning a `posterior`; it does not, for that reason.) **How the correlated MAP
reaches the blob** (the app's blob is drawn from it; `rescore` returns the own-axis EAP, A21) is therefore an open decision for
M2.7: either `rescore` returns the MAP with the same minimum counts and rounding, or the blob uses the own-axis EAP.

### Selection (`hb.rank_live`, `selection.db.test.ts`)

A live slot is: the candidates (live, not practice-only, with a key and a dichotomous parameter row, on an allowed axis whose
posterior sd is still ≥ `selection.stop_sd` = 0.3, not seen by this session or the save, exposure under the cap); the criterion
of §7.4, **w · I · Var / E[T]**, with I the Fisher information of the item's own model at the session's mean on the axis (2PL
a²PQ, 3PL with its c, 2PL-testlet × 0.8), Var the posterior variance, w = 1 on the allowed axes, E[T] the norms median, else
`extra.expected_time_s`, else "25 s + 4 s per 50 words"; one candidate per `family_id`; the **coverage floor** (an allowed axis
with fewer than 3 items, this session's plus the save's earlier ones, is served before the others; in every session, as
in the app, where `selectNext` defaults `sessionNumber` to 1 and the session flow passes the earlier items as
`priorItemCounts` (`session/coverage.ts`): the floor is about an axis being covered, not about the ordinal of the session); **content balancing**
(`balanceFamilies` of the app: per axis, only the candidates of the generator family(ies) least served so far compete, so the
cheaper family cannot take the axis; a family with no candidate does not block the other); then the top 5 and one at random.
The test compares the ranking and the scores with `criterion()` of `engine/selector.ts` (to 1e-12) at the prior and after a
session's answers (to 1e-9 relative).

`p_axes` is the client's segment (A15 order: RT → Matrix/Series → Spatial → Memory → Quant → ...); null is every axis.
`{done: true, reason: 'axes_done'}` means every allowed axis has reached the stop sd; `'no_items'` means the bank has nothing
left for the session on the allowed axes. The weights other than 0/1, the remaining-time test of the app's selector and the
facet weights of AI.21b (goals sessions, Part 2, not approved) are not here.

**Exposure cap** (§6.iii): an item may be served while (its sessions + 1) ≤ `selection.exposure_cap` (0.25) ×
max(sessions so far, `selection.exposure_min_sessions` = 20). The minimum is what keeps the first sessions from being refused
every item (one session of one is a rate of 1); with the default, five sessions may see an item before the cap starts to bind.
The counter is increased by one statement under that same limit, so two sessions racing for the last place cannot both have it
(tested with six at once); the loser picks again. A bank too small for its sessions runs out of items, and the session ends with
`no_items`: the cap is hard (§7.7 sizes the bank with a factor 2 for it). The sessions are counted with `count(*)` on
`sessions` (an index-only scan; at 10⁶ rows a counter row is worth adding).

**Sibling groups and families**: never twice in a session, never the group of a family in the save, never the family of an item
in the save's `seen_items` (the older logic took only the item id).

### Pretest slots (§6.iii)

At most `selection.pretest_share` = 10% of a session's slots: slot n + 1 may be a pretest slot only while (pretest so far + 1) ≤
0.1 · (n + 1), so never one of the first nine; an open slot is taken with probability `selection.pretest_prob` (0.5) so the
positions are not fixed (the test with probability 1 finds them at 10, 20, 30...). The item is chosen by **Thompson sampling on
the expected information gain about b**: each candidate of status `pretest` draws b′ ~ N(b, se_b²) (`item_parameters.se_b`, else
`selection.pretest_default_se_b` = 1, the prior sd of §6.ii) and the largest ½·ln(1 + se_b²·I(θ̂; b′)) wins, I the item's
information at the session's current mean on its axis. So an uncertain item near θ̂ wins often, a firm one or a far one almost
never, and it is a sample, not an argmax (tested over 800 draws). A pretest answer is stored with `pretest = true`, counts for
no score, and the item looks like any other to the client. The cap applies to pretest items too. (The bank pipeline moves an
item from `pretest` to `live` after calibration, M4.10.)

### The §13 evidence and `calibration_eligible` (`session-scoring.db.test.ts`)

`hb.integrity_evidence` runs four of the six checks of `engine/integrity.ts` on the server's rows: **too fast** (a correct
answer in less than a quarter of the item's median time, on items whose median is over 20 s), **uniform times** (sd of ln time
under 0.1 over at least 5 items whose expected times span a factor of 2), **accuracy on hard items** (the exact
Poisson-binomial tail, b > θ̂ + 1.5, α = 0.01) and **person fit** (Snijders' lz\*, under −2, from 20 items), each compared with the
app's on the same answers (lz\* to 1e-6, the tail to 1e-9). The differences from the app: the times are the **server's clock**
(response `created_at` minus the exposure's `served_at`), so a client cannot make itself look slow, and θ̂ is the per-axis Bayes
mode under N(0, 3²) as the app's. Visibility and paste can only be reported by the client. The evidence also holds
`too_fast_any`, the too-fast list without the condition that the answer was right. The fit statistics are computed in a block
of their own: if they fail (an overflow in a parameter row, say) the rest is kept and the failure is recorded as `fit_error`.

`hb.is_eligible` counts the flags as the app does (one per flagged response for visibility, paste and too fast, one each for
uniform times and hard-item accuracy; ineligible at 2 or more, or on person fit), where a flag counts if the client reported it
**or** the server saw it, once. Not eligible either: no answer, the server's own time check (`server_too_fast`), a client report of
misfit, or evidence that could not be computed (the session still closes; the state records `{error: <SQLSTATE>}`). The
client's own `calibration_eligible` is not taken.

`hb.is_eligible(session, true)` is the **blind** form, the only one `rescore` reads (see `rescore` above). The full count
is a function of which answers were right: a correct fast answer is a flag and a wrong one is not, and person fit and
hard-item accuracy read the key. So with `paste` set on one answer by the script itself, one fast answer makes the session
ineligible exactly when it was right. The blind count leaves out what reads the key: a fast answer counts whichever it was
(`too_fast_any`), the server's person-fit and hard-item verdicts are not read (the client's reports of them are, being the
client's choice), and a `fit_error` does not change it (an `error`, the times themselves failing, does). Tests:
`session-scoring.db.test.ts` builds twins that differ in the verdict of one answer and compares everything in the `rescore`
reply but the numbers of the score, and fails if `rescore` reads the full eligibility.

### Measured here (PostgreSQL 17, one connection)

`next_item` / the `next` of `submit` over a bank of 5,000 live items: about 30 ms; of 50,000 (the largest bank DESIGN §11.2 names,
no `p_axes`): about 0.3 s, and about 70 ms for one axis's segment; linear in the number of candidates. The
largest costs per row were the E[T] lookup (inlined), the information (inlined), and the sort for one candidate per family (done
only for families with more than one). If a live project shows more than the 300 ms budget, the lever is a window on |b − θ̂|
with an index on `item_parameters (param_version, b)`; not built, because it would change which items can be chosen.

### Not done, and left to the owner

- **How the blob gets the correlated MAP** (above): M2.7.
- Priors for a returning person: the in-session prior is N(0, 1) per axis (A21), not the posterior of the earlier sessions
  (`nextSessionPrior` in `engine/retest.ts`); the coverage floor does use the save's `seen_items`.
- Testlets: the DB has no `testlet_id` on an item, so 2PL-testlet items are scored as 2PL (as the app); `hb.map_theta` takes
  the `testlet` kind when the pipeline groups them.
- Person fit does not catch a padded session under 20 answers (README, "What this does not stop"), and `rescore` does not read it at
  any length (the blind eligibility, above): the padded-session reading of a score is limited by the call limits and the
  minimum counts only, until the owner decides on noise.
- A session with two fast answers (by the server's clock, right or wrong) is not scored by `rescore`, where the app's own
  check counts correct answers only. The count of two is the app's; whether a lone rusher should lose a whole session in the
  notes is the owner's to weigh.

## M2.3: signed saves

ROADMAP M2.3, DESIGN §8 "Tamper evidence", §13, R-8.1; ADR A16; AI.26. One migration (`20261003000100_save_signing`), the shim
file `50-signing-key.sql`, and `signing.db.test.ts` (47 tests).

### What is signed

`finish` hands the client the finished session as a `save-v1` session object, and now with a `sig` (`schema/save-v1.json`,
`session_sig`):

```json
"sig": {"alg": "HMAC-SHA256", "kid": "k2026a", "mac": "xEgBE1GcwUtIq8SbmhG6rjfJI8PibAuE_vdy4MDCIeQ", "anon_id": "hb_7Q3m9Kx2Vw5rT8pL"}
```

```
mac = base64url-no-padding( HMAC-SHA256( utf8(key of kid),
        utf8( jcs({ "anon_id": sig.anon_id, "kind": "hb.session.v1", "session": <the session without sig> }) ) ) )
```

`jcs` is RFC 8785 canonical JSON, the app's `src/save/jcs.ts` (keys in UTF-16 code unit order, no white space, ECMAScript
number and string forms). The test computes the same MAC with Node's `createHmac` and that serialiser
(`referenceMac` in `rpc-support.ts`), so the format is pinned from both sides; `hb.jcs` itself is held to `jcs.ts` on
the RFC's vectors, on every `d × 10^j` for `d` ≤ 99 and `j` from 15 to 40 (where PostgreSQL's own shortest-digits
routine differs from ECMAScript: it prints `1e23` as `9.999999999999999e+22`, and `hb.jcs_number` looks for the shorter
string that reads back as the same double), and on 2,000 random I-JSON values.

- **What the MAC covers:** the session's own data (id, start, duration, device, flags, every response tuple) and the
  `anon_id` it was issued to. The `anon_id` is in the sig because a merge (R-8.1) may give the file another one.
- **What it does not cover:** anything around the session: the file's `anon_id`, `seen_items`, `seen_families`,
  `posterior_cache`, `created_utc`, other sessions. A test verifies one session inside files that differ in all of those.
  `brief_prefs` is outside every session and is stripped by the client before any upload; a file that still holds it is
  rejected (`400 brief_prefs_not_accepted`), so editing preferences can never make a session unverified (AI.26).
- **What does not matter:** the way the client wrote the JSON. Key order, white space and the spelling of numbers (`5000`,
  `5000.0`, `5e3`) give the same canonical form (tested on 20 respellings of a whole file).
- **Who signs:** `hb.session_signed`, called by `finish` and by nothing else (a test lists the callers of the signer from the
  catalog). The server signs a session it built from its own rows, never a file or a session it was sent, so a file that holds
  sessions the server did not issue cannot be made to look signed (A16: "the server refuses to sign a file that contains any
  unverified session" holds because there is no way to ask it to sign a file). A second `finish` of the same session (a lost
  reply; within `session.post_finish_minutes`) returns the same session, signed again with the *current* kid.
- **Calibration** reads the database's rows (A16), and no RPC writes an upload into `responses` or `sessions` (a test lists the
  writers of both tables), so an unverified or forged file cannot enter it, whatever it holds.

### The unverified path (DESIGN §8)

`verify_save(p_save)` accepts any `save-v1` file and says, per session, `verified`, or `unverified` with a `reason`:

| reason | means |
|---|---|
| `unsigned` | no `sig`: a file from the offline MVP, or written by hand |
| `bad_signature` | the session, its `anon_id` or the MAC differs from what was signed |
| `unknown_key` | the sig's `kid` has no usable key (never issued here, or retired) |
| `malformed` | the sig is not the closed object of the schema; the session is over `sig.max_session_bytes` (256 KB) or nested deeper than 24 levels; or a value cannot be canonicalised |

An unverified session is the person's own data: the client shows it, marked unverified, and keeps it in their file (M2.7). The
server uses none of it. `verify_save` never errors on a bad session; it errors only on a bad *file* (not a `save-v1`
object, over `save.max_bytes`, over `verify.max_sessions` = 200 sessions, a `brief_prefs` key) and on the rate limit
(`rate.verifies_per_day` = 60 per hashed client address). The two MACs are compared through their SHA-256, so the time of the
comparison tells nothing about how much of a guess was right.

What *needs* a verified session: `hb.session_owned(session, anon_id)` is true only if the sig names that `anon_id`, the server
holds the session finished and issued to it, **and** the MAC verifies. `rescore` (known sessions), `delete_my_data` (the save
proof) and `start_session` (continuing an `anon_id`) all go through it. `rescore` decides it once per session id before the
big statement (the MAC is the costly part: canonicalising one session of 200 answers takes about 3 ms, and `verify_save` of 40 of them about 0.4 s here, most of it the `brief_prefs` walk and size check of the whole file that every RPC with a save makes).

### The key, and rotating it

The key of a `kid` is the Vault secret named **`save_hmac.<kid>`**: any text of at least 32 characters, whose UTF-8 bytes are the
HMAC key (a shorter one is treated as absent, so a weak key signs and verifies nothing). `app_config` `sig.current_kid` names the
kid that signs new sessions (`k2026a` as shipped). The migrations create **no** secret. The local database gets a random one at
creation (`50-signing-key.sql`); on a project the owner creates it at M2.6, in the SQL editor, with a key made on the owner's
machine:

```zsh
openssl rand -base64 48
```

```sql
select vault.create_secret('<the 64 characters printed above>', 'save_hmac.k2026a', 'save signing key');
```

Rotation (a new key without invalidating the files in the wild):

1. `select vault.create_secret('<another 64 characters>', 'save_hmac.k2027a', 'save signing key');`
2. `update public.app_config set value = '"k2027a"' where key = 'sig.current_kid';`

New sessions are signed under `k2027a`; sessions signed under `k2026a` keep verifying for as long as its secret exists. To
**retire** a key on purpose (it leaked), delete its secret: what it signed becomes `unverified: unknown_key`, and a person who
still holds the session's token (24 hours after finishing) gets it re-signed by calling `finish` again. After that the session is
only the person's own data, which is what a retired key is for. Nothing re-signs a file on request, by design (see above).

With no usable key for `sig.current_kid` the server signs nothing and `finish` still returns the session (a `finish` that fails
would lose a person's results), so every file reads `unverified: unsigned`. **After creating the key, finish a test session and look
for the `sig`.**

### Who can read the key

Only `hb.mac_sign`, owned by the role **`hb_signer`**: `nologin`, `select` on `vault.decrypted_secrets` and `usage` on `extensions`
and `vault`, nothing else; no table, no `create` on `hb` or `public` (it gets `create` on `hb` for the migration and loses it
again). `hb_definer` cannot read the Vault; it can call `hb.mac_sign(kid, message)`, which returns the MAC, never the key.
`anon`, `authenticated` and `service_role` cannot call it. The tests check each of these from the catalog and by trying (as the
role), and that the key text is in no RPC reply, no row of any table and no function body. (The shim's own encryption key is a
public constant; see the Vault row of the table above.)

### Limits and costs

`hb.jcs` is a recursive PL/pgSQL function over `jsonb`; scalars are handled in the same statement that aggregates their
container, so the cost is the number of containers, not of leaves. Nesting beyond 24 levels raises (`400 too_deep`) and every
caller that can meet client data catches it. A real session is 10 to 60 KB; one over `sig.max_session_bytes` is `malformed`
before any canonicalisation. An upload costs the canonicalisation only for sessions that the server holds and that name the
caller's `anon_id`; for `verify_save`, which has no such precondition, `verify.max_sessions` and the rate limit bound it. The
questions "whose file is this" (`start_session`, `delete_my_data`) look at the first `verify.max_sessions` sessions of a file only, so
a file padded with thousands of entries cannot make the server verify thousands of MACs. The server signs only what it would
accept: a session over `sig.max_session_bytes` comes back unsigned from `finish`, and so does one holding an answer that has no
canonical form (nested beyond 24 levels, a number no double holds); the session and the person's results are returned either way.

## Secrets

None. Every password is random per run and dies with the cluster; the Vault shim's key is a public
constant; the Vault values in tests are fake strings; the local signing key (`50-signing-key.sql`) is random per database
and written to no file. `web/scripts/db/wiring.test.ts` fails on a JWT,
an API-key shape, a non-local database URL or a hosted-Supabase host in any file under this directory
or `web/scripts/db/`, test files included (only `wiring.test.ts` itself is skipped: it holds the
patterns). Answer keys and `item_keys` data are never committed to this repo
(CLAUDE.md); the fixtures hold no keys.
