/**
 * `npm run sim:session -- [--n 200] [--offset 0] [--skip none|MAT|SPA|…] [--interstitial-s 0]
 * [--target-min 27.5] [--mode static|online] [--text none|all|LR,VOC,…] [--pace 1] [--timeout-p 0]
 * [--json <file>]` (UX-066, DESIGN §7.4, §10, A15, M3.11): whole sessions of the real
 * session machine (`session/run.ts`) driven by the simulated taker of `session/bot.ts`, so the
 * clock rules, the break, the part budgets and the coverage floor are the ones the app runs (the
 * M1.4b `sim:cat` models the CAT budget on its own and does not skip). Each simulee has θ ~ N(0, I)
 * and block times 1–1.6× their model time; `--skip` skips that skill at its "Up next" screen.
 *
 * Prints, and with `--json` writes, the mean active session length, the mean active time of each
 * part, the "About N min" each CAT part showed on its interstitial, the QR coverage-floor misses
 * (fewer than 3 QR items in a session that reached Quant), and where the break was offered; and,
 * for the limits (A15 amendment 2026-10-12: Quant's six questions, the 60-minute ceiling), the
 * questions shown and answered per skill (least, median, most), the share of sessions with at
 * least five answered Quantitative questions (what the server publishes a skill from), the
 * session length (median, 95th percentile, longest) and the share that reached the hard stop.
 *
 * `--mode online` plays the online version against a stand-in server ({@link SimServer}): the three
 * served parts get the questions the selector would pick, and `--text` (which implies it) adds the
 * text parts, with made-up questions timed at the bank's expected times ({@link TEXT_ITEM_S}).
 * `--pace` multiplies every time the taker spends (1.5: a slow taker); `--timeout-p` is the chance
 * that a question is left to run out of time.
 */

import { writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { toServedItem, type ServedItem } from '../src/backend/items'
import type { CatAnswer, CatNext, CatSource } from '../src/backend/session'
import { AXIS_INDEX, N_AXES, isAxisCode, type AxisCode } from '../src/engine/axes'
import { PUBLISH_MIN_ITEMS, SEGMENT_ORDER, TEXT_AXES, isTextAxis, type TextAxis } from '../src/engine/plan-table'
import { createRng, type Rng } from '../src/engine/prng'
import type { Observation } from '../src/engine/types'
import { A15_TARGET_S, selectNext, selectionRng, sessionPosterior, type AnyItem, type SegmentId } from '../src/engine/selector'
import { demoTextItem } from '../src/render/text/demo'
import { demoPassage, demoPassagePayload } from '../src/render/text/demo-passage'
import { Bot } from '../src/session/bot'
import { HARD_STOP_S } from '../src/session/constants'
import type { RunView } from '../src/session/run'
import { answerItem, itemObservation } from '../src/sim/responders'
import { getFamily, resolveItem } from '../src/tasks/registry'
import { UsageError } from './dump-lib'

export interface SimSessionArgs {
  readonly n: number
  readonly offset: number
  readonly skip: AxisCode | null
  readonly interstitialS: number
  readonly targetS: number
  /** 'online': the served parts come from a stand-in server. Default 'static' (the device-only version). */
  readonly mode?: 'static' | 'online'
  /** The text parts asked for (online only). Default none. */
  readonly text?: readonly TextAxis[]
  /** Multiplier on every time the taker spends: blocks, questions, the confidence slider. Default 1. */
  readonly pace?: number
  /** Chance that a question is left to run out of time. Default 0. */
  readonly timeoutP?: number
  readonly json?: string
}

/** Seconds a taker at the model's pace spends on a text question: the bank's expected times (`plan-table.ts`, "The shares"). For RC, on a question once the passage is read. */
export const TEXT_ITEM_S: Readonly<Record<TextAxis, number>> = Object.freeze({ LR: 60, RC: 45, VOC: 15, KST: 20, KHU: 20, KAP: 20 })

/**
 * Seconds a taker at the model's pace spends reading a passage before its first question: about 325 words (the
 * middle of DESIGN §3's 200 to 450) at 200 words a minute, a careful reading pace.
 */
export const PASSAGE_READING_S = 100

/** Questions of the stand-in server's made-up passage number `p` (0-based): 3 and 4 in turn, as the bank's passages have. */
export const simPassageQuestions = (p: number): number => 3 + (p % 2)

export function parseSimSessionArgs(argv: readonly string[], cwd: string): SimSessionArgs {
  let n = 200
  let offset = 0
  let skip: AxisCode | null = null
  let interstitialS = 0
  let targetS = A15_TARGET_S
  let json: string | undefined
  let mode: 'static' | 'online' | undefined
  let text: TextAxis[] | undefined
  let pace: number | undefined
  let timeoutP: number | undefined
  const args = argv[0] === '--' ? argv.slice(1) : argv
  for (let i = 0; i < args.length; i++) {
    const flag = args[i]
    const value = args[i + 1]
    if (value === undefined) throw new UsageError(`${flag ?? ''} needs a value`)
    i++
    switch (flag) {
      case '--n':
        n = Number(value)
        break
      case '--offset':
        offset = Number(value)
        break
      case '--skip':
        if (value === 'none') skip = null
        else if (isAxisCode(value)) skip = value
        else throw new UsageError(`--skip: not a skill code: ${value}`)
        break
      case '--interstitial-s':
        interstitialS = Number(value)
        break
      case '--target-min':
        targetS = Number(value) * 60
        break
      case '--mode':
        if (value !== 'static' && value !== 'online') throw new UsageError(`--mode: static or online, not ${value}`)
        mode = value
        break
      case '--text':
        if (value === 'none') text = []
        else if (value === 'all') text = [...TEXT_AXES]
        else {
          const codes = value.split(',')
          if (!codes.every(isTextAxis)) throw new UsageError(`--text: none, all, or text skill codes (${TEXT_AXES.join(', ')}), not ${value}`)
          text = TEXT_AXES.filter((k) => codes.includes(k))
        }
        break
      case '--pace':
        pace = Number(value)
        break
      case '--timeout-p':
        timeoutP = Number(value)
        break
      case '--json':
        json = resolve(cwd, value)
        break
      default:
        throw new UsageError(`unknown flag ${flag ?? ''}`)
    }
  }
  if (!(Number.isInteger(n) && n > 0) || !(Number.isInteger(offset) && offset >= 0)) throw new UsageError('--n and --offset are whole numbers')
  if (!(interstitialS >= 0) || !(targetS > 0)) throw new UsageError('--interstitial-s ≥ 0 and --target-min > 0')
  if (pace !== undefined && !(pace > 0)) throw new UsageError('--pace > 0')
  if (timeoutP !== undefined && !(timeoutP >= 0 && timeoutP <= 1)) throw new UsageError('--timeout-p is between 0 and 1')
  if (text !== undefined && text.length > 0) {
    if (mode === 'static') throw new UsageError('--text needs --mode online: the device-only version has no text parts')
    mode = 'online'
  }
  return {
    n,
    offset,
    skip,
    interstitialS,
    targetS,
    ...(mode === undefined ? {} : { mode }),
    ...(text === undefined || text.length === 0 ? {} : { text }),
    ...(pace === undefined ? {} : { pace }),
    ...(timeoutP === undefined ? {} : { timeoutP }),
    ...(json === undefined ? {} : { json }),
  }
}

export interface SimSessionOne {
  readonly durationS: number
  readonly ended: string | null
  /** Active seconds per part that ran. */
  readonly partS: Partial<Record<SegmentId, number>>
  /** "About N min" of each part's interstitial, as shown. */
  readonly aboutMin: Partial<Record<SegmentId, number>>
  readonly qrItems: number
  /** Questions shown per skill (answered or timed out). */
  readonly shown: Partial<Record<AxisCode, number>>
  /** Questions answered per skill. */
  readonly answered: Partial<Record<AxisCode, number>>
  readonly reachedQuant: boolean
  /** The part whose interstitial came right after the break offer, or null. */
  readonly breakBefore: SegmentId | null
  readonly breakAtS: number | null
  readonly breakOffers: number
}

/**
 * A stand-in for the server of the online version: one pending question at a time, as `hb.serve_next`
 * has. For the three served parts of A15 it picks what the selector would (the server's rule is the
 * same criterion, and like it this stops a skill only when it is precise enough or has nothing left:
 * the time is the client's); for a text skill it hands out made-up questions without end; and for Reading
 * Comprehension made-up passages, each with its questions one after the other and their place in the set,
 * as the server's set rule does (a call for another skill leaves the passage).
 */
export class SimServer implements CatSource {
  readonly sessionId: string
  readonly #seed: string
  readonly #administered: AnyItem[] = []
  readonly #obs: Observation[] = []
  #pending: { served: ServedItem; item: AnyItem | null } | null = null
  #seq = 0
  /** The passage under way: its number and how many of its questions have been served. */
  #set: { passage: number; served: number } | null = null
  #passages = 0

  constructor(seed: string) {
    this.#seed = seed
    this.sessionId = 's_SIMSERVER0000001'
  }

  next(axes: readonly AxisCode[]): Promise<CatNext> {
    if (this.#pending !== null) return Promise.resolve({ kind: 'item', item: this.#pending.served })
    const axis = axes[0]
    if (axis === undefined) return Promise.resolve({ kind: 'done', reason: 'no_items' })
    const seq = ++this.#seq
    if (axis !== 'RC') this.#set = null
    if (axis === 'RC') {
      if (this.#set === null || this.#set.served >= simPassageQuestions(this.#set.passage)) this.#set = { passage: this.#passages++, served: 0 }
      const set = this.#set
      const of = simPassageQuestions(set.passage)
      const demo = demoPassage(set.passage)
      // The demo's text with the passage's number in it, so two passages of a session are two texts.
      const payload = demoPassagePayload(demo, set.served % demo.questions.length)
      const media = { ...payload.media, passage: [`Made-up passage ${set.passage + 1} of this simulated session.`, ...payload.media.passage] }
      const served = toServedItem(seq, { itemId: `i:sim:rc:${seq}`, itemType: 'mc_passage', timeLimitS: set.served === 0 ? 360 : 180, stem: payload.stem, media, options: payload.options }, { index: set.served + 1, of })
      set.served++
      this.#pending = { served, item: null }
      return Promise.resolve({ kind: 'item', item: served })
    }
    if (isTextAxis(axis)) {
      const demo = demoTextItem(seq)
      const served = toServedItem(seq, { itemId: `i:sim:${axis.toLowerCase()}:${seq}`, itemType: 'mc_text', timeLimitS: 180, stem: demo.payload.stem, media: null, options: demo.payload.options })
      this.#pending = { served, item: null }
      return Promise.resolve({ kind: 'item', item: served })
    }
    const sel = selectNext(
      { sessionSeed: this.#seed, posterior: sessionPosterior(this.#obs), administered: this.#administered, seenFamilies: [], remainingS: 1e9 },
      selectionRng(this.#seed, this.#administered.length),
      { axes },
    )
    if (sel.kind === 'none') return Promise.resolve({ kind: 'done', reason: sel.reason === 'axes_done' ? 'axes_done' : 'no_items' })
    const item = sel.item
    const count = item.options_count === undefined ? {} : { options_count: item.options_count }
    const served: ServedItem = { seq, item_id: item.item_id, item_type: item.item_type, family: item.family, spec: {}, ...count, time_limit_s: item.time_limit_s ?? null, supported: true }
    this.#pending = { served, item }
    return Promise.resolve({ kind: 'item', item: served })
  }

  answer(a: CatAnswer): Promise<void> {
    const p = this.#pending
    if (p === null || p.served.item_id !== a.item.item_id) return Promise.resolve()
    this.#pending = null
    if (p.item === null) return Promise.resolve()
    this.#administered.push(p.item)
    if (a.release !== undefined) return Promise.resolve()
    const family = getFamily(p.item.family)!
    const correct = a.response === null ? 0 : (family.score(p.item as never, a.response as never) as { correct: 0 | 1 | null }).correct
    if (correct !== null) this.#obs.push(itemObservation(p.item, correct))
    return Promise.resolve()
  }
}

/** One simulated session and what the report needs of it, in either mode. */
class SimDriver {
  readonly bot: Bot
  readonly partS: Partial<Record<SegmentId, number>> = {}
  readonly aboutMin: Partial<Record<SegmentId, number>> = {}
  breakBefore: SegmentId | null = null
  breakAtS: number | null = null
  breakOffers = 0
  reachedQuant = false
  finished = false
  #open: { id: SegmentId; at: number } | null = null
  #afterOffer = false
  readonly #theta: readonly number[]
  readonly #pace: number
  readonly #timeoutP: number
  readonly #timeouts: Rng
  readonly #answers: Rng

  constructor(
    i: number,
    readonly args: SimSessionArgs,
  ) {
    const rng = createRng(`sim-session:${i}`)
    this.#theta = Array.from({ length: N_AXES }, () => rng.normal())
    this.#pace = args.pace ?? 1
    this.#timeoutP = args.timeoutP ?? 0
    this.#timeouts = createRng(`sim-session:timeouts:${i}`)
    this.#answers = createRng(`sim-session:answers:${i}`)
    const sessionId = `s_SIMSESS${String(i).padStart(8, '0')}`
    const online = args.mode === 'online' ? { cat: new SimServer(sessionId), textAxes: args.text ?? [] } : {}
    this.bot = new Bot(
      { sessionId, ...(args.targetS === A15_TARGET_S ? {} : { targetS: args.targetS }), ...online },
      { theta: this.#theta, blockScale: (1 + 0.6 * rng.next()) * this.#pace, itemScale: this.#pace, confidenceS: 2 * this.#pace, interstitialS: args.interstitialS },
    )
  }

  /** A question is on screen: a time-out by chance, else an answer after the taker's time for it. */
  #question(v: RunView): void {
    const bot = this.bot
    const it = v.item!
    if (this.#timeoutP > 0 && this.#timeouts.next() < this.#timeoutP) {
      bot.run.itemShown(bot.t)
      bot.wait((it.time_limit_s ?? 180) + 1)
      bot.run.tick()
      return
    }
    if (this.args.mode !== 'online') {
      bot.step()
      return
    }
    bot.run.itemShown(bot.t)
    const item = resolveItem(it.item_id)
    if (item === null) {
      // A made-up text question: the server holds the key, so any option is an answer. The first question of a
      // passage comes after the reading.
      const reading = v.passage !== null && v.passage.position?.index === 1 ? PASSAGE_READING_S : 0
      bot.wait((reading + (isTextAxis(it.axis) ? TEXT_ITEM_S[it.axis] : 40)) * this.#pace)
      bot.run.itemResponded(0)
      return
    }
    bot.wait(item.expected_time_s * this.#pace)
    bot.run.itemResponded(answerItem(getFamily(item.family)!, item, this.#theta[AXIS_INDEX[it.axis]] ?? 0, this.#answers.fork(`item/${it.item_id}`)).response)
  }

  /** One thing the taker does. Returns 'wait' when the run is waiting for the server (online only). */
  step(): 'go' | 'wait' | 'end' {
    const { bot, args } = this
    bot.run.tick()
    const v = bot.view()
    if (v.phase === 'interstitial' || v.phase === 'finished' || v.phase === 'break_offer') {
      if (this.#open !== null) {
        this.partS[this.#open.id] = (this.partS[this.#open.id] ?? 0) + (v.elapsedS - this.#open.at)
        this.#open = null
      }
    }
    if (v.phase === 'finished') {
      this.finished = true
      return 'end'
    }
    if (v.phase === 'loading') {
      if (v.problem !== null) throw new Error(`the wait for the stand-in server failed: ${v.problem}`)
      return 'wait'
    }
    if (v.phase === 'break_offer') {
      this.breakOffers++
      this.breakAtS = v.elapsedS
      this.#afterOffer = true
    }
    if (v.phase === 'interstitial' && v.segment !== null) {
      if (this.#afterOffer) {
        this.breakBefore = v.segment.id
        this.#afterOffer = false
      }
      if (v.segment.id === 'quant') this.reachedQuant = true
      if (this.aboutMin[v.segment.id] === undefined) this.aboutMin[v.segment.id] = v.segment.minutes
      if (args.skip !== null && v.segment.axes.includes(args.skip) && !v.skipped.includes(args.skip)) {
        bot.wait(args.interstitialS)
        bot.run.skipAxis(args.skip)
        return 'go'
      }
      // The bot waits on the interstitial, then starts: the part's active time begins at Start.
      bot.wait(args.interstitialS)
      this.#open = { id: v.segment.id, at: bot.run.elapsedS() }
      bot.run.startSegment()
      return 'go'
    }
    if (v.phase === 'item') this.#question(v)
    else bot.step()
    return 'go'
  }

  /** The questions that got an answer, per skill, from what the run recorded (a time-out is recorded without one). */
  #answered(): Partial<Record<AxisCode, number>> {
    const out: Partial<Record<AxisCode, number>> = {}
    const run = this.bot.run
    for (const t of [...run.sessionState().responses, ...(run.catSessionState()?.responses ?? [])]) {
      if (t[2] === null) continue
      const id = String(t[0])
      const made = /^i:sim:([a-z]+):/u.exec(id)?.[1]?.toUpperCase()
      const item = made === undefined ? resolveItem(id) : null
      const axis = made !== undefined && isAxisCode(made) ? made : item !== null && getFamily(item.family)?.kind === 'item' ? item.axis : null
      if (axis !== null) out[axis] = (out[axis] ?? 0) + 1
    }
    return out
  }

  result(): SimSessionOne {
    if (!this.finished) throw new Error(`the simulated session did not finish (phase ${this.bot.run.phase})`)
    const v = this.bot.view()
    const shown = this.bot.run.result().itemsByAxis
    return {
      durationS: v.elapsedS,
      ended: v.ended,
      partS: this.partS,
      aboutMin: this.aboutMin,
      qrItems: shown.QR ?? 0,
      shown,
      answered: this.#answered(),
      reachedQuant: this.reachedQuant,
      breakBefore: this.breakBefore,
      breakAtS: this.breakAtS,
      breakOffers: this.breakOffers,
    }
  }
}

const MAX_STEPS = 12000

/** One session of the device-only version. */
export function simulateOne(i: number, args: SimSessionArgs): SimSessionOne {
  if (args.mode === 'online') throw new RangeError('an online session waits for its server: use simulateOneOnline')
  const d = new SimDriver(i, args)
  for (let step = 0; step < MAX_STEPS && d.step() !== 'end'; step++);
  return d.result()
}

/** One session of the online version against {@link SimServer}. */
export async function simulateOneOnline(i: number, args: SimSessionArgs): Promise<SimSessionOne> {
  const d = new SimDriver(i, { ...args, mode: 'online' })
  for (let step = 0; step < MAX_STEPS; step++) {
    const r = d.step()
    if (r === 'end') break
    // The stand-in server answers at once; its answer and the run's handling of it are promise callbacks.
    for (let k = 0; k < 20; k++) await Promise.resolve()
  }
  return d.result()
}

const mean = (xs: readonly number[]): number => (xs.length === 0 ? Number.NaN : xs.reduce((s, x) => s + x, 0) / xs.length)
const round2 = (x: number): number => Math.round(x * 100) / 100

/** The q-quantile of `xs` by the nearest rank (q = 0.5: the lower median of an even count). */
export function quantile(xs: readonly number[], q: number): number {
  if (xs.length === 0) return Number.NaN
  const sorted = [...xs].sort((a, b) => a - b)
  return sorted[Math.min(sorted.length - 1, Math.max(0, Math.ceil(q * sorted.length) - 1))]!
}

/** Least, median and most of a count over the sessions. */
export interface CountSpread {
  readonly min: number
  readonly median: number
  readonly max: number
}

const spread = (xs: readonly number[]): CountSpread => ({ min: Math.min(...xs), median: quantile(xs, 0.5), max: Math.max(...xs) })

export interface SimSessionReport {
  readonly args: Omit<SimSessionArgs, 'json'>
  readonly n: number
  readonly meanDurationMin: number
  readonly maxDurationMin: number
  readonly ended: Record<string, number>
  readonly meanPartMin: Partial<Record<SegmentId, number>>
  readonly meanAboutMin: Partial<Record<SegmentId, number>>
  readonly qrFloorMisses: number
  readonly reachedQuant: number
  /** Session length in active minutes: median, 95th percentile (nearest rank) and longest. */
  readonly durationMin: { readonly median: number; readonly p95: number; readonly max: number }
  /** Share of the sessions that ended at the hard stop, and where it is. */
  readonly hardStopShare: number
  readonly hardStopMin: number
  /** Questions shown per skill, over the sessions that showed any. */
  readonly shownByAxis: Partial<Record<AxisCode, CountSpread>>
  /** Questions answered (not timed out) per skill, over the same sessions. */
  readonly answeredByAxis: Partial<Record<AxisCode, CountSpread>>
  /** Share of the sessions that reached Quant with at least five answered questions on it (what a skill is published from). */
  readonly qrPublishableShare: number
  readonly breakBefore: Record<string, number>
  readonly meanBreakAtMin: number
  readonly breakOffersMax: number
}

/** Sessions of the device-only version, summarised. */
export function simulate(args: SimSessionArgs): SimSessionReport {
  const runs: SimSessionOne[] = []
  for (let i = args.offset; i < args.offset + args.n; i++) runs.push(simulateOne(i, args))
  return summarise(args, runs)
}

/** Sessions of the online version against {@link SimServer}, summarised. */
export async function simulateOnline(args: SimSessionArgs): Promise<SimSessionReport> {
  const runs: SimSessionOne[] = []
  for (let i = args.offset; i < args.offset + args.n; i++) runs.push(await simulateOneOnline(i, args))
  return summarise({ ...args, mode: 'online' }, runs)
}

export function summarise(args: SimSessionArgs, runs: readonly SimSessionOne[]): SimSessionReport {
  const parts: readonly SegmentId[] = SEGMENT_ORDER
  const axes = [...new Set(runs.flatMap((r) => Object.keys(r.shown) as AxisCode[]))].sort((a, b) => AXIS_INDEX[a] - AXIS_INDEX[b])
  const shownByAxis: Partial<Record<AxisCode, CountSpread>> = {}
  const answeredByAxis: Partial<Record<AxisCode, CountSpread>> = {}
  for (const k of axes) {
    const with_ = runs.filter((r) => (r.shown[k] ?? 0) > 0)
    shownByAxis[k] = spread(with_.map((r) => r.shown[k] ?? 0))
    answeredByAxis[k] = spread(with_.map((r) => r.answered[k] ?? 0))
  }
  const durations = runs.map((r) => r.durationS / 60)
  const reached = runs.filter((r) => r.reachedQuant && args.skip !== 'QR')
  const meanPartMin: Partial<Record<SegmentId, number>> = {}
  const meanAboutMin: Partial<Record<SegmentId, number>> = {}
  for (const p of parts) {
    const xs = runs.flatMap((r) => (r.partS[p] === undefined ? [] : [r.partS[p]! / 60]))
    if (xs.length > 0) meanPartMin[p] = Math.round(mean(xs) * 100) / 100
    const ab = runs.flatMap((r) => (r.aboutMin[p] === undefined ? [] : [r.aboutMin[p]!]))
    if (ab.length > 0) meanAboutMin[p] = Math.round(mean(ab) * 100) / 100
  }
  const ended: Record<string, number> = {}
  for (const r of runs) ended[r.ended ?? 'none'] = (ended[r.ended ?? 'none'] ?? 0) + 1
  const breakBefore: Record<string, number> = {}
  for (const r of runs) breakBefore[r.breakBefore ?? 'none'] = (breakBefore[r.breakBefore ?? 'none'] ?? 0) + 1
  return {
    args: (({ json: _json, ...rest }) => rest)(args),
    n: runs.length,
    meanDurationMin: Math.round(mean(runs.map((r) => r.durationS / 60)) * 100) / 100,
    maxDurationMin: Math.round(Math.max(...runs.map((r) => r.durationS / 60)) * 100) / 100,
    ended,
    meanPartMin,
    meanAboutMin,
    qrFloorMisses: runs.filter((r) => r.reachedQuant && args.skip !== 'QR' && r.qrItems < 3).length,
    reachedQuant: runs.filter((r) => r.reachedQuant).length,
    durationMin: { median: round2(quantile(durations, 0.5)), p95: round2(quantile(durations, 0.95)), max: round2(Math.max(...durations)) },
    hardStopShare: round2(runs.filter((r) => r.ended === 'hard_stop').length / runs.length),
    hardStopMin: HARD_STOP_S / 60,
    shownByAxis,
    answeredByAxis,
    qrPublishableShare: reached.length === 0 ? Number.NaN : round2(reached.filter((r) => (r.answered.QR ?? 0) >= PUBLISH_MIN_ITEMS).length / reached.length),
    breakBefore,
    meanBreakAtMin: Math.round(mean(runs.flatMap((r) => (r.breakAtS === null ? [] : [r.breakAtS / 60]))) * 100) / 100,
    breakOffersMax: Math.max(...runs.map((r) => r.breakOffers)),
  }
}

export async function main(argv: readonly string[], cwd: string): Promise<number> {
  let args: SimSessionArgs
  try {
    args = parseSimSessionArgs(argv, cwd)
  } catch (e) {
    if (e instanceof UsageError) {
      console.error(e.message)
      return 2
    }
    throw e
  }
  const report = args.mode === 'online' ? await simulateOnline(args) : simulate(args)
  const text = JSON.stringify(report, null, 2)
  console.log(text)
  if (args.json !== undefined) writeFileSync(args.json, text + '\n')
  return 0
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) process.exitCode = await main(process.argv.slice(2), process.env.INIT_CWD ?? process.cwd())
