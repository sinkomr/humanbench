/**
 * TEST-ONLY helpers for hand-built matrices items (imported by the `*.test.ts` files of this
 * directory, never by app code): a cell literal, and an item whose metadata (structure, features,
 * prior, stratum, time, params) is consistent with a given grid, options and rule set, so a
 * negative test fails exactly the check it targets.
 */

import { stratumOfB } from '../priors'
import {
  maskOf,
  nonConstantRules,
  parseCell,
  structuralParamsOf,
  toSpecCell,
  type Cell,
  type Color,
  type MatrixSpec,
  type Orientation,
  type RuleSet,
  type Shape,
  type Size,
} from './grammar'
import { TIME_LIMIT_S, bPriorOf, expectedTimeOf, featuresOf, MATRIX_PROVENANCE, SIGMA_B_DEFAULT } from './prior'
import { matrices } from '.'
import type { MatrixItem } from './verify'

/** A cell literal: `cell('triangle', 'large', 'black', 0, [0, 4, 8])`. */
export function cell(shape: Shape, size: Size, color: Color, orientation: Orientation, positions: readonly number[]): Cell {
  const c = parseCell({ shape, size, color, orientation, positions: [...positions] })
  if (typeof c === 'string') throw new Error(c)
  return c
}

/** A copy of `c` with some components replaced (positions given as slot lists). */
export function withCell(c: Cell, patch: Partial<Omit<Cell, 'positions'>> & { positions?: readonly number[] }): Cell {
  const { positions, ...rest } = patch
  return { ...c, ...rest, ...(positions ? { positions: maskOf(positions) } : {}) }
}

/** The spec of 8 visible cells (row-major) and the options. */
export function specOf(visible: readonly Cell[], options: readonly Cell[]): MatrixSpec {
  if (visible.length !== 8) throw new RangeError('specOf needs the 8 visible cells')
  return {
    grid: [visible.slice(0, 3), visible.slice(3, 6), visible.slice(6, 8)].map((r) => r.map(toSpecCell)),
    options: options.map(toSpecCell),
  }
}

/** A complete item for `visible` (8 cells), `options`, key index and declared `rules`. */
export function handItem(visible: readonly Cell[], options: readonly Cell[], index: number, rules: RuleSet): MatrixItem {
  const template = matrices.generate('fixture-template')
  const features = featuresOf(rules)
  const b = bPriorOf(features)
  return {
    ...template,
    stratum: stratumOfB(b),
    spec: specOf(visible, options),
    key: { index },
    structural_params: structuralParamsOf(rules),
    family_id: matrices.familyIdOf(structuralParamsOf(rules)),
    params: { model: '2pl', a: 1, b },
    difficulty: { features: { ...features }, b_prior: b, sd_prior: SIGMA_B_DEFAULT, provenance: MATRIX_PROVENANCE },
    expected_time_s: expectedTimeOf(nonConstantRules(rules).length),
    time_limit_s: TIME_LIMIT_S,
  }
}

/** A deep copy of `item` with `f` applied to its JSON (for tampering tests). */
export function tamper(item: MatrixItem, f: (x: Record<string, unknown>) => void): MatrixItem {
  const x = JSON.parse(JSON.stringify(item)) as Record<string, unknown>
  f(x)
  return x as unknown as MatrixItem
}

// --- DESIGN §14.6 example 1 ------------------------------------------------------------------------

/** §14.6 example 1: count progression +1 and size progression along rows, shape constant by row. */
export const EXAMPLE1_RULES: RuleSet = {
  shape: 'constant',
  size: 'progression+1',
  color: 'constant',
  orientation: 'constant',
  count: 'progression+1',
  position: 'canonical',
}

const L = [[4], [3, 5], [0, 4, 8], [0, 2, 6, 8]] as const
const SIZES_BY_COL: readonly Size[] = ['small', 'medium', 'large']

/** The 9 cells of example 1 (the 9th is "3 triangle large"), black, orientation 0. */
export const EXAMPLE1_GRID: readonly Cell[] = (['circle', 'square', 'triangle'] as const).flatMap((shape) =>
  [0, 1, 2].map((col) => cell(shape, SIZES_BY_COL[col] as Size, 'black', 0, L[col] as readonly number[])),
)

export const EXAMPLE1_VISIBLE: readonly Cell[] = EXAMPLE1_GRID.slice(0, 8)
export const EXAMPLE1_KEY: Cell = EXAMPLE1_GRID[8] as Cell

/** The §14.6 options: every distractor is one change from the key (a star), key first. */
export const EXAMPLE1_STAR: readonly Cell[] = [
  EXAMPLE1_KEY,
  withCell(EXAMPLE1_KEY, { size: 0 }),
  withCell(EXAMPLE1_KEY, { positions: L[1] }),
  withCell(EXAMPLE1_KEY, { shape: 1 }),
  withCell(EXAMPLE1_KEY, { positions: L[0] }),
  withCell(EXAMPLE1_KEY, { shape: 4 }),
]

/** A RAVEN-FAIR chain for example 1 (key first): K → size small → square → 2 objects → medium → circle. */
export const EXAMPLE1_CHAIN: readonly Cell[] = (() => {
  const d1 = withCell(EXAMPLE1_KEY, { size: 0 })
  const d2 = withCell(d1, { shape: 1 })
  const d3 = withCell(d2, { positions: L[1] })
  const d4 = withCell(d3, { size: 1 })
  const d5 = withCell(d4, { shape: 4 })
  return [EXAMPLE1_KEY, d1, d2, d3, d4, d5]
})()
