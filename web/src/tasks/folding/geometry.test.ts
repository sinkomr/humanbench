/**
 * The exact fold geometry (`geometry.ts`): reflections are integer involutions on slot centres, a fold
 * plan's forward map (generator) and the step-by-step unfolding (verifier, re-derived here) give the
 * same holes, every punch goes through 2^folds layers, and the A11 structure is invariant under the
 * sheet's symmetries (fast-check properties over every fold sequence).
 */

import fc from 'fast-check'
import { describe, expect, it } from 'vitest'
import { canonicalJson } from '../ids'
import { foldSequences, steps, unfoldedByImage } from './gen'
import {
  LINE_SIDES,
  SHEET_SYMMETRIES,
  SIDE_DIR,
  doubleArea,
  foldPlan,
  foldedImage,
  foldingStructure,
  interiorSlots,
  isPlan,
  legalFolds,
  lineSegmentIn,
  mapSlots,
  ptSlot,
  reflect,
  sheetShape,
  sideOfDir,
  slotPt,
  slotsKey,
  sortSlots,
  strictlyInside,
  symmetryLine,
  type Line,
  type Shape,
} from './geometry'
import type { Side } from './spec'

const SEQS = [...foldSequences(4).map((s) => ({ n: 4, ...s })), ...foldSequences(6).map((s) => ({ n: 6, ...s }))]

describe('folding geometry', () => {
  it('folds the sheet along its four symmetry lines, each through its middle', () => {
    const sheet = sheetShape(4)
    expect(symmetryLine(sheet, 'v')).toEqual({ kind: 'v', c: 4 })
    expect(symmetryLine(sheet, 'h')).toEqual({ kind: 'h', c: 4 })
    expect(symmetryLine(sheet, 'd')).toEqual({ kind: 'd', c: 0 })
    expect(symmetryLine(sheet, 'a')).toEqual({ kind: 'a', c: 8 })
    expect(legalFolds(sheet)).toHaveLength(8)
    expect(lineSegmentIn(sheet, { kind: 'd', c: 0 })).toEqual([
      [0, 0],
      [8, 8],
    ])
  })

  it('names sides consistently: each side lies on its sign of the line', () => {
    for (const [kind, [neg, pos]] of Object.entries(LINE_SIDES)) {
      const line: Line = { kind: kind as Line['kind'], c: 0 }
      const at = (s: Side) => {
        const d = SIDE_DIR[s]
        return line.kind === 'v' ? d[0] : line.kind === 'h' ? d[1] : line.kind === 'd' ? d[0] - d[1] : d[0] + d[1]
      }
      expect(at(neg)).toBeLessThan(0)
      expect(at(pos)).toBeGreaterThan(0)
    }
  })

  it('reflections are integer involutions that keep slot centres on slot centres (even c)', () => {
    fc.assert(
      fc.property(fc.constantFrom('v', 'h', 'd', 'a' as const), fc.integer({ min: -6, max: 12 }), fc.integer({ min: 0, max: 5 }), fc.integer({ min: 0, max: 5 }), (kind, half, r, c) => {
        const line: Line = { kind, c: 2 * half }
        const p = slotPt({ row: r + 1, col: c + 1 })
        const q = reflect(p, line)
        expect(reflect(q, line)).toEqual(p)
        expect(Math.abs(q[0] % 2)).toBe(1)
        expect(Math.abs(q[1] % 2)).toBe(1)
      }),
    )
  })

  it('every fold halves the shape exactly (area), and the halves are mirror images', () => {
    for (const { n, sides } of SEQS) {
      const plan = foldPlan(n, steps(sides))
      if (!isPlan(plan)) throw new Error('illegal')
      plan.shapes.slice(1).forEach((s, k) => expect(Math.abs(doubleArea(s)) * 2).toBe(Math.abs(doubleArea(plan.shapes[k] as Shape))))
    }
    expect(SEQS.filter((s) => s.n === 4)).toHaveLength(foldSequences(4).length)
  })

  it('forward map = step-by-step unfolding, and every punch goes through 2^folds layers', () => {
    fc.assert(
      fc.property(fc.integer({ min: 0, max: SEQS.length - 1 }), fc.integer({ min: 0, max: 1_000 }), fc.integer({ min: 1, max: 3 }), (si, shift, p) => {
        const { n, sides } = SEQS[si] as (typeof SEQS)[number]
        const plan = foldPlan(n, steps(sides))
        if (!isPlan(plan)) throw new Error('illegal')
        const inner = interiorSlots(plan.shapes[sides.length] as Shape, n)
        if (inner.length === 0) return
        const punches = sortSlots(Array.from({ length: Math.min(p, inner.length) }, (_, i) => inner[(shift + i) % inner.length] as (typeof inner)[number]))
        const forward = unfoldedByImage(plan, punches)
        // The verifier's route, re-derived: reflect the hole set back across each line, last fold first.
        let holes = punches.map(slotPt)
        for (let k = plan.lines.length - 1; k >= 0; k--) holes = [...holes, ...holes.map((q) => reflect(q, plan.lines[k] as Line))]
        expect(slotsKey(forward)).toBe(slotsKey(holes.map(ptSlot)))
        expect(forward).toHaveLength(2 ** sides.length * punches.length)
        // Every slot of the sheet folds onto the folded paper.
        for (let row = 1; row <= n; row++)
          for (let col = 1; col <= n; col++) {
            const q = foldedImage(slotPt({ row, col }), plan)
            const final = plan.shapes[sides.length] as Shape
            expect(strictlyInside(q, final) || !inner.some((s) => slotsKey([s]) === slotsKey([ptSlot(q)]))).toBe(true)
          }
      }),
      { numRuns: 300 },
    )
  })

  it('the A11 structure is the same for every turned or mirrored copy of an item', () => {
    fc.assert(
      fc.property(fc.integer({ min: 0, max: SEQS.length - 1 }), fc.integer({ min: 0, max: 7 }), fc.integer({ min: 0, max: 100 }), (si, gi, shift) => {
        const { n, sides } = SEQS[si] as (typeof SEQS)[number]
        const plan = foldPlan(n, steps(sides))
        if (!isPlan(plan)) throw new Error('illegal')
        const inner = interiorSlots(plan.shapes[sides.length] as Shape, n)
        if (inner.length === 0) return
        const punches = [inner[shift % inner.length] as (typeof inner)[number]]
        const g = SHEET_SYMMETRIES[gi] as (typeof SHEET_SYMMETRIES)[number]
        const sides2 = sides.map((s) => sideOfDir(g.dir(SIDE_DIR[s])))
        const punches2 = mapSlots(punches, g, n)
        // The turned copy is a legal item too, with the turned answer.
        const plan2 = foldPlan(n, steps(sides2))
        if (!isPlan(plan2)) throw new Error('turned copy illegal')
        expect(slotsKey(unfoldedByImage(plan2, punches2))).toBe(slotsKey(mapSlots(unfoldedByImage(plan, punches), g, n)))
        expect(canonicalJson(foldingStructure(n, sides2, punches2, ['mirrored']))).toBe(canonicalJson(foldingStructure(n, sides, punches, ['mirrored'])))
      }),
      { numRuns: 300 },
    )
  })
})
