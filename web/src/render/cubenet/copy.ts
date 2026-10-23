/**
 * Copy of the cube-net renderer (DESIGN §3 row 7, §4.2, §13 screen-reader labels; ROADMAP A13).
 * The text alternatives describe the stimulus completely and neutrally: the net square by square,
 * row by row, and every option by the same three faces in the same words, so a screen-reader user
 * can solve the item from the text, and no option is described differently from another.
 */

import type { CubeView, Mark, NetSquare } from '../../tasks/cubenet/spec'

export const CUBENET_STEM = 'This flat pattern folds up into a cube, with the marks on the outside. Which cube could it make?'

/** Shown under the stem: what an option shows. */
export const CUBENET_VIEW_NOTE = 'Each cube is seen from above one corner, showing its top, front left and front right faces.'

export const CUBENET_OPTIONS_LEGEND = 'Options'

/** The words for each mark (every mark looks the same however it is turned). */
export const MARK_NAMES: Readonly<Record<Mark, string>> = Object.freeze({
  disc: 'filled circle',
  ring: 'ring',
  plus: 'plus sign',
  cross: 'x-cross',
  square: 'filled square',
  dots: 'four dots',
  target: 'ring with a dot',
  frame: 'empty square',
})

const runText = (cols: readonly NetSquare[]): string => {
  const first = (cols[0] as NetSquare).c + 1
  const last = (cols[cols.length - 1] as NetSquare).c + 1
  const where = cols.length === 1 ? `column ${first}` : cols.length === 2 ? `columns ${first} and ${last}` : `columns ${first} to ${last}`
  return `${where}: ${cols.map((q) => MARK_NAMES[q.mark]).join(', ')}`
}

/**
 * Text alternative of the net: "Flat pattern of 6 squares … Row 1: column 2: ring. Row 2: columns
 * 1 to 4: plus sign, filled circle, x-cross, four dots. Row 3: column 2: filled square." Rows and
 * columns count from 1 at the top left of the pattern; side-by-side squares in a row are one run.
 */
export function netAlt(net: readonly NetSquare[]): string {
  const rows = [...new Set(net.map((q) => q.r))].sort((a, b) => a - b)
  const parts = rows.map((r, i) => {
    const cells = net.filter((q) => q.r === r).sort((a, b) => a.c - b.c)
    const runs: NetSquare[][] = []
    for (const q of cells) {
      const run = runs[runs.length - 1]
      if (run !== undefined && (run[run.length - 1] as NetSquare).c === q.c - 1) run.push(q)
      else runs.push([q])
    }
    return `Row ${i + 1}: ${runs.map(runText).join('; ')}.`
  })
  return `Flat pattern of 6 squares, row by row from the top; squares that touch along a side are joined there and fold along that line. ${parts.join(' ')}`
}

/** Description of a cube view (the same form for every option). */
export function viewText(v: CubeView): string {
  return `top face: ${MARK_NAMES[v.top]}; front left face: ${MARK_NAMES[v.left]}; front right face: ${MARK_NAMES[v.right]}`
}

/** Accessible name of option `letter`. */
export function cubenetOptionName(letter: string, v: CubeView): string {
  return `Option ${letter}: ${viewText(v)}.`
}
