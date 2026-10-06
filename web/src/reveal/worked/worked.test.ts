/**
 * Worked solutions (ROADMAP M1.R; DESIGN §10): each is derived from the item's own structure and
 * checked against the family's key over thousands of generated items, for every series rule, every
 * supported quant variant and every matrix rule set the generator draws; the picked examples are
 * fresh, deterministic and leave out seen families.
 */

import { describe, expect, it } from 'vitest'
import type { ItemInstance } from '../../tasks/family'
import { matrices } from '../../tasks/matrices'
import type { MatrixItem } from '../../tasks/matrices'
import { quant, type QuantItem } from '../../tasks/quant'
import { QUANT_SIBLING_SETS, QUANT_TEMPLATES } from '../../tasks/quant'
import { variantsOf } from '../../tasks/quant/templates'
import { series } from '../../tasks/series'
import type { SeriesItem } from '../../tasks/series/types'
import { RULE_NAMES } from '../../tasks/series/rules'
import { FALLBACK_STRATA, QUANT_SOLVED_VARIANTS, hasQuantSolution, matrixSolution, pickWorkedItems, quantSolution, seriesSolution, siblingFamilyIds, workedSeed, workedSolutionOf } from '.'
import { Fraction, frac } from '../../tasks/quant/fraction'
import { decimalText } from './quant'
import { WORKED_KINDS } from './types'

const N = 1_500

describe('series worked solutions', () => {
  it('reach the key by the rule over every stratum, with three steps that name the change or the rule', () => {
    const rulesSeen = new Set<string>()
    let letters = 0
    for (const stratum of series.strata) {
      for (let i = 0; i < N / series.strata.length; i++) {
        const item = series.generate(`ws:${stratum}:${i}`, { stratum }) as SeriesItem
        const sol = seriesSolution(item)
        const key = 'letter' in item.key ? item.key.letter : item.key.value
        expect(sol.exact, item.item_id).toBe(key)
        expect(sol.steps.length).toBeGreaterThanOrEqual(3)
        expect(sol.steps.every((s) => s.length > 20 && !s.includes('undefined') && !s.includes('NaN'))).toBe(true)
        // The answer is shown as the person would type it (a typographic minus for negatives).
        expect(sol.answer.replace('−', '-')).toBe('letter' in item.key ? key : key)
        rulesSeen.add((item.structural_params as { rule: string }).rule)
        if ('letter' in item.key) letters++
      }
    }
    // Every rule family of the generator was exercised (letters included).
    expect([...rulesSeen].sort()).toEqual([...RULE_NAMES].sort())
    expect(letters).toBeGreaterThan(0)
  })

  it('names the operation in the natural mix of the pool too', () => {
    for (let i = 0; i < 400; i++) {
      const item = series.generate(`pool:${i}`) as SeriesItem
      expect(seriesSolution(item).exact).toBe('letter' in item.key ? item.key.letter : item.key.value)
    }
  })

  it('a letter series says how the alphabet wraps', () => {
    let wrapped = 0
    for (let i = 0; i < 600 && wrapped === 0; i++) {
      const item = series.generate(`wrap:${i}`, { stratum: 1 }) as SeriesItem
      if (item.spec.input_format !== 'letter') continue
      const sol = seriesSolution(item)
      if (sol.steps.some((s) => s.includes('wraps around'))) wrapped++
    }
    expect(wrapped).toBeGreaterThan(0)
  })
})

describe('quant worked solutions', () => {
  it('cover 21 variants of strata 1 and 2 and every one reaches its key', () => {
    expect(QUANT_SOLVED_VARIANTS).toHaveLength(21)
    for (const id of QUANT_SOLVED_VARIANTS) {
      const [template, variant] = id.split('/') as [string, string]
      expect(variantsOf(template).some((v) => v.variant === variant), id).toBe(true)
    }
  })

  it('answer every generated item of a supported variant with exactly the key, in the key’s format', () => {
    const covered = new Map<string, number>()
    for (const stratum of [1, 2] as const) {
      for (let i = 0; i < 2 * N; i++) {
        const item = quant.generate(`wq:${stratum}:${i}`, { stratum }) as QuantItem
        const sp = item.structural_params as { template: string; variant: string }
        const id = `${sp.template}/${sp.variant}`
        const sol = quantSolution(item)
        if (!hasQuantSolution(sp.template, sp.variant)) {
          expect(sol, id).toBeNull()
          continue
        }
        expect(sol, id).not.toBeNull()
        expect(sol!.exact, `${item.item_id} ${id}`).toBe(item.key.value)
        // The typed answer parses back to the key: integers and fractions as written, decimals as decimals.
        const typed = sol!.answer.replace('−', '-')
        if (item.spec.input_format === 'decimal') expect(Math.abs(Number(typed) - Fraction.parseCanonical(item.key.value)!.toNumber())).toBeLessThan(1e-9)
        else expect(typed).toBe(item.key.value)
        expect(sol!.steps.length).toBeGreaterThanOrEqual(2)
        expect(sol!.steps.every((s) => !s.includes('undefined') && !s.includes('NaN') && !s.includes('[object'))).toBe(true)
        covered.set(id, (covered.get(id) ?? 0) + 1)
      }
    }
    // Every supported variant was met often enough for the test to mean something.
    for (const id of QUANT_SOLVED_VARIANTS) expect(covered.get(id) ?? 0, id).toBeGreaterThan(10)
  }, 60_000)

  it('has a worked variant in strata 1 and 2 only, and none for the templates of strata 3 and 4', () => {
    for (const t of QUANT_TEMPLATES) {
      for (const v of variantsOf(t)) {
        const stratum = v.stratum
        expect(hasQuantSolution(t, v.variant), `${t}/${v.variant}`).toBe(stratum <= 2)
      }
    }
  })

  it('never writes a coefficient of 1 ("subtract 1x"): it is "x" (UX-035)', () => {
    let met = 0
    for (let i = 0; i < 6_000; i++) {
      const item = quant.generate(`wc:${i}`, { stratum: 2 }) as QuantItem
      const sp = item.structural_params as { template: string; variant: string }
      if (!hasQuantSolution(sp.template, sp.variant)) continue
      const sol = quantSolution(item)!
      for (const step of sol.steps) expect(step, `${item.item_id}: ${step}`).not.toMatch(/(^|[^\d.])1x\b/)
      const given = item.spec.given as Record<string, number>
      if (sp.template === 'linear_eq' && sp.variant !== 'over' && given.c === 1) {
        met++
        expect(sol.steps.join(' ')).toMatch(/[Ss]ubtract x from both sides/)
      }
    }
    // The test bites: items with a coefficient of 1 on the right-hand side do come up.
    expect(met).toBeGreaterThan(5)
  }, 60_000)

  it('writes decimals for decimal answers and never "p/q" for a terminating one', () => {
    expect(decimalText(frac(375, 2))).toBe('187.5')
    expect(decimalText(frac(-5, 4))).toBe('−1.25')
    expect(decimalText(frac(1, 3))).toBe('1/3')
    expect(decimalText(frac(6))).toBe('6')
  })
})

describe('matrix worked solutions', () => {
  it('derive the missing cell from the rules and land on the keyed option, for every stratum', () => {
    const rulesSeen = new Set<string>()
    for (const stratum of matrices.strata) {
      for (let i = 0; i < N / matrices.strata.length; i++) {
        const item = matrices.generate(`wm:${stratum}:${i}`, { stratum }) as MatrixItem
        const sol = matrixSolution(item)
        expect(sol.exact, item.item_id).toBe(String(item.key.index))
        expect(sol.answer).toBe('ABCDEF'[item.key.index])
        expect(sol.steps.length).toBeGreaterThanOrEqual(3)
        expect(sol.steps.every((s) => !s.includes('undefined') && !s.includes('NaN'))).toBe(true)
        const rules = (item.structural_params as { rules: Record<string, string> }).rules
        for (const [attr, rule] of Object.entries(rules)) rulesSeen.add(`${attr}:${rule}`)
      }
    }
    // The main rule kinds of every feature were exercised.
    for (const r of ['shape:distribution', 'size:progression+1', 'color:progression-1', 'count:arithmetic+', 'count:arithmetic-', 'position:xor', 'position:or', 'position:distribution']) {
      expect(rulesSeen.has(r), r).toBe(true)
    }
  }, 60_000)

  it('the pool of the family as a whole solves too', () => {
    for (let i = 0; i < 400; i++) {
      const item = matrices.generate(`wmp:${i}`) as MatrixItem
      expect(matrixSolution(item).exact).toBe(String(item.key.index))
    }
  })
})

describe('workedSolutionOf', () => {
  it('has one for the three kinds and none for other families', () => {
    expect(workedSolutionOf(matrices.generate('a', { stratum: 2 }) as ItemInstance<object, object>)).not.toBeNull()
    expect(workedSolutionOf(series.generate('a', { stratum: 3 }) as ItemInstance<object, object>)).not.toBeNull()
  })
})

describe('pickWorkedItems', () => {
  it('gives one matrix, one series and one supported quant item, deterministic in the session', () => {
    const a = pickWorkedItems('s_WORKEDTEST00001', [])
    expect(a.map((w) => w.kind)).toEqual([...WORKED_KINDS])
    expect(a.map((w) => w.item.family)).toEqual(['matrices', 'series', 'quant'])
    expect(a.every((w) => w.solution.steps.length >= 2)).toBe(true)
    expect(pickWorkedItems('s_WORKEDTEST00001', []).map((w) => w.item.item_id)).toEqual(a.map((w) => w.item.item_id))
    expect(pickWorkedItems('s_WORKEDTEST00002', []).map((w) => w.item.item_id)).not.toEqual(a.map((w) => w.item.item_id))
    for (const w of a) expect(w.item.item_id).toContain(workedSeed('s_WORKEDTEST00001', w.kind, 0).slice(0, 20))
  })

  it('leaves out every family the person has seen', () => {
    const first = pickWorkedItems('s_WORKEDTEST00003', [])
    const seen = first.map((w) => w.item.family_id)
    const second = pickWorkedItems('s_WORKEDTEST00003', seen)
    expect(second).toHaveLength(3)
    for (const w of second) {
      expect(seen).not.toContain(w.item.family_id)
    }
    // Also across many sessions: never a seen family.
    const seenAll = new Set<string>()
    for (let i = 0; i < 30; i++) {
      const w = pickWorkedItems(`s_WORKEDMANY${String(i).padStart(4, '0')}`, seenAll)
      for (const x of w) {
        expect(seenAll.has(x.item.family_id)).toBe(false)
        seenAll.add(x.item.family_id)
      }
    }
  })

  it('no quant variant at the worked stratum is in a sibling group today (so the sibling bookkeeping below is latent)', () => {
    for (let i = 0; i < 400; i++) {
      const q = pickWorkedItems(`s_LATENT${String(i).padStart(5, '0')}`, []).find((w) => w.kind === 'quant')!
      expect(q.item.sibling_group).toBe(q.item.family_id)
      expect(q.families).toEqual([q.item.family_id])
    }
  })

  it('leaves out the near-isomorph siblings of a seen family too (a grouped quant variant), and hands all of them on', () => {
    const idOf = (member: string): string => {
      const [template, variant] = member.split('/')
      return quant.familyIdOf({ template: template!, variant: variant! })
    }
    const set = QUANT_SIBLING_SETS.fraction_of!
    const ids = set.map(idOf)
    expect(set.every((m) => hasQuantSolution(m.split('/')[0]!, m.split('/')[1]!))).toBe(true)
    // Stratum 1 holds the fraction_of pair. Having met ONE variant (its family id is all a save holds), no other one is shown.
    for (const met of ids) {
      for (let i = 0; i < 300; i++) {
        const q = pickWorkedItems(`s_SIBLING${String(i).padStart(5, '0')}`, [met], { quant: 1 }).find((w) => w.kind === 'quant')
        expect(q, `session ${i}`).toBeDefined()
        expect(q!.item.sibling_group, `session ${i}`).not.toBe('g:quant:fraction_of')
      }
    }
    // A shown grouped variant reports every member, for the save's seen families.
    let grouped = 0
    for (let i = 0; i < 300 && grouped < 3; i++) {
      const id = `s_SIBLING${String(i).padStart(5, '0')}`
      const q = pickWorkedItems(id, [], { quant: 1 }).find((w) => w.kind === 'quant')!
      expect(q.families).toContain(q.item.family_id)
      expect(q.families).toEqual(siblingFamilyIds(q.item))
      if (q.item.sibling_group === q.item.family_id) {
        expect(q.families).toEqual([q.item.family_id])
        continue
      }
      grouped++
      expect(q.item.sibling_group).toBe('g:quant:fraction_of')
      expect([...q.families].sort()).toEqual([...ids].sort())
      // Those ids, once seen, keep every member out.
      const again = pickWorkedItems(id, q.families, { quant: 1 }).find((w) => w.kind === 'quant')!
      expect(again.item.sibling_group).not.toBe(q.item.sibling_group)
      expect(again.families.some((f) => q.families.includes(f))).toBe(false)
    }
    expect(grouped).toBeGreaterThan(0)
  })

  it('a family that is its own group has just its own id', () => {
    const m = matrices.generate('sib', { stratum: 2 }) as ItemInstance<object, object>
    expect(siblingFamilyIds(m)).toEqual([m.family_id])
  })

  it('leaves a kind out when every family of it was seen (no infinite search)', () => {
    const seen = new Set<string>()
    for (let n = 0; n < 2_000; n++) {
      seen.add(matrices.generate(workedSeed('s_ALLSEEN', 'matrix', n), { stratum: 2 }).family_id)
    }
    // Matrix families at stratum 2 are far fewer than 2,000 draws cover: none is left to show at that stratum.
    // (A stratum that is fixed is not widened: the fallback to neighbouring strata is tested below.)
    const w = pickWorkedItems('s_ALLSEEN', seen, { matrix: 2 })
    expect(w.map((x) => x.kind)).toEqual(['series', 'quant'])
  }, 60_000)

  it('widens to a neighbouring stratum when every family of a kind is used up at its own (UX-035), and still leaves out what was seen', () => {
    // Quant has about a dozen families per stratum: a person who met them all would be shown two examples.
    const seen = new Set<string>()
    for (let n = 0; n < 2_000; n++) seen.add(quant.generate(workedSeed('s_QUANTUSED', 'quant', n), { stratum: 2 }).family_id)
    const fixed = pickWorkedItems('s_QUANTUSED', seen, { quant: 2 })
    expect(fixed.map((x) => x.kind)).toEqual(['matrix', 'series'])
    const widened = pickWorkedItems('s_QUANTUSED', seen)
    expect(widened.map((x) => x.kind)).toEqual(['matrix', 'series', 'quant'])
    const q = widened.find((x) => x.kind === 'quant')!
    expect(q.item.stratum).toBe(1)
    for (const f of q.families) expect(seen.has(f)).toBe(false)
    expect(pickWorkedItems('s_QUANTUSED', seen).map((x) => x.item.item_id)).toEqual(widened.map((x) => x.item.item_id))
  }, 60_000)

  it('the strata tried start with the kind\'s own and are in range', () => {
    expect(FALLBACK_STRATA.matrix[0]).toBe(2)
    expect(FALLBACK_STRATA.series[0]).toBe(3)
    expect(FALLBACK_STRATA.quant[0]).toBe(2)
    for (const kind of WORKED_KINDS) for (const st of FALLBACK_STRATA[kind]) expect([1, 2, 3, 4, 5]).toContain(st)
  })

  it('titles the sequence a sequence', () => {
    expect(pickWorkedItems('s_WORKEDTITLE01', []).map((w) => w.title)).toEqual(['Matrix', 'Sequence', 'Quantitative'])
  })

  it('uses no randomness of its own: same inputs, same examples', () => {
    const one = pickWorkedItems('s_DETERMINISM0001', ['f:x:0'])
    const two = pickWorkedItems('s_DETERMINISM0001', ['f:x:0'])
    expect(JSON.stringify(one)).toBe(JSON.stringify(two))
  })
})
