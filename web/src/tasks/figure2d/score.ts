/**
 * Scorer of the figure2d family: the response is the chosen option index (§8 response tuple), the position in
 * `spec.options` (display order, M1.13). The key index scores 1, any other index 0; a response that is not an option
 * index throws a `MalformedResponseError` (M1.F2).
 */

import { mcResponseIndex, type ItemScore } from '../family'
import type { Figure2dItem, Figure2dResponse } from './spec'

export function scoreFigure2d(item: Figure2dItem, response: Figure2dResponse): ItemScore {
  return { correct: mcResponseIndex(item, response) === item.key.index ? 1 : 0 }
}
