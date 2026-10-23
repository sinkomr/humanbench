/**
 * Scoring a syllogism response (§8 response tuple): the chosen option's display position against the key. A response
 * that is not an option index 0–4 throws a `MalformedResponseError` (M1.F2). Five options → 2PL (A9), no partial credit.
 */

import { mcResponseIndex, type ItemInstance, type ItemScore } from '../family'
import type { SyllogismKey, SyllogismResponse, SyllogismSpec } from './spec'

export function scoreSyllogism(item: ItemInstance<SyllogismSpec, SyllogismKey>, response: SyllogismResponse): ItemScore {
  return { correct: mcResponseIndex(item, response) === item.key.index ? 1 : 0 }
}
