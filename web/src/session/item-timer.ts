/**
 * The timer of the question on screen (owner feedback 2026-10-13; DESIGN §10, §13): what it reads
 * and when it warns. Pure; `ItemTimer.svelte` draws it and `SessionRun.itemTime()` supplies the
 * seconds. The limit itself is the item's (§13: max(180, 2.5 · E[T]), or the server's), unchanged.
 *
 * The owner, after a question ran out while they were checking a finished answer: "if we have a
 * timer and are going to time out questions if the test taker takes too long, then we should show
 * the timer". So every question that can run out of time shows how long is left, all the time, and
 * warns before it does: with words and a mark, not with colour alone, and announced once.
 */

import { ITEM_TIME_WARN_S } from './constants'

/** `m:ss` of the seconds left, rounded up: it reads 0:01 until the time is up, and never a negative time. */
export function timerText(leftS: number): string {
  const s = Number.isFinite(leftS) ? Math.max(0, Math.ceil(leftS)) : 0
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`
}

/** The seconds left at which a question of this limit starts to warn: {@link ITEM_TIME_WARN_S}, or a quarter of a short limit. */
export function warnAtS(limitS: number): number {
  if (!(Number.isFinite(limitS) && limitS > 0)) return ITEM_TIME_WARN_S
  return Math.min(ITEM_TIME_WARN_S, Math.ceil(limitS / 4))
}

/** Whether the timer is in its warning. */
export function timerWarns(leftS: number, limitS: number): boolean {
  return leftS <= warnAtS(limitS)
}

/** The seconds left as words, for a screen reader: "2 minutes 5 seconds", "1 minute", "45 seconds". */
export function timerSpoken(leftS: number): string {
  const s = Number.isFinite(leftS) ? Math.max(0, Math.ceil(leftS)) : 0
  const m = Math.floor(s / 60)
  const r = s % 60
  const mins = m === 0 ? '' : `${m} ${m === 1 ? 'minute' : 'minutes'}`
  const secs = r === 0 && m > 0 ? '' : `${r} ${r === 1 ? 'second' : 'seconds'}`
  return [mins, secs].filter((x) => x !== '').join(' ')
}
