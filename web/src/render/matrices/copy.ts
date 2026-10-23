/**
 * Copy of the matrices renderer (ROADMAP M1.13, A13; DESIGN §4.2, §13 screen-reader labels). The
 * cell descriptions themselves come from `draw.ts` (`describeCell`), so they name exactly the
 * attributes that are drawn.
 */

import type { MatrixCell } from '../../tasks/matrices/grammar'
import { describeCell } from './draw'

export const MATRIX_STEM = 'Which option completes the pattern? Pick the cell that belongs in the empty space at the bottom right.'

/**
 * Accessible name of the 3 × 3 grid. It names only the listing order of the cells, never a reading
 * direction: since generator 1.4.0 a rule may run along the rows, down the columns or along the
 * diagonals, and the label must not hint which.
 */
export const MATRIX_GRID_LABEL = 'Pattern: a grid of 3 rows and 3 columns, its cells listed left to right and top to bottom. The cells follow rules. The last cell is empty.'

/** Text alternative of the missing ninth cell. */
export const MATRIX_MISSING_LABEL = 'Row 3, column 3: empty, the cell to complete'

export const MATRIX_OPTIONS_LEGEND = 'Options'

/** Accessible name of option `letter` showing `cell`. */
export function matrixOptionName(letter: string, cell: MatrixCell): string {
  return `Option ${letter}: ${describeCell(cell)}`
}
