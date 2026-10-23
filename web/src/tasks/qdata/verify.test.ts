/**
 * The qdata verifier rejects broken items for the right named reason (G2/G3), and never throws on a
 * well-formed but wrong item (fast-check over random mutations).
 */

import fc from 'fast-check'
import { describe, expect, it } from 'vitest'
import { qdata, type QdataItem } from '.'
import { VARIANTS, variantsOf } from './templates'
import { verifyQdata } from './verify'

function sampleOf(template: string, variant: string, salt = 'tamper'): QdataItem {
  const v = variantsOf(template).find((x) => x.variant === variant)
  if (!v) throw new Error(`no variant ${template}/${variant}`)
  for (let i = 0; i < 5000; i++) {
    const item = qdata.generate(`${salt}-${template}-${variant}-${i}`, { stratum: v.stratum })
    const sp = item.structural_params as { template: string; variant: string }
    if (sp.template === template && sp.variant === variant) return item
  }
  throw new Error(`no sample of ${template}/${variant}`)
}

const clone = <T>(x: T): T => JSON.parse(JSON.stringify(x)) as T
/** The failed check names of a verdict. */
const failed = (item: unknown): string[] => {
  const r = verifyQdata(item as QdataItem)
  return Object.entries(r.checks)
    .filter(([, v]) => v === false)
    .map(([k]) => k)
}

describe('verifyQdata', () => {
  it('accepts a sample of every variant', () => {
    for (const v of VARIANTS) expect(failed(sampleOf(v.template, v.variant)), `${v.template}/${v.variant}`).toEqual([])
  })

  it('rejects a wrong key, a non-canonical key and a loose tolerance', () => {
    for (const v of VARIANTS) {
      const item = sampleOf(v.template, v.variant)
      const wrong = clone(item) as { key: { value: string } }
      wrong.key.value = wrong.key.value === '7' ? '8' : '7'
      expect(failed(wrong), `${v.template}/${v.variant}`).toContain('key_matches_recomputed')
    }
    const item = sampleOf('dt_freq_mean', 'main')
    const loose = clone(item) as { key: { tol: unknown } }
    loose.key.tol = { abs: 0.5 }
    expect(failed(loose)).toContain('tolerance_exact')
    const odd = clone(item) as { key: { value: string } }
    odd.key.value = '04'
    expect(failed(odd)).toContain('key_canonical')
  })

  it('rejects a changed exhibit value (the key no longer follows) and a value off the axis', () => {
    const item = sampleOf('dt_bar_read', 'total')
    const x = clone(item)
    const series = (x.spec.exhibit as unknown as { series: { values: number[] }[] }).series[0] as { values: number[] }
    series.values[0] = (series.values[0] as number) + 1
    expect(failed(x)).toContain('key_matches_recomputed')
    const off = clone(item)
    const s2 = (off.spec.exhibit as unknown as { series: { values: number[] }[]; y_max: number }).series[0] as { values: number[] }
    s2.values[0] = (off.spec.exhibit as unknown as { y_max: number }).y_max + 1
    expect(failed(off)).toContain('exhibit_shape')
  })

  it('rejects swapped references (a "how many more" that is negative) and a stem that does not match', () => {
    const item = sampleOf('dt_bar_read', 'diff')
    const x = clone(item) as unknown as { spec: { given: Record<string, string> } }
    const { a, b } = x.spec.given
    x.spec.given.a = b as string
    x.spec.given.b = a as string
    const f = failed(x)
    expect(f).toContain('rule_more_is_positive')
    expect(f).toContain('stem_matches_given')
    const y = clone(item)
    ;(y.spec as { stem: string }).stem = `${item.spec.stem} `
    expect(failed(y)).toContain('stem_matches_given')
  })

  it('rejects a reference to a category that is not on the exhibit', () => {
    const item = sampleOf('dt_twoway_share', 'by_row')
    const x = clone(item) as unknown as { spec: { given: Record<string, string> } }
    x.spec.given.column = 'Juice'
    expect(failed(x)).toContain('spec_fits_template')
  })

  it('rejects broken structure: an unknown variant, a wrong exhibit kind, extra or missing given fields', () => {
    const item = sampleOf('dt_line_temp', 'change')
    const a = clone(item) as { structural_params: unknown }
    a.structural_params = { template: 'dt_line_temp', variant: 'mean' }
    expect(failed(a)).toEqual(['known_template_variant'])
    const b = clone(item) as { spec: { exhibit: { kind: string } } }
    b.spec.exhibit.kind = 'bar'
    expect(failed(b)).toContain('exhibit_shape')
    const c = clone(item) as unknown as { spec: { given: Record<string, unknown> } }
    c.spec.given.total = 12
    expect(failed(c)).toContain('given_fields')
    const d = clone(sampleOf('wp_change', 'main')) as unknown as { spec: Record<string, unknown> }
    d.spec.exhibit = clone(item.spec.exhibit)
    expect(failed(d)).toContain('spec_fields')
  })

  it('rejects labels that are not the setting\'s, and an axis that is not axisFor(values)', () => {
    const item = sampleOf('dt_bar_share', 'main')
    const x = clone(item) as unknown as { spec: { exhibit: { categories: string[]; title: string; y_max: number; y_step: number } } }
    x.spec.exhibit.title = 'Something else'
    expect(failed(x)).toContain('rule_exhibit_is_setting')
    const y = clone(item) as unknown as { spec: { exhibit: { y_max: number; y_step: number } } }
    y.spec.exhibit.y_max += y.spec.exhibit.y_step
    expect(failed(y)).toContain('rule_axis_matches')
  })

  it('rejects money that is not whole cents and an input format the answer does not fit', () => {
    const item = sampleOf('wp_discount_tax', 'main')
    const x = clone(item) as unknown as { spec: { given: Record<string, number> } }
    x.spec.given.price = (x.spec.given.price as number) + 1
    const f = failed(x)
    expect(f.some((k) => k === 'rule_sale_price_whole_cents' || k === 'rule_final_price_whole_cents')).toBe(true)
    const mean = sampleOf('dt_table_mean', 'main')
    const y = clone(mean)
    const t = y.spec.exhibit as unknown as { rows: { values: number[] }[]; columns: string[] }
    const c = t.columns.indexOf(String(mean.spec.given.column))
    ;(t.rows[0] as { values: number[] }).values[c] = ((t.rows[0] as { values: number[] }).values[c] as number) + 1
    expect(failed(y)).toContain('answer_fits_format')
  })

  it('rejects a changed format, hint, prior, stratum, time or sibling group', () => {
    const item = sampleOf('dt_freq_median', 'main')
    const cases: [string, (x: Record<string, unknown>) => void][] = [
      ['input_format_is_variant', (x) => ((x.spec as Record<string, unknown>).input_format = 'integer')],
      ['hint_matches', (x) => ((x.spec as Record<string, unknown>).hint = 'Type anything.')],
      ['prior_matches', (x) => ((x.difficulty as Record<string, unknown>).b_prior = 2.1)],
      ['stratum_is_template', (x) => (x.stratum = 4)],
      ['time_matches', (x) => (x.expected_time_s = 1)],
      ['sibling_group_matches', (x) => (x.sibling_group = 'g:qdata:bar_read')],
      ['features_match', (x) => (((x.difficulty as Record<string, unknown>).features as Record<string, unknown>).steps = 9)],
    ]
    for (const [check, mutate] of cases) {
      const x = clone(item) as unknown as Record<string, unknown>
      mutate(x)
      expect(failed(x), check).toContain(check)
    }
  })

  it('never throws on a mutated item (property)', () => {
    const items = VARIANTS.map((v) => sampleOf(v.template, v.variant, 'fuzz'))
    const leafPaths = (v: unknown, path: (string | number)[] = []): (string | number)[][] =>
      Array.isArray(v)
        ? v.flatMap((x, i) => leafPaths(x, [...path, i]))
        : typeof v === 'object' && v !== null
          ? Object.entries(v).flatMap(([k, x]) => leafPaths(x, [...path, k]))
          : [path]
    fc.assert(
      fc.property(
        fc.nat(items.length - 1),
        fc.nat(10_000),
        fc.oneof(fc.integer({ min: -1000, max: 1000 }), fc.string({ maxLength: 6 }), fc.constant(null), fc.boolean(), fc.constant([]), fc.constant({})),
        (i, pick, value) => {
          const item = clone(items[i] as QdataItem)
          const paths = leafPaths({ spec: item.spec, key: item.key, structural_params: item.structural_params })
          const path = paths[pick % paths.length] as (string | number)[]
          let o = item as unknown as Record<string | number, unknown>
          for (const k of path.slice(0, -1)) o = o[k] as Record<string | number, unknown>
          o[path[path.length - 1] as string | number] = value
          const r = verifyQdata(item)
          expect(typeof r.ok).toBe('boolean')
        },
      ),
      { numRuns: 1500 },
    )
  })
})
