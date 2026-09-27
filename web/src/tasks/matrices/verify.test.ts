import { describe, expect, it } from 'vitest'
import { maskOf, type Cell, type RuleSet } from './grammar'
import {
  EXAMPLE1_CHAIN,
  EXAMPLE1_KEY,
  EXAMPLE1_RULES,
  EXAMPLE1_STAR,
  EXAMPLE1_VISIBLE,
  cell,
  handItem,
  specOf,
  tamper,
  withCell,
} from './fixtures'
import { matrices, type MatrixItem } from '.'

/** Example 1 with a RAVEN-FAIR chain of options, the key at index 2. */
const OPTIONS: readonly Cell[] = [EXAMPLE1_CHAIN[3], EXAMPLE1_CHAIN[1], EXAMPLE1_KEY, EXAMPLE1_CHAIN[5], EXAMPLE1_CHAIN[2], EXAMPLE1_CHAIN[4]] as Cell[]
const GOOD = handItem(EXAMPLE1_VISIBLE, OPTIONS, 2, EXAMPLE1_RULES)

const failed = (item: MatrixItem): string[] => {
  const v = matrices.verify(item)
  expect(v.ok).toBe(false)
  return v.reason.replace(/^failed: /, '').split(', ')
}

describe('matrices verify: a hand-built §14.6 example 1', () => {
  it('accepts example 1 with a RAVEN-FAIR option tree', () => {
    const v = matrices.verify(GOOD)
    expect(v.reason).toBe('ok')
    expect(v.checks.method).toBe('rule_enumeration')
    expect(v.checks.modal_argmax).toEqual([0, 4]) // chain nodes 3 and 2 (square, small, 2 and 3 objects)
    expect(v.checks.distractor_violations).toEqual([
      ['shape', 'size', 'count'],
      ['size'],
      ['shape', 'size', 'count'],
      ['shape', 'size'],
      ['shape', 'size', 'count'],
    ])
  })

  it('scores the chosen option index', () => {
    expect(matrices.score(GOOD, 2)).toEqual({ correct: 1 })
    expect(matrices.score(GOOD, 0)).toEqual({ correct: 0 })
    expect(matrices.score(GOOD, 2.5)).toEqual({ correct: 0 })
    expect(matrices.score(GOOD, -1)).toEqual({ correct: 0 })
  })
})

describe('matrices verify rejects (one test per failure reason)', () => {
  it('malformed specs: spec_well_formed', () => {
    const bad = (f: (s: Record<string, unknown>) => void): MatrixItem => tamper(GOOD, (x) => f(x.spec as Record<string, unknown>))
    const cases: MatrixItem[] = [
      bad((s) => ((s.grid as unknown[][])[0]![0] = { ...(s.grid as Record<string, unknown>[][])[0]![0], shape: 'star' })),
      bad((s) => ((s.grid as unknown[][])[2]!.push((s.grid as unknown[][])[1]![2]))), // a 9th cell
      bad((s) => ((s.grid as unknown[][]).pop())),
      bad((s) => ((s.options as Record<string, unknown>[])[0]!.positions = [4, 3])),
      bad((s) => ((s.options as Record<string, unknown>[])[0]!.positions = [9])),
      bad((s) => ((s.options as Record<string, unknown>[])[0]!.positions = [])),
      bad((s) => ((s.options as Record<string, unknown>[])[0]!.orientation = 30)),
      bad((s) => ((s.options as Record<string, unknown>[])[0]!.label = 'x')),
      bad((s) => delete s.options),
      bad((s) => (s.hint = 2)),
    ]
    for (const c of cases) expect(failed(c)).toEqual(['spec_well_formed'])
    expect(matrices.verify(tamper(GOOD, (x) => (x.spec = null))).reason).toMatch(/spec_well_formed/)
    expect(matrices.verify(tamper(GOOD, (x) => (x.key = null))).reason).toMatch(/malformed/)
  })

  it('five options: six_options', () => {
    const five = handItem(EXAMPLE1_VISIBLE, OPTIONS.slice(0, 5), 2, EXAMPLE1_RULES)
    expect(failed(five)).toContain('six_options')
    expect(failed(tamper(GOOD, (x) => (x.options_count = 5)))).toEqual(['six_options'])
  })

  it('a key index out of range: key_in_range', () => {
    for (const index of [6, -1, 1.5]) expect(failed(tamper(GOOD, (x) => (x.key = { index })))).toContain('key_in_range')
  })

  it('an attribute no rule fits: rules_consistent', () => {
    const colors = [0, 1, 3, 2, 0, 1, 3, 3]
    const visible = EXAMPLE1_VISIBLE.map((c, i) => withCell(c, { color: colors[i] as number }))
    const item = handItem(visible, OPTIONS, 2, EXAMPLE1_RULES)
    expect(failed(item)).toContain('rules_consistent')
    expect(failed(item)).toContain('unique_prediction')
  })

  it('two rule assignments predicting different cells: unique_prediction', () => {
    // Colors (0,1,2), (0,1,2), (1,2,?): progression+1 predicts black, distribution predicts white.
    const colors = [0, 1, 2, 0, 1, 2, 1, 2]
    const visible = EXAMPLE1_VISIBLE.map((c, i) => withCell(c, { color: colors[i] as number }))
    const key = withCell(EXAMPLE1_KEY, { color: 3 })
    const options = OPTIONS.map((o) => withCell(o, { color: 3 }))
    options[2] = key
    const item = handItem(visible, options, 2, { ...EXAMPLE1_RULES, color: 'progression+1' })
    const f = failed(item)
    expect(f).toContain('unique_prediction')
    expect(f).not.toContain('rules_consistent')
    expect(f).not.toContain('structure_matches')
  })

  it('a count pattern luring to another number of objects: unique_prediction', () => {
    // Position xor predicts {0,1,6,7} (4 objects); every count is 2, so "constant count" says 2.
    const base = cell('square', 'small', 'black', 45, [4])
    const sets = [[0, 1], [1, 2], [0, 2], [3, 4], [4, 5], [3, 5], [6, 7], [0, 1]]
    const visible = sets.map((p) => withCell(base, { positions: p }))
    const key = withCell(base, { positions: [0, 1, 6, 7] })
    const options = [
      key,
      withCell(key, { positions: [0, 1, 6] }),
      withCell(key, { size: 1 }),
      withCell(key, { positions: [0, 6] }),
      withCell(key, { positions: [0, 1, 6], shape: 2 }),
      withCell(key, { positions: [0, 6], color: 0 }),
    ]
    const rules: RuleSet = { shape: 'constant', size: 'constant', color: 'constant', orientation: 'constant', count: 'derived', position: 'xor' }
    const f = failed(handItem(visible, options, 0, rules))
    expect(f).toContain('unique_prediction')
    expect(f).not.toContain('structure_matches')
    expect(f).not.toContain('rules_consistent')
  })

  it('a key that is not the predicted cell: key_matches_prediction', () => {
    const f = failed(tamper(GOOD, (x) => (x.key = { index: 0 })))
    expect(f).toContain('key_matches_prediction')
    expect(f).toContain('structure_matches')
  })

  it('two equal distractors: options_distinct', () => {
    const options = [...OPTIONS]
    options[5] = options[1] as Cell
    expect(failed(handItem(EXAMPLE1_VISIBLE, options, 2, EXAMPLE1_RULES))).toContain('options_distinct')
  })

  it('a second option equal to the predicted cell: unique_correct, distractors_violate_rules', () => {
    const options = [...OPTIONS]
    options[5] = EXAMPLE1_KEY
    const f = failed(handItem(EXAMPLE1_VISIBLE, options, 2, EXAMPLE1_RULES))
    expect(f).toContain('unique_correct')
    expect(f).toContain('distractors_violate_rules')
    expect(f).toContain('options_distinct')
  })

  it('a distractor two changes away from every other option: options_form_tree', () => {
    const options = [...OPTIONS]
    options[3] = withCell(EXAMPLE1_KEY, { color: 0, orientation: 2 })
    expect(failed(handItem(EXAMPLE1_VISIBLE, options, 2, EXAMPLE1_RULES))).toEqual(['options_form_tree'])
  })

  it('the §14.6 one-change star, where the modal picker finds the key: modal_heuristic_not_unique', () => {
    const star = [EXAMPLE1_STAR[1], EXAMPLE1_STAR[2], EXAMPLE1_STAR[3], EXAMPLE1_STAR[0], EXAMPLE1_STAR[4], EXAMPLE1_STAR[5]] as Cell[]
    const item = handItem(EXAMPLE1_VISIBLE, star, 3, EXAMPLE1_RULES)
    expect(failed(item)).toEqual(['modal_heuristic_not_unique'])
    expect(matrices.verify(item).checks.modal_argmax).toEqual([3])
  })

  it('a declared rule set that is wrong, invalid or has no non-constant rule: structure_matches', () => {
    const wrong = tamper(GOOD, (x) => ((x.structural_params as { rules: Record<string, string> }).rules.shape = 'progression+1'))
    expect(failed(wrong)).toContain('structure_matches')
    const invalid = tamper(GOOD, (x) => ((x.structural_params as { rules: Record<string, string> }).rules.count = 'derived'))
    expect(failed(invalid)).toContain('structure_matches') // count derived needs a position rule
    const unknown = tamper(GOOD, (x) => ((x.structural_params as { rules: Record<string, string> }).rules.color = 'xor'))
    expect(failed(unknown)).toContain('structure_matches')
    const extra = tamper(GOOD, (x) => ((x.structural_params as Record<string, unknown>).seed = 1))
    expect(failed(extra)).toContain('structure_matches')
    // Every attribute constant (0 non-constant rules): a grid of identical rows.
    const flat = EXAMPLE1_VISIBLE.map((c) => withCell(c, { shape: 0, size: 2, positions: [0, 4, 8] }))
    const k = withCell(EXAMPLE1_KEY, {})
    const flatOptions = [k, withCell(k, { size: 0 }), withCell(k, { size: 0, shape: 1 }), withCell(k, { shape: 1 }), withCell(k, { shape: 1, color: 0 }), withCell(k, { color: 0 })]
    const allConstant: RuleSet = { ...EXAMPLE1_RULES, size: 'constant', count: 'constant' }
    expect(failed(handItem(flat, flatOptions, 0, allConstant))).toContain('structure_matches')
  })

  it('tampered metadata: features_match, prior_matches, stratum_matches, time_matches', () => {
    const d = (f: (d: Record<string, unknown>) => void) => tamper(GOOD, (x) => f(x.difficulty as Record<string, unknown>))
    expect(failed(d((x) => ((x.features as Record<string, number>).n_logic = 1)))).toEqual(['features_match'])
    expect(failed(d((x) => (x.b_prior = -1.4)))).toEqual(['prior_matches'])
    expect(failed(d((x) => (x.sd_prior = 0.5)))).toEqual(['prior_matches'])
    expect(failed(tamper(GOOD, (x) => (x.stratum = 3)))).toEqual(['stratum_matches'])
    expect(failed(tamper(GOOD, (x) => (x.expected_time_s = 45)))).toEqual(['time_matches'])
    expect(failed(tamper(GOOD, (x) => delete x.time_limit_s))).toEqual(['time_matches'])
  })

  it('never throws on generated items with tampered keys', () => {
    for (let i = 0; i < 200; i++) {
      const item = matrices.generate(`tamper-${i}`)
      expect(matrices.verify(item).ok).toBe(true)
      const wrong = tamper(item, (x) => (x.key = { index: (item.key.index + 1 + (i % 5)) % 6 }))
      expect(failed(wrong)).toContain('key_matches_prediction')
    }
  })

  it('specOf keeps the 9th cell out of the grid', () => {
    const s = specOf(EXAMPLE1_VISIBLE, OPTIONS)
    expect(s.grid.map((r) => r.length)).toEqual([3, 3, 2])
    expect(maskOf([...(s.options[2]?.positions ?? [])])).toBe(EXAMPLE1_KEY.positions)
  })
})
