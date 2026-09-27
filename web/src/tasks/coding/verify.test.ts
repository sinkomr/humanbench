import { describe, expect, it } from 'vitest'
import { validateItemInstance, type AnyFamily } from '../family'
import { CODING_SYMBOLS, coding, codingStructure, verifyCoding, type CodingItem } from '.'

type Mutable = { -readonly [K in keyof CodingItem]: unknown }

const base = coding.generate('verify-negatives')

/** A deep copy of the base block with `f` applied. */
function tamper(f: (x: Mutable & { spec: Record<string, unknown>; key: Record<string, unknown> }) => void): CodingItem {
  const x = JSON.parse(JSON.stringify(base)) as Mutable & { spec: Record<string, unknown>; key: Record<string, unknown> }
  f(x)
  return x as unknown as CodingItem
}

/** The failed checks of `verifyCoding(item)` (an ok verdict gives []). */
function failed(item: CodingItem): string[] {
  const v = verifyCoding(item)
  return Object.entries(v.checks)
    .filter(([, ok]) => ok === false)
    .map(([k]) => k)
}

const seq = (x: { spec: Record<string, unknown> }): string[] => x.spec.sequence as string[]
const legend = (x: { spec: Record<string, unknown> }): { digit: number; symbol: string }[] =>
  x.spec.legend as { digit: number; symbol: string }[]
const table = (x: { key: Record<string, unknown> }): Record<string, unknown> => x.key.table as Record<string, unknown>

/** A position whose neighbours both differ from `glyph`, other than i. */
function freeSlot(s: readonly string[], glyph: string, not: number): number {
  for (let j = 1; j < s.length - 1; j++) if (j !== not && Math.abs(j - not) > 1 && s[j - 1] !== glyph && s[j + 1] !== glyph && s[j] !== glyph) return j
  throw new Error('no free slot')
}

describe('verifyCoding (M1.11): each rule rejects a hand-built bad block', () => {
  it('accepts the untouched block', () => {
    expect(verifyCoding(base)).toMatchObject({ ok: true, reason: 'ok' })
    expect(verifyCoding(base).checks).toMatchObject({ min_count: 22, max_count: 23 })
  })

  it('key_bijection: a repeated digit, a digit out of range, a non-integer', () => {
    const dup = tamper((x) => (table(x).ring = table(x).cross))
    expect(failed(dup)).toContain('key_bijection')
    expect(verifyCoding(dup).reason).toMatch(/key_bijection/)
    expect(failed(tamper((x) => (table(x).ring = 0)))).toContain('key_bijection')
    expect(failed(tamper((x) => (table(x).ring = 10)))).toContain('key_bijection')
    expect(failed(tamper((x) => (table(x).ring = 2.5)))).toContain('key_bijection')
    expect(failed(tamper((x) => (table(x).ring = '3')))).toContain('key_bijection')
  })

  it('key_well_formed: a missing or unknown glyph, an extra key field', () => {
    expect(failed(tamper((x) => delete table(x).ring))).toContain('key_well_formed')
    expect(failed(tamper((x) => (table(x).star = 5)))).toContain('key_well_formed')
    expect(failed(tamper((x) => (x.key.answers = [1])))).toContain('key_well_formed')
    expect(failed(tamper((x) => (x.key = { digits: table(x) })))).toContain('key_well_formed')
  })

  it('legend_matches_key: two legend cells swapped (the legend no longer shows the key)', () => {
    const bad = tamper((x) => {
      const l = legend(x)
      const a = l[0] as { symbol: string }
      const b = l[1] as { symbol: string }
      ;[a.symbol, b.symbol] = [b.symbol, a.symbol]
    })
    expect(failed(bad)).toEqual(['legend_matches_key'])
  })

  it('legend_matches_key: the key swapped under an unchanged legend', () => {
    const bad = tamper((x) => {
      const t = table(x)
      ;[t.ring, t.cross] = [t.cross, t.ring]
    })
    expect(failed(bad)).toEqual(['legend_matches_key'])
  })

  it('legend_digits_in_order / legend_glyphs_bijective / legend_well_formed', () => {
    expect(failed(tamper((x) => legend(x).reverse()))).toContain('legend_digits_in_order')
    expect(failed(tamper((x) => ((legend(x)[0] as { symbol: string }).symbol = (legend(x)[1] as { symbol: string }).symbol)))).toContain(
      'legend_glyphs_bijective',
    )
    expect(failed(tamper((x) => ((legend(x)[0] as { symbol: string }).symbol = 'star')))).toContain('legend_glyphs_bijective')
    expect(failed(tamper((x) => legend(x).pop()))).toContain('legend_well_formed')
    expect(failed(tamper((x) => (x.spec.legend = 'ring=1')))).toContain('legend_well_formed')
  })

  it('no key leakage beyond the legend: extra spec fields, extra legend fields, digits in the stream', () => {
    // A per-stimulus digit list is exactly the leak this rule exists for.
    const digits = tamper((x) => (x.spec.digits = seq(x).map((s) => table(x)[s])))
    expect(failed(digits)).toEqual(['spec_fields_exact'])
    expect(failed(tamper((x) => (x.spec.hint = 'ring is 1')))).toEqual(['spec_fields_exact'])
    expect(failed(tamper((x) => delete x.spec.duration_s))).toContain('spec_fields_exact')
    const cell = tamper((x) => ((legend(x)[0] as Record<string, unknown>).next = 3))
    expect(failed(cell)).toContain('legend_well_formed')
    // A digit in place of a glyph id.
    const inStream = tamper((x) => (seq(x)[10] = String(table(x)[seq(x)[10] as string])))
    expect(failed(inStream)).toContain('sequence_glyph_ids_only')
    const numeric = tamper((x) => ((x.spec.sequence as unknown[])[10] = 4))
    expect(failed(numeric)).toContain('sequence_glyph_ids_only')
  })

  it('no_immediate_repeats: a glyph moved next to itself', () => {
    const bad = tamper((x) => {
      const s = seq(x)
      // Swap s[j] into slot 1 where s[j] === s[0], keeping counts: pick j with s[j] = s[0].
      const j = s.findIndex((g, i) => i > 3 && g === s[0])
      ;[s[1], s[j]] = [s[j] as string, s[1] as string]
      x.structural_params = codingStructure(s)
    })
    expect(failed(bad)).toContain('no_immediate_repeats')
    expect(failed(bad)).not.toContain('counts_balanced')
  })

  it('counts_balanced: one glyph replaced by another (24 vs 21), without creating a repeat', () => {
    const bad = tamper((x) => {
      const s = seq(x)
      const counts = CODING_SYMBOLS.map((g) => s.filter((y) => y === g).length)
      const hi = CODING_SYMBOLS[counts.indexOf(23)] as string
      const lo = CODING_SYMBOLS[counts.indexOf(22)] as string
      // Replace one `lo` by `hi` where neither neighbour is `hi`.
      const i = s.findIndex((g, k) => g === lo && s[k - 1] !== hi && s[k + 1] !== hi)
      s[i] = hi
      x.structural_params = codingStructure(s)
    })
    expect(failed(bad)).toEqual(['counts_balanced'])
    expect(verifyCoding(bad).checks).toMatchObject({ min_count: 21, max_count: 24 })
  })

  it('counts_balanced: a glyph missing from the stream', () => {
    const bad = tamper((x) => {
      const s = seq(x)
      const gone = s[0] as string
      for (let i = 0; i < s.length; i++) {
        if (s[i] !== gone) continue
        const alt = CODING_SYMBOLS.find((g) => g !== gone && g !== s[i - 1] && g !== s[i + 1]) as string
        s[i] = alt
      }
      x.structural_params = codingStructure(s)
    })
    expect(failed(bad)).toContain('counts_balanced')
  })

  it('sequence_length: 199 or 201 stimuli', () => {
    expect(failed(tamper((x) => seq(x).pop()))).toContain('sequence_length')
    const long = tamper((x) => {
      const s = seq(x)
      s.push(CODING_SYMBOLS.find((g) => g !== s.at(-1)) as string)
    })
    expect(failed(long)).toContain('sequence_length')
  })

  it('structure_matches: structural_params of another stream, or not recomputed after an edit', () => {
    expect(failed(tamper((x) => (x.structural_params = coding.generate('other').structural_params)))).toEqual(['structure_matches'])
    const moved = tamper((x) => {
      const s = seq(x)
      const g = s[0] as string
      const j = freeSlot(s, g, 0)
      const i = s.findIndex((y, k) => k > 0 && y !== g && s[k - 1] !== s[j] && s[k + 1] !== s[j] && y !== s[j])
      ;[s[i], s[j]] = [s[j] as string, s[i] as string]
    })
    expect(failed(moved)).toContain('structure_matches')
  })

  it('window_matches: a 60 s block, a wrong time limit or expected time', () => {
    expect(failed(tamper((x) => (x.spec.duration_s = 60)))).toEqual(['window_matches'])
    expect(failed(tamper((x) => (x.time_limit_s = 120)))).toEqual(['window_matches'])
    expect(failed(tamper((x) => delete x.time_limit_s))).toEqual(['window_matches'])
    expect(failed(tamper((x) => (x.expected_time_s = 45)))).toEqual(['window_matches'])
  })

  it('difficulty_matches / params_match / stratum_matches / identity_matches', () => {
    const d = base.difficulty
    expect(failed(tamper((x) => (x.difficulty = { ...d, b_prior: 0.5 })))).toEqual(['difficulty_matches'])
    expect(failed(tamper((x) => (x.difficulty = { ...d, features: { ...d.features, n_symbols: 8 } })))).toEqual(['difficulty_matches'])
    expect(failed(tamper((x) => (x.difficulty = { ...d, sd_prior: 2 })))).toEqual(['difficulty_matches'])
    expect(failed(tamper((x) => (x.params = { ...base.params, lam: 0.3 })))).toEqual(['params_match'])
    expect(failed(tamper((x) => (x.params = { ...base.params, sigma: 0.05 })))).toEqual(['params_match'])
    expect(failed(tamper((x) => (x.params = { model: '2pl', a: 1, b: 0 })))).toEqual(['params_match'])
    expect(failed(tamper((x) => (x.stratum = 4)))).toEqual(['stratum_matches'])
    expect(failed(tamper((x) => (x.axis = 'RT')))).toEqual(['identity_matches'])
    expect(failed(tamper((x) => (x.item_type = 'span')))).toEqual(['identity_matches'])
    expect(failed(tamper((x) => (x.options_count = 9)))).toEqual(['identity_matches'])
  })

  it('malformed items fail without throwing', () => {
    for (const bad of [
      tamper((x) => ((x as Mutable).spec = null)),
      tamper((x) => ((x as Mutable).key = null)),
      tamper((x) => (x.spec.sequence = 'ring,cross')),
      tamper((x) => (x.spec.legend = [null, 1, 'x'])),
      tamper((x) => (x.difficulty = null)),
      tamper((x) => (x.params = null)),
    ]) {
      const v = verifyCoding(bad)
      expect(v.ok).toBe(false)
    }
  })

  it('every tampered block above is still a structurally valid instance where the rule is coding-specific', () => {
    // The coding rules catch what the generic contract cannot: a swapped legend is a valid instance.
    const bad = tamper((x) => {
      const l = legend(x)
      ;[(l[0] as { symbol: string }).symbol, (l[1] as { symbol: string }).symbol] = [(l[1] as { symbol: string }).symbol, (l[0] as { symbol: string }).symbol]
    })
    expect(validateItemInstance(bad, coding as unknown as AnyFamily)).toEqual([])
    expect(verifyCoding(bad).ok).toBe(false)
  })
})
