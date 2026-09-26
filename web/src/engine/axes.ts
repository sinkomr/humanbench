/**
 * Axis registry and the initial correlation matrix Σ (DESIGN §3, §7.2, §9).
 *
 * The 17 axes are the construct map of DESIGN §3 in the canonical order shared with the Python
 * reference scorer (bank `hb.axes`). Every θ vector and Σ matrix is indexed in this order.
 */

import { symmetricEigen, type Matrix } from './linalg'

/** Axis codes in canonical order (DESIGN §3). */
export const AXIS_CODES = [
  'MAT',
  'LR',
  'LG',
  'RC',
  'VOC',
  'QR',
  'SPA',
  'WM',
  'RT',
  'PS',
  'FER',
  'CAL',
  'KST',
  'KHU',
  'KAP',
  'EMO',
  'CRE',
] as const

export type AxisCode = (typeof AXIS_CODES)[number]

/** Clusters in first-appearance order (DESIGN §3). */
export const CLUSTERS = [
  'Reasoning',
  'Verbal',
  'Quantitative',
  'Spatial/Memory',
  'Speed',
  'Estimation',
  'Knowledge',
  'Social-Creative',
] as const

export type Cluster = (typeof CLUSTERS)[number]

/** Gold-verification tier (DESIGN §4): a = machine-verifiable key, b = cited/continuous, c = consensus. */
export type GoldTier = 'a' | 'b' | 'c'

/** Person-scoring model family for an axis (DESIGN §7.1). */
export type ModelKind = '2pl' | '3pl' | '2pl_testlet' | 'grm' | 'gaussian'

/** 'active' = measured in v1; 'v2' = shown as "not yet measured" in v1 (DESIGN §3). */
export type AxisStatus = 'active' | 'v2'

/** Label glyph per gold tier (DESIGN §9): tier b "○", tier c "◇", tier a none. */
export const TIER_GLYPH: Readonly<Record<GoldTier, string>> = { a: '', b: '○', c: '◇' }

export interface AxisDef {
  readonly code: AxisCode
  /** Position in the canonical order (index into θ and Σ). */
  readonly index: number
  readonly name: string
  readonly cluster: Cluster
  /** CHC broad ability (or 'metacognition' for Calibration). */
  readonly chc: string
  readonly tier: GoldTier
  readonly glyph: string
  readonly modelKind: ModelKind
  readonly status: AxisStatus
  /** True for axes scored from other items at no separate time cost (Calibration). */
  readonly embedded: boolean
}

type Row = [AxisCode, string, Cluster, string, GoldTier, ModelKind, AxisStatus, boolean?]

// code | name | cluster | CHC | tier | model | status | embedded  (DESIGN §3 table rows 1–17)
const ROWS: readonly Row[] = [
  ['MAT', 'Matrix & Series', 'Reasoning', 'Gf', 'a', '2pl', 'active'],
  ['LR', 'Logical Reasoning', 'Reasoning', 'Gf-verbal', 'a', '3pl', 'active'],
  ['LG', 'Analytical/Logic Games', 'Reasoning', 'Gf-RQ', 'a', '2pl_testlet', 'active'],
  ['RC', 'Reading Comprehension', 'Verbal', 'Grw', 'a', '2pl_testlet', 'active'],
  ['VOC', 'Vocabulary & Verbal Analogies', 'Verbal', 'Gc', 'a', '2pl', 'active'],
  ['QR', 'Quantitative Reasoning', 'Quantitative', 'Gq/RQ', 'a', '2pl', 'active'],
  ['SPA', 'Spatial', 'Spatial/Memory', 'Gv', 'a', '2pl', 'active'],
  ['WM', 'Working Memory', 'Spatial/Memory', 'Gwm', 'b', 'grm', 'active'],
  ['RT', 'Reaction Time', 'Speed', 'Gt', 'b', 'gaussian', 'active'],
  ['PS', 'Processing & Reading Speed', 'Speed', 'Gs', 'b', 'gaussian', 'active'],
  ['FER', 'Fermi Estimation', 'Estimation', 'Gq×Gkn', 'b', 'gaussian', 'active'],
  ['CAL', 'Calibration/Metacognition', 'Estimation', 'metacognition', 'b', 'gaussian', 'active', true],
  ['KST', 'STEM Knowledge', 'Knowledge', 'Gkn', 'a', '2pl', 'active'],
  ['KHU', 'Humanities Knowledge', 'Knowledge', 'Gkn', 'a', '2pl', 'active'],
  ['KAP', 'Arts & Practical Knowledge', 'Knowledge', 'Gkn', 'a', '2pl', 'active'],
  ['EMO', 'Emotion Reading (text scenarios)', 'Social-Creative', 'Gei', 'c', '2pl', 'v2'],
  ['CRE', 'Creative Thinking', 'Social-Creative', 'Gr/Gi', 'c', '2pl', 'v2'],
]

/** The 17 axes in canonical order (DESIGN §3). */
export const AXES: readonly AxisDef[] = Object.freeze(
  ROWS.map(([code, name, cluster, chc, tier, modelKind, status, embedded], index) =>
    Object.freeze({
      code,
      index,
      name,
      cluster,
      chc,
      tier,
      glyph: TIER_GLYPH[tier],
      modelKind,
      status,
      embedded: embedded ?? false,
    }),
  ),
)

export const N_AXES = AXES.length

/** Canonical index of each axis code. */
export const AXIS_INDEX: Readonly<Record<AxisCode, number>> = Object.freeze(
  Object.fromEntries(AXIS_CODES.map((c, i) => [c, i])) as Record<AxisCode, number>,
)

/** Type guard for axis codes (e.g. when parsing a save file). */
export function isAxisCode(s: unknown): s is AxisCode {
  return typeof s === 'string' && Object.hasOwn(AXIS_INDEX, s)
}

/** Look up an axis definition by code. */
export function axis(code: AxisCode): AxisDef {
  return AXES[AXIS_INDEX[code]] as AxisDef
}

// ---------------------------------------------------------------------------- initial Σ

/** Eigenvalue floor for {@link nearestPD} (DESIGN §7.2). */
export const SIGMA_EIGEN_FLOOR = 0.05

export const R_CAL = 0.2
export const R_SPEED = 0.2
export const R_SOCIAL_CREATIVE = 0.3
export const R_SAME_CLUSTER = 0.55
export const R_REASONING_KNOWLEDGE = 0.45
/**
 * [SPEC] DESIGN §3 states no default for the remaining cross-cluster pairs; .40 is the value
 * fixed by the shared axis spec (both repos). It is a deliberately conservative starting point,
 * not a reading of §3: it sits *below* the .5–.7 that §3 quotes for Matrix/Series↔Quant (MAT↔QR),
 * LR↔RC and Reading Comp↔Vocabulary↔Humanities (RC↔KHU, VOC↔KHU). §3 re-estimates Σ nightly
 * from person posteriors once N ≥ 500, so this is only a starting value.
 */
export const R_DEFAULT = 0.4

/**
 * Initial correlation between two axes (DESIGN §3: "within-cluster .55, Reasoning↔Knowledge
 * .45, Speed↔others .2, Social-Creative↔others .3"), by the first matching rule:
 * 1. either axis is CAL → .20 (§3: "Calibration ↔ ability .1–.3");
 * 2. either axis in Speed → .20, except RT↔PS (same cluster) → .55;
 * 3. either axis in Social-Creative → .30, except EMO↔CRE (same cluster) → .55;
 * 4. same cluster → .55;
 * 5. Reasoning↔Knowledge → .45;
 * 6. otherwise → .40 [SPEC].
 */
export function initialCorrelation(a: AxisCode, b: AxisCode): number {
  if (a === b) return 1
  const ca = axis(a).cluster
  const cb = axis(b).cluster
  const same = ca === cb
  if (a === 'CAL' || b === 'CAL') return R_CAL
  if (ca === 'Speed' || cb === 'Speed') return same ? R_SAME_CLUSTER : R_SPEED
  if (ca === 'Social-Creative' || cb === 'Social-Creative') return same ? R_SAME_CLUSTER : R_SOCIAL_CREATIVE
  if (same) return R_SAME_CLUSTER
  if ((ca === 'Reasoning' && cb === 'Knowledge') || (ca === 'Knowledge' && cb === 'Reasoning')) {
    return R_REASONING_KNOWLEDGE
  }
  return R_DEFAULT
}

/** The rule-based correlation matrix before projection. */
export function rawInitialSigma(): Matrix {
  return AXIS_CODES.map((a) => AXIS_CODES.map((b) => initialCorrelation(a, b)))
}

/**
 * The initial 17×17 prior correlation matrix Σ (DESIGN §3), passed through {@link nearestPD}.
 * The raw matrix is already PD with every eigenvalue above the floor, so it comes back unchanged.
 * Returns a fresh copy on every call.
 */
export function initialSigma(): Matrix {
  return nearestPD(rawInitialSigma())
}

/**
 * Project a symmetric matrix to a positive-definite correlation matrix (DESIGN §7.2):
 * symmetrise; Jacobi eigen-decomposition; if any eigenvalue is below `floor`, clip it up to
 * `floor` and reconstruct V·diag(w)·Vᵀ; rescale to unit diagonal D^{-1/2}·A·D^{-1/2}.
 * A valid correlation matrix whose eigenvalues all clear the floor is returned unchanged
 * (bit for bit, as in the Python reference `hb.axes.nearest_pd`). The rescaling is a
 * congruence, so the result stays PD, though its smallest eigenvalue can end up slightly
 * below `floor`.
 */
export function nearestPD(m: Matrix, floor = SIGMA_EIGEN_FLOOR): Matrix {
  const n = m.length
  if (n === 0 || m.some((row) => row.length !== n)) {
    throw new RangeError('nearestPD needs a non-empty square matrix')
  }
  if (m.some((row) => row.some((v) => !Number.isFinite(v)))) {
    throw new RangeError('nearestPD needs a finite matrix')
  }
  if (!(floor > 0)) throw new RangeError('nearestPD floor must be positive')

  let a: Matrix = m.map((row, i) => row.map((v, j) => (v + m[j]![i]!) / 2))
  const { values, vectors } = symmetricEigen(a)
  if (values[0]! < floor) {
    const w = values.map((x) => Math.max(x, floor))
    const r: Matrix = Array.from({ length: n }, (_, i) =>
      Array.from({ length: n }, (_, j) => {
        let s = 0
        for (let k = 0; k < n; k++) s += vectors[i]![k]! * w[k]! * vectors[j]![k]!
        return s
      }),
    )
    a = r.map((row, i) => row.map((v, j) => (v + r[j]![i]!) / 2))
  }
  const d = a.map((row, i) => Math.sqrt(row[i]!))
  return a.map((row, i) => row.map((v, j) => (i === j ? 1 : v / (d[i]! * d[j]!))))
}
