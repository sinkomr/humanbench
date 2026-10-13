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
import { specProtocol } from '../../tasks/span/score'

/** Pause before the first element of a sequence (ms). */
export const SPAN_LEAD_MS = 700
/** Pause between one trial's entry and the next sequence (ms). */
export const SPAN_PAUSE_MS = 1000

/** The protocol the spec records (a spec without `procedure` is a fixed 1.1.0 block). */
export function spanProtocol(spec: SpanSpec): SpanProtocol {
  return specProtocol(spec)
}

/** The target sequence of each trial: the stimuli, reversed for backward recall. */
export function spanTargets(spec: SpanSpec): number[][] {
  return spec.trials.map((t) => (spec.recall === 'backward' ? [...t].reverse() : [...t]))
}

/** Where the block stands after `responses` (the family's own state machine). */
export function spanNext(spec: SpanSpec, responses: readonly (readonly number[])[]): SpanStatus {
  return advanceSpan(spanProtocol(spec), spanTargets(spec), responses, spanSymbols(spec.task))
}

/**
 * Whether the trial the state machine gives next is a second attempt at a length (the reactive
 * procedure: the length's second sequence, shown only after a miss). The renderers say so in the
 * pause before it; that the first entry did not match is what the procedure itself tells.
 */
export function isSecondAttempt(spec: SpanSpec, status: SpanStatus): boolean {
  return !status.finished && spec.procedure === 'reactive' && status.trial % spec.trials_per_length !== 0
}

/** The sentence of the instructions that states the procedure, for sequences of digits or of blocks. */
export function spanRuleText(unit: 'digit' | 'block'): string {
  return `Each sequence is one ${unit} longer than the last. If your entry does not match, you get one more sequence of the same length, and after two that do not match at one length this task ends.`
}

/** What the pause before a trial says: a second attempt is named as one. */
export function spanPauseText(secondAttempt: boolean): string {
  return secondAttempt ? 'One more of the same length.' : 'Next sequence coming up.'
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
