/**
 * Generator of the paper-folding family (`index.ts`, `spec.ts`, `prior.ts`).
 *
 * 1. Every legal configuration is enumerated once ({@link FOLDING_CLASSES}): a sheet size, a fold
 *    sequence of 1–3 half folds (`geometry.ts` `legalFolds`), a punch count p of 1–3 that leaves at
 *    least one slot inside the folded paper unpunched, and a lure type (mixed or near-miss), kept
 *    when at most half the sheet ends up punched (2^f · p ≤ N²/2, so the lures have room), on a
 *    4 × 4 or a 6 × 6 sheet. Each configuration is filed under the stratum of its prior b
 *    (`stratumOfB`), grouped into *classes* of equal features (grid, folds, diagonal, punches, lures).
 * 2. An item: the stratum (requested, or uniform over 1–6 for the natural pool), a class uniformly
 *    within it, the key's typicality rank uniformly from 0–4 (see 4), then up to
 *    {@link MAX_ATTEMPTS} draws of a fold sequence of that class and p punch slots strictly inside
 *    the folded paper. The key is every sheet slot whose folded image is punched (the forward map
 *    `foldedImage`; the verifier unfolds backwards instead).
 * 3. Distractors come from a small grammar (`spec.ts` `LureBase`, `LurePerturbation`): the base
 *    sheets (missed unfold, wrong line, mirrored, extra layer) and one perturbation (a moved or an
 *    extra hole, acting on whole orbits of a symmetry group of its base) of the key or of a base.
 * 4. Every distractor is derived from the key, so a naive draw makes the key the most typical option
 *    (the medoid) about two times in three, an option-only shortcut. Instead the key's typicality
 *    rank is drawn uniformly first and lure sets are drawn (around a random centre, the key or a
 *    base) until the key has that rank (`chooseOptions`), so "pick the most typical option" is at
 *    chance; a set whose key another option-only cue singles out (`cues.ts` `ENFORCED_CUES`) is
 *    redrawn. The five sheets are distinct and shuffled into display order.
 *
 * Inner loops work on bit masks (`masks.ts`) with cached fold plans, orbits and perturbation lists,
 * and the lure search draws from its own small stream seeded from the item's (`LureStream`); the
 * verifier uses slot lists and its own unfolding.
 */

import type { BuildContext, BuiltItem } from '../family'
import type { Rng } from '../../engine/prng'
import type { Stratum } from '../ids'
import { stratumOfB } from '../priors'
import * as M from './masks'
import { bits as maskBits, orbitTable, popcount } from './masks'
import {

  foldPlan,
  foldedImage,
  foldingStructure,
  interiorSlots,
  isPlan,
  legalFolds,
  lineKindOf,
  reflect,
  sheetShape,
  slotCode,
  slotPt,
  sortSlots,
  ptSlot,
  symmetryLine,
  type FoldPlan,
  type Line,
  type Pt,
  type Shape,
} from './geometry'
import { FOLDING_PROVENANCE, FOLDING_SD_PRIOR, foldingBPrior, foldingExpectedTime } from './prior'
import { FOLDING_OPTIONS, MAX_FOLDS, MAX_PUNCHES, type FoldStep, type FoldingFeatures, type FoldingKey, type FoldingSpec, type LureBase, type LurePerturbation, type Side, type Slot, lureReason } from './spec'

/** Draws of a fold sequence and punches per item before the generator gives up (it never has to in practice). */
export const MAX_ATTEMPTS = 400

/** One group of configurations with equal features. */
export interface FoldingClass {
  readonly stratum: Stratum
  readonly grid: number
  readonly nFolds: number
  readonly diagonal: boolean
  readonly nPunches: number
  readonly nearMiss: boolean
  readonly bPrior: number
  /** The fold sequences (moving sides) of this class whose folded paper has ≥ nPunches inner slots. */
  readonly sequences: readonly (readonly Side[])[]
}

export const steps = (sides: readonly Side[]): FoldStep[] => sides.map((m) => ({ line: lineKindOf(m), moving: m }))

const isDiagonal = (s: Side): boolean => {
  const k = lineKindOf(s)
  return k === 'd' || k === 'a'
}

const PLANS = new Map<string, { readonly plan: FoldPlan; readonly inner: readonly Slot[] }>()

/** The fold plan of a sequence and the slots inside its folded paper (cached: plans are pure). */
function planInfo(n: number, sides: readonly Side[]): { readonly plan: FoldPlan; readonly inner: readonly Slot[] } {
  const key = `${n}|${sides.join(',')}`
  let info = PLANS.get(key)
  if (!info) {
    const p = foldPlan(n, steps(sides))
    if (!isPlan(p)) throw new Error(`folding: illegal sequence ${sides.join(',')}: ${p.problems.join('; ')}`)
    info = { plan: p, inner: interiorSlots(p.shapes[sides.length] as Shape, n) }
    PLANS.set(key, info)
  }
  return info
}

function planOf(n: number, sides: readonly Side[]): FoldPlan {
  return planInfo(n, sides).plan
}

/** Every fold sequence of 1–3 folds on an n × n sheet with its count of inner slots, in a fixed order. */
export function foldSequences(n: number): { sides: Side[]; interior: number }[] {
  const out: { sides: Side[]; interior: number }[] = []
  const rec = (sides: Side[], shape: Shape): void => {
    if (sides.length > 0) out.push({ sides, interior: interiorSlots(shape, n).length })
    if (sides.length === MAX_FOLDS) return
    for (const s of legalFolds(shape)) {
      const next = [...sides, s]
      rec(next, planOf(n, next).shapes[next.length] as Shape)
    }
  }
  rec([], sheetShape(n))
  return out
}

/** The configurations the generator uses, grouped into classes (see the module comment). */
export const FOLDING_CLASSES: readonly FoldingClass[] = (() => {
  const byKey = new Map<string, FoldingClass & { sequences: Side[][] }>()
  for (const n of [4, 6]) {
    for (const { sides, interior } of foldSequences(n)) {
      const f = sides.length
      const diagonal = sides.some(isDiagonal)
      for (let p = 1; p <= Math.min(MAX_PUNCHES, interior - 1); p++) {
        const holes = 2 ** f * p
        if (2 * holes > n * n) continue
        for (const nearMiss of [false, true]) {
          const bPrior = foldingBPrior({ n_folds: f, n_punches: p, holes, diagonal, near_miss: nearMiss, grid: n })
          const key = `${n}|${f}|${diagonal}|${p}|${nearMiss}`
          let c = byKey.get(key)
          if (!c) {
            c = { stratum: stratumOfB(bPrior), grid: n, nFolds: f, diagonal, nPunches: p, nearMiss, bPrior, sequences: [] }
            byKey.set(key, c)
          }
          c.sequences.push(sides)
        }
      }
    }
  }
  return Object.freeze([...byKey.values()].map((c) => Object.freeze({ ...c, sequences: Object.freeze(c.sequences.map((s) => Object.freeze([...s]))) })))
})()

/** The strata the classes reach (1–6). */
export const FOLDING_STRATA: readonly Stratum[] = Object.freeze([...new Set(FOLDING_CLASSES.map((c) => c.stratum))].sort((a, b) => a - b))

export const classesOf = (stratum: Stratum): FoldingClass[] => FOLDING_CLASSES.filter((c) => c.stratum === stratum)

// --- unfolding and lures ---------------------------------------------------------------------------

/**
 * Unfold the punched points back through the folds, last fold first; `lineAt(k)` may replace fold
 * k's line (null = skip that unfold). Returns sheet points (they may lie off the sheet for a replaced line).
 */
function unfoldPoints(punches: readonly Pt[], plan: FoldPlan, lineAt: (k: number) => Line | null): Pt[] {
  const keyOf = (p: Pt): number => (p[0] + 512) * 2048 + (p[1] + 512)
  let pts = new Map<number, Pt>(punches.map((p) => [keyOf(p), p]))
  for (let k = plan.lines.length - 1; k >= 0; k--) {
    const line = lineAt(k)
    if (line === null) continue
    const next = new Map(pts)
    for (const p of pts.values()) {
      const q = reflect(p, line)
      next.set(keyOf(q), q)
    }
    pts = next
  }
  return [...pts.values()]
}

const onSheet = (p: Pt, n: number): boolean => p[0] > 0 && p[1] > 0 && p[0] < 2 * n && p[1] < 2 * n

/**
 * The lines a `wrong_line` lure may undo fold k across: the other legal fold lines of the shape fold k
 * folded (`symmetryLine`), then the lines of the other folds, without repeats or fold k's own line.
 */
const ALTS = new WeakMap<FoldPlan, Line[][]>()

export function alternativeLines(plan: FoldPlan, k: number): Line[] {
  let all = ALTS.get(plan)
  if (!all) {
    all = plan.lines.map((_, j) => alternativeLinesOf(plan, j))
    ALTS.set(plan, all)
  }
  return all[k] as Line[]
}

function alternativeLinesOf(plan: FoldPlan, k: number): Line[] {
  const own = plan.lines[k] as Line
  const out: Line[] = []
  const add = (l: Line | null): void => {
    if (l === null || (l.kind === own.kind && l.c === own.c) || out.some((m) => m.kind === l.kind && m.c === l.c)) return
    out.push(l)
  }
  for (const kind of ['v', 'h', 'd', 'a'] as const) add(symmetryLine(plan.shapes[k] as Shape, kind))
  plan.lines.forEach((l) => add(l))
  return out
}

/** A candidate distractor: its holes (a slot mask, `masks.ts`) and its reason. */
export interface Lure {
  readonly mask: M.Mask
  readonly size: number
  readonly base: LureBase
  readonly perturbation: LurePerturbation | null
  /** `masks.ts` `idOf`, the identity of the hole set. */
  readonly id: number
}

const lure = (mask: M.Mask, base: LureBase, perturbation: LurePerturbation | null): Lure => ({ mask, size: M.size(mask), base, perturbation, id: M.idOf(mask) })

/** The four neighbours of a slot (row, column offsets). */
export const NEIGHBOURS: readonly (readonly [number, number])[] = Object.freeze([
  [-1, 0],
  [1, 0],
  [0, -1],
  [0, 1],
] as const)

/**
 * The base sheets other than the key (`spec.ts` `LureBase`), each once, in a fixed order: the missed
 * unfolds (by fold), the wrong lines (by fold, then line, only those keeping every hole on the sheet
 * and the key's hole count), the mirror images, the extra layers.
 */
export function baseLures(plan: FoldPlan, punches: readonly Slot[], key: readonly Slot[]): Lure[] {
  const n = plan.grid
  const f = plan.lines.length
  const pts = punches.map(slotPt)
  const out: Lure[] = []
  const keyMask = M.maskOf(key, n)
  const seen = new Set<number>([M.idOf(keyMask)])
  const push = (base: LureBase, mask: M.Mask): void => {
    const l = lure(mask, base, null)
    if (seen.has(l.id)) return
    seen.add(l.id)
    out.push(l)
  }
  for (let j = 0; j < f; j++) push('missed_unfold', M.maskOf(unfoldPoints(pts, plan, (k) => (k === j ? null : (plan.lines[k] as Line))).map(ptSlot), n))
  for (let j = 0; j < f; j++)
    for (const alt of alternativeLines(plan, j)) {
      const got = unfoldPoints(pts, plan, (k) => (k === j ? alt : (plan.lines[k] as Line)))
      if (got.length === key.length && got.every((p) => onSheet(p, n))) push('wrong_line', M.maskOf(got.map(ptSlot), n))
    }
  const ps = M.perms(n)
  for (const g of M.MIRROR_INDICES) push('mirrored', M.permute(keyMask, ps[g] as Int8Array, n))
  for (const g of M.MIRROR_INDICES) push('extra_layer', M.or(keyMask, M.permute(keyMask, ps[g] as Int8Array, n)))
  return out
}

/**
 * The symmetry groups (indices into `SHEET_SYMMETRIES`) a perturbation of a slot set may respect,
 * each once: the set's whole stabilizer, then each mirror subgroup {identity, μ} of it (when the
 * stabilizer is larger), then the trivial group (a single hole, when the set has any symmetry).
 */
export function perturbationGroups(mask: M.Mask, n: number): number[][] {
  const full = M.stabilizerOf(mask, n)
  const groups: number[][] = [full]
  for (const m of M.MIRROR_INDICES) if (full.includes(m) && full.length > 2) groups.push([0, m])
  if (full.length > 1) groups.push([0])
  return groups
}

/** A perturbation candidate before its base label and the per-draw exclusions are applied. */
interface RawPerturbation {
  readonly mask: M.Mask
  readonly size: number
  readonly perturbation: LurePerturbation
  readonly id: number
}

/** Raw perturbation lists by (n, base set): a pure function of the set, so shared across draws. */
const RAW_PERTURBATIONS = new Map<number, readonly RawPerturbation[]>()

function rawPerturbations(b: M.Mask, n: number): readonly RawPerturbation[] {
  const cacheKey = M.idOf(b) * 8 + n
  const hit = RAW_PERTURBATIONS.get(cacheKey)
  if (hit) return hit
  const bLo = b.lo
  const bHi = b.hi
  const out: RawPerturbation[] = []
  const seen = new Set<number>([M.idOf(b)])
  const push = (perturbation: LurePerturbation, lo: number, hi: number): void => {
    const id = lo + hi * 262144
    if (seen.has(id)) return
    seen.add(id)
    out.push({ mask: { lo, hi }, size: popcount(lo) + popcount(hi), perturbation, id })
  }
  const inB = (j: number): boolean => (j < 18 ? (bLo >>> j) & 1 : (bHi >>> (j - 18)) & 1) === 1
  const holes = maskBits(b, n)
  for (const group of perturbationGroups(b, n)) {
    const t = orbitTable(group, n)
    for (const i of holes) {
      const ohLo = t.lo[i] as number
      const ohHi = t.hi[i] as number
      const r = Math.floor(i / n)
      const c = i % n
      for (const [dr, dc] of NEIGHBOURS) {
        if (r + dr < 0 || c + dc < 0 || r + dr >= n || c + dc >= n) continue
        const j = (r + dr) * n + (c + dc)
        if (inB(j)) continue
        const omLo = t.lo[j] as number
        const omHi = t.hi[j] as number
        if (t.size[j] !== t.size[i] || (omLo & bLo) !== 0 || (omHi & bHi) !== 0) continue
        push('moved_hole', (bLo & ~ohLo) | omLo, (bHi & ~ohHi) | omHi)
      }
    }
    for (let j = 0; j < n * n; j++) if (!inB(j) && t.min[j] === j) push('extra_hole', bLo | (t.lo[j] as number), bHi | (t.hi[j] as number))
  }
  if (RAW_PERTURBATIONS.size > 50_000) RAW_PERTURBATIONS.clear()
  RAW_PERTURBATIONS.set(cacheKey, out)
  return out
}

/**
 * The perturbations of a base sheet (`spec.ts` `LurePerturbation`), in a fixed order: for each group of
 * {@link perturbationGroups}, every orbit of the group (by its slots in reading order) moved to a
 * neighbouring free orbit of the same size, then every free orbit added. Repeats (and anything in
 * `exclude`: the key and the bases) are left out.
 */
export function perturbations(base: { mask: M.Mask; base: LureBase }, n: number, exclude: ReadonlySet<number>): Lure[] {
  const out: Lure[] = []
  for (const p of rawPerturbations(base.mask, n)) if (!exclude.has(p.id)) out.push({ mask: p.mask, size: p.size, base: base.base, perturbation: p.perturbation, id: p.id })
  return out
}

/** The perturbation turning `base` into `d` (as `reasons.ts` `perturbationOf`, on masks), or null. */
function perturbationOfMask(base: M.Mask, d: M.Mask, n: number): LurePerturbation | null {
  const removed = M.andNot(base, d)
  const added = M.andNot(d, base)
  if (M.size(added) === 0) return null
  const addedBits = M.bits(added, n)
  const removedBits = M.bits(removed, n)
  for (const group of perturbationGroups(base, n)) {
    if (removedBits.length === 0) {
      if (M.same(M.orbitOf(addedBits[0] as number, group, n), added)) return 'extra_hole'
      continue
    }
    if (removedBits.length !== addedBits.length) continue
    for (const r of removedBits) {
      if (!M.same(M.orbitOf(r, group, n), removed)) continue
      for (const m of addedBits) {
        const adjacent = Math.abs(Math.floor(r / n) - Math.floor(m / n)) + Math.abs((r % n) - (m % n)) === 1
        if (adjacent && M.same(M.orbitOf(m, group, n), added)) return 'moved_hole'
      }
    }
  }
  return null
}

/**
 * The distractors' sorted reasons (the A11 `lures`), on masks: the same classification as
 * `reasons.ts` `lureSignature` (which the verifier uses on slot lists), from the bases the lure search
 * already built (`baseLures`: deduplicated in the verifier's order, so the first match is the same).
 */
export function lureSignatureOfMasks(keyMask: M.Mask, bases: readonly Lure[], sheets: readonly M.Mask[], keyIndex: number, n: number): string[] {
  const out: string[] = []
  sheets.forEach((d, i) => {
    if (i === keyIndex) return
    const id = M.idOf(d)
    const direct = bases.find((b) => b.id === id)
    if (direct) {
      out.push(lureReason(direct.base, null))
      return
    }
    for (const b of [{ mask: keyMask, base: 'key' as LureBase }, ...bases]) {
      const p = perturbationOfMask(b.mask, d, n)
      if (p !== null) {
        out.push(lureReason(b.base, p))
        return
      }
    }
    out.push('none')
  })
  return out.sort()
}

/** Total difference of option `a` (−1 = the key, else lures[a]) to the five options. */
function keyDistance(key: M.Mask, lures: readonly Lure[], a: number): number {
  const x = a < 0 ? key : (lures[a] as Lure).mask
  let t = popcount(x.lo ^ key.lo) + popcount(x.hi ^ key.hi)
  for (const l of lures) t += popcount(x.lo ^ l.mask.lo) + popcount(x.hi ^ l.mask.hi)
  return t
}

/** Lure sets drawn per fold-and-punch draw while looking for the target typicality rank. */
export const RANK_TRIES = 120

/**
 * The enforced option-only cues (`cues.ts` `ENFORCED_CUES`) on masks: true when one of them singles
 * out option 0 of `options` (the key). The verifier recomputes the same cues on slot lists.
 */
export function keySingledOut(options: readonly M.Mask[], n: number): boolean {
  const only0 = (xs: readonly number[], pick: (v: number, best: number) => boolean): boolean => {
    let best = xs[0] as number
    for (const x of xs) if (pick(x, best)) best = x
    return xs[0] === best && xs.filter((x) => x === best).length === 1
  }
  const counts = options.map(M.size)
  if (only0(counts, (v, b) => v > b) || only0(counts, (v, b) => v < b)) return true
  const odd = counts.map((c) => counts.filter((d) => d === c).length === 1)
  if (odd[0] === true && odd.filter(Boolean).length === 1) return true
  const stab = options.map((m) => M.stabilizerOf(m, n))
  const sym = stab.map((g) => g.some((i) => M.MIRROR_INDICES.includes(i)))
  if (sym[0] === true && sym.filter(Boolean).length === 1) return true
  if (sym[0] === false && sym.filter((x) => !x).length === 1) return true
  return only0(
    stab.map((g) => g.length),
    (v, b) => v > b,
  )
}

/**
 * The lure search's own small stream (sfc32, inline), seeded with 128 bits from the item's stream, so
 * it is still a pure function of the item's seed. The search makes thousands of draws for a hard item;
 * through the engine stream's general methods they were most of the generator's time.
 */
class LureStream {
  private a: number
  private b: number
  private c: number
  private d: number
  constructor(rng: Rng) {
    this.a = rng.uint32() | 0
    this.b = rng.uint32() | 0
    this.c = rng.uint32() | 0
    this.d = rng.uint32() | 0
  }
  /** Next uint32. */
  u32(): number {
    const t = (((this.a + this.b) | 0) + this.d) | 0
    this.d = (this.d + 1) | 0
    this.a = this.b ^ (this.b >>> 9)
    this.b = (this.c + (this.c << 3)) | 0
    this.c = (this.c << 21) | (this.c >>> 11)
    this.c = (this.c + t) | 0
    return t >>> 0
  }
  /** An index in [0, k) by multiply-and-floor (bias below k / 2^32, negligible for these list sizes). */
  below(k: number): number {
    return Math.floor((this.u32() / 4294967296) * k)
  }
  coin(): boolean {
    return this.u32() < 2147483648
  }
}

/**
 * Choose the four distractors and the display order, or null when this fold-and-punch draw does not
 * allow it. The key's typicality rank `target` (`cues.ts` `typicalityRank`: how many options are
 * strictly more typical) is drawn uniformly from 0–4 once per item (`buildFolding`), and lure sets
 * are drawn until one gives that rank: a centre (the key or a base sheet), whose perturbations make up
 * about half the lures (the base itself is one of them when it is not the key), the rest drawn from
 * all bases and their perturbations. Near-miss sets use only lures with the key's hole count; mixed
 * sets need at least one with another count. A set whose key an enforced cue singles out is redrawn.
 */
export function chooseOptions(
  rng: Rng,
  plan: FoldPlan,
  punches: readonly Slot[],
  key: readonly Slot[],
  nearMiss: boolean,
  target: number,
): { sheets: Slot[][]; index: number; lures: Lure[]; signature: string[] } | null {
  const n = plan.grid
  const keyMask = M.maskOf(key, n)
  const bases = baseLures(plan, punches, key)
  const pertCache: (Lure[] | undefined)[] = new Array<Lure[] | undefined>(bases.length + 1)
  const exclude = new Set([M.idOf(keyMask), ...bases.map((l) => l.id)])
  /** Perturbations of the key (-1) or of bases[i]. */
  const pertOf = (i: number): Lure[] => {
    let p = pertCache[i + 1]
    if (p === undefined) {
      p = perturbations(i < 0 ? { mask: keyMask, base: 'key' } : (bases[i] as Lure), n, exclude)
      pertCache[i + 1] = p
    }
    return p
  }
  const size = key.length
  const centres = [-1, ...bases.flatMap((l, i) => (!nearMiss || l.size === size ? [i] : []))]
  const lures: Lure[] = []
  /** Add a lure unless it repeats one, or misses the near-miss count (no closures in the hot loop). */
  const tryAdd = (l: Lure | undefined): void => {
    if (l === undefined || (nearMiss && l.size !== size)) return
    for (const x of lures) if (x.id === l.id) return
    lures.push(l)
  }
  const fast = new LureStream(rng)
  for (let k = 0; k < RANK_TRIES; k++) {
    const c = centres[fast.below(centres.length)] as number
    lures.length = 0
    if (c >= 0) tryAdd(bases[c])
    for (let guard = 0; lures.length < FOLDING_OPTIONS - 1 && guard < 12; guard++) {
      const own = pertOf(c)
      if (fast.coin() && own.length > 0) tryAdd(own[fast.below(own.length)])
      else {
        const i = fast.below(bases.length + 1) - 1
        const p = pertOf(i)
        if (i >= 0 && fast.coin()) tryAdd(bases[i])
        else if (p.length > 0) tryAdd(p[fast.below(p.length)])
      }
    }
    if (lures.length !== FOLDING_OPTIONS - 1) continue
    if (!nearMiss && lures.every((l) => l.size === size)) continue
    let rank = 0
    const own = keyDistance(keyMask, lures, -1)
    for (let a = 0; a < 4; a++) if (keyDistance(keyMask, lures, a) < own) rank++
    if (rank !== target) continue
    const masks = [keyMask, ...lures.map((l) => l.mask)]
    if (keySingledOut(masks, n)) continue
    const order = rng.shuffle([0, 1, 2, 3, 4])
    const shown = order.map((i) => masks[i] as M.Mask)
    const index = order.indexOf(0)
    return {
      sheets: shown.map((m) => M.slotsOf(m, n)),
      index,
      lures: order.filter((i) => i > 0).map((i) => lures[i - 1] as Lure),

      signature: lureSignatureOfMasks(keyMask, bases, shown, index, n),
    }
  }
  return null
}

/** The unfolded sheet by the forward map: every slot whose folded image is a punched slot. */
export function unfoldedByImage(plan: FoldPlan, punches: readonly Slot[]): Slot[] {
  const n = plan.grid
  const punched = new Set(punches.map(slotCode))
  const out: Slot[] = []
  for (let row = 1; row <= n; row++)
    for (let col = 1; col <= n; col++) {
      const img = ptSlot(foldedImage(slotPt({ row, col }), plan))
      if (punched.has(slotCode(img))) out.push({ row, col })
    }
  return out
}

export function featuresOf(n: number, sides: readonly Side[], nPunches: number, nearMiss: boolean): FoldingFeatures {
  const f = sides.length
  const nDiag = sides.filter(isDiagonal).length
  return { grid: n, n_folds: f, diagonal: nDiag > 0, n_diagonal: nDiag, n_punches: nPunches, holes: 2 ** f * nPunches, near_miss: nearMiss }
}

export function buildFolding(rng: Rng, ctx: BuildContext): BuiltItem<FoldingSpec, FoldingKey> {
  const stratum: Stratum = ctx.stratum ?? rng.pick(FOLDING_STRATA)
  const classes = classesOf(stratum)
  if (classes.length === 0) throw new RangeError(`folding cannot generate stratum ${stratum}`)
  const cls = rng.pick(classes)
  const n = cls.grid
  const target = rng.int(0, FOLDING_OPTIONS - 1)
  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
    const sides = rng.pick(cls.sequences)
    const { plan, inner } = planInfo(n, sides)
    const punches = sortSlots(rng.shuffle(inner).slice(0, cls.nPunches))
    const key = unfoldedByImage(plan, punches)
    if (key.length !== 2 ** sides.length * cls.nPunches) throw new Error('folding: layer count is not 2^folds per punch')
    const chosen = chooseOptions(rng, plan, punches, key, cls.nearMiss, target)
    if (chosen === null) continue
    const features = featuresOf(n, sides, cls.nPunches, cls.nearMiss)
    const bPrior = foldingBPrior(features)
    if (bPrior !== cls.bPrior || stratumOfB(bPrior) !== stratum) throw new Error('folding: prior and stratum disagree')
    return {
      stratum,
      spec: { grid: n, folds: steps(sides), punches, options: chosen.sheets.map((holes) => ({ holes })) },
      key: { index: chosen.index },
      structural_params: foldingStructure(n, sides, punches, chosen.signature),
      options_count: FOLDING_OPTIONS,
      difficulty: { features: { ...features }, b_prior: bPrior, sd_prior: FOLDING_SD_PRIOR, provenance: FOLDING_PROVENANCE },
      expected_time_s: foldingExpectedTime(sides.length, cls.nPunches),
    }
  }
  throw new Error(`folding: no item after ${MAX_ATTEMPTS} draws (stratum ${stratum}, class ${JSON.stringify({ ...cls, sequences: cls.sequences.length })})`)
}
