/**
 * Matrices scorer (DESIGN §8 response tuple): the response is the chosen option index, the
 * position in `spec.options` (display order, M1.13); correct iff it is the keyed index. A
 * response that is not an option index (out of range, non-integer, missing) throws a
 * `MalformedResponseError` (M1.F2).
 */

import { mcResponseIndex, type ItemScore } from '../family'
import type { MatrixResponse } from './grammar'
import type { MatrixItem } from './verify'

export function scoreMatrix(item: MatrixItem, response: MatrixResponse): ItemScore {
  return { correct: mcResponseIndex(item, response) === item.key.index ? 1 : 0 }
}
