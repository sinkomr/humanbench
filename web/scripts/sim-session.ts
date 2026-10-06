/**
 * `npm run sim:session -- [--n 200] [--offset 0] [--skip none|MAT|SPA|…] [--interstitial-s 0]
 * [--target-min 27.5] [--json <file>]` (UX-066, DESIGN §7.4, §10, A15): whole sessions of the real
 * session machine (`session/run.ts`) driven by the simulated taker of `session/bot.ts`, so the
 * clock rules, the break, the part budgets and the coverage floor are the ones the app runs (the
 * M1.4b `sim:cat` models the CAT budget on its own and does not skip). Each simulee has θ ~ N(0, I)
 * and block times 1–1.6× their model time; `--skip` skips that skill at its "Up next" screen.
 *
 * Prints, and with `--json` writes, the mean active session length, the mean active time of each
 * part, the "About N min" each CAT part showed on its interstitial, the QR coverage-floor misses
 * (fewer than 3 QR items in a session that reached Quant), and where the break was offered.
 */

import { writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { N_AXES, isAxisCode, type AxisCode } from '../src/engine/axes'
import { createRng } from '../src/engine/prng'
import { A15_TARGET_S, type SegmentId } from '../src/engine/selector'
import { Bot } from '../src/session/bot'
import { UsageError } from './dump-lib'

export interface SimSessionArgs {
  readonly n: number
  readonly offset: number
  readonly skip: AxisCode | null
  readonly interstitialS: number
  readonly targetS: number
  readonly json?: string
}

export function parseSimSessionArgs(argv: readonly string[], cwd: string): SimSessionArgs {
  let n = 200
  let offset = 0
  let skip: AxisCode | null = null
  let interstitialS = 0
  let targetS = A15_TARGET_S
  let json: string | undefined
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
      case '--json':
        json = resolve(cwd, value)
        break
      default:
        throw new UsageError(`unknown flag ${flag ?? ''}`)
    }
  }
  if (!(Number.isInteger(n) && n > 0) || !(Number.isInteger(offset) && offset >= 0)) throw new UsageError('--n and --offset are whole numbers')
  if (!(interstitialS >= 0) || !(targetS > 0)) throw new UsageError('--interstitial-s ≥ 0 and --target-min > 0')
  return { n, offset, skip, interstitialS, targetS, ...(json === undefined ? {} : { json }) }
}

export interface SimSessionOne {
  readonly durationS: number
  readonly ended: string | null
  /** Active seconds per part that ran. */
  readonly partS: Partial<Record<SegmentId, number>>
  /** "About N min" of each part's interstitial, as shown. */
  readonly aboutMin: Partial<Record<SegmentId, number>>
  readonly qrItems: number
  readonly reachedQuant: boolean
  /** The part whose interstitial came right after the break offer, or null. */
  readonly breakBefore: SegmentId | null
  readonly breakAtS: number | null
  readonly breakOffers: number
}

export function simulateOne(i: number, args: SimSessionArgs): SimSessionOne {
  const rng = createRng(`sim-session:${i}`)
  const theta = Array.from({ length: N_AXES }, () => rng.normal())
  const bot = new Bot(
    { sessionId: `s_SIMSESS${String(i).padStart(8, '0')}`, targetS: args.targetS },
    { theta, blockScale: 1 + 0.6 * rng.next(), interstitialS: args.interstitialS },
  )
  const partS: Partial<Record<SegmentId, number>> = {}
  const aboutMin: Partial<Record<SegmentId, number>> = {}
  let open: { id: SegmentId; at: number } | null = null
  let breakBefore: SegmentId | null = null
  let breakAtS: number | null = null
  let breakOffers = 0
  let afterOffer = false
  let reachedQuant = false
  for (let step = 0; step < 6000; step++) {
    bot.run.tick()
    const v = bot.view()
    if (v.phase === 'interstitial' || v.phase === 'finished' || v.phase === 'break_offer') {
      if (open !== null) {
        partS[open.id] = (partS[open.id] ?? 0) + (v.elapsedS - open.at)
        open = null
      }
    }
    if (v.phase === 'finished') break
    if (v.phase === 'break_offer') {
      breakOffers++
      breakAtS = v.elapsedS
      afterOffer = true
    }
    if (v.phase === 'interstitial' && v.segment !== null) {
      if (afterOffer) {
        breakBefore = v.segment.id
        afterOffer = false
      }
      if (v.segment.id === 'quant') reachedQuant = true
      if (aboutMin[v.segment.id] === undefined) aboutMin[v.segment.id] = v.segment.minutes
      if (args.skip !== null && v.segment.axes.includes(args.skip) && !v.skipped.includes(args.skip)) {
        bot.wait(args.interstitialS)
        bot.run.skipAxis(args.skip)
        continue
      }
      // The bot waits on the interstitial, then starts: the part's active time begins at Start.
      bot.wait(args.interstitialS)
      open = { id: v.segment.id, at: bot.run.elapsedS() }
      bot.run.startSegment()
      continue
    }
    bot.step()
  }
  const v = bot.view()
  return {
    durationS: v.elapsedS,
    ended: v.ended,
    partS,
    aboutMin,
    qrItems: bot.run.result().itemsByAxis.QR ?? 0,
    reachedQuant,
    breakBefore,
    breakAtS,
    breakOffers,
  }
}

const mean = (xs: readonly number[]): number => (xs.length === 0 ? Number.NaN : xs.reduce((s, x) => s + x, 0) / xs.length)

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
  readonly breakBefore: Record<string, number>
  readonly meanBreakAtMin: number
  readonly breakOffersMax: number
}

export function simulate(args: SimSessionArgs): SimSessionReport {
  const runs: SimSessionOne[] = []
  for (let i = args.offset; i < args.offset + args.n; i++) runs.push(simulateOne(i, args))
  const parts: SegmentId[] = ['rt', 'matrix_series', 'spatial', 'memory', 'quant', 'coding_reading']
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
    args: { n: args.n, offset: args.offset, skip: args.skip, interstitialS: args.interstitialS, targetS: args.targetS },
    n: runs.length,
    meanDurationMin: Math.round(mean(runs.map((r) => r.durationS / 60)) * 100) / 100,
    maxDurationMin: Math.round(Math.max(...runs.map((r) => r.durationS / 60)) * 100) / 100,
    ended,
    meanPartMin,
    meanAboutMin,
    qrFloorMisses: runs.filter((r) => r.reachedQuant && args.skip !== 'QR' && r.qrItems < 3).length,
    reachedQuant: runs.filter((r) => r.reachedQuant).length,
    breakBefore,
    meanBreakAtMin: Math.round(mean(runs.flatMap((r) => (r.breakAtS === null ? [] : [r.breakAtS / 60]))) * 100) / 100,
    breakOffersMax: Math.max(...runs.map((r) => r.breakOffers)),
  }
}

export function main(argv: readonly string[], cwd: string): number {
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
  const report = simulate(args)
  const text = JSON.stringify(report, null, 2)
  console.log(text)
  if (args.json !== undefined) writeFileSync(args.json, text + '\n')
  return 0
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) process.exitCode = main(process.argv.slice(2), process.env.INIT_CWD ?? process.cwd())
