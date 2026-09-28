import fc from 'fast-check'
import { describe, expect, it } from 'vitest'
import { AXIS_CODES, initialSigma, N_AXES, type AxisCode } from './axes'
import { info2pl, info3pl, logistic } from './irt'
import { createRng } from './prng'
import { eapAxis, mapTheta } from './scorer'
import {
  A15_SEGMENTS,
  A15_TARGET_S,
  COVERAGE_FLOOR,
  FIXED_BLOCK_FAMILIES,
  RANDOMESQUE_K,
  STOP_SD,
  SEEN_EXEMPT_BLOCKS,
  SWEEP_ATTEMPTS,
  TESTLET_INFO_FACTOR,
  axisDone,
  axisWeight,
  blockSeed,
  candidatePool,
  candidateSeed,
  catAxes,
  catFamilies,
  coverageFloor,
  criterion,
  doneAxes,
  isCatFamily,
  itemInformation,
  nearestStrata,
  pickRandomesque,
  planSession,
  scheduleBlocks,
  selectNext,
  selectionRng,
  sessionPosterior,
  stratumCentre,
  type AdministeredItem,
  type AnyItem,
  type AxisPosterior,
  type SelectorState,
  type SessionPosterior,
} from './selector'
import type { Observation } from './types'
import { parseItemId } from '../tasks/ids'
import { quant } from '../tasks/quant'
import { QUANT_SIBLING_SETS, VARIANTS, quantSiblingGroup } from '../tasks/quant/templates'
import { sampleOf } from '../tasks/quant/test-helpers'
import { FAMILIES, FAMILY_NAMES, getFamily } from '../tasks/registry'
import { PASSAGES, reading, readingStructure } from '../tasks/reading'
import { rotation } from '../tasks/rotation'
import { corsi } from '../tasks/span'

/** Chi-square critical value, df = 4, α = .001 (5 equally likely top-5 ranks). */
const CHI2_DF4_A001 = 18.467

/** The CAT axes in canonical axis order (DESIGN §3). */
const CAT_AXES: readonly AxisCode[] = ['MAT', 'QR', 'SPA']
const PRIOR: SessionPosterior = sessionPosterior([])

function state(over: Partial<SelectorState> = {}): SelectorState {
  return { sessionSeed: 'sel-test', posterior: PRIOR, administered: [], ...over }
}

/** A posterior equal to the prior except on the given axes. */
function posteriorWith(entries: Partial<Record<AxisCode, AxisPosterior>>): SessionPosterior {
  return { ...PRIOR, ...entries }
}

/** A made-up administered item (for floor counts); its family_id is unique and matches nothing. */
function fakeAdministered(axis: AxisCode, i: number): AdministeredItem {
  const family_id = `f:fake:${axis.toLowerCase()}${i}`
  return { item_id: `i:fake:1.0.0:${axis}.${i}`, family_id, family: 'fake', axis, sibling_group: family_id }
}

/** A simulated response to a CAT item from a person at θ, as a scorer observation. */
function respond(item: AnyItem, theta: number, u: number): Observation {
  const p = item.params
  switch (p.model) {
    case '3pl':
      return { kind: '3pl', axis: item.axis, a: p.a, b: p.b, c: p.c, y: u < p.c + (1 - p.c) * logistic(p.a * (theta - p.b)) ? 1 : 0 }
    case '2pl':
    case '2pl_testlet':
      return { kind: '2pl', axis: item.axis, a: p.a, b: p.b, y: u < logistic(p.a * (theta - p.b)) ? 1 : 0 }
    default:
      throw new Error(`not a CAT item: ${p.model}`)
  }
}

const bOf = (item: AnyItem): number => (item.params as { b: number }).b

function chiSquare(counts: readonly number[]): number {
  const n = counts.reduce((s, c) => s + c, 0)
  const e = n / counts.length
  return counts.reduce((s, c) => s + ((c - e) * (c - e)) / e, 0)
}

// ------------------------------------------------------------------------------ criterion

describe('information and the §7.4 criterion', () => {
  it('uses the information of the item model (A9), never the axis default', () => {
    expect(itemInformation({ model: '2pl', a: 1.3, b: 0.4 }, -0.2)).toBeCloseTo(info2pl(-0.2, 1.3, 0.4), 15)
    const a = 1.3
    const p = logistic(a * (-0.2 - 0.4))
    expect(itemInformation({ model: '2pl', a, b: 0.4 }, -0.2)).toBeCloseTo(a * a * p * (1 - p), 15)
    // SPA's default is 3PL; a 2PL item on SPA is still scored as 2PL (and vice versa on MAT).
    expect(itemInformation({ model: '3pl', a: 1, b: 0, c: 0.25 }, 0.5)).toBeCloseTo(info3pl(0.5, 1, 0, 0.25), 15)
    expect(itemInformation({ model: '3pl', a: 1, b: 0, c: 0.25 }, 0.5)).toBeLessThan(info2pl(0.5, 1, 0))
    expect(itemInformation({ model: '2pl_testlet', a: 1, b: 0 }, 0)).toBeCloseTo(TESTLET_INFO_FACTOR * 0.25, 15)
  })

  it('refuses block models (A10)', () => {
    expect(() => itemInformation({ model: 'grm', a: 1.7, b: [-1, 0, 1] }, 0)).toThrow(RangeError)
    expect(() => itemInformation({ model: 'gaussian', lam: 1, d: 0, sigma: 0.2 }, 0)).toThrow(RangeError)
    expect(() => itemInformation({ model: '2pl', a: 1, b: 0 }, Number.NaN)).toThrow(RangeError)
  })

  it('is w_k · I(θ̂) · Var(θ_k) / E[T] (DESIGN §7.4 L573)', () => {
    const item = { params: { model: '2pl', a: 1.2, b: 0.5 }, expected_time_s: 40 } as const
    const post = { mean: 0.1, sd: 0.8 }
    expect(criterion(item, post, 1.5)).toBeCloseTo((1.5 * info2pl(0.1, 1.2, 0.5) * 0.64) / 40, 15)
    const item3 = { params: { model: '3pl', a: 1, b: -0.3, c: 0.25 }, expected_time_s: 25 } as const
    expect(criterion(item3, post, 1)).toBeCloseTo((info3pl(0.1, 1, -0.3, 0.25) * 0.64) / 25, 15)
    expect(criterion(item, post, 0)).toBe(0)
    // A more uncertain axis scores higher for the same item; a slower item scores lower.
    expect(criterion(item, { mean: 0.1, sd: 1 }, 1)).toBeGreaterThan(criterion(item, post, 1))
    expect(criterion({ ...item, expected_time_s: 80 }, post, 1)).toBeCloseTo(criterion(item, post, 1) / 2, 15)
  })

  it('validates its inputs', () => {
    const item = { params: { model: '2pl', a: 1, b: 0 }, expected_time_s: 30 } as const
    expect(() => criterion(item, { mean: 0, sd: 1 }, -1)).toThrow(RangeError)
    expect(() => criterion(item, { mean: 0, sd: 0 }, 1)).toThrow(RangeError)
    expect(() => criterion({ ...item, expected_time_s: 0 }, { mean: 0, sd: 1 }, 1)).toThrow(RangeError)
    expect(() => axisWeight({ MAT: -0.1 }, 'MAT')).toThrow(RangeError)
    expect(() => axisWeight({ MAT: Number.POSITIVE_INFINITY }, 'MAT')).toThrow(RangeError)
    expect(axisWeight({}, 'MAT')).toBe(1)
    expect(axisWeight({ MAT: 0 }, 'MAT')).toBe(0)
  })
})

describe('per-axis stop and coverage floor', () => {
  it('an axis is done once its SD < 0.3 (A15, §7.4 L588)', () => {
    expect(STOP_SD).toBe(0.3)
    expect(axisDone({ mean: 0, sd: 0.299 })).toBe(true)
    expect(axisDone({ mean: 0, sd: 0.3 })).toBe(false)
    expect(axisDone({ mean: 0, sd: 0.35 }, 0.4)).toBe(true)
    expect(doneAxes(posteriorWith({ MAT: { mean: 1, sd: 0.2 }, QR: { mean: 0, sd: 0.29 } }))).toEqual(['MAT', 'QR'])
    expect(() => axisDone({ mean: 0, sd: -1 })).toThrow(RangeError)
  })

  it('the floor is 3 items in session 1 and none after (§7.4 L584)', () => {
    expect(COVERAGE_FLOOR).toBe(3)
    expect(coverageFloor()).toBe(3)
    expect(coverageFloor(1)).toBe(3)
    expect(coverageFloor(2)).toBe(0)
    expect(() => coverageFloor(0)).toThrow(RangeError)
    expect(() => coverageFloor(1.5)).toThrow(RangeError)
  })
})

describe('strata and sibling groups', () => {
  it('stratum centres follow the default b bands', () => {
    expect(([1, 2, 3, 4, 5, 6] as const).map(stratumCentre)).toEqual([-2, -1, 0, 1, 2, 3])
  })

  it('picks the strata nearest θ̂, lower first on ties', () => {
    expect(nearestStrata(rotation.strata, 0)).toEqual([3, 2, 4])
    expect(nearestStrata(rotation.strata, 0.5)).toEqual([3, 4, 2])
    expect(rotation.strata).toEqual([2, 3, 4, 5, 6]) // M1.P: strata derived from the pool's angle bins
    expect(nearestStrata(rotation.strata, 3.7)).toEqual([6, 5, 4])
    expect(nearestStrata(quant.strata, -3)).toEqual([1, 2, 3])
    expect(nearestStrata([2], 3, 3)).toEqual([2])
  })

  it('excludes by the contract sibling key (M1.F2): quant near-isomorph variants share one, other items use their family_id', () => {
    // The groups themselves are the quant family's (QUANT_SIBLING_SETS, pinned in quant.test.ts).
    for (const [label, ids] of Object.entries(QUANT_SIBLING_SETS)) {
      for (const id of ids) expect(sampleOf(...(id.split('/') as [string, string])).sibling_group, id).toBe(`g:quant:${label}`)
    }
    const r = rotation.generate('sib')
    expect(r.sibling_group).toBe(r.family_id)
    // One administered variant of a group excludes the other variants for the rest of the session.
    const solve = { item_id: 'i:quant:1.3.0:x', family_id: 'f:quant:elsewhere', family: 'quant', axis: 'QR', sibling_group: quantSiblingGroup('system', 'solve')! } as const
    const pool = candidatePool(state({ administered: [solve] }), { axes: ['QR'], floor: 0 })
    for (const c of pool.ranked) expect(c.item.sibling_group).not.toBe('g:quant:system')
  })

  it('every quant stratum keeps ≥ 8 exclusion units (sibling groups), so the near strata do not run dry', () => {
    for (const k of [1, 2, 3, 4] as const) {
      const units = new Set(VARIANTS.filter((v) => v.stratum === k).map((v) => quantSiblingGroup(v.template, v.variant) ?? `${v.template}/${v.variant}`))
      expect(units.size, `stratum ${k}`).toBeGreaterThanOrEqual(8)
    }
  })
})

// ------------------------------------------------------------------------------- roles

describe('family roles (A10, A15)', () => {
  it('the power families are CAT; RT, span, coding and reading are fixed blocks', () => {
    const roles = Object.fromEntries(FAMILY_NAMES.map((n) => [n, isCatFamily(getFamily(n)!)]))
    expect(roles).toEqual({
      rotation: true,
      matrices: true,
      series: true,
      quant: true,
      span_fwd: false,
      span_bwd: false,
      corsi: false,
      rt_simple: false,
      rt_choice4: false,
      coding: false,
      reading: false,
    })
    expect(catFamilies().map((f) => f.name)).toEqual(['rotation', 'matrices', 'series', 'quant'])
  })

  it('every registered family is either CAT or scheduled as an A15 block, and every block is registered', () => {
    for (const name of FAMILY_NAMES) expect(isCatFamily(getFamily(name)!) !== FIXED_BLOCK_FAMILIES.has(name), name).toBe(true)
    for (const name of FIXED_BLOCK_FAMILIES) expect(getFamily(name), name).toBeDefined()
  })

  it('every CAT axis has an A15 CAT segment and vice versa', () => {
    const segmentAxes = A15_SEGMENTS.flatMap((s) => (s.kind === 'cat' ? s.axes : []))
    expect([...segmentAxes].sort()).toEqual(catAxes().sort())
    expect(catAxes()).toEqual(CAT_AXES)
  })

  it('an unscheduled family with block (GRM) items is still not a CAT family', () => {
    expect(isCatFamily({ ...corsi, name: 'mystery_span' })).toBe(false)
  })
})

// ---------------------------------------------------------------------------- posterior

describe('sessionPosterior', () => {
  const obs: Observation[] = [
    { kind: '2pl', axis: 'MAT', a: 1, b: 0.2, y: 1 },
    { kind: '2pl', axis: 'MAT', a: 1.2, b: 0.8, y: 0 },
    { kind: '3pl', axis: 'SPA', a: 1, b: -0.5, c: 0.25, y: 1 },
  ]

  it('is the prior on every axis without observations', () => {
    const p = sessionPosterior([])
    expect(Object.keys(p)).toEqual([...AXIS_CODES])
    for (const k of AXIS_CODES) expect(p[k]).toEqual({ mean: 0, sd: 1 })
  })

  it('EAP (default): the per-axis grid EAP of the engine scorer (§11.2, A2)', () => {
    const p = sessionPosterior(obs)
    const mat = eapAxis(obs.slice(0, 2), 0, 1)
    expect(p.MAT.mean).toBeCloseTo(mat.mean, 12)
    expect(p.MAT.sd).toBeCloseTo(mat.sd, 12)
    expect(p.SPA).toEqual(eapAxis([obs[2]!], 0, 1))
    expect(p.QR).toEqual({ mean: 0, sd: 1 })
  })

  it('MAP: the correlated MAP and Laplace SD, which borrow strength across axes (§7.2)', () => {
    const p = sessionPosterior(obs, { estimator: 'map' })
    const r = mapTheta(obs, new Array<number>(N_AXES).fill(0), initialSigma())
    expect(p.MAT.mean).toBeCloseTo(r.theta[0]!, 12)
    expect(p.MAT.sd).toBeCloseTo(Math.sqrt(r.cov[0]![0]!), 12)
    expect(p.QR.sd).toBeLessThan(1) // QR is correlated with MAT (A8)
  })

  it('uses a carried-forward prior', () => {
    const mu = new Array<number>(N_AXES).fill(0.5)
    const sigma = initialSigma().map((row, i) => row.map((v, j) => (i === j ? 0.5 : v * 0.5)))
    const p = sessionPosterior([], { mu, sigma })
    expect(p.QR.mean).toBe(0.5)
    expect(p.QR.sd).toBeCloseTo(Math.sqrt(0.5), 15)
  })
})

// ------------------------------------------------------------------------------ selection

describe('selectNext', () => {
  it('returns a CAT item whose item_id regenerates it (A11)', () => {
    const sel = selectNext(state(), selectionRng('sel-test', 0))
    expect(sel.kind).toBe('item')
    if (sel.kind !== 'item') return
    expect(CAT_AXES).toContain(sel.axis)
    expect(sel.item.axis).toBe(sel.axis)
    expect(['2pl', '3pl']).toContain(sel.item.params.model)
    expect(sel.rank).toBeLessThan(RANDOMESQUE_K)
    expect(sel.floor).toBe(true) // session 1, nothing administered yet
    const id = parseItemId(sel.item.item_id)!
    expect(getFamily(id.family)!.generate(id.seed)).toEqual(sel.item)
    expect(JSON.parse(JSON.stringify(sel.item))).toEqual(sel.item)
  })

  it('ranks one candidate per family_id by score, then item_id', () => {
    const pool = candidatePool(state())
    expect(pool.ranked.length).toBeGreaterThanOrEqual(2 * RANDOMESQUE_K)
    expect(new Set(pool.ranked.map((c) => c.item.family_id)).size).toBe(pool.ranked.length)
    for (let i = 1; i < pool.ranked.length; i++) {
      const [x, y] = [pool.ranked[i - 1]!, pool.ranked[i]!]
      expect(x.score > y.score || (x.score === y.score && x.item.item_id < y.item.item_id)).toBe(true)
    }
    for (const c of pool.ranked) expect(c.score).toBeCloseTo(criterion(c.item, PRIOR[c.axis]!, 1), 15)
    expect(pool.eligibleAxes).toEqual(CAT_AXES)
  })

  it('draws candidates from the strata nearest θ̂', () => {
    const high = candidatePool(state({ posterior: posteriorWith({ SPA: { mean: 2.2, sd: 0.8 } }) }), { axes: ['SPA'] })
    const low = candidatePool(state({ posterior: posteriorWith({ SPA: { mean: -1.5, sd: 0.8 } }) }), { axes: ['SPA'] })
    for (const c of high.ranked) expect([4, 5, 6]).toContain(c.item.stratum)
    for (const c of low.ranked) expect([2, 3, 4]).toContain(c.item.stratum)
    const meanB = (xs: readonly { item: AnyItem }[]): number => xs.reduce((s, c) => s + bOf(c.item), 0) / xs.length
    expect(meanB(high.ranked)).toBeGreaterThan(meanB(low.ranked) + 0.5)
  })

  it('restricts to the segment axes (A15)', () => {
    for (const axis of CAT_AXES) {
      const pool = candidatePool(state(), { axes: [axis] })
      expect(pool.ranked.length).toBeGreaterThan(0)
      for (const c of pool.ranked) expect(c.axis).toBe(axis)
    }
  })

  it('says why nothing can be selected', () => {
    const none = (s: SelectorState, opts = {}) => selectNext(s, createRng('x'), opts)
    expect(none(state(), { weights: { MAT: 0, SPA: 0, QR: 0 } })).toEqual({ kind: 'none', reason: 'no_axes' })
    expect(none(state(), { axes: ['RT', 'WM', 'PS'] })).toEqual({ kind: 'none', reason: 'no_axes' })
    const tight = posteriorWith({ MAT: { mean: 0, sd: 0.25 }, SPA: { mean: 0, sd: 0.2 }, QR: { mean: 1, sd: 0.29 } })
    expect(none(state({ posterior: tight }))).toEqual({ kind: 'none', reason: 'axes_done' })
    expect(none(state({ remainingS: 0 }))).toEqual({ kind: 'none', reason: 'time' })
    expect(none(state({ remainingS: 5 }))).toEqual({ kind: 'none', reason: 'time' })
    const allQuant = VARIANTS.map((v) => quant.familyIdOf({ template: v.template, variant: v.variant }))
    expect(allQuant).toHaveLength(53)
    expect(none(state({ seenFamilies: allQuant }), { axes: ['QR'] })).toEqual({ kind: 'none', reason: 'exhausted' })
  })

  it('widens to farther strata when the near strata run dry, instead of reporting exhausted', () => {
    const familyOf = (v: (typeof VARIANTS)[number]) => quant.familyIdOf({ template: v.template, variant: v.variant })
    // θ̂ = 0: the near quant strata are 3, 2, 4. All of 2–4 seen: only stratum 1 is left.
    const s = state({ posterior: posteriorWith({ QR: { mean: 0, sd: 0.5 } }), seenFamilies: VARIANTS.filter((v) => v.stratum > 1).map(familyOf) })
    const pool = candidatePool(s, { axes: ['QR'] })
    expect(pool.reason).toBeUndefined()
    expect(pool.ranked.length).toBeGreaterThan(0)
    for (const c of pool.ranked) expect(c.item.stratum).toBe(1)
    // Only strata 2 and 3 seen: stratum 4 alone gives < 5 candidates, so stratum 1 joins the pool.
    const short = candidatePool(state({ ...s, seenFamilies: VARIANTS.filter((v) => v.stratum === 2 || v.stratum === 3).map(familyOf) }), { axes: ['QR'] })
    expect(short.ranked.length).toBeGreaterThanOrEqual(RANDOMESQUE_K)
    expect(new Set(short.ranked.map((c) => c.item.stratum))).toEqual(new Set([1, 4]))
  })

  it("'exhausted' means no unseen, non-sibling family is left in any stratum", () => {
    const all = VARIANTS.map((v) => ({ v, id: quant.familyIdOf({ template: v.template, variant: v.variant }) }))
    // Every variant but one seen, θ̂ as far from its stratum as possible: that one is still found.
    for (const { v, id } of all) {
      const mean = v.stratum <= 2 ? 3 : -3
      const s = state({ posterior: posteriorWith({ QR: { mean, sd: 0.5 } }), seenFamilies: all.filter((x) => x.id !== id).map((x) => x.id) })
      const sel = selectNext(s, createRng('x'), { axes: ['QR'] })
      expect(sel.kind === 'item' && sel.item.family_id, `${v.template}/${v.variant}`).toBe(id)
    }
    // The one left is a sibling of an item administered this session: nothing is left.
    const sum = all.find((x) => x.v.template === 'system' && x.v.variant === 'sum')!
    const administered: AdministeredItem[] = [
      { item_id: 'i:quant:1.3.0:x', family_id: 'f:quant:elsewhere', family: 'quant', axis: 'QR', sibling_group: 'g:quant:system' },
    ]
    const s = state({ administered, seenFamilies: all.filter((x) => x.id !== sum.id).map((x) => x.id) })
    expect(selectNext(s, createRng('x'), { axes: ['QR'] })).toEqual({ kind: 'none', reason: 'exhausted' })
  })

  it('skips items that would not finish in the remaining time', () => {
    const pool = candidatePool(state({ remainingS: 35 }))
    expect(pool.ranked.length).toBeGreaterThan(0)
    for (const c of pool.ranked) expect(c.item.expected_time_s).toBeLessThanOrEqual(35)
  })

  it('an axis that is done is not selected', () => {
    const pool = candidatePool(state({ posterior: posteriorWith({ MAT: { mean: 0.4, sd: 0.28 } }) }))
    expect(pool.eligibleAxes).toEqual(['QR', 'SPA'])
    for (const c of pool.ranked) expect(c.axis).not.toBe('MAT')
  })

  it('rejects invalid state', () => {
    const rng = createRng('x')
    expect(() => selectNext(state({ sessionSeed: '' }), rng)).toThrow(RangeError)
    expect(() => selectNext(state({ posterior: { ...PRIOR, MAT: undefined } }), rng)).toThrow(RangeError)
    expect(() => selectNext(state({ posterior: posteriorWith({ SPA: { mean: Number.NaN, sd: 1 } }) }), rng)).toThrow(RangeError)
    expect(() => selectNext(state({ remainingS: Number.NaN }), rng)).toThrow(RangeError)
    expect(() => selectNext(state(), rng, { axes: ['XYZ' as AxisCode] })).toThrow(RangeError)
    expect(() => selectNext(state(), rng, { floor: -1 })).toThrow(RangeError)
    expect(() => candidatePool(state(), { topK: 0 })).toThrow(RangeError)
    expect(() => candidatePool(state(), { topK: 2.5 })).toThrow(RangeError)
    expect(() => selectNext(state(), rng, { weights: { SPA: -1 } })).toThrow(RangeError)
  })
})

describe('coverage floor (§7.4 L584)', () => {
  it('under-floor axes compete alone in session 1', () => {
    const administered = [0, 1, 2].map((i) => fakeAdministered('MAT', i)).concat([fakeAdministered('QR', 0)])
    const pool = candidatePool(state({ administered }))
    expect(pool.floorAxes).toEqual(['QR', 'SPA'])
    for (const c of pool.ranked) expect(['SPA', 'QR']).toContain(c.axis)
    // Session 2 has no floor: every eligible axis competes on the criterion.
    const later = candidatePool(state({ administered, sessionNumber: 2 }))
    expect(later.floorAxes).toEqual([])
    expect(new Set(later.ranked.map((c) => c.axis))).toEqual(new Set(CAT_AXES))
  })

  it('a session over all CAT axes gives each exactly 3 items first', () => {
    const seed = 'floor-session'
    const obs: Observation[] = []
    const administered: AdministeredItem[] = []
    const resp = createRng('floor-resp')
    for (let n = 0; n < 3 * CAT_AXES.length; n++) {
      const sel = selectNext({ sessionSeed: seed, posterior: sessionPosterior(obs), administered }, selectionRng(seed, n))
      if (sel.kind !== 'item') throw new Error(sel.reason)
      expect(sel.floor).toBe(true)
      administered.push(sel.item)
      obs.push(respond(sel.item, 0.5, resp.next()))
    }
    const counts = CAT_AXES.map((k) => administered.filter((a) => a.axis === k).length)
    expect(counts).toEqual([3, 3, 3])
    const next = selectNext({ sessionSeed: seed, posterior: sessionPosterior(obs), administered }, selectionRng(seed, 9))
    expect(next.kind === 'item' && next.floor).toBe(false)
  })
})

// ----------------------------------------------------------------------------- properties

const seedArb = fc.string({ minLength: 1, maxLength: 12 })
const postArb = fc.record({ mean: fc.double({ min: -3, max: 3, noNaN: true }), sd: fc.double({ min: 0.3, max: 1.2, noNaN: true }) })
const catPosteriorArb = fc.record({ MAT: postArb, SPA: postArb, QR: postArb }).map((p) => posteriorWith(p))
const weightArb = fc.constantFrom(0, 0.5, 1, 2)
const weightsArb = fc.record({ MAT: weightArb, SPA: weightArb, QR: weightArb })

describe('selector properties (fast-check)', () => {
  it('is deterministic per seed and differs only in the randomesque draw', () => {
    fc.assert(
      fc.property(seedArb, catPosteriorArb, fc.string(), (seed, posterior, rngSeed) => {
        const s = state({ sessionSeed: seed, posterior })
        const a = selectNext(s, createRng(rngSeed))
        const b = selectNext(s, createRng(rngSeed))
        expect(b).toEqual(a)
        if (a.kind === 'item') {
          const pool = candidatePool(s)
          expect(pool.ranked[a.rank]!.item).toEqual(a.item)
        }
      }),
      { numRuns: 40 },
    )
  })

  it('never returns an excluded family or a used sibling group (§7.7, A11)', () => {
    fc.assert(
      fc.property(seedArb, catPosteriorArb, fc.nat(), fc.nat(), (seed, posterior, seenMask, adminMask) => {
        const base = candidatePool(state({ sessionSeed: seed, posterior })).ranked
        // Earlier sessions saw some of these families; this session administered some others,
        // quant among them, so their sibling groups are used (M1.F2 `sibling_group`).
        const seenFamilies = base.filter((_, i) => (seenMask >> i % 30) & 1).map((c) => c.item.family_id)
        const administered = base.filter((_, i) => (adminMask >> i % 30) & 1 && !seenFamilies.includes(base[i]!.item.family_id)).map((c) => c.item)
        const s = state({ sessionSeed: seed, posterior, seenFamilies, administered })
        const excluded = new Set([...seenFamilies, ...administered.map((a) => a.family_id)])
        const siblings = new Set(administered.map((a) => a.sibling_group))
        const pool = candidatePool(s)
        for (const c of pool.ranked) {
          expect(excluded.has(c.item.family_id)).toBe(false)
          expect(siblings.has(c.item.sibling_group)).toBe(false)
        }
        const sel = selectNext(s, createRng(seed))
        if (sel.kind === 'item') expect(excluded.has(sel.item.family_id)).toBe(false)
      }),
      { numRuns: 40 },
    )
  })

  it('never selects an axis with w_k = 0 (§7.4 L577)', () => {
    fc.assert(
      fc.property(seedArb, catPosteriorArb, weightsArb, (seed, posterior, weights) => {
        const s = state({ sessionSeed: seed, posterior })
        const pool = candidatePool(s, { weights })
        for (const c of pool.ranked) expect(weights[c.axis as 'MAT' | 'SPA' | 'QR']).toBeGreaterThan(0)
        for (const c of pool.ranked) expect(c.score).toBeCloseTo(criterion(c.item, posterior[c.axis]!, weights[c.axis as 'MAT' | 'SPA' | 'QR']), 15)
        const sel = selectNext(s, createRng(seed), { weights })
        if (CAT_AXES.every((k) => weights[k as 'MAT' | 'SPA' | 'QR'] === 0)) expect(sel).toEqual({ kind: 'none', reason: 'no_axes' })
        else if (sel.kind === 'item') expect(weights[sel.axis as 'MAT' | 'SPA' | 'QR']).toBeGreaterThan(0)
      }),
      { numRuns: 40 },
    )
  })

  it('never returns a fixed block as a CAT item, whatever families it is given (A10)', () => {
    const all = Object.values(FAMILIES)
    fc.assert(
      fc.property(seedArb, fc.shuffledSubarray(all, { minLength: 1 }), (seed, families) => {
        const sel = selectNext(state({ sessionSeed: seed }), createRng(seed), { families })
        if (families.every((f) => FIXED_BLOCK_FAMILIES.has(f.name))) expect(sel).toEqual({ kind: 'none', reason: 'no_axes' })
        if (sel.kind === 'item') {
          expect(FIXED_BLOCK_FAMILIES.has(sel.item.family)).toBe(false)
          expect(['2pl', '3pl', '2pl_testlet']).toContain(sel.item.params.model)
          expect(families.map((f) => f.name)).toContain(sel.item.family)
        }
      }),
      { numRuns: 30 },
    )
  })

  it('keeps the coverage floor: an under-floor axis with candidates is always chosen first', () => {
    const countsArb = fc.record({ MAT: fc.nat({ max: 5 }), SPA: fc.nat({ max: 5 }), QR: fc.nat({ max: 5 }) })
    fc.assert(
      fc.property(seedArb, countsArb, (seed, counts) => {
        const administered = CAT_AXES.flatMap((k) => Array.from({ length: counts[k as 'MAT' | 'SPA' | 'QR'] }, (_, i) => fakeAdministered(k, i)))
        const sel = selectNext(state({ sessionSeed: seed, administered }), createRng(seed))
        expect(sel.kind).toBe('item')
        if (sel.kind !== 'item') return
        const under = CAT_AXES.filter((k) => counts[k as 'MAT' | 'SPA' | 'QR'] < COVERAGE_FLOOR)
        if (under.length > 0) {
          expect(under).toContain(sel.axis)
          expect(sel.floor).toBe(true)
        } else expect(sel.floor).toBe(false)
      }),
      { numRuns: 40 },
    )
  })

  it('a randomesque pick is always among the top k', () => {
    fc.assert(
      fc.property(fc.uniqueArray(fc.double({ noNaN: true, noDefaultInfinity: true }), { minLength: 1, maxLength: 30 }), fc.integer({ min: 1, max: 8 }), fc.string(), (scores, k, seed) => {
        const ranked = [...scores].sort((x, y) => y - x)
        const { value, rank } = pickRandomesque(ranked, createRng(seed), k)
        expect(rank).toBeLessThan(Math.min(k, ranked.length))
        expect(value).toBe(ranked[rank])
        expect(ranked.filter((s) => s > value).length).toBeLessThan(k)
      }),
    )
    expect(() => pickRandomesque([], createRng('x'))).toThrow(RangeError)
    expect(() => pickRandomesque([1], createRng('x'), 0)).toThrow(RangeError)
  })
})

// --------------------------------------------------------------------------- uniformity

describe('randomesque top-5 uniformity (chi-square, α = .001)', () => {
  it('pickRandomesque is uniform over the top 5 of distinct scores', () => {
    const ranked = [9, 8, 7, 6, 5, 4, 3, 2] // ties controlled: all distinct
    const counts = new Array<number>(8).fill(0)
    for (let i = 0; i < 10_000; i++) counts[pickRandomesque(ranked, createRng(`chi/${i}`)).rank]!++
    expect(counts.slice(5)).toEqual([0, 0, 0])
    expect(chiSquare(counts.slice(0, 5))).toBeLessThan(CHI2_DF4_A001)
  })

  it('selections are uniform over the real pool’s top 5 when drawn from selectionRng', () => {
    const s = state({ sessionSeed: 'chi-pool' })
    const pool = candidatePool(s)
    // Ties controlled: the 5th and 6th scores differ, so the top 5 is one set.
    expect(pool.ranked[4]!.score).toBeGreaterThan(pool.ranked[5]!.score)
    const top = pool.ranked.slice(0, 5).map((c) => c.item.item_id)
    const counts = new Array<number>(5).fill(0)
    for (let i = 0; i < 10_000; i++) counts[pickRandomesque(pool.ranked, selectionRng(`chi-pool/${i}`, 0)).rank]!++
    expect(chiSquare(counts)).toBeLessThan(CHI2_DF4_A001)
    // selectNext is exactly that draw on that pool.
    const seen = new Set<string>()
    for (let i = 0; i < 60; i++) {
      const sel = selectNext(s, selectionRng(`chi-pool/${i}`, 0))
      if (sel.kind !== 'item') throw new Error(sel.reason)
      expect(sel.item.item_id).toBe(top[pickRandomesque(pool.ranked, selectionRng(`chi-pool/${i}`, 0)).rank])
      seen.add(sel.item.item_id)
    }
    expect(seen).toEqual(new Set(top))
  })
})

// ------------------------------------------------------------------------------ counters

describe('seeds follow the session counter', () => {
  it('every selection of a session draws from <sessionSeed>.<counter>.<j>@s<k>', () => {
    const seed = 'ctr-session'
    const obs: Observation[] = []
    const administered: AdministeredItem[] = []
    const resp = createRng('ctr-resp')
    for (let n = 0; n < 12; n++) {
      const sel = selectNext({ sessionSeed: seed, posterior: sessionPosterior(obs), administered }, selectionRng(seed, n))
      if (sel.kind !== 'item') throw new Error(sel.reason)
      const itemSeed = parseItemId(sel.item.item_id)!.seed
      const m = /^ctr-session\.(\d+)\.(\d+)@s([1-6])$/.exec(itemSeed)
      expect(m, itemSeed).not.toBeNull()
      const [counter, j, k] = [Number(m![1]), Number(m![2]), Number(m![3])]
      expect(counter).toBe(n)
      expect(j).toBeLessThan(SWEEP_ATTEMPTS)
      expect(k).toBe(sel.item.stratum)
      expect(itemSeed).toBe(`${candidateSeed(seed, n, j)}@s${k}`)
      administered.push(sel.item)
      obs.push(respond(sel.item, 0.3, resp.next()))
    }
  })

  it('the randomesque draw is uniform across the selections of one session (chi-square, α = .001)', () => {
    const ranked = [9, 8, 7, 6, 5, 4, 3, 2]
    const counts = new Array<number>(RANDOMESQUE_K).fill(0)
    for (let n = 0; n < 10_000; n++) counts[pickRandomesque(ranked, selectionRng('one-session', n)).rank]!++
    expect(chiSquare(counts)).toBeLessThan(CHI2_DF4_A001)
  })
})

// --------------------------------------------------------------------------- simulation

describe('simulation: selected b tracks a known θ', () => {
  /** Mean |b − θ| by position over `perTheta` simulees at each θ, `n` items on one axis. */
  function trajectory(axis: AxisCode, thetas: readonly number[], n: number, perTheta: number): number[] {
    const dev = new Array<number>(n).fill(0)
    for (const theta of thetas) {
      for (let s = 0; s < perTheta; s++) {
        const seed = `sim/${axis}/${theta}/${s}`
        const resp = createRng(`${seed}/responses`)
        const obs: Observation[] = []
        const administered: AdministeredItem[] = []
        for (let i = 0; i < n; i++) {
          const sel = selectNext({ sessionSeed: seed, posterior: sessionPosterior(obs), administered }, selectionRng(seed, i), { axes: [axis] })
          if (sel.kind !== 'item') throw new Error(sel.reason)
          dev[i]! += Math.abs(bOf(sel.item) - theta) / (thetas.length * perTheta)
          administered.push(sel.item)
          obs.push(respond(sel.item, theta, resp.next()))
        }
      }
    }
    return dev
  }
  const mean = (xs: readonly number[]): number => xs.reduce((s, x) => s + x, 0) / xs.length

  for (const axis of CAT_AXES) {
    it(`${axis}: from a far θ, mean |b − θ| shrinks over a 12-item session`, () => {
      const dev = trajectory(axis, [-2, -1.5, 1.5, 2], 12, 8)
      const first = mean(dev.slice(0, 3))
      const last = mean(dev.slice(-3))
      expect(last).toBeLessThan(0.8 * first)
      expect(mean(dev.slice(4, 8))).toBeLessThan(first)
    })

    // From a mid θ the first items (at the prior θ̂ = 0) are already on target: b must stay there,
    // not drift off as the near strata run dry under exclusion (review fix: QR drifted to ~1.2).
    it(`${axis}: from a mid θ, mean |b − θ| stays on target over a 12-item session`, () => {
      const dev = trajectory(axis, [-1, -0.5, 0, 0.5], 12, 6)
      const first = mean(dev.slice(0, 3))
      const last = mean(dev.slice(-3))
      expect(last).toBeLessThan(0.9)
      expect(last).toBeLessThan(first + 0.3)
    })
  }
})

// ------------------------------------------------------------------------ block schedule

describe('block scheduler (A15)', () => {
  it('returns the blocks and CAT segments in the A15 order', () => {
    const plan = planSession({ sessionSeed: 'plan' })
    expect(plan.map((s) => (s.kind === 'block' ? `${s.family}` : `cat:${s.axes.join('+')}`))).toEqual([
      'rt_simple',
      'rt_choice4',
      'cat:MAT',
      'cat:SPA',
      'span_fwd',
      'span_bwd',
      'corsi',
      'cat:QR',
      'coding',
      'reading',
    ])
    // One block family per RT sub-task (M1.F2): simple, then 4-choice.
    const rtModes = plan.flatMap((s) => (s.kind === 'block' && s.axis === 'RT' ? [(s.item.spec as { mode: string }).mode] : []))
    expect(rtModes).toEqual(['simple', 'choice4'])
    expect(plan.map((s) => s.segment)).toEqual(['rt', 'rt', 'matrix_series', 'spatial', 'memory', 'memory', 'memory', 'quant', 'coding_reading', 'coding_reading'])
  })

  it('blocks are generated instances that regenerate from their ids and are never CAT items', () => {
    const blocks = scheduleBlocks({ sessionSeed: 'plan' })
    expect(blocks.map((b) => b.family)).toEqual(['rt_simple', 'rt_choice4', 'span_fwd', 'span_bwd', 'corsi', 'coding', 'reading'])
    for (const b of blocks) {
      expect(b.item.family).toBe(b.family)
      expect(b.item.axis).toBe(b.axis)
      expect(['grm', 'gaussian']).toContain(b.item.params.model)
      const id = parseItemId(b.item.item_id)!
      expect(getFamily(id.family)!.generate(id.seed)).toEqual(b.item)
    }
    expect(new Set(blocks.map((b) => b.item.item_id)).size).toBe(blocks.length)
    expect(scheduleBlocks({ sessionSeed: 'plan' })).toEqual(blocks)
    expect(scheduleBlocks({ sessionSeed: 'plan2' })[2]!.item.item_id).not.toBe(blocks[2]!.item.item_id)
  })

  it('shares the time left after the blocks among the CAT segments', () => {
    const plan = planSession({ sessionSeed: 'plan' })
    const blockTime = scheduleBlocks({ sessionSeed: 'plan' }).reduce((s, b) => s + b.item.expected_time_s, 0)
    const cats = plan.filter((s) => s.kind === 'cat')
    expect(cats).toHaveLength(3)
    for (const c of cats) expect(c.budget_s).toBeCloseTo((A15_TARGET_S - blockTime) / 3, 9)
    expect(cats[0]!.budget_s).toBeGreaterThan(180)
    const short = planSession({ sessionSeed: 'plan', targetS: 60 })
    for (const s of short) if (s.kind === 'cat') expect(s.budget_s).toBe(0)
  })

  it('drops the blocks and segments of skipped axes (w_k = 0) and gives their time to the rest', () => {
    const plan = planSession({ sessionSeed: 'plan', weights: { WM: 0, SPA: 0, RT: 0 } })
    expect(plan.map((s) => (s.kind === 'block' ? s.family : `cat:${s.axes.join('+')}`))).toEqual(['cat:MAT', 'cat:QR', 'coding', 'reading'])
    const blockTime = plan.reduce((s, x) => s + (x.kind === 'block' ? x.item.expected_time_s : 0), 0)
    for (const s of plan) if (s.kind === 'cat') expect(s.budget_s).toBeCloseTo((A15_TARGET_S - blockTime) / 2, 9)
    const none = planSession({ sessionSeed: 'plan', weights: Object.fromEntries(AXIS_CODES.map((k) => [k, 0])) })
    expect(none).toEqual([])
  })

  it('block seeds are <sessionSeed>.blk.<family>, then .<n> for the n-th re-draw', () => {
    expect(blockSeed('s', 'reading')).toBe('s.blk.reading')
    expect(blockSeed('s', 'reading', 0)).toBe('s.blk.reading')
    expect(blockSeed('s', 'reading', 3)).toBe('s.blk.reading.3')
  })

  it('re-draws a block whose family was seen in an earlier session (§7.7)', () => {
    const first = scheduleBlocks({ sessionSeed: 'plan' })
    const r0 = first.find((b) => b.family === 'reading')!.item
    const again = scheduleBlocks({ sessionSeed: 'plan', seenFamilies: [r0.family_id] })
    const r1 = again.find((b) => b.family === 'reading')!.item
    expect(r1.family_id).not.toBe(r0.family_id)
    const id = parseItemId(r1.item_id)!
    expect(id.seed).toMatch(/^plan\.blk\.reading\.\d+$/)
    expect(reading.generate(id.seed)).toEqual(r1)
    expect(again.filter((b) => b.family !== 'reading')).toEqual(first.filter((b) => b.family !== 'reading'))
    expect(scheduleBlocks({ sessionSeed: 'plan', seenFamilies: [r0.family_id] })).toEqual(again)
  })

  it('a returning user never reads a seen passage (property), and each session reads a new one', () => {
    const all = PASSAGES.map((p) => reading.familyIdOf(readingStructure(p.id)))
    fc.assert(
      fc.property(seedArb, fc.subarray(all, { maxLength: all.length - 1 }), (seed, seen) => {
        const r = scheduleBlocks({ sessionSeed: seed, seenFamilies: seen }).find((b) => b.family === 'reading')
        expect(r).toBeDefined()
        expect(seen).not.toContain(r!.item.family_id)
      }),
      { numRuns: 50 },
    )
    const seen: string[] = []
    for (let n = 1; n <= all.length; n++) {
      const r = scheduleBlocks({ sessionSeed: `user/${n}`, seenFamilies: seen }).find((b) => b.family === 'reading')!
      expect(seen).not.toContain(r.item.family_id)
      seen.push(r.item.family_id)
    }
    expect(new Set(seen)).toEqual(new Set(all))
  })

  it('drops the reading block once every passage is seen, and gives its time to the CAT segments', () => {
    const all = PASSAGES.map((p) => reading.familyIdOf(readingStructure(p.id)))
    const plan = planSession({ sessionSeed: 'plan', seenFamilies: all })
    const blocks = plan.flatMap((s) => (s.kind === 'block' ? [s] : []))
    expect(blocks.map((b) => b.family)).toEqual(['rt_simple', 'rt_choice4', 'span_fwd', 'span_bwd', 'corsi', 'coding'])
    const blockTime = blocks.reduce((t, b) => t + b.item.expected_time_s, 0)
    for (const s of plan) if (s.kind === 'cat') expect(s.budget_s).toBeCloseTo((A15_TARGET_S - blockTime) / 3, 9)
  })

  it('RT is exempt: an RT sub-task is one family, measured every session; every other block is re-drawn', () => {
    expect([...SEEN_EXEMPT_BLOCKS].sort()).toEqual(['rt_choice4', 'rt_simple'])
    for (const name of SEEN_EXEMPT_BLOCKS) expect(new Set([0, 1, 2].map((i) => getFamily(name)!.generate(`fam-${i}`).family_id)).size, name).toBe(1)
    const first = scheduleBlocks({ sessionSeed: 'plan' })
    const seen = first.map((b) => b.item.family_id)
    const again = scheduleBlocks({ sessionSeed: 'plan', seenFamilies: seen })
    const exempt = (b: { family: string }): boolean => SEEN_EXEMPT_BLOCKS.has(b.family)
    expect(again.map((b) => b.family)).toEqual(first.map((b) => b.family))
    expect(again.filter(exempt)).toEqual(first.filter(exempt))
    for (const b of again) if (!exempt(b)) expect(seen).not.toContain(b.item.family_id)
  })

  it('rejects invalid options', () => {
    expect(() => planSession({ sessionSeed: '' })).toThrow(RangeError)
    expect(() => planSession({ sessionSeed: 'x', targetS: -1 })).toThrow(RangeError)
    expect(() => planSession({ sessionSeed: 'x', targetS: Number.NaN })).toThrow(RangeError)
    expect(() => planSession({ sessionSeed: 'x', weights: { RT: -1 } })).toThrow(RangeError)
  })
})
