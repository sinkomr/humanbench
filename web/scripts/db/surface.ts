/**
 * What an API role can reach in a database: the catalog-level question behind the M2.4 tests
 * ("anon cannot select any table", "anon can EXECUTE only whitelisted RPCs"; DESIGN §14.3 M2
 * acceptance 1). It asks Postgres (`has_*_privilege`) rather than trying each statement, so it
 * also sees privileges a query would only hit at run time, and it needs no row data.
 */

import type { ApiRole, TestDb } from './harness'

export interface TableAccess {
  readonly schema: string
  readonly name: string
  /** `r` table, `p` partitioned table, `v` view, `m` materialized view, `f` foreign table. */
  readonly kind: string
  /**
   * Privileges the role holds on the table: a table-level grant or, for select/insert/update/
   * references, a grant on at least one column. Lower case, in a fixed order.
   */
  readonly privileges: readonly string[]
  readonly rowSecurity: boolean
  readonly forceRowSecurity: boolean
}

export interface SequenceAccess {
  readonly schema: string
  readonly name: string
  readonly privileges: readonly string[]
}

export interface FunctionAccess {
  readonly schema: string
  readonly name: string
  /** `pg_get_function_identity_arguments`, e.g. `p_device jsonb, p_save jsonb`. */
  readonly args: string
  readonly securityDefiner: boolean
}

export interface Surface {
  /** Relations on which the role holds at least one privilege. */
  readonly tables: readonly TableAccess[]
  readonly sequences: readonly SequenceAccess[]
  /** Functions and procedures the role may EXECUTE (extension members excluded). */
  readonly functions: readonly FunctionAccess[]
}

/** `schema.name`, as a list for assertions. */
export const names = (xs: readonly { readonly schema: string; readonly name: string }[]): string[] => xs.map((x) => `${x.schema}.${x.name}`)

/**
 * Everything `role` can touch in `schemas` (default: `public`, the only schema PostgREST exposes).
 * Rows are the ones with at least one privilege, ordered by schema and name.
 */
export async function exposedSurface(db: TestDb, role: ApiRole, schemas: readonly string[] = ['public']): Promise<Surface> {
  const tables = await db.owner.query<{ schema: string; name: string; kind: string; privileges: string[]; rls: boolean; force_rls: boolean }>(
    `select n.nspname as schema, c.relname as name, c.relkind::text as kind,
            array_remove(array[
              case when has_any_column_privilege($1, c.oid, 'SELECT') then 'select' end,
              case when has_any_column_privilege($1, c.oid, 'INSERT') then 'insert' end,
              case when has_any_column_privilege($1, c.oid, 'UPDATE') then 'update' end,
              case when has_table_privilege($1, c.oid, 'DELETE') then 'delete' end,
              case when has_table_privilege($1, c.oid, 'TRUNCATE') then 'truncate' end,
              case when has_any_column_privilege($1, c.oid, 'REFERENCES') then 'references' end,
              case when has_table_privilege($1, c.oid, 'TRIGGER') then 'trigger' end
            ], null) as privileges,
            c.relrowsecurity as rls, c.relforcerowsecurity as force_rls
       from pg_class c join pg_namespace n on n.oid = c.relnamespace
      where n.nspname = any($2) and c.relkind in ('r', 'p', 'v', 'm', 'f')
      order by 1, 2`,
    [role, schemas],
  )
  const sequences = await db.owner.query<{ schema: string; name: string; privileges: string[] }>(
    `select n.nspname as schema, c.relname as name,
            array_remove(array[
              case when has_sequence_privilege($1, c.oid, 'USAGE') then 'usage' end,
              case when has_sequence_privilege($1, c.oid, 'SELECT') then 'select' end,
              case when has_sequence_privilege($1, c.oid, 'UPDATE') then 'update' end
            ], null) as privileges
       from pg_class c join pg_namespace n on n.oid = c.relnamespace
      where n.nspname = any($2) and c.relkind = 'S'
      order by 1, 2`,
    [role, schemas],
  )
  const functions = await db.owner.query<{ schema: string; name: string; args: string; definer: boolean }>(
    `select n.nspname as schema, p.proname as name, pg_get_function_identity_arguments(p.oid) as args, p.prosecdef as definer
       from pg_proc p join pg_namespace n on n.oid = p.pronamespace
      where n.nspname = any($2) and p.prokind in ('f', 'p')
        and has_function_privilege($1, p.oid, 'EXECUTE')
        and not exists (select 1 from pg_depend d where d.objid = p.oid and d.deptype = 'e')
      order by 1, 2, 3`,
    [role, schemas],
  )
  return {
    tables: tables.rows
      .filter((r) => r.privileges.length > 0)
      .map((r) => ({ schema: r.schema, name: r.name, kind: r.kind, privileges: r.privileges, rowSecurity: r.rls, forceRowSecurity: r.force_rls })),
    sequences: sequences.rows.filter((r) => r.privileges.length > 0),
    functions: functions.rows.map((r) => ({ schema: r.schema, name: r.name, args: r.args, securityDefiner: r.definer })),
  }
}
