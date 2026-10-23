/**
 * Scoring a qdata response (§8 response tuple): the typed entry is parsed exactly with quant's
 * grammar (`quant/numeric.ts` `parseEntry`: "12.47", "$12.47", "1247/100", "25%", "−5" …) and
 * compared with the exact key under its tolerance `{ abs: 0 }`. Unparseable entries score 0; a
 * response that is not text throws a `MalformedResponseError` (M1.F2). No partial credit (2PL, A9).
 */

import { entryResponse, type ItemInstance, type ItemScore } from '../family'
import { Fraction } from '../quant/fraction'
import { parseEntry, withinTolerance } from '../quant/numeric'
import type { QdataKey } from './gen'
import type { QdataSpec } from './spec'

/** What the person typed. */
export type QdataResponse = string

export function scoreQdata(item: ItemInstance<QdataSpec, QdataKey>, response: QdataResponse): ItemScore {
  const entry = parseEntry(entryResponse(item, response, false) as string)
  const target = Fraction.parseCanonical(item.key.value)
  if (entry === null || target === null) return { correct: 0 }
  return { correct: withinTolerance(entry, target, item.key.tol) ? 1 : 0 }
}
