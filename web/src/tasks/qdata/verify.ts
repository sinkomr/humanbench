/**
 * The qdata verifier (gates G2/G3, DESIGN §4.1–4.2 "Math"). It trusts nothing the generator
 * computed: from the item alone it checks the template variant and the shape of the spec, that the
 * exhibit is the setting's (title, unit, labels, a consecutive run of categories, integer values on
 * the value axis that `axisFor` gives), that the question's references exist and are distinct, the
 * template's rules (the ones that make the question well posed: a positive "how many more", a later
 * point after an earlier one, whole cents at every price a person would see), that the stem is the
 * one rendered from the exhibit and `given`, and that the key equals the answer recomputed FORWARD
 * from the exhibit and `given` by exact {@link Fraction} arithmetic (the generator mostly built the
 * data around a chosen answer, so the two routes differ):
 *
 * - sums, differences, ranges and means straight from the values; a percent of a total as
 *   value × 100 / total; percent change as (new − old) / old × 100;
 * - a weighted mean as Σ value·count / Σ count; a median by walking the cumulative counts to the
 *   middle position(s); a conditional share as cell / (row or column total);
 * - money in exact cents (change, a bill with a tip split n ways, unit prices per 100 g, fuel cost,
 *   discount then tax, two price changes undone by dividing by both factors); a timetable by
 *   minutes since midnight; work together as 60 / (1/a + 1/b); a mixture as the total part over
 *   the total volume;
 * - compound change as Π(1 + pᵢ/100) − 1 (forward) or end / Π(1 + pᵢ/100) (backward); a share's
 *   change in percentage points (share₂ − share₁) and relatively (share₂ / share₁ − 1).
 *
 * It also checks the key (canonical rational, tolerance `{ abs: 0 }`), that the answer fits the
 * input format (an integer item has an integer key; a decimal item has at most two decimal
 * places), the hint, the features, prior, stratum (the template's and `stratumOfB`), expected time,
 * time cap and sibling group. Failure reasons are the names of the failed checks; template rules
 * appear as `rule_<name>`. Never throws on a well-formed item. The bank's `hb.gen.qdata.verify` is
 * the same check in Python.
 */

import { canonicalJson, type Stratum } from '../ids'
import { verdict, type ItemInstance, type VerifyResult } from '../family'
import { powerTimeLimit, stratumOfB } from '../priors'
import { Fraction } from '../quant/fraction'
import { HINTS } from '../quant/kit'
import { QDATA_STRATA, featuresOf, type QdataKey } from './gen'
import { QDATA_PROVENANCE, QDATA_SD_PRIOR, qdataBPrior, qdataExpectedTime } from './prior'
import {
  BAR_SETTINGS,
  CATEGORY_LISTS,
  COMPOUND_SERIES,
  COMPOUND_SETTINGS,
  COMPOUND_UNIT,
  COMPOUND_X_LABEL,
  DAY_ROW_HEADER,
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
  SHARE_SETTINGS,
  SHOP_ITEMS,
  TABLE_SETTINGS,
  TEMP_SERIES,
  TEMP_SETTINGS,
  TEMP_UNIT,
  THINGS,
  TWO_SERIES_SETTINGS,
  TWOWAY_SETTINGS,
  VEHICLES,
  WORK_SETTINGS,
  YEARS,
} from './settings'
import { exhibitProblems, type ChartExhibit, type QdataExhibit, type QdataGiven, type QdataSpec, type TableExhibit } from './spec'
import { DOWN_PCTS, OFF_PCTS, TAX_PCTS, UP_PCTS, axisFor, qdataSiblingGroup, variantOf, type VariantDef } from './templates'

type Rules = Record<string, boolean>
export interface Solved {
  readonly value: Fraction
  readonly rules: Rules
}

const F = (n: number | bigint, d: number | bigint = 1): Fraction => Fraction.of(n, d)
const HUNDRED = F(100)
const total = (xs: readonly number[]): number => xs.reduce((s, v) => s + v, 0)
const isInt = (v: unknown): v is number => typeof v === 'number' && Number.isSafeInteger(v)

class Bad extends Error {}
const need = (ok: boolean, what: string): void => {
  if (!ok) throw new Bad(what)
}
const s_ = (g: QdataGiven, k: string): string => {
  const v = g[k]
  need(typeof v === 'string', `given.${k} is text`)
  return v as string
}
const n_ = (g: QdataGiven, k: string): number => {
  const v = g[k]
  need(isInt(v), `given.${k} is an integer`)
  return v as number
}
function setting<T extends { readonly id: string }>(xs: readonly T[], g: QdataGiven): T {
  const id = s_(g, 'setting')
  const s = xs.find((x) => x.id === id)
  need(s !== undefined, 'setting is known')
  return s as T
}
const chartOf = (x: QdataExhibit | undefined, kind: 'bar' | 'line'): ChartExhibit => {
  need(x !== undefined && x.kind === kind, `exhibit is a ${kind} chart`)
  return x as ChartExhibit
}
const tableOf = (x: QdataExhibit | undefined): TableExhibit => {
  need(x !== undefined && x.kind === 'table', 'exhibit is a table')
  return x as TableExhibit
}
/** `cats` is a consecutive run of the named category list, of length lo … hi. */
function isRun(cats: readonly string[], list: string, lo: number, hi: number): boolean {
  const xs = CATEGORY_LISTS[list] ?? []
  const start = xs.indexOf(cats[0] ?? '')
  return cats.length >= lo && cats.length <= hi && start >= 0 && cats.every((c, i) => xs[start + i] === c)
}
const sameList = (a: readonly string[], b: readonly string[]): boolean => a.length === b.length && a.every((x, i) => x === b[i])
const sameAxis = (c: ChartExhibit): boolean => {
  const want = axisFor(c.series.flatMap((s) => s.values))
  return c.y_min === want.y_min && c.y_max === want.y_max && c.y_step === want.y_step
}
/** The values of the single series of a chart, by category. */
const one = (c: ChartExhibit): readonly number[] => {
  need(c.series.length === 1, 'the chart has one series')
  return (c.series[0] as { values: readonly number[] }).values
}
const indexIn = (cats: readonly string[], label: string): number => {
  const i = cats.indexOf(label)
  need(i >= 0, `${label} is a category of the exhibit`)
  return i
}
const col = (t: TableExhibit, c: number): number[] => t.rows.map((r) => r.values[c] as number)
/** An exact amount of cents is whole. */
const wholeCents = (x: Fraction): boolean => x.isInteger()
/** The factor of a p% change, (100 + p) / 100. */
const pctFactor = (p: number): Fraction => F(100 + p, 100)

type Solver = (x: QdataExhibit | undefined, g: QdataGiven) => Solved

function barChecks(c: ChartExhibit, g: QdataGiven, lo: number, hi: number): Rules {
  const s = setting(BAR_SETTINGS, g)
  return {
    exhibit_is_setting: c.title === s.title && c.unit === s.unit && c.x_label === s.x_label && c.series[0]?.name === s.series,
    categories_run: isRun(c.categories, s.cats, lo, hi),
    axis_matches: sameAxis(c),
  }
}

function tableDayChecks(t: TableExhibit, g: QdataGiven, lo: number, hi: number): Rules {
  const s = setting(TABLE_SETTINGS, g)
  return {
    exhibit_is_setting: t.title === s.title && t.row_header === DAY_ROW_HEADER && sameList(t.columns, s.columns),
    rows_run: isRun(
      t.rows.map((r) => r.label),
      'days',
      lo,
      hi,
    ),
    values_non_negative: t.rows.every((r) => r.values.every((v) => v >= 0)),
  }
}

function freqRows(t: TableExhibit, g: QdataGiven): { values: number[]; counts: number[]; rules: Rules } {
  const s = setting(FREQ_SETTINGS, g)
  const values = t.rows.map((r) => (/^(0|[1-9][0-9]*)$/.test(r.label) ? Number(r.label) : Number.NaN))
  const counts = t.rows.map((r) => r.values[0] as number)
  return {
    values,
    counts,
    rules: {
      exhibit_is_setting: t.title === s.title && t.row_header === s.row_header && sameList(t.columns, [s.column]),
      values_consecutive_from_start: t.rows.length >= 4 && t.rows.length <= 6 && values.every((v, i) => v === s.start + i),
      counts_positive: counts.every((c) => c >= 1),
    },
  }
}

function twowaySolve(x: QdataExhibit | undefined, g: QdataGiven, by: 'row' | 'col'): Solved {
  const t = tableOf(x)
  const s = setting(TWOWAY_SETTINGS, g)
  const labels = t.rows.map((row) => row.label)
  const r = indexIn(labels, s_(g, 'row'))
  const c = indexIn(t.columns, s_(g, 'column'))
  const cell = t.rows[r]?.values[c] as number
  const whole = by === 'row' ? total(t.rows[r]?.values ?? []) : total(col(t, c))
  need(whole > 0, 'a positive total')
  return {
    value: F(cell, whole),
    rules: {
      exhibit_is_setting: t.title === s.title && t.row_header === s.row_header && sameList(t.columns, s.columns) && sameList(labels, s.rows),
      counts_positive: t.rows.every((row) => row.values.every((v) => v >= 1)),
    },
  }
}

function twoSeriesChecks(c: ChartExhibit, g: QdataGiven): Rules {
  const s = setting(TWO_SERIES_SETTINGS, g)
  const names = c.series.map((x) => x.name)
  return {
    exhibit_is_setting: c.title === s.title && c.unit === s.unit && c.x_label === s.x_label && sameList(names, s.names),
    categories_run: isRun(c.categories, s.cats, 4, 6),
    axis_matches: sameAxis(c),
    values_in_range: c.series.every((x) => x.values.every((v) => v >= s.lo && v <= s.hi)),
  }
}

function compoundChecks(x: QdataExhibit | undefined, g: QdataGiven, lo: number, hi: number): { pcts: readonly number[]; rules: Rules } {
  const c = chartOf(x, 'bar')
  const s = setting(COMPOUND_SETTINGS, g)
  const pcts = one(c)
  const k = c.categories.length
  return {
    pcts,
    rules: {
      exhibit_is_setting: c.title === s.title && c.unit === COMPOUND_UNIT && c.x_label === COMPOUND_X_LABEL && c.series[0]?.name === COMPOUND_SERIES,
      categories_are_years: k >= lo && k <= hi && sameList(c.categories, YEARS.slice(0, k)),
      axis_matches: sameAxis(c),
      changes_non_zero_multiples_of_5: pcts.every((p) => p !== 0 && p % 5 === 0 && p >= -30 && p <= 30),
    },
  }
}

function shareChecks(x: QdataExhibit | undefined, g: QdataGiven): { s1: Fraction; s2: Fraction; rules: Rules } {
  const t = tableOf(x)
  const s = setting(SHARE_SETTINGS, g)
  const labels = t.rows.map((r) => r.label)
  const i = indexIn(labels, s_(g, 'category'))
  const share = (c: number): Fraction => {
    const all = total(col(t, c))
    need(all > 0, 'a positive year total')
    return F(t.rows[i]?.values[c] as number, all)
  }
  const s1 = share(0)
  const s2 = share(1)
  const order = labels.map((l) => s.cats.indexOf(l))
  return {
    s1,
    s2,
    rules: {
      exhibit_is_setting: t.title === s.title && t.row_header === s.row_header && sameList(t.columns, SHARE_COLUMNS),
      rows_from_setting_in_order: labels.length >= 3 && labels.length <= 4 && order.every((k, j) => k >= 0 && (j === 0 || k > (order[j - 1] as number))),
      counts_positive: t.rows.every((r) => r.values.every((v) => v >= 1)),
      share_changed: !s1.eq(s2),
    },
  }
}

const SOLVERS: Readonly<Record<string, Solver>> = {
  'dt_bar_read/diff': (x, g) => {
    const c = chartOf(x, 'bar')
    const vs = one(c)
    const a = indexIn(c.categories, s_(g, 'a'))
    const b = indexIn(c.categories, s_(g, 'b'))
    const value = F(vs[a] as number).sub(F(vs[b] as number))
    return { value, rules: { ...barChecks(c, g, 4, 6), references_distinct: a !== b, more_is_positive: value.sign() > 0 } }
  },
  'dt_bar_read/total': (x, g) => {
    const c = chartOf(x, 'bar')
    return { value: F(total(one(c))), rules: barChecks(c, g, 3, 5) }
  },
  'dt_table_sum/row': (x, g) => {
    const t = tableOf(x)
    const r = indexIn(
      t.rows.map((row) => row.label),
      s_(g, 'row'),
    )
    return { value: F(total(t.rows[r]?.values ?? [])), rules: tableDayChecks(t, g, 3, 5) }
  },
  'dt_table_sum/col': (x, g) => {
    const t = tableOf(x)
    const c = indexIn(t.columns, s_(g, 'column'))
    return { value: F(total(col(t, c))), rules: tableDayChecks(t, g, 3, 5) }
  },
  'wp_change/main': (_x, g) => {
    const paid = F(n_(g, 'note') * 100)
    const change = paid.sub(F(n_(g, 'price1'))).sub(F(n_(g, 'price2')))
    return {
      value: change.div(HUNDRED),
      rules: {
        known_words: NAMES.includes(s_(g, 'name')) && SHOP_ITEMS.includes(s_(g, 'item1')) && SHOP_ITEMS.includes(s_(g, 'item2')),
        items_distinct: s_(g, 'item1') !== s_(g, 'item2'),
        note_is_a_note: NOTES.includes(n_(g, 'note')),
        prices_in_range: [n_(g, 'price1'), n_(g, 'price2')].every((p) => p >= 105 && p <= 995),
        change_is_positive: change.sign() > 0,
      },
    }
  },
  'dt_line_temp/range': (x, g) => {
    const c = chartOf(x, 'line')
    const vs = one(c)
    const s = setting(TEMP_SETTINGS, g)
    const hi = vs.reduce((m, v) => (v > m ? v : m), -Infinity)
    const lo = vs.reduce((m, v) => (v < m ? v : m), Infinity)
    return {
      value: F(hi - lo),
      rules: {
        exhibit_is_setting: c.title === s.title && c.unit === TEMP_UNIT && c.x_label === s.x_label && c.series[0]?.name === TEMP_SERIES,
        categories_run: isRun(c.categories, s.cats, 5, 7),
        axis_matches: sameAxis(c),
        range_is_positive: hi > lo,
      },
    }
  },
  'dt_line_temp/change': (x, g) => {
    const c = chartOf(x, 'line')
    const vs = one(c)
    const s = setting(TEMP_SETTINGS, g)
    const a = indexIn(c.categories, s_(g, 'a'))
    const b = indexIn(c.categories, s_(g, 'b'))
    const value = F(vs[b] as number).sub(F(vs[a] as number))
    return {
      value,
      rules: {
        exhibit_is_setting: c.title === s.title && c.unit === TEMP_UNIT && c.x_label === s.x_label && c.series[0]?.name === TEMP_SERIES,
        categories_run: isRun(c.categories, s.cats, 4, 7),
        axis_matches: sameAxis(c),
        from_before_to: a < b,
        change_is_not_zero: !value.isZero(),
      },
    }
  },
  'dt_table_mean/main': (x, g) => {
    const t = tableOf(x)
    const c = indexIn(t.columns, s_(g, 'column'))
    const xs = col(t, c)
    return { value: F(total(xs), xs.length), rules: tableDayChecks(t, g, 4, 6) }
  },
  'wp_timetable/main': (_x, g) => {
    const [dh, dm, ah, am] = [n_(g, 'dep_h'), n_(g, 'dep_m'), n_(g, 'arr_h'), n_(g, 'arr_m')]
    const dep = dh * 60 + dm
    const arr = ah * 60 + am
    return {
      value: F(arr - dep),
      rules: {
        known_vehicle: VEHICLES.includes(s_(g, 'vehicle')),
        clock_times: [dh, ah].every((h) => h >= 0 && h <= 23) && [dm, am].every((m) => m >= 0 && m <= 59),
        arrives_later_same_day: arr > dep,
        crosses_an_hour: ah > dh,
      },
    }
  },
  'dt_bar_share/main': (x, g) => {
    const c = chartOf(x, 'bar')
    const vs = one(c)
    const a = indexIn(c.categories, s_(g, 'a'))
    return { value: F(vs[a] as number).mul(HUNDRED).div(F(total(vs))), rules: { ...barChecks(c, g, 3, 5), values_positive: vs.every((v) => v > 0) } }
  },
  'wp_bill_split/main': (_x, g) => {
    const people = n_(g, 'people')
    const bill = n_(g, 'bill')
    const tip = n_(g, 'tip')
    need(people > 0, 'people')
    const withTip = F(bill).mul(pctFactor(tip))
    const each = withTip.div(F(people))
    return {
      value: each.div(HUNDRED),
      rules: {
        people_in_range: people >= 2 && people <= 6,
        tip_in_list: [10, 15, 20].includes(tip),
        bill_in_range: bill >= 2000 && bill <= 20_000,
        total_whole_cents: wholeCents(withTip),
        share_whole_cents: wholeCents(each),
      },
    }
  },
  'wp_unit_price/main': (_x, g) => {
    const [s1, s2] = [n_(g, 'size1'), n_(g, 'size2')]
    need(s1 > 0 && s2 > 0, 'sizes')
    const u1 = F(n_(g, 'price1') * 100, s1)
    const u2 = F(n_(g, 'price2') * 100, s2)
    return {
      value: u1.sub(u2).abs(),
      rules: {
        known_good: GOODS.includes(s_(g, 'good')),
        sizes_distinct_and_listed: s1 !== s2 && PACK_SIZES.includes(s1) && PACK_SIZES.includes(s2),
        unit_prices_whole_cents: wholeCents(u1) && wholeCents(u2),
        unit_prices_differ: !u1.eq(u2),
      },
    }
  },
  'wp_recipe/main': (_x, g) => {
    const [p1, nu, de, p2] = [n_(g, 'people1'), n_(g, 'num'), n_(g, 'den'), n_(g, 'people2')]
    need(de > 0 && p1 > 0, 'positive denominators')
    const perPerson = F(nu, de).div(F(p1))
    return {
      value: perPerson.mul(F(p2)),
      rules: {
        known_ingredient: INGREDIENTS.some((i) => i.id === s_(g, 'ingredient')),
        proper_reduced_amount: nu >= 1 && nu < de && de <= 8 && F(nu, de).d === BigInt(de),
        people_differ: p1 !== p2 && p1 >= 2 && p2 >= 2 && p2 <= 12,
      },
    }
  },
  'dt_line_pct_change/main': (x, g) => {
    const c = chartOf(x, 'line')
    const vs = one(c)
    const s = setting(PCT_SETTINGS, g)
    const a = indexIn(c.categories, s_(g, 'a'))
    const b = indexIn(c.categories, s_(g, 'b'))
    const from = vs[a] as number
    need(from > 0, 'the starting value is positive')
    const change = F((vs[b] as number) - from)
    return {
      value: change.div(F(from)).mul(HUNDRED),
      rules: {
        exhibit_is_setting: c.title === s.title && c.unit === s.unit && c.x_label === s.x_label && c.series[0]?.name === s.series,
        categories_run: isRun(c.categories, s.cats, 4, 6),
        axis_matches: sameAxis(c),
        values_positive: vs.every((v) => v > 0),
        from_before_to: a < b,
        change_is_not_zero: !change.isZero(),
      },
    }
  },
  'dt_freq_mean/main': (x, g) => {
    const { values, counts, rules } = freqRows(tableOf(x), g)
    let weighted = F(0)
    values.forEach((v, i) => {
      weighted = weighted.add(F(v).mul(F(counts[i] as number)))
    })
    const n = total(counts)
    need(n > 0, 'a positive count')
    return { value: weighted.div(F(n)), rules }
  },
  'dt_twoway_share/by_row': (x, g) => twowaySolve(x, g, 'row'),
  'dt_twoway_share/by_col': (x, g) => twowaySolve(x, g, 'col'),
  'wp_fuel/main': (_x, g) => {
    const [rate, price, distance] = [n_(g, 'rate'), n_(g, 'price'), n_(g, 'distance')]
    const litres = F(distance).div(HUNDRED).mul(F(rate))
    const cents = litres.mul(F(price))
    return {
      value: cents.div(HUNDRED),
      rules: {
        rate_in_range: rate >= 4 && rate <= 9,
        price_in_range: price >= 110 && price <= 230,
        distance_in_range: distance >= 40 && distance <= 600 && distance % 10 === 0,
        cost_whole_cents: wholeCents(cents),
      },
    }
  },
  'wp_discount_tax/main': (_x, g) => {
    const [price, off, tax] = [n_(g, 'price'), n_(g, 'off'), n_(g, 'tax')]
    const sale = F(price).mul(pctFactor(-off))
    const final = sale.mul(pctFactor(tax))
    return {
      value: final.div(HUNDRED),
      rules: {
        known_thing: THINGS.includes(s_(g, 'thing')),
        percents_listed: OFF_PCTS.includes(off) && TAX_PCTS.includes(tax),
        price_in_range: price >= 2000 && price <= 40_000,
        sale_price_whole_cents: wholeCents(sale),
        final_price_whole_cents: wholeCents(final),
      },
    }
  },
  'dt_freq_median/main': (x, g) => {
    const { values, counts, rules } = freqRows(tableOf(x), g)
    const n = total(counts)
    need(n > 0, 'a positive count')
    // The k-th smallest (1-based), walking the cumulative counts.
    const kth = (k: number): number => {
      let seen = 0
      for (let i = 0; i < values.length; i++) {
        seen += counts[i] as number
        if (seen >= k) return values[i] as number
      }
      throw new Bad('position beyond the data')
    }
    return { value: F(kth(Math.floor((n + 1) / 2)) + kth(Math.floor(n / 2) + 1), 2), rules }
  },
  'dt_missing_mean/main': (x, g) => {
    const t = tableOf(x)
    const s = setting(MISSING_SETTINGS, g)
    const all = [...t.rows.map((r) => r.label), s_(g, 'missing')]
    const shown = col(t, 0)
    const value = F(n_(g, 'mean')).mul(F(all.length)).sub(F(total(shown)))
    return {
      value,
      rules: {
        exhibit_is_setting: t.title === s.title && t.row_header === s.row_header && sameList(t.columns, [s.column]),
        missing_follows_the_rows: isRun(all, s.cats, 5, 7),
        values_in_range: shown.every((v) => v >= s.lo && v <= s.hi),
        missing_in_range: value.cmp(F(s.lo)) >= 0 && value.cmp(F(s.hi)) <= 0,
      },
    }
  },
  'dt_two_series/total_gap': (x, g) => {
    const c = chartOf(x, 'line')
    const rules = twoSeriesChecks(c, g)
    const more = c.series.findIndex((s) => s.name === s_(g, 'more'))
    const less = c.series.findIndex((s) => s.name === s_(g, 'less'))
    need(more >= 0 && less >= 0, 'the named series are on the chart')
    const value = F(total(c.series[more]?.values ?? [])).sub(F(total(c.series[less]?.values ?? [])))
    return { value, rules: { ...rules, references_distinct: more !== less, more_is_positive: value.sign() > 0 } }
  },
  'dt_two_series/max_gap': (x, g) => {
    const c = chartOf(x, 'line')
    const rules = twoSeriesChecks(c, g)
    need(c.series.length === 2, 'two series')
    const [a, b] = c.series as unknown as [{ values: readonly number[] }, { values: readonly number[] }]
    let best = F(0)
    a.values.forEach((v, i) => {
      const d = F(v).sub(F(b.values[i] as number)).abs()
      if (d.cmp(best) > 0) best = d
    })
    return { value: best, rules: { ...rules, gap_is_positive: best.sign() > 0 } }
  },
  'wp_work_together/main': (_x, g) => {
    const [a, b] = [n_(g, 'a'), n_(g, 'b')]
    need(a > 0 && b > 0, 'positive hours')
    const jobsPerHour = F(1, a).add(F(1, b))
    return {
      value: F(60).div(jobsPerHour),
      rules: {
        known_setting: WORK_SETTINGS.some((w) => w.id === s_(g, 'setting')),
        hours_distinct: a !== b,
        hours_in_range: [a, b].every((h) => h >= 2 && h <= 12),
      },
    }
  },
  'wp_mixture/main': (_x, g) => {
    const s = setting(MIX_SETTINGS, g)
    const [x1, p, y1, q] = [n_(g, 'x'), n_(g, 'p'), n_(g, 'y'), n_(g, 'q')]
    need(x1 + y1 > 0, 'a volume')
    const part = F(x1 * p, 100).add(F(y1 * q, 100))
    return {
      value: part.div(F(x1 + y1)).mul(HUNDRED),
      rules: {
        volumes_in_range: [x1, y1].every((v) => v >= 2 && v <= 10),
        strengths_in_range: [p, q].every((v) => v >= s.lo && v <= s.hi),
        strengths_differ: p !== q,
      },
    }
  },
  'dt_compound_change/forward': (x, g) => {
    const { pcts, rules } = compoundChecks(x, g, 3, 4)
    const growth = pcts.reduce((acc, p) => acc.mul(pctFactor(p)), F(1))
    return { value: growth.sub(F(1)).mul(HUNDRED), rules }
  },
  'dt_compound_change/reverse': (x, g) => {
    const { pcts, rules } = compoundChecks(x, g, 3, 3)
    const end = n_(g, 'end')
    const start = pcts.reduceRight((acc, p) => acc.div(pctFactor(p)), F(end))
    // Every year-end amount a person would see is whole cents, so no rounding is involved.
    let v = start
    let whole = wholeCents(start)
    for (const p of pcts) {
      v = v.mul(pctFactor(p))
      whole = whole && wholeCents(v)
    }
    return {
      value: start.div(HUNDRED),
      rules: { ...rules, every_amount_whole_cents: whole, start_in_range: start.cmp(F(2000)) >= 0 && start.cmp(F(30_000)) <= 0 },
    }
  },
  'dt_share_change/pp': (x, g) => {
    const { s1, s2, rules } = shareChecks(x, g)
    return { value: s2.sub(s1).mul(HUNDRED), rules }
  },
  'dt_share_change/rel': (x, g) => {
    const { s1, s2, rules } = shareChecks(x, g)
    return { value: s2.div(s1).sub(F(1)).mul(HUNDRED), rules }
  },
  'wp_reverse_pct/main': (_x, g) => {
    const [up, down, now] = [n_(g, 'up'), n_(g, 'down'), n_(g, 'now')]
    need(down < 100, 'a cut below 100%')
    const middle = F(now).div(pctFactor(-down))
    const start = middle.div(pctFactor(up))
    return {
      value: start.div(HUNDRED),
      rules: {
        known_thing: THINGS.includes(s_(g, 'thing')),
        percents_listed: UP_PCTS.includes(up) && DOWN_PCTS.includes(down),
        start_whole_cents: wholeCents(start),
        middle_whole_cents: wholeCents(middle),
        start_in_range: start.cmp(F(2000)) >= 0 && start.cmp(F(40_000)) <= 0,
      },
    }
  },
}

/** The answer of a spec by the verifier's route and the template rules, or null if the spec does not fit its variant. */
export function qdataSolve(v: VariantDef, spec: QdataSpec): Solved | null {
  const solver = SOLVERS[`${v.template}/${v.variant}`]
  if (!solver) return null
  try {
    return solver(spec.exhibit, spec.given)
  } catch (e) {
    if (e instanceof Bad || e instanceof TypeError || e instanceof RangeError) return null
    throw e
  }
}

/** The variants with a solver (every variant of the table; tested). */
export const SOLVED_VARIANTS: readonly string[] = Object.freeze(Object.keys(SOLVERS))

/** True iff `x` fits the input format: an integer, at most two decimal places, or any fraction. */
export function fitsFormat(x: Fraction, format: string): boolean {
  if (format === 'integer') return x.isInteger()
  if (format === 'decimal') return x.mul(HUNDRED).isInteger()
  return format === 'fraction'
}

const SPEC_FIELDS_WP = 'given,hint,input_format,stem'
const SPEC_FIELDS_DT = 'exhibit,given,hint,input_format,stem'

export function verifyQdata(item: ItemInstance<QdataSpec, QdataKey>): VerifyResult {
  const sp = item.structural_params as { template?: unknown; variant?: unknown } | null
  const spOk = typeof sp === 'object' && sp !== null && !Array.isArray(sp) && Object.keys(sp).sort().join(',') === 'template,variant'
  const v = spOk ? variantOf(sp.template, sp.variant) : undefined
  if (!v) return verdict({ known_template_variant: false })
  const spec = item.spec as unknown as Record<string, unknown>
  const given = spec.given
  const shape = {
    known_template_variant: true,
    facet_is_template: item.facet === v.template,
    spec_fields: Object.keys(spec).sort().join(',') === (v.exhibit ? SPEC_FIELDS_DT : SPEC_FIELDS_WP),
    exhibit_shape: v.exhibit ? exhibitProblems(spec.exhibit).length === 0 && (spec.exhibit as { kind?: unknown }).kind === v.exhibit : true,
    given_fields:
      typeof given === 'object' &&
      given !== null &&
      !Array.isArray(given) &&
      Object.keys(given).sort().join(',') === [...v.fields].sort().join(',') &&
      Object.values(given).every((x) => typeof x === 'string' || isInt(x)),
    input_format_is_variant: spec.input_format === v.format,
    hint_matches: spec.hint === HINTS[v.format],
    stem_is_text: typeof spec.stem === 'string',
  }
  if (!Object.values(shape).every((b) => b)) return verdict(shape)

  const solved = qdataSolve(v, item.spec)
  if (solved === null) return verdict({ ...shape, spec_fits_template: false })
  const rules = Object.fromEntries(Object.entries(solved.rules).map(([k, b]) => [`rule_${k}`, b]))

  let stemOk = false
  try {
    stemOk = v.render(item.spec.exhibit, item.spec.given) === item.spec.stem
  } catch {
    stemOk = false
  }

  const key = item.key as unknown
  const keyFields = typeof key === 'object' && key !== null && !Array.isArray(key) && Object.keys(key).sort().join(',') === 'tol,value'
  const k = key as { value?: unknown; tol?: unknown }
  const keyValue = keyFields && typeof k.value === 'string' ? Fraction.parseCanonical(k.value) : null
  const tolExact = keyFields && canonicalJson((k.tol ?? null) as never) === canonicalJson({ abs: 0 })

  let featuresOk = false
  let priorOk = false
  let timeOk = false
  try {
    const features = featuresOf(v, item.spec.exhibit, item.spec.given, solved.value)
    featuresOk = canonicalJson(features) === canonicalJson(item.difficulty.features as never)
    const b = qdataBPrior(features)
    priorOk =
      item.difficulty.b_prior === b &&
      item.difficulty.sd_prior === QDATA_SD_PRIOR &&
      item.difficulty.provenance === QDATA_PROVENANCE &&
      item.params.model === '2pl' &&
      item.params.b === b
    timeOk = item.expected_time_s === qdataExpectedTime(item.spec.stem, features.cells_read, v.steps) && item.time_limit_s === powerTimeLimit(item.expected_time_s)
  } catch {
    featuresOk = false
  }
  const group = qdataSiblingGroup(v.template, v.variant)
  return verdict({
    ...shape,
    spec_fits_template: true,
    ...rules,
    stem_matches_given: stemOk,
    key_fields: keyFields,
    key_canonical: keyValue !== null,
    tolerance_exact: tolExact,
    key_matches_recomputed: keyValue !== null && keyValue.eq(solved.value),
    answer_fits_format: fitsFormat(solved.value, v.format),
    features_match: featuresOk,
    prior_matches: priorOk,
    stratum_is_template: item.stratum === v.stratum && (QDATA_STRATA as readonly Stratum[]).includes(item.stratum),
    stratum_is_band_of_b: typeof item.difficulty.b_prior === 'number' && Number.isFinite(item.difficulty.b_prior) && stratumOfB(item.difficulty.b_prior) === item.stratum,
    time_matches: timeOk,
    no_options: item.options_count === undefined,
    sibling_group_matches: item.sibling_group === (group ?? item.family_id),
  })
}
