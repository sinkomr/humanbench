/**
 * Matrices scorer (DESIGN §8 response tuple): the response is the chosen option index; correct
 * iff it is the keyed index. Anything else (out of range, non-integer, missing) scores 0.
 */

import type { ScoreResult } from '../family'
import type { MatrixResponse } from './grammar'
import type { MatrixItem } from './verify'

export function scoreMatrix(item: MatrixItem, response: MatrixResponse): ScoreResult {
  return { correct: Number.isInteger(response) && response === item.key.index ? 1 : 0 }
}
