/**
 * The qdata templates (DESIGN §3 row 6, §4.2 "Math"; ROADMAP A11): data interpretation from a small
 * exhibit (`dt_*`: a table, a bar chart or a line chart of integers) and everyday word problems
 * (`wp_*`: money, time, rates, mixtures). Each template lives in one stratum; its variants differ
 * only in the question asked about the same kind of givens, so they form one sibling group
 * `g:qdata:<label>` ({@link QDATA_SIBLING_SETS}; M1.14), while family_id stays per variant (A11).
 *
 * A variant draws its exhibit and `given` from the seeded stream, often answer first (a mean, a
 * percent, a price) with the data built around it; `value` is that intended answer, the key. The
 * verifier (`verify.ts`) never reads it: it recomputes the answer forward from the exhibit and
 * `given` alone. Every number is an integer; money is in whole cents; answers are exact rationals.
 * The bank twin `hb.gen.qdata` has the same table.
 */

import type { Rng } from '../../engine'
import type { Stratum } from '../ids'
import { Fraction } from '../quant/fraction'
import {
  BAR_SETTINGS,
  CATEGORY_LISTS,
  COMPOUND_FORWARD_Q,
  COMPOUND_REVERSE_Q,
  COMPOUND_SERIES,
  COMPOUND_SETTINGS,
  COMPOUND_UNIT,
  COMPOUND_X_LABEL,
  DAY_ROW_HEADER,
  DAYS,
  FREQ_SETTINGS,
  GOODS,
  INGREDIENTS,
  MISSING_SETTINGS,
  MIX_SETTINGS,
  NAMES,
  NOTES,
  PACK_SIZES,
  PCT_SETTINGS,
  SHARE_COLUMNS,
  SHARE_PP_Q,
  SHARE_REL_Q,
  SHARE_SETTINGS,
  SHOP_ITEMS,
  TABLE_SETTINGS,
  TEMP_CHANGE_Q,
  TEMP_RANGE_Q,
  TEMP_SERIES,
  TEMP_SETTINGS,
  TEMP_UNIT,
  THINGS,
  TWO_SERIES_SETTINGS,
  TWOWAY_SETTINGS,
  VEHICLES,
  WORK_SETTINGS,
  WP,
  YEARS,
  fill,
} from './settings'
import type { ChartExhibit, QdataExhibit, QdataFormat, QdataGiven, TableExhibit } from './spec'
import { siblingGroupId } from '../family'

/** What a variant draws: the exhibit (dt_*), the stem's quantities, and the intended answer. */
export interface Drawn {
  readonly exhibit?: QdataExhibit
  readonly given: QdataGiven
  readonly value: Fraction
}

export interface VariantDef {
  readonly template: string
  readonly variant: string
  readonly stratum: Stratum
  readonly format: QdataFormat
  /** The exhibit kind of a dt_* template; undefined for a word problem. */
  readonly exhibit?: 'table' | 'bar' | 'line'
  /** The fields of `given`, exactly. */
  readonly fields: readonly string[]
  /** [SPEC v0] judged count of separate computations. */
  readonly steps: number
  /** A percent is computed or used. */
  readonly percent: boolean
  /** The question runs a change backwards (a value before the changes). */
  readonly reversal: boolean
  /** Draw from `rng` only. */
  draw(rng: Rng): Drawn
  /** The stem from the exhibit and `given` (throws on data that do not fit the template). */
  render(exhibit: QdataExhibit | undefined, given: QdataGiven): string
  /** Exhibit values the question needs read (the reading load of the prior). */
  cellsRead(exhibit: QdataExhibit | undefined, given: QdataGiven): number
}

// --- helpers (the bank twin has the same) --------------------------------------------------------

export const frac = (n: number | bigint, d: number | bigint = 1): Fraction => Fraction.of(n, d)
export const at = <T>(xs: readonly T[], i: number): T => {
  const v = xs[i]
  if (v === undefined) throw new RangeError(`index ${i} out of range`)
  return v
}
export const sum = (xs: readonly number[]): number => xs.reduce((s, v) => s + v, 0)
export const gcd = (a: number, b: number): number => {
  a = Math.abs(a)
  b = Math.abs(b)
  while (b) [a, b] = [b, a % b]
  return a
}
const pad2 = (x: number): string => String(x).padStart(2, '0')
/** An integer with "−" (U+2212) for negatives. */
export const signed = (x: number): string => (x < 0 ? `−${-x}` : `${x}`)
/** Whole cents as "$12.05". */
export const money = (cents: number): string => {
  if (!(Number.isSafeInteger(cents) && cents >= 0)) throw new RangeError(`money(): cents must be a whole number ≥ 0, got ${cents}`)
  return `$${Math.floor(cents / 100)}.${pad2(cents % 100)}`
}
/** A 24-hour clock time "07:05". */
export const clock = (h: number, m: number): string => `${pad2(h)}:${pad2(m)}`
export const str = (g: QdataGiven, k: string): string => {
  const v = g[k]
  if (typeof v !== 'string') throw new TypeError(`given.${k} is not a string`)
  return v
}
export const num = (g: QdataGiven, k: string): number => {
  const v = g[k]
  if (typeof v !== 'number') throw new TypeError(`given.${k} is not a number`)
  return v
}
export function until<T>(draw: () => T, ok: (v: T) => boolean, what: string): T {
  for (let i = 0; i < 10_000; i++) {
    const v = draw()
    if (ok(v)) return v
  }
  throw new Error(`qdata: could not draw ${what}`)
}
const byId = <T extends { readonly id: string }>(xs: readonly T[], id: string): T => {
  const s = xs.find((x) => x.id === id)
  if (!s) throw new RangeError(`unknown setting ${JSON.stringify(id)}`)
  return s
}
const lower = (s: string): string => s.toLowerCase()

/** Steps of the value axis, smallest first; {@link axisFor} takes the first with ≤ 8 intervals. */
export const AXIS_STEPS = Object.freeze([1, 2, 5, 10, 20, 25, 50, 100, 200])
export const AXIS_TARGET_TICKS = 8

/** The value axis of a chart: includes 0 and every value, on the first step with ≤ 8 intervals. */
export function axisFor(values: readonly number[]): { y_min: number; y_max: number; y_step: number } {
  const lo = Math.min(0, ...values)
  const hi = Math.max(0, ...values)
  for (const s of AXIS_STEPS) {
    const y0 = Math.floor(lo / s) * s
    const y1 = Math.max(Math.ceil(hi / s) * s, y0 + s)
    if ((y1 - y0) / s <= AXIS_TARGET_TICKS) return { y_min: y0, y_max: y1, y_step: s }
  }
  throw new RangeError('axisFor(): values too spread')
}

/** n consecutive entries of a category list, from a random start. */
function run(rng: Rng, list: string, n: number): string[] {
  const xs = CATEGORY_LISTS[list]
  if (!xs || n > xs.length) throw new RangeError(`no ${n} consecutive ${list}`)
  const start = rng.int(0, xs.length - n)
  return xs.slice(start, start + n)
}

/** n positive integers summing to `total` (distinct random cut points). */
function partition(rng: Rng, total: number, n: number): number[] {
  const cuts = rng
    .shuffle(Array.from({ length: total - 1 }, (_, i) => i + 1))
    .slice(0, n - 1)
    .sort((a, b) => a - b)
  const out: number[] = []
  let last = 0
  for (const c of [...cuts, total]) {
    out.push(c - last)
    last = c
  }
  return out
}

/** Two distinct indices 0 … n − 1. */
function twoIndices(rng: Rng, n: number): [number, number] {
  const [i, j] = rng.shuffle(Array.from({ length: n }, (_, k) => k)) as [number, number]
  return [i, j]
}

function chart(kind: 'bar' | 'line', title: string, unit: string, x_label: string, categories: readonly string[], series: { name: string; values: number[] }[]): ChartExhibit {
  return { kind, title, unit, x_label, categories: [...categories], series, ...axisFor(series.flatMap((s) => s.values)) }
}

const table = (title: string, row_header: string, columns: readonly string[], rows: { label: string; values: number[] }[]): TableExhibit => ({
  kind: 'table',
  title,
  row_header,
  columns: [...columns],
  rows,
})

const chartOf = (x: QdataExhibit | undefined): ChartExhibit => {
  if (!x || x.kind === 'table') throw new TypeError('not a chart')
  return x
}
const tableOf = (x: QdataExhibit | undefined): TableExhibit => {
  if (!x || x.kind !== 'table') throw new TypeError('not a table')
  return x
}

const V = (d: VariantDef): VariantDef => Object.freeze(d)

// --- stratum 1 -----------------------------------------------------------------------------------

const barRead = (variant: 'diff' | 'total'): VariantDef =>
  V({
    template: 'dt_bar_read',
    variant,
    stratum: 1,
    format: 'integer',
    exhibit: 'bar',
    fields: variant === 'diff' ? ['setting', 'a', 'b'] : ['setting'],
    steps: 1,
    percent: false,
    reversal: false,
    draw(rng): Drawn {
      const s = rng.pick(BAR_SETTINGS)
      const n = variant === 'diff' ? rng.int(4, 6) : rng.int(3, 5)
      const cats = run(rng, s.cats, n)
      const values = until(() => cats.map(() => rng.int(s.lo, s.hi)), (vs) => new Set(vs).size > 1, 'bar values')
      const exhibit = chart('bar', s.title, s.unit, s.x_label, cats, [{ name: s.series, values }])
      if (variant === 'total') return { exhibit, given: { setting: s.id }, value: frac(sum(values)) }
      const [i, j] = until(() => twoIndices(rng, n), ([p, q]) => at(values, p) > at(values, q), 'two different bars')
      return { exhibit, given: { setting: s.id, a: at(cats, i), b: at(cats, j) }, value: frac(at(values, i) - at(values, j)) }
    },
    render(_x, g) {
      const s = byId(BAR_SETTINGS, str(g, 'setting'))
      return variant === 'diff' ? fill(s.diff, { a: str(g, 'a'), b: str(g, 'b') }) : fill(s.total, {})
    },
    cellsRead: (x) => (variant === 'diff' ? 2 : chartOf(x).categories.length),
  })

const tableSum = (variant: 'row' | 'col'): VariantDef =>
  V({
    template: 'dt_table_sum',
    variant,
    stratum: 1,
    format: 'integer',
    exhibit: 'table',
    fields: variant === 'row' ? ['setting', 'row'] : ['setting', 'column'],
    steps: 1,
    percent: false,
    reversal: false,
    draw(rng): Drawn {
      const s = rng.pick(TABLE_SETTINGS)
      const days = run(rng, 'days', rng.int(3, 5))
      const rows = days.map((label) => ({ label, values: s.columns.map(() => rng.int(2, 60)) }))
      const exhibit = table(s.title, DAY_ROW_HEADER, s.columns, rows)
      if (variant === 'row') {
        const r = rng.pick(rows)
        return { exhibit, given: { setting: s.id, row: r.label }, value: frac(sum(r.values)) }
      }
      const c = rng.int(0, s.columns.length - 1)
      return { exhibit, given: { setting: s.id, column: at(s.columns, c) }, value: frac(sum(rows.map((r) => at(r.values, c)))) }
    },
    render(_x, g) {
      const s = byId(TABLE_SETTINGS, str(g, 'setting'))
      return variant === 'row' ? fill(s.row_q, { row: str(g, 'row') }) : fill(s.col_q, { col: lower(str(g, 'column')) })
    },
    cellsRead: (x) => (variant === 'row' ? tableOf(x).columns.length : tableOf(x).rows.length),
  })

const wpChange = V({
  template: 'wp_change',
  variant: 'main',
  stratum: 1,
  format: 'decimal',
  fields: ['name', 'item1', 'price1', 'item2', 'price2', 'note'],
  steps: 2,
  percent: false,
  reversal: false,
  draw(rng): Drawn {
    const [item1, item2] = rng.shuffle(SHOP_ITEMS) as [string, string]
    const price1 = rng.int(105, 995)
    const price2 = rng.int(105, 995)
    const notes = NOTES.filter((x) => x * 100 > price1 + price2)
    const note = rng.pick(notes.slice(0, 2))
    return { given: { name: rng.pick(NAMES), item1, price1, item2, price2, note }, value: frac(note * 100 - price1 - price2, 100) }
  },
  render: (_x, g) =>
    fill(WP.change, {
      name: str(g, 'name'),
      item1: str(g, 'item1'),
      price1: money(num(g, 'price1')),
      item2: str(g, 'item2'),
      price2: money(num(g, 'price2')),
      note: `$${num(g, 'note')}`,
    }),
  cellsRead: () => 0,
})

// --- stratum 2 -----------------------------------------------------------------------------------

const lineTemp = (variant: 'range' | 'change'): VariantDef =>
  V({
    template: 'dt_line_temp',
    variant,
    stratum: 2,
    format: 'integer',
    exhibit: 'line',
    fields: variant === 'change' ? ['setting', 'a', 'b'] : ['setting'],
    steps: variant === 'range' ? 2 : 1,
    percent: false,
    reversal: false,
    draw(rng): Drawn {
      const s = rng.pick(TEMP_SETTINGS)
      const n = variant === 'range' ? rng.int(5, 7) : rng.int(4, 7)
      const cats = run(rng, s.cats, n)
      const base = rng.int(-8, 6)
      const values = until(() => cats.map(() => base + rng.int(0, 12)), (vs) => new Set(vs).size > 1, 'temperatures')
      const exhibit = chart('line', s.title, TEMP_UNIT, s.x_label, cats, [{ name: TEMP_SERIES, values }])
      if (variant === 'range') return { exhibit, given: { setting: s.id }, value: frac(Math.max(...values) - Math.min(...values)) }
      const [i, j] = until(
        () => twoIndices(rng, n).sort((p, q) => p - q),
        ([p, q]) => at(values, p) !== at(values, q),
        'two different temperatures',
      )
      return { exhibit, given: { setting: s.id, a: at(cats, i as number), b: at(cats, j as number) }, value: frac(at(values, j as number) - at(values, i as number)) }
    },
    render(_x, g) {
      byId(TEMP_SETTINGS, str(g, 'setting'))
      return variant === 'range' ? TEMP_RANGE_Q : fill(TEMP_CHANGE_Q, { a: str(g, 'a'), b: str(g, 'b') })
    },
    cellsRead: (x) => (variant === 'range' ? chartOf(x).categories.length : 2),
  })

const tableMean = V({
  template: 'dt_table_mean',
  variant: 'main',
  stratum: 2,
  format: 'integer',
  exhibit: 'table',
  fields: ['setting', 'column'],
  steps: 2,
  percent: false,
  reversal: false,
  draw(rng): Drawn {
    const s = rng.pick(TABLE_SETTINGS)
    const days = run(rng, 'days', rng.int(4, 6))
    const n = days.length
    const c = rng.int(0, s.columns.length - 1)
    const mean = rng.int(12, 48)
    const col = until(
      () => {
        const head = Array.from({ length: n - 1 }, () => rng.int(mean - 10, mean + 10))
        return [...head, mean * n - sum(head)]
      },
      (vs) => Math.abs(at(vs, n - 1) - mean) <= 12 && new Set(vs).size > 1,
      'a column with an integer mean',
    )
    const rows = days.map((label, r) => ({ label, values: s.columns.map((_, k) => (k === c ? at(col, r) : rng.int(2, 60))) }))
    return { exhibit: table(s.title, DAY_ROW_HEADER, s.columns, rows), given: { setting: s.id, column: at(s.columns, c) }, value: frac(mean) }
  },
  render: (_x, g) => fill(byId(TABLE_SETTINGS, str(g, 'setting')).mean_q, { col: lower(str(g, 'column')) }),
  cellsRead: (x) => tableOf(x).rows.length,
})

const wpTimetable = V({
  template: 'wp_timetable',
  variant: 'main',
  stratum: 2,
  format: 'integer',
  fields: ['vehicle', 'dep_h', 'dep_m', 'arr_h', 'arr_m'],
  steps: 2,
  percent: false,
  reversal: false,
  draw(rng): Drawn {
    const [dep, dur] = until(
      () => [rng.int(5 * 60, 18 * 60 + 59), rng.int(35, 230)] as const,
      ([d, t]) => Math.floor((d + t) / 60) > Math.floor(d / 60) && (d + t) % 60 !== d % 60,
      'a trip across an hour',
    )
    const arr = dep + dur
    return {
      given: { vehicle: rng.pick(VEHICLES), dep_h: Math.floor(dep / 60), dep_m: dep % 60, arr_h: Math.floor(arr / 60), arr_m: arr % 60 },
      value: frac(dur),
    }
  },
  render: (_x, g) =>
    fill(WP.timetable, { vehicle: str(g, 'vehicle'), dep: clock(num(g, 'dep_h'), num(g, 'dep_m')), arr: clock(num(g, 'arr_h'), num(g, 'arr_m')) }),
  cellsRead: () => 0,
})

// --- stratum 3 -----------------------------------------------------------------------------------

/** Bar-share totals: multiples of 20, so a multiple-of-5 percent of each is a whole number. */
export const SHARE_TOTALS = Object.freeze([40, 60, 80, 100, 120, 140, 160, 180, 200])

const barShare = V({
  template: 'dt_bar_share',
  variant: 'main',
  stratum: 3,
  format: 'integer',
  exhibit: 'bar',
  fields: ['setting', 'a'],
  steps: 3,
  percent: true,
  reversal: false,
  draw(rng): Drawn {
    const s = rng.pick(BAR_SETTINGS)
    const n = rng.int(3, 5)
    const cats = run(rng, s.cats, n)
    const total = rng.pick(SHARE_TOTALS)
    const pcts = until(() => partition(rng, 20, n).map((p) => p * 5), (ps) => new Set(ps).size > 1, 'shares')
    const values = pcts.map((p) => (p * total) / 100)
    const i = rng.int(0, n - 1)
    const exhibit = chart('bar', s.title, s.unit, s.x_label, cats, [{ name: s.series, values }])
    return { exhibit, given: { setting: s.id, a: at(cats, i) }, value: frac(at(pcts, i)) }
  },
  render: (_x, g) => fill(byId(BAR_SETTINGS, str(g, 'setting')).share, { a: str(g, 'a') }),
  cellsRead: (x) => chartOf(x).categories.length,
})

const wpBillSplit = V({
  template: 'wp_bill_split',
  variant: 'main',
  stratum: 3,
  format: 'decimal',
  fields: ['people', 'bill', 'tip'],
  steps: 3,
  percent: true,
  reversal: false,
  draw(rng): Drawn {
    const people = rng.int(2, 6)
    const tip = rng.pick([10, 15, 20])
    const step = (100 * people) / gcd(100 * people, 100 + tip)
    const bill = step * rng.int(Math.ceil(2000 / step), Math.floor(20000 / step))
    return { given: { people, bill, tip }, value: frac(bill * (100 + tip), 100 * people * 100) }
  },
  render: (_x, g) => fill(WP.bill_split, { people: String(num(g, 'people')), bill: money(num(g, 'bill')), tip: String(num(g, 'tip')) }),
  cellsRead: () => 0,
})

const wpUnitPrice = V({
  template: 'wp_unit_price',
  variant: 'main',
  stratum: 3,
  format: 'integer',
  fields: ['good', 'size1', 'price1', 'size2', 'price2'],
  steps: 3,
  percent: false,
  reversal: false,
  draw(rng): Drawn {
    const [size1, size2] = rng.shuffle(PACK_SIZES) as [number, number]
    const [c1, c2] = until(() => [2 * rng.int(20, 200), 2 * rng.int(20, 200)] as const, ([a, b]) => a !== b && Math.abs(a - b) <= 120, 'two unit prices')
    return {
      given: { good: rng.pick(GOODS), size1, price1: (c1 * size1) / 100, size2, price2: (c2 * size2) / 100 },
      value: frac(Math.abs(c1 - c2)),
    }
  },
  render: (_x, g) =>
    fill(WP.unit_price, {
      good: str(g, 'good'),
      size1: String(num(g, 'size1')),
      price1: money(num(g, 'price1')),
      size2: String(num(g, 'size2')),
      price2: money(num(g, 'price2')),
    }),
  cellsRead: () => 0,
})

const wpRecipe = V({
  template: 'wp_recipe',
  variant: 'main',
  stratum: 3,
  format: 'fraction',
  fields: ['ingredient', 'people1', 'num', 'den', 'people2'],
  steps: 2,
  percent: false,
  reversal: false,
  draw(rng): Drawn {
    const people1 = rng.pick([2, 3, 4, 5, 6, 8])
    const people2 = until(() => rng.int(2, 12), (p) => p !== people1, 'another number of people')
    const den = rng.int(2, 8)
    const numer = until(() => rng.int(1, den - 1), (x) => gcd(x, den) === 1, 'a reduced numerator')
    return {
      given: { ingredient: rng.pick(INGREDIENTS).id, people1, num: numer, den, people2 },
      value: frac(numer * people2, den * people1),
    }
  },
  render(_x, g) {
    const ing = byId(INGREDIENTS, str(g, 'ingredient'))
    return fill(WP.recipe, {
      people1: String(num(g, 'people1')),
      amount: `${num(g, 'num')}/${num(g, 'den')}`,
      sing: ing.sing,
      pl: ing.pl,
      ingredient: ing.id,
      people2: String(num(g, 'people2')),
    })
  },
  cellsRead: () => 0,
})

// --- stratum 4 -----------------------------------------------------------------------------------

const linePctChange = V({
  template: 'dt_line_pct_change',
  variant: 'main',
  stratum: 4,
  format: 'integer',
  exhibit: 'line',
  fields: ['setting', 'a', 'b'],
  steps: 3,
  percent: true,
  reversal: false,
  draw(rng): Drawn {
    const s = rng.pick(PCT_SETTINGS)
    const n = rng.int(4, 6)
    const cats = run(rng, s.cats, n)
    const [i, j] = twoIndices(rng, n).sort((p, q) => p - q) as [number, number]
    const from = 20 * rng.int(Math.ceil(s.lo / 20), Math.floor(s.hi / 20))
    const pct = until(() => 5 * rng.int(-8, 10), (p) => p !== 0, 'a non-zero change')
    const values = cats.map(() => rng.int(s.lo, s.hi))
    values[i] = from
    values[j] = (from * (100 + pct)) / 100
    const exhibit = chart('line', s.title, s.unit, s.x_label, cats, [{ name: s.series, values }])
    return { exhibit, given: { setting: s.id, a: at(cats, i), b: at(cats, j) }, value: frac(pct) }
  },
  render: (_x, g) => fill(byId(PCT_SETTINGS, str(g, 'setting')).q, { a: str(g, 'a'), b: str(g, 'b') }),
  cellsRead: () => 2,
})

function freqTable(rng: Rng, maxCount: number): { setting: (typeof FREQ_SETTINGS)[number]; exhibit: TableExhibit; values: number[]; counts: number[] } {
  const s = rng.pick(FREQ_SETTINGS)
  const k = rng.int(4, 6)
  const values = Array.from({ length: k }, (_, i) => s.start + i)
  const counts = values.map(() => rng.int(1, maxCount))
  const exhibit = table(
    s.title,
    s.row_header,
    [s.column],
    values.map((v, i) => ({ label: String(v), values: [at(counts, i)] })),
  )
  return { setting: s, exhibit, values, counts }
}

const freqMean = V({
  template: 'dt_freq_mean',
  variant: 'main',
  stratum: 4,
  format: 'fraction',
  exhibit: 'table',
  fields: ['setting'],
  steps: 3,
  percent: false,
  reversal: false,
  draw(rng): Drawn {
    const { setting, exhibit, values, counts } = freqTable(rng, 12)
    const total = values.reduce((acc, v, i) => acc + v * at(counts, i), 0)
    return { exhibit, given: { setting: setting.id }, value: frac(total, sum(counts)) }
  },
  render: (_x, g) => byId(FREQ_SETTINGS, str(g, 'setting')).mean_q,
  cellsRead: (x) => 2 * tableOf(x).rows.length,
})

const twoway = (variant: 'by_row' | 'by_col'): VariantDef =>
  V({
    template: 'dt_twoway_share',
    variant,
    stratum: 4,
    format: 'fraction',
    exhibit: 'table',
    fields: ['setting', 'row', 'column'],
    steps: 2,
    percent: false,
    reversal: false,
    draw(rng): Drawn {
      const s = rng.pick(TWOWAY_SETTINGS)
      const rows = s.rows.map((label) => ({ label, values: s.columns.map(() => rng.int(1, 30)) }))
      const r = rng.int(0, rows.length - 1)
      const c = rng.int(0, s.columns.length - 1)
      const cell = at(at(rows, r).values, c)
      const whole = variant === 'by_row' ? sum(at(rows, r).values) : sum(rows.map((x) => at(x.values, c)))
      return {
        exhibit: table(s.title, s.row_header, s.columns, rows),
        given: { setting: s.id, row: at(s.rows, r), column: at(s.columns, c) },
        value: frac(cell, whole),
      }
    },
    render(_x, g) {
      const s = byId(TWOWAY_SETTINGS, str(g, 'setting'))
      const row = str(g, 'row')
      return fill(variant === 'by_row' ? s.by_row : s.by_col, { row, rowl: lower(row), col: lower(str(g, 'column')) })
    },
    cellsRead: (x) => (variant === 'by_row' ? tableOf(x).columns.length : tableOf(x).rows.length),
  })

const wpFuel = V({
  template: 'wp_fuel',
  variant: 'main',
  stratum: 4,
  format: 'decimal',
  fields: ['rate', 'price', 'distance'],
  steps: 3,
  percent: false,
  reversal: false,
  draw(rng): Drawn {
    const [rate, price, distance] = until(
      () => [rng.int(4, 9), rng.int(110, 230), 10 * rng.int(4, 60)] as const,
      ([r, p, d]) => (d * r * p) % 100 === 0,
      'a trip costing whole cents',
    )
    return { given: { rate, price, distance }, value: frac(distance * rate * price, 10_000) }
  },
  render: (_x, g) => fill(WP.fuel, { rate: String(num(g, 'rate')), price: money(num(g, 'price')), distance: String(num(g, 'distance')) }),
  cellsRead: () => 0,
})

/** Price-change percents of the money templates. */
export const OFF_PCTS = Object.freeze([10, 15, 20, 25, 30, 40])
export const TAX_PCTS = Object.freeze([5, 8, 10, 12, 15, 20])
export const UP_PCTS = Object.freeze([10, 20, 25, 30, 40, 50])
export const DOWN_PCTS = Object.freeze([10, 20, 25, 30, 40])

/**
 * The smallest step s such that s × num / den is whole for every (num, den) of `ratios`: the lcm of
 * den / gcd(den, num). A price in whole cents that is a multiple of s stays whole cents after each.
 */
export function wholeStep(ratios: readonly (readonly [bigint, bigint])[]): bigint {
  const g = (a: bigint, b: bigint): bigint => {
    while (b) [a, b] = [b, a % b]
    return a < 0n ? -a : a
  }
  return ratios.reduce((acc, [n, d]) => {
    const s = d / g(d, n)
    return (acc * s) / g(acc, s)
  }, 1n)
}

/** A whole-cents price in [lo, hi] that is a multiple of `step`; null if there is none. */
function centsFor(rng: Rng, step: bigint, lo: number, hi: number): number | null {
  const st = Number(step)
  const kLo = Math.ceil(lo / st)
  const kHi = Math.floor(hi / st)
  return kLo > kHi ? null : st * rng.int(kLo, kHi)
}

const wpDiscountTax = V({
  template: 'wp_discount_tax',
  variant: 'main',
  stratum: 4,
  format: 'decimal',
  fields: ['thing', 'price', 'off', 'tax'],
  steps: 3,
  percent: true,
  reversal: false,
  draw(rng): Drawn {
    const [off, tax, price] = until(
      () => {
        const o = rng.pick(OFF_PCTS)
        const t = rng.pick(TAX_PCTS)
        const step = wholeStep([
          [BigInt(100 - o), 100n],
          [BigInt((100 - o) * (100 + t)), 10_000n],
        ])
        return [o, t, centsFor(rng, step, 2000, 40_000)] as const
      },
      ([, , p]) => p !== null,
      'a price with a whole-cents result',
    )
    const p = price as number
    return { given: { thing: rng.pick(THINGS), price: p, off, tax }, value: frac(p * (100 - off) * (100 + tax), 1_000_000) }
  },
  render: (_x, g) => fill(WP.discount_tax, { thing: str(g, 'thing'), price: money(num(g, 'price')), off: String(num(g, 'off')), tax: String(num(g, 'tax')) }),
  cellsRead: () => 0,
})

// --- stratum 5 -----------------------------------------------------------------------------------

const freqMedian = V({
  template: 'dt_freq_median',
  variant: 'main',
  stratum: 5,
  format: 'decimal',
  exhibit: 'table',
  fields: ['setting'],
  steps: 3,
  percent: false,
  reversal: false,
  draw(rng): Drawn {
    const { setting, exhibit, values, counts } = freqTable(rng, 9)
    const list = values.flatMap((v, i) => Array.from({ length: at(counts, i) }, () => v))
    const m = list.length
    const value = m % 2 === 1 ? frac(at(list, (m - 1) / 2)) : frac(at(list, m / 2 - 1) + at(list, m / 2), 2)
    return { exhibit, given: { setting: setting.id }, value }
  },
  render: (_x, g) => byId(FREQ_SETTINGS, str(g, 'setting')).median_q,
  cellsRead: (x) => 2 * tableOf(x).rows.length,
})

const missingMean = V({
  template: 'dt_missing_mean',
  variant: 'main',
  stratum: 5,
  format: 'integer',
  exhibit: 'table',
  fields: ['setting', 'missing', 'mean'],
  steps: 3,
  percent: false,
  reversal: false,
  draw(rng): Drawn {
    const s = rng.pick(MISSING_SETTINGS)
    const n = rng.int(5, 7)
    const cats = run(rng, s.cats, n)
    const mean = rng.int(s.lo + 10, s.hi - 10)
    const [shown, missing] = until(
      () => {
        const vs = Array.from({ length: n - 1 }, () => rng.int(s.lo, s.hi))
        return [vs, mean * n - sum(vs)] as const
      },
      ([, m]) => m >= s.lo && m <= s.hi,
      'a missing value in range',
    )
    const exhibit = table(
      s.title,
      s.row_header,
      [s.column],
      shown.map((v, i) => ({ label: at(cats, i), values: [v] })),
    )
    return { exhibit, given: { setting: s.id, missing: at(cats, n - 1), mean }, value: frac(missing) }
  },
  render(x, g) {
    const s = byId(MISSING_SETTINGS, str(g, 'setting'))
    const k = tableOf(x).rows.length
    return fill(s.q, { k: String(k), n: String(k + 1), miss: str(g, 'missing'), mean: String(num(g, 'mean')) })
  },
  cellsRead: (x) => tableOf(x).rows.length,
})

const twoSeries = (variant: 'total_gap' | 'max_gap'): VariantDef =>
  V({
    template: 'dt_two_series',
    variant,
    stratum: 5,
    format: 'integer',
    exhibit: 'line',
    fields: variant === 'total_gap' ? ['setting', 'more', 'less'] : ['setting'],
    steps: 3,
    percent: false,
    reversal: false,
    draw(rng): Drawn {
      const s = rng.pick(TWO_SERIES_SETTINGS)
      const n = rng.int(4, 6)
      const cats = run(rng, s.cats, n)
      const [a, b] = until(
        () => [cats.map(() => rng.int(s.lo, s.hi)), cats.map(() => rng.int(s.lo, s.hi))] as const,
        ([p, q]) => sum(p) !== sum(q) && p.some((v, i) => v !== at(q, i)),
        'two different series',
      )
      const exhibit = chart('line', s.title, s.unit, s.x_label, cats, [
        { name: s.names[0], values: a },
        { name: s.names[1], values: b },
      ])
      if (variant === 'max_gap') return { exhibit, given: { setting: s.id }, value: frac(Math.max(...a.map((v, i) => Math.abs(v - at(b, i))))) }
      const aMore = sum(a) > sum(b)
      return {
        exhibit,
        given: { setting: s.id, more: aMore ? s.names[0] : s.names[1], less: aMore ? s.names[1] : s.names[0] },
        value: frac(Math.abs(sum(a) - sum(b))),
      }
    },
    render(_x, g) {
      const s = byId(TWO_SERIES_SETTINGS, str(g, 'setting'))
      if (variant === 'max_gap') return s.max_q
      return fill(s.total_q, { more: str(g, 'more'), less: str(g, 'less') })
    },
    cellsRead: (x) => 2 * chartOf(x).categories.length,
  })

const wpWorkTogether = V({
  template: 'wp_work_together',
  variant: 'main',
  stratum: 5,
  format: 'integer',
  fields: ['setting', 'a', 'b'],
  steps: 4,
  percent: false,
  reversal: false,
  draw(rng): Drawn {
    const [a, b] = until(() => [rng.int(2, 12), rng.int(2, 12)] as const, ([x, y]) => x !== y && (60 * x * y) % (x + y) === 0, 'two rates')
    return { given: { setting: rng.pick(WORK_SETTINGS).id, a, b }, value: frac(60 * a * b, a + b) }
  },
  render(_x, g) {
    const s = byId(WORK_SETTINGS, str(g, 'setting'))
    return fill(WP.work_together, { machine: s.machine, machines: s.machines, task: s.task, a: String(num(g, 'a')), b: String(num(g, 'b')) })
  },
  cellsRead: () => 0,
})

const wpMixture = V({
  template: 'wp_mixture',
  variant: 'main',
  stratum: 5,
  format: 'integer',
  fields: ['setting', 'x', 'p', 'y', 'q'],
  steps: 3,
  percent: true,
  reversal: false,
  draw(rng): Drawn {
    const s = rng.pick(MIX_SETTINGS)
    const [x, p, y, q] = until(
      () => [rng.int(2, 10), rng.int(s.lo, s.hi), rng.int(2, 10), rng.int(s.lo, s.hi)] as const,
      ([x1, p1, y1, q1]) => p1 !== q1 && (x1 * p1 + y1 * q1) % (x1 + y1) === 0,
      'a whole-percent mixture',
    )
    return { given: { setting: s.id, x, p, y, q }, value: frac(x * p + y * q, x + y) }
  },
  render(_x, g) {
    const s = byId(MIX_SETTINGS, str(g, 'setting'))
    return fill(WP.mixture, { x: String(num(g, 'x')), p: String(num(g, 'p')), y: String(num(g, 'y')), q: String(num(g, 'q')), what: s.what, part: s.part })
  },
  cellsRead: () => 0,
})

// --- stratum 6 -----------------------------------------------------------------------------------

/** Π (100 + pᵢ) as a BigInt. */
export const growthProduct = (pcts: readonly number[]): bigint => pcts.reduce((acc, p) => acc * BigInt(100 + p), 1n)

const compound = (variant: 'forward' | 'reverse'): VariantDef =>
  V({
    template: 'dt_compound_change',
    variant,
    stratum: 6,
    format: 'decimal',
    exhibit: 'bar',
    fields: variant === 'forward' ? ['setting'] : ['setting', 'end'],
    steps: variant === 'forward' ? 4 : 5,
    percent: true,
    reversal: variant === 'reverse',
    draw(rng): Drawn {
      const s = rng.pick(COMPOUND_SETTINGS)
      const k = variant === 'forward' ? rng.int(3, 4) : 3
      const cats = YEARS.slice(0, k)
      const drawPcts = (): number[] => cats.map(() => 5 * until(() => rng.int(-6, 6), (x) => x !== 0, 'a non-zero change'))
      const exhibitOf = (pcts: number[]): ChartExhibit => chart('bar', s.title, COMPOUND_UNIT, COMPOUND_X_LABEL, cats, [{ name: COMPOUND_SERIES, values: pcts }])
      const scale = 100n ** BigInt(k)
      if (variant === 'forward') {
        const pcts = until(
          drawPcts,
          (ps) => {
            const overall = frac(growthProduct(ps) - scale, scale / 100n)
            return overall.mul(frac(100)).isInteger()
          },
          'changes with a two-place overall percent',
        )
        return { exhibit: exhibitOf(pcts), given: { setting: s.id }, value: frac(growthProduct(pcts) - scale, scale / 100n) }
      }
      const [pcts, start] = until(
        () => {
          const ps = drawPcts()
          const step = wholeStep(ps.map((_, j) => [growthProduct(ps.slice(0, j + 1)), 100n ** BigInt(j + 1)] as const))
          return [ps, step > 1000n ? null : centsFor(rng, step, 2000, 30_000)] as const
        },
        ([, st]) => st !== null,
        'changes with a whole-cents start',
      )
      const st = start as number
      const end = Number((BigInt(st) * growthProduct(pcts)) / scale)
      return { exhibit: exhibitOf(pcts), given: { setting: s.id, end }, value: frac(st, 100) }
    },
    render(x, g) {
      const s = byId(COMPOUND_SETTINGS, str(g, 'setting'))
      const c = chartOf(x)
      const k = String(c.categories.length)
      if (variant === 'forward') return fill(COMPOUND_FORWARD_Q, { subject: s.subject, k })
      return fill(COMPOUND_REVERSE_Q, { subject: s.subject, k, last: at(c.categories, c.categories.length - 1), end: money(num(g, 'end')) })
    },
    cellsRead: (x) => chartOf(x).categories.length,
  })

const shareChange = (variant: 'pp' | 'rel'): VariantDef =>
  V({
    template: 'dt_share_change',
    variant,
    stratum: 6,
    format: 'integer',
    exhibit: 'table',
    fields: ['setting', 'category'],
    steps: variant === 'pp' ? 4 : 5,
    percent: true,
    reversal: false,
    draw(rng): Drawn {
      const s = rng.pick(SHARE_SETTINGS)
      const r = rng.int(3, 4)
      const idx = rng
        .shuffle(s.cats.map((_, i) => i))
        .slice(0, r)
        .sort((a, b) => a - b)
      const cats = idx.map((i) => at(s.cats, i))
      const t = rng.int(0, r - 1)
      const [s1, s2] = until(
        () => [5 * rng.int(2, 12), 5 * rng.int(2, 12)] as const,
        ([a, b]) => a !== b && (variant === 'pp' || ((b - a) * 100) % a === 0),
        'two shares',
      )
      const column = (share: number): number[] => {
        const total = 20 * rng.int(5, 20)
        const part = (share * total) / 100
        const rest = partition(rng, total - part, r - 1)
        return cats.map((_, i) => (i === t ? part : at(rest, i < t ? i : i - 1)))
      }
      const y1 = column(s1)
      const y2 = column(s2)
      const rows = cats.map((label, i) => ({ label, values: [at(y1, i), at(y2, i)] }))
      return {
        exhibit: table(s.title, s.row_header, SHARE_COLUMNS, rows),
        given: { setting: s.id, category: at(cats, t) },
        value: variant === 'pp' ? frac(s2 - s1) : frac((s2 - s1) * 100, s1),
      }
    },
    render(_x, g) {
      const s = byId(SHARE_SETTINGS, str(g, 'setting'))
      const part = fill(s.part, { cat: lower(str(g, 'category')) })
      return fill(variant === 'pp' ? SHARE_PP_Q : SHARE_REL_Q, { part, whole: s.whole })
    },
    cellsRead: (x) => 2 * tableOf(x).rows.length,
  })

const wpReversePct = V({
  template: 'wp_reverse_pct',
  variant: 'main',
  stratum: 6,
  format: 'decimal',
  fields: ['thing', 'up', 'down', 'now'],
  steps: 4,
  percent: true,
  reversal: true,
  draw(rng): Drawn {
    const [up, down, start] = until(
      () => {
        const u = rng.pick(UP_PCTS)
        const d = rng.pick(DOWN_PCTS)
        const step = wholeStep([
          [BigInt(100 + u), 100n],
          [BigInt((100 + u) * (100 - d)), 10_000n],
        ])
        return [u, d, centsFor(rng, step, 2000, 40_000)] as const
      },
      ([, , st]) => st !== null,
      'a start price in whole cents',
    )
    const st = start as number
    const now = (st * (100 + up) * (100 - down)) / 10_000
    return { given: { thing: rng.pick(THINGS), up, down, now }, value: frac(st, 100) }
  },
  render: (_x, g) => fill(WP.reverse_pct, { thing: str(g, 'thing'), up: String(num(g, 'up')), down: String(num(g, 'down')), now: money(num(g, 'now')) }),
  cellsRead: () => 0,
})

// --- the table -----------------------------------------------------------------------------------

export const VARIANTS: readonly VariantDef[] = Object.freeze([
  barRead('diff'),
  barRead('total'),
  tableSum('row'),
  tableSum('col'),
  wpChange,
  lineTemp('range'),
  lineTemp('change'),
  tableMean,
  wpTimetable,
  barShare,
  wpBillSplit,
  wpUnitPrice,
  wpRecipe,
  linePctChange,
  freqMean,
  twoway('by_row'),
  twoway('by_col'),
  wpFuel,
  wpDiscountTax,
  freqMedian,
  missingMean,
  twoSeries('total_gap'),
  twoSeries('max_gap'),
  wpWorkTogether,
  wpMixture,
  compound('forward'),
  compound('reverse'),
  shareChange('pp'),
  shareChange('rel'),
  wpReversePct,
])

/** Template ids (the family's facets), in table order. None collides with a quant template id. */
export const QDATA_TEMPLATES: readonly string[] = Object.freeze([...new Set(VARIANTS.map((v) => v.template))])

/** Template ids by stratum, in table order. */
export const TEMPLATES_BY_STRATUM: Readonly<Record<Stratum, readonly string[]>> = Object.freeze(
  Object.fromEntries(([1, 2, 3, 4, 5, 6] as const).map((s) => [s, QDATA_TEMPLATES.filter((t) => VARIANTS.some((v) => v.template === t && v.stratum === s))])) as unknown as Record<Stratum, readonly string[]>,
)

export const variantsOf = (template: string): readonly VariantDef[] => VARIANTS.filter((v) => v.template === template)

/** The variant `template/variant`, or undefined. */
export function variantOf(template: unknown, variant: unknown): VariantDef | undefined {
  return VARIANTS.find((v) => v.template === template && v.variant === variant)
}

/**
 * Near-isomorph sets (M1.14): the variants of a multi-variant template show the same kind of
 * exhibit and differ only in the question, so solving one hands over the method for the others; a
 * session serves at most one of each set. Single-variant templates are their own group (family_id).
 */
export const QDATA_SIBLING_SETS: Readonly<Record<string, readonly string[]>> = Object.freeze({
  bar_read: ['dt_bar_read/diff', 'dt_bar_read/total'],
  table_sum: ['dt_table_sum/row', 'dt_table_sum/col'],
  line_temp: ['dt_line_temp/range', 'dt_line_temp/change'],
  twoway_share: ['dt_twoway_share/by_row', 'dt_twoway_share/by_col'],
  two_series: ['dt_two_series/total_gap', 'dt_two_series/max_gap'],
  compound_change: ['dt_compound_change/forward', 'dt_compound_change/reverse'],
  share_change: ['dt_share_change/pp', 'dt_share_change/rel'],
})

const SIBLING_LABEL_OF: ReadonlyMap<string, string> = new Map(Object.entries(QDATA_SIBLING_SETS).flatMap(([label, ids]) => ids.map((id) => [id, label] as const)))

/** `g:qdata:<label>` for a grouped variant; undefined for a variant that is its own group. */
export function qdataSiblingGroup(template: string, variant: string): string | undefined {
  const label = SIBLING_LABEL_OF.get(`${template}/${variant}`)
  return label === undefined ? undefined : siblingGroupId('qdata', label)
}

/** Every day name (for the verifier's label checks). */
export const ALL_DAYS = DAYS
