/**
 * Scoring a quant response (M1.8, §8 response tuple): the typed entry is parsed exactly
 * (`numeric.ts`) and compared with the key under the item's stored tolerance. Unparseable entries
 * score 0. No partial credit: numeric entry is 2PL (A9).
 */

import type { ItemInstance, ItemScore } from '../family'
import { Fraction } from './fraction'
import type { QuantKey, QuantSpec } from './gen'
import { parseEntry, withinTolerance } from './numeric'

/** What the person typed. */
export type QuantResponse = string

export function scoreQuant(item: ItemInstance<QuantSpec, QuantKey>, response: QuantResponse): ItemScore {
  const entry = parseEntry(response)
  const target = Fraction.parseCanonical(item.key.value)
  if (entry === null || target === null) return { correct: 0 }
  return { correct: withinTolerance(entry, target, item.key.tol) ? 1 : 0 }
}
