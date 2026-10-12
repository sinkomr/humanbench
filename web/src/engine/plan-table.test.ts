/**
 * The tables of the session's parts (ROADMAP A15, M3.11 phase 1; DESIGN §3, §7.4): the six parts are
 * what they were, the text parts add their own shares on top, and the plan of a session without text
 * parts is the M1 plan to the last number.
 */

import fc from 'fast-check'
import { describe, expect, it } from 'vitest'
import { AXIS_CODES, axis, type AxisCode } from './axes'
import { A15_SEGMENTS, A15_TARGET_S, PUBLISH_MIN_ITEMS, SEGMENT_ORDER, TEXT_AXES, TEXT_PARTS, aboutMinutes, isTextAxis, sessionOutline, textPartById, textPartOf } from './plan-table'
import { COVERAGE_FLOOR, planSession, type PlannedStep } from './selector'

describe('the text parts table', () => {
  it('has one part for each of the five text skills, each a tier-a multiple-choice skill of the construct map', () => {
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

  it('gives each a modest share and the minimum the server publishes a skill from (five, above the floor of three)', () => {
    expect(PUBLISH_MIN_ITEMS).toBe(5)
    expect(PUBLISH_MIN_ITEMS).toBeGreaterThanOrEqual(COVERAGE_FLOOR)
    for (const p of TEXT_PARTS) {
      expect(p.min_items).toBe(PUBLISH_MIN_ITEMS)
      expect(p.share_s).toBeGreaterThanOrEqual(120)
      expect(p.share_s).toBeLessThanOrEqual(300)
    }
    expect(Object.fromEntries(TEXT_PARTS.map((p) => [p.axis, p.share_s]))).toEqual({ LR: 300, KST: 130, VOC: 120, KHU: 130, KAP: 130 })
  })

  it('plans 27.5 minutes without text parts and 41 with all five, said as "about 30" and "about 40"', () => {
    expect(sessionOutline()).toEqual({ parts: 6, planned_s: A15_TARGET_S, upTo: false })
    expect(sessionOutline([])).toEqual(sessionOutline())
    expect(sessionOutline(TEXT_AXES)).toEqual({ parts: 11, planned_s: 41 * 60, upTo: true })
    expect(sessionOutline(['VOC'])).toEqual({ parts: 7, planned_s: A15_TARGET_S + 120, upTo: true })
    expect(sessionOutline(['MAT', 'RC'])).toEqual(sessionOutline()) // not text parts
    expect(aboutMinutes(A15_TARGET_S)).toBe(30)
    expect(aboutMinutes(41 * 60)).toBe(40)
    expect(aboutMinutes(20 * 60)).toBe(20)
    expect(aboutMinutes(90)).toBe(2)
  })

  it('orders the parts as §7.4 does: Reasoning, Knowledge, Spatial, Verbal, Memory, Quantitative, Knowledge, Speed', () => {
    expect(SEGMENT_ORDER).toEqual(['rt', 'matrix_series', 'logical_reasoning', 'knowledge_stem', 'spatial', 'vocabulary', 'memory', 'quant', 'knowledge_humanities', 'knowledge_arts', 'coding_reading'])
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
    for (const p of TEXT_PARTS) expect(cat(plan).find((s) => s.segment === p.id)).toEqual({ kind: 'cat', segment: p.id, axes: [p.axis], budget_s: p.share_s, optional: { min_items: p.min_items } })
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
