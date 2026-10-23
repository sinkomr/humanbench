/**
 * Copy of the figure2d renderer (DESIGN §3 row 7, §4.2, §13 screen-reader labels; ROADMAP A13). Every word the
 * renderer shows or speaks is here. The text alternatives describe each figure completely and neutrally: a reader can
 * solve the item from them, they never say which option is right, and every option gets the same kind of sentence.
 */

import type { Cell, Figure2dOption, Figure2dSpec, MirrorLine } from '../../tasks/figure2d/spec'

export const ROTATE_STEM = 'Which option is the target figure turned around in the flat plane? Turning only: a flipped-over (mirror) image does not count.'

export const MIRROR_STEM =
  'Which option is the target figure’s mirror image in the dashed line? Where an option sits does not matter, only its shape and the way it faces.'

export const FIGURE2D_OPTIONS_LEGEND = 'Options'

export const stemOf = (spec: Pick<Figure2dSpec, 'task'>): string => (spec.task === 'rotate' ? ROTATE_STEM : MIRROR_STEM)

const MIRROR_LINE_SENTENCE: Readonly<Record<MirrorLine, string>> = Object.freeze({
  v: 'The dashed mirror line is vertical, to the right of the figure.',
  h: 'The dashed mirror line is horizontal, below the figure.',
  d: 'The dashed mirror line is diagonal, from the top left corner to the bottom right corner, above and to the right of the figure.',
  a: 'The dashed mirror line is diagonal, from the bottom left corner to the top right corner, below and to the right of the figure.',
})

export const mirrorLineSentence = (line: MirrorLine): string => MIRROR_LINE_SENTENCE[line]

/** "1", "1 and 2", "1, 2 and 4". */
function listNumbers(xs: readonly number[]): string {
  if (xs.length <= 1) return xs.map(String).join('')
  return `${xs.slice(0, -1).join(', ')} and ${String(xs[xs.length - 1])}`
}

/** "Row 1: columns 1 and 2. Row 2: column 2." for a normalised figure (rows and columns counted from 1). */
export function describeRows(cells: readonly Cell[]): string {
  const rows = new Map<number, number[]>()
  for (const [r, c] of cells) rows.set(r, [...(rows.get(r) ?? []), c + 1])
  return [...rows.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([r, cs]) => {
      const sorted = [...cs].sort((x, y) => x - y)
      return `Row ${r + 1}: ${sorted.length === 1 ? 'column' : 'columns'} ${listNumbers(sorted)}.`
    })
    .join(' ')
}

const squares = (n: number): string => `${n} ${n === 1 ? 'square' : 'squares'}`

/** Text alternative of the target. */
export function targetLabel(spec: Figure2dSpec): string {
  const base = `Target figure: ${squares(spec.figure.cells.length)}. ${describeRows(spec.figure.cells)}`
  return spec.task === 'mirror' && spec.mirror_line !== undefined ? `${base} ${mirrorLineSentence(spec.mirror_line)}` : base
}

/** How an option is drawn: "drawn turned 30° clockwise", "drawn turned 45° counterclockwise", "drawn upright". */
export function turnPhrase(angle: number): string {
  if (angle === 0) return 'drawn upright'
  return `drawn turned ${Math.abs(angle)}° ${angle > 0 ? 'clockwise' : 'counterclockwise'}`
}

/** Accessible name of option `letter`. */
export function optionLabel(letter: string, option: Figure2dOption, task: Figure2dSpec['task']): string {
  const rows = describeRows(option.cells)
  if (task === 'mirror') return `Option ${letter}: ${squares(option.cells.length)}. ${rows}`
  const grid = option.angle === 0 ? 'In its own grid:' : 'In its own grid before the turn:'
  return `Option ${letter}: ${squares(option.cells.length)}, ${turnPhrase(option.angle)}. ${grid} ${rows}`
}
