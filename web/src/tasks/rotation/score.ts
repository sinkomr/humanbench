/**
 * Scorer of the mental-rotation family: the response is the chosen option index (§8 response
 * tuple). Anything but the key index, including a malformed response, scores 0.
 */

import type { ScoreResult } from '../family'
import type { RotationItem, RotationResponse } from './spec'

export function scoreRotation(item: RotationItem, response: RotationResponse): ScoreResult {
  return { correct: Number.isInteger(response) && response === item.key.index ? 1 : 0 }
}
