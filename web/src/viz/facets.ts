/**
 * Drill-down facet scores (DESIGN §9.6, §3 "sub-facets reported only in drill-down"; ROADMAP A7,
 * A12, M1.16; UX review D4, provisional default option A).
 *
 * A12 as written: a facet score is a unidimensional grid EAP (the engine's `eapAxis`, §11.2) on that
 * facet's items, shown only at ≥ 5 items; below that the facet shows "insufficient data" and no
 * number (§9.6). A7: drill-down is by cluster wedge, so a cluster's facets are those of its axes.
 *
 * The prior (UX review D4, UX-072; a provisional default: A12 in ROADMAP is not amended). A12 puts
 * the AXIS posterior N(θ_k, cov_kk) under the facet's items, but that posterior already holds them,
 * so they counted twice: every facet came out narrower than its axis, and an axis with one facet
 * showed a credible low its axis did not (DATA-02). The prior for facet f is now the axis posterior
 * WITHOUT f's own observations (a leave-facet-out prior), and f's items are added once:
 * - How f is taken out: a Laplace "cavity" of the axis posterior the blob shows ({@link leaveOutPrior}).
 *   The scorer's posterior is Gaussian with precision P = Σ⁻¹ + diag(I(θ̂)), I the expected
 *   information at the MAP (§7.2). Taking f's information I_f off axis k changes P_kk alone, so the
 *   marginal precision of θ_k drops by exactly I_f (Schur complement): 1/v = 1/cov_kk − I_f. The mean
 *   is one Newton step of the leave-out log posterior from θ̂, whose gradient there is −s_f (s_f the
 *   score of f's items): m = θ̂_k − v·s_f(θ̂_k). For Gaussian terms (the timed blocks) this is the
 *   exact re-score without f; for 2PL, 3PL, GRM and testlet terms it is the leave-out of the
 *   scorer's own Laplace approximation, with the same (expected) information.
 * - Why not an exact re-score: the page does not hold everything the profile's posterior holds (the
 *   per-session Calibration observation, answers the server scored, an axis whose estimate the
 *   server's replaced: `reveal/results.ts`), but it always holds the posterior itself. The cavity
 *   works on exactly what the blob shows, so a facet and its axis never read different data.
 * - A facet that holds every observation of its axis shows the axis estimate itself: its leave-out
 *   prior times its likelihood IS the axis posterior, and recomputing that as an EAP would only
 *   approximate the same posterior a second way.
 * - Inputs that do not agree (a posterior that lacks f's items, e.g. an axis the server scored): a
 *   cavity less precise than the population prior N(0, Σ_kk) cannot be a leave-out posterior, and
 *   the population prior is used instead.
 *
 * What this means on screen: the leave-out prior times f's likelihood is the axis posterior again,
 * so a facet's estimate lands on (about) its axis's, with about its width, whichever facet it is.
 * Facets can differ from their axis only once the model has a person-by-facet variance (the τ of
 * AI.20, F13): prior N(m, v + τ²). Until then a facet shows no more than its axis supports.
 *
 * Quantitative (UX review D4, DATA-14): a quant item's facet is its generator template (18 of them,
 * 2–5 variants each, A11), which almost never reaches 5 items in a session. The drill-down groups
 * them into the six topic groups of `tasks/quant/topics.ts` (A23, AI.3) for counting, estimation and
 * labels ({@link drillFacet}); `facets-groups.test.ts` fails if a template has no group.
 *
 * What counts toward the ≥ 5 (decision, M1.16 review): scored observations, as A12 reads. An item
 * is one; a block (A18 `BlockScore`: one digit-span, Corsi, RT, coding or reading administration)
 * is also ONE, because the scorer sees it as one observation (A10: one GRM or Gaussian likelihood
 * term), however many trials it had. So a block facet needs 5 administrations, e.g. over several
 * sessions, and until then shows "insufficient data (n blocks; 5 needed)", counted in blocks.
 * Whether a block's trials should count instead is an open question for an ADR (followup).
 *
 * A facet of an axis the blob does not measure (skipped, not offered, no data) is "not measured"
 * with the axis's reason, never "insufficient data".
 */

import { axisName } from '../axis-names'
import { AXES, AXIS_INDEX, initialSigma, type AxisCode, type Cluster } from '../engine/axes'
import { observationInfo, observationScore } from '../engine/irt'
import { eapAxis } from '../engine/scorer'
import type { Observation } from '../engine/types'
import { QUANT_GROUPS, quantGroupOfTemplate } from '../tasks/quant/topics'
import { measuredFields, type AxisEstimate, type NotMeasuredReason, type ProfileScore, type SpokeEstimate } from './profile'

/** A12 / §9.6: facets with fewer items show "insufficient data". */
export const FACET_MIN_ITEMS = 5

/** One scored observation tagged with its item's facet (`ItemBase.facet`, family contract). */
export interface FacetObservation {
  readonly facet: string
  readonly obs: Observation
  /** From a block family (`kind: 'block'`, A18): one administration, counted as one (module comment). */
  readonly block?: boolean
}

/** What a facet's count counts: items, or block administrations (module comment). */
export type CountUnit = 'item' | 'block'

export interface FacetEstimate extends SpokeEstimate {
  readonly axis: AxisCode
  readonly facet: string
  /** Scored observations on this facet: items, or blocks (`unit`). */
  readonly nItems: number
  readonly unit: CountUnit
}

/**
 * The facet an item's facet is shown under in the drill-down: a quant template's topic group
 * (`percent` → `quant/arith_fractions_percent`, module comment), else the facet itself. A group id
 * maps to itself, so applying it twice changes nothing.
 */
export function drillFacet(axis: AxisCode, facet: string): string {
  return axis === 'QR' ? (quantGroupOfTemplate(facet)?.id ?? facet) : facet
}

/**
 * What each facet is called on screen (UX-040): plain words, not the generator's code. The keys are
 * the facet ids the task families declare (`family.facets`, the quant templates, the RT and span
 * modes) and the quant topic groups the drill-down shows ({@link drillFacet}); `facets.test.ts`
 * checks that every registered one has an entry. Anything else falls back to the id with underscores
 * turned into spaces.
 */
export const FACET_LABELS: Readonly<Record<string, string>> = Object.freeze({
  simple_rt: 'Simple reaction time',
  choice_rt: 'Choice reaction time',
  coding: 'Shape to digit',
  reading_speed: 'Reading speed',
  matrix: 'Matrices',
  series: 'Sequences',
  '3d_rotation': 'Mental rotation (3D)',
  digits_forward: 'Digits, same order',
  digits_backward: 'Digits, reverse order',
  corsi: 'Block sequence',
  arith: 'Arithmetic',
  percent: 'Percentages',
  fraction: 'Fractions',
  fraction_of: 'Fractions of amounts',
  ratio: 'Ratios',
  rate: 'Rates',
  mean: 'Averages',
  linear_eq: 'Linear equations',
  system: 'Simultaneous equations',
  exponent: 'Powers',
  quadratic: 'Quadratics',
  probability: 'Probability',
  counting: 'Counting',
  arith_series: 'Arithmetic sequences',
  geom_series: 'Geometric sequences',
  modular: 'Remainders',
  recip: 'Reciprocals',
  symmetric: 'Symmetric expressions',
  confidence: 'Confidence ratings',
  // What the Quantitative drill-down shows (DATA-14): the topic groups, by their own labels.
  ...Object.fromEntries(QUANT_GROUPS.map((g) => [g.id, g.label])),
  // M6 tier (c) facets (DESIGN §5.2-§5.4): the alternative-uses facet carries its "experimental" label (§5.4: the
  // in-browser distance score is noisy).
  situational_judgment: 'Situational judgment',
  remote_associates: 'Word links',
  alternative_uses: 'Unusual uses (experimental)',
  appraisal_vignettes: 'Emotion scenarios',
})

/** The on-screen name of a facet id: {@link FACET_LABELS}, else the id as words ("odd_one_out" → "Odd one out"). */
export function facetLabel(facet: string): string {
  if (Object.hasOwn(FACET_LABELS, facet)) return FACET_LABELS[facet]!
  const s = facet.replace(/[_-]+/g, ' ').trim()
  return s.charAt(0).toUpperCase() + s.slice(1)
}

/** The longest facet name drawn on one chart line ("Simultaneous equations"); a longer one takes two. */
export const FACET_LINE_CHARS = 22

/**
 * The chart label lines of a facet name: one line up to {@link FACET_LINE_CHARS} characters, else two,
 * split at the space nearest the middle ("Arithmetic, fractions" / "and percentages"). The words are the
 * name's, so a spoke matches its table row (UX-042).
 */
export function facetLabelLines(name: string): readonly string[] {
  if (name.length <= FACET_LINE_CHARS) return [name]
  const mid = name.length / 2
  let cut = -1
  for (let i = name.indexOf(' '); i >= 0; i = name.indexOf(' ', i + 1)) {
    if (cut < 0 || Math.abs(i - mid) < Math.abs(cut - mid)) cut = i
  }
  return cut < 0 ? [name] : [name.slice(0, cut), name.slice(cut + 1)]
}

/**
 * A facet estimate computed elsewhere: the server's own-axis posterior for the facets of the parts it
 * scores (M2.7, `rescore`; the page never holds those answers' verdicts, R-11.1), as mean, sd (SD
 * units) and the number of answers behind it. The server shows a facet only from 5 answers of one
 * session, the same bar as {@link FACET_MIN_ITEMS}, and keys quant facets by topic group as
 * {@link drillFacet} does.
 */
export interface PrecomputedFacet {
  readonly mean: number
  readonly sd: number
  readonly n: number
}

export interface FacetOptions {
  /** Known facets per axis, listed even with no items (e.g. from the family registry). */
  readonly catalog?: Partial<Record<AxisCode, readonly string[]>>
  /** Facet estimates that arrive computed (the server's, M2.7), per axis and facet; they replace a local estimate of the same facet. */
  readonly precomputed?: Readonly<Partial<Record<AxisCode, Readonly<Record<string, PrecomputedFacet>>>>>
  /**
   * Axes that are not measured on the blob, with the reason (skipped, not offered, no data): their
   * facets get no number and show that reason ({@link unmeasuredReasons}).
   */
  readonly unmeasured?: Readonly<Partial<Record<AxisCode, NotMeasuredReason>>>
}

/** The {@link FacetOptions.unmeasured} map of a blob's axis estimates. */
export function unmeasuredReasons(estimates: readonly AxisEstimate[]): Partial<Record<AxisCode, NotMeasuredReason>> {
  const out: Partial<Record<AxisCode, NotMeasuredReason>> = {}
  for (const e of estimates) if (!e.measured) out[e.code] = e.reason ?? 'no_data'
  return out
}

/** A Gaussian prior on one axis, in SD units (a variance, not an SD). */
export interface FacetPrior {
  readonly mean: number
  readonly variance: number
}

let populationVariance: readonly number[] | undefined

/** Σ_kk of the pinned population prior (A8; a correlation matrix, so 1 today). */
function populationVar(k: number): number {
  populationVariance ??= initialSigma().map((row, i) => row[i]!)
  return populationVariance[k]!
}

/**
 * The axis posterior of `score` on `axis` without the observations `removed` (all on `axis`): the
 * Laplace cavity of the module comment, 1/v = 1/cov_kk − I(θ̂_k) and m = θ̂_k − v·s(θ̂_k), with I and
 * s the expected information and the score of `removed` at θ̂_k. The population prior N(0, Σ_kk)
 * when the cavity would be less precise than it (inputs that do not agree, module comment). With
 * nothing removed it is N(θ̂_k, cov_kk).
 */
export function leaveOutPrior(score: Pick<ProfileScore, 'theta' | 'cov'>, axis: AxisCode, removed: readonly Observation[]): FacetPrior {
  const k = AXIS_INDEX[axis]
  const theta = score.theta[k]!
  const cov = score.cov[k]![k]!
  let info = 0
  let grad = 0
  for (const o of removed) {
    if (o.axis !== axis) throw new RangeError(`leaveOutPrior: an observation on ${o.axis}, not ${axis}`)
    info += observationInfo(o, theta)
    grad += observationScore(o, theta)
  }
  const pop = populationVar(k)
  const precision = 1 / cov - info
  if (!Number.isFinite(precision) || !(precision >= 1 / pop)) return { mean: 0, variance: pop }
  const variance = 1 / precision
  return { mean: theta - variance * grad, variance }
}

const GROUP_RANK: ReadonlyMap<string, number> = new Map(QUANT_GROUPS.map((g, i) => [g.id, i]))

/** Sort key: the quant groups in their display order (`QUANT_GROUPS`) first, any other facet after them, in the order given (a stable sort). */
function groupRank(facet: string): number {
  return GROUP_RANK.get(facet) ?? QUANT_GROUPS.length
}

/** One axis's `precomputed` facets under their drill-down ids; two that land on one id give none (they cannot be combined). */
function drillPrecomputed(axis: AxisCode, pre: Readonly<Record<string, PrecomputedFacet>>): Record<string, PrecomputedFacet> {
  const out: Record<string, PrecomputedFacet> = {}
  const clash = new Set<string>()
  for (const [facet, value] of Object.entries(pre)) {
    const id = drillFacet(axis, facet)
    if (Object.hasOwn(out, id)) clash.add(id)
    out[id] = value
  }
  for (const id of clash) delete out[id]
  return out
}

/**
 * Facet estimates for the axes of `cluster`, grouped by axis in canonical order, facets in catalog
 * order then first appearance (quant templates as their topic groups, {@link drillFacet}, in the
 * groups' display order). A facet
 * with ≥ {@link FACET_MIN_ITEMS} observations on a measured axis is measured, on its leave-facet-out
 * prior (module comment); a facet of an unmeasured axis is a stub with the axis's reason; any other
 * is a stub with reason 'insufficient_data' (§9.6: "insufficient data").
 */
export function clusterFacets(score: ProfileScore, observations: readonly FacetObservation[], cluster: Cluster, opts: FacetOptions = {}): FacetEstimate[] {
  const unmeasured = opts.unmeasured ?? {}
  const out: FacetEstimate[] = []
  for (const a of AXES) {
    if (a.cluster !== cluster) continue
    const mine = observations.filter((o) => o.obs.axis === a.code).map((o) => ({ ...o, facet: drillFacet(a.code, o.facet) }))
    const pre = drillPrecomputed(a.code, opts.precomputed?.[a.code] ?? {})
    const catalog = (opts.catalog?.[a.code] ?? []).map((f) => drillFacet(a.code, f))
    const facets = [...new Set([...catalog, ...mine.map((o) => o.facet), ...Object.keys(pre)])].sort((x, y) => groupRank(x) - groupRank(y))
    for (const facet of facets) {
      const tagged = mine.filter((o) => o.facet === facet)
      const obs = tagged.map((o) => o.obs)
      const name = facetLabel(facet)
      const base = {
        id: `${a.code}:${facet}`,
        axis: a.code,
        facet,
        name,
        shortLabel: facetLabelLines(name),
        group: axisName(a.code),
        tier: a.tier,
        glyph: a.glyph,
        nItems: obs.length,
        unit: tagged.length > 0 && tagged.every((o) => o.block === true) ? ('block' as const) : ('item' as const),
      }
      const axisReason = unmeasured[a.code]
      if (axisReason !== undefined) {
        out.push({ ...base, measured: false, reason: axisReason, muted: false })
        continue
      }
      const given = Object.hasOwn(pre, facet) ? pre[facet] : undefined
      if (given !== undefined) {
        out.push({ ...base, nItems: given.n, unit: 'item', ...measuredFields(given.mean, given.sd) })
        continue
      }
      if (obs.length < FACET_MIN_ITEMS) {
        out.push({ ...base, measured: false, reason: 'insufficient_data', muted: false })
        continue
      }
      const k = AXIS_INDEX[a.code]
      if (obs.length === mine.length) {
        // Every observation of the axis is this facet's: its posterior is the axis's (module comment).
        out.push({ ...base, ...measuredFields(score.theta[k]!, Math.sqrt(score.cov[k]![k]!)) })
        continue
      }
      const prior = leaveOutPrior(score, a.code, obs)
      const est = eapAxis(obs, prior.mean, prior.variance)
      out.push({ ...base, ...measuredFields(est.mean, est.sd) })
    }
  }
  return out
}
