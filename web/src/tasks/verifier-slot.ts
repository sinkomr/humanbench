/**
 * Where a family finds its verifier (ROADMAP A1, UX-100; DESIGN §4.2 G2/G3). Every family keeps `verify(item)` in its
 * contract (`family.ts`), but the code behind it is installed by `tasks/verifiers.ts`, which only the tests (vitest's
 * setup file), the TS dump for the bank (`scripts/dump-lib.ts`) and the dev review page import. So no production
 * chunk the session loads carries the verifiers: the session generates, keys and scores items and never verifies one.
 *
 * Only types are imported here, so this module costs the bundle nothing beyond its few lines.
 */

import type { verifyCoding } from './coding/verify'
import type { verifyMatrix } from './matrices/verify'
import type { quantVerifier, verifyQuant } from './quant/verify'
import type { verifyReading } from './reading/verify'
import type { verifyRotation } from './rotation/verify'
import type { verifyRt } from './rt/verify'
import type { verifySeries } from './series/verify'
import type { verifySpan } from './span/verify'

/** The verifier functions of the families, by family. */
export interface Verifiers {
  readonly coding: typeof verifyCoding
  readonly matrices: typeof verifyMatrix
  readonly quant: typeof verifyQuant
  readonly quantVerifier: typeof quantVerifier
  readonly reading: typeof verifyReading
  readonly rotation: typeof verifyRotation
  readonly rt: typeof verifyRt
  readonly series: typeof verifySeries
  readonly span: typeof verifySpan
}

let installed: Verifiers | null = null

/** Install the verifiers (`tasks/verifiers.ts` does, once). */
export function installVerifiers(v: Verifiers): void {
  installed = v
}

/** The installed verifiers; throws when nothing imported `tasks/verifiers.ts` (the session never does). */
export function verifiers(): Verifiers {
  if (installed === null) throw new Error('the family verifiers are not loaded: import "src/tasks/verifiers.ts" (the tests, the dump and the review page do)')
  return installed
}
