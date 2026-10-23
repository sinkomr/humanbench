/**
 * The render payload of the qdata family (data interpretation and everyday word problems, axis QR;
 * DESIGN §3 row 6, §4.2 "Math"): the wire types of `spec`, shared by the generator, the verifier,
 * the renderer and the bank twin (`hb.gen.qdata`), and {@link specProblems}, the renderer's
 * "can I draw this?" check. Light on purpose (no templates, no verifier), so the lazy renderer
 * chunk can import it.
 *
 * A spec is `{ stem, hint, input_format, given, exhibit? }`:
 * - `stem`: the question, rendered from `given` (and the exhibit's labels) by the template;
 * - `given`: the structured quantities and references the stem shows (template fields only, never
 *   a result);
 * - `exhibit` (the `dt_*` templates): a small table, bar chart or line chart whose every value is an
 *   integer printed on it.
 * Never the key.
 */

import type { EntryFormat } from '../family'

/** The entry formats of qdata: the shared {@link EntryFormat} without letters. */
export type QdataFormat = Exclude<EntryFormat, 'letter'>

export const QDATA_FORMATS: readonly QdataFormat[] = Object.freeze(['integer', 'decimal', 'fraction'] as const)

/** One row of a table: its label (first column) and one integer per data column. */
export interface TableRow {
  readonly label: string
  readonly values: readonly number[]
}

/** A small table: ≤ 4 data columns × ≤ 6 rows of integers. */
export interface TableExhibit {
  readonly kind: 'table'
  readonly title: string
  /** Header of the label column. */
  readonly row_header: string
  /** Headers of the data columns. */
  readonly columns: readonly string[]
  readonly rows: readonly TableRow[]
}

/** One series of a chart: a name and one integer per category. */
export interface ChartSeries {
  readonly name: string
  readonly values: readonly number[]
}

/** A bar chart (one series, 3–6 bars) or a line chart (one or two series, 4–7 points). */
export interface ChartExhibit {
  readonly kind: 'bar' | 'line'
  readonly title: string
  /** The unit of the values, shown on the value axis ("mm", "°C", "%", "visitors"). */
  readonly unit: string
  /** The name of the category axis ("Day", "Month", "Time"). */
  readonly x_label: string
  readonly categories: readonly string[]
  readonly series: readonly ChartSeries[]
  /** The value axis: from y_min to y_max with a gridline every y_step (all integers). */
  readonly y_min: number
  readonly y_max: number
  readonly y_step: number
}

export type QdataExhibit = TableExhibit | ChartExhibit

/** The structured quantities of a stem: strings and integers only. */
export type QdataGiven = { readonly [k: string]: string | number }

export interface QdataSpec {
  readonly stem: string
  readonly hint: string
  readonly input_format: QdataFormat
  readonly given: QdataGiven
  readonly exhibit?: QdataExhibit
}

/** Limits of a drawable exhibit (the verifier checks the same). */
export const TABLE_MAX_COLUMNS = 4
export const TABLE_MAX_ROWS = 6
export const BAR_MIN = 3
export const BAR_MAX = 6
export const LINE_MIN = 4
export const LINE_MAX = 7
export const LINE_MAX_SERIES = 2
/** Most gridline intervals on a value axis. */
export const AXIS_MAX_TICKS = 12

const isInt = (v: unknown): v is number => typeof v === 'number' && Number.isSafeInteger(v)
const isText = (v: unknown): v is string => typeof v === 'string' && v.length > 0 && v.length <= 200
const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v)

function tableProblems(x: Record<string, unknown>): string[] {
  const out: string[] = []
  const cols = x.columns
  const rows = x.rows
  if (!isText(x.title) || !isText(x.row_header)) out.push('a table needs a title and a row header')
  if (!Array.isArray(cols) || cols.length < 1 || cols.length > TABLE_MAX_COLUMNS || !cols.every(isText)) {
    out.push(`a table has 1–${TABLE_MAX_COLUMNS} named data columns`)
    return out
  }
  if (!Array.isArray(rows) || rows.length < 1 || rows.length > TABLE_MAX_ROWS) {
    out.push(`a table has 1–${TABLE_MAX_ROWS} rows`)
    return out
  }
  for (const r of rows) {
    if (!isObj(r) || !isText(r.label) || !Array.isArray(r.values) || r.values.length !== cols.length || !r.values.every(isInt)) {
      out.push('every table row has a label and one integer per column')
      break
    }
  }
  return out
}

function chartProblems(x: Record<string, unknown>): string[] {
  const out: string[] = []
  const bar = x.kind === 'bar'
  const cats = x.categories
  const series = x.series
  if (!isText(x.title) || !isText(x.unit) || !isText(x.x_label)) out.push('a chart needs a title, a unit and a category-axis name')
  const [lo, hi] = bar ? [BAR_MIN, BAR_MAX] : [LINE_MIN, LINE_MAX]
  if (!Array.isArray(cats) || cats.length < lo || cats.length > hi || !cats.every(isText) || new Set(cats).size !== cats.length) {
    out.push(`a ${String(x.kind)} chart has ${lo}–${hi} distinct categories`)
    return out
  }
  const maxSeries = bar ? 1 : LINE_MAX_SERIES
  if (!Array.isArray(series) || series.length < 1 || series.length > maxSeries) {
    out.push(`a ${String(x.kind)} chart has 1–${maxSeries} series`)
    return out
  }
  const { y_min: y0, y_max: y1, y_step: step } = x
  if (!isInt(y0) || !isInt(y1) || !isInt(step) || step <= 0 || y1 <= y0 || y0 % step !== 0 || y1 % step !== 0 || (y1 - y0) / step > AXIS_MAX_TICKS) {
    out.push(`the value axis is integers y_min < y_max on a y_step grid with ≤ ${AXIS_MAX_TICKS} steps`)
    return out
  }
  if (bar && !(y0 <= 0 && y1 >= 0)) out.push('a bar chart axis includes 0 (the bars start there)')
  for (const s of series) {
    if (!isObj(s) || !isText(s.name) || !Array.isArray(s.values) || s.values.length !== cats.length) {
      out.push('every series has a name and one value per category')
      break
    }
    if (!s.values.every((v) => isInt(v) && v >= y0 && v <= y1)) {
      out.push('every chart value is an integer on the axis range')
      break
    }
  }
  if (Array.isArray(series) && new Set(series.map((s) => (isObj(s) ? s.name : ''))).size !== series.length) out.push('series names are distinct')
  return out
}

/** Every way an exhibit is not drawable (empty = drawable). */
export function exhibitProblems(x: unknown): string[] {
  if (!isObj(x)) return ['an exhibit is an object']
  if (x.kind === 'table') return tableProblems(x)
  if (x.kind === 'bar' || x.kind === 'line') return chartProblems(x)
  return [`unknown exhibit kind ${JSON.stringify(x.kind)}`]
}

/**
 * Every way `spec` is not drawable by the qdata renderer (empty = drawable): the lazy loader's
 * `fits` check. Shape only: whether the numbers are right is the verifier's job.
 */
export function specProblems(spec: unknown): string[] {
  if (!isObj(spec)) return ['a spec is an object']
  const out: string[] = []
  if (!(typeof spec.stem === 'string' && spec.stem.length > 0)) out.push('a spec has a stem')
  if (typeof spec.hint !== 'string') out.push('a spec has a hint')
  if (!(QDATA_FORMATS as readonly unknown[]).includes(spec.input_format)) out.push('input_format is integer, decimal or fraction')
  if (!isObj(spec.given) || !Object.values(spec.given).every((v) => typeof v === 'string' || isInt(v))) out.push('given holds strings and integers')
  if ('exhibit' in spec) out.push(...exhibitProblems(spec.exhibit))
  return out
}
