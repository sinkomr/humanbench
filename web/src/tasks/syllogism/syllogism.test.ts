import fc from 'fast-check'
import { describe, expect, it } from 'vitest'
import { MalformedResponseError, validateItemInstance } from '../family'
import { stratumOfB } from '../priors'
import { runFamilyProperties, type FamilyPropertyOptions } from '../testing'
import { SYLLOGISM_ITEM_TYPE, specProblems, syllogism, syllogismSpecLeaksKey, type SyllogismItem, type SyllogismKey, type SyllogismResponse, type SyllogismSpec } from '.'
import { readSpec } from './item'
import { INTRO, NONCE_WORDS, QUESTION_TEXT, SCENES, phraseOf, plural } from './lexicon'
import {
  allCatStatements,
  allCondOptions,
  catEntails,
  catSat,
  catText,
  condEntails,
  condSat,
  condText,
  distractorType,
  negates,
  parseCat,
  parseCond,
  structureOf,
  type CatStatement,
  type CondStatement,
  type Lit,
  type Reading,
} from './logic'
import { SYLLOGISM_PRIOR, syllogismBPrior } from './prior'

/**
 * A11: family_id = the logical structure up to renaming. Two-statement syllogisms and short conditionals have a small
 * structure space (a few hundred shapes), so many items share one; the chains and longer conditionals rarely do.
 */
const STRUCTURE_SPACE = { min: 0.25, reason: 'small structure space of the two-statement syllogisms and one-step conditionals (A11: family_id = logical structure up to renaming)' }

const OPTS: FamilyPropertyOptions<SyllogismSpec, SyllogismKey, SyllogismResponse> = {
  specLeaksKey: syllogismSpecLeaksKey,
  familyIdRatio: STRUCTURE_SPACE,
  correctResponse: (item) => item.key.index,
  incorrectResponse: (item) => (item.key.index + 1) % 5,
  malformedResponses: () => [-1, 5, 1.5, '0', [0], false],
}

/** TS-computed family_ids (the bank twin pins the same three in tests/gen/test_syllogism.py). */
export const FAMILY_ID_VECTORS = [
  {
    sp: { template: 'categorical', question: 'must_true', n_terms: 3, premises: [['A', 0, 1], ['A', 1, 2]], conclusion: ['A', 0, 2] },
    id: 'f:syllogism:620be3064c58',
  },
  {
    sp: { template: 'conditional', question: 'must_true', n_terms: 3, premises: [['fact', 0], ['if', 0, 2]], conclusion: ['fact', 2] },
    id: 'f:syllogism:ac6c6a12a611',
  },
  {
    sp: { template: 'chain', question: 'must_false', n_terms: 5, premises: [['A', 0, 1], ['A', 1, 2], ['E', 2, 3], ['I', 3, 4]], conclusion: ['A', 4, 0] },
    id: 'f:syllogism:dbd640738273',
  },
] as const

/** The first item of a template and question among requested-stratum seeds. */
function sampleOf(template: string, question: string, stratum?: number): SyllogismItem {
  for (let i = 0; i < 3000; i++) {
    const s = stratum ?? (i % 6) + 1
    const it = syllogism.generate(`sample-${template}-${question}-${i}`, { stratum: s })
    if (it.difficulty.features.template === template && it.difficulty.features.question === question) return it
  }
  throw new Error(`no ${template}/${question} item`)
}

describe('syllogism family', () => {
  it('passes runFamilyProperties at n = 10,000 (natural pool)', () => {
    const r = runFamilyProperties(syllogism, OPTS)
    expect(r.n).toBe(10_000)
    expect(r.distinctItemIds).toBe(10_000)
    for (const s of [1, 2, 3, 4, 5, 6] as const) expect(r.strataCounts[s]).toBeGreaterThan(1_400)
    expect(r.distinctContents).toBeGreaterThan(9_900)
    expect(r.bPrior.min).toBeGreaterThanOrEqual(-2.0)
    expect(r.bPrior.max).toBeLessThanOrEqual(4)
  }, 600_000)

  it('passes with every stratum requested (n = 2,000)', () => {
    const r = runFamilyProperties(syllogism, { ...OPTS, n: 2_000, strata: syllogism.strata, seedPrefix: 'strata-' })
    for (const s of [1, 2, 3, 4, 5, 6] as const) expect(r.strataCounts[s]).toBeGreaterThanOrEqual(333)
  }, 300_000)

  it('is a 5-option text item on LR, facet formal_logic, 2PL (A9), with the shared time cap', () => {
    const it = syllogism.generate('identity')
    expect(syllogism.axis).toBe('LR')
    expect(syllogism.facets).toEqual(['formal_logic'])
    expect(syllogism.kind).toBe('item')
    expect(it.item_type).toBe(SYLLOGISM_ITEM_TYPE)
    expect(it.options_count).toBe(5)
    expect(it.params.model).toBe('2pl')
    expect(validateItemInstance(it, syllogism)).toEqual([])
    expect(it.expected_time_s).toBeGreaterThan(0)
  })

  it('reaches every template in strata 1–3 and the hard questions in strata 4–6', () => {
    const seen = new Map<number, Set<string>>()
    for (let i = 0; i < 600; i++) {
      const s = (i % 6) + 1
      const it = syllogism.generate(`reach-${i}`, { stratum: s })
      const f = it.difficulty.features
      const set = seen.get(s) ?? new Set<string>()
      set.add(String(f.template))
      set.add(String(f.question))
      seen.set(s, set)
    }
    expect([...(seen.get(1) ?? [])].sort()).toEqual(['categorical', 'conditional', 'must_true'])
    for (const s of [2, 3]) for (const t of ['categorical', 'chain', 'conditional']) expect(seen.get(s)?.has(t), `s${s} ${t}`).toBe(true)
    for (const s of [4, 5, 6]) for (const q of ['could_true', 'must_false']) expect(seen.get(s)?.has(q), `s${s} ${q}`).toBe(true)
  }, 60_000)

  it('makes every template × question, each verified', () => {
    for (const t of ['categorical', 'chain', 'conditional']) {
      for (const q of ['must_true', 'could_true', 'must_false']) {
        const it = sampleOf(t, q)
        const v = syllogism.verify(it)
        expect(v.ok, `${t}/${q}: ${v.reason}`).toBe(true)
        expect(it.spec.question).toBe(QUESTION_TEXT[q as keyof typeof QUESTION_TEXT])
        expect(it.spec.intro === INTRO).toBe(t !== 'conditional')
        expect(specProblems(it.spec)).toEqual([])
      }
    }
  }, 60_000)

  it('pins the family_ids of three structures (parity vectors for the bank twin)', () => {
    for (const v of FAMILY_ID_VECTORS) expect(syllogism.familyIdOf(v.sp as never)).toBe(v.id)
  })

  it('pins stratum 1: "All A are B. All B are C." must be true is b = −2.0', () => {
    expect(syllogismBPrior({ conditional: false, n_premises: 2, negative_premises: 0, particular_premises: 0, bent_links: 0, scrambled: false, could_true: false, must_false: false, key_particular: false, key_negative: false, key_conditional: false, only_if: 0, unless: 0, either_or: 0, negated_literals: 0 })).toBe(-2)
    expect(Object.keys(SYLLOGISM_PRIOR.terms)).toHaveLength(15)
  })

  it('scores the key 1, any other option 0, and throws MalformedResponseError on a non-index', () => {
    const it = syllogism.generate('score')
    expect(syllogism.score(it, it.key.index).correct).toBe(1)
    for (let i = 0; i < 5; i++) if (i !== it.key.index) expect(syllogism.score(it, i).correct).toBe(0)
    for (const bad of [-1, 5, 0.5, '1', null, undefined, [1], {}]) expect(() => syllogism.score(it, bad as never)).toThrow(MalformedResponseError)
  })
})

describe('syllogism semantics are exact', () => {
  const words = ['blicket', 'florp', 'grenick', 'plimmet', 'snorvel', 'quindle']

  /** Brute force: every set of non-empty regions over n terms (2^(2^n) models), optionally with every term non-empty. */
  function bruteEntails(n: number, premises: readonly CatStatement[], s: CatStatement, reading: Reading): boolean {
    const holds = (model: number, st: CatStatement): boolean => {
      let some = false
      let all = true
      for (let r = 0; r < 2 ** n; r++) {
        if (((model >> r) & 1) === 0) continue
        const inX = ((r >> st.x) & 1) === 1
        const inY = ((r >> st.y) & 1) === 1
        if (inX && inY) some = true
        if (inX && !inY) all = false
        if (st.form === 'O' && inX && !inY) return true
      }
      if (st.form === 'A') return all
      if (st.form === 'E') return !some
      if (st.form === 'I') return some
      return false
    }
    for (let model = 0; model < 2 ** 2 ** n; model++) {
      if (reading === 1) {
        let ok = true
        for (let t = 0; t < n; t++) {
          let has = false
          for (let r = 0; r < 2 ** n; r++) if (((model >> r) & 1) === 1 && ((r >> t) & 1) === 1) has = true
          if (!has) ok = false
        }
        if (!ok) continue
      }
      if (premises.every((p) => holds(model, p)) && !holds(model, s)) return false
    }
    return true
  }

  it('categorical entailment agrees with brute-force model enumeration over 3 terms (256 models), both readings', () => {
    const stmts = allCatStatements(3)
    const arb = fc.record({
      p: fc.array(fc.constantFrom(...stmts), { minLength: 1, maxLength: 3 }),
      s: fc.constantFrom(...stmts),
      r: fc.constantFrom<Reading>(0, 1),
    })
    fc.assert(
      fc.property(arb, ({ p, s, r }) => {
        expect(catEntails(3, p, s, r)).toBe(bruteEntails(3, p, s, r))
      }),
      { numRuns: 1500, seed: 7 },
    )
  })

  it('knows the textbook syllogisms, including the ones valid only with existential import', () => {
    const A = (x: number, y: number): CatStatement => ({ form: 'A', x, y })
    const E = (x: number, y: number): CatStatement => ({ form: 'E', x, y })
    const I = (x: number, y: number): CatStatement => ({ form: 'I', x, y })
    const O = (x: number, y: number): CatStatement => ({ form: 'O', x, y })
    // S = 0, M = 1, P = 2
    const both = (p: CatStatement[], c: CatStatement): boolean[] => [catEntails(3, p, c, 0), catEntails(3, p, c, 1)]
    expect(both([A(1, 2), A(0, 1)], A(0, 2))).toEqual([true, true]) // Barbara
    expect(both([E(1, 2), A(0, 1)], E(0, 2))).toEqual([true, true]) // Celarent
    expect(both([A(1, 2), I(0, 1)], I(0, 2))).toEqual([true, true]) // Darii
    expect(both([E(1, 2), I(0, 1)], O(0, 2))).toEqual([true, true]) // Ferio
    expect(both([A(2, 1), O(0, 1)], O(0, 2))).toEqual([true, true]) // Baroco
    expect(both([A(1, 2), A(1, 0)], I(0, 2))).toEqual([false, true]) // Darapti: only with import
    expect(both([A(1, 2), A(0, 1)], I(0, 2))).toEqual([false, true]) // Barbari: only with import
    expect(both([A(2, 1), A(0, 1)], A(0, 2))).toEqual([false, false]) // undistributed middle
    expect(both([A(1, 2), E(0, 1)], E(0, 2))).toEqual([false, false]) // illicit major
    expect(catSat(3, [A(0, 1), E(0, 1)], 0)).toBe(true) // possible only with no members of 0
    expect(catSat(3, [A(0, 1), E(0, 1)], 1)).toBe(false)
  })

  it('reads conditionals as stated: if, only if, unless (= if not), inclusive or', () => {
    const p: Lit = { atom: 0, neg: false }
    const q: Lit = { atom: 1, neg: false }
    const not = (l: Lit): Lit => ({ atom: l.atom, neg: !l.neg })
    const fact = (a: Lit): CondStatement => ({ form: 'fact', a })
    const ifThen: CondStatement = { form: 'if', a: p, b: q }
    expect(condEntails(2, [ifThen, fact(p)], fact(q))).toBe(true) // modus ponens
    expect(condEntails(2, [ifThen, fact(not(q))], fact(not(p)))).toBe(true) // modus tollens
    expect(condEntails(2, [ifThen, fact(q)], fact(p))).toBe(false) // affirming the consequent
    expect(condEntails(2, [ifThen, fact(not(p))], fact(not(q)))).toBe(false) // denying the antecedent
    expect(condEntails(2, [{ form: 'only_if', a: p, b: q }, fact(p)], fact(q))).toBe(true)
    expect(condEntails(2, [{ form: 'only_if', a: p, b: q }, fact(q)], fact(p))).toBe(false)
    expect(condEntails(2, [{ form: 'unless', a: p, b: q }, fact(not(q))], fact(p))).toBe(true) // p unless q: not q → p
    expect(condSat(2, [{ form: 'unless', a: p, b: q }, fact(q), fact(p)])).toBe(true) // not exclusive
    expect(condSat(2, [{ form: 'or', a: p, b: q }, fact(p), fact(q)])).toBe(true) // "or both"
    expect(condEntails(2, [{ form: 'or', a: p, b: q }, fact(not(p))], fact(q))).toBe(true)
    // The exclusive reading of "unless" (p exactly when not q): q now rules p out.
    expect(condSat(2, [{ form: 'unless', a: p, b: q }, fact(q), fact(p)], undefined, 1)).toBe(false)
    expect(condEntails(2, [{ form: 'unless', a: p, b: q }, fact(q)], fact(not(p)), 1)).toBe(true)
    expect(condEntails(2, [{ form: 'unless', a: p, b: q }, fact(q)], fact(not(p)), 0)).toBe(false)
  })

  it('keeps an "unless" item only when every option has one verdict under both readings of "unless"', () => {
    let seen = 0
    for (let i = 0; i < 3000 && seen < 40; i++) {
      const it = syllogism.generate(`unless-${i}`, { stratum: (i % 4) + 3 })
      if (Number(it.difficulty.features.unless) === 0) continue
      seen++
      const v = syllogism.verify(it)
      expect(v.ok, v.reason).toBe(true)
      for (const pair of v.checks.option_verdicts as boolean[][]) expect(pair[0]).toBe(pair[1])
    }
    expect(seen).toBe(40)
  }, 60_000)

  it('renders and parses every sentence form back to the same statement', () => {
    const cats = allCatStatements(4).map((s) => catText(s, words))
    const pc = parseCat(cats, [])
    if (typeof pc === 'string') throw new Error(pc)
    expect(pc.premises.map((x) => catText(x, pc.words))).toEqual(cats)
    for (const scene of SCENES) {
      const props = scene.propositions.slice(0, 4)
      const sts: CondStatement[] = [
        ...allCondOptions(4),
        { form: 'only_if', a: { atom: 0, neg: true }, b: { atom: 1, neg: false } },
        { form: 'unless', a: { atom: 2, neg: false }, b: { atom: 3, neg: false } },
        { form: 'or', a: { atom: 1, neg: true }, b: { atom: 2, neg: false } },
      ]
      const texts = sts.map((s) => condText(s, props))
      const parsed = parseCond(texts, [])
      if (typeof parsed === 'string') throw new Error(parsed)
      const back = parsed.premises.map((s) => condText(s, parsed.props.map((i) => scene.propositions[i] as (typeof scene.propositions)[number])))
      expect(back).toEqual(texts)
    }
    expect(typeof parseCat(['All blickets are cats.'], [])).toBe('string')
    expect(typeof parseCat(['No blickets are not florps.'], [])).toBe('string')
    expect(typeof parseCond(['If the lamp is on, then the train is late.'], [])).toBe('string') // two scenes
  })

  it('canonical structure is the same under any renaming of the terms and any premise order', () => {
    const stmts = allCatStatements(4)
    fc.assert(
      fc.property(
        fc.array(fc.constantFrom(...stmts), { minLength: 2, maxLength: 3 }),
        fc.constantFrom(...stmts),
        fc.shuffledSubarray([0, 1, 2, 3], { minLength: 4, maxLength: 4 }),
        (premises, key, perm) => {
          const rename = (s: CatStatement): CatStatement => ({ form: s.form, x: perm[s.x] as number, y: perm[s.y] as number })
          const a = structureOf('chain', 'must_true', { n: 4, premises }, key)
          const b = structureOf('chain', 'must_true', { n: 4, premises: [...premises].reverse().map(rename) }, rename(key))
          expect(b).toEqual(a)
        },
      ),
      { numRuns: 300, seed: 11 },
    )
  })
})

describe('syllogism lexicon', () => {
  it('has distinct lowercase made-up words with distinct plurals and enough first letters for six terms', () => {
    expect(new Set(NONCE_WORDS).size).toBe(NONCE_WORDS.length)
    for (const w of NONCE_WORDS) expect(w).toMatch(/^[a-z]{4,8}$/)
    expect(new Set(NONCE_WORDS.map(plural)).size).toBe(NONCE_WORDS.length)
    expect(new Set(NONCE_WORDS.map((w) => w[0])).size).toBeGreaterThanOrEqual(12)
  })

  it('has neutral propositions about things, six per scene, every phrase unique and free of the sentence keywords', () => {
    const phrases = SCENES.flatMap((s) => s.propositions.flatMap((p) => [phraseOf(p, false), phraseOf(p, true)]))
    expect(new Set(phrases).size).toBe(phrases.length)
    for (const s of SCENES) expect(s.propositions).toHaveLength(6)
    for (const p of phrases) expect(p).not.toMatch(/,| only if | unless |\bif\b|\bthen\b|\beither\b|\bor\b|\./)
  })
})

describe('syllogism verifier rejects tampered items', () => {
  const items = ['categorical', 'chain', 'conditional'].flatMap((t) => ['must_true', 'could_true', 'must_false'].map((q) => sampleOf(t, q)))
  type Mutable<T> = { -readonly [K in keyof T]: T[K] }
  type MutableItem = Mutable<Omit<SyllogismItem, 'spec'>> & { spec: Mutable<SyllogismSpec> }
  const tamper = (it: SyllogismItem, f: (c: MutableItem) => void): SyllogismItem => {
    const c = structuredClone(it) as never
    f(c)
    return c
  }

  it('accepts the untouched items and records both readings per option', () => {
    for (const it of items) {
      const v = syllogism.verify(it)
      expect(v.ok, v.reason).toBe(true)
      expect(v.checks.option_verdicts).toHaveLength(5)
      expect(v.checks.distractor_types).toHaveLength(4)
    }
  })

  it('rejects a wrong key, swapped options and a moved key', () => {
    for (const it of items) {
      expect(syllogism.verify({ ...it, key: { index: (it.key.index + 1) % 5 } }).ok).toBe(false)
      const j = (it.key.index + 2) % 5
      const swapped = tamper(it, (c) => {
        const o = [...c.spec.options]
        ;[o[it.key.index], o[j]] = [o[j] as string, o[it.key.index] as string]
        c.spec.options = o
      })
      expect(syllogism.verify(swapped).ok).toBe(false)
    }
  })

  it('rejects a broken structure, edited features or prior, and a changed premise', () => {
    for (const it of items) {
      expect(syllogism.verify(tamper(it, (c) => void (c.structural_params = { ...(c.structural_params as object), question: 'other' }))).ok).toBe(false)
      expect(syllogism.verify(tamper(it, (c) => void (c.difficulty = { ...c.difficulty, b_prior: c.difficulty.b_prior + 0.01 }))).ok).toBe(false)
      expect(syllogism.verify(tamper(it, (c) => void (c.difficulty = { ...c.difficulty, features: { ...c.difficulty.features, n_premises: 9 } }))).ok).toBe(false)
      expect(syllogism.verify(tamper(it, (c) => void (c.expected_time_s = c.expected_time_s + 1))).ok).toBe(false)
      // Drop a premise: the logic changes (and the structure no longer matches).
      expect(syllogism.verify(tamper(it, (c) => void (c.spec.premises = c.spec.premises.slice(1)))).ok).toBe(false)
    }
  })

  it('rejects unreadable text, a duplicated option, a wrong intro and a wrong question line', () => {
    const it = items[0] as SyllogismItem
    const bad = (f: Parameters<typeof tamper>[1]) => syllogism.verify(tamper(it, f))
    expect(bad((c) => void (c.spec.premises = ['All blickets are cats.', ...c.spec.premises.slice(1)])).checks.reads_back).toBe(false)
    expect(bad((c) => void (c.spec.options = [c.spec.options[0] as string, ...c.spec.options.slice(0, 4)])).ok).toBe(false)
    expect(bad((c) => void (c.spec.intro = 'Words.')).ok).toBe(false)
    expect(bad((c) => void (c.spec.question = 'Which is it?')).ok).toBe(false)
    expect(bad((c) => void (c.spec.options = c.spec.options.slice(0, 4))).ok).toBe(false)
  })

  it('rejects an option that negates the key, and an option that restates a premise', () => {
    const it = sampleOf('categorical', 'must_true', 1)
    const read = readSpec(it.spec)
    if (typeof read === 'string' || read.logic.kind !== 'cat') throw new Error('not categorical')
    const key = read.logic.options[it.key.index] as CatStatement
    const flip = { A: 'O', E: 'I', I: 'E', O: 'A' } as const
    const parsed = parseCat(it.spec.premises, it.spec.options)
    if (typeof parsed === 'string') throw new Error(parsed)
    const notKey = catText({ form: flip[key.form], x: key.x, y: key.y }, parsed.words)
    expect(negates(read.logic, { form: flip[key.form], x: key.x, y: key.y }, key)).toBe(true)
    const j = (it.key.index + 1) % 5
    const withNot = tamper(it, (c) => {
      const o = [...c.spec.options]
      o[j] = notKey
      c.spec.options = o
    })
    expect(syllogism.verify(withNot).checks.no_option_negates_key).toBe(false)
    const restated = tamper(it, (c) => {
      const o = [...c.spec.options]
      o[j] = c.spec.premises[0] as string
      c.spec.options = o
    })
    expect(syllogism.verify(restated).checks.options_not_premises).toBe(false)
  })

  it('never throws on garbage', () => {
    const it = items[0] as SyllogismItem
    for (const spec of [null, {}, { premises: 'x' }, { ...it.spec, options: [1, 2, 3, 4, 5] }, { ...it.spec, premises: [] }]) {
      expect(syllogism.verify({ ...it, spec: spec as never }).ok).toBe(false)
    }
    expect(syllogism.verify({ ...it, key: { index: 'a' as never } }).ok).toBe(false)
  })

  it('labels every distractor with a reason, and the key answers under both readings', () => {
    for (const it of items) {
      const read = readSpec(it.spec)
      if (typeof read === 'string') throw new Error(read)
      const key = read.logic.options[it.key.index] as CatStatement
      const types = read.logic.options.filter((_, i) => i !== it.key.index).map((s) => distractorType(read.logic, key, s))
      expect(types.every((t) => t.length > 0)).toBe(true)
      expect(String(it.difficulty.features.distractor_types)).toBe([...types].sort().join(','))
      expect(stratumOfB(it.difficulty.b_prior)).toBe(it.stratum)
    }
  })
})
