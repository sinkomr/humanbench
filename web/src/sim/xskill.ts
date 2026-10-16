/**
 * The cross-skill start of a part, simulated (`engine/xskill.ts`; owner request 2026-10-15; DESIGN §7.4).
 * SIMULATION SUPPORT ONLY: never imported by the app. `npm run sim:cat -- --part d` prints the tables.
 *
 * A session of question parts, one after the other, each by the server's rule over a stand-in pool (the
 * criterion at the aim, the start-up filter, the randomesque top five; as `sim/startup.ts` simulatePoolPart),
 * with the aim made from everything answered before in the session ({@link selectionAim}), at a borrowing
 * strength s (0: before 2026-10-15). The pools are made up for every skill alike, so the comparison is about the
 * rule and not about which banks happen to be thin at the top (ROADMAP M3.12): `perStratum` items in each of
 * the six strata, b spread evenly over the stratum's band (−2.5 … 3.5), discrimination 1, the skill's own time.
 *
 * Takers:
 * - **population**: θ ~ N(0, Σ_init), the population the prior describes;
 * - **owner**: θ = +2.5 on every skill (the owner's near-perfect session of 2026-10-12);
 * - **dip** / **peak**: a population taker with one skill, at random among the parts after the first,
 *   2.5 below (above) where they were drawn: the spiky profiles that borrowing must not flatten;
 * - **returning**: the population taker's second session, aimed with (or without) the first's answers.
 *
 * What is measured, per part and over the session: the number of questions until one is within 0.5 of θ
 * (counted as items + 1 when none is), the distance of the part's FIRST question from θ, and the reported
 * scores, unchanged by the rule, of the answers a profile is made from (the session's; for a returning taker
 * both sessions', as the results re-score every session): the per-skill EAP (the server's `rescore` model) and
 * the correlated MAP over Σ (the app's results): r and RMSE over the takers, and the per-skill EAP's mean error
 * on a dip or a peak (a flattened profile would show a dip's error positive and a peak's negative). With `stopSd` the parts run until the posterior SD is under it (at
 * most `maxItems`), and the questions and seconds they took are the session-length side.
 */

import { AXIS_INDEX, initialSigma, type AxisCode } from '../engine/axes'
import { info2pl, p2pl } from '../engine/irt'
import { cholesky } from '../engine/linalg'
import { mapTheta } from '../engine/scorer'
import { createRng, type Rng } from '../engine/prng'
import { selectionAim, sessionPosterior } from '../engine/selector'
import { startupCompetes, startupTarget } from '../engine/startup'
import type { Observation } from '../engine/types'
import { pearson } from './stats'

/** The question parts of a session with every served skill on, in the session's order (`plan-table.ts` SEGMENT_ORDER), 2PL skills only. */
export const SESSION_AXES: readonly AxisCode[] = Object.freeze(['MAT', 'LR', 'KST', 'SPA', 'VOC', 'RC', 'QR', 'KHU', 'KAP', 'LG'] as const)

/** Seconds a question takes, per skill (the device families' and `scripts/sim-session.ts` TEXT_ITEM_S). */
export const SIM_ITEM_S: Readonly<Partial<Record<AxisCode, number>>> = Object.freeze({ MAT: 40, SPA: 35, QR: 50, LR: 60, LG: 55, RC: 45, VOC: 15, KST: 20, KHU: 20, KAP: 20 })

export interface PoolItem {
  readonly id: number
  readonly b: number
  readonly et: number
}

/** A made-up pool for `axis` (module comment): `perStratum` items a stratum, b evenly over −2.5 … 3.5. */
export function xPool(axis: AxisCode, perStratum = 40): PoolItem[] {
  const et = SIM_ITEM_S[axis] ?? 30
  const out: PoolItem[] = []
  for (let s = 0; s < 6; s++) for (let i = 0; i < perStratum; i++) out.push({ id: out.length, b: s - 2.5 + (i + 0.5) / perStratum, et })
  return out
}

export interface PartResult {
  readonly axis: AxisCode
  readonly theta: number
  readonly bs: readonly number[]
  readonly ys: readonly (0 | 1)[]
  /** The reported (session) estimate of the skill after the part. */
  readonly estimate: number
  readonly sd: number
  readonly seconds: number
}

export interface SessionOptions {
  /** Borrowing strength (`xskill.ts`). */
  readonly borrow: number
  /** Questions a part (default 6, `PART_MIN_ITEMS`); with `stopSd`, at most this many. */
  readonly items?: number
  /** Run each part until its posterior SD is under this (at least 3 questions, the floor), at most `items`. */
  readonly stopSd?: number
  /** The parts, in order (default {@link SESSION_AXES}). */
  readonly order?: readonly AxisCode[]
  /** Answers of earlier sessions, for the aim only. */
  readonly earlier?: readonly Observation[]
  readonly perStratum?: number
}

/** One session for a taker of true θ (by axis index), with every random choice from `seed`. */
export function simulateSession(theta: readonly number[], seed: string, opts: SessionOptions): { parts: PartResult[]; obs: Observation[] } {
  const order = opts.order ?? SESSION_AXES
  const items = opts.items ?? 6
  const rng: Rng = createRng(`xskill:${seed}`)
  const obs: Observation[] = []
  const parts: PartResult[] = []
  for (const axis of order) {
    const pool = xPool(axis, opts.perStratum)
    const used = new Set<number>()
    const bs: number[] = []
    const ys: (0 | 1)[] = []
    let seconds = 0
    const th = theta[AXIS_INDEX[axis]]!
    const pick = rng.fork(`pick/${axis}`)
    const answer = rng.fork(`answer/${axis}`)
    for (let i = 0; i < items; i++) {
      const post = sessionPosterior(obs)[axis]
      if (opts.stopSd !== undefined && i >= 3 && post.sd < opts.stopSd) break
      let cand = pool.filter((it) => !used.has(it.id))
      const target = startupTarget(bs.map((b, k) => ({ b, correct: ys[k]!, scored: 1 })))
      if (target !== null) {
        const keep = startupCompetes(cand.map((c) => c.b), target)
        cand = cand.filter((_, k) => keep[k])
      }
      const at = selectionAim(obs, { borrow: opts.borrow, ...(opts.earlier === undefined ? {} : { earlier: opts.earlier }) })[axis]!
      const ranked = cand.map((it) => ({ it, score: (info2pl(at, 1, it.b) * post.sd * post.sd) / it.et })).sort((x, y) => y.score - x.score || x.it.id - y.it.id)
      const it = ranked[pick.int(0, Math.min(5, ranked.length) - 1)]!.it
      used.add(it.id)
      const y: 0 | 1 = answer.next() < p2pl(th, 1, it.b) ? 1 : 0
      obs.push({ kind: '2pl', axis, a: 1, b: it.b, y })
      bs.push(it.b)
      ys.push(y)
      seconds += it.et
    }
    const post = sessionPosterior(obs)[axis]
    parts.push({ axis, theta: th, bs, ys, estimate: post.mean, sd: post.sd, seconds })
  }
  return { parts, obs }
}

/** Questions until one is within 0.5 of θ (1-based); items + 1 when none is. */
export function toWithin(p: Pick<PartResult, 'bs' | 'theta'>, items: number): number {
  const i = p.bs.findIndex((b) => Math.abs(b - p.theta) <= 0.5)
  return i < 0 ? items + 1 : i + 1
}

const SIGMA = initialSigma()
const SIGMA_L = cholesky(SIGMA)
const ZERO: readonly number[] = SIGMA.map(() => 0)

/** θ ~ N(0, Σ_init). */
export function drawTheta(rng: Rng): number[] {
  const z = SIGMA.map(() => rng.normal())
  return SIGMA_L.map((row) => row.reduce((t, l, j) => t + l * z[j]!, 0))
}

export type Group = 'population' | 'owner' | 'dip' | 'peak' | 'returning'

export interface GroupRow {
  readonly group: Group
  readonly borrow: number
  readonly n: number
  /** Mean over parts and takers of the questions until one within 0.5 (items + 1 when none). */
  readonly toWithin: number
  /** Share of parts with no question within 0.5. */
  readonly never: number
  /** Mean |b − θ| of the first question of a part. */
  readonly firstGap: number
  /** The same, for the first part only (nothing to borrow from yet) and for the later parts. */
  readonly firstGapLater: number
  /**
   * Reported scores over every part: r with θ (pooled over skills) and RMSE, of the server's model (the per-skill EAP,
   * `rescore`) and of the app's results (the correlated MAP over Σ, `save/rescore.ts`), each over the answers a
   * profile is made from: the session's, and for a returning taker both sessions' (as the results re-score them).
   */
  readonly r: number
  readonly rmse: number
  readonly rMap: number
  readonly rmseMap: number
  /** On the spiky skill (dip, peak): questions until within 0.5, the error of the reported score, its RMSE. */
  readonly spike?: { readonly toWithin: number; readonly bias: number; readonly rmse: number; readonly firstGap: number }
  /** Questions and minutes per session (with `stopSd` the parts end on their own; else fixed). */
  readonly questions: number
  readonly minutes: number
}

const mean = (xs: readonly number[]): number => (xs.length === 0 ? Number.NaN : xs.reduce((a, b) => a + b, 0) / xs.length)

export interface StudyOptions {
  readonly n?: number
  readonly borrows?: readonly number[]
  readonly items?: number
  readonly stopSd?: number
  readonly groups?: readonly Group[]
  readonly order?: readonly AxisCode[]
}

/** One group of takers at one borrowing strength (module comment). The same takers and seeds at every strength. */
export function groupRow(group: Group, borrow: number, opts: StudyOptions = {}): GroupRow {
  const n = opts.n ?? 300
  const items = opts.items ?? 6
  const order = opts.order ?? SESSION_AXES
  const people = createRng(`xskill-people:${group}`)
  const parts: PartResult[] = []
  const spikes: PartResult[] = []
  // the reported scores of each part (per-skill EAP, correlated MAP)
  const reported: { theta: number; eap: number; map: number }[] = []
  const spikeErr: number[] = []
  const firsts: number[] = []
  const laters: number[] = []
  let questions = 0
  let seconds = 0
  for (let i = 0; i < n; i++) {
    let theta = group === 'owner' ? SIGMA.map(() => 2.5) : drawTheta(people)
    let spiky: AxisCode | null = null
    if (group === 'dip' || group === 'peak') {
      spiky = order[1 + people.int(0, order.length - 2)]!
      theta = theta.slice()
      theta[AXIS_INDEX[spiky]] = theta[AXIS_INDEX[spiky]]! + (group === 'dip' ? -2.5 : 2.5)
    }
    const sopts = { borrow, items, order, ...(opts.stopSd === undefined ? {} : { stopSd: opts.stopSd }) }
    let earlier: Observation[] | undefined
    if (group === 'returning') earlier = simulateSession(theta, `${group}.${i}.first`, { ...sopts, borrow: 1 }).obs
    const s = simulateSession(theta, `${group}.${i}`, { ...sopts, ...(earlier === undefined || borrow === 0 ? {} : { earlier }) })
    const profileObs = earlier === undefined ? s.obs : [...earlier, ...s.obs]
    const eap = sessionPosterior(profileObs)
    const map = mapTheta(profileObs, ZERO, SIGMA).theta
    s.parts.forEach((p, k) => {
      parts.push(p)
      reported.push({ theta: p.theta, eap: eap[p.axis].mean, map: map[AXIS_INDEX[p.axis]]! })
      const gap = Math.abs(p.bs[0]! - p.theta)
      ;(k === 0 ? firsts : laters).push(gap)
      if (p.axis === spiky) {
        spikes.push(p)
        spikeErr.push(eap[p.axis].mean - p.theta)
      }
      questions += p.bs.length
      seconds += p.seconds
    })
  }
  const tw = parts.map((p) => toWithin(p, items))
  const err = reported.map((x) => x.eap - x.theta)
  const errMap = reported.map((x) => x.map - x.theta)
  return {
    group,
    borrow,
    n,
    toWithin: mean(tw),
    never: tw.filter((x) => x > items).length / tw.length,
    firstGap: mean([...firsts, ...laters]),
    firstGapLater: mean(laters),
    r: pearson(reported.map((x) => x.theta), reported.map((x) => x.eap)),
    rmse: Math.sqrt(mean(err.map((e) => e * e))),
    rMap: pearson(reported.map((x) => x.theta), reported.map((x) => x.map)),
    rmseMap: Math.sqrt(mean(errMap.map((e) => e * e))),
    ...(spikes.length > 0
      ? {
          spike: {
            toWithin: mean(spikes.map((p) => toWithin(p, items))),
            bias: mean(spikeErr),
            rmse: Math.sqrt(mean(spikeErr.map((e) => e * e))),
            firstGap: mean(spikes.map((p) => Math.abs(p.bs[0]! - p.theta))),
          },
        }
      : {}),
    questions: questions / n,
    minutes: seconds / n / 60,
  }
}

export interface XskillStudy {
  readonly items: number
  readonly stopSd: number | null
  readonly rows: readonly GroupRow[]
}

export const STUDY_BORROWS: readonly number[] = Object.freeze([0, 0.5, 0.75, 1])

export function xskillStudy(opts: StudyOptions = {}): XskillStudy {
  const groups = opts.groups ?? (['population', 'owner', 'dip', 'peak', 'returning'] as const)
  const rows = groups.flatMap((g) => (opts.borrows ?? STUDY_BORROWS).map((s) => groupRow(g, s, opts)))
  return { items: opts.items ?? 6, stopSd: opts.stopSd ?? null, rows }
}

const f2 = (x: number): string => (x >= 0 ? ' ' : '') + x.toFixed(2)

export function formatXskill(s: XskillStudy): string {
  const lines: string[] = []
  const how = s.stopSd === null ? `${s.items} questions a part` : `each part until SD < ${s.stopSd} (3 to ${s.items} questions)`
  lines.push(`Cross-skill aim (xskill.ts): ten parts (${SESSION_AXES.join(' ')}), ${how}; stand-in pools b −2.5 … 3.5, a = 1`)
  lines.push('  takers       s     n   to within 0.5  none   |b1−θ| all/later   per-skill r  RMSE   joint r  RMSE    spiky skill: to within  error   RMSE  |b1−θ|   questions  minutes')
  for (const r of s.rows) {
    const spike = r.spike === undefined ? ''.padEnd(40) : `${r.spike.toWithin.toFixed(2).padStart(5)}       ${f2(r.spike.bias)}  ${r.spike.rmse.toFixed(3)}  ${r.spike.firstGap.toFixed(2)}`
    lines.push(
      `  ${r.group.padEnd(10)} ${r.borrow.toFixed(2)} ${String(r.n).padStart(5)}   ${r.toWithin.toFixed(2).padStart(5)}        ${(100 * r.never).toFixed(0).padStart(3)}%   ${r.firstGap.toFixed(2)} / ${r.firstGapLater.toFixed(2)}      ${r.r.toFixed(3)}  ${r.rmse.toFixed(3)}   ${r.rMap.toFixed(3)}  ${r.rmseMap.toFixed(3)}   ${spike.padEnd(40)}   ${r.questions.toFixed(1).padStart(5)}   ${r.minutes.toFixed(1).padStart(5)}`,
    )
  }
  return lines.join('\n')
}

/**
 * The order question (plan item 3): the parts sorted by how much each says about the others (the sum of its
 * squared correlations with the session's other skills in Σ, highest first), against the session's order.
 */
export function learnFirstOrder(axes: readonly AxisCode[] = SESSION_AXES): AxisCode[] {
  const w = (k: AxisCode): number => axes.reduce((t, j) => t + (j === k ? 0 : SIGMA[AXIS_INDEX[k]]![AXIS_INDEX[j]]! ** 2), 0)
  return [...axes].sort((a, b) => w(b) - w(a) || AXIS_INDEX[a] - AXIS_INDEX[b])
}
