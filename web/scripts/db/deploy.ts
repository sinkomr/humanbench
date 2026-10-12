/**
 * Applying `supabase/migrations` to a database that is not the throw-away one (ROADMAP M2.6, A6): the
 * owner's Supabase project. `deploy-cli.ts` is the command; this file is what it does, so that the same
 * code runs against the local harness in `deploy.db.test.ts`.
 *
 * - Recorded: every applied file is a row of `supabase_migrations.schema_migrations`, the table the
 *   Supabase CLI keeps (`version`, `name`, `statements`), so the CLI sees the same history. This tool
 *   stores the whole file as one statement, which is also how a later run notices that a file changed.
 * - Idempotent: a file whose version is recorded is skipped; a second run applies nothing.
 * - One transaction per file, the ledger row included: a file is applied and recorded, or neither.
 * - Stops at the first error, and refuses to start when the ledger and the directory disagree (a
 *   recorded file is missing or changed, or a new file sorts before an applied one).
 * - As the harness does (and Supabase does not): a GRANT or REVOKE that Postgres only warns about
 *   fails the file, because a revoke that did nothing leaves an object exposed.
 *
 * The connection string is a secret. It is read from a file by `readDbUrl`, never from the command
 * line, and nothing here prints it: every message goes through `redactor`.
 */

import { createHash } from 'node:crypto'
import type pg from 'pg'
import { MIGRATION_NAME, type SqlFile } from './sql'

export const LEDGER_SCHEMA = 'supabase_migrations'
export const LEDGER_TABLE = 'schema_migrations'
const LEDGER = `${LEDGER_SCHEMA}.${LEDGER_TABLE}`
/** Serialises two deploys against one database (a session-level advisory lock). */
const LOCK_DEPLOY = 7_420_026
/** SQLSTATE 01006 `privilege_not_revoked` and 01007 `privilege_not_granted`: GRANT/REVOKE only warn. */
const NO_PRIVILEGE_CHANGE = new Set(['01006', '01007'])

/** The value of `KEY=value` in the text of an env file (quotes optional, `export` allowed), or undefined. */
export function parseEnvValue(text: string, key: string): string | undefined {
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim()
    if (line === '' || line.startsWith('#')) continue
    const m = /^(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/.exec(line)
    if (m === null || m[1] !== key) continue
    const value = (m[2] as string).trim()
    const quoted = /^(['"])(.*)\1$/.exec(value)
    return quoted === null ? value : (quoted[2] as string)
  }
  return undefined
}

/** Everything in a connection string that must not be printed: the string itself and its password, raw and decoded. */
export function secretsOf(url: string): string[] {
  const out = [url]
  const m = /^[a-z]+:\/\/[^:/@]*:([^@]*)@/i.exec(url)
  const password = m?.[1]
  if (password !== undefined && password !== '') {
    out.push(password)
    try {
      out.push(decodeURIComponent(password))
    } catch {
      // not percent-encoded; the raw form is already listed
    }
  }
  return [...new Set(out)]
}

/** A function that removes the given secrets, and anything shaped like a database URL, from a message. */
export function redactor(secrets: readonly string[]): (text: string) => string {
  const ordered = [...secrets].filter((s) => s.length > 0).sort((a, b) => b.length - a.length)
  return (text) => {
    let out = text
    for (const s of ordered) out = out.split(s).join('[redacted]')
    return out.replace(/postgres(?:ql)?:\/\/\S+/gi, '[redacted]')
  }
}

/** True for a server on this machine (the harness): no TLS there. */
export function isLocalHost(host: string): boolean {
  return host === 'localhost' || host === '127.0.0.1' || host === '::1' || host === '[::1]'
}

/** The host of a connection string (never printed with the rest), or undefined. */
export function hostOf(url: string): string | undefined {
  return /^[a-z]+:\/\/(?:[^@/]*@)?(\[[^\]]+\]|[^:/?]+)/i.exec(url)?.[1]
}

export function sha256(text: string): string {
  return createHash('sha256').update(text, 'utf8').digest('hex')
}

export interface LedgerRow {
  readonly version: string
  readonly name: string | null
  readonly statements: readonly string[] | null
}

export interface Plan {
  /** Recorded and unchanged (or recorded by another tool, which is not compared). */
  readonly applied: readonly string[]
  /** To apply, in order. */
  readonly pending: readonly SqlFile[]
  /** Reasons not to touch the database. Empty when the plan can run. */
  readonly problems: readonly string[]
}

function versionOf(file: SqlFile): string {
  const m = MIGRATION_NAME.exec(file.name)
  if (m === null) throw new Error(`${file.name}: not a migration file name`)
  return m[1] as string
}

/** What a run would do, from the files (in application order) and the ledger's rows. Pure. */
export function planDeploy(files: readonly SqlFile[], ledger: readonly LedgerRow[]): Plan {
  const recorded = new Map(ledger.map((r) => [r.version, r]))
  const known = new Set(files.map(versionOf))
  const problems: string[] = []
  const applied: string[] = []
  const pending: SqlFile[] = []
  for (const row of ledger) {
    if (!known.has(row.version)) problems.push(`the ledger records ${row.version}${row.name === null ? '' : `_${row.name}`}, which is not in the migrations directory`)
  }
  for (const file of files) {
    const row = recorded.get(versionOf(file))
    if (row === undefined) {
      pending.push(file)
      continue
    }
    if (pending.length > 0) problems.push(`${(pending[0] as SqlFile).name} is not applied but the later ${file.name} is: migrations are applied in order`)
    // One statement holding a whole file is this tool's record; anything else is another tool's and is not compared.
    const whole = row.statements !== null && row.statements.length === 1 ? (row.statements[0] as string) : undefined
    if (whole !== undefined && sha256(whole) !== sha256(file.sql)) problems.push(`${file.name} has changed since it was applied (an applied migration is never edited; add a new one)`)
    applied.push(file.name)
  }
  return { applied, pending, problems }
}

async function ledgerExists(db: pg.Client): Promise<boolean> {
  const r = await db.query<{ t: string | null }>('select to_regclass($1)::text as t', [LEDGER])
  return r.rows[0]?.t != null
}

/** The ledger's rows; none when the table does not exist yet. Read-only. */
export async function readLedger(db: pg.Client): Promise<LedgerRow[]> {
  if (!(await ledgerExists(db))) return []
  const r = await db.query<{ version: string; name: string | null; statements: string[] | null }>(`select version, name, statements from ${LEDGER} order by version`)
  return r.rows
}

async function ensureLedger(db: pg.Client): Promise<void> {
  if (await ledgerExists(db)) return
  await db.query('begin')
  try {
    // The Supabase CLI's own definition, so that it reads and extends the same history. No grant to any
    // API role, and the schema is not one PostgREST exposes; RLS as on every table of the project.
    await db.query(`create schema if not exists ${LEDGER_SCHEMA}`)
    await db.query(`create table if not exists ${LEDGER} (version text not null primary key, statements text[], name text)`)
    await db.query(`alter table ${LEDGER} enable row level security`)
    await db.query('commit')
  } catch (e) {
    await db.query('rollback').catch(() => undefined)
    throw e
  }
}

export interface AppliedFile {
  readonly name: string
  readonly ms: number
}

export interface DeployResult {
  readonly applied: readonly AppliedFile[]
  readonly skipped: readonly string[]
}

/** One file and its ledger row in one transaction. A failure names the file and, if Postgres gave a position, the line. */
async function applyFile(db: pg.Client, file: SqlFile): Promise<number> {
  const noPrivilegeChange: string[] = []
  const onNotice = (n: { code?: string | undefined; message?: string | undefined }): void => {
    if (n.code !== undefined && NO_PRIVILEGE_CHANGE.has(n.code)) noPrivilegeChange.push(n.message ?? n.code)
  }
  const started = performance.now()
  db.on('notice', onNotice)
  await db.query('begin')
  try {
    try {
      await db.query(file.sql)
    } catch (e) {
      const err = e as Error & { position?: string }
      const pos = err.position === undefined ? undefined : Number(err.position)
      const line = pos === undefined ? '' : ` (line ${file.sql.slice(0, pos).split('\n').length})`
      throw new Error(`migration ${file.name}${line} failed: ${err.message}`, { cause: e })
    }
    if (noPrivilegeChange.length > 0) {
      throw new Error(
        `migration ${file.name} failed: Postgres did not apply a privilege change (${noPrivilegeChange.join('; ')}). ` +
          'The role running the migration lacks the right to grant or revoke it.',
      )
    }
    // A file that ends inside `set local role` must not write the ledger as that role.
    await db.query('reset role')
    const m = MIGRATION_NAME.exec(file.name) as RegExpExecArray
    await db.query(`insert into ${LEDGER} (version, name, statements) values ($1, $2, $3)`, [m[1], m[2], [file.sql]])
    await db.query('commit')
  } catch (e) {
    await db.query('rollback').catch(() => undefined)
    throw e
  } finally {
    db.off('notice', onNotice)
  }
  return Math.round(performance.now() - started)
}

/**
 * Applies the pending files in order and records each. Throws before changing anything if the plan has
 * problems, and at the first file that fails (that file is rolled back; the earlier ones stay applied
 * and recorded, so the next run continues from there).
 */
export async function deploy(db: pg.Client, files: readonly SqlFile[], log: (line: string) => void = () => undefined): Promise<DeployResult> {
  await db.query('select pg_advisory_lock($1)', [LOCK_DEPLOY])
  try {
    const plan = planDeploy(files, await readLedger(db))
    if (plan.problems.length > 0) throw new Error(`not deploying:\n  ${plan.problems.join('\n  ')}`)
    if (plan.pending.length > 0) await ensureLedger(db)
    const applied: AppliedFile[] = []
    for (const file of plan.pending) {
      const ms = await applyFile(db, file)
      applied.push({ name: file.name, ms })
      log(`applied  ${file.name}  ${ms} ms`)
    }
    return { applied, skipped: plan.applied }
  } finally {
    await db.query('select pg_advisory_unlock($1)', [LOCK_DEPLOY]).catch(() => undefined)
  }
}
