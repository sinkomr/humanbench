/**
 * What the span renderers need from a span spec (ROADMAP M1.9, M1.13, A10; DESIGN §14.6 ex.
 * 10–11): the block protocol, the per-trial target sequences (the stimuli, reversed for backward
 * recall, which the spec carries by design: `tasks/span/config.ts`), the next step of the family's
 * state machine (`advanceSpan`, the same function `score()` runs), and keyboard navigation on the
 * fixed Corsi board. The renderers keep the targets in memory only, to run the protocol; they are
 * never written to the DOM.
 */

import { spanSymbols, type BoardPoint, type SpanSpec } from '../../tasks/span/config'
import { advanceSpan, type SpanProtocol, type SpanStatus } from '../../tasks/span/protocol'

/** Pause before the first element of a sequence (ms). */
export const SPAN_LEAD_MS = 700
/** Pause between one trial's entry and the next sequence (ms). */
export const SPAN_PAUSE_MS = 1000

export function spanProtocol(spec: SpanSpec): SpanProtocol {
  return { start_length: spec.start_length, trials_per_length: spec.trials_per_length, max_length: spec.max_length }
}

/** The target sequence of each trial: the stimuli, reversed for backward recall. */
export function spanTargets(spec: SpanSpec): number[][] {
  return spec.trials.map((t) => (spec.recall === 'backward' ? [...t].reverse() : [...t]))
}

/** Where the block stands after `responses` (the family's own state machine). */
export function spanNext(spec: SpanSpec, responses: readonly (readonly number[])[]): SpanStatus {
  return advanceSpan(spanProtocol(spec), spanTargets(spec), responses, spanSymbols(spec.task))
}

export type Direction = 'left' | 'right' | 'up' | 'down'

const DIRS: Readonly<Record<Direction, readonly [number, number]>> = {
  left: [-1, 0],
  right: [1, 0],
  up: [0, -1],
  down: [0, 1],
}

/**
 * Arrow-key navigation on the Corsi board (§13 keyboard): the block nearest to `from` in the
 * direction pressed, scoring distance along the direction plus twice the sideways offset; `from`
 * itself when nothing lies that way.
 */
export function nearestInDirection(blocks: readonly BoardPoint[], from: number, dir: Direction): number {
  const origin = blocks[from]
  if (!origin) return from
  const [dx, dy] = DIRS[dir]
  let best = from
  let bestScore = Infinity
  blocks.forEach(([x, y], i) => {
    if (i === from) return
    const along = (x - origin[0]) * dx + (y - origin[1]) * dy
    if (along <= 1e-9) return
    const side = Math.abs((x - origin[0]) * dy - (y - origin[1]) * dx)
    const score = along + 2 * side
    if (score < bestScore) {
      bestScore = score
      best = i
    }
  })
  return best
}

/** Direction of an arrow key, or null. */
export function directionOfKey(key: string): Direction | null {
  switch (key) {
    case 'ArrowLeft':
      return 'left'
    case 'ArrowRight':
      return 'right'
    case 'ArrowUp':
      return 'up'
    case 'ArrowDown':
      return 'down'
    default:
      return null
  }
}
