import { describe, expect, it } from 'vitest'
import { createRng } from '../../engine'
import {
  CANONICAL_MASKS,
  DOMAIN_SIZE,
  SCALAR_ATTRS,
  SCALAR_RULES,
  allRuleSets,
  cellEquals,
  maskOf,
  popcount,
  type Cell,
  type RuleSet,
} from './grammar'
import { fairOptions, sampleCounts, samplePositions, sampleGrid, sampleScalar } from './gen'
import { modalArgmax, modalHitProbability, modalPicksKeyUniquely, modalScores } from './heuristic'
import { COUNT_SOLVER_RULES, POSITION_SOLVER_RULES, SCALAR_SOLVER_RULES, linesOf, solve, violatedRules, type SolverRule } from './solver'
import { formsOneChangeTree } from './verify'
import { EXAMPLE1_CHAIN, EXAMPLE1_GRID, EXAMPLE1_RULES, EXAMPLE1_STAR, EXAMPLE1_VISIBLE, cell, withCell } from './fixtures'

/** The 8 visible values of rows `r1`, `r2` and the pair `r3`. */
const vis = (r1: number[], r2: number[], r3: number[]): number[] => [...r1, ...r2, ...r3]

const rule = (rules: readonly SolverRule[], name: string): SolverRule => {
  const r = rules.find((x) => x.name === name)
  if (!r) throw new Error(`no rule ${name}`)
  return r
}

const predictRow = (r: SolverRule, v: number[]): number | null => r.predict(linesOf(v, 'row'))

describe('lines', () => {
  it('reads rows and, transposed, columns of the 8 visible values', () => {
    const v = [0, 1, 2, 3, 4, 5, 6, 7]
    expect(linesOf(v, 'row')).toEqual({ l1: [0, 1, 2], l2: [3, 4, 5], a: 6, b: 7 })
    expect(linesOf(v, 'col')).toEqual({ l1: [0, 3, 6], l2: [1, 4, 7], a: 2, b: 5 })
    expect(() => linesOf([1, 2, 3], 'row')).toThrow(RangeError)
  })
})

describe('solver rules', () => {
  const color = SCALAR_SOLVER_RULES.color
  const orient = SCALAR_SOLVER_RULES.orientation

  it('constant: every line constant', () => {
    const r = rule(color, 'constant')
    expect(predictRow(r, vis([1, 1, 1], [3, 3, 3], [0, 0]))).toBe(0)
    expect(predictRow(r, vis([1, 1, 2], [3, 3, 3], [0, 0]))).toBeNull()
    expect(predictRow(r, vis([1, 1, 1], [3, 3, 3], [0, 1]))).toBeNull()
  })

  it('progression ±1: same step in every line, prediction inside the domain', () => {
    const up = rule(color, 'progression+1')
    const down = rule(color, 'progression-1')
    expect(predictRow(up, vis([0, 1, 2], [1, 2, 3], [0, 1]))).toBe(2)
    expect(predictRow(up, vis([0, 1, 2], [1, 2, 3], [1, 2]))).toBe(3)
    expect(predictRow(up, vis([0, 1, 2], [1, 2, 3], [2, 3]))).toBeNull() // 4 is off the 4-grey scale
    expect(predictRow(up, vis([0, 1, 2], [3, 2, 1], [0, 1]))).toBeNull()
    expect(predictRow(down, vis([3, 2, 1], [2, 1, 0], [3, 2]))).toBe(1)
    expect(predictRow(down, vis([3, 2, 1], [2, 1, 0], [1, 0]))).toBeNull()
  })

  it('orientation progression is also tried cyclically (mod 180°)', () => {
    const cyc = rule(orient, 'cyclic+1')
    const lin = rule(orient, 'progression+1')
    const v = vis([2, 3, 0], [3, 0, 1], [1, 2])
    expect(predictRow(cyc, v)).toBe(3)
    expect(predictRow(lin, v)).toBeNull()
    expect(predictRow(rule(orient, 'cyclic-1'), vis([0, 3, 2], [1, 0, 3], [3, 2]))).toBe(1)
    expect(SCALAR_SOLVER_RULES.color.map((r) => r.name)).not.toContain('cyclic+1')
  })

  it('distribution: every line a permutation of the same 3 distinct values', () => {
    const r = rule(color, 'distribution')
    expect(predictRow(r, vis([0, 1, 3], [3, 0, 1], [1, 3]))).toBe(0)
    expect(predictRow(r, vis([0, 1, 3], [0, 1, 3], [0, 1]))).toBe(3)
    expect(predictRow(r, vis([0, 1, 1], [1, 0, 1], [1, 0]))).toBeNull() // not 3 distinct values
    expect(predictRow(r, vis([0, 1, 3], [0, 1, 2], [3, 0]))).toBeNull() // line 2 uses another set
    expect(predictRow(r, vis([0, 1, 3], [3, 0, 1], [1, 1]))).toBeNull()
    expect(predictRow(r, vis([0, 1, 3], [3, 0, 1], [1, 2]))).toBeNull()
  })

  it('count arithmetic ±: z = x ± y within 1–9', () => {
    const add = rule(COUNT_SOLVER_RULES, 'arithmetic+')
    const sub = rule(COUNT_SOLVER_RULES, 'arithmetic-')
    expect(predictRow(add, vis([1, 2, 3], [2, 2, 4], [1, 3]))).toBe(4)
    expect(predictRow(add, vis([1, 2, 3], [2, 2, 5], [1, 3]))).toBeNull()
    expect(predictRow(add, vis([1, 2, 3], [2, 2, 4], [5, 5]))).toBeNull() // 10 objects do not fit
    expect(predictRow(sub, vis([3, 1, 2], [4, 3, 1], [4, 2]))).toBe(2)
    expect(predictRow(sub, vis([3, 1, 2], [4, 3, 1], [2, 2]))).toBeNull() // 0 objects
  })

  it('position xor / or / and: slot-set operations, the prediction non-empty', () => {
    const m = (...s: number[]) => maskOf(s)
    const xor = rule(POSITION_SOLVER_RULES, 'xor')
    const or = rule(POSITION_SOLVER_RULES, 'or')
    const and = rule(POSITION_SOLVER_RULES, 'and')
    const v = vis([m(0, 1), m(1, 2), m(0, 2)], [m(3), m(3, 4), m(4)], [m(5, 6), m(6, 7)])
    expect(predictRow(xor, v)).toBe(m(5, 7))
    expect(predictRow(or, v)).toBeNull()
    const w = vis([m(0, 1), m(1, 2), m(0, 1, 2)], [m(3), m(4), m(3, 4)], [m(5), m(5, 6)])
    expect(predictRow(or, w)).toBe(m(5, 6))
    expect(predictRow(xor, w)).toBeNull()
    const u = vis([m(0, 1), m(1, 2), m(1)], [m(3, 4), m(4), m(4)], [m(5, 6), m(6, 7)])
    expect(predictRow(and, u)).toBe(m(6))
    expect(predictRow(and, vis([m(0, 1), m(1, 2), m(1)], [m(3, 4), m(4), m(4)], [m(5), m(6)]))).toBeNull()
    expect(predictRow(xor, vis([m(0, 1), m(1, 2), m(0, 2)], [m(3), m(3, 4), m(4)], [m(5), m(5)]))).toBeNull()
  })
})

describe('solve', () => {
  it('solves DESIGN §14.6 example 1 uniquely: "3 triangle large"', () => {
    const s = solve(EXAMPLE1_VISIBLE)
    expect(s.consistent).toBe(true)
    expect(s.unique).toBe(true)
    expect(s.noCountLure).toBe(true)
    expect(s.cell).toEqual(EXAMPLE1_GRID[8])
    expect(s.count.fits.map((f) => f.rule)).toContain('progression+1@row')
    expect(s.positions.fits.map((f) => f.rule)).toContain('canonical(progression+1@row)')
    expect(s.shape.fits.map((f) => f.rule)).toEqual(['constant@row', 'distribution@col'])
  })

  it('reports ambiguity when two consistent rules predict different cells', () => {
    const base = cell('triangle', 'medium', 'white', 0, [4])
    const colors = vis([0, 1, 2], [0, 1, 2], [1, 2]) // progression → 3, distribution → 0
    const s = solve(colors.map((c) => withCell(base, { color: c })))
    expect(s.consistent).toBe(true)
    expect(s.unique).toBe(false)
    expect(s.cell).toBeNull()
    expect(s.color.predictions).toEqual([0, 3])
  })

  it('tries the columns too', () => {
    // Columns (0,1,2), (1,2,3), (0,1,?) progress by +1; no rule fits the rows (0,1,0), (1,2,1).
    const base = cell('triangle', 'medium', 'white', 0, [4])
    const s = solve(vis([0, 1, 0], [1, 2, 1], [2, 3]).map((c) => withCell(base, { color: c })))
    expect(s.color.fits).toEqual([{ rule: 'progression+1@col', value: 2 }])
    expect(s.unique).toBe(true)
    // A symmetric grid fits the same rule both ways (here only cyclically: 4 is off the scale).
    const o = solve(vis([0, 1, 2], [1, 2, 3], [2, 3]).map((c) => withCell(base, { orientation: c })))
    expect(o.orientation.fits).toEqual([
      { rule: 'cyclic+1@row', value: 0 },
      { rule: 'cyclic+1@col', value: 0 },
    ])
    const t = solve(vis([1, 2, 3], [2, 3, 1], [3, 1]).map((c) => withCell(base, { color: c })))
    expect(t.color.fits).toEqual([
      { rule: 'distribution@row', value: 2 },
      { rule: 'distribution@col', value: 2 },
    ])
  })

  it('reports inconsistency when no rule fits an attribute', () => {
    const base = cell('triangle', 'medium', 'white', 0, [4])
    const s = solve(vis([0, 1, 3], [2, 0, 1], [3, 3]).map((c) => withCell(base, { color: c })))
    expect(s.consistent).toBe(false)
    expect(s.unique).toBe(false)
  })

  it('rejects a count lure: a count rule predicting another number of objects than the position rule', () => {
    const base = cell('square', 'small', 'black', 45, [4])
    const sets = [[0, 1], [1, 2], [0, 2], [3, 4], [4, 5], [3, 5], [6, 7], [0, 1]]
    const s = solve(sets.map((p) => withCell(base, { positions: p })))
    expect(s.positions.predictions).toEqual([maskOf([0, 1, 6, 7])])
    expect(s.count.predictions).toEqual([2])
    expect(s.noCountLure).toBe(false)
    expect(s.unique).toBe(false)
  })

  it('uses canonical layouts only when every visible cell has one', () => {
    const base = cell('square', 'small', 'black', 45, [4])
    const canon = [1, 2, 3, 1, 2, 3, 1, 2].map((n) => withCell(base, { positions: [...positionsOfCount(n)] }))
    expect(solve(canon).cell?.positions).toBe(CANONICAL_MASKS[2])
    const off = [...canon.slice(0, 7), withCell(base, { positions: [0, 1] })]
    expect(solve(off).positions.fits.some((f) => f.rule.startsWith('canonical'))).toBe(false)
  })
})

function positionsOfCount(n: number): number[] {
  const m = CANONICAL_MASKS[n - 1] as number
  return [0, 1, 2, 3, 4, 5, 6, 7, 8].filter((s) => m & (1 << s))
}

describe('generator pieces', () => {
  const rng = createRng('gen-pieces')

  it('samples scalar, count and position lines that follow their rule', () => {
    for (let t = 0; t < 300; t++) {
      for (const attr of SCALAR_ATTRS) {
        for (const r of SCALAR_RULES) {
          const v = sampleScalar(rng, r, DOMAIN_SIZE[attr])
          const grid = v.map((x) => withCell(cell('triangle', 'small', 'white', 0, [4]), { [attr]: x }))
          const rules = { ...EXAMPLE1_RULES, size: 'constant', count: 'constant', [attr]: r } as RuleSet
          expect(violatedRules(grid, rules)).toEqual([])
        }
      }
      for (const r of ['constant', 'progression+1', 'progression-1', 'arithmetic+', 'arithmetic-', 'distribution'] as const) {
        const counts = sampleCounts(rng, r)
        expect(counts.every((n) => n >= 1 && n <= 4)).toBe(true)
      }
      for (const r of ['xor', 'or', 'distribution'] as const) {
        const sets = samplePositions(rng, r)
        expect(sets.every((m) => m > 0 && popcount(m) <= 6)).toBe(true)
        const grid = sets.map((m) => ({ ...cell('triangle', 'small', 'white', 0, [4]), positions: m }))
        expect(violatedRules(grid, { ...EXAMPLE1_RULES, size: 'constant', count: 'derived', position: r })).toEqual([])
      }
    }
  })

  it('samples grids whose declared rules hold, for every rule set', () => {
    for (const rules of allRuleSets()) expect(violatedRules(sampleGrid(rng, rules), rules)).toEqual([])
  })

  it('grows RAVEN-FAIR option trees rooted at the key', () => {
    for (let t = 0; t < 500; t++) {
      const rules = allRuleSets()[t * 3]!
      const grid = sampleGrid(rng, rules)
      const opts = fairOptions(rng, grid[8] as Cell, grid.slice(0, 8), rules.position === 'canonical')
      expect(opts).not.toBeNull()
      const o = opts as Cell[]
      expect(o).toHaveLength(6)
      expect(cellEquals(o[0] as Cell, grid[8] as Cell)).toBe(true)
      expect(formsOneChangeTree(o)).toBe(true)
      expect(new Set(o.map((c) => JSON.stringify(c))).size).toBe(6)
    }
  })
})

describe('modal-attribute picker', () => {
  it('singles out the key of a one-change star (the §14.6 option set)', () => {
    expect(modalScores(EXAMPLE1_STAR)).toEqual([6, 5, 4, 5, 4, 5])
    expect(modalArgmax(EXAMPLE1_STAR)).toEqual([0])
    expect(modalPicksKeyUniquely(EXAMPLE1_STAR, 0)).toBe(true)
    expect(modalHitProbability(EXAMPLE1_STAR, 0)).toBe(1)
  })

  it('does not single out the key of a RAVEN-FAIR chain', () => {
    // Shape: square ×3 modal; size: small ×3; count and positions: 3 and 2 tie (both modal).
    expect(modalScores(EXAMPLE1_CHAIN)).toEqual([4, 5, 6, 6, 5, 4])
    expect(modalArgmax(EXAMPLE1_CHAIN)).toEqual([2, 3])
    expect(modalPicksKeyUniquely(EXAMPLE1_CHAIN, 0)).toBe(false)
    expect(modalHitProbability(EXAMPLE1_CHAIN, 0)).toBe(0)
    expect(modalHitProbability(EXAMPLE1_CHAIN, 3)).toBe(0.5)
  })
})
