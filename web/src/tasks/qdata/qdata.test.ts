import { describe, expect, it } from 'vitest'
import { MalformedResponseError, NUMERIC_ITEM_TYPE, validateItemInstance } from '../family'
import { stratumOfB } from '../priors'
import { QUANT_TEMPLATES } from '../quant/templates'
import { Fraction } from '../quant/fraction'
import { runFamilyProperties, type FamilyPropertyOptions } from '../testing'
import { qdata, qdataSpecLeaksKey, specProblems, type QdataItem, type QdataKey, type QdataResponse, type QdataSpec } from '.'
import { QDATA_PRIOR, anchorOf, qdataBPrior, qdataExpectedTime } from './prior'
import { exhibitProblems } from './spec'
import { QDATA_SIBLING_SETS, QDATA_TEMPLATES, TEMPLATES_BY_STRATUM, VARIANTS, axisFor, qdataSiblingGroup, variantsOf } from './templates'
import { fill } from './settings'
import { SOLVED_VARIANTS, qdataSolve } from './verify'

/** A11: family_id = the template variant, so the structural space is the variants. */
const VARIANT_SPACE = { min: 0.002, reason: `${VARIANTS.length} template variants (A11: family_id = qdata template variant)` }

const OPTS: FamilyPropertyOptions<QdataSpec, QdataKey, QdataResponse> = {
  specLeaksKey: qdataSpecLeaksKey,
  familyIdRatio: VARIANT_SPACE,
  correctResponse: (item) => item.key.value,
  // The key + 1: the tolerance is { abs: 0 }.
  incorrectResponse: (item) => (Fraction.parseCanonical(item.key.value) as Fraction).add(Fraction.ONE).toString(),
  // Typed entries are text (M1.F2): a number, an array or an object is malformed.
  malformedResponses: (item) => [Number(item.key.value), [item.key.value], { value: item.key.value }],
}

const variantKey = (item: QdataItem): string => {
  const sp = item.structural_params as { template: string; variant: string }
  return `${sp.template}/${sp.variant}`
}

/** A generated item of the variant `template/variant`. */
export function sampleOf(template: string, variant: string, salt = 'sample'): QdataItem {
  const v = variantsOf(template).find((x) => x.variant === variant)
  if (!v) throw new Error(`no variant ${template}/${variant}`)
  for (let i = 0; i < 5000; i++) {
    const item = qdata.generate(`${salt}-${template}-${variant}-${i}`, { stratum: v.stratum })
    if (variantKey(item) === `${template}/${variant}`) return item
  }
  throw new Error(`no sample of ${template}/${variant}`)
}

describe('qdata family', () => {
  it('passes runFamilyProperties at n = 10,000 across strata 1–6', () => {
    const r = runFamilyProperties(qdata, { ...OPTS, strata: qdata.strata })
    expect(r.n).toBe(10_000)
    expect(r.distinctItemIds).toBe(10_000)
    expect(Object.values(r.strataCounts).every((c) => c >= 1_666 && c <= 1_667)).toBe(true)
    expect(r.distinctFamilyIds).toBe(VARIANTS.length)
    expect(r.distinctContents).toBeGreaterThan(9_500)
    expect(r.bPrior.min).toBeGreaterThanOrEqual(-2.2)
    expect(r.bPrior.max).toBeLessThanOrEqual(3.5)
  }, 300_000)

  it('passes with the family choosing the stratum (natural pool, n = 2,000)', () => {
    const r = runFamilyProperties(qdata, { ...OPTS, n: 2_000, seedPrefix: 'free-' })
    for (const s of [1, 2, 3, 4, 5, 6] as const) expect(r.strataCounts[s]).toBeGreaterThan(250)
  }, 180_000)

  it('has 16–24 templates, prefixed dt_/wp_, none a quant template id, each in one stratum', () => {
    expect(QDATA_TEMPLATES.length).toBeGreaterThanOrEqual(16)
    expect(QDATA_TEMPLATES.length).toBeLessThanOrEqual(24)
    for (const t of QDATA_TEMPLATES) {
      expect(t).toMatch(/^(dt|wp)_[a-z_]+$/)
      expect(QUANT_TEMPLATES).not.toContain(t)
      expect(new Set(variantsOf(t).map((v) => v.stratum)).size, t).toBe(1)
      expect(variantsOf(t).every((v) => (v.exhibit !== undefined) === t.startsWith('dt_')), t).toBe(true)
    }
    expect(qdata.facets).toEqual(QDATA_TEMPLATES)
    const ids = VARIANTS.map((v) => `${v.template}/${v.variant}`)
    expect(new Set(ids).size).toBe(ids.length)
    expect([...SOLVED_VARIANTS].sort()).toEqual([...ids].sort())
  })

  it('reaches ≥ 3 exclusion units (sibling groups) in every stratum', () => {
    for (const s of [1, 2, 3, 4, 5, 6] as const) {
      const groups = new Set(VARIANTS.filter((v) => v.stratum === s).map((v) => qdataSiblingGroup(v.template, v.variant) ?? `${v.template}/${v.variant}`))
      expect(groups.size, `stratum ${s}`).toBeGreaterThanOrEqual(3)
      expect(TEMPLATES_BY_STRATUM[s].length).toBeGreaterThanOrEqual(3)
    }
  })

  it('groups the variants of a multi-variant template, and only those (pinned)', () => {
    expect(QDATA_SIBLING_SETS).toEqual({
      bar_read: ['dt_bar_read/diff', 'dt_bar_read/total'],
      table_sum: ['dt_table_sum/row', 'dt_table_sum/col'],
      line_temp: ['dt_line_temp/range', 'dt_line_temp/change'],
      twoway_share: ['dt_twoway_share/by_row', 'dt_twoway_share/by_col'],
      two_series: ['dt_two_series/total_gap', 'dt_two_series/max_gap'],
      compound_change: ['dt_compound_change/forward', 'dt_compound_change/reverse'],
      share_change: ['dt_share_change/pp', 'dt_share_change/rel'],
    })
    for (const t of QDATA_TEMPLATES) {
      const grouped = variantsOf(t).map((v) => qdataSiblingGroup(v.template, v.variant))
      if (variantsOf(t).length > 1) expect(new Set(grouped).size, t).toBe(1)
      else expect(grouped, t).toEqual([undefined])
    }
  })

  it('every variant generates, verifies and is solved by the verifier route', () => {
    for (const v of VARIANTS) {
      for (let k = 0; k < 5; k++) {
        const item = sampleOf(v.template, v.variant, `solve-${k}`)
        expect(item.stratum).toBe(v.stratum)
        expect(item.spec.input_format).toBe(v.format)
        expect(qdataSolve(v, item.spec)?.value.toString(), variantKey(item)).toBe(item.key.value)
        expect(qdata.verify(item).ok, `${variantKey(item)}: ${qdata.verify(item).reason}`).toBe(true)
        expect(specProblems(item.spec)).toEqual([])
      }
    }
  })

  it('is a 2PL numeric-entry item on QR (A9) with an exact key { abs: 0 }', () => {
    const item = qdata.generate('shape', { stratum: 3 })
    expect(item.axis).toBe('QR')
    expect(item.item_type).toBe(NUMERIC_ITEM_TYPE)
    expect(item.options_count).toBeUndefined()
    expect(item.params).toEqual({ model: '2pl', a: 1, b: item.difficulty.b_prior })
    expect(validateItemInstance(item, qdata)).toEqual([])
    for (let i = 0; i < 600; i++) {
      const it = qdata.generate(`fmt-${i}`)
      expect(it.key.tol).toEqual({ abs: 0 })
      const x = Fraction.parseCanonical(it.key.value) as Fraction
      if (it.spec.input_format === 'integer') expect(x.isInteger(), it.item_id).toBe(true)
      if (it.spec.input_format === 'decimal') expect(x.mul(Fraction.of(100)).isInteger(), it.item_id).toBe(true)
    }
  })

  it('keeps every exhibit drawable: integers on the axis, ≤ 4 columns × ≤ 6 rows, 3–6 bars, 4–7 points', () => {
    for (let i = 0; i < 1500; i++) {
      const it = qdata.generate(`draw-${i}`)
      const x = it.spec.exhibit
      if (!x) continue
      expect(exhibitProblems(x), it.item_id).toEqual([])
      if (x.kind !== 'table') {
        expect(axisFor(x.series.flatMap((s) => s.values))).toEqual({ y_min: x.y_min, y_max: x.y_max, y_step: x.y_step })
        expect((x.y_max - x.y_min) / x.y_step).toBeLessThanOrEqual(8)
      }
      // No category label is a bare number that could be read as a value (frequency tables excepted).
      if (x.kind === 'table' && it.facet !== 'dt_freq_mean' && it.facet !== 'dt_freq_median') for (const r of x.rows) expect(r.label).not.toMatch(/^\d+$/)
    }
  })

  it('the prior keeps b inside the template stratum band and E[T] > 0 (all features at their extremes)', () => {
    for (const v of VARIANTS) {
      for (const cells of [0, 2, 14]) {
        for (const flags of [false, true]) {
          const f = {
            template: v.template,
            variant: v.variant,
            stratum: v.stratum,
            steps: v.steps,
            cells_read: cells,
            percent: v.percent,
            non_integer: flags,
            negatives: flags,
            reversal: v.reversal,
          }
          const b = qdataBPrior(f)
          expect(stratumOfB(b), `${v.template}/${v.variant}`).toBe(v.stratum)
          expect(Math.abs(b - anchorOf(v.stratum))).toBeLessThan(0.5)
        }
      }
    }
    expect(Object.keys(QDATA_PRIOR.terms)).toEqual(['stratum', 'steps', 'cells_read', 'percent', 'non_integer', 'negatives', 'reversal'])
    expect(qdataExpectedTime('one two three', 0, 1)).toBeCloseTo(25 + (4 * 3) / 50 + 10, 12)
  })

  it('fills placeholders with digits in their names and refuses a missing one', () => {
    expect(fill('{a1} and {b_2}', { a1: 'x', b_2: 'y' })).toBe('x and y')
    expect(() => fill('{a}', {})).toThrow(RangeError)
  })

  it('stems have no leftover placeholder, no clinical words, and say the unit or format asked for', () => {
    for (let i = 0; i < 1500; i++) {
      const it = qdata.generate(`stem-${i}`)
      expect(it.spec.stem).not.toMatch(/[{}]/)
      if (it.spec.input_format === 'decimal' && it.facet !== 'dt_freq_median' && it.facet !== 'dt_compound_change') expect(it.spec.stem).toMatch(/in dollars to the cent\?$/)
      if (it.spec.input_format === 'fraction') expect(it.spec.stem).toMatch(/fraction in lowest terms/)
    }
  })

  it('pins the family_ids of a few variants (parity vectors for the bank twin)', () => {
    // The bank's tests/gen/test_qdata.py pins the same values (one hash in both repos, A11).
    expect(qdata.familyIdOf({ template: 'dt_bar_read', variant: 'diff' })).toBe(FAMILY_ID_VECTORS['dt_bar_read/diff'])
    expect(qdata.familyIdOf({ template: 'wp_change', variant: 'main' })).toBe(FAMILY_ID_VECTORS['wp_change/main'])
    expect(qdata.familyIdOf({ template: 'dt_share_change', variant: 'rel' })).toBe(FAMILY_ID_VECTORS['dt_share_change/rel'])
  })
})

describe('scoring', () => {
  it('accepts every equivalent typed form of the key and rejects a near miss', () => {
    const money = sampleOf('wp_change', 'main')
    const x = Fraction.parseCanonical(money.key.value) as Fraction
    const cents = Number((x.n * 100n) / x.d)
    const dollars = `${Math.floor(cents / 100)}.${String(cents % 100).padStart(2, '0')}`
    for (const r of [money.key.value, dollars, `$${dollars}`, ` ${dollars} `]) expect(qdata.score(money, r).correct, r).toBe(1)
    expect(qdata.score(money, `${Math.floor(cents / 100)}.${String((cents + 1) % 100).padStart(2, '0')}`).correct).toBe(0)
    const pct = sampleOf('dt_bar_share', 'main')
    expect(qdata.score(pct, `${pct.key.value}%`).correct).toBe(1)
    const neg = Array.from({ length: 400 }, (_, i) => qdata.generate(`neg-${i}`, { stratum: 2 })).find((it) => it.key.value.startsWith('-'))
    if (neg) expect(qdata.score(neg, `−${neg.key.value.slice(1)}`).correct).toBe(1)
  })

  it('scores an unparseable entry 0 and throws MalformedResponseError on a non-text response', () => {
    const item = qdata.generate('score-bad')
    expect(qdata.score(item, 'abc').correct).toBe(0)
    expect(qdata.score(item, '').correct).toBe(0)
    for (const r of [42, null, undefined, {}, [], true]) expect(() => qdata.score(item, r as unknown as string)).toThrow(MalformedResponseError)
  })
})

/** family_id of a few variants: the TS cyrb128 over canonical JSON (A11); the bank pins the same. */
const FAMILY_ID_VECTORS: Readonly<Record<string, string>> = {
  'dt_bar_read/diff': 'f:qdata:070bcf89482c',
  'wp_change/main': 'f:qdata:9534cedd662c',
  'dt_share_change/rel': 'f:qdata:b0a35fa980ec',
}
