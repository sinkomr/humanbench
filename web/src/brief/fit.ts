/**
 * The fit log (AI.7; proposal §3.6 item 1, ADR A20; requirement R-17.12): for each topic the person
 * can mark an explanation *too basic*, *about right* or *too much*. The rule looks at the last
 * four notes on the topic within 180 days: a net of +2 "too basic" suggests moving the topic up one
 * setting (build up, then ask first, then skip the basics), and a net of -2 suggests moving it down.
 * "About right" counts 0 but takes a slot, so it dilutes older marks. A topic without a setting
 * starts from "ask first", which makes the fit log a self-report route.
 *
 * The rule only *suggests*. The person's own setting always wins (precedence, A20), and their fit
 * notes "change only these suggestions; they never change your results" (`COPY.fitLog`). The fit log
 * never enters scoring, a likelihood, the blob or calibration: nothing here imports the engine, and
 * `save/brief-prefs.test.ts` checks that re-scoring reads none of it.
 *
 * Notes keep a month, not a day (proposal §5.5: no day-level timestamps), so "180 days" is read at
 * month granularity as the current month and the five before it. Within a month, notes order by
 * their id, whose first two hex digits count up as the month's notes are made (`newFitEntry`).
 * Pure: the current month and the random digits come in.
 */

import { MONTH_RE, type TopicId, type TopicSetting } from './types'

export const FIT_VERDICTS = ['too_basic', 'about_right', 'too_much'] as const
export type FitVerdict = (typeof FIT_VERDICTS)[number]

export interface FitEntry {
  /** Eight hex digits: the month's sequence number (two digits), then six random digits. */
  readonly id: string
  readonly topic: TopicId
  readonly verdict: FitVerdict
  /** `YYYY-MM`. */
  readonly month: string
}

/** How many of the latest notes on a topic the rule looks at. */
export const FIT_WINDOW = 4
/** "Within 180 days", at month granularity: this month and the five before it. */
export const FIT_MONTHS = 6
/** The net of "too basic" over "too much" that moves a suggestion one setting. */
export const FIT_NET = 2

/** Settings from the most help to the least: "up" (towards skipping the basics) is to the right. */
const HELP_ORDER: readonly TopicSetting[] = ['build', 'ask_first', 'skip']
/** The setting a topic starts from when the person has not set it. */
export const FIT_BASE: TopicSetting = 'ask_first'

export const FIT_ID_RE = /^[0-9a-f]{8}$/u

/** Whole months from `from` to `to` (both `YYYY-MM`); negative when `to` is earlier. */
export function monthsBetween(from: string, to: string): number {
  const f = Number(from.slice(0, 4)) * 12 + Number(from.slice(5, 7))
  const t = Number(to.slice(0, 4)) * 12 + Number(to.slice(5, 7))
  return t - f
}

/** Order of notes: month, then id (which counts up within a month). */
export const compareFit = (a: FitEntry, b: FitEntry): number => (a.month < b.month ? -1 : a.month > b.month ? 1 : a.id < b.id ? -1 : a.id > b.id ? 1 : 0)

/**
 * The notes the rule reads for a topic: within the last {@link FIT_MONTHS} months of `nowMonth`
 * (a note dated later than `nowMonth`, from a clock that was ahead, still counts as recent), the
 * latest {@link FIT_WINDOW} of them, oldest first.
 */
export function recentFit(log: readonly FitEntry[], topic: TopicId, nowMonth: string): FitEntry[] {
  return log
    .filter((f) => f.topic === topic && monthsBetween(f.month, nowMonth) < FIT_MONTHS)
    .sort(compareFit)
    .slice(-FIT_WINDOW)
}

/** "Too basic" counts +1, "too much" -1, "about right" 0. */
export function fitNet(entries: readonly FitEntry[]): number {
  return entries.reduce((n, f) => n + (f.verdict === 'too_basic' ? 1 : f.verdict === 'too_much' ? -1 : 0), 0)
}

/** `base` moved one setting by `net`: up at +2 or more, down at -2 or less, never past either end. */
export function fitShift(base: TopicSetting, net: number): TopicSetting {
  const i = HELP_ORDER.indexOf(base)
  const j = net >= FIT_NET ? Math.min(i + 1, HELP_ORDER.length - 1) : net <= -FIT_NET ? Math.max(i - 1, 0) : i
  return HELP_ORDER[j] as TopicSetting
}

export interface FitSuggestion {
  readonly topic: TopicId
  /** The setting the person has (or {@link FIT_BASE} when they have none). */
  readonly from: TopicSetting
  readonly to: TopicSetting
  readonly net: number
  /** The notes the suggestion rests on. */
  readonly used: readonly FitEntry[]
  /** True when the topic had no setting of its own. */
  readonly noSetting: boolean
}

/** The suggestion for a topic, or null when the rule leaves the setting where it is. */
export function fitSuggestion(log: readonly FitEntry[], topic: TopicId, own: TopicSetting | undefined, nowMonth: string): FitSuggestion | null {
  const used = recentFit(log, topic, nowMonth)
  const from = own ?? FIT_BASE
  const to = fitShift(from, fitNet(used))
  return to === from ? null : { topic, from, to, net: fitNet(used), used, noSetting: own === undefined }
}

/**
 * A new note. Its id starts with the number of notes already made in `month` (so notes of a month
 * sort in the order they were made), then `random` (six hex digits from the caller); the number
 * moves on until the id is unused.
 */
export function newFitEntry(log: readonly FitEntry[], topic: TopicId, verdict: FitVerdict, month: string, random: string): FitEntry {
  if (!MONTH_RE.test(month)) throw new RangeError(`newFitEntry: not a YYYY-MM month: ${JSON.stringify(month)}`)
  if (!/^[0-9a-f]{6}$/u.test(random)) throw new RangeError('newFitEntry: random must be six hex digits')
  const taken = new Set(log.map((f) => f.id))
  let seq = log.filter((f) => f.month === month).length % 256
  for (let tries = 0; tries < 256; tries++, seq = (seq + 1) % 256) {
    const id = `${seq.toString(16).padStart(2, '0')}${random}`
    if (!taken.has(id)) return { id, topic, verdict, month }
  }
  throw new RangeError('newFitEntry: no free id for this month')
}

/** Whether `x` is a well-formed note (the shape a save holds). */
export function isFitEntry(x: unknown): x is FitEntry {
  if (typeof x !== 'object' || x === null) return false
  const o = x as Record<string, unknown>
  return typeof o.id === 'string' && FIT_ID_RE.test(o.id) && typeof o.topic === 'string' && FIT_VERDICTS.includes(o.verdict as FitVerdict) && typeof o.month === 'string' && MONTH_RE.test(o.month)
}
