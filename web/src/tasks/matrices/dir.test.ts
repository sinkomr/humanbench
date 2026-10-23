/**
 * Matrices generator 1.4.0 (scope variety; ROADMAP M3.12 "rules across rows and columns", A11,
 * R-8.1; DESIGN §4.2 "Matrices"): the column, mixed-direction and diagonal templates, the
 * diagonal rule in the solver of every 1.4.0 item (and not of 1.3.0/1.2.0 items), the template
 * prior, generator 1.3.0 kept whole, and the natural pool unchanged.
 */

import { createHash } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import { createRng } from '../../engine'
import { canonicalJson, type Stratum } from '../ids'
import { powerTimeLimit, stratumOfB } from '../priors'
import { generatorOf, resolveItem } from '../registry'
import { runFamilyProperties } from '../testing'
import {
  COLORS,
  DIAGONAL_RULE,
  DIRECTION_GROUPS,
  ORIENTATIONS,
  SHAPES,
  SIZES,
  canonicalMask,
  SCALAR_ATTRS,
  diagonalAttrs,
  diagonalOf,
  directionOf,
  groupsOf,
  isTemplateRuleSet,
  parseRuleSet,
  structuralParamsOf,
  transposeIndex,
  type Cell,
  type MatrixCell,
  type RuleSet,
} from './grammar'
import {
  TEMPLATE_ODDS,
  diagonalLureValues,
  directionsNeeded,
  drawMixedDirections,
  lureValues,
  noSecondReading,
  ruledComponents,
  sampleAcceptedTemplate,
  sampleTemplateGrid,
  takesLures,
  transposeVisible,
  usesDiagonalAnalysis,
} from './gen'
import { hubHitProbability, modalHitProbability, oneModeHitProbability } from './heuristic'
import {
  MATRIX_DIR_PRIOR,
  MATRIX_DIR_PROVENANCE,
  MATRIX_HARD_PRIOR,
  TEMPLATE_KINDS,
  TEMPLATE_MAX_B,
  TEMPLATE_STRATA,
  bPriorOf,
  columnSet,
  directionKind,
  expectedTimeOf,
  featuresOf,
  isDirectionSensitive,
  isTemplateShape,
  mixedRepresentative,
  referenceTemplatePools,
  templateCodes,
  templateFeaturesOf,
  templatePool,
  type TemplateKind,
} from './prior'
import { DIAGONAL_FIT, predictDiagonal, solve, violatedRules } from './solver'
import { parseSpec, verifyMatrix } from './verify'
import { EXAMPLE1_RULES } from './fixtures'
import { MATRICES_LEGACY_FAMILIES, matrices, matricesSpecLeaksKey, type MatrixItem } from '.'

const v130 = MATRICES_LEGACY_FAMILIES['1.3.0']
const CHANCE = 1 / 6

/** A copy of an item with its spec edited (the spec is plain JSON). */
function edited(item: MatrixItem, edit: (spec: { grid: MatrixCell[][]; options: MatrixCell[] }) => void): MatrixItem {
  const spec = JSON.parse(JSON.stringify(item.spec)) as { grid: MatrixCell[][]; options: MatrixCell[] }
  edit(spec)
  return { ...item, spec }
}

const failures = (item: MatrixItem): string[] => {
  const v = verifyMatrix(item)
  expect(v.ok).toBe(false)
  return (v.reason ?? '').replace(/^failed: /, '').split(', ')
}

const kindOf = (item: MatrixItem): TemplateKind | null => {
  const f = item.difficulty.features as Record<string, number>
  if (f.n_diagonal === undefined) return null
  return f.n_diagonal > 0 ? 'diagonal' : f.col_direction === 1 ? 'col' : 'mixed'
}

/** The first generated template item of a kind in a stratum. */
function templateItem(kind: TemplateKind, stratum: Stratum, prefix = 'tpl'): MatrixItem {
  for (let i = 0; ; i++) {
    const it = matrices.generate(`${prefix}-${kind}-${i}`, { stratum }) as MatrixItem
    if (kindOf(it) === kind) return it
  }
}

const values9 = (cells: readonly Cell[], attr: (typeof SCALAR_ATTRS)[number]): number[] => cells.map((c) => c[attr])

describe('grammar: directions and the diagonal rule', () => {
  it('mirrors cells across the main diagonal and numbers the diagonals', () => {
    expect([0, 1, 2, 3, 4, 5, 6, 7, 8].map(transposeIndex)).toEqual([0, 3, 6, 1, 4, 7, 2, 5, 8])
    expect([0, 1, 2, 3, 4, 5, 6, 7, 8].map(diagonalOf)).toEqual([0, 1, 2, -1, 0, 1, -2, -1, 0])
  })

  it('parses and writes directions strictly; an all-rows set keeps the 1.3.0 structural_params', () => {
    const base: RuleSet = { ...EXAMPLE1_RULES }
    expect(structuralParamsOf(base)).toEqual({ rules: { ...EXAMPLE1_RULES } })
    const col = columnSet(base)
    const sp = structuralParamsOf(col)
    expect(sp.directions).toEqual({ shape: 'col', size: 'col', color: 'col', orientation: 'col', layout: 'col' })
    expect(structuralParamsOf(parseRuleSet(sp) as RuleSet)).toEqual(sp)
    const diag = { ...base, color: DIAGONAL_RULE } as RuleSet
    expect(parseRuleSet(structuralParamsOf(diag))).toEqual(diag)
    for (const bad of [
      { ...sp, directions: { ...sp.directions, layout: 'diag' } },
      { ...sp, directions: { shape: 'col' } },
      { ...sp, directions: { ...sp.directions, frame: 'col' } }, // no frame on an unframed set
      { ...sp, directions: 'col' },
      { rules: { ...sp.rules, count: DIAGONAL_RULE } }, // the diagonal rule is for scalars only
      { ...sp, extra: 1 },
    ]) {
      expect(parseRuleSet(bad as never), JSON.stringify(bad)).toBeNull()
    }
    expect(DIRECTION_GROUPS).toEqual(['shape', 'size', 'color', 'orientation', 'layout', 'frame'])
  })

  it('classifies template sets and their direction kind', () => {
    const base: RuleSet = { ...EXAMPLE1_RULES, shape: 'progression+1' }
    expect(isTemplateRuleSet(base)).toBe(false)
    expect(directionKind(columnSet(base))).toBe('col')
    expect(isTemplateRuleSet(columnSet(base))).toBe(true)
    expect(directionKind(mixedRepresentative({ ...base, count: 'arithmetic+' }))).toBe('mixed')
    expect(diagonalAttrs({ ...base, size: DIAGONAL_RULE } as RuleSet)).toEqual(['size'])
    // A distribution reads the same both ways; a size progression (3 values) makes constant columns.
    expect(isDirectionSensitive(base, 'shape')).toBe(true)
    expect(isDirectionSensitive({ ...base, shape: 'distribution' }, 'shape')).toBe(false)
    expect(isDirectionSensitive({ ...base, size: 'progression+1' }, 'size')).toBe(false)
  })
})

describe('solver: the diagonal rule (1.4.0 analysis only)', () => {
  it('fits a grid constant along its diagonals and predicts cell (0,0)', () => {
    const diag = [1, 2, 0, 3, 1, 2, 4, 3]
    expect(predictDiagonal(diag)).toBe(1)
    expect(predictDiagonal([1, 2, 0, 3, 0, 2, 4, 3])).toBeNull()
  })

  it('is tried only when asked, and a diagonal-only attribute is inconsistent for the 1.3.0 analysis', () => {
    const it = templateItem('diagonal', 3)
    const p = parseSpec(it.spec) as { visible: Cell[]; options: Cell[] }
    const rules = parseRuleSet(it.structural_params) as RuleSet
    const [attr] = diagonalAttrs(rules) as [(typeof SCALAR_ATTRS)[number]]
    const now = solve(p.visible, true)
    expect(now.unique).toBe(true)
    expect(now[attr].fits.map((f) => f.rule)).toEqual([DIAGONAL_FIT])
    const old = solve(p.visible, false)
    expect(old[attr].fits).toEqual([])
    expect(old.consistent).toBe(false)
    // The same item, relabelled 1.3.0, fails: its analysis has no diagonal and no template shapes.
    const relabelled = { ...it, generator_version: '1.3.0' }
    expect(verifyMatrix(relabelled).ok).toBe(false)
    expect(verifyMatrix(it).ok).toBe(true)
  })

  it('never changes the solution of a grid drawn by the line rules, in either direction (so the natural pool is unchanged)', () => {
    const rng = createRng('diag-agrees')
    const pool = [...matrices.strata].flatMap((s) => (s <= 4 ? [s] : []))
    let checked = 0
    for (let i = 0; i < 3_000; i++) {
      const it = v130.generate(`agree-${i}@s${pool[i % pool.length] as number}`) as MatrixItem
      const rules = parseRuleSet(it.structural_params) as RuleSet
      const grid = sampleTemplateGrid(rng, i % 2 === 0 ? rules : columnSet(rules))
      const visible = grid.slice(0, 8)
      const a = solve(visible, false)
      const b = solve(visible, true)
      expect(b.unique).toBe(a.unique)
      expect(b.cell).toEqual(a.cell)
      for (const attr of SCALAR_ATTRS) {
        const d = predictDiagonal(values9(visible, attr))
        if (d !== null) expect(d).toBe(grid[8]?.[attr])
      }
      checked++
    }
    expect(checked).toBe(3_000)
  })

  it('checks each declared rule in its declared direction or on the diagonals', () => {
    const it = templateItem('col', 4)
    const p = parseSpec(it.spec) as { visible: Cell[]; options: Cell[] }
    const rules = parseRuleSet(it.structural_params) as RuleSet
    const key = p.options[it.key.index] as Cell
    expect(violatedRules([...p.visible, key], rules)).toEqual([])
    const asRows: RuleSet = { ...rules, directions: undefined }
    const ruled = ruledComponents(rules).filter((c) => c !== 'frameShade' && c !== 'framePattern')
    expect(ruled.length).toBeGreaterThan(0)
    expect(violatedRules([...p.visible, key], asRows).length).toBeGreaterThan(0) // the direction is needed
  })
})

describe('template prior and pools', () => {
  it('adds three terms centred at 0 to the hard model', () => {
    for (const [k, t] of Object.entries(MATRIX_HARD_PRIOR.terms)) expect(MATRIX_DIR_PRIOR.terms[k]).toEqual(t)
    expect(MATRIX_DIR_PRIOR.terms.col_direction).toEqual({ beta: 0.25, centre: 0 })
    expect(MATRIX_DIR_PRIOR.terms.mixed_direction).toEqual({ beta: 0.45, centre: 0 })
    expect(MATRIX_DIR_PRIOR.terms.n_diagonal).toEqual({ beta: 0.6, centre: 0 })
    // Column: the base b + 0.25; one diagonal rule on example 1: + 0.60, one more rule's time and 5 s.
    const ex = featuresOf(EXAMPLE1_RULES)
    expect(bPriorOf(featuresOf(columnSet(EXAMPLE1_RULES)))).toBeCloseTo(bPriorOf(ex) + 0.25, 12)
    const diag = featuresOf({ ...EXAMPLE1_RULES, color: DIAGONAL_RULE } as RuleSet)
    expect(diag).toMatchObject({ n_rules: ex.n_rules + 1, n_diagonal: 1, col_direction: 0, mixed_direction: 0, n_extra_rules: 0, two_components: 0 })
    expect(bPriorOf(diag)).toBeCloseTo(bPriorOf(ex) + 0.6, 12)
    expect(expectedTimeOf(3, false, 1)).toBe(55)
    expect(expectedTimeOf(6, true, 2)).toBe(105)
    expect(powerTimeLimit(105)).toBe(263)
  })

  it('fills strata 2–6 with all three kinds, b in band and ≤ 3.9, every candidate a template shape', () => {
    const sizes: Record<string, number> = {}
    for (const s of TEMPLATE_STRATA) {
      const pool = templatePool(s)
      expect([...pool.keys()].sort()).toEqual([...TEMPLATE_KINDS].sort())
      for (const [kind, list] of pool) {
        sizes[`${s}:${kind}`] = list.length
        for (const cand of list) {
          const full = kind === 'col' ? columnSet(cand) : kind === 'mixed' ? mixedRepresentative(cand) : cand
          const f = featuresOf(full)
          const b = bPriorOf(f)
          expect(stratumOfB(b)).toBe(s)
          expect(b).toBeLessThanOrEqual(TEMPLATE_MAX_B)
          expect(isTemplateShape(full)).toBe(true)
        }
      }
    }
    expect(sizes).toEqual({
      '2:col': 162, '2:mixed': 24, '2:diagonal': 206,
      '3:col': 1_178, '3:mixed': 628, '3:diagonal': 1_346,
      '4:col': 2_716, '4:mixed': 1_872, '4:diagonal': 2_544,
      '5:col': 5_808, '5:mixed': 3_792, '5:diagonal': 5_360,
      '6:col': 5_254, '6:mixed': 5_432, '6:diagonal': 7_910,
    }) // prettier-ignore
    expect(templatePool(1).size).toBe(0)
  }, 60_000)

  it('builds each stratum’s candidates by the fast walk equal, entry by entry and in order, to the reference build', () => {
    const ref = referenceTemplatePools()
    for (const s of TEMPLATE_STRATA) {
      const fast = templatePool(s)
      for (const k of TEMPLATE_KINDS) {
        expect(JSON.stringify(fast.get(k) ?? []), `${s}:${k}`).toBe(JSON.stringify(ref.get(s)?.get(k) ?? []))
        expect(templateCodes(s).get(k)?.length).toBe(ref.get(s)?.get(k)?.length)
      }
    }
    expect(templateCodes(1).size).toBe(0)
  }, 60_000)

  it('computes a candidate’s features from its base exactly as featuresOf does (mixed: whatever the directions)', () => {
    const rng = createRng('tpl-features')
    for (const s of TEMPLATE_STRATA) {
      for (const [kind, list] of templatePool(s)) {
        for (let i = 0; i < 60; i++) {
          const cand = rng.pick(list)
          const full = kind === 'col' ? columnSet(cand) : kind === 'mixed' ? drawMixedDirections(rng, cand) : cand
          const base = kind === 'diagonal' ? { ...cand, ...Object.fromEntries(diagonalAttrs(cand).map((a) => [a, 'constant'])) } : cand
          const want = featuresOf(full)
          expect(templateFeaturesOf(featuresOf(base as RuleSet), want.two_components === 1, kind, diagonalAttrs(full).length)).toEqual(want)
        }
      }
    }
  })

  it('can generate every fourth candidate of every stratum and kind (a full scan of all 44,232 passed when written)', () => {
    const rng = createRng('tpl-scan')
    let n = 0
    for (const s of TEMPLATE_STRATA) {
      for (const [kind, list] of templatePool(s)) {
        for (let i = s; i < list.length; i += 4) {
          const cand = list[i] as RuleSet
          const rules = kind === 'col' ? columnSet(cand) : kind === 'mixed' ? drawMixedDirections(rng, cand) : cand
          const sample = sampleAcceptedTemplate(rng, rules)
          expect(sample, JSON.stringify(structuralParamsOf(rules))).not.toBeNull()
          n++
        }
      }
    }
    expect(n).toBeGreaterThan(10_000)
  }, 180_000)
})

describe('template items (generator 1.4.0)', () => {
  it('draw a template about one time in three for strata 2–6, every kind in every stratum, never for stratum 1 or the natural pool', () => {
    const kinds = new Map<string, number>()
    let templates = 0
    const N = 1_500
    for (let i = 0; i < N; i++) {
      const s = TEMPLATE_STRATA[i % TEMPLATE_STRATA.length] as Stratum
      const it = matrices.generate(`mix-${i}`, { stratum: s }) as MatrixItem
      const k = kindOf(it)
      if (k === null) continue
      templates++
      kinds.set(`${s}:${k}`, (kinds.get(`${s}:${k}`) ?? 0) + 1)
    }
    expect(templates / N).toBeGreaterThan(1 / TEMPLATE_ODDS - 0.05)
    expect(templates / N).toBeLessThan(1 / TEMPLATE_ODDS + 0.05)
    for (const s of TEMPLATE_STRATA) for (const k of TEMPLATE_KINDS) expect(kinds.get(`${s}:${k}`) ?? 0, `${s}:${k}`).toBeGreaterThan(5)
    for (let i = 0; i < 300; i++) {
      expect(kindOf(matrices.generate(`nat-${i}`) as MatrixItem)).toBeNull()
      expect(kindOf(matrices.generate(`one-${i}`, { stratum: 1 }) as MatrixItem)).toBeNull()
    }
  }, 60_000)

  it('verify with the template checks; the direction is recorded and needed; lures and both pickers hold', () => {
    const N = 3_000
    let modal = 0
    let oneMode = 0
    let hub = 0
    let lured = 0
    let n = 0
    const keyPos = [0, 0, 0, 0, 0, 0]
    const fids = new Set<string>()
    for (let i = 0; n < N; i++) {
      const s = TEMPLATE_STRATA[i % TEMPLATE_STRATA.length] as Stratum
      const item = matrices.generate(`tv-${i}`, { stratum: s }) as MatrixItem
      const kind = kindOf(item)
      if (kind === null) continue
      n++
      fids.add(item.family_id)
      const v = verifyMatrix(item)
      expect(v.ok, `${item.item_id}: ${v.reason ?? ''}`).toBe(true)
      expect(v.checks).toMatchObject({ directions_needed: true, no_second_reading: true, analysis: 'rows_columns_diagonals' })
      const rules = parseRuleSet(item.structural_params) as RuleSet
      const declared = v.checks.declared_directions as Record<string, string>
      for (const g of groupsOf(rules)) {
        expect(declared[g]).toBe(diagonalAttrs(rules).includes(g as never) ? 'diagonal' : directionOf(rules, g))
      }
      expect(item.stratum).toBe(s)
      expect(item.difficulty.provenance).toBe(MATRIX_DIR_PROVENANCE)
      expect(item.expected_time_s).toBe(expectedTimeOf(item.difficulty.features.n_rules as number, rules.frame_shade !== undefined, diagonalAttrs(rules).length))
      expect(matricesSpecLeaksKey(item)).toBeNull()
      // The spec never names a direction: a template spec is shaped exactly like a 1.3.0 spec.
      expect(JSON.stringify(item.spec)).not.toMatch(/\b(row|col|diag|diagonal|directions?)\b/)
      const p = parseSpec(item.spec) as { visible: Cell[]; options: Cell[] }
      if (takesLures(rules)) {
        lured++
        expect(v.checks).toMatchObject({ distractors_are_lures: true, hub_heuristic_not_unique: true })
      }
      modal += modalHitProbability(p.options, item.key.index)
      oneMode += oneModeHitProbability(p.options, item.key.index)
      hub += hubHitProbability(p.options, item.key.index)
      keyPos[item.key.index] = (keyPos[item.key.index] as number) + 1
    }
    expect(lured).toBeGreaterThan(N / 3)
    for (const rate of [modal, oneMode, hub].map((h) => h / N)) expect(rate).toBeLessThanOrEqual(1.5 * CHANCE)
    const e = N / 6
    expect(keyPos.reduce((s, o) => s + (o - e) ** 2 / e, 0)).toBeLessThan(20.5)
    expect(fids.size).toBeGreaterThan(N * 0.6) // family_id = the rule set with its directions
  }, 180_000)

  it('give a diagonal lure the values a row or column reading gives', () => {
    const it = templateItem('diagonal', 4)
    const p = parseSpec(it.spec) as { visible: Cell[]; options: Cell[] }
    const rules = parseRuleSet(it.structural_params) as RuleSet
    const key = p.options[it.key.index] as Cell
    for (const attr of diagonalAttrs(rules)) {
      const lures = diagonalLureValues(attr, key, p.visible)
      expect(lures).toEqual(lureValues(attr, key, p.visible, rules))
      expect(lures).not.toContain(key[attr])
      for (const i of [2, 5, 6, 7]) if ((p.visible[i] as Cell)[attr] !== key[attr]) expect(lures).toContain((p.visible[i] as Cell)[attr])
    }
    // A column-ruled component's lures are the row lures of the mirrored grid.
    const c = templateItem('col', 5)
    const pc = parseSpec(c.spec) as { visible: Cell[]; options: Cell[] }
    const rc = parseRuleSet(c.structural_params) as RuleSet
    const kc = pc.options[c.key.index] as Cell
    for (const comp of ruledComponents(rc)) {
      expect(lureValues(comp, kc, pc.visible, rc)).toEqual(lureValues(comp, kc, transposeVisible(pc.visible), { ...rc, directions: undefined }))
    }
  })

  it('reject tampering: directions dropped or flipped, a diagonal read as constant, a wrong key, swapped options, a non-lure', () => {
    for (const kind of TEMPLATE_KINDS) {
      const it = templateItem(kind, 5, 'tamper')
      const sp = it.structural_params as { rules: Record<string, string>; directions?: Record<string, string> }
      expect(verifyMatrix(it).ok).toBe(true)
      expect(failures({ ...it, key: { index: (it.key.index + 1) % 6 } })).toContain('key_matches_prediction')
      const swapped = edited(it, (s) => {
        const j = (it.key.index + 1) % 6
        ;[s.options[it.key.index], s.options[j]] = [s.options[j] as MatrixCell, s.options[it.key.index] as MatrixCell]
      })
      expect(failures(swapped)).toContain('key_matches_prediction')
      if (kind === 'diagonal') {
        const asConstant = { ...sp.rules, ...Object.fromEntries(Object.entries(sp.rules).filter(([, r]) => r === DIAGONAL_RULE).map(([a]) => [a, 'constant'])) }
        expect(failures({ ...it, structural_params: { rules: asConstant } })).toContain('structure_matches')
        // A diagonal set may not carry directions.
        const both = { rules: sp.rules, directions: Object.fromEntries(groupsOf(parseRuleSet(it.structural_params) as RuleSet).map((g) => [g, 'row'])) }
        expect(failures({ ...it, structural_params: both })).toContain('structure_matches')
      } else {
        const dropped = { rules: sp.rules }
        expect(failures({ ...it, structural_params: dropped })).toEqual(expect.arrayContaining(['structure_matches']))
        const flipped = { rules: sp.rules, directions: Object.fromEntries(Object.entries(sp.directions ?? {}).map(([g, d]) => [g, d === 'row' ? 'col' : 'row'])) }
        expect(failures({ ...it, structural_params: flipped })).toContain('structure_matches')
      }
      // The 1.3.0 analysis rejects a template item outright.
      expect(verifyMatrix(it, '1.3.0').ok).toBe(false)
    }
    // A distractor that takes a value no lure gives (on a lure-tree item).
    const d = templateItem('diagonal', 6, 'nonlure')
    const p = parseSpec(d.spec) as { visible: Cell[]; options: Cell[] }
    const rules = parseRuleSet(d.structural_params) as RuleSet
    const key = p.options[d.key.index] as Cell
    const [attr] = diagonalAttrs(rules) as [(typeof SCALAR_ATTRS)[number]]
    const lures = lureValues(attr, key, p.visible, rules)
    const names: Readonly<Record<string, readonly unknown[]>> = { shape: SHAPES, size: SIZES, color: COLORS, orientation: ORIENTATIONS }
    const odd = (names[attr] as readonly unknown[]).findIndex((_, v) => v !== key[attr] && !lures.includes(v))
    if (odd >= 0) {
      const j = d.key.index === 0 ? 1 : 0
      const bad = edited(d, (s) => {
        s.options[j] = { ...(s.options[d.key.index] as MatrixCell), [attr]: (names[attr] as readonly unknown[])[odd] } as MatrixCell
      })
      expect(failures(bad)).toContain('distractors_are_lures')
    }
  })

  it('rejects a copy lure: a rule confirmed only by lines that also read "the third repeats the second" (panel, v23-223@s6)', () => {
    // Counts down the columns 4 − 2 = 2, 2 − 1 = 1, 3 − 2 = ? (key 1); the first two columns also
    // read "the bottom repeats the middle", which gives 2: a person sees that first.
    const counts = [4, 2, 3, 2, 1, 2, 2, 1, 1]
    const cells: Cell[] = counts.map((n) => ({ shape: 0, size: 0, color: 0, orientation: 0, positions: canonicalMask(n) }))
    const rules = columnSet({ shape: 'constant', size: 'constant', color: 'constant', orientation: 'constant', count: 'arithmetic-', position: 'canonical' })
    expect(violatedRules(cells, rules)).toEqual([])
    expect(noSecondReading(cells.slice(0, 8), cells[8] as Cell, rules)).toBe(false)
    // Not a lure when the copy reading gives the key anyway, or when one line breaks the copy pattern.
    const fine = [4, 2, 3, 3, 1, 2, 1, 1, 1]
    const ok: Cell[] = fine.map((n) => ({ shape: 0, size: 0, color: 0, orientation: 0, positions: canonicalMask(n) }))
    expect(noSecondReading(ok.slice(0, 8), ok[8] as Cell, rules)).toBe(true)
  })

  it('rejects a diagonal attribute whose first two rows permute three values that the third row breaks (panel, v23-143@s6)', () => {
    // Orientation constant along the diagonals: rows 0°, 45°, 90° / 90°, 0°, 45° / 135°, 90°, ? (key 0°).
    const turns = [0, 1, 2, 2, 0, 1, 3, 2, 0]
    const cells: Cell[] = turns.map((o) => ({ shape: 0, size: 0, color: 0, orientation: o, positions: canonicalMask(1) }))
    const rules = { shape: 'constant', size: 'constant', color: 'constant', orientation: DIAGONAL_RULE, count: 'constant', position: 'canonical' } as RuleSet
    expect(violatedRules(cells, rules)).toEqual([])
    expect(solve(cells.slice(0, 8), true).unique).toBe(true) // the solver alone sees no problem
    expect(noSecondReading(cells.slice(0, 8), cells[8] as Cell, rules)).toBe(false)
    // A line-ruled attribute may have a two-line pattern that its third line breaks: the declared
    // rule holds on all three lines. Shape progression down the columns, two equal columns.
    const shapes = [4, 4, 2, 3, 3, 1, 2, 2, 0]
    const prog: Cell[] = shapes.map((sh) => ({ shape: sh, size: 0, color: 0, orientation: 0, positions: canonicalMask(1) }))
    const colRules = columnSet({ ...rules, orientation: 'constant', shape: 'progression-1' })
    expect(violatedRules(prog, colRules)).toEqual([])
    expect(noSecondReading(prog.slice(0, 8), prog[8] as Cell, colRules)).toBe(true)
  })

  it('rejects a grid whose direction is not needed (a column item that reads along the rows as well)', () => {
    const rng = createRng('not-needed')
    // Size progression only: its columns are constant, so the rows and the columns read alike.
    const rules = columnSet({ ...EXAMPLE1_RULES, shape: 'constant', size: 'progression+1', color: 'constant', orientation: 'constant', count: 'constant' })
    const grid = sampleTemplateGrid(rng, rules)
    const sol = solve(grid.slice(0, 8), true)
    expect(sol.unique).toBe(true)
    expect(directionsNeeded(sol, rules)).toBe(false)
    expect(isTemplateShape(rules)).toBe(false)
  })
})

describe('matrices 1.4.0 as a family', () => {
  it('passes runFamilyProperties on the requested strata 2–6 (templates one draw in three)', () => {
    const r = runFamilyProperties(matrices, {
      specLeaksKey: matricesSpecLeaksKey,
      familyIdRatio: { min: 0.3, reason: 'family_id = the rule set with its directions (A11)' },
      correctResponse: (item: MatrixItem) => item.key.index,
      incorrectResponse: (item: MatrixItem) => (item.key.index + 1) % 6,
      malformedResponses: () => [-1, 6, 2.5, '1', [1]],
      n: 2_500,
      strata: TEMPLATE_STRATA,
      seedPrefix: 'dir-',
    })
    expect(r.strataCounts).toEqual({ 1: 0, 2: 500, 3: 500, 4: 500, 5: 500, 6: 500 })
    expect(r.bPrior.max).toBeLessThanOrEqual(TEMPLATE_MAX_B)
  }, 180_000)

  it('keeps the natural pool and stratum 1 byte-identical to 1.3.0 (content digest recorded from the 1.3.0 build)', () => {
    const digest = (fam: typeof matrices): string => {
      const h = createHash('sha256')
      for (let i = 0; i < 400; i++) {
        const it = fam.generate(i % 2 === 0 ? `n-${i}` : `n-${i}@s1`)
        h.update(canonicalJson({ spec: it.spec, key: it.key, sp: it.structural_params, d: it.difficulty, t: it.expected_time_s, s: it.stratum, fid: it.family_id }))
      }
      return h.digest('hex')
    }
    const want = 'ce83c6e6f932120f3d0e5fb4d2aec26db2a495a61fabeceaacc3585ff6d4222f'
    expect(digest(v130)).toBe(want)
    expect(digest(matrices)).toBe(want)
  }, 60_000)
})

describe('generator 1.3.0 kept whole (A11, R-8.1)', () => {
  it('is the 1.3.0 family with strata 1–6 and no templates, resolvable by version', () => {
    expect(v130.generatorVersion).toBe('1.3.0')
    expect(v130.strata).toEqual([1, 2, 3, 4, 5, 6])
    expect(generatorOf('matrices', '1.3.0')).toBe(v130)
    expect(matrices.generatorVersion).toBe('1.4.0')
    expect(usesDiagonalAnalysis('1.3.0')).toBe(false)
    expect(usesDiagonalAnalysis('1.2.0+py')).toBe(false)
    expect(usesDiagonalAnalysis('1.4.0')).toBe(true)
    for (let i = 0; i < 300; i++) {
      const it = v130.generate(`v130-none-${i}`, { stratum: TEMPLATE_STRATA[i % 5] as Stratum }) as MatrixItem
      expect(kindOf(it)).toBeNull()
      expect(verifyMatrix(it).ok).toBe(true)
    }
  })

  it('rebuilds 1.3.0 items byte for byte (hashes recorded from the 1.3.0 build)', () => {
    const golden: readonly (readonly [string, string])[] = [
      ['dump-0', 'abc03c09d9281bdc5dd54e3fc9f6cfa69bf0c78ad957552c08afd843f8462378'],
      ['dump-1', 'd98a7810ae93787b4369cbb8a2bd5b5160b05b73200dd19dcdeda325c97cdabe'],
      ['v130-a@s1', 'd4a2b1bfc054fef404cb881030f719b48e458a7b7b6a12b915366e20fd83f2fe'],
      ['v130-b@s2', '91864f30abfe9607c2012c69aacfa1a59dcfc213d3c1d088a9c42d4996499d30'],
      ['v130-c@s3', 'f918286a8b1f1603a88eba9c6bfe690c58f4f8c15c676674f8bed08106d44a22'],
      ['v130-d@s4', '2c164bce790ae3422cec81d3e1df188ea6bc06377a1af8325d70f92f2f3cd451'],
      ['v130-e@s5', '4731021d20ec279ce458213e96028fa1ba4199c8d1da863482ba280076074eb2'],
      ['v130-f@s6', '1b35467492b5e1f30440322a15e4e03b79dfd66ebb72261c537c73d32ad39728'],
    ]
    for (const [seed, hash] of golden) {
      const item = resolveItem(`i:matrices:1.3.0:${seed}`)
      expect(item?.item_id).toBe(`i:matrices:1.3.0:${seed}`)
      expect(createHash('sha256').update(canonicalJson(item)).digest('hex'), seed).toBe(hash)
    }
    // Every stratum together (600 items, all six strata): the content digest of the 1.3.0 build.
    const h = createHash('sha256')
    for (let i = 0; i < 600; i++) {
      const it = v130.generate(i % 7 === 0 ? `g-${i}` : `g-${i}@s${i % 7}`)
      h.update(canonicalJson({ spec: it.spec, key: it.key, sp: it.structural_params, d: it.difficulty, t: it.expected_time_s, s: it.stratum, fid: it.family_id }))
    }
    expect(h.digest('hex')).toBe('6c0f363cad55d95f158a4d85d855bd8473b5f34d46a37f8965093f0b175cf8c3')
  }, 60_000)

  it('family_id parity vectors with the bank twin (same structure → same id)', () => {
    const vectors: readonly (readonly [RuleSet, string])[] = FAMILY_ID_VECTORS
    for (const [rules, fid] of vectors) {
      const sp = structuralParamsOf(rules)
      expect(matrices.familyIdOf(sp as never)).toBe(fid)
    }
  })
})

const FID_BASE: RuleSet = { shape: 'progression+1', size: 'constant', color: 'constant', orientation: 'constant', count: 'arithmetic+', position: 'canonical' }

/** family_ids computed by this TS build; the bank's `test_matrices_dir.py` pins the same values (A11 parity). */
const FAMILY_ID_VECTORS: readonly (readonly [RuleSet, string])[] = [
  [FID_BASE, 'f:matrices:6e0015031a48'],
  [columnSet(FID_BASE), 'f:matrices:030edfa0f6d2'],
  [{ ...FID_BASE, directions: { shape: 'row', size: 'col', color: 'row', orientation: 'col', layout: 'col' } }, 'f:matrices:eff89906f913'],
  [{ ...FID_BASE, color: DIAGONAL_RULE }, 'f:matrices:a587a0a60bbc'],
  [{ ...FID_BASE, color: DIAGONAL_RULE, size: DIAGONAL_RULE }, 'f:matrices:35b99f39cfa5'],
  [
    columnSet({ ...FID_BASE, frame_shade: 'distribution', frame_pattern: 'constant', size: 'distribution', orientation: 'progression-1' }),
    'f:matrices:8272d1cf1214',
  ],
]
