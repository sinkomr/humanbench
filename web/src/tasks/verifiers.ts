/**
 * The families' verifiers, installed for `family.verify(item)` (`verifier-slot.ts`). Imported by vitest's setup file,
 * `scripts/dump-lib.ts` (the TS dumps the bank cross-checks, A1) and the dev review page; never by the app's session
 * code, so they stay out of every production chunk the session loads (`scripts/results-split.test.ts`).
 */

import { verifyCoding } from './coding/verify'
import { verifyCubenet } from './cubenet/verify'
import { verifyFigure2d } from './figure2d/verify'
import { verifyFolding } from './folding/verify'
import { verifyMatrix } from './matrices/verify'
import { verifyQdata } from './qdata/verify'
import { quantVerifier, verifyQuant } from './quant/verify'
import { verifyReading } from './reading/verify'
import { verifyRotation } from './rotation/verify'
import { verifyRt } from './rt/verify'
import { verifySeries } from './series/verify'
import { verifySpan } from './span/verify'
import { verifySyllogism } from './syllogism/verify'
import { installVerifiers } from './verifier-slot'

installVerifiers({
  coding: verifyCoding,
  cubenet: verifyCubenet,
  figure2d: verifyFigure2d,
  folding: verifyFolding,
  matrices: verifyMatrix,
  qdata: verifyQdata,
  quant: verifyQuant,
  quantVerifier,
  reading: verifyReading,
  rotation: verifyRotation,
  rt: verifyRt,
  series: verifySeries,
  span: verifySpan,
  syllogism: verifySyllogism,
})
