/**
 * Copy of the paper-folding renderer (DESIGN §3 row 7, §13 screen-reader text; ROADMAP A13: plain,
 * non-diagnostic words only). The text alternative describes the whole stimulus in order, neutrally:
 * the sheet, each fold (its line and which half moves onto which), the punches, and every option in
 * the same format (holes by row, then column), so the item can be solved from the text alone.
 */

import { lineKindOf } from '../../tasks/folding/geometry'
import type { FoldStep, LineKind, Side, Slot } from '../../tasks/folding/spec'

export const FOLDING_STEM = 'A square sheet of paper is folded as shown, then a hole is punched through every layer. Which option shows the sheet when it is unfolded?'

export const FOLDING_FIGURE_LABEL = 'How the sheet is folded and punched'

export const FOLDING_OPTIONS_LEGEND = 'Options: the sheet unfolded'

/** The visible caption under fold panel k (1-based) and under the punch panel. */
export const foldCaption = (k: number): string => `Fold ${k}`
export const PUNCH_CAPTION = 'Punch'

/** The sheet, as the first line of the text alternative. */
export function sheetText(n: number): string {
  return `The sheet is a square with a ${n} by ${n} grid of places for holes. Rows are numbered 1 to ${n} from the top, and columns 1 to ${n} from the left.`
}

const LINE_TEXT: Readonly<Record<LineKind, string>> = Object.freeze({
  v: 'its vertical centre line',
  h: 'its horizontal centre line',
  d: 'the diagonal line through its middle that runs from upper left to lower right',
  a: 'the diagonal line through its middle that runs from upper right to lower left',
})

const SIDE_TEXT: Readonly<Record<Side, string>> = Object.freeze({
  left: 'left',
  right: 'right',
  top: 'top',
  bottom: 'bottom',
  top_left: 'upper-left',
  top_right: 'upper-right',
  bottom_left: 'lower-left',
  bottom_right: 'lower-right',
})

const OPPOSITE: Readonly<Record<Side, Side>> = Object.freeze({
  left: 'right',
  right: 'left',
  top: 'bottom',
  bottom: 'top',
  top_left: 'bottom_right',
  bottom_right: 'top_left',
  top_right: 'bottom_left',
  bottom_left: 'top_right',
})

/** "Step k: …" for fold k (1-based). */
export function foldText(k: number, fold: FoldStep): string {
  const what = k === 1 ? 'the sheet' : 'the folded paper'
  const line = LINE_TEXT[lineKindOf(fold.moving)]
  return `Step ${k}: ${what} is folded in half along ${line}; the ${SIDE_TEXT[fold.moving]} half is folded over onto the ${SIDE_TEXT[OPPOSITE[fold.moving]]} half.`
}

const place = (s: Slot): string => `row ${s.row}, column ${s.col}`

/** The punch step, after the folds. */
export function punchText(punches: readonly Slot[]): string {
  const where = punches.map((s) => `at ${place(s)}`).join(' and ')
  return punches.length === 1
    ? `Then a hole is punched through every layer ${where} of the sheet.`
    : `Then ${punches.length} holes are punched through every layer, ${where} of the sheet.`
}

/** Accessible name of option `letter` (same format for every option: holes by row, then column). */
export function optionName(letter: string, holes: readonly Slot[]): string {
  return `Option ${letter}: ${holes.length === 1 ? 'hole' : 'holes'} at ${holes.map(place).join('; ')}`
}
