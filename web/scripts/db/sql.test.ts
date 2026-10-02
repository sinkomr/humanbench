/**
 * The pure parts of the local database harness (ROADMAP M2.0): reading and validating the shim and
 * the migrations, the template hash, identifier quoting, the RPC call builder, connection URLs.
 * No database; `npm test` runs these, `npm run test:db` runs the rest.
 */

import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import fc from 'fast-check'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { binaryPackage, connectionUrl } from './engine'
import {
  MIGRATION_NAME,
  MIGRATIONS_DIR,
  SHIM_CLUSTER_DIR,
  SHIM_DATABASE_DIR,
  quoteIdent,
  readMigrations,
  readShimFiles,
  rpcCallSql,
  templateDigest,
  type SqlFile,
} from './sql'

let dir: string
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'hb-sql-test-'))
})
afterEach(() => {
  rmSync(dir, { recursive: true, force: true })
})

const put = (name: string, sql = 'select 1;\n'): void => writeFileSync(join(dir, name), sql)

describe('readMigrations', () => {
  it('returns nothing for a missing directory, and ignores dotfiles', () => {
    expect(readMigrations(join(dir, 'absent'))).toEqual([])
    put('.gitkeep', '')
    expect(readMigrations(dir)).toEqual([])
  })

  it('returns the files in version order with their SQL', () => {
    put('20260930120500_second.sql', 'select 2;')
    put('20260930120000_first.sql', 'select 1;')
    expect(readMigrations(dir)).toEqual([
      { name: '20260930120000_first.sql', sql: 'select 1;' },
      { name: '20260930120500_second.sql', sql: 'select 2;' },
    ])
  })

  it.each([
    ['notes.md', /notes\.md: not a migration file name/],
    ['20260930_short_version.sql', /not a migration file name/],
    ['20260930120000_Upper.sql', /not a migration file name/],
    ['20260930120000_dash-name.sql', /not a migration file name/],
    ['20260930120000_name.txt', /not a migration file name/],
    ['20260930120000.sql', /not a migration file name/],
  ])('rejects %s, naming the file', (name, message) => {
    put(name)
    expect(() => readMigrations(dir)).toThrow(message)
  })

  it('rejects a directory inside the migrations directory', () => {
    mkdirSync(join(dir, 'nested'))
    expect(() => readMigrations(dir)).toThrow(/nested: not a migration file name/)
  })

  it('rejects two migrations with one version, naming both', () => {
    put('20260930120000_a.sql')
    put('20260930120000_b.sql')
    expect(() => readMigrations(dir)).toThrow(/20260930120000_a\.sql and 20260930120000_b\.sql share the version 20260930120000/)
  })

  it('accepts whatever supabase/migrations holds now (so M2.1 file names are checked by npm test)', () => {
    expect(() => readMigrations(MIGRATIONS_DIR)).not.toThrow()
  })

  it('property: the name rule accepts exactly 14 digits, an underscore, a snake_case name and .sql', () => {
    const digits14 = fc.stringMatching(/^\d{14}$/)
    const snake = fc.stringMatching(/^[a-z][a-z0-9_]{0,30}$/)
    fc.assert(
      fc.property(digits14, snake, (version, name) => {
        const m = MIGRATION_NAME.exec(`${version}_${name}.sql`)
        expect(m?.[1]).toBe(version)
        expect(m?.[2]).toBe(name)
      }),
    )
    fc.assert(
      fc.property(fc.stringMatching(/^\d{0,13}$/), snake, (version, name) => {
        expect(MIGRATION_NAME.test(`${version}_${name}.sql`)).toBe(false)
      }),
    )
  })
})

describe('the Supabase shim files', () => {
  it('are the roles file for the cluster and five numbered files for each database, in order', () => {
    expect(readShimFiles(SHIM_CLUSTER_DIR).map((f) => f.name)).toEqual(['00-roles.sql'])
    expect(readShimFiles(SHIM_DATABASE_DIR).map((f) => f.name)).toEqual(['10-extensions.sql', '20-privileges.sql', '30-auth.sql', '40-vault.sql', '50-signing-key.sql'])
  })

  it('ignore non-SQL files and a missing directory', () => {
    put('README.md', '# not sql')
    put('10-a.sql', 'select 1;')
    expect(readShimFiles(dir).map((f) => f.name)).toEqual(['10-a.sql'])
    expect(readShimFiles(join(dir, 'absent'))).toEqual([])
  })
})

describe('templateDigest', () => {
  const parts = (migrations: SqlFile[] = [], database: SqlFile[] = [], cluster: SqlFile[] = []) => ({ cluster, database, migrations })
  const f = (name: string, sql: string): SqlFile => ({ name, sql })

  it('is 12 hex characters and does not depend on anything but the files', () => {
    const d = templateDigest(parts([f('a.sql', 'x')]))
    expect(d).toMatch(/^[0-9a-f]{12}$/)
    expect(templateDigest(parts([f('a.sql', 'x')]))).toBe(d)
  })

  it('changes with a file\'s SQL, its name, the file order, and which list it is in', () => {
    const base = templateDigest(parts([f('a.sql', 'x'), f('b.sql', 'y')]))
    expect(templateDigest(parts([f('a.sql', 'x'), f('b.sql', 'z')]))).not.toBe(base)
    expect(templateDigest(parts([f('a.sql', 'x'), f('c.sql', 'y')]))).not.toBe(base)
    expect(templateDigest(parts([f('b.sql', 'y'), f('a.sql', 'x')]))).not.toBe(base)
    expect(templateDigest(parts([], [f('a.sql', 'x'), f('b.sql', 'y')]))).not.toBe(base)
    expect(templateDigest(parts([f('a.sql', 'x')]))).not.toBe(base)
  })

  it('property: files that differ in one character never share a digest, and moving a boundary changes it', () => {
    fc.assert(
      fc.property(fc.string({ maxLength: 40 }), fc.string({ maxLength: 40 }), (a, b) => {
        fc.pre(a !== b)
        expect(templateDigest(parts([f('m.sql', a)]))).not.toBe(templateDigest(parts([f('m.sql', b)])))
      }),
    )
    // "ab" + "c" must not hash like "a" + "bc": the digest delimits names and lengths.
    expect(templateDigest(parts([f('1.sql', 'ab'), f('2.sql', 'c')]))).not.toBe(templateDigest(parts([f('1.sql', 'a'), f('2.sql', 'bc')])))
  })
})

describe('quoteIdent', () => {
  it('double-quotes and doubles embedded quotes', () => {
    expect(quoteIdent('hb_t_0123')).toBe('"hb_t_0123"')
    expect(quoteIdent('we"ird')).toBe('"we""ird"')
  })

  it('property: the result unquotes back to the input and never contains a lone quote inside', () => {
    fc.assert(
      fc.property(fc.string(), (name) => {
        const q = quoteIdent(name)
        expect(q.startsWith('"') && q.endsWith('"')).toBe(true)
        const inner = q.slice(1, -1)
        expect(inner.replace(/""/g, '')).not.toContain('"')
        expect(inner.replace(/""/g, '"')).toBe(name)
      }),
    )
  })
})

describe('rpcCallSql', () => {
  const params = [
    { name: 'p_text', type: 'text' },
    { name: 'p_list', type: 'text[]' },
    { name: 'p_doc', type: 'jsonb' },
  ]

  it('calls a function with no arguments directly', () => {
    expect(rpcCallSql('public', 'whoami', [], [], { type: 'jsonb' })).toBe('select to_jsonb(f) as result from "public"."whoami"() as f')
  })

  it('passes only the arguments sent, by name, typed through json_to_record (SQL defaults fill the rest)', () => {
    expect(rpcCallSql('public', 'echo_args', params, ['p_text', 'p_doc'], { type: 'jsonb' })).toBe(
      'select to_jsonb(f) as result from json_to_record($1::json) as _args("p_text" text, "p_doc" jsonb), lateral "public"."echo_args"("p_text" := _args."p_text", "p_doc" := _args."p_doc") as f',
    )
  })

  it('returns NULL for a void function, which to_jsonb cannot represent', () => {
    expect(rpcCallSql('public', 'do_nothing', [], [], { type: 'void' })).toBe('select null::jsonb as result from "public"."do_nothing"() as f')
  })

  it('names an unknown argument and what the function has', () => {
    expect(() => rpcCallSql('public', 'echo_args', params, ['p_nope'], { type: 'jsonb' })).toThrow(/no parameter "p_nope" \(it has: p_text, p_list, p_doc\)/)
  })

  it('quotes function and argument names, so a name cannot break out of the statement', () => {
    const sql = rpcCallSql('public', 'f"; drop table x; --', [{ name: 'a"b', type: 'text' }], ['a"b'], { type: 'text' })
    expect(sql).toContain('"f""; drop table x; --"')
    expect(sql).toContain('"a""b" text')
  })
})

describe('connection URLs', () => {
  const info = { host: '127.0.0.1', port: 54321, password: 'p+w/d=', dir: '/tmp/x' }

  it('builds a URL that encodes the password and the user', () => {
    expect(connectionUrl(info, 'postgres', 'hb_test_1')).toBe('postgres://postgres:p%2Bw%2Fd%3D@127.0.0.1:54321/hb_test_1')
    expect(new URL(connectionUrl(info, 'supabase_admin')).password).toBe('p%2Bw%2Fd%3D')
  })

  it('property: the URL parses back to the user, password and database it was built from', () => {
    // No dots: a `..` database name would be path-normalised by the URL parser, which no real name needs.
    const word = fc.stringMatching(/^[A-Za-z0-9_+/=:@ %#?&-]{1,24}$/)
    fc.assert(
      fc.property(word, word, word, (user, password, database) => {
        const url = new URL(connectionUrl({ ...info, password }, user, database))
        expect(url.protocol).toBe('postgres:')
        expect(`${url.hostname}:${url.port}`).toBe('127.0.0.1:54321')
        expect(decodeURIComponent(url.username)).toBe(user)
        expect(decodeURIComponent(url.password)).toBe(password)
        expect(decodeURIComponent(url.pathname.slice(1))).toBe(database)
      }),
    )
  })
})

describe('binaryPackage', () => {
  it('names the @embedded-postgres package of each supported platform', () => {
    expect(binaryPackage('darwin', 'arm64')).toBe('@embedded-postgres/darwin-arm64')
    expect(binaryPackage('darwin', 'x64')).toBe('@embedded-postgres/darwin-x64')
    expect(binaryPackage('linux', 'x64')).toBe('@embedded-postgres/linux-x64')
    expect(binaryPackage('linux', 'arm64')).toBe('@embedded-postgres/linux-arm64')
  })

  it('says what is missing on a platform it does not wire', () => {
    expect(() => binaryPackage('win32', 'x64')).toThrow(/No Postgres binaries are wired for win32 x64/)
  })
})
