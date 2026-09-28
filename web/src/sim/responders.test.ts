/**
 * Simulated takers of the M1.4b CAT simulation (`responders.ts`): every response is in the
 * family's own format, the family's `score()` accepts it, and the resulting observations follow
 * the scoring model of the item's own parameters (A9 items, A10 blocks).
 */

import fc from 'fast-check'
import { describe, expect, it } from 'vitest'
import { grmProbs, p2pl, p3pl } from '../engine/irt'
import { createRng } from '../engine/prng'
import type { BlockScore, ItemInstance } from '../tasks/family'
import { FAMILIES, getFamily } from '../tasks/registry'
import type { SpanItem } from '../tasks/span/config'
import { categoryOf } from '../tasks/span/protocol'
import { itemProtocol } from '../tasks/span/score'
import {
  RT_FAMILIES,
  SPAN_FAMILIES,
  answerBlock,
  answerItem,
  grmCategory,
  itemObservation,
  itemResponse,
  pCorrect,
  poisson,
  spanStream,
  type AnyItem,
} from './responders'

const ITEM_FAMILIES = Object.values(FAMILIES).filter((f) => f.kind === 'item')
const BLOCK_FAMILIES = Object.values(FAMILIES).filter((f) => f.kind === 'block')
const theta = fc.integer({ min: -300, max: 300 }).map((i) => i / 100)

function mean(xs: readonly number[]): number {
  return xs.reduce((a, b) => a + b, 0) / xs.length
}
function sd(xs: readonly number[]): number {
  const m = mean(xs)
  return Math.sqrt(xs.reduce((a, b) => a + (b - m) ** 2, 0) / (xs.length - 1))
}

describe('keyed items (A9)', () => {
  it('covers every registered item family and every block family by response format', () => {
    expect(ITEM_FAMILIES.map((f) => f.name).sort()).toEqual(['matrices', 'quant', 'rotation', 'series'])
    for (const f of BLOCK_FAMILIES) expect(SPAN_FAMILIES.has(f.name) || RT_FAMILIES.has(f.name) || f.name === 'coding' || f.name === 'reading', f.name).toBe(true)
  })

  it("answers in the family's format and its score() agrees with y (property)", () => {
    fc.assert(
      fc.property(fc.constantFrom(...ITEM_FAMILIES), fc.string({ minLength: 1, maxLength: 8 }), theta, (fam, seed, t) => {
        const item = fam.generate(`resp.${seed}`)
        const rng = createRng(`r.${seed}.${t}`)
        for (const y of [0, 1] as const) {
          const response = itemResponse(item, y, rng)
          expect(fam.score(item, response).correct).toBe(y)
        }
        const ans = answerItem(fam, item, t, rng)
        expect(ans.observation).toEqual(itemObservation(item, ans.y))
      }),
      { numRuns: 200 },
    )
  })

  it('draws y with the probability of the item’s own model (2PL, 3PL with its c)', () => {
    const rot = getFamily('rotation')!.generate('p3') // 4 options: 3PL, c = 1/4 (A9)
    const mat = getFamily('matrices')!.generate('p2') // 6 options: 2PL
    expect(rot.params.model).toBe('3pl')
    expect(mat.params.model).toBe('2pl')
    for (const [item, fam, t] of [[rot, 'rotation', 0.5], [mat, 'matrices', -0.3]] as const) {
      const f = getFamily(fam)!
      const rng = createRng(`rate.${fam}`)
      const n = 20_000
      let k = 0
      for (let i = 0; i < n; i++) k += answerItem(f, item, t, rng).y
      const p = pCorrect(item, t)
      const p0 = item.params.model === '3pl' ? p3pl(t, item.params.a, item.params.b, item.params.c) : item.params.model === '2pl' ? p2pl(t, item.params.a, item.params.b) : Number.NaN
      expect(p).toBe(p0)
      expect(Math.abs(k / n - p)).toBeLessThan(5 * Math.sqrt((p * (1 - p)) / n))
    }
  })

  it('maps item models to observations and rejects blocks', () => {
    const base = { item_id: 'x', axis: 'MAT' as const }
    expect(itemObservation({ ...base, params: { model: '2pl_testlet', a: 1.2, b: 0.3 } }, 1)).toEqual({ kind: '2pl', axis: 'MAT', a: 1.2, b: 0.3, y: 1 })
    expect(itemObservation({ ...base, params: { model: '3pl', a: 1, b: 0, c: 0.25 } }, 0)).toEqual({ kind: '3pl', axis: 'MAT', a: 1, b: 0, c: 0.25, y: 0 })
    const block = { ...base, params: { model: 'gaussian' as const, lam: 1, d: 0, sigma: 0.1 } }
    expect(() => itemObservation(block, 1)).toThrow(RangeError)
    expect(() => pCorrect(block, 0)).toThrow(RangeError)
    expect(() => answerItem(getFamily('coding')!, getFamily('coding')!.generate('x'), 0, createRng('x'))).toThrow(RangeError)
  })
})

describe('span blocks (GRM, A10)', () => {
  const spans = BLOCK_FAMILIES.filter((f) => SPAN_FAMILIES.has(f.name))

  it('a taker with longest passed length L scores category(L) for every L (property)', () => {
    fc.assert(
      fc.property(fc.constantFrom(...spans), fc.string({ maxLength: 6 }), fc.integer({ min: 0, max: 12 }), (fam, seed, raw) => {
        const item = fam.generate(`span.${seed}`) as unknown as SpanItem
        const p = itemProtocol(item)
        const longest = raw < p.start_length ? 0 : Math.min(raw, p.max_length)
        const score = fam.score(item as unknown as AnyItem, spanStream(item, longest)) as BlockScore
        expect(score.observation).toMatchObject({ kind: 'grm', axis: 'WM', y: categoryOf(p, longest) })
      }),
      { numRuns: 150 },
    )
  })

  it('grmCategory draws the GRM category probabilities of the block params', () => {
    const item = getFamily('span_fwd')!.generate('grm')
    if (item.params.model !== 'grm') throw new Error('span_fwd must be GRM')
    const { a, b } = item.params
    const rng = createRng('grm-freq')
    const n = 40_000
    const t = 0.4
    const counts = new Array<number>(b.length + 1).fill(0)
    for (let i = 0; i < n; i++) counts[grmCategory(t, a, b, rng.next())]!++
    grmProbs(t, a, b).forEach((p, j) => expect(Math.abs(counts[j]! / n - p), `category ${j}`).toBeLessThan(5 * Math.sqrt((p * (1 - p)) / n) + 1e-9))
    expect(grmCategory(t, a, b, 0)).toBe(b.length)
    expect(grmCategory(t, a, b, 1 - 2 ** -53)).toBe(0)
  })
})

/** Observations of `n` simulated blocks of family `name` at θ. */
function blockObs(name: string, t: number, n: number): { x: number[]; sigma: number[]; scores: BlockScore[] } {
  const fam = getFamily(name)!
  const x: number[] = []
  const sigma: number[] = []
  const scores: BlockScore[] = []
  for (let i = 0; i < n; i++) {
    const item = fam.generate(`blk.${name}.${i}`)
    const { score } = answerBlock(fam, item, t, createRng(`taker.${name}.${i}`))
    scores.push(score)
    const o = score.observation
    if (o?.kind === 'gaussian') {
      x.push(o.x)
      sigma.push(o.sigma)
    }
  }
  return { x, sigma, scores }
}

function gaussianParams(name: string): { lam: number; d: number; sigma: number } {
  const p = getFamily(name)!.generate('params').params
  if (p.model !== 'gaussian') throw new Error(`${name} must be Gaussian`)
  return p
}

describe('Gaussian blocks (RT, coding, reading; A10)', () => {
  it.each(['rt_simple', 'rt_choice4', 'coding', 'reading'])('%s: every block yields an observation whose x follows N(lam·θ + d, sigma²)', (name) => {
    const n = 400
    for (const t of [-2, 0, 1.5]) {
      const { x, sigma, scores } = blockObs(name, t, n)
      expect(scores.every((s) => s.observation !== undefined && s.reasons.length === 0), `${name} at θ = ${t}`).toBe(true)
      // z against each block's own observation (reading passages differ in d by their era prior)
      const z = scores.map((s) => {
        const o = s.observation!
        if (o.kind !== 'gaussian') throw new Error('not gaussian')
        return (o.x - (o.lam * t + o.d)) / o.sigma
      })
      expect(Math.abs(mean(z)), `${name} at θ = ${t}: mean z`).toBeLessThan(0.25)
      expect(Math.abs(sd(z) - 1), `${name} at θ = ${t}: sd z`).toBeLessThan(0.25)
      if (name !== 'reading') {
        const { lam, d } = gaussianParams(name) // one design per family: every block shares lam and d
        expect(Math.abs(mean(x) - (lam * t + d))).toBeLessThan(4 * (mean(sigma) / Math.sqrt(n)) + 0.02)
      }
    }
  })

  it('RT keeps every scored trial valid and in order (no lapses)', () => {
    const fam = getFamily('rt_choice4')!
    const item = fam.generate('rt-valid') as ItemInstance<{ positions: number[] }, object>
    const { response, score } = answerBlock(fam, item as unknown as AnyItem, -1, createRng('rt-valid'))
    const r = response as { rt_ms: number[]; choice: number[] }
    expect(r.choice).toEqual(item.spec.positions)
    expect(r.rt_ms.every((v) => v > 0 && Math.round(v * 10) === v * 10)).toBe(true)
    expect(score.observation).toMatchObject({ kind: 'gaussian', axis: 'RT' })
  })

  it('coding answers only right keys, evenly spaced inside the window', () => {
    const fam = getFamily('coding')!
    const item = fam.generate('code-even')
    const { response } = answerBlock(fam, item, 0, createRng('code-even'))
    const rs = response as { digit: number; t_ms: number }[]
    expect(rs.length).toBeGreaterThan(30)
    expect(rs.every((r, k) => k === 0 || r.t_ms > rs[k - 1]!.t_ms)).toBe(true)
    expect(rs[rs.length - 1]!.t_ms).toBeLessThan(90_000)
  })

  it('rejects an item family and an unknown block family', () => {
    const rot = getFamily('rotation')!
    expect(() => answerBlock(rot, rot.generate('x'), 0, createRng('x'))).toThrow(RangeError)
    const coding = getFamily('coding')!
    expect(() => answerBlock(coding, { ...coding.generate('x'), family: 'mystery' }, 0, createRng('x'))).toThrow(/no simulated taker/)
  })
})

describe('poisson', () => {
  it('has mean and variance λ', () => {
    for (const lambda of [0.5, 12, 60, 130]) {
      const rng = createRng(`pois.${lambda}`)
      const xs = Array.from({ length: 20_000 }, () => poisson(lambda, rng))
      expect(xs.every((x) => Number.isInteger(x) && x >= 0)).toBe(true)
      expect(Math.abs(mean(xs) - lambda)).toBeLessThan(5 * Math.sqrt(lambda / xs.length))
      expect(Math.abs(sd(xs) ** 2 / lambda - 1)).toBeLessThan(0.05)
    }
    expect(poisson(0, createRng('z'))).toBe(0)
    expect(() => poisson(-1, createRng('z'))).toThrow(RangeError)
    expect(() => poisson(701, createRng('z'))).toThrow(RangeError)
  })
})
