/**
 * Information alone against information per second inside a part, simulated (owner question 2026-10-16;
 * `engine/selector.ts` SELECTION_TIME_EXPONENT; DESIGN §7.4). SIMULATION SUPPORT ONLY: never imported by the app.
 *
 * The same takers and seeds under both criteria (time exponent 1, "before": information per second; 0, "after":
 * information alone), with the start-up rule and the aim as the app has them:
 *
 * - the three device/procedural parts (Matrix & Series, Spatial, Quantitative) through the REAL selector, families
 *   and scorer (`sim/startup.ts` simulatePart), and
 * - a Logical Reasoning part through the stand-in for the server's selection over a finite pool
 *   (`sim/startup.ts` simulatePoolPart) whose expected times grow with the stratum as the bank's LR items' do
 *   ({@link LR_ET_BY_STRATUM}; with one expected time for every item the two criteria rank alike).
 *
 * Per θ: the mean difficulty at each of the part's first questions, the share of stratum 5–6 questions (of all,
 * and in the first five), the share correct, the RMSE of the part's estimate, and the expected time of those
 * questions. Over a N(0, 1) population: r and RMSE. And the length of a part under its time rule
 * ({@link budgetedPart}: questions until its budget is spent and six are answered, at the taker's pace), so the
 * cost in minutes is seen where it is paid.
 */

import type { AxisCode } from '../engine/axes'
import { PART_MIN_ITEMS } from '../engine/plan-table'
import { createRng } from '../engine/prng'
import { pearson } from './stats'
import { simulatePart, simulatePoolPart, summarise, textPool, type PartRun, type PoolItem, type ThetaSummary } from './startup'

/**
 * Mean expected time in seconds of the bank's Logical Reasoning items by stratum 1 … 6 (the M3.5 batches and the
 * M3.12 hard batches, 483 items, 2026-10-16): harder items are longer to read and to work out.
 */
export const LR_ET_BY_STRATUM: readonly number[] = Object.freeze([41, 53, 63, 73, 98, 114])

/** Planned seconds of the Logical Reasoning part (`plan-table.ts` TEXT_PARTS share_s). */
export const LR_SHARE_S = 360

export type CriterionPart = 'MAT' | 'SPA' | 'QR' | 'LR'

export const CRITERION_THETAS: readonly number[] = Object.freeze([0, 2, 2.5, 3])

function run(kind: CriterionPart, pool: readonly PoolItem[], theta: number, seed: string, n: number, p: number): PartRun {
  return kind === 'LR' ? simulatePoolPart(pool, 'LR', theta, seed, n, true, 5, p) : simulatePart(kind as AxisCode, theta, seed, n, true, p)
}

/** One θ under one criterion: {@link ThetaSummary} plus the share of hard questions and their time. */
export interface CriterionRow extends ThetaSummary {
  /** Share of all questions served that were of stratum 5 or 6. */
  readonly shareHard: number
  /** Mean summed expected time of the part's questions, in minutes. */
  readonly minutes: number
}

const mean = (xs: readonly number[]): number => xs.reduce((a, b) => a + b, 0) / xs.length

function row(theta: number, runs: readonly PartRun[]): CriterionRow {
  const all = runs.flatMap((r) => r.served)
  return {
    ...summarise(theta, runs),
    shareHard: all.filter((s) => s.stratum >= 5).length / all.length,
    minutes: mean(runs.map((r) => r.served.reduce((t, s) => t + s.et, 0))) / 60,
  }
}

/** A part run under its time rule: the questions it took and its length in seconds. */
export interface BudgetedRun {
  readonly questions: number
  readonly seconds: number
}

/**
 * A part under its time rule, as the session runs one: questions are asked while the part's budget lasts or until
 * {@link PART_MIN_ITEMS} are answered, whichever is later; each takes its E[T] times `pace` (no time-outs, no hard
 * stop). `ets` are the expected times of the part's questions in order (enough of them to spend the budget).
 */
export function budgetedPart(ets: readonly number[], budgetS: number, pace: number): BudgetedRun {
  let t = 0
  let k = 0
  while (k < ets.length && (t < budgetS || k < PART_MIN_ITEMS)) {
    t += ets[k]! * pace
    k++
  }
  return { questions: k, seconds: t }
}

export interface CriterionStudy {
  readonly kind: CriterionPart
  readonly items: number
  readonly perTheta: number
  readonly before: readonly CriterionRow[]
  readonly after: readonly CriterionRow[]
  readonly recovery: { readonly population: number; readonly before: { r: number; rmse: number }; readonly after: { r: number; rmse: number } }
  /** LR only: the part under its 360 s share and minimum of six, per θ: median and 95th percentile seconds, typical and 1.25× slower. */
  readonly length?: readonly { theta: number; pace: number; before: { median: number; p95: number }; after: { median: number; p95: number } }[]
}

const quantile = (xs: readonly number[], q: number): number => {
  const s = [...xs].sort((a, b) => a - b)
  return s[Math.min(s.length - 1, Math.max(0, Math.ceil(q * s.length) - 1))]!
}

/** The before/after comparison for one part (module comment). */
export function criterionStudy(kind: CriterionPart, opts: { items?: number; perTheta?: number; population?: number; thetas?: readonly number[] } = {}): CriterionStudy {
  const items = opts.items ?? 8
  const perTheta = opts.perTheta ?? 200
  const population = opts.population ?? 600
  const thetas = opts.thetas ?? CRITERION_THETAS
  const pool = textPool(60, LR_ET_BY_STRATUM)
  const runs = (p: number, theta: number, n: number): PartRun[] => Array.from({ length: perTheta }, (_, i) => run(kind, pool, theta, `cr.${kind}.${theta}.${i}`, n, p))
  const at = (p: number): CriterionRow[] => thetas.map((theta) => row(theta, runs(p, theta, items)))
  const people = createRng(`criterion-pop:${kind}`)
  const pop = Array.from({ length: population }, () => people.normal())
  const rec = (p: number): { r: number; rmse: number } => {
    const est = pop.map((theta, i) => {
      const r = run(kind, pool, theta, `crpop.${kind}.${i}`, items, p)
      return r.estimate[r.estimate.length - 1]!
    })
    return { r: pearson(pop, est), rmse: Math.sqrt(mean(est.map((e, i) => (e - pop[i]!) ** 2))) }
  }
  const study: CriterionStudy = { kind, items, perTheta, before: at(1), after: at(0), recovery: { population, before: rec(1), after: rec(0) } }
  if (kind !== 'LR') return study
  // Long enough for any taker to spend the budget: 360 s at 41 s a question is 9; 12 covers it.
  const lengths = thetas.flatMap((theta) => {
    const long = { before: runs(1, theta, 12), after: runs(0, theta, 12) }
    return [1, 1.25].map((pace) => {
      const sum = (rs: readonly PartRun[]): { median: number; p95: number } => {
        const s = rs.map((r) => budgetedPart(r.served.map((q) => q.et), LR_SHARE_S, pace).seconds)
        return { median: quantile(s, 0.5), p95: quantile(s, 0.95) }
      }
      return { theta, pace, before: sum(long.before), after: sum(long.after) }
    })
  })
  return { ...study, length: lengths }
}

const f2 = (x: number): string => (x >= 0 ? ' ' : '') + x.toFixed(2)
const pct = (x: number): string => `${(100 * x).toFixed(0).padStart(3)}%`

/** The study as a plain-text table. */
export function formatCriterion(s: CriterionStudy): string {
  const lines: string[] = []
  const title = s.kind === 'LR' ? 'Logical Reasoning (stand-in pool, E[T] 41–114 s by stratum as in the bank)' : `${s.kind} (the real selector and families)`
  lines.push(`Criterion inside a part, ${title}: ${s.items} questions, ${s.perTheta} takers per θ; before = information per second, after = information alone`)
  lines.push(`  θ     rule    mean b at question 1 … ${s.items}                              s5–6 all  s5–6 in 5  correct  RMSE   bias   min of ${s.items}`)
  s.before.forEach((b, i) => {
    const a = s.after[i]!
    for (const [name, x] of [['before', b], ['after ', a]] as const) {
      lines.push(`  ${f2(x.theta).padStart(5)} ${name}  ${x.meanB.map(f2).join(' ')}   ${pct(x.shareHard)}     ${pct(x.shareHardInFive)}     ${pct(x.pCorrect)}   ${x.rmse.toFixed(2)}  ${f2(x.bias)}  ${x.minutes.toFixed(1)}`)
    }
  })
  const r = s.recovery
  lines.push(`  θ ~ N(0, 1), ${r.population} takers, after ${s.items} questions: before r ${r.before.r.toFixed(3)} RMSE ${r.before.rmse.toFixed(3)}; after r ${r.after.r.toFixed(3)} RMSE ${r.after.rmse.toFixed(3)}`)
  for (const l of s.length ?? []) {
    lines.push(`  part length at θ ${f2(l.theta)}, pace ${l.pace}: before median ${(l.before.median / 60).toFixed(1)} min (p95 ${(l.before.p95 / 60).toFixed(1)}); after ${(l.after.median / 60).toFixed(1)} min (p95 ${(l.after.p95 / 60).toFixed(1)})`)
  }
  return lines.join('\n')
}
