/**
 * Helpers for the `*.db.test.ts` files (ROADMAP M2.0). Importing this file needs the `db` vitest
 * project (`npm run test:db`), which starts the cluster these read from.
 */

import { inject } from 'vitest'
import { createTestDb, type TestDb } from './harness'

/**
 * A fresh database for this test file, from the run's template (or from the template of
 * `migrationsDir`, built on first use). Close it in `afterAll`.
 */
export function openTestDb(options: { readonly migrationsDir?: string } = {}): Promise<TestDb> {
  return createTestDb(inject('hbCluster'), options)
}

/** The SQLSTATE of a Postgres error, or undefined for anything else. */
export function pgCode(err: unknown): string | undefined {
  const code = (err as { code?: unknown } | null)?.code
  return typeof code === 'string' ? code : undefined
}

/** Resolves to the SQLSTATE the promise rejects with; throws if it resolves. `42501` is permission denied. */
export async function rejectedWith(promise: Promise<unknown>): Promise<string | undefined> {
  try {
    await promise
  } catch (e) {
    return pgCode(e)
  }
  throw new Error('expected the statement to fail, but it succeeded')
}

/** SQLSTATE: insufficient_privilege (no grant, or no EXECUTE). */
export const PERMISSION_DENIED = '42501'
/** SQLSTATE: undefined_function. */
export const UNDEFINED_FUNCTION = '42883'
/** SQLSTATE: undefined_table. */
export const UNDEFINED_TABLE = '42P01'
/** SQLSTATE: query_canceled (statement_timeout). */
export const QUERY_CANCELED = '57014'
