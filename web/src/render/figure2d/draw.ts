/**
 * Geometry of the figure2d drawings (DESIGN §4.2; ROADMAP M1.13): pure functions from the spec to SVG numbers, so the
 * renderer only places what this module computes. One square is {@link UNIT} viewBox units; every square of a figure
 * is drawn alike (a filled square with an outline: no square carries a mark, the shape alone decides).
 *
 * - Task 'rotate': the target and every option share one square box whose side fits the longest diagonal of the five
 *   figures plus a margin, so any figure turned by any angle about its centre stays inside its box.
 * - Task 'mirror': the target's box is (2m + 1) squares a side (m = the figure's box side) with the figure on one side
 *   of the dashed mirror line, which runs across the whole box, edge to edge (vertical: figure on the left; horizontal:
 *   on top; diagonal top-left to bottom-right: figure below the line; diagonal bottom-left to top-right: figure above
 *   it). Options are drawn upright in boxes of m squares plus a margin.
 */

import type { Cell, Figure2dSpec, MirrorLine } from '../../tasks/figure2d/spec'

export const UNIT = 10
/** Margin inside a box, viewBox units. */
export const PAD = 6
export const PAPER = '#ffffff'
/** Square fill: 4.5:1 against the paper; the outline is black. */
export const FILL = '#767676'
export const OUTLINE = '#000000'
export const OUTLINE_WIDTH = 1.2
export const BOX_BORDER = '#767676'
export const LINE_WIDTH = 2
export const LINE_DASH = '6 4'

/** [height, width] of a figure in squares. */
export function size(cells: readonly Cell[]): [number, number] {
  let h = 0
  let w = 0
  for (const [r, c] of cells) {
    h = Math.max(h, r + 1)
    w = Math.max(w, c + 1)
  }
  return [h, w]
}

export interface Placed {
  /** viewBox side. */
  readonly side: number
  /** SVG transform of the figure's group (squares at (c·UNIT, r·UNIT)). */
  readonly transform: string
}

/** Side of the shared box of a rotate item: fits every figure at any angle. */
export function rotateBoxSide(spec: Figure2dSpec): number {
  const figs = [spec.figure.cells, ...spec.options.map((o) => o.cells)]
  const diag = Math.max(...figs.map((c) => Math.hypot(...size(c))))
  return Math.ceil(diag * UNIT) + 2 * PAD
}

/** A figure centred in a box of `side`, turned `angle` degrees clockwise about its centre. */
export function centred(cells: readonly Cell[], side: number, angle: number): Placed {
  const [h, w] = size(cells)
  const t = `translate(${side / 2} ${side / 2})${angle === 0 ? '' : ` rotate(${angle})`} translate(${(-w * UNIT) / 2} ${(-h * UNIT) / 2})`
  return { side, transform: t }
}

export interface MirrorTarget extends Placed {
  readonly line: { readonly x1: number; readonly y1: number; readonly x2: number; readonly y2: number }
}

/** The mirror target: the figure placed on one side of the line, the line across the whole box. */
export function mirrorTarget(cells: readonly Cell[], line: MirrorLine): MirrorTarget {
  const [h, w] = size(cells)
  const m = Math.max(h, w)
  const side = (2 * m + 1) * UNIT + 2 * PAD
  const mid = PAD + (m + 0.5) * UNIT
  let x = PAD
  let y = PAD
  let seg: MirrorTarget['line']
  switch (line) {
    case 'v':
      y = PAD + ((2 * m + 1 - h) * UNIT) / 2
      seg = { x1: mid, y1: 0, x2: mid, y2: side }
      break
    case 'h':
      x = PAD + ((2 * m + 1 - w) * UNIT) / 2
      seg = { x1: 0, y1: mid, x2: side, y2: mid }
      break
    case 'd':
      y = PAD + (m + 1) * UNIT
      seg = { x1: 0, y1: 0, x2: side, y2: side }
      break
    case 'a':
      seg = { x1: 0, y1: side, x2: side, y2: 0 }
      break
  }
  return { side, transform: `translate(${x} ${y})`, line: seg }
}

/** Side of a mirror option's box (upright figures). */
export function mirrorOptionSide(spec: Figure2dSpec): number {
  const m = Math.max(...spec.options.map((o) => Math.max(...size(o.cells))))
  return m * UNIT + 2 * PAD
}

/** The squares of a figure as SVG rects (in the figure's own frame). */
export function squaresOf(cells: readonly Cell[]): { x: number; y: number }[] {
  return cells.map(([r, c]) => ({ x: c * UNIT, y: r * UNIT }))
}
