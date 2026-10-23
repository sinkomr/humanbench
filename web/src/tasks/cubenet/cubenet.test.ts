/**
 * The cube-net family (DESIGN §3 row 7, §4.2; ROADMAP A1, A9, A11, M1.F): the shared property
 * suite at n = 10,000 and with requested strata, the geometry (two folding routes, the 24 views
 * of a cube, the 11 nets), the A11 structure, the verifier against tampered items, the prior and
 * the scorer.
 */

import fc from 'fast-check'
import { describe, expect, it } from 'vitest'
import { MalformedResponseError } from '../family'
import { canonicalJson } from '../ids'
import { stratumOfB } from '../priors'
import { runFamilyProperties } from '../testing'
import { cornersOf, foldByFrames } from './gen'
import { CUBENET_PRIOR, CUBENET_STRATA, MIRRORS_OF_STRATUM, cubenetBPrior, cubenetExpectedTime } from './prior'
import { MARKS, specProblems, type CubeView, type CubenetFeatures, type Mark } from './spec'
import { DIHEDRAL, KIND_MIRROR, KIND_OPPOSITE, NETS, netClassOf, place, structureOf, viewForm, type Cell } from './structure'
import { CUBE_ROTATIONS, foldByMatrices, impossibleReason, possibleView, verifyCubenet } from './verify'
import { cubenet, cubenetSpecLeaksKey, type CubenetItem } from '.'

const OPTS = {
  specLeaksKey: cubenetSpecLeaksKey,
  correctResponse: (item: CubenetItem) => item.key.index,
  incorrectResponse: (item: CubenetItem) => (item.key.index + 1) % 4,
  malformedResponses: () => [-1, 4, 1.5, '0', [0], null],
} as const

const features = (item: CubenetItem): CubenetFeatures => item.difficulty.features as unknown as CubenetFeatures

const clone = (item: CubenetItem): CubenetItem => JSON.parse(JSON.stringify(item)) as CubenetItem

describe('cubenet family: property suite', () => {
  it('passes runFamilyProperties at n = 10,000 (natural pool)', () => {
    const r = runFamilyProperties(cubenet, OPTS)
    expect(r.n).toBe(10_000)
    expect(r.distinctItemIds).toBe(10_000)
    expect(r.distinctContents).toBe(10_000)
    // A11 structures (net, key squares, distractor kinds and squares): ~7,400 of 10,000 distinct.
    expect(r.distinctFamilyIds).toBeGreaterThan(7_000)
    // Natural pool: n_mirror uniform 0–3 → strata ≈ 10 / 15 / 25 / 25 / 25%.
    expect(r.strataCounts[6]).toBe(0)
    for (const s of CUBENET_STRATA) expect(r.strataCounts[s]).toBeGreaterThan(700)
    expect(r.bPrior.min).toBeGreaterThanOrEqual(-1.65 - 1e-9)
    expect(r.bPrior.max).toBeLessThanOrEqual(2.45 + 1e-9)
  }, 180_000)

  it('passes with requested strata (n = 2,000 over strata 1–5)', () => {
    const r = runFamilyProperties(cubenet, { ...OPTS, n: 2_000, strata: cubenet.strata, seedPrefix: 'strat-' })
    expect(r.strataCounts).toEqual({ 1: 400, 2: 400, 3: 400, 4: 400, 5: 400, 6: 0 })
  }, 180_000)

  it('targets strata through the seed and refuses stratum 6', () => {
    for (const s of CUBENET_STRATA) {
      const item = cubenet.generate('demo', { stratum: s })
      expect(item.seed).toBe(`demo@s${s}`)
      expect(item.stratum).toBe(s)
      expect(features(item).n_mirror).toBe(MIRRORS_OF_STRATUM[s])
      expect(cubenet.generate(`demo@s${s}`)).toEqual(item)
    }
    expect(() => cubenet.generate('demo', { stratum: 6 })).toThrow(RangeError)
  })

  it('uses 3PL with c = 1/4 (A9), the shared 180 s cap and E[T] in 20–59 s', () => {
    for (let i = 0; i < 200; i++) {
      const item = cubenet.generate(`params-${i}`)
      expect(item.params).toEqual({ model: '3pl', a: 1, b: item.difficulty.b_prior, c: 0.25 })
      expect(item.time_limit_s).toBe(180)
      expect(item.expected_time_s).toBeGreaterThanOrEqual(20)
      expect(item.expected_time_s).toBeLessThanOrEqual(59)
      expect(Number.isInteger(item.expected_time_s)).toBe(true)
      expect(item.facet).toBe('cube_net')
      expect(item.axis).toBe('SPA')
    }
  })
})

describe('cubenet geometry', () => {
  const allPlacements = NETS.flatMap((n) => DIHEDRAL.map((_, t) => ({ cls: n.cls, cells: place(n.cells, t).sort((a, b) => a[0] - b[0] || a[1] - b[1]) })))

  it('has the 11 cube nets: 6 "141", 3 "231", 1 "222", 1 "33", pairwise different shapes', () => {
    expect(NETS.map((n) => n.cls).sort()).toEqual(['141', '141', '141', '141', '141', '141', '222', '231', '231', '231', '33'])
    for (const n of NETS) expect(netClassOf(n.cells)).toBe(n.cls)
    expect(netClassOf([[0, 0], [0, 1], [0, 2], [0, 3], [0, 4], [0, 5]])).toBeNull()
    expect(netClassOf([[0, 0], [0, 1], [1, 0], [1, 1], [2, 0], [2, 1]])).toBeNull()
  })

  it('folds every placement of every net to six different faces, the same by both routes', () => {
    for (const { cls, cells } of allPlacements) {
      const z = (vs: readonly (readonly number[])[] | null) => (vs ?? []).map((v) => v.map((x) => x + 0))
      const a = foldByFrames(cells)
      const b = foldByMatrices(cells)
      expect(z(b)).toEqual(z(a))
      expect(new Set(a.map((v) => v.join(','))).size).toBe(6)
      expect(netClassOf(cells)).toBe(cls)
    }
  })

  it('a hexomino that is not a cube net folds onto a repeated face', () => {
    const row = foldByMatrices([[0, 0], [0, 1], [0, 2], [0, 3], [0, 4], [0, 5]]) ?? []
    expect(new Set(row.map((v) => v.join(','))).size).toBeLessThan(6)
  })

  it('the 24 rotations are distinct proper signed permutations', () => {
    expect(CUBE_ROTATIONS).toHaveLength(24)
    expect(new Set(CUBE_ROTATIONS.map((m) => JSON.stringify(m))).size).toBe(24)
  })

  it('of the 120 ordered triples of marks exactly 24 are possible views (8 corners × 3 turns), by both routes', () => {
    for (const { cells } of allPlacements) {
      const n = foldByFrames(cells)
      let possible = 0
      let mirrors = 0
      let opposites = 0
      for (let a = 0; a < 6; a++)
        for (let b = 0; b < 6; b++)
          for (let c = 0; c < 6; c++) {
            if (a === b || a === c || b === c) continue
            const p = possibleView(n[a]!, n[b]!, n[c]!)
            const why = impossibleReason(n[a]!, n[b]!, n[c]!)
            expect(p).toBe(why === null)
            if (p) possible++
            else if (why === 'mirror') mirrors++
            else opposites++
          }
      expect([possible, mirrors, opposites]).toEqual([24, 24, 72])
    }
  })

  it('the generator\'s corners are the possible views (clockwise top → right → left)', () => {
    for (const { cells } of allPlacements) {
      const n = foldByFrames(cells)
      const corners = cornersOf(n)
      expect(corners).toHaveLength(8)
      for (const { squares: [a, b, c] } of corners) {
        // top = a, right = b, left = c
        expect(possibleView(n[a]!, n[c]!, n[b]!)).toBe(true)
        expect(possibleView(n[a]!, n[b]!, n[c]!)).toBe(false)
      }
    }
  })

  it('a worked example: the "141" net with a row of four folds as expected', () => {
    // Row 1: column 1: T; row 2: A B C D; row 3: column 1: U (0-based columns).
    const cells: Cell[] = [[0, 1], [1, 0], [1, 1], [1, 2], [1, 3], [2, 1]]
    const [t, a, b, c, d, u] = foldByMatrices(cells) as [number, number, number][]
    // T on top; folding down: B is the south face, U the bottom; A and C the west and east faces.
    expect([t, b, u, a, c].map((v) => v!.map((x) => x + 0))).toEqual([[0, 0, 1], [0, -1, 0], [0, 0, -1], [-1, 0, 0], [1, 0, 0]])
    expect(d!.map((x) => x + 0)).toEqual([0, 1, 0])
    // Seen from above the south-east corner: top T, front left B (south), front right C (east).
    expect(possibleView(t!, b!, c!)).toBe(true)
    expect(possibleView(t!, c!, b!)).toBe(false)
  })

  it('viewForm is invariant exactly under turning about the corner', () => {
    const v: CubeView = { top: 'ring', right: 'plus', left: 'dots' }
    expect(viewForm({ top: 'plus', right: 'dots', left: 'ring' })).toBe(viewForm(v))
    expect(viewForm({ top: 'dots', right: 'ring', left: 'plus' })).toBe(viewForm(v))
    expect(viewForm({ top: 'ring', right: 'dots', left: 'plus' })).not.toBe(viewForm(v))
  })

  it('structure is the same for every placement of the same item (fast-check)', () => {
    fc.assert(
      fc.property(fc.integer({ min: 0, max: 10_000 }), fc.integer({ min: 0, max: 7 }), (seed, t) => {
        const item = cubenet.generate(`placement-${seed}`)
        const cells = item.spec.net.map((q): Cell => [q.r, q.c])
        const sq = (m: Mark): number => item.spec.net.findIndex((q) => q.mark === m)
        const n = foldByMatrices(cells) as [number, number, number][]
        const key = item.spec.options[item.key.index] as CubeView
        const shapes = item.spec.options
          .filter((_, i) => i !== item.key.index)
          .map((o) => ({
            kind: (impossibleReason(n[sq(o.top)]!, n[sq(o.left)]!, n[sq(o.right)]!) === 'mirror' ? KIND_MIRROR : KIND_OPPOSITE) as 0 | 1,
            squares: [sq(o.top), sq(o.left), sq(o.right)],
          }))
        const moved = place(cells, t)
        const s = structureOf(moved, [sq(key.top), sq(key.left), sq(key.right)], shapes)
        expect(canonicalJson(s)).toBe(canonicalJson(item.structural_params))
      }),
      { numRuns: 300 },
    )
  })

  it('a reflected net makes the key a mirror view (marks outside, chirality matters)', () => {
    const item = cubenet.generate('reflect')
    const x = clone(item)
    const width = Math.max(...item.spec.net.map((q) => q.c))
    ;(x.spec as { net: unknown }).net = item.spec.net.map((q) => ({ ...q, c: width - q.c })).sort((a, b) => a.r - b.r || a.c - b.c)
    const v = verifyCubenet(x)
    expect(v.ok).toBe(false)
    expect(v.checks.key_is_possible).toBe(false)
  })
})

describe('cubenet verifier', () => {
  const item = cubenet.generate('tamper')
  const tamper = (f: (x: { -readonly [K in keyof CubenetItem]: unknown } & { spec: { net: unknown[]; options: unknown[] } }) => void): CubenetItem => {
    const x = clone(item) as unknown as { -readonly [K in keyof CubenetItem]: unknown } & { spec: { net: unknown[]; options: unknown[] } }
    f(x)
    return x as unknown as CubenetItem
  }

  it('accepts generated items (every stratum) and a JSON round trip', () => {
    for (const s of CUBENET_STRATA) for (let i = 0; i < 40; i++) expect(verifyCubenet(cubenet.generate(`v-${i}`, { stratum: s })).ok).toBe(true)
    expect(verifyCubenet(clone(item)).ok).toBe(true)
  })

  it('rejects a wrong key', () => {
    for (let d = 1; d < 4; d++) {
      const v = verifyCubenet(tamper((x) => (x.key = { index: (item.key.index + d) % 4 })))
      expect(v.ok).toBe(false)
      expect(v.reason).toMatch(/key_is_possible/)
    }
    expect(verifyCubenet(tamper((x) => (x.key = { index: 4 }))).reason).toMatch(/key_in_range/)
  })

  it('rejects swapped options without the key following (the key is a display position)', () => {
    const k = item.key.index
    const j = (k + 1) % 4
    const v = verifyCubenet(
      tamper((x) => {
        const o = x.spec.options
        ;[o[k], o[j]] = [o[j], o[k]]
      }),
    )
    expect(v.ok).toBe(false)
  })

  it('rejects a key turned into its mirror view (then no option is possible)', () => {
    const v = verifyCubenet(
      tamper((x) => {
        const o = x.spec.options[item.key.index] as CubeView
        x.spec.options[item.key.index] = { top: o.top, left: o.right, right: o.left }
      }),
    )
    expect(v.ok).toBe(false)
    expect(v.checks.unique_possible).toBe(false)
  })

  it('rejects a broken net, a mark not on the net, repeated views and malformed specs', () => {
    expect(verifyCubenet(tamper((x) => (x.spec.net = item.spec.net.map((q, i) => ({ ...q, r: i % 2, c: Math.floor(i / 2) }))))).reason).toMatch(/net_folds_to_cube|net_is_cube_net/)
    const unused = MARKS.find((m) => !item.spec.net.some((q) => q.mark === m)) as Mark
    expect(verifyCubenet(tamper((x) => (x.spec.options[(item.key.index + 1) % 4] = { top: unused, left: item.spec.net[0]!.mark, right: item.spec.net[1]!.mark }))).ok).toBe(false)
    const dup = verifyCubenet(
      tamper((x) => {
        const o = x.spec.options[item.key.index] as CubeView
        x.spec.options[(item.key.index + 1) % 4] = { top: o.right, right: o.left, left: o.top }
      }),
    )
    expect(dup.ok).toBe(false)
    expect(dup.checks.unique_possible).toBe(false)
    expect(verifyCubenet(tamper((x) => ((x as { spec: unknown }).spec = null))).ok).toBe(false)
    expect(verifyCubenet(tamper((x) => (x.spec = { net: [], options: [] }))).reason).toMatch(/well_formed/)
    expect(verifyCubenet(tamper((x) => (x.spec.options[0] = { top: 'ring', left: 'ring', right: 'plus' }))).ok).toBe(false)
  })

  it('rejects broken bookkeeping: structure, features, prior, stratum, time, params', () => {
    expect(verifyCubenet(tamper((x) => (x.structural_params = { net: [], key: [], distractors: [] }))).reason).toMatch(/structure_matches/)
    expect(verifyCubenet(tamper((x) => (x.difficulty = { ...item.difficulty, features: { ...item.difficulty.features, key_spread: 9 } }))).reason).toMatch(/features_match/)
    expect(verifyCubenet(tamper((x) => (x.difficulty = { ...item.difficulty, b_prior: item.difficulty.b_prior + 0.01 }))).reason).toMatch(/prior_matches/)
    expect(verifyCubenet(tamper((x) => (x.stratum = item.stratum === 5 ? 4 : item.stratum + 1))).reason).toMatch(/stratum_matches/)
    expect(verifyCubenet(tamper((x) => (x.expected_time_s = item.expected_time_s + 1))).reason).toMatch(/time_matches/)
    expect(verifyCubenet(tamper((x) => (x.params = { model: '2pl', a: 1, b: item.difficulty.b_prior }))).reason).toMatch(/params_match/)
    expect(verifyCubenet(tamper((x) => (x.family_id = 'f:cubenet:000000000000'))).reason).toMatch(/family_id_matches/)
  })

  it('detects the option-only cues it guards against', () => {
    // A hand-made item whose key is the only option with a shared mark set (key + its mirror, two singles).
    let found = false
    for (let i = 0; i < 400 && !found; i++) {
      const it = cubenet.generate(`cue-${i}`, { stratum: 3 })
      if (features(it).layout !== 'pairs') continue
      found = true
      const x = clone(it)
      const opts = x.spec.options as CubeView[]
      // Replace one of the opposite-pair twins by a different opposite-pair view of other marks.
      const keySet = new Set(Object.values(opts[x.key.index] as CubeView))
      const twin = opts.findIndex((o, j) => j !== x.key.index && !Object.values(o).every((m) => keySet.has(m)))
      const net = x.spec.net
      const n = foldByMatrices(net.map((q): Cell => [q.r, q.c])) as [number, number, number][]
      const cand: CubeView[] = []
      for (const a of net) for (const b of net) for (const c of net) {
        const v = { top: a.mark, left: b.mark, right: c.mark }
        const idx = (m: Mark): number => net.findIndex((q) => q.mark === m)
        if (new Set([a.mark, b.mark, c.mark]).size === 3 && impossibleReason(n[idx(v.top)]!, n[idx(v.left)]!, n[idx(v.right)]!) === 'opposite') cand.push(v)
      }
      const fresh = cand.find((v) => !opts.some((o) => new Set([...Object.values(o), ...Object.values(v)]).size === 3))
      opts[twin] = fresh as CubeView
      const v = verifyCubenet(x)
      expect(v.ok).toBe(false)
      expect(v.checks.set_groups_uniform).toBe(false)
    }
    expect(found).toBe(true)
  })

  it('specProblems accepts every generated spec and names what is wrong otherwise', () => {
    for (let i = 0; i < 100; i++) expect(specProblems(cubenet.generate(`sp-${i}`).spec)).toEqual([])
    expect(specProblems(null)).toEqual(['spec is not an object'])
    expect(specProblems({ net: item.spec.net.slice(0, 5), options: item.spec.options })).toContain('net must have 6 squares')
    expect(specProblems({ net: item.spec.net.map((q) => ({ ...q, mark: 'star' })), options: item.spec.options }).length).toBeGreaterThan(0)
    const apart = item.spec.net.map((q, i) => ({ ...q, r: 2 * Math.floor(i / 2), c: 2 * (i % 2) }))
    expect(specProblems({ net: apart, options: item.spec.options })).toContain('net squares are not joined edge to edge')
  })
})

describe('cubenet prior and scoring', () => {
  it('follows the documented regression and keeps every b ≥ 0.05 from a band cut', () => {
    for (let m = 0; m <= 3; m++)
      for (const h of [false, true])
        for (let s = 2; s <= 5; s++) {
          const b = cubenetBPrior({ n_mirror: m, net_hard: h, key_spread: s })
          expect(b).toBeCloseTo(-1.65 + 1.2 * m + (h ? 0.2 : 0) + 0.1 * (s - 2), 12)
          for (const cut of [-1.5, -0.5, 0.5, 1.5, 2.5]) expect(Math.abs(b - cut)).toBeGreaterThan(0.049)
          const k = stratumOfB(b)
          expect(m === 0 ? [1, 2] : [m + 2]).toContain(k)
          expect(cubenetExpectedTime({ n_mirror: m, net_hard: h, key_spread: s })).toBe(20 + 9 * m + (h ? 3 : 0) + 3 * (s - 2))
        }
    expect(CUBENET_PRIOR.anchorB).toBe(-1.65)
  })

  it('natural pool: n_mirror uniform, layouts mixed at n_mirror = 1, key spread 2–5', () => {
    const counts = [0, 0, 0, 0]
    const layouts = { pairs: 0, singles: 0 }
    const spreads = new Set<number>()
    for (let i = 0; i < 2_000; i++) {
      const f = features(cubenet.generate(`pool-${i}`))
      counts[f.n_mirror]!++
      if (f.n_mirror === 1) layouts[f.layout]++
      spreads.add(f.key_spread)
      expect(f.n_mirror + f.n_opposite).toBe(3)
      expect(f.net_hard).toBe(f.net_class !== '141')
    }
    for (const c of counts) expect(c).toBeGreaterThan(400)
    expect(layouts.pairs).toBeGreaterThan(150)
    expect(layouts.singles).toBeGreaterThan(150)
    expect([...spreads].sort()).toEqual([2, 3, 4, 5])
  })

  it('key positions are uniform and options carry only net marks', () => {
    const pos = [0, 0, 0, 0]
    for (let i = 0; i < 4_000; i++) {
      const it = cubenet.generate(`pos-${i}`)
      pos[it.key.index]!++
      const marks = new Set(it.spec.net.map((q) => q.mark))
      for (const o of it.spec.options) for (const m of [o.top, o.left, o.right]) expect(marks.has(m)).toBe(true)
    }
    for (const c of pos) expect(Math.abs(c - 1_000)).toBeLessThan(5 * Math.sqrt(4_000 * 0.25 * 0.75))
  })

  it('scores the chosen option index and throws on malformed responses', () => {
    const item = cubenet.generate('score')
    expect(cubenet.score(item, item.key.index)).toEqual({ correct: 1 })
    for (let d = 1; d < 4; d++) expect(cubenet.score(item, (item.key.index + d) % 4)).toEqual({ correct: 0 })
    for (const bad of [-1, 4, 0.5, '1', null, undefined, [1], {}]) expect(() => cubenet.score(item, bad as number)).toThrow(MalformedResponseError)
  })
})
