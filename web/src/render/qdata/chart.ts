/**
 * Geometry of a qdata chart (bar or line; DESIGN §3 row 6, §13): pure functions from the exhibit to
 * SVG coordinates in a fixed viewBox, so the SVG scales with its width and the layout is unit-tested.
 * Every value gets a printed label; gridlines sit at every `y_step`; category labels are the
 * exhibit's own labels, shortened to their first three letters when longer than six characters
 * (day and month names: "Wednesday" → "Wed", "September" → "Sep"; the full names are in the
 * chart's text alternative). In a line chart of two series, at each category the higher value's
 * label sits above its point and the lower one's below, so the labels never sit on each other.
 */

import type { ChartExhibit } from '../../tasks/qdata/spec'

export const VIEW_W = 320
export const VIEW_H = 220
export const MARGIN = Object.freeze({ left: 40, right: 8, top: 20, bottom: 34 })
/** Longest category label drawn whole; longer ones are shortened to three letters. */
export const LABEL_MAX = 6

/** A number as shown: "−" (U+2212) for negatives. */
export const fmt = (v: number): string => (v < 0 ? `−${-v}` : String(v))

/** The category label drawn on the axis. */
export const shortLabel = (s: string): string => (s.length > LABEL_MAX ? s.slice(0, 3) : s)

export interface Gridline {
  readonly y: number
  readonly text: string
  readonly zero: boolean
}
export interface Bar {
  readonly x: number
  readonly y: number
  readonly w: number
  readonly h: number
  readonly labelX: number
  readonly labelY: number
  readonly text: string
}
export interface Point {
  readonly x: number
  readonly y: number
  readonly labelY: number
  readonly text: string
}
export interface ChartLayout {
  readonly gridlines: readonly Gridline[]
  readonly categories: readonly { readonly x: number; readonly text: string }[]
  readonly bars: readonly Bar[]
  /** One list of points per series (line charts). */
  readonly lines: readonly (readonly Point[])[]
  readonly plot: { readonly x0: number; readonly x1: number; readonly y0: number; readonly y1: number }
  readonly labelY: number
}

export function chartLayout(c: ChartExhibit): ChartLayout {
  const x0 = MARGIN.left
  const x1 = VIEW_W - MARGIN.right
  const y0 = MARGIN.top
  const y1 = VIEW_H - MARGIN.bottom
  const span = c.y_max - c.y_min
  const yOf = (v: number): number => y0 + ((c.y_max - v) / span) * (y1 - y0)
  const n = c.categories.length
  const band = (x1 - x0) / n
  const centre = (i: number): number => x0 + (i + 0.5) * band
  const gridlines: Gridline[] = []
  for (let v = c.y_min; v <= c.y_max; v += c.y_step) gridlines.push({ y: yOf(v), text: fmt(v), zero: v === 0 })
  const categories = c.categories.map((t, i) => ({ x: centre(i), text: shortLabel(t) }))
  const bars: Bar[] = []
  const lines: Point[][] = []
  if (c.kind === 'bar') {
    const values = c.series[0]?.values ?? []
    const w = band * 0.6
    values.forEach((v, i) => {
      const top = yOf(Math.max(v, 0))
      const bottom = yOf(Math.min(v, 0))
      bars.push({ x: centre(i) - w / 2, y: top, w, h: Math.max(bottom - top, 0.5), labelX: centre(i), labelY: v >= 0 ? top - 4 : bottom + 12, text: fmt(v) })
    })
  } else {
    const two = c.series.length === 2
    c.series.forEach((s, k) => {
      lines.push(
        s.values.map((v, i) => {
          const other = two ? (c.series[1 - k]?.values[i] ?? v) : v
          // The higher value of the two (or series 0 on a tie) is labelled above, the other below.
          const above = !two || v > other || (v === other && k === 0)
          const y = yOf(v)
          return { x: centre(i), y, labelY: above ? y - 7 : y + 15, text: fmt(v) }
        }),
      )
    })
  }
  return { gridlines, categories, bars, lines, plot: { x0, x1, y0, y1 }, labelY: VIEW_H - 6 }
}

/** The SVG path of a square marker of half-size r centred on (x, y). */
export const squarePath = (x: number, y: number, r: number): string => `M${x - r} ${y - r}h${2 * r}v${2 * r}h${-2 * r}z`
