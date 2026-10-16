/**
 * Hard strata 5 and 6 of matrices (generator 1.3.0; ROADMAP M3.12, A11, R-8.1; DESIGN §4.2
 * "Matrices"): the two hard templates (5 rules; an outer frame with its own rules), the frame in
 * the grammar, solver and verifier, the single-rule lure distractors and both option-only
 * pickers, the extended prior, and generator 1.2.0 kept whole.
 */

import { createHash } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import { createRng } from '../../engine'
import { canonicalJson, type Stratum } from '../ids'
import { powerTimeLimit, stratumOfB } from '../priors'
import { generatorOf, resolveItem } from '../registry'
import { runFamilyProperties } from '../testing'
import {
  ALL_COMPONENTS,
  FRAME_PATTERNS,
  FRAME_SHADES,
  SHAPES,
  allHardRuleSets,
  cellEquals,
  differingComponents,
  isFramed,
  isHardRuleSet,
  parseCell,
  parseRuleSet,
  toSpecCell,
  type Cell,
  type MatrixCell,
  type RuleSet,
} from './grammar'
import { MAX_LURE_CHANGES, lureValues, ruledComponents, sampleAcceptedHard, sampleHardGrid } from './gen'
import { hubDegrees, hubHitProbability, hubPicksKeyUniquely, modalHitProbability, oneModeHitProbability } from './heuristic'
import {
  BASE_RULE_SETS_BY_STRATUM,
  HARD_RULE_SETS_BY_STRATUM,
  MATRIX_HARD_PRIOR,
  MATRIX_HARD_PROVENANCE,
  MATRIX_PRIOR,
  bPriorOf,
  expectedTimeOf,
  featuresOf,
} from './prior'
import { solve, violatedRules } from './solver'
import { parseSpec, verifyMatrix } from './verify'
import { EXAMPLE1_CHAIN, EXAMPLE1_STAR } from './fixtures'
import { MATRICES_LEGACY_FAMILIES, matrices, matricesSpecLeaksKey, type MatrixItem } from '.'

const HARD: readonly Stratum[] = [5, 6]
const CHANCE = 1 / 6

const OPTS = {
  specLeaksKey: matricesSpecLeaksKey,
  familyIdRatio: { min: 0.5, reason: 'family_id = the hard rule set: 6,184 in stratum 5 and 3,995 in 6' },
  correctResponse: (item: MatrixItem) => item.key.index,
  incorrectResponse: (item: MatrixItem) => (item.key.index + 1) % 6,
  malformedResponses: () => [-1, 6, 2.5, '1', [1]],
} as const

const hardItem = (seed: string, stratum: Stratum): MatrixItem => matrices.generate(seed, { stratum }) as MatrixItem

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

/** The first generated framed item of a stratum. */
function framedItem(stratum: Stratum): MatrixItem {
  for (let i = 0; ; i++) {
    const it = hardItem(`framed-${i}`, stratum)
    if (it.spec.options[0]?.frame !== undefined) return it
  }
}

describe('hard rule sets and prior (M3.12)', () => {
  it('enumerates the hard templates: 5 unframed rules, or a ruled frame with 4–6 rules in all', () => {
    const all = allHardRuleSets()
    expect(all.every(isHardRuleSet)).toBe(true)
    const unframed = all.filter((r) => !isFramed(r))
    expect(unframed.every((r) => featuresOf(r).n_rules === 5)).toBe(true)
    for (const r of all.filter(isFramed)) {
      expect(r.frame_shade !== 'constant' || r.frame_pattern !== 'constant').toBe(true)
      expect(featuresOf(r).n_rules).toBeGreaterThanOrEqual(4)
      expect(featuresOf(r).n_rules).toBeLessThanOrEqual(6)
    }
    // Every hard set is distinct from every 1.2.0 set (A11: distinct structures).
    const base = new Set([...BASE_RULE_SETS_BY_STRATUM.values()].flat().map((r) => canonicalJson(r)))
    expect(all.some((r) => base.has(canonicalJson(r)))).toBe(false)
  })

  it('keeps the 1.2.0 terms and centres, adds two terms centred at 0, and fills strata 5 and 6', () => {
    for (const [k, t] of Object.entries(MATRIX_PRIOR.terms)) expect(MATRIX_HARD_PRIOR.terms[k]).toEqual(t)
    expect(MATRIX_HARD_PRIOR.terms.n_extra_rules).toEqual({ beta: 0.35, centre: 0 })
    expect(MATRIX_HARD_PRIOR.terms.two_components).toEqual({ beta: 0.6, centre: 0 })
    expect([...HARD_RULE_SETS_BY_STRATUM.keys()].sort()).toEqual([5, 6])
    const s5 = HARD_RULE_SETS_BY_STRATUM.get(5) ?? []
    const s6 = HARD_RULE_SETS_BY_STRATUM.get(6) ?? []
    expect([s5.length, s6.length]).toEqual([6_184, 3_995])
    expect(s5.filter((r) => !isFramed(r))).toHaveLength(152) // the 5-rule template reaches stratum 5 only
    const bs = (sets: readonly RuleSet[]) => sets.map((r) => bPriorOf(featuresOf(r)))
    expect(Math.min(...bs(s5))).toBeCloseTo(1.59, 2)
    expect(Math.max(...bs(s5))).toBeCloseTo(2.49, 2)
    expect(Math.min(...bs(s6))).toBeCloseTo(2.69, 2)
    expect(Math.max(...bs(s6))).toBeCloseTo(3.89, 2)
    // A 1.2.0 set's features carry no hard term, so its b is the 1.2.0 one.
    for (const sets of BASE_RULE_SETS_BY_STRATUM.values()) for (const r of sets) expect(Object.keys(featuresOf(r))).toHaveLength(5)
  })

  it('expects 70–95 s for hard items (cap 180–238 s)', () => {
    expect(expectedTimeOf(5)).toBe(70)
    expect([4, 5, 6].map((n) => expectedTimeOf(n, true))).toEqual([75, 85, 95])
    expect(powerTimeLimit(95)).toBe(238)
  })
})

describe('frames in the grammar and the solver', () => {
  it('parses and writes framed cells; rejects malformed frames', () => {
    const c = { shape: 'square', size: 'small', color: 'black', orientation: 45, positions: [4], frame: { shade: 'dark_grey', pattern: 'dotted' } }
    const parsed = parseCell(c) as Cell
    expect(parsed).toMatchObject({ frameShade: 1, framePattern: 2 })
    for (const bad of [
      { ...c, frame: { shade: 'white', pattern: 'solid' } },
      { ...c, frame: { shade: 'black', pattern: 'wavy' } },
      { ...c, frame: { shade: 'black', pattern: 'solid', width: 2 } },
      { ...c, frame: 'black' },
      { ...c, frame: null },
    ]) {
      expect(typeof parseCell(bad)).toBe('string')
    }
    expect(FRAME_SHADES).toEqual(['light_grey', 'dark_grey', 'black'])
    expect(FRAME_PATTERNS).toEqual(['solid', 'dashed', 'dotted'])
    expect(parseRuleSet({ rules: { shape: 'constant', size: 'constant', color: 'constant', orientation: 'constant', count: 'constant', position: 'canonical', frame_shade: 'distribution' } })).toBeNull()
    expect(parseRuleSet({ rules: { shape: 'constant', size: 'constant', color: 'constant', orientation: 'constant', count: 'constant', position: 'canonical', frame_shade: 'constant', frame_pattern: 'progression+1' } })).toBeNull()
  })

  it('solves the frame like any scalar, and a grid with frames on some cells only is inconsistent', () => {
    const rng = createRng('frame-solve')
    const rules = (HARD_RULE_SETS_BY_STRATUM.get(6) ?? []).find((r) => r.frame_shade === 'progression+1' && r.frame_pattern === 'distribution') as RuleSet
    const s = sampleAcceptedHard(rng, rules)
    expect(s).not.toBeNull()
    const { visible, tree } = s as { visible: Cell[]; tree: Cell[] }
    const sol = solve(visible)
    expect(sol.unique).toBe(true)
    expect(sol.cell).toEqual(tree[0])
    expect(sol.frameShade?.predictions).toHaveLength(1)
    expect(sol.framePattern?.fits.map((f) => f.rule)).toContain('distribution@row')
    expect(violatedRules([...visible, tree[0] as Cell], rules)).toEqual([])
    const { frameShade: _s, framePattern: _p, ...bare } = visible[3] as Cell
    const mixed = [...visible.slice(0, 3), bare as Cell, ...visible.slice(4)]
    expect(solve(mixed).consistent).toBe(false)
    expect(violatedRules([...visible, bare as Cell], rules)).toEqual(expect.arrayContaining(['frame_shade', 'frame_pattern']))
  })

  it('samples grids whose declared rules hold, frame included, for every hard rule set; every one is generable', () => {
    const rng = createRng('every-hard-rule-set')
    for (const sets of HARD_RULE_SETS_BY_STRATUM.values()) {
      for (const rules of sets) {
        expect(violatedRules(sampleHardGrid(rng, rules), rules)).toEqual([])
        const s = sampleAcceptedHard(rng, rules)
        expect(s, JSON.stringify(rules)).not.toBeNull()
        const { visible, tree } = s as { visible: Cell[]; tree: Cell[] }
        expect(solve(visible).cell).toEqual(tree[0])
        expect(tree.every((c) => (c.frameShade !== undefined) === isFramed(rules))).toBe(true)
      }
    }
  }, 120_000)
})

describe('single-rule lure distractors and the option-only pickers', () => {
  it('the hub picker finds the key of a one-change star, not of a chain', () => {
    expect(hubDegrees(EXAMPLE1_STAR)[0]).toBe(5)
    expect(hubPicksKeyUniquely(EXAMPLE1_STAR, 0)).toBe(true)
    expect(hubPicksKeyUniquely(EXAMPLE1_CHAIN, 0)).toBe(false)
    expect(hubHitProbability(EXAMPLE1_CHAIN, 0)).toBe(0)
  })

  it('every distractor differs from the key in 1–3 ruled attributes, each a lure; both pickers stay below 1.5 × chance', () => {
    const N = 2_000
    let modal = 0
    let oneMode = 0
    let hub = 0
    const byChanges = [0, 0, 0, 0]
    const keyPos = [0, 0, 0, 0, 0, 0]
    for (let i = 0; i < N; i++) {
      const item = hardItem(`lure-${i}`, HARD[i % 2] as Stratum)
      const p = parseSpec(item.spec)
      if (typeof p === 'string') throw new Error(p)
      const rules = parseRuleSet(item.structural_params) as RuleSet
      const key = p.options[item.key.index] as Cell
      const ruled = ruledComponents(rules)
      p.options.forEach((o, j) => {
        if (j === item.key.index) return
        const diff = differingComponents(key, o)
        byChanges[diff.length] = (byChanges[diff.length] as number) + 1
        for (const c of diff) {
          expect(ruled).toContain(c)
          expect(lureValues(c, key, p.visible, rules)).toContain(o[c] ?? -1)
        }
      })
      modal += modalHitProbability(p.options, item.key.index)
      oneMode += oneModeHitProbability(p.options, item.key.index)
      hub += hubHitProbability(p.options, item.key.index)
      keyPos[item.key.index] = (keyPos[item.key.index] as number) + 1
    }
    expect(byChanges[0]).toBe(0)
    expect(byChanges.length - 1).toBe(MAX_LURE_CHANGES)
    expect((byChanges[1] as number) / (N * 5)).toBeGreaterThan(0.35) // most distractors are one lure from the key
    for (const rate of [modal, oneMode, hub].map((h) => h / N)) expect(rate).toBeLessThanOrEqual(1.5 * CHANCE)
    const e = N / 6
    expect(keyPos.reduce((s, o) => s + (o - e) ** 2 / e, 0)).toBeLessThan(20.5)
  }, 60_000)

  it('lure values never include the key and stay in range', () => {
    const rng = createRng('lure-range')
    for (const rules of (HARD_RULE_SETS_BY_STRATUM.get(5) ?? []).slice(0, 400)) {
      const grid = sampleHardGrid(rng, rules)
      const key = grid[8] as Cell
      for (const c of ruledComponents(rules)) {
        const lures = lureValues(c, key, grid.slice(0, 8), rules)
        expect(lures.length).toBeGreaterThan(0)
        expect(lures).not.toContain(key[c])
        expect(ALL_COMPONENTS).toContain(c)
      }
    }
  })
})

describe('matrices hard strata as a family (M3.12)', () => {
  it('passes runFamilyProperties on strata 5 and 6', () => {
    const r = runFamilyProperties(matrices, { ...OPTS, n: 2_000, strata: HARD, seedPrefix: 'hard-' })
    expect(r.strataCounts).toEqual({ 1: 0, 2: 0, 3: 0, 4: 0, 5: 1_000, 6: 1_000 })
    expect(r.distinctFamilyIds).toBeGreaterThan(1_800)
    expect(r.bPrior.min).toBeGreaterThanOrEqual(1.5)
  }, 120_000)

  it('has well over 100 structures per stratum in 100 and in 1,000 items, both templates and every frame rule', () => {
    const seen = new Set<string>()
    for (const s of HARD) {
      const ids = new Set<string>()
      for (let i = 0; i < 1_000; i++) {
        const it = hardItem(`fid-${i}`, s)
        ids.add(it.family_id)
        if (i === 99) expect(ids.size, `stratum ${s} at n = 100`).toBeGreaterThanOrEqual(95)
        expect(it.stratum).toBe(s)
        expect(stratumOfB(it.difficulty.b_prior)).toBe(s)
        expect([70, 75, 85, 95]).toContain(it.expected_time_s)
        expect(it.difficulty.provenance).toBe(MATRIX_HARD_PROVENANCE)
        const rules = (it.structural_params as { rules: Record<string, string> }).rules
        seen.add(`${s}:${rules.frame_shade === undefined ? 'unframed' : 'framed'}`)
        for (const k of ['frame_shade', 'frame_pattern']) if (rules[k] !== undefined) seen.add(`${k}:${rules[k]}`)
      }
      expect(ids.size, `stratum ${s} at n = 1,000`).toBeGreaterThan(850) // ≈ 885 expected for 3,995 sets drawn uniformly
    }
    for (const k of ['5:unframed', '5:framed', '6:framed', 'frame_shade:constant', 'frame_shade:progression+1', 'frame_shade:progression-1', 'frame_shade:distribution', 'frame_pattern:constant', 'frame_pattern:distribution']) {
      expect(seen.has(k), k).toBe(true)
    }
  }, 60_000)

  it('verifies hard items with the hard checks, and rejects a frame removed, a non-lure distractor and the frame rules dropped', () => {
    const it6 = framedItem(6)
    const ok = verifyMatrix(it6)
    expect(ok.ok, ok.reason).toBe(true)
    expect(ok.checks).toMatchObject({ distractors_are_lures: true, hub_heuristic_not_unique: true, frames_consistent: true })
    expect(Object.keys(ok.checks.inferred_rules as object)).toEqual(expect.arrayContaining(['frameShade', 'framePattern']))

    const d = it6.key.index === 0 ? 1 : 0
    expect(failures(edited(it6, (s) => void delete (s.options[d] as { frame?: unknown }).frame))).toContain('frames_consistent')

    // A distractor whose shape is a value no lure gives (or, if every shape is a lure, the key's
    // own frame on a different shade that is not a lure).
    const p = parseSpec(it6.spec) as { visible: Cell[]; options: Cell[] }
    const rules = parseRuleSet(it6.structural_params) as RuleSet
    const key = p.options[it6.key.index] as Cell
    const shapeLures = lureValues('shape', key, p.visible, rules)
    const odd = [0, 1, 2, 3, 4].find((v) => v !== key.shape && !shapeLures.includes(v))
    if (odd !== undefined) {
      const bad = edited(it6, (s) => {
        s.options[d] = { ...(s.options[it6.key.index] as MatrixCell), shape: SHAPES[odd] as MatrixCell['shape'] }
      })
      expect(failures(bad)).toContain('distractors_are_lures')
    }

    const dropped = { ...it6, structural_params: { rules: { ...rules, frame_shade: undefined, frame_pattern: undefined } } }
    const sp = JSON.parse(JSON.stringify(dropped.structural_params)) as MatrixItem['structural_params']
    expect(failures({ ...it6, structural_params: sp })).toEqual(expect.arrayContaining(['frames_consistent']))
  })

  it('rejects options arranged as a one-change star around the key (the hub picker)', () => {
    const it5 = framedItem(5)
    const p = parseSpec(it5.spec) as { visible: Cell[]; options: Cell[] }
    const rules = parseRuleSet(it5.structural_params) as RuleSet
    const key = p.options[it5.key.index] as Cell
    const star: Cell[] = [key]
    for (const c of ruledComponents(rules)) {
      for (const v of lureValues(c, key, p.visible, rules)) {
        const o = { ...key, [c]: v }
        if (star.length < 6 && !star.some((x) => cellEquals(x, o))) star.push(o)
      }
    }
    expect(star).toHaveLength(6)
    expect(hubPicksKeyUniquely(star, 0)).toBe(true)
    const item = edited(it5, (sp) => {
      sp.options = star.map(toSpecCell)
    })
    expect(failures({ ...item, key: { index: 0 } })).toContain('hub_heuristic_not_unique')
  })

  it('keeps the leak predicate strict about frames', () => {
    const it6 = framedItem(6)
    expect(matricesSpecLeaksKey(it6)).toBeNull()
    const leaky = edited(it6, (s) => void ((s.options[0] as unknown as { frame: Record<string, unknown> }).frame.answer = true))
    expect(matricesSpecLeaksKey(leaky)).not.toBeNull()
  })
})

describe('generator 1.2.0 kept whole (A11, R-8.1)', () => {
  const legacy = MATRICES_LEGACY_FAMILIES['1.2.0']

  it('is the 1.2.0 family with strata 1–4, resolvable by version', () => {
    expect(legacy.generatorVersion).toBe('1.2.0')
    expect(legacy.strata).toEqual([1, 2, 3, 4])
    expect(() => legacy.generate('x', { stratum: 5 })).toThrow(RangeError)
    expect(generatorOf('matrices', '1.2.0')).toBe(legacy)
    expect(generatorOf('matrices', '1.3.0')).toBe(matrices)
    expect(resolveItem('i:matrices:1.2.0:x@s5')).toBeNull()
  })

  it('rebuilds 1.2.0 items byte for byte (hashes recorded from the 1.2.0 build, = the bank dump of 2026-10-12)', () => {
    const golden: readonly (readonly [string, string])[] = [
      ['dump-0', '4ca3ab2d243e41481430f348b47f16119bbfd887ccd1435aa777fee3f2201840'],
      ['dump-1', 'a7d16e564d2f11229743190ba10a5d2fd5508ac2283bd2d212c552066a53fe55'],
      ['legacy-a@s1', 'c058b3b37bfb0061a731b5cc00a1f62c221bcfc53c0a5b36b26f4f315f051f67'],
      ['legacy-b@s2', 'f321b169870be04ccab39ab0ad7a7b5612a9fd1c6050895b3d462779d3a4c761'],
      ['legacy-c@s3', '02a93949faf5ea32632d03b86200076d214eac1f9936e16791358d06a10c33cb'],
      ['legacy-d@s4', 'b1882e181bd0f410aa246364b422f2d15d120429490dc6cc2445d3d025ad3fc2'],
    ]
    for (const [seed, hash] of golden) {
      const item = resolveItem(`i:matrices:1.2.0:${seed}`)
      expect(item?.item_id).toBe(`i:matrices:1.2.0:${seed}`)
      expect(createHash('sha256').update(canonicalJson(item)).digest('hex'), seed).toBe(hash)
    }
  })

  it('1.3.0 makes the same content as 1.2.0 for the natural pool and strata 1–4', () => {
    const digest = (fam: typeof matrices): string => {
      const h = createHash('sha256')
      for (let i = 0; i < 400; i++) {
        const it = fam.generate(i % 5 === 0 ? `g-${i}` : `g-${i}@s${i % 5}`)
        h.update(canonicalJson({ spec: it.spec, key: it.key, sp: it.structural_params, d: it.difficulty, t: it.expected_time_s, s: it.stratum, fid: it.family_id }))
      }
      return h.digest('hex')
    }
    const want = 'fb7e7accfe507f7a5abd9a62fd4ffe2febb12c738c6665149f335e8098b1cbcf' // recorded from the 1.2.0 build
    expect(digest(legacy)).toBe(want)
    expect(digest(matrices)).toBe(want)
  })
})
