/**
 * Axis registry and the initial correlation matrix Σ (DESIGN §3, §7.2, §9).
 *
 * The 17 axes are the construct map of DESIGN §3 in the canonical order shared with the Python
 * reference scorer (bank `hb.axes`). Every θ vector and Σ matrix is indexed in this order.
 */

import { symmetricEigen, tryCholesky, type Matrix } from './linalg'

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

/**
 * An item's scoring model (DESIGN §7.1; `ItemParams.model`, `Observation.kind`). The model belongs
 * to the ITEM, not the axis: keyed MC by option count (ROADMAP A9, §7.1 wins over §3), k ≤ 4
 * options → 3PL with c = 1/k, k ≥ 5 options or numeric entry → 2PL; blocks per A10.
 */
export type ModelKind = '2pl' | '3pl' | '2pl_testlet' | 'grm' | 'gaussian'

/** Response-model family of a {@link ModelKind}: keyed right/wrong, graded categories, or continuous. */
export type ModelFamily = 'dichotomous' | 'graded' | 'continuous'

/** The {@link ModelFamily} of a model: 2PL, 3PL and 2PL-testlet are dichotomous, GRM graded, Gaussian continuous. */
export function modelFamilyOf(kind: ModelKind): ModelFamily {
  switch (kind) {
    case '2pl':
    case '3pl':
    case '2pl_testlet':
      return 'dichotomous'
    case 'grm':
      return 'graded'
    case 'gaussian':
      return 'continuous'
  }
}

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
  /**
   * The model of the axis's typical item: DESIGN §3's "Scoring model" column as amended by A9
   * (LR: 5 options → 2PL; SPA: 4-option rotation → 3PL, c = 1/4). Informational only (labels,
   * the shared axis spec, simulations). Items carry their own model and one axis may mix models
   * (A9 decides per item by option count), so likelihood and information are always taken from
   * the item's `params.model` / the observation's `kind`, never from this field. An item's model
   * must only share its {@link modelFamilyOf family} (tested per registered task family).
   */
  readonly defaultModelKind: ModelKind
  readonly status: AxisStatus
  /** True for axes scored from other items at no separate time cost (Calibration). */
  readonly embedded: boolean
}

type Row = [AxisCode, string, Cluster, string, GoldTier, ModelKind, AxisStatus, boolean?]

// code | name | cluster | CHC | tier | default model | status | embedded  (DESIGN §3 rows 1–17, A9)
const ROWS: readonly Row[] = [
  ['MAT', 'Matrix & Series', 'Reasoning', 'Gf', 'a', '2pl', 'active'],
  ['LR', 'Logical Reasoning', 'Reasoning', 'Gf-verbal', 'a', '2pl', 'active'], // 5-option MC → 2PL (A9)
  ['LG', 'Analytical/Logic Games', 'Reasoning', 'Gf-RQ', 'a', '2pl_testlet', 'active'],
  ['RC', 'Reading Comprehension', 'Verbal', 'Grw', 'a', '2pl_testlet', 'active'],
  ['VOC', 'Vocabulary & Verbal Analogies', 'Verbal', 'Gc', 'a', '2pl', 'active'],
  ['QR', 'Quantitative Reasoning', 'Quantitative', 'Gq/RQ', 'a', '2pl', 'active'],
  ['SPA', 'Spatial', 'Spatial/Memory', 'Gv', 'a', '3pl', 'active'], // 4-option rotation → 3PL, no RT covariate (A9)
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
  ROWS.map(([code, name, cluster, chc, tier, defaultModelKind, status, embedded], index) =>
    Object.freeze({
      code,
      index,
      name,
      cluster,
      chc,
      tier,
      glyph: TIER_GLYPH[tier],
      defaultModelKind,
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
/** Absolute tolerance on the floor in {@link nearestPD}; the same as bank `NEAREST_PD_TOL`. */
export const NEAREST_PD_TOL = 1e-12

/** Pinned version of the initial Σ (ROADMAP A8); seriation uses the pinned Σ (§9.4). */
export const SIGMA_VERSION = 'sigma-v2-2026-09-26'

type LiteraturePair = readonly [AxisCode, AxisCode, number]

/**
 * Rule (1) of Σ_init v2 (ROADMAP A8): pairs listed in the §3 expected-intercorrelation table,
 * at the midpoint of the quoted range. Frozen all the way down: the pinned Σ must not change
 * under a fixed {@link SIGMA_VERSION}.
 */
export const R_LITERATURE: readonly LiteraturePair[] = Object.freeze(
  (
    [
      ['MAT', 'QR', 0.6], // Matrix/Series ↔ Quant .5–.7
      ['MAT', 'LG', 0.6], // Matrix/Series ↔ Logic Games .5–.7
      ['MAT', 'SPA', 0.5], // Matrix ↔ Spatial .4–.6
      ['RC', 'VOC', 0.6], // Reading Comp ↔ Vocabulary ↔ Humanities .5–.7
      ['RC', 'KHU', 0.6],
      ['VOC', 'KHU', 0.6],
      ['LR', 'RC', 0.6], // Logical Reasoning ↔ Reading Comp .5–.7
      ['WM', 'MAT', 0.4], // Working Memory ↔ Gf .3–.5
      ['WM', 'LR', 0.4],
      ['WM', 'LG', 0.4],
      ['RT', 'MAT', 0.28], // Choice RT ↔ g |−.2 to −.35| (faster = higher θ_RT)
      ['RT', 'LR', 0.28],
      ['RT', 'LG', 0.28],
      ['PS', 'RC', 0.3], // Reading speed ↔ Reading comp .2–.4
      ['FER', 'QR', 0.4], // Fermi ↔ Quant, STEM knowledge .3–.5
      ['FER', 'KST', 0.4],
      ['EMO', 'VOC', 0.4], // Emotion understanding ↔ Gc .3–.5
      ['EMO', 'KHU', 0.4],
      // Divergent thinking ↔ g .15–.3
      ...(['MAT', 'LR', 'LG', 'RC', 'VOC', 'QR', 'SPA', 'WM', 'FER', 'KST', 'KHU', 'KAP'] as const).map(
        (x): LiteraturePair => ['CRE', x, 0.23],
      ),
    ] satisfies LiteraturePair[]
  ).map((p): LiteraturePair => Object.freeze(p)),
)

const LITERATURE_R: ReadonlyMap<string, number> = new Map(
  R_LITERATURE.flatMap(([a, b, v]) => [
    [`${a}|${b}`, v],
    [`${b}|${a}`, v],
  ]),
)

export const R_CAL = 0.2
export const R_SPEED = 0.2
export const R_SOCIAL_CREATIVE = 0.3
export const R_SAME_CLUSTER = 0.55
export const R_REASONING_KNOWLEDGE = 0.45
/** Rule (3) of Σ_init v2 (ROADMAP A8): every pair that neither the §3 table nor a §3 rule covers. */
export const R_DEFAULT = 0.35

/**
 * Whether {@link nearestPD} changed the raw Σ_init v2 (ROADMAP A8). It does not: the raw matrix
 * is PD with every eigenvalue above the floor (smallest ≈ 0.195), so the stored Σ is the rule
 * matrix itself, identical to bank `golden/sigma_v2.json` (tested).
 */
export const SIGMA_NEAREST_PD_CHANGED = false

/**
 * Initial correlation between two axes, Σ_init v2 (ROADMAP A8), by the first matching rule:
 * 1. the pair is listed in the §3 expected-r table → its midpoint ({@link R_LITERATURE});
 * 2. the §3 "Initial Σ" rules, in order: either axis is CAL → .20; exactly one axis in Speed
 *    (RT, PS) → .20; exactly one axis in Social-Creative (EMO, CRE) → .30; same cluster (the
 *    8 cluster labels of A7) → .55; one Reasoning and one Knowledge axis → .45;
 * 3. otherwise → .35.
 */
export function initialCorrelation(a: AxisCode, b: AxisCode): number {
  if (a === b) return 1
  const lit = LITERATURE_R.get(`${a}|${b}`)
  if (lit !== undefined) return lit
  const ca = axis(a).cluster
  const cb = axis(b).cluster
  if (a === 'CAL' || b === 'CAL') return R_CAL
  if ((ca === 'Speed') !== (cb === 'Speed')) return R_SPEED
  if ((ca === 'Social-Creative') !== (cb === 'Social-Creative')) return R_SOCIAL_CREATIVE
  if (ca === cb) return R_SAME_CLUSTER
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
 * The initial 17×17 prior correlation matrix Σ_init v2 (ROADMAP A8), passed through
 * {@link nearestPD} and checked to be positive definite (throws otherwise). The raw matrix is
 * already PD above the floor, so it comes back unchanged ({@link SIGMA_NEAREST_PD_CHANGED}).
 * Returns a fresh copy on every call.
 */
export function initialSigma(): Matrix {
  const sigma = nearestPD(rawInitialSigma())
  if (tryCholesky(sigma) === null) throw new Error('initial Σ is not positive definite')
  return sigma
}

/**
 * Project a symmetric matrix to a correlation matrix with eigenvalues ≥ `floor` (DESIGN §7.2),
 * the same steps as the Python reference `hb.axes.nearest_pd` (tol = {@link NEAREST_PD_TOL}):
 * 1. symmetrise, A = (M + Mᵀ)/2;
 * 2. Jacobi eigen-decomposition A = V·diag(w)·Vᵀ; if min w < floor − tol, clip the eigenvalues
 *    up to `floor` and reconstruct A = V·diag(max(w, floor))·Vᵀ, symmetrised again;
 * 3. rescale to unit diagonal, C = D^{-1/2}·A·D^{-1/2} with D = diag(A), diagonal exactly 1;
 * 4. the rescaling can push the smallest eigenvalue λ of C back below the floor. If
 *    λ < floor − tol, shrink toward the identity (ROADMAP A8): C ← (1 − t)·C + t·I with
 *    t = (floor − λ)/(1 − λ), which keeps the unit diagonal and the sign pattern and maps every
 *    eigenvalue μ to (1 − t)·μ + t, so the smallest becomes `floor` (to rounding).
 * A valid correlation matrix whose eigenvalues are all ≥ floor − tol comes back unchanged (bit
 * for bit). Needs 0 < floor < 1.
 */
export function nearestPD(m: Matrix, floor = SIGMA_EIGEN_FLOOR): Matrix {
  const n = m.length
  if (n === 0 || m.some((row) => row.length !== n)) {
    throw new RangeError('nearestPD needs a non-empty square matrix')
  }
  if (m.some((row) => row.some((v) => !Number.isFinite(v)))) {
    throw new RangeError('nearestPD needs a finite matrix')
  }
  if (!(floor > 0 && floor < 1)) throw new RangeError('nearestPD floor must be in (0, 1)')

  let a: Matrix = m.map((row, i) => row.map((v, j) => (v + m[j]![i]!) / 2))
  const { values, vectors } = symmetricEigen(a)
  if (values[0]! < floor - NEAREST_PD_TOL) {
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
  const out = a.map((row, i) => row.map((v, j) => (i === j ? 1 : v / (d[i]! * d[j]!))))
  const lam = symmetricEigen(out).values[0]!
  if (lam < floor - NEAREST_PD_TOL) {
    const t = (floor - lam) / (1 - lam)
    return out.map((row, i) => row.map((v, j) => (i === j ? 1 : (1 - t) * v)))
  }
  return out
}
