/**
 * Worked solutions of matrix items (DESIGN §4.2 "Matrices"; ROADMAP M1.6, M1.R). The item's
 * `structural_params` name the rule of every feature along the rows (`tasks/matrices/grammar.ts`);
 * this module applies each rule to the two visible cells of the bottom row to derive the missing
 * cell feature by feature, writes what it saw in rows 1 and 2, and finds the option that equals
 * the derived cell. The answer is that option, not the key; `worked.test.ts` checks it equals the
 * key over thousands of items (so the rules and the wording cannot drift from the generator).
 *
 * Rules (grammar): shape, size, colour, orientation: constant, progression ±1 along the feature's
 * ordered values, or distribution (each row holds the same three values once each). Layout: in
 * count mode the number of objects follows constant / progression ±1 / arithmetic ± / distribution
 * and the objects sit in the standard places for that number; in position mode the places follow
 * xor / or / distribution and the number is whatever that gives.
 */

import { optionLetter } from '../../render/choice/keys'
import { SLOT_NAMES, describeCell } from '../../render/matrices/draw'
import {
  COLORS,
  ORIENTATIONS,
  SCALAR_ATTRS,
  SHAPES,
  SIZES,
  canonicalMask,
  maskOf,
  parseRuleSet,
  popcount,
  positionsOf,
  type MatrixCell,
  type RuleSet,
  type ScalarAttr,
} from '../../tasks/matrices/grammar'
import type { MatrixItem } from '../../tasks/matrices'
import type { WorkedSolution } from './types'
import { cap, list } from './text'

type Value = string | number

const DOMAINS: Readonly<Record<ScalarAttr, readonly Value[]>> = {
  shape: SHAPES,
  size: SIZES,
  color: COLORS,
  orientation: ORIENTATIONS,
}

const ATTR_NAME: Readonly<Record<ScalarAttr, string>> = { shape: 'shape', size: 'size', color: 'shade', orientation: 'turn' }

function label(attr: ScalarAttr, v: Value): string {
  switch (attr) {
    case 'color':
      return String(v).replace('_', ' ')
    case 'orientation':
      return `${v}°`
    default:
      return String(v)
  }
}

const same = (a: readonly number[], b: readonly number[]): boolean => a.length === b.length && a.every((x, i) => x === b[i])

/** The third element of a set of three distinct values that has two of them already. */
function missingFrom<T>(row: readonly T[], seen: readonly T[]): T {
  const rest = row.filter((v) => !seen.includes(v))
  if (rest.length !== 1) throw new RangeError('a distribution row must hold three distinct values')
  return rest[0] as T
}

interface Derived {
  readonly cell: MatrixCell
  readonly steps: string[]
}

/** Derive the missing cell from the grid and the rule set (module comment). */
function derive(grid: readonly (readonly MatrixCell[])[], rules: RuleSet): Derived {
  const row = (r: number): readonly MatrixCell[] => grid[r] as readonly MatrixCell[]
  const [a, b] = [row(2)[0] as MatrixCell, row(2)[1] as MatrixCell]
  const steps: string[] = []
  const fixed: string[] = []
  const out: Partial<Record<ScalarAttr, Value>> = {}

  for (const attr of SCALAR_ATTRS) {
    const dom = DOMAINS[attr]
    const rule = rules[attr]
    const vals = (r: number): Value[] => row(r).map((c) => c[attr])
    const shown = (r: number): string => vals(r).map((v) => label(attr, v)).join(', ')
    const [va, vb] = [a[attr], b[attr]]
    const name = ATTR_NAME[attr]
    if (rule === 'constant') {
      out[attr] = va
      fixed.push(`the ${name} (${label(attr, va)})`)
      continue
    }
    if (rule === 'distribution') {
      const v = missingFrom(vals(0), [va, vb])
      out[attr] = v
      steps.push(
        `${cap(name)}: every row has the same three values, once each (row 1: ${shown(0)}; row 2: ${shown(1)}). Row 3 already has ${label(attr, va)} and ${label(attr, vb)}, so the missing cell has ${label(attr, v)}.`,
      )
      continue
    }
    const delta = rule === 'progression+1' ? 1 : -1
    const at = dom.indexOf(vb) + delta
    const v = dom[at]
    if (v === undefined) throw new RangeError(`a ${attr} progression left its values`)
    out[attr] = v
    const ordered = (delta > 0 ? [...dom] : [...dom].reverse()).map((x) => label(attr, x)).join(' → ')
    steps.push(
      `${cap(name)}: it moves one step along ${ordered} at each cell to the right (row 1: ${shown(0)}; row 2: ${shown(1)}). Row 3 has ${label(attr, va)}, ${label(attr, vb)}, so the missing cell has ${label(attr, v)}.`,
    )
  }
  if (fixed.length > 0) steps.unshift(`Some features never change, in any cell: ${list(fixed)}.`)

  // Layout: the number of objects and where they are.
  const counts = (r: number): number[] => row(r).map((c) => c.positions.length)
  const where = (r: number): string => list(row(r).map((c) => String(c.positions.length)))
  const [na, nb] = [a.positions.length, b.positions.length]
  let positions: number[]
  if (rules.position === 'canonical') {
    let n: number
    switch (rules.count) {
      case 'constant':
        n = na
        steps.push(`Number of objects: it is ${na} in every cell.`)
        break
      case 'progression+1':
      case 'progression-1': {
        const delta = rules.count === 'progression+1' ? 1 : -1
        n = nb + delta
        steps.push(
          `Number of objects: it goes ${delta > 0 ? 'up' : 'down'} by one at each cell to the right (row 1: ${where(0)}; row 2: ${where(1)}). Row 3 has ${na}, ${nb}, so the missing cell has ${n}.`,
        )
        break
      }
      case 'arithmetic+':
      case 'arithmetic-': {
        const add = rules.count === 'arithmetic+'
        n = add ? na + nb : na - nb
        steps.push(
          `Number of objects: in each row the third cell has ${add ? 'the first two counts added' : 'the first count minus the second'} (row 1: ${where(0)}; row 2: ${where(1)}). Row 3: ${na} ${add ? '+' : '−'} ${nb} = ${n}.`,
        )
        break
      }
      case 'distribution':
        n = missingFrom(counts(0), [na, nb])
        steps.push(`Number of objects: every row has the same three counts, once each (row 1: ${where(0)}; row 2: ${where(1)}). Row 3 has ${na} and ${nb}, so the missing cell has ${n}.`)
        break
      default:
        throw new RangeError(`a canonical layout has no count rule "${rules.count}"`)
    }
    positions = positionsOf(canonicalMask(n))
  } else {
    const masks = (r: number): number[] => row(r).map((c) => maskOf(c.positions))
    const [ma, mb] = [maskOf(a.positions), maskOf(b.positions)]
    let mask: number
    if (rules.position === 'xor') {
      mask = ma ^ mb
      steps.push('Places of the objects: the third cell has an object in a place exactly when one, and only one, of the first two cells has an object there.')
    } else if (rules.position === 'or') {
      mask = ma | mb
      steps.push('Places of the objects: the third cell has an object in a place when either of the first two cells has one there.')
    } else {
      const m0 = masks(0)
      mask = missingFrom(m0, [ma, mb])
      steps.push('Places of the objects: every row uses the same three arrangements, once each.')
    }
    if (popcount(mask) === 0) throw new RangeError('a derived layout has no objects')
    positions = positionsOf(mask)
    steps.push(`Applying that to row 3 puts objects at ${list(positions.map((s) => SLOT_NAMES[s] ?? `slot ${s}`))}.`)
  }

  const cell: MatrixCell = {
    shape: out.shape as MatrixCell['shape'],
    size: out.size as MatrixCell['size'],
    color: out.color as MatrixCell['color'],
    orientation: out.orientation as MatrixCell['orientation'],
    positions,
  }
  return { cell, steps }
}

const cellsEqual = (x: MatrixCell, y: MatrixCell): boolean =>
  x.shape === y.shape && x.size === y.size && x.color === y.color && x.orientation === y.orientation && same(x.positions, y.positions)

/**
 * The worked solution of a matrix item. Throws a RangeError when the structure is not a rule set
 * or when the derived cell equals none of the options (which would be a generator bug).
 */
export function matrixSolution(item: MatrixItem): WorkedSolution {
  const rs = parseRuleSet(item.structural_params)
  if (rs === null) throw new RangeError('matrix item has no rule set')
  const { cell, steps } = derive(item.spec.grid, rs)
  const index = item.spec.options.findIndex((o) => cellsEqual(o, cell))
  if (index < 0) throw new RangeError('the derived cell is none of the options')
  return {
    steps: [
      'Read each row from left to right and ask how every feature changes: the shape, the size, the shade, the turn and the number and places of the objects.',
      ...steps,
      `So the missing cell is ${describeCell(cell)}, which is option ${optionLetter(index)}.`,
    ],
    answer: optionLetter(index),
    exact: String(index),
  }
}
