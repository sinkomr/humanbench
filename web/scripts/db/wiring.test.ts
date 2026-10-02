/**
 * Guards the wiring of the local database harness (ROADMAP M2.0, A6) without starting a database:
 * the npm scripts, the pinned engine, the separate vitest project, the CI job, the ADR in
 * supabase/README.md, and the rules that keep keys, real secrets and cloud calls out of the repo.
 */

import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import dbConfig from '../../vitest.db.config'
import { PG_MAJOR } from './engine'

const WEB = fileURLToPath(new URL('../../', import.meta.url))
const REPO = fileURLToPath(new URL('../../../', import.meta.url))
const read = (path: string): string => readFileSync(join(REPO, path), 'utf8')
const pkg = JSON.parse(read('web/package.json')) as {
  scripts: Record<string, string>
  dependencies?: Record<string, string>
  devDependencies: Record<string, string>
  optionalDependencies: Record<string, string>
}

/** This file holds the forbidden patterns as regular expressions, so no scan can include it. */
const SELF = 'web/scripts/db/wiring.test.ts'

/**
 * Every file under `dir` (repo-relative), test files included: the DB tests of M2.1-M2.4 live in
 * web/scripts/db and are where a pasted key or a real database URL would most likely end up.
 */
function filesUnder(dir: string): string[] {
  const out: string[] = []
  for (const name of readdirSync(join(REPO, dir), { recursive: true, encoding: 'utf8' })) {
    const path = `${dir}/${name}`
    if (statSync(join(REPO, path)).isFile() && path !== SELF) out.push(path)
  }
  return out.sort()
}

describe('npm scripts and dependencies', () => {
  it('has one command for the DB tests, and `npm test` does not start a database', () => {
    expect(pkg.scripts['test:db']).toBe('vitest run -c vitest.db.config.ts')
    expect(pkg.scripts.test).toBe('vitest run')
    expect(pkg.scripts['db:up']).toBe('tsx scripts/db/cli.ts up')
    expect(pkg.scripts['db:reap']).toBe('tsx scripts/db/cli.ts reap')
  })

  it('keeps *.db.test.ts out of the unit project and runs only them in the db project', () => {
    expect(read('web/vite.config.ts')).toContain(`'scripts/**/*.db.test.ts'`)
    expect(dbConfig.test?.include).toEqual(['scripts/db/**/*.db.test.ts'])
    expect(dbConfig.test?.globalSetup).toEqual(['scripts/db/global-setup.ts'])
    expect(existsSync(join(WEB, 'scripts/db/global-setup.ts'))).toBe(true)
  })

  it(`pins the Postgres ${PG_MAJOR} binaries exactly, for every platform the harness wires`, () => {
    const names = Object.keys(pkg.optionalDependencies).sort()
    expect(names).toEqual(['@embedded-postgres/darwin-arm64', '@embedded-postgres/darwin-x64', '@embedded-postgres/linux-arm64', '@embedded-postgres/linux-x64'])
    const versions = new Set(Object.values(pkg.optionalDependencies))
    expect(versions.size).toBe(1)
    const [version] = [...versions]
    expect(version).toMatch(new RegExp(`^${PG_MAJOR}\\.\\d+\\.\\d+(-[a-z]+\\.\\d+)?$`))
  })

  it('does not depend on the embedded-postgres wrapper: importing it forces every process to exit 0', () => {
    const all = { ...pkg.dependencies, ...pkg.devDependencies, ...pkg.optionalDependencies }
    expect(Object.keys(all)).not.toContain('embedded-postgres')
    expect(Object.keys(all)).not.toContain('async-exit-hook')
    for (const f of filesUnder('web/scripts/db')) expect(readFileSync(join(REPO, f), 'utf8'), f).not.toMatch(/from 'embedded-postgres'|require\('embedded-postgres'\)/)
  })

  it('has the node-postgres client and its types', () => {
    expect(pkg.devDependencies.pg).toBeDefined()
    expect(pkg.devDependencies['@types/pg']).toBeDefined()
  })
})

describe('the shared-memory shim and the cleanup layers (M2.0, 2026-10-01)', () => {
  const engine = read('web/scripts/db/engine.ts')
  const readme = read('supabase/README.md')

  it('ships the C source and builds it from the harness, on macOS only', () => {
    expect(existsSync(join(REPO, 'web/scripts/db/shm/hb_shm_shim.c'))).toBe(true)
    expect(read('web/scripts/db/shm/hb_shm_shim.c')).toContain('__DATA,__interpose')
    expect(engine).toContain("from './shm'")
    expect(engine).toMatch(/os !== 'darwin'/)
  })

  it('starts the server with mmap shared memory in both settings', () => {
    expect(engine).toContain("['shared_memory_type', 'mmap']")
    expect(engine).toContain("['dynamic_shared_memory_type', 'mmap']")
  })

  it('adds no dependency for it: no PGlite, no native addon, no wrapper', () => {
    const all = Object.keys({ ...pkg.dependencies, ...pkg.devDependencies, ...pkg.optionalDependencies })
    expect(all.filter((n) => /pglite|ffi|node-gyp|bindings/.test(n))).toEqual([])
  })

  it('documents the shim, the two environment variables, the four cleanup layers and why PGlite does not do', () => {
    for (const phrase of ['HB_PG_SHM', 'HB_PG_GUARD', 'Amendment 2026-10-01', 'DYLD_INSERT_LIBRARIES', 'guard', 'statement_timeout` is not enforced']) {
      expect(readme, phrase).toContain(phrase)
    }
  })

  it('has a test that ends a cluster\'s owner every way and one that exercises the shim', () => {
    for (const f of ['cleanup.db.test.ts', 'shm.test.ts']) expect(existsSync(join(WEB, 'scripts/db', f)), f).toBe(true)
    const cleanup = read('web/scripts/db/cleanup.db.test.ts')
    for (const how of ['SIGINT', 'SIGTERM', 'SIGHUP', 'SIGKILL', 'process.exit', 'stop-twice']) expect(cleanup, how).toContain(how)
  })
})

describe('CI', () => {
  const ci = read('.github/workflows/ci.yml')

  it('runs the DB tests in their own job, without a database service or a cloud secret', () => {
    expect(ci).toMatch(/^ {2}db:\n/m)
    expect(ci).toContain('npm run test:db')
    expect(ci).not.toMatch(/^\s*services:|^\s*postgres:|SUPABASE_|\$\{\{\s*secrets\./m)
  })
})

describe('supabase/', () => {
  const readme = read('supabase/README.md')

  it('has an ADR for the engine: the decision, the alternatives it rejected, and why', () => {
    for (const heading of ['## ADR M2.0', '### Decision', '### Alternatives considered', '### Consequences']) expect(readme).toContain(heading)
    expect(readme).toContain('@embedded-postgres')
    for (const rejected of ['pgserver', 'PGlite', 'brew install postgresql@17', 'Docker']) expect(readme, rejected).toContain(rejected)
    expect(readme).toMatch(/A6/)
  })

  it('documents the commands that run and inspect the database', () => {
    for (const cmd of ['npm run test:db', 'npm run db:up', 'npm run db:reap']) expect(readme, cmd).toContain(cmd)
  })

  it('states what the shim mirrors, what it does not, and what to verify against the live project at M2.6', () => {
    for (const phrase of ['What the shim mirrors', 'What it does not', 'M2.6']) expect(readme, phrase).toContain(phrase)
  })

  it('keeps migrations in supabase/migrations and the shim in supabase/local, away from the Supabase CLI\'s inputs', () => {
    expect(existsSync(join(REPO, 'supabase/migrations'))).toBe(true)
    expect(existsSync(join(REPO, 'supabase/local/cluster/00-roles.sql'))).toBe(true)
    expect(readdirSync(join(REPO, 'supabase/migrations')).filter((f) => f.endsWith('.sql') && f.includes('shim'))).toEqual([])
  })
})

describe('secrets and cloud (CLAUDE.md, A6)', () => {
  const scanned = [...filesUnder('supabase'), ...filesUnder('web/scripts/db')].filter((f) => !f.endsWith('.gitkeep'))

  it('scans the shim, the migrations, the fixtures and the harness', () => {
    expect(scanned).toContain('supabase/local/database/40-vault.sql')
    expect(scanned).toContain('web/scripts/db/harness.ts')
    // Test files too: the DB tests of the later M2 tasks are written there.
    for (const t of ['shim.db.test.ts', 'harness.db.test.ts', 'cli.db.test.ts', 'sql.test.ts', 'engine.test.ts']) expect(scanned).toContain(`web/scripts/db/${t}`)
    expect(scanned).not.toContain(SELF)
    expect(scanned.length).toBeGreaterThan(10)
  })

  it('contains no JWT, no API key shape and no remote database URL', () => {
    for (const f of scanned) {
      const text = readFileSync(join(REPO, f), 'utf8')
      expect(text, `${f}: JWT-shaped string`).not.toMatch(/eyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\./)
      expect(text, `${f}: API key shape`).not.toMatch(/\b(sk_(live|test)_|sbp_[0-9a-f]{20}|sb_secret_|AKIA[0-9A-Z]{16})/)
      for (const url of text.match(/postgres(?:ql)?:\/\/[^\s'"`]+/g) ?? []) {
        const host = /@(\$\{[^}]+\}|[^:/?\s]+)/.exec(url)?.[1]
        if (host === undefined) continue // no credentials or host in this mention
        // 127.0.0.1 and localhost, a template placeholder, or the literal word `host` in a doc comment.
        expect(['127.0.0.1', 'localhost', 'host'].includes(host) || host.startsWith('${'), `${f}: ${url}`).toBe(true)
      }
    }
  })

  it('never names a hosted Supabase or other cloud host, so nothing here can reach one', () => {
    for (const f of scanned) {
      expect(readFileSync(join(REPO, f), 'utf8'), f).not.toMatch(/\.supabase\.(co|com|in)\b|supabase\.com|amazonaws\.com|neon\.tech|fly\.dev/i)
    }
  })

  it('puts no data into item_keys: the shim and fixtures do not name it, the migrations only define and read it (CLAUDE.md)', () => {
    for (const f of scanned.filter((p) => p.endsWith('.sql'))) {
      const text = readFileSync(join(REPO, f), 'utf8')
      if (f.startsWith('supabase/migrations/')) {
        // M2.1 creates the table (DESIGN §12) and its RPCs read it; nothing may write a row. migrations.test.ts
        // repeats this with the full statement list.
        expect(text, f).not.toMatch(/\b(insert\s+into|update|delete\s+from|copy|truncate(?:\s+table)?)\s+(?:only\s+)?(?:public\.)?item_keys\b/i)
      } else {
        expect(text, f).not.toMatch(/item_keys/i)
      }
    }
  })

  it('marks every fixture migration as a test fixture, so none is mistaken for a real one', () => {
    for (const f of scanned.filter((p) => p.includes('/fixtures/') && p.endsWith('.sql'))) {
      expect(readFileSync(join(REPO, f), 'utf8'), f).toMatch(/TEST FIXTURE/)
    }
  })
})
