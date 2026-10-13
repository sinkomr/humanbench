/**
 * The tables of the session's parts (ROADMAP A15, M3.11; DESIGN §3, §7.4): the six parts are
 * what they were, the text parts add their own shares on top, and the plan of a session without text
 * parts is the M1 plan to the last number.
 */

import fc from 'fast-check'
import { describe, expect, it } from 'vitest'
import { AXIS_CODES, axis, type AxisCode } from './axes'
import { A15_MINIMUMS, A15_PLANNED_S, A15_SEGMENTS, A15_TARGET_S, A15_TYPICAL_OVER_S, A15_TYPICAL_S, MIN_ITEMS_SLACK, PART_MINIMUMS, PART_MIN_ITEMS, PUBLISH_MIN_ITEMS, QUANT_EXTRA_S, RC_PASSAGES, SEGMENT_ORDER, TEXT_AXES, TEXT_PARTS, aboutMinutes, isTextAxis, sessionOutline, textPartById, textPartOf } from './plan-table'
import { COVERAGE_FLOOR, planSession, type PlannedStep } from './selector'

/** The five text skills of phase 1 (text multiple choice); Reading Comprehension is the sixth (phase 2). */
const PHASE1: readonly AxisCode[] = ['LR', 'VOC', 'KST', 'KHU', 'KAP']

describe('the text parts table', () => {
  it('has one part for each of the six text skills, each a tier-a multiple-choice skill of the construct map', () => {
    expect(TEXT_PARTS.map((p) => p.axis).sort()).toEqual([...TEXT_AXES].sort())
    expect(new Set(TEXT_PARTS.map((p) => p.id)).size).toBe(TEXT_PARTS.length)
    for (const p of TEXT_PARTS) {
      expect(axis(p.axis)).toMatchObject({ tier: 'a', status: 'active' })
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
    expect(Object.fromEntries(TEXT_PARTS.map((p) => [p.axis, p.share_s]))).toEqual({ LR: 360, KST: 130, VOC: 120, RC: 540, KHU: 130, KAP: 130 })
    // what a part typically takes is its share and the step after each answer: never less than the share, never far over
    for (const p of TEXT_PARTS) {
      expect(p.typical_s, p.id).toBeGreaterThanOrEqual(p.share_s)
      expect(p.typical_s - p.share_s, p.id).toBeLessThanOrEqual(40)
    }
    expect(Object.fromEntries(TEXT_PARTS.map((p) => [p.axis, p.typical_s]))).toEqual({ LR: 389, KST: 149, VOC: 139, RC: 549, KHU: 149, KAP: 149 })
    // only Reading Comprehension is counted in passages: two
    expect(TEXT_PARTS.filter((p) => p.sets !== undefined).map((p) => [p.axis, p.sets])).toEqual([['RC', RC_PASSAGES]])
    expect(RC_PASSAGES).toBe(2)
  })

  it('plans 28.5 minutes without text parts, 43 with the five of phase 1 and 52 with Reading Comprehension (Quant’s six questions add a minute, 2026-10-12; Logical Reasoning’s six a minute, 2026-10-13)', () => {
    expect(A15_PLANNED_S).toBe(A15_TARGET_S + QUANT_EXTRA_S)
    expect(A15_PLANNED_S).toBe(28.5 * 60)
    expect(sessionOutline()).toEqual({ parts: 6, planned_s: A15_PLANNED_S, typical_s: A15_TYPICAL_S, upTo: false })
    expect(sessionOutline([])).toEqual(sessionOutline())
    expect(sessionOutline(PHASE1)).toMatchObject({ parts: 11, planned_s: 43 * 60, upTo: true })
    expect(sessionOutline(TEXT_AXES)).toMatchObject({ parts: 12, planned_s: 52 * 60, upTo: true })
    expect(sessionOutline(['VOC'])).toMatchObject({ parts: 7, planned_s: A15_PLANNED_S + 120, upTo: true })
    expect(sessionOutline(['MAT', 'LG'])).toEqual(sessionOutline()) // not text parts
  })

  it('says a session’s length from what it typically takes, not from the plan’s sum: "about 30" for six parts, "about 45" for eleven, "about 55" for twelve', () => {
    // the six parts typically run about a minute over their plan (the step after each answer; re-measured 2026-10-13
    // with the simulator calibrated to a real session, the reactive memory blocks and the minimums of six: it was 1880)
    expect(A15_TYPICAL_S).toBe(1769)
    expect(A15_TYPICAL_OVER_S).toBe(A15_TYPICAL_S - A15_PLANNED_S)
    expect(A15_TYPICAL_OVER_S).toBeGreaterThan(0)
    const typical = (axes: readonly AxisCode[]): number => sessionOutline(axes).typical_s
    expect(typical(TEXT_AXES)).toBe(A15_TYPICAL_S + TEXT_PARTS.reduce((t, p) => t + p.typical_s, 0))
    expect(aboutMinutes(typical([]))).toBe(30)
    expect(aboutMinutes(typical(PHASE1))).toBe(45)
    expect(aboutMinutes(typical(TEXT_AXES))).toBe(55)
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
    expect(SEGMENT_ORDER).toEqual(['rt', 'matrix_series', 'logical_reasoning', 'knowledge_stem', 'spatial', 'vocabulary', 'reading_comprehension', 'memory', 'quant', 'knowledge_humanities', 'knowledge_arts', 'coding_reading'])
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
