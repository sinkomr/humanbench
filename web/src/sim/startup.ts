/**
 * The start-up rule of item selection, simulated (`engine/startup.ts`; owner feedback 2026-10-13;
 * DESIGN §7.4). SIMULATION SUPPORT ONLY: never imported by the app.
 *
 * One part of a session at a time, for takers of a known θ, with the rule and without it:
 *
 * - the three device/procedural parts (Matrix & Series, Spatial, Quantitative) through the REAL
 *   selector, families and scorer ({@link simulatePart});
 * - a served text part through a stand-in for the server's selection over a finite pool
 *   ({@link simulatePoolPart}): the same criterion, the same top five, the same start-up filter. The
 *   pool is made up to the shape of the live text banks as the lead measured them on 2026-10-13
 *   (items at the stratum centres b = −2 … 3, discrimination 1, five options scored as 2PL, one
 *   expected time), so "before" should look like the owner's vocabulary part: stratum 2, then five
 *   at stratum 3, then four at stratum 4 on a perfect record.
 *
 * What is measured per θ ({@link summarise}): the mean difficulty served at each position, how
 * many questions until one is within 0.5 of θ, the share of takers shown a stratum 5 or 6 item
 * among the first five, and the error of the part's own estimate (the per-axis EAP the session
 * shows, from the same scoring as ever) after the part. Over a N(0, 1) population: r and RMSE of
 * that estimate. Scoring is not changed by the rule; what can change is which items the estimate
 * is made from.
 */

import { type AxisCode } from '../engine/axes'
import { info2pl, p2pl } from '../engine/irt'
import { createRng, type Rng } from '../engine/prng'
import { SELECTION_TIME_EXPONENT, answeredItems, selectNext, selectionAim, selectionRng, sessionPosterior, type AdministeredItem } from '../engine/selector'
import { startupCompetes, startupTarget } from '../engine/startup'
import type { Observation } from '../engine/types'
import type { AnyFamily } from '../tasks/family'
import { stratumOfB } from '../tasks/priors'
import { getFamily } from '../tasks/registry'
import { answerItem } from './responders'
import { pearson } from './stats'

/** One question of a simulated part. */
export interface Served {
  readonly b: number
  readonly stratum: number
  readonly y: 0 | 1
  /** The question's expected time E[T] in seconds. */
  readonly et: number
}

/** One simulated part: the questions in order and the part's estimate after each. */
export interface PartRun {
  readonly theta: number
  readonly served: readonly Served[]
  /** EAP mean of the skill after question i (index i − 1). */
  readonly estimate: readonly number[]
}

function familyOf(name: string): AnyFamily {
  const f = getFamily(name)
  if (f === undefined) throw new Error(`family ${name} is not registered`)
  return f
}

/** `n` questions of a device part on `axis` for a taker at θ, through the real selector (no time limit). */
export function simulatePart(axis: AxisCode, theta: number, seed: string, n: number, startup: boolean, timeExponent?: number): PartRun {
  const obs: Observation[] = []
  const administered: AdministeredItem[] = []
  const served: Served[] = []
  const estimate: number[] = []
  const taker = createRng(`startup-sim:${seed}`)
  for (let i = 0; i < n; i++) {
    const sel = selectNext({ sessionSeed: seed, posterior: sessionPosterior(obs), administered, history: answeredItems(obs), aim: selectionAim(obs) }, selectionRng(seed, i), { axes: [axis], startup, ...(timeExponent === undefined ? {} : { timeExponent }) })
    if (sel.kind === 'none') break
    const answer = answerItem(familyOf(sel.item.family), sel.item, theta, taker.fork(`item/${i}`))
    obs.push(answer.observation)
    administered.push(sel.item)
    const o = answer.observation
    if (o.kind !== '2pl' && o.kind !== '3pl') throw new Error('a CAT item gives a dichotomous observation')
    served.push({ b: o.b, stratum: stratumOfB(o.b), y: o.y, et: sel.item.expected_time_s })
    estimate.push(sessionPosterior(obs)[axis].mean)
  }
  return { theta, served, estimate }
}

/** One item of the stand-in pool. */
export interface PoolItem {
  readonly id: number
  readonly a: number
  readonly b: number
  readonly et: number
}

/**
 * A made-up finite pool in the shape of a live text bank: `perStratum` items at each stratum centre
 * b = −2 … 3 (every fourth of stratum 6 at 3.25), a = 1, one expected time, or one per stratum (1 … 6).
 */
export function textPool(perStratum = 40, et: number | readonly number[] = 15): PoolItem[] {
  const out: PoolItem[] = []
  for (let s = 1; s <= 6; s++) {
    const t = typeof et === 'number' ? et : et[s - 1]!
    for (let i = 0; i < perStratum; i++) out.push({ id: out.length, a: 1, b: s - 3 + (s === 6 && i % 4 === 0 ? 0.25 : 0), et: t })
  }
  return out
}

/** `n` questions of a served text part on `axis` for a taker at θ, by the server's rule over `pool` (module comment). */
export function simulatePoolPart(pool: readonly PoolItem[], axis: AxisCode, theta: number, seed: string, n: number, startup: boolean, topK = 5, timeExponent = SELECTION_TIME_EXPONENT): PartRun {
  const rng: Rng = createRng(`startup-pool:${seed}`)
  const used = new Set<number>()
  const obs: Observation[] = []
  const served: Served[] = []
  const estimate: number[] = []
  for (let i = 0; i < n; i++) {
    const post = sessionPosterior(obs)[axis]
    let cand = pool.filter((it) => !used.has(it.id))
    if (cand.length === 0) break
    const target = startup ? startupTarget(served.map((s) => ({ b: s.b, correct: s.y, scored: 1 }))) : null
    if (target !== null) {
      const keep = startupCompetes(cand.map((c) => c.b), target)
      cand = cand.filter((_, k) => keep[k])
    }
    const at = startup ? selectionAim(obs)[axis]! : post.mean
    const ranked = cand.map((it) => ({ it, score: (info2pl(at, it.a, it.b) * post.sd * post.sd) / it.et ** timeExponent })).sort((x, y) => y.score - x.score || x.it.id - y.it.id)
    const pick = ranked[rng.int(0, Math.min(topK, ranked.length) - 1)]!.it
    used.add(pick.id)
    const y: 0 | 1 = rng.next() < p2pl(theta, pick.a, pick.b) ? 1 : 0
    obs.push({ kind: '2pl', axis, a: pick.a, b: pick.b, y })
    served.push({ b: pick.b, stratum: stratumOfB(pick.b), y, et: pick.et })
    estimate.push(sessionPosterior(obs)[axis].mean)
  }
  return { theta, served, estimate }
}

/** What a set of runs at one θ shows. */
export interface ThetaSummary {
  readonly theta: number
  readonly n: number
  /** Mean b of the question at each position. */
  readonly meanB: readonly number[]
  /** Median number of questions until one has |b − θ| ≤ 0.5; null when half the takers or more never got one. */
  readonly medianToWithin: number | null
  /** Share of takers who got such a question at all in the part. */
  readonly shareWithin: number
  /** Share of takers shown an item of stratum 5 or 6 among the first five questions. */
  readonly shareHardInFive: number
  /** Share of answers that were correct. */
  readonly pCorrect: number
  /** RMSE and mean signed error of the part's estimate after its last question. */
  readonly rmse: number
  readonly bias: number
}

const mean = (xs: readonly number[]): number => xs.reduce((a, b) => a + b, 0) / xs.length

export function summarise(theta: number, runs: readonly PartRun[]): ThetaSummary {
  const len = Math.min(...runs.map((r) => r.served.length))
  const meanB = Array.from({ length: len }, (_, i) => mean(runs.map((r) => r.served[i]!.b)))
  const firstWithin = runs.map((r) => r.served.findIndex((s) => Math.abs(s.b - theta) <= 0.5) + 1).map((k) => (k === 0 ? Infinity : k))
  const sorted = [...firstWithin].sort((a, b) => a - b)
  const med = sorted[Math.ceil(sorted.length / 2) - 1]!
  const errs = runs.map((r) => r.estimate[r.estimate.length - 1]! - theta)
  return {
    theta,
    n: runs.length,
    meanB,
    medianToWithin: Number.isFinite(med) ? med : null,
    shareWithin: firstWithin.filter(Number.isFinite).length / runs.length,
    shareHardInFive: runs.filter((r) => r.served.slice(0, 5).some((s) => s.stratum >= 5)).length / runs.length,
    pCorrect: mean(runs.flatMap((r) => r.served.map((s) => s.y as number))),
    rmse: Math.sqrt(mean(errs.map((e) => e * e))),
    bias: mean(errs),
  }
}

/** A part, to simulate: a device part by its axis, or the stand-in text pool. */
export type PartKind = 'MAT' | 'SPA' | 'QR' | 'TEXT'

function runPart(kind: PartKind, pool: readonly PoolItem[], theta: number, seed: string, n: number, startup: boolean): PartRun {
  return kind === 'TEXT' ? simulatePoolPart(pool, 'VOC', theta, seed, n, startup) : simulatePart(kind, theta, seed, n, startup)
}

export interface StartupStudy {
  readonly kind: PartKind
  readonly items: number
  readonly perTheta: number
  readonly before: readonly ThetaSummary[]
  readonly after: readonly ThetaSummary[]
  /** Over a N(0, 1) population of `population` takers: r and RMSE of the part's estimate. */
  readonly recovery: { readonly population: number; readonly before: { r: number; rmse: number }; readonly after: { r: number; rmse: number } }
}

export const STUDY_THETAS: readonly number[] = Object.freeze([-2, -1, 0, 1, 2, 2.5, 3])

/** The whole before/after comparison for one kind of part (module comment). The same takers and seeds under both rules. */
export function startupStudy(kind: PartKind, opts: { items?: number; perTheta?: number; population?: number; thetas?: readonly number[] } = {}): StartupStudy {
  const items = opts.items ?? 8
  const perTheta = opts.perTheta ?? 200
  const population = opts.population ?? 600
  const pool = textPool()
  const at = (startup: boolean): ThetaSummary[] =>
    (opts.thetas ?? STUDY_THETAS).map((theta) => summarise(theta, Array.from({ length: perTheta }, (_, i) => runPart(kind, pool, theta, `st.${kind}.${theta}.${i}`, items, startup))))
  const people = createRng(`startup-pop:${kind}`)
  const thetas = Array.from({ length: population }, () => people.normal())
  const rec = (startup: boolean): { r: number; rmse: number } => {
    const est = thetas.map((theta, i) => {
      const r = runPart(kind, pool, theta, `pop.${kind}.${i}`, items, startup)
      return r.estimate[r.estimate.length - 1]!
    })
    return { r: pearson(thetas, est), rmse: Math.sqrt(mean(est.map((e, i) => (e - thetas[i]!) ** 2))) }
  }
  return { kind, items, perTheta, before: at(false), after: at(true), recovery: { population, before: rec(false), after: rec(true) } }
}

const f2 = (x: number): string => (x >= 0 ? ' ' : '') + x.toFixed(2)

/** The study as a plain-text table. */
export function formatStudy(s: StartupStudy): string {
  const lines: string[] = []
  const title = s.kind === 'TEXT' ? 'a served text part (stand-in pool, b = −2 … 3.25, a = 1)' : `${s.kind} (the real selector and families)`
  lines.push(`Start-up rule, ${title}: ${s.items} questions, ${s.perTheta} takers per θ`)
  lines.push('  θ     rule    mean b at question 1 … ' + s.items + '                                   to within 0.5 (median; share)   s5–6 in first 5   correct   RMSE   bias')
  s.before.forEach((b, i) => {
    const a = s.after[i]!
    for (const [name, x] of [['before', b], ['after ', a]] as const) {
      const within = `${x.medianToWithin === null ? `> ${s.items}` : String(x.medianToWithin).padStart(3)}; ${(100 * x.shareWithin).toFixed(0).padStart(3)}%`
      lines.push(`  ${f2(x.theta).padStart(5)} ${name}  ${x.meanB.map(f2).join(' ')}   ${within.padEnd(12)}                 ${(100 * x.shareHardInFive).toFixed(0).padStart(3)}%          ${(100 * x.pCorrect).toFixed(0).padStart(3)}%    ${x.rmse.toFixed(2)}  ${f2(x.bias)}`)
    }
  })
  const r = s.recovery
  lines.push(`  θ ~ N(0, 1), ${r.population} takers, the part's estimate after ${s.items} questions: before r ${r.before.r.toFixed(3)} RMSE ${r.before.rmse.toFixed(3)}; after r ${r.after.r.toFixed(3)} RMSE ${r.after.rmse.toFixed(3)}`)
  return lines.join('\n')
}
