/**
 * Reading the SQL the local database is built from (ROADMAP M2.0): the Supabase shim under
 * `supabase/local/` and the migrations under `supabase/migrations/`. Pure file reading and
 * validation, no database, so `sql.test.ts` runs in the plain `npm test`.
 */

import { createHash } from 'node:crypto'
import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

/** The repo's `supabase/` directory (DESIGN §14.1). */
export const SUPABASE_DIR = fileURLToPath(new URL('../../../supabase/', import.meta.url))
/** The migrations M2.1 onward add; applied in file-name order, as the Supabase CLI does. */
export const MIGRATIONS_DIR = join(SUPABASE_DIR, 'migrations')
/** Cluster-wide shim files (roles), run once per cluster as the cluster superuser. */
export const SHIM_CLUSTER_DIR = join(SUPABASE_DIR, 'local', 'cluster')
/** Per-database shim files (extensions, default grants, auth, Vault), run in the template database. */
export const SHIM_DATABASE_DIR = join(SUPABASE_DIR, 'local', 'database')

export interface SqlFile {
  /** File name, e.g. `20260930120000_schema.sql`. */
  readonly name: string
  readonly sql: string
}

/**
 * The Supabase CLI's migration name is `<timestamp>_<name>.sql`; it skips other files with a
 * warning. This is stricter on purpose: the 14-digit `YYYYMMDDHHMMSS` form the CLI generates and a
 * snake_case name, so a typo fails here instead of being skipped on a deploy.
 */
export const MIGRATION_NAME = /^(\d{14})_([a-z][a-z0-9_]*)\.sql$/

/** `.sql` files of a shim directory in name order (`00-…`, `10-…`). Missing directory: none. */
export function readShimFiles(dir: string): SqlFile[] {
  if (!existsSync(dir)) return []
  return readdirSync(dir)
    .filter((n) => n.endsWith('.sql'))
    .sort()
    .map((name) => ({ name, sql: readFileSync(join(dir, name), 'utf8') }))
}

/**
 * The migrations of `dir` in application order. A missing or empty directory is fine (M2.0 ships
 * none). Dotfiles (`.gitkeep`) are ignored; any other file that is not a well-formed
 * `<14 digits>_<snake_case>.sql`, or a version used twice, is an error naming the file.
 */
export function readMigrations(dir: string = MIGRATIONS_DIR): SqlFile[] {
  if (!existsSync(dir)) return []
  const names = readdirSync(dir)
    .filter((n) => !n.startsWith('.'))
    .sort()
  const seen = new Map<string, string>()
  for (const name of names) {
    const m = MIGRATION_NAME.exec(name)
    if (m === null) {
      throw new Error(
        `${dir}/${name}: not a migration file name. Expected <YYYYMMDDHHMMSS>_<snake_case_name>.sql; ` +
          'only migrations belong in this directory (the Supabase CLI would skip it with a warning).',
      )
    }
    const version = m[1] as string
    const other = seen.get(version)
    if (other !== undefined) throw new Error(`${dir}: migrations ${other} and ${name} share the version ${version}.`)
    seen.set(version, name)
  }
  return names.map((name) => ({ name, sql: readFileSync(join(dir, name), 'utf8') }))
}

/**
 * A short content hash of everything a template database is built from, so the template is rebuilt
 * exactly when a shim file or a migration changes, and a template built from other files is never
 * reused. The password is not part of it: it lives on roles, not in the template.
 */
export function templateDigest(parts: { readonly cluster: readonly SqlFile[]; readonly database: readonly SqlFile[]; readonly migrations: readonly SqlFile[] }): string {
  const h = createHash('sha256')
  for (const [label, files] of [['cluster', parts.cluster], ['database', parts.database], ['migrations', parts.migrations]] as const) {
    h.update(`${label}\0${files.length}\0`)
    for (const f of files) h.update(`${f.name}\0${f.sql.length}\0${f.sql}\0`)
  }
  return h.digest('hex').slice(0, 12)
}

/** A double-quoted SQL identifier. */
export function quoteIdent(name: string): string {
  return `"${name.replace(/"/g, '""')}"`
}

export interface RpcParam {
  readonly name: string
  /** `format_type()` of the parameter, e.g. `jsonb`, `text[]`, `timestamp with time zone`. */
  readonly type: string
}

/**
 * The statement that calls an RPC the way PostgREST does: the JSON body is ONE parameter,
 * `json_to_record` turns it into typed values (so a JSON array becomes a `text[]`, an object a
 * `jsonb`), and only the arguments the caller sent are passed, by name, so SQL defaults apply to
 * the rest. The result is one `result` column per row: the scalar for a scalar function, the row
 * as an object for a table or composite function, NULL for `void`.
 */
export function rpcCallSql(
  schema: string,
  fn: string,
  params: readonly RpcParam[],
  supplied: readonly string[],
  returns: { readonly type: string },
): string {
  const call = `${quoteIdent(schema)}.${quoteIdent(fn)}`
  const result = returns.type === 'void' ? 'null::jsonb' : 'to_jsonb(f)'
  if (supplied.length === 0) return `select ${result} as result from ${call}() as f`
  const byName = new Map(params.map((p) => [p.name, p.type]))
  for (const k of supplied) {
    if (!byName.has(k)) throw new Error(`rpc ${schema}.${fn}: no parameter "${k}" (it has: ${[...byName.keys()].join(', ') || 'none'})`)
  }
  const columns = supplied.map((k) => `${quoteIdent(k)} ${byName.get(k) as string}`).join(', ')
  const args = supplied.map((k) => `${quoteIdent(k)} := _args.${quoteIdent(k)}`).join(', ')
  return `select ${result} as result from json_to_record($1::json) as _args(${columns}), lateral ${call}(${args}) as f`
}
