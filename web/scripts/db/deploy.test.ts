/**
 * The pure parts of the deploy tool (ROADMAP M2.6): reading the connection string from a file, keeping it
 * out of every message, and deciding what a run would do. No database (deploy.db.test.ts has one).
 */

import fc from 'fast-check'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { hostOf, isLocalHost, parseEnvValue, planDeploy, redactor, secretsOf, sha256, type LedgerRow } from './deploy'
import type { SqlFile } from './sql'

const file = (version: string, name: string, sql = `select '${name}';`): SqlFile => ({ name: `${version}_${name}.sql`, sql })
const row = (f: SqlFile, statements: string[] | null = [f.sql]): LedgerRow => {
  const [version, ...rest] = f.name.replace(/\.sql$/, '').split('_')
  return { version: version as string, name: rest.join('_'), statements }
}
const A = file('20260101000100', 'a')
const B = file('20260101000200', 'b')
const C = file('20260101000300', 'c')

// Built from parts so that no file under web/scripts/db holds a database URL with a host (wiring.test.ts).
const urlFor = (password: string, host = 'db.example.test'): string => ['postgresql', '://', 'postgres.ref', ':', password, '@', host, ':5432/postgres'].join('')

describe('parseEnvValue', () => {
  it('reads a quoted, a double-quoted, a bare and an exported value, and skips comments and other keys', () => {
    expect(parseEnvValue(`SUPABASE_DB_URL='abc=def'\n`, 'SUPABASE_DB_URL')).toBe('abc=def')
    expect(parseEnvValue(`# SUPABASE_DB_URL=no\nOTHER=1\n  SUPABASE_DB_URL = "x y"  \r\n`, 'SUPABASE_DB_URL')).toBe('x y')
    expect(parseEnvValue(`export SUPABASE_DB_URL=bare`, 'SUPABASE_DB_URL')).toBe('bare')
    expect(parseEnvValue(`SUPABASE_DB_URL_OLD=1\n`, 'SUPABASE_DB_URL')).toBeUndefined()
    expect(parseEnvValue('', 'SUPABASE_DB_URL')).toBeUndefined()
  })
})

describe('redaction', () => {
  it('lists the string and its password, raw and decoded', () => {
    const url = urlFor('p%40ss%2Fword')
    expect(secretsOf(url)).toEqual([url, 'p%40ss%2Fword', 'p@ss/word'])
    expect(secretsOf(urlFor('plain'))).toEqual([urlFor('plain'), 'plain'])
  })

  it('removes the string, the password in both forms and any other database URL from a message', () => {
    const url = urlFor('p%40ss%2Fword')
    const redact = redactor(secretsOf(url))
    const out = redact(`could not connect to ${url}: password "p@ss/word" (sent as p%40ss%2Fword); also ${urlFor('other', 'elsewhere.test')} end`)
    expect(out).toBe('could not connect to [redacted]: password "[redacted]" (sent as [redacted]); also [redacted] end')
  })

  it('never lets a password through, whatever it is and wherever it stands (property)', () => {
    fc.assert(
      fc.property(fc.stringMatching(/^[A-Za-z0-9!$*._~-]{8,40}$/), fc.string(), fc.string(), (password, before, after) => {
        const url = urlFor(password)
        const out = redactor(secretsOf(url))(`${before}${password}${after} ${url}`)
        expect(out).not.toContain(password)
      }),
    )
  })

  it('knows a local server from a remote one, without printing the rest of the string', () => {
    expect(hostOf(urlFor('x'))).toBe('db.example.test')
    expect(hostOf(urlFor('x', '127.0.0.1'))).toBe('127.0.0.1')
    expect(isLocalHost('127.0.0.1') && isLocalHost('localhost')).toBe(true)
    expect(isLocalHost('db.example.test')).toBe(false)
  })
})

describe('planDeploy', () => {
  it('applies everything to an empty ledger, in order', () => {
    expect(planDeploy([A, B, C], [])).toEqual({ applied: [], pending: [A, B, C], problems: [] })
  })

  it('skips what is recorded and continues after it', () => {
    expect(planDeploy([A, B, C], [row(A), row(B)])).toEqual({ applied: [A.name, B.name], pending: [C], problems: [] })
    expect(planDeploy([A, B, C], [row(A), row(B), row(C)])).toEqual({ applied: [A.name, B.name, C.name], pending: [], problems: [] })
  })

  it('refuses a recorded file that has changed', () => {
    const plan = planDeploy([A, B], [row(A, ['select 0;']), row(B)])
    expect(plan.problems).toHaveLength(1)
    expect(plan.problems[0]).toContain(`${A.name} has changed`)
  })

  it('does not compare a row another tool recorded (split statements, or none)', () => {
    expect(planDeploy([A, B], [row(A, ['select 1', 'select 2']), row(B, null)]).problems).toEqual([])
  })

  it('refuses a ledger row with no file, and a new file that sorts before an applied one', () => {
    expect(planDeploy([A], [row(A), row(B)]).problems[0]).toContain(`${row(B).version}_b, which is not in the migrations directory`)
    const gap = planDeploy([A, B, C], [row(A), row(C)])
    expect(gap.problems[0]).toContain(`${B.name} is not applied but the later ${C.name} is`)
  })

  it('is the identity of the file text that is compared', () => {
    expect(sha256('abc')).toBe('ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad')
    expect(sha256('a')).not.toBe(sha256('a '))
  })
})

describe('the command', () => {
  const cli = readFileSync(fileURLToPath(new URL('./deploy-cli.ts', import.meta.url)), 'utf8')
  const pkg = JSON.parse(readFileSync(fileURLToPath(new URL('../../package.json', import.meta.url)), 'utf8')) as { scripts: Record<string, string> }
  const ci = readFileSync(fileURLToPath(new URL('../../../.github/workflows/ci.yml', import.meta.url)), 'utf8')

  it('takes the connection string from a file only: no argument, no environment variable', () => {
    expect(pkg.scripts['db:deploy']).toBe('tsx scripts/db/deploy-cli.ts')
    expect(cli).toContain("option(args, '--env-file')")
    expect(cli).not.toMatch(/process\.env/)
    expect(cli).not.toMatch(/option\(args, '--(url|db-url|connection)'\)/)
  })

  it('prints errors through the redactor, and is run by no workflow', () => {
    expect(cli).toContain('console.error(redact(')
    expect(ci).not.toContain('db:deploy')
  })
})
