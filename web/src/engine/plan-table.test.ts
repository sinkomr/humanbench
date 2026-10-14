/**
 * The tables of the session's parts (ROADMAP A15, M3.11; DESIGN §3, §7.4): the six parts are
 * what they were, the text parts add their own shares on top, and the plan of a session without text
 * parts is the M1 plan to the last number.
 */

import fc from 'fast-check'
import { describe, expect, it } from 'vitest'
import { AXIS_CODES, axis, type AxisCode } from './axes'
import { A15_MINIMUMS, A15_PLANNED_S, A15_SEGMENTS, A15_TARGET_S, A15_TYPICAL_OVER_S, A15_TYPICAL_S, LG_GAMES, MIN_ITEMS_SLACK, PART_MINIMUMS, PART_MIN_ITEMS, PUBLISH_MIN_ITEMS, QUANT_EXTRA_S, RC_PASSAGES, ROTATION, SEGMENT_ORDER, TEXT_AXES, TEXT_PARTS, aboutMinutes, isTextAxis, liveServedAxes, longestOutline, servedPartAxes, sessionOutline, textPartById, textPartOf } from './plan-table'
import { COVERAGE_FLOOR, planSession, type PlannedStep } from './selector'

/** The five text skills of phase 1 (text multiple choice); Reading Comprehension is the sixth (phase 2). */
const PHASE1: readonly AxisCode[] = ['LR', 'VOC', 'KST', 'KHU', 'KAP']

describe('the text parts table', () => {
  it('has one part for each served skill: the six text skills (tier a), logic games (tier a), Fermi (tier b), emotion reading and creative thinking (tier c)', () => {
    expect(TEXT_PARTS.map((p) => p.axis).sort()).toEqual([...TEXT_AXES].sort())
    expect(new Set(TEXT_PARTS.map((p) => p.id)).size).toBe(TEXT_PARTS.length)
    expect(Object.fromEntries(TEXT_PARTS.map((p) => [p.axis, axis(p.axis).tier]))).toEqual({ LR: 'a', KST: 'a', VOC: 'a', RC: 'a', EMO: 'c', CRE: 'c', KHU: 'a', KAP: 'a', LG: 'a', FER: 'b' })
    for (const p of TEXT_PARTS) {
      expect(axis(p.axis).embedded).toBe(false)
      expect(A15_SEGMENTS.some((s) => s.id === p.after), p.id).toBe(true)
      expect(textPartOf(p.axis)).toBe(p)
      expect(textPartById(p.id)).toBe(p)
    }
    expect(textPartOf('MAT')).toBeUndefined()
    expect(textPartById('quant')).toBeUndefined()
    expect(TEXT_AXES.every(isTextAxis)).toBe(true)
    expect(AXIS_CODES.filter(isTextAxis)).toEqual([...TEXT_AXES]) // canonical order
  })

  it('one table of minimums: six answered questions for every question part, Reading Comprehension counted in two passages (owner decision 2026-10-13)', () => {
    expect(PUBLISH_MIN_ITEMS).toBe(5)
    expect(PART_MIN_ITEMS).toBe(6)
    expect(PART_MIN_ITEMS).toBeGreaterThan(PUBLISH_MIN_ITEMS) // the five the server publishes a skill from, with one to spare
    expect(PUBLISH_MIN_ITEMS).toBeGreaterThanOrEqual(COVERAGE_FLOOR)
    expect(MIN_ITEMS_SLACK).toBe(2)
    expect(PART_MINIMUMS).toEqual({
      matrix_series: { min_items: 6 },
      spatial: { min_items: 6 },
      quant: { min_items: 6 },
      logical_reasoning: { min_items: 6 },
      knowledge_stem: { min_items: 6 },
      vocabulary: { min_items: 6 },
      reading_comprehension: { min_items: 5, sets: 2 },
      knowledge_humanities: { min_items: 6 },
      knowledge_arts: { min_items: 6 },
      logic_games: { min_items: 5, sets: 2 },
      fermi: { min_items: 6 },
      emotion: { min_items: 6 },
      word_links: { min_items: 6 },
    })
    // every part that asks questions is in it: the CAT parts of A15 and every text part, and nothing else
    const question = [...A15_SEGMENTS.filter((s) => s.kind === 'cat').map((s) => s.id), ...TEXT_PARTS.map((p) => p.id)]
    expect(Object.keys(PART_MINIMUMS).sort()).toEqual([...question].sort())
    // the plan and the text parts read their minimums from it
    for (const p of TEXT_PARTS) expect({ min_items: p.min_items, ...(p.sets === undefined ? {} : { sets: p.sets }) }, p.id).toEqual(PART_MINIMUMS[p.id])
    expect(A15_MINIMUMS).toEqual({ matrix_series: { min_items: 6, extra_s: 0 }, spatial: { min_items: 6, extra_s: 0 }, quant: { min_items: 6, extra_s: QUANT_EXTRA_S } })
  })

  it('gives each text part a modest share', () => {
    for (const p of TEXT_PARTS) {
      expect(p.share_s).toBeGreaterThanOrEqual(120)
      expect(p.share_s).toBeLessThanOrEqual(p.sets === undefined ? 360 : 540)
    }
    expect(Object.fromEntries(TEXT_PARTS.map((p) => [p.axis, p.share_s]))).toEqual({ LR: 360, KST: 130, VOC: 120, RC: 540, EMO: 240, CRE: 130, KHU: 130, KAP: 130, LG: 450, FER: 360 })
    // what a part typically takes is its share and a moment around each answer: never less than the share, never far over
    for (const p of TEXT_PARTS) {
      // (a part of passages ends after its passages, which may be inside its share: Reading Comprehension, 526 of 540)
      if (p.sets === undefined) expect(p.typical_s, p.id).toBeGreaterThanOrEqual(p.share_s)
      else expect(p.typical_s, p.id).toBeGreaterThanOrEqual(p.share_s - 30)
      expect(p.typical_s - p.share_s, p.id).toBeLessThanOrEqual(40)
    }
    expect(Object.fromEntries(TEXT_PARTS.map((p) => [p.axis, p.typical_s]))).toEqual({ LR: 369, KST: 151, VOC: 132, RC: 526, EMO: 243, CRE: 151, KHU: 151, KAP: 151, LG: 446, FER: 363 })
    // Reading Comprehension is counted in passages and Logic Games in games: two each
    expect(TEXT_PARTS.filter((p) => p.sets !== undefined).map((p) => [p.axis, p.sets])).toEqual([['RC', RC_PASSAGES], ['LG', LG_GAMES]])
    expect(RC_PASSAGES).toBe(2)
    expect(LG_GAMES).toBe(2)
  })

  it('plans 28.5 minutes without text parts, 43 with the five of phase 1 and 52 with Reading Comprehension (Quant’s six questions add a minute, 2026-10-12; Logical Reasoning’s six a minute, 2026-10-13)', () => {
    expect(A15_PLANNED_S).toBe(A15_TARGET_S + QUANT_EXTRA_S)
    expect(A15_PLANNED_S).toBe(28.5 * 60)
    expect(sessionOutline()).toEqual({ parts: 6, planned_s: A15_PLANNED_S, typical_s: A15_TYPICAL_S, upTo: false })
    expect(sessionOutline([])).toEqual(sessionOutline())
    expect(sessionOutline(PHASE1)).toMatchObject({ parts: 11, planned_s: 43 * 60, upTo: true })
    expect(sessionOutline(['LR', 'RC', 'VOC', 'KST', 'KHU', 'KAP'])).toMatchObject({ parts: 12, planned_s: 52 * 60, upTo: true })
    // every served part at once: 16 parts and 71 minutes 40 seconds of plan, which is why they take turns (ROTATION)
    expect(sessionOutline(TEXT_AXES)).toMatchObject({ parts: 16, planned_s: 4300, upTo: true })
    expect(sessionOutline(['VOC'])).toMatchObject({ parts: 7, planned_s: A15_PLANNED_S + 120, upTo: true })
    expect(sessionOutline(['MAT', 'QR'])).toEqual(sessionOutline()) // not served parts
  })

  it('says a session’s length from what it typically takes, not from the plan’s sum: "about 30" for six parts, "about 45" for eleven, "about 55" for twelve', () => {
    // the six parts typically run about a minute over their plan (re-measured 2026-10-13 with the simulator calibrated to
    // a real session, the reactive memory blocks and the minimums of six: it was 1880; then without the follow-up
    // confidence step, owner decision 2026-10-13: it was 1769)
    expect(A15_TYPICAL_S).toBe(1760)
    expect(A15_TYPICAL_OVER_S).toBe(A15_TYPICAL_S - A15_PLANNED_S)
    expect(A15_TYPICAL_OVER_S).toBeGreaterThan(0)
    const typical = (axes: readonly AxisCode[]): number => sessionOutline(axes).typical_s
    expect(typical(TEXT_AXES)).toBe(A15_TYPICAL_S + TEXT_PARTS.reduce((t, p) => t + p.typical_s, 0))
    expect(aboutMinutes(typical([]))).toBe(30)
    expect(aboutMinutes(typical(PHASE1))).toBe(45)
    expect(aboutMinutes(typical(['LR', 'RC', 'VOC', 'KST', 'KHU', 'KAP']))).toBe(55)
    expect(aboutMinutes(typical(TEXT_AXES))).toBe(75)
    expect(aboutMinutes(typical(['RC']))).toBe(40)
    expect(aboutMinutes(typical(['VOC']))).toBe(30)
    expect(aboutMinutes(typical(['LR']))).toBe(35)
    // the figure is additive over the parts, for every combination of them
    fc.assert(
      fc.property(fc.subarray([...TEXT_AXES]), (axes) => {
        expect(typical(axes)).toBe(A15_TYPICAL_S + TEXT_PARTS.filter((p) => axes.includes(p.axis)).reduce((t, p) => t + p.typical_s, 0))
        expect(typical(axes)).toBeGreaterThanOrEqual(sessionOutline(axes).planned_s)
      }),
    )
    expect(aboutMinutes(A15_PLANNED_S)).toBe(30)
    expect(aboutMinutes(42 * 60)).toBe(40)
    expect(aboutMinutes(20 * 60)).toBe(20)
    expect(aboutMinutes(90)).toBe(2)
  })

  it('orders the parts as §7.4 does: Reasoning, Knowledge, Spatial, Verbal, Memory, Quantitative, Knowledge, Speed', () => {
    // the remaining families (2026-10-13): emotion reading and word links after Working Memory (a verbal part between a
    // memory and a number part), logic games and Fermi at the end, as §7.4 ends: "… Knowledge → Logic → Fermi"
    expect(SEGMENT_ORDER).toEqual(['rt', 'matrix_series', 'logical_reasoning', 'knowledge_stem', 'spatial', 'vocabulary', 'reading_comprehension', 'memory', 'emotion', 'word_links', 'quant', 'knowledge_humanities', 'knowledge_arts', 'coding_reading', 'logic_games', 'fermi'])
  })
})

describe('planSession with text parts', () => {
  const cat = (plan: readonly PlannedStep[]) => plan.filter((s): s is Extract<PlannedStep, { kind: 'cat' }> => s.kind === 'cat')

  it('without them is the M1 plan, and an empty list is the same as none', () => {
    const plain = planSession({ sessionSeed: 's1' })
    expect(planSession({ sessionSeed: 's1', textAxes: [] })).toEqual(plain)
    expect(cat(plain).map((s) => s.segment)).toEqual(['matrix_series', 'spatial', 'quant'])
    expect(cat(plain).every((s) => s.optional === undefined)).toBe(true)
  })

  it('adds a step per text skill with its share and its minimum, in the table’s place', () => {
    const plan = planSession({ sessionSeed: 's1', textAxes: TEXT_AXES })
    expect([...new Set(plan.map((s) => s.segment))]).toEqual([...SEGMENT_ORDER])
    for (const p of TEXT_PARTS) expect(cat(plan).find((s) => s.segment === p.id)).toEqual({ kind: 'cat', segment: p.id, axes: [p.axis], budget_s: p.share_s, optional: { min_items: p.min_items, ...(p.sets === undefined ? {} : { sets: p.sets }) } })
  })

  it('never changes a step of the six parts: their blocks, their order and their budgets are those of the plan without text parts', () => {
    const weight = fc.constantFrom(0, 1)
    fc.assert(
      fc.property(fc.string({ minLength: 1, maxLength: 12 }).filter((s) => /^[A-Za-z0-9_]+$/u.test(s)), fc.subarray([...TEXT_AXES]), fc.dictionary(fc.constantFrom<AxisCode>('RT', 'MAT', 'SPA', 'WM', 'QR', 'PS', 'LR', 'KST'), weight), fc.integer({ min: 600, max: 3000 }), (seed, textAxes, weights, targetS) => {
        const plain = planSession({ sessionSeed: seed, weights, targetS })
        const withText = planSession({ sessionSeed: seed, weights, targetS, textAxes })
        expect(withText.filter((s) => !(s.kind === 'cat' && s.optional !== undefined))).toEqual(plain)
        const expected = TEXT_PARTS.filter((p) => textAxes.includes(p.axis) && (weights[p.axis] ?? 1) > 0).map((p) => p.id)
        expect(cat(withText).filter((s) => s.optional !== undefined).map((s) => s.segment)).toEqual(expected)
      }),
      { numRuns: 40 },
    )
  })
})

describe('the rotation of the served parts (ROADMAP M3.11, "Session length with the remaining families")', () => {
  const typical = (axes: readonly AxisCode[]): number => sessionOutline(axes).typical_s

  it('is three groups of the ten served parts, each part in exactly one, each group about 45 minutes with the six parts', () => {
    expect(ROTATION.map((g) => [...g])).toEqual([['LR', 'RC'], ['LG', 'VOC', 'KST', 'KHU'], ['FER', 'EMO', 'CRE', 'KAP']])
    expect(ROTATION.flat().sort()).toEqual([...TEXT_AXES].sort())
    for (const g of ROTATION) {
      expect(aboutMinutes(typical(g))).toBe(45)
      expect(typical(g)).toBeLessThan(47 * 60)
    }
  })

  it('takes the groups in turn by the session number, passes over a group with nothing live, and asks for nothing the server does not have', () => {
    expect(servedPartAxes(null, 0)).toEqual([])
    expect(servedPartAxes([...TEXT_AXES], 0)).toEqual(['LR', 'RC'])
    expect(servedPartAxes([...TEXT_AXES], 1)).toEqual(['LG', 'VOC', 'KST', 'KHU'])
    expect(servedPartAxes([...TEXT_AXES], 2)).toEqual(['FER', 'KAP', 'EMO', 'CRE']) // canonical order
    expect(servedPartAxes([...TEXT_AXES], 3)).toEqual(['LR', 'RC'])
    // only the five of phase 1 live: their groups take turns, and the empty third is passed over
    const five: AxisCode[] = ['LR', 'VOC', 'KST', 'KHU', 'KAP', 'MAT', 'QR']
    expect([0, 1, 2, 3].map((n) => servedPartAxes(five, n))).toEqual([['LR'], ['VOC', 'KST', 'KHU'], ['KAP'], ['LR']])
    // a single live skill is asked for in every session
    for (let n = 0; n < 5; n++) expect(servedPartAxes(['FER'], n)).toEqual(['FER'])
    // no rotation: every live served part in one session
    expect(servedPartAxes([...TEXT_AXES], 4, [])).toEqual([...TEXT_AXES])
    expect(liveServedAxes(['MAT', 'CRE', 'LR'])).toEqual(['LR', 'CRE'])
    fc.assert(
      fc.property(fc.subarray([...AXIS_CODES]), fc.nat(50), (live, n) => {
        const got = servedPartAxes(live, n)
        for (const k of got) expect(live).toContain(k)
        expect(got).toEqual(TEXT_AXES.filter((k) => got.includes(k)))
        if (liveServedAxes(live).length > 0) expect(got.length).toBeGreaterThan(0)
        // over as many sessions as there are groups, every live served part comes once
        const all = new Set(Array.from({ length: ROTATION.length }, (_, i) => servedPartAxes(live, n + i)).flat())
        expect([...all].sort()).toEqual(liveServedAxes(live).sort())
      }),
    )
  })

  it('says the longest of the sessions it gives, before it knows which comes', () => {
    expect(longestOutline([...TEXT_AXES])).toEqual([0, 1, 2].map((n) => sessionOutline(servedPartAxes([...TEXT_AXES], n))).sort((a, b) => b.typical_s - a.typical_s)[0])
    expect(longestOutline([])).toEqual(sessionOutline())
    expect(aboutMinutes(longestOutline([...TEXT_AXES]).typical_s)).toBe(45)
  })
})
