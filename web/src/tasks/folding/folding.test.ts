/**
 * The paper-folding family end to end (DESIGN §3 row 7, §4.1, §14.3 M1 acceptance 1; ROADMAP A1,
 * A9, A11, M1.P): the shared property suite at n = 10,000 and over the requested strata, the strata
 * table and the prior, option-only cues at chance, tamper tests the verifier rejects, scoring.
 */

import { describe, expect, it } from 'vitest'
import { MalformedResponseError } from '../family'
import { canonicalJson } from '../ids'
import { STRATUM_B_CUTS, stratumOfB } from '../priors'
import { runFamilyProperties } from '../testing'
import { cueSets, typicalityRank } from './cues'
import { FOLDING_CLASSES, FOLDING_STRATA, classesOf, foldSequences, steps } from './gen'
import { lureSignature } from './reasons'
import { SHEET_SYMMETRIES, SIDE_DIR, foldPlan, foldingStructure, isPlan, mapSlots, sideOfDir, slotPt, strictlyInside, type Shape } from './geometry'
import { FOLDING_PROVENANCE, foldingBPrior, foldingExpectedTime } from './prior'
import { folding, foldingSpecLeaksKey, type FoldingItem } from '.'

const OPTS = {
  specLeaksKey: foldingSpecLeaksKey,
  correctResponse: (item: FoldingItem) => item.key.index,
  incorrectResponse: (item: FoldingItem) => (item.key.index + 1) % 5,
  malformedResponses: () => [-1, 5, 0.5, '0', [0]],
} as const

type Mutable = { -readonly [K in keyof FoldingItem]: unknown }

function tamper(item: FoldingItem, f: (x: Mutable) => void): FoldingItem {
  const x = JSON.parse(JSON.stringify(item)) as Mutable
  f(x)
  return x as unknown as FoldingItem
}

describe('folding family (paper folding, SPA)', () => {
  it('passes runFamilyProperties at n = 10,000 (natural pool)', () => {
    const r = runFamilyProperties(folding, OPTS)
    expect(r.n).toBe(10_000)
    expect(r.distinctContents).toBeGreaterThan(9_500)
    expect(r.distinctFamilyIds).toBeGreaterThan(6_000)
    for (const k of [1, 2, 3, 4, 5, 6] as const) expect(r.strataCounts[k]).toBeGreaterThan(1_400)
  }, 600_000)

  it('passes with requested strata (n = 2,000 over 1–6)', () => {
    const r = runFamilyProperties(folding, { ...OPTS, n: 2_004, strata: folding.strata, seedPrefix: 'strata-' })
    for (const k of folding.strata) expect(r.strataCounts[k]).toBe(334)
  }, 400_000)

  it('reaches strata 1–6, and each class sits in the default band of its b (M1.P)', () => {
    expect(FOLDING_STRATA).toEqual([1, 2, 3, 4, 5, 6])
    expect(folding.strata).toEqual([1, 2, 3, 4, 5, 6])
    for (const c of FOLDING_CLASSES) {
      expect(stratumOfB(c.bPrior)).toBe(c.stratum)
      expect(Number.isInteger(c.bPrior * 16)).toBe(true)
      expect(c.sequences.length).toBeGreaterThan(0)
    }
    // The design's strata (prior.ts table).
    expect(classesOf(1).every((c) => c.nFolds === 1 && !c.diagonal && c.nPunches === 1)).toBe(true)
    expect(classesOf(6).every((c) => c.grid === 6 && c.diagonal)).toBe(true)
    expect(classesOf(5).every((c) => c.diagonal)).toBe(true)
    expect(FOLDING_CLASSES).toHaveLength(48)
    const bs = FOLDING_CLASSES.map((c) => c.bPrior)
    expect(Math.min(...bs)).toBe(-2.125)
    expect(Math.max(...bs)).toBe(3.5)
    expect(STRATUM_B_CUTS).toEqual([-1.5, -0.5, 0.5, 1.5, 2.5])
  })

  it('enumerates the fold sequences: 4 one-fold, and every sequence is 1–3 legal folds', () => {
    const four = foldSequences(4)
    expect(four.filter((s) => s.sides.length === 1).map((s) => s.sides[0])).toEqual(['left', 'right', 'top', 'bottom', 'bottom_left', 'top_right', 'top_left', 'bottom_right'])
    expect(four.filter((s) => s.sides.length === 1 && ['left', 'right'].includes(s.sides[0] as string)).every((s) => s.interior === 8)).toBe(true)
    // A diagonal fold leaves the 6 slots off the diagonal on one side.
    expect(four.find((s) => s.sides.join() === 'top_right')?.interior).toBe(6)
    // 6×6: a vertical fold leaves a 3-wide strip, which does not fold vertically again (even sizes only).
    const six = foldSequences(6)
    expect(six.some((s) => s.sides.join() === 'right,left')).toBe(false)
    expect(six.some((s) => s.sides.join() === 'right,bottom,top_right')).toBe(true)
  })

  it('uses 2PL (A9, five options) and the [SPEC] v0 prior and time', () => {
    const item = folding.generate('params')
    expect(item.params).toEqual({ model: '2pl', a: 1, b: item.difficulty.b_prior })
    expect(item.options_count).toBe(5)
    expect(item.difficulty.provenance).toBe(FOLDING_PROVENANCE)
    const f = item.difficulty.features as unknown as Parameters<typeof foldingBPrior>[0]
    expect(item.difficulty.b_prior).toBe(foldingBPrior(f))
    expect(item.expected_time_s).toBe(foldingExpectedTime(item.spec.folds.length, item.spec.punches.length))
    expect(foldingBPrior({ n_folds: 1, n_punches: 1, holes: 2, diagonal: false, near_miss: false, grid: 4 })).toBe(-2.125)
    expect(foldingBPrior({ n_folds: 3, n_punches: 2, holes: 16, diagonal: true, near_miss: true, grid: 6 })).toBe(3.5)
    expect(foldingExpectedTime(1, 1)).toBe(35)
    expect(foldingExpectedTime(3, 3)).toBe(65)
    expect(item.time_limit_s).toBe(180)
  })

  it('targets strata through the seed and refuses the ones it cannot make', () => {
    const item = folding.generate('demo', { stratum: 6 })
    expect(item.seed).toBe('demo@s6')
    expect(item.stratum).toBe(6)
    expect(item.spec.grid).toBe(6)
    expect(folding.generate('demo@s6')).toEqual(item)
    expect(() => folding.generate('demo', { stratum: 7 })).toThrow(RangeError)
  })

  it('keeps option-only cues at chance: the key is the most typical option about 1 time in 5, and no enforced cue picks it', () => {
    const n = 1_500
    let medoidKey = 0
    const ranks = [0, 0, 0, 0, 0]
    for (let i = 0; i < n; i++) {
      const item = folding.generate(`cues-${i}`)
      const sheets = item.spec.options.map((o) => o.holes)
      const sets = cueSets(sheets, item.spec.grid)
      if (sets.medoid.length === 1 && sets.medoid[0] === item.key.index) medoidKey++
      ranks[typicalityRank(sheets, item.key.index)] = (ranks[typicalityRank(sheets, item.key.index)] ?? 0) + 1
      for (const c of ['most_holes', 'fewest_holes', 'odd_count', 'symmetric', 'asymmetric', 'most_symmetric'] as const) {
        expect(sets[c].length === 1 && sets[c][0] === item.key.index).toBe(false)
      }
    }
    // Chance is 1/5 = 300 of 1,500; a naive draw gives about 1,000.
    expect(medoidKey).toBeLessThan(0.25 * n)
    for (const r of ranks) expect(r).toBeGreaterThan(0.15 * n)
  }, 120_000)

  it('gives isomorphs (the whole item turned or mirrored, same lures) one family_id', () => {
    for (const stratum of [1, 3, 6]) {
      const item = folding.generate(`iso-${stratum}`, { stratum })
      const n = item.spec.grid
      const sides = item.spec.folds.map((f) => f.moving)
      const lures = (item.structural_params as { lures: string[] }).lures
      expect(lures).toHaveLength(4)
      for (const g of SHEET_SYMMETRIES) {
        const sides2 = sides.map((s) => sideOfDir(g.dir(SIDE_DIR[s])))
        const punches2 = mapSlots(item.spec.punches, g, n)
        const sheets2 = item.spec.options.map((o) => mapSlots(o.holes, g, n))
        const plan2 = foldPlan(n, steps(sides2))
        if (!isPlan(plan2)) throw new Error('turned copy illegal')
        // The lure reasons are invariant under the sheet's symmetries.
        expect(lureSignature(plan2, punches2, sheets2, item.key.index)).toEqual(lures)
        expect(canonicalJson(foldingStructure(n, sides2, punches2, lures))).toBe(canonicalJson(item.structural_params))
      }
      expect(folding.familyIdOf(item.structural_params)).toBe(item.family_id)
    }
  })

  it('has many family_ids in every stratum (stratum 1 included)', () => {
    const by = new Map<number, Set<string>>()
    for (let i = 0; i < 1_200; i++) {
      const s = (i % 6) + 1
      const it = folding.generate(`fam-${i}`, { stratum: s })
      by.set(s, (by.get(s) ?? new Set()).add(it.family_id))
    }
    for (const [, ids] of by) expect(ids.size).toBeGreaterThan(120)
  }, 120_000)

  it('pins a few family_ids (the bank twin computes the same)', () => {
    const vectors = [
      { grid: 4, folds: ['left'], punches: [[1, 3]], lures: ['extra_layer', 'missed_unfold', 'mirrored', 'moved_hole'] },
      { grid: 4, folds: ['bottom', 'right'], punches: [[1, 1], [2, 2]], lures: ['moved_hole', 'moved_hole+mirrored', 'wrong_line', 'wrong_line'] },
      { grid: 6, folds: ['bottom_left', 'bottom_right', 'left'], punches: [[1, 4], [2, 4]], lures: ['extra_hole+missed_unfold', 'mirrored', 'moved_hole', 'moved_hole+wrong_line'] },
    ]
    expect(vectors.map((v) => folding.familyIdOf(v))).toMatchInlineSnapshot(`
      [
        "f:folding:06c850b7e4ca",
        "f:folding:556fcec2be70",
        "f:folding:42b0a73bb25f",
      ]
    `)
  })

  describe('verify rejects tampered instances', () => {
    const item = folding.generate('tamper', { stratum: 4 })
    it('accepts the untouched item', () => {
      expect(folding.verify(item).ok).toBe(true)
    })
    it('a wrong key', () => {
      for (let d = 1; d < 5; d++) expect(folding.verify(tamper(item, (x) => (x.key = { index: (item.key.index + d) % 5 }))).reason).toMatch(/key_is_unfolded_sheet/)
    })
    it('swapped options (the key moves, the key index does not)', () => {
      const j = (item.key.index + 1) % 5
      const bad = tamper(item, (x) => {
        const o = [...item.spec.options]
        ;[o[item.key.index], o[j]] = [o[j], o[item.key.index]] as [typeof o[0], typeof o[0]]
        x.spec = { ...item.spec, options: o }
      })
      expect(folding.verify(bad).ok).toBe(false)
    })
    it('a duplicated option', () => {
      const j = (item.key.index + 1) % 5
      const bad = tamper(item, (x) => {
        const o = [...item.spec.options]
        o[j] = o[item.key.index] as (typeof o)[0]
        x.spec = { ...item.spec, options: o }
      })
      expect(folding.verify(bad).reason).toMatch(/unique_unfolded_option|options_distinct/)
    })
    it('a changed fold (the folds no longer give the keyed sheet)', () => {
      const flip: Record<string, string> = { left: 'right', right: 'left', top: 'bottom', bottom: 'top', top_left: 'bottom_right', bottom_right: 'top_left', top_right: 'bottom_left', bottom_left: 'top_right' }
      const folds = item.spec.folds.map((f, i) => (i === 0 ? { ...f, moving: flip[f.moving] } : f))
      expect(folding.verify(tamper(item, (x) => (x.spec = { ...item.spec, folds }))).ok).toBe(false)
    })
    it('an illegal fold (a side that is not a side of its line)', () => {
      const bad = tamper(item, (x) => (x.spec = { ...item.spec, folds: [{ line: 'h', moving: 'left' }, ...item.spec.folds.slice(1)] }))
      expect(folding.verify(bad).reason).toMatch(/illegal folds/)
    })
    it('a punch off the folded paper', () => {
      const plan = foldPlan(item.spec.grid, item.spec.folds)
      if (!isPlan(plan)) throw new Error('no plan')
      const folded = plan.shapes[item.spec.folds.length] as Shape
      let outside = { row: 1, col: 1 }
      for (let row = 1; row <= 4; row++) for (let col = 1; col <= 4; col++) if (!strictlyInside(slotPt({ row, col }), folded)) outside = { row, col }
      const v = folding.verify(tamper(item, (x) => (x.spec = { ...item.spec, punches: [outside] })))
      expect(v.ok).toBe(false)
      expect(v.checks.punches_inside_folded_paper).toBe(false)
    })
    it('a broken structure, features, prior, stratum or time', () => {
      expect(folding.verify(tamper(item, (x) => (x.structural_params = { grid: 4, folds: ['left'], punches: [[1, 1]], lures: [] }))).reason).toMatch(/structure_matches/)
      expect(folding.verify(tamper(item, (x) => (x.difficulty = { ...item.difficulty, features: { ...item.difficulty.features, holes: 99 } }))).reason).toMatch(/features_match/)
      expect(folding.verify(tamper(item, (x) => (x.difficulty = { ...item.difficulty, b_prior: item.difficulty.b_prior + 0.25 }))).reason).toMatch(/prior_matches/)
      expect(folding.verify(tamper(item, (x) => (x.stratum = item.stratum === 1 ? 2 : 1))).reason).toMatch(/stratum_matches/)
      expect(folding.verify(tamper(item, (x) => (x.expected_time_s = 99))).reason).toMatch(/time_matches/)
    })
    it('a distractor with no recorded reason', () => {
      const j = (item.key.index + 1) % 5
      const n = item.spec.grid
      const all: { row: number; col: number }[] = []
      for (let row = 1; row <= n; row++) for (let col = 1; col <= n; col++) all.push({ row, col })
      const bad = tamper(item, (x) => {
        const o = [...item.spec.options]
        o[j] = { holes: all.slice(0, n * n - 1) }
        x.spec = { ...item.spec, options: o }
      })
      expect(folding.verify(bad).reason).toMatch(/every_distractor_has_reason/)
    })
    it('malformed specs and keys, without throwing', () => {
      for (const spec of [null, {}, { ...item.spec, grid: 5 }, { ...item.spec, options: item.spec.options.slice(0, 4) }, { ...item.spec, extra: 1 }]) {
        const v = folding.verify(tamper(item, (x) => (x.spec = spec)))
        expect(v.ok).toBe(false)
      }
      expect(folding.verify(tamper(item, (x) => (x.key = { index: 7 }))).ok).toBe(false)
      expect(folding.verify(tamper(item, (x) => (x.key = null))).ok).toBe(false)
    })
    it('records the reasons and cues', () => {
      const v = folding.verify(item)
      const reasons = v.checks.reasons as string[]
      expect(reasons[item.key.index]).toBe('key')
      expect(reasons.filter((r) => r === 'key')).toHaveLength(1)
      expect(Object.keys(v.checks.cues as object).sort()).toEqual(['asymmetric', 'fewest_holes', 'medoid', 'most_holes', 'most_symmetric', 'odd_count', 'symmetric'])
    })
  })

  it('scores the chosen option index and throws on malformed responses', () => {
    const item = folding.generate('score')
    expect(folding.score(item, item.key.index)).toEqual({ correct: 1 })
    for (let d = 1; d < 5; d++) expect(folding.score(item, (item.key.index + d) % 5)).toEqual({ correct: 0 })
    for (const r of [-1, 5, 1.5, '2', null, undefined, {}, [1], Number.NaN, true]) {
      expect(() => folding.score(item, r as number)).toThrow(MalformedResponseError)
    }
  })

  it('leaks nothing beyond the four spec fields', () => {
    const item = folding.generate('leak')
    expect(foldingSpecLeaksKey(item)).toBeNull()
    expect(foldingSpecLeaksKey(tamper(item, (x) => (x.spec = { ...item.spec, hint: 1 })))).toMatch(/unexpected spec fields/)
    const opts = item.spec.options.map((o, i) => (i === 0 ? { ...o, mark: true } : o))
    expect(foldingSpecLeaksKey(tamper(item, (x) => (x.spec = { ...item.spec, options: opts })))).toMatch(/options\[0\]/)
  })
})
