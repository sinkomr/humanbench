/**
 * figure2d unit tests (DESIGN §3 row 7, §4.2; ROADMAP A9, A11): geometry against literal definitions (fast-check), the
 * prior and design points, the identity and stratum targeting, option-only cue checks over a sample, tamper tests that
 * the verifier must reject, scoring, and family_id parity vectors shared with the bank twin.
 */

import fc from 'fast-check'
import { describe, expect, it } from 'vitest'
import { MalformedResponseError, type ItemInstance } from '../family'
import { canonicalJson } from '../ids'
import { stratumOfB } from '../priors'
import { verifyFigure2d } from './verify'
import {
  bbox,
  c4Key,
  cellsKey,
  d4Canon,
  d4Key,
  growFigure,
  images,
  isAsymmetric,
  isConnected,
  isOneMoveAnyTurn,
  isOneMoveExact,
  maxOverlap,
  movedVariants,
  normalise,
  oddOneOut,
  profileKey,
  reflect,
  relationSignatures,
  turn,
  turnsBetween,
} from './geometry'
import { mirrorLooks, rotateLooks, splitsOf } from './gen'
import {
  MIRROR_COMBOS,
  ROTATE_COMBOS,
  mirrorBPrior,
  mirrorCombosOf,
  mirrorExpectedTime,
  mirrorInput,
  rotateBPrior,
  rotateCombosOf,
  rotateExpectedTime,
  rotateInput,
} from './prior'
import { specProblems, type Cell, type Figure2dItem, type MirrorFeatures, type RotateFeatures } from './spec'
import { createRng } from '../../engine'
import { figure2d, figure2dSpecLeaksKey } from '.'

const sample = (n: number, prefix: string, stratum?: number): Figure2dItem[] =>
  Array.from({ length: n }, (_, i) => (stratum === undefined ? figure2d.generate(`${prefix}-${i}`) : figure2d.generate(`${prefix}-${i}`, { stratum })))

const clone = (item: Figure2dItem): Figure2dItem => JSON.parse(JSON.stringify(item)) as Figure2dItem
const rotFeatures = (item: Figure2dItem): RotateFeatures => item.difficulty.features as unknown as RotateFeatures
const mirFeatures = (item: Figure2dItem): MirrorFeatures => item.difficulty.features as unknown as MirrorFeatures

/** First item of a task in a stream of seeds. */
function firstOf(task: 'rotate' | 'mirror', prefix: string, stratum?: number, pred: (it: Figure2dItem) => boolean = () => true): Figure2dItem {
  for (let i = 0; i < 500; i++) {
    const it = stratum === undefined ? figure2d.generate(`${prefix}-${i}`) : figure2d.generate(`${prefix}-${i}`, { stratum })
    if (it.spec.task === task && pred(it)) return it
  }
  throw new Error(`no ${task} item`)
}

const arbFigure = fc.record({ seed: fc.string({ minLength: 1, maxLength: 8 }), n: fc.integer({ min: 1, max: 11 }) }).map(({ seed, n }) => growFigure(createRng(seed), n))

describe('figure2d geometry', () => {
  it('turns clockwise on screen and reflects in the four lines as documented', () => {
    // An L: a column of three with a foot to the right at the bottom.
    const l: Cell[] = [
      [0, 0],
      [1, 0],
      [2, 0],
      [2, 1],
    ]
    expect(turn(l, 1)).toEqual([
      [0, 0],
      [0, 1],
      [0, 2],
      [1, 0],
    ])
    expect(reflect(l, 'v')).toEqual([
      [0, 1],
      [1, 1],
      [2, 0],
      [2, 1],
    ])
    expect(reflect(l, 'h')).toEqual([
      [0, 0],
      [0, 1],
      [1, 0],
      [2, 0],
    ])
    expect(reflect(l, 'd')).toEqual([
      [0, 0],
      [0, 1],
      [0, 2],
      [1, 2],
    ])
    expect(reflect(l, 'a')).toEqual([
      [0, 0],
      [1, 0],
      [1, 1],
      [1, 2],
    ])
  })

  it('obeys the D4 relations (fast-check): 4 turns = identity, reflections are involutions, v∘h = 180°, d = 3 turns ∘ v', () => {
    fc.assert(
      fc.property(arbFigure, (f) => {
        const k = cellsKey(f)
        expect(cellsKey(turn(f, 4))).toBe(k)
        expect(cellsKey(turn(turn(f, 1), 3))).toBe(k)
        for (const line of ['v', 'h', 'd', 'a'] as const) expect(cellsKey(reflect(reflect(f, line), line))).toBe(k)
        expect(cellsKey(reflect(reflect(f, 'v'), 'h'))).toBe(cellsKey(turn(f, 2)))
        expect(cellsKey(reflect(reflect(f, 'd'), 'a'))).toBe(cellsKey(turn(f, 2)))
        expect(cellsKey(reflect(f, 'd'))).toBe(cellsKey(turn(reflect(f, 'v'), 3)))
        expect(cellsKey(reflect(f, 'a'))).toBe(cellsKey(turn(reflect(f, 'v'), 1)))
        expect(isConnected(f)).toBe(true)
        expect(cellsKey(normalise(f))).toBe(k)
        // Canonical forms are invariant under the group they are canonical for.
        expect(c4Key(turn(f, 1))).toBe(c4Key(f))
        expect(d4Key(reflect(f, 'a'))).toBe(d4Key(f))
        expect(isAsymmetric(f)).toBe(new Set(images(f).map(cellsKey)).size === 8)
        // A figure with no symmetry differs from its mirror image under every turn.
        if (isAsymmetric(f)) expect(c4Key(reflect(f, 'v'))).not.toBe(c4Key(f))
      }),
      { numRuns: 300 },
    )
  })

  it('d4Canon is the least of the 8 images, element by element (the order the bank twin uses)', () => {
    fc.assert(
      fc.property(arbFigure, (f) => {
        const least = images(f).reduce((m, x) => {
          for (let i = 0; i < x.length; i++) {
            const a = x[i] as Cell
            const b = m[i] as Cell
            if (a[0] !== b[0]) return a[0] < b[0] ? x : m
            if (a[1] !== b[1]) return a[1] < b[1] ? x : m
          }
          return m
        })
        expect(d4Canon(f)).toEqual(least)
      }),
      { numRuns: 200 },
    )
  })

  it('finds the turns between a figure and its turned copies, and none for a mirror image', () => {
    let f: Cell[] = []
    for (let i = 0; !isAsymmetric(f); i++) f = growFigure(createRng(`turns-${i}`), 8)
    for (const k of [0, 1, 2, 3]) expect(turnsBetween(f, turn(f, k))).toEqual([k])
    expect(turnsBetween(f, reflect(f, 'v'))).toEqual([])
  })

  it('lists one-square-moved variants that are connected, the same size, and one move away (fast-check)', () => {
    fc.assert(
      fc.property(arbFigure, (f) => {
        if (f.length < 3) return
        for (const v of movedVariants(f)) {
          expect(v).toHaveLength(f.length)
          expect(isConnected(v)).toBe(true)
          expect(maxOverlap(f, v)).toBeGreaterThanOrEqual(f.length - 1)
          if (cellsKey(v) !== cellsKey(f)) expect(isOneMoveExact(f, v) || maxOverlap(f, v) === f.length).toBe(true)
        }
      }),
      { numRuns: 100 },
    )
  })

  it('profileKey is invariant under D4 and bbox/rowCounts are the literal counts', () => {
    fc.assert(
      fc.property(arbFigure, (f) => {
        for (const g of images(f)) expect(profileKey(g)).toBe(profileKey(f))
        const [h, w] = bbox(f)
        expect(Math.max(...f.map((c) => c[0])) + 1).toBe(h)
        expect(Math.max(...f.map((c) => c[1])) + 1).toBe(w)
      }),
      { numRuns: 200 },
    )
  })

  it('oddOneOut finds exactly a 3–1 split', () => {
    expect(oddOneOut(['a', 'a', 'b', 'a'])).toBe(2)
    expect(oddOneOut(['a', 'a', 'b', 'b'])).toBeNull()
    expect(oddOneOut(['a', 'b', 'c', 'd'])).toBeNull()
    expect(oddOneOut(['a', 'a', 'a', 'a'])).toBeNull()
  })

  it('splits a total turn into (k, angle) with 90k + angle ≡ T and angle in (−90, 90]', () => {
    for (let t = 0; t < 360; t += 15) {
      const s = splitsOf(t)
      expect(s).toHaveLength(2)
      for (const [k, a] of s) {
        expect(a).toBeGreaterThan(-90)
        expect(a).toBeLessThanOrEqual(90)
        expect((((90 * k + a) % 360) + 360) % 360).toBe(t)
      }
      expect(s[0]?.[0]).not.toBe(s[1]?.[0])
    }
  })
})

describe('figure2d prior and design points', () => {
  it('reaches every stratum 1–6 in both tasks, with exact dyadic b in the band of each design point', () => {
    for (let k = 1; k <= 6; k++) {
      expect(rotateCombosOf(k as 1).length).toBeGreaterThan(0)
      expect(mirrorCombosOf(k as 1).length).toBeGreaterThan(0)
    }
    for (const c of ROTATE_COMBOS) {
      const b = rotateBPrior(rotateInput(c))
      expect(Number.isInteger(b * 64)).toBe(true)
      if (c.hard_variant) expect(c.n_squares).toBeGreaterThanOrEqual(7)
    }
    for (const c of MIRROR_COMBOS) expect(Number.isInteger(mirrorBPrior(mirrorInput(c)) * 4)).toBe(true)
    // Easy and hard anchors of the documented formulas.
    expect(rotateBPrior({ turn_deg: 90, n_squares: 5, off_axis: false, hard_variant: false })).toBe(-3 + 90 / 64)
    expect(stratumOfB(rotateBPrior({ turn_deg: 90, n_squares: 5, off_axis: false, hard_variant: false }))).toBe(1)
    expect(stratumOfB(rotateBPrior({ turn_deg: 180, n_squares: 11, off_axis: false, hard_variant: true }))).toBe(6)
    expect(mirrorBPrior({ n_squares: 6, diagonal: false, set_pairs: false, set_near_turn: false })).toBe(-2.75)
    expect(stratumOfB(mirrorBPrior({ n_squares: 11, diagonal: true, set_pairs: false, set_near_turn: true }))).toBe(6)
  })

  it('keeps E[T] within ≈ 14–45 s (cap 180 s)', () => {
    const times = [...ROTATE_COMBOS.map((c) => rotateExpectedTime(rotateInput(c))), ...MIRROR_COMBOS.map((c) => mirrorExpectedTime(mirrorInput(c)))]
    expect(Math.min(...times)).toBeGreaterThanOrEqual(14)
    expect(Math.max(...times)).toBeLessThanOrEqual(45)
  })
})

describe('figure2d items', () => {
  it('has the identity of a spatial MC item with 3PL c = 1/4 (A9), facet = task', () => {
    for (const task of ['rotate', 'mirror'] as const) {
      const item = firstOf(task, 'identity')
      expect(item.family).toBe('figure2d')
      expect(item.axis).toBe('SPA')
      expect(item.facet).toBe(task === 'rotate' ? '2d_rotation' : '2d_mirror')
      expect(item.item_type).toBe('mc_image_spec')
      expect(item.options_count).toBe(4)
      expect(item.params).toEqual({ model: '3pl', a: 1, b: item.difficulty.b_prior, c: 0.25 })
      expect(item.time_limit_s).toBe(180)
      expect(specProblems(item.spec)).toEqual([])
      expect(figure2dSpecLeaksKey(item)).toBeNull()
    }
  })

  it('targets every stratum on request, with seed <seed>@s<k>, and rebuilds it from the seed', () => {
    for (const k of figure2d.strata) {
      const item = figure2d.generate('target', { stratum: k })
      expect(item.stratum).toBe(k)
      expect(item.seed).toBe(`target@s${k}`)
      expect(figure2d.generate(`target@s${k}`)).toEqual(item)
    }
    expect(() => figure2d.generate('x', { stratum: 7 })).toThrow(RangeError)
  })

  it('makes both tasks in every requested stratum, about half each', () => {
    const counts: Record<string, number> = {}
    for (const k of figure2d.strata) {
      for (const item of sample(60, `both-${k}`, k)) counts[`${item.spec.task}${k}`] = (counts[`${item.spec.task}${k}`] ?? 0) + 1
    }
    for (const k of figure2d.strata) {
      expect(counts[`rotate${k}`]).toBeGreaterThan(15)
      expect(counts[`mirror${k}`]).toBeGreaterThan(15)
    }
  }, 120_000)

  it('draws easy items easy and hard items hard (stratum 1 vs 6 features)', () => {
    for (const it of sample(40, 'easy', 1)) {
      if (it.spec.task === 'rotate') {
        expect(rotFeatures(it).n_squares).toBeLessThanOrEqual(6)
        expect(rotFeatures(it).turn_deg).toBeLessThanOrEqual(90)
      } else {
        expect(mirFeatures(it).diagonal).toBe(false)
        expect(mirFeatures(it).n_squares).toBeLessThanOrEqual(8)
      }
    }
    for (const it of sample(40, 'hard', 6)) {
      if (it.spec.task === 'rotate') {
        expect(rotFeatures(it).hard_variant).toBe(true)
        expect(rotFeatures(it).turn_deg).toBeGreaterThanOrEqual(150)
      } else {
        expect(mirFeatures(it).diagonal).toBe(true)
        expect(mirFeatures(it).n_squares).toBeGreaterThanOrEqual(10)
      }
    }
  }, 120_000)

  it('rotate: the target upright, every option tilted alike, the key never the target unchanged, two mirror pairs', () => {
    for (const it of sample(150, 'rot').filter((x) => x.spec.task === 'rotate')) {
      const f = it.spec.figure.cells
      const cells = it.spec.options.map((o) => o.cells)
      const tilt = (((it.spec.options[0]?.angle ?? 0) % 90) + 90) % 90
      expect(it.spec.options.every((o) => (((o.angle % 90) + 90) % 90) === tilt)).toBe(true)
      expect(cells.some((c) => cellsKey(c) === cellsKey(f))).toBe(false)
      expect(new Set(cells.map(c4Key)).size).toBe(4)
      expect(new Set(cells.map(d4Key)).size).toBe(2)
      expect(cells.filter((c) => c4Key(c) === c4Key(f))).toHaveLength(1)
      expect(new Set(relationSignatures(cells, false)).size).toBe(1)
      for (const v of cells.filter((c) => d4Key(c) !== d4Key(f))) expect(isOneMoveAnyTurn(f, v)).toBe(true)
    }
  }, 120_000)

  it('mirror: exactly one option is the reflection in the line, options upright, the target box square', () => {
    for (const it of sample(150, 'mir').filter((x) => x.spec.task === 'mirror')) {
      const f = it.spec.figure.cells
      const line = it.spec.mirror_line
      expect(line).toBeDefined()
      const want = cellsKey(reflect(f, line as 'v'))
      const hits = it.spec.options.flatMap((o, i) => (cellsKey(o.cells) === want ? [i] : []))
      expect(hits).toEqual([it.key.index])
      expect(it.spec.options.every((o) => o.angle === 0)).toBe(true)
      const [h, w] = bbox(f)
      expect(h).toBe(w)
      expect(mirFeatures(it).diagonal).toBe(line === 'd' || line === 'a')
    }
  }, 120_000)

  it('gives option-only strategies no edge: no odd one out, alike relations, chance-level hit rates', () => {
    const items = sample(600, 'cue')
    let oddHits = 0
    let bigTurn = 0
    let n = 0
    for (const it of items) {
      const looks = it.spec.task === 'rotate' ? rotateLooks(it.spec.options) : mirrorLooks(it.spec.options)
      for (const v of looks) expect(oddOneOut(v)).toBeNull()
      const sig = relationSignatures(
        it.spec.options.map((o) => o.cells),
        it.spec.task === 'mirror',
      )
      expect(new Set(sig).size).toBe(1)
      // "Pick the option whose own grid has the most squares in its first row" and "the largest |angle|".
      const first = it.spec.options.map((o) => o.cells.filter((c) => c[0] === 0).length)
      const best = Math.max(...first)
      const top = first.flatMap((x, i) => (x === best ? [i] : []))
      oddHits += top.includes(it.key.index) ? 1 / top.length : 0
      const ang = it.spec.options.map((o) => Math.abs(o.angle))
      const amax = Math.max(...ang)
      const atop = ang.flatMap((x, i) => (x === amax ? [i] : []))
      bigTurn += atop.includes(it.key.index) ? 1 / atop.length : 0
      n++
    }
    // Chance is 1/4; 600 items → SD ≈ 0.018.
    expect(Math.abs(oddHits / n - 0.25)).toBeLessThan(0.07)
    expect(Math.abs(bigTurn / n - 0.25)).toBeLessThan(0.07)
  }, 120_000)

  it('puts the key uniformly over the four positions (χ²(3) < 16.27 over 2,000 items)', () => {
    const counts = [0, 0, 0, 0]
    for (let i = 0; i < 2_000; i++) {
      const k = figure2d.generate(`pos-${i}`).key.index
      counts[k] = (counts[k] as number) + 1
    }
    const e = 500
    expect(counts.reduce((s, c) => s + (c - e) ** 2 / e, 0)).toBeLessThan(16.27)
  }, 300_000)
})

describe('figure2d verifier rejects tampered items (G2/G3)', () => {
  const rot = firstOf('rotate', 'tamper-r', 4)
  const mir = firstOf('mirror', 'tamper-m', 4)
  const ok = (it: Figure2dItem) => verifyFigure2d(it).ok

  it('accepts the untampered items', () => {
    expect(verifyFigure2d(rot)).toMatchObject({ ok: true })
    expect(verifyFigure2d(mir)).toMatchObject({ ok: true })
  })

  for (const [name, base] of [
    ['rotate', () => rot],
    ['mirror', () => mir],
  ] as const) {
    it(`${name}: a wrong key`, () => {
      for (const d of [1, 2, 3]) {
        const t = clone(base())
        ;(t as { key: { index: number } }).key.index = (t.key.index + d) % 4
        expect(ok(t)).toBe(false)
      }
    })

    it(`${name}: swapped options (the key no longer points at the right one)`, () => {
      const t = clone(base())
      const opts = t.spec.options as Figure2dItem['spec']['options'][number][]
      const j = (t.key.index + 1) % 4
      ;[opts[t.key.index], opts[j]] = [opts[j] as (typeof opts)[number], opts[t.key.index] as (typeof opts)[number]]
      expect(ok(t)).toBe(false)
    })

    it(`${name}: broken structure, features, prior, stratum or time`, () => {
      const edits: ((t: Record<string, any>) => void)[] = [
        (t) => (t.structural_params.figure = [[0, 0]]),
        (t) => (t.difficulty.features.n_squares = 99),
        (t) => (t.difficulty.b_prior = t.difficulty.b_prior + 0.5),
        (t) => (t.stratum = t.stratum === 1 ? 2 : 1),
        (t) => (t.expected_time_s = t.expected_time_s + 1),
        (t) => (t.facet = name === 'rotate' ? '2d_mirror' : '2d_rotation'),
        (t) => (t.spec.extra = 1),
      ]
      for (const e of edits) {
        const t = clone(base()) as unknown as Record<string, any>
        e(t)
        expect(ok(t as unknown as Figure2dItem)).toBe(false)
      }
    })

    it(`${name}: a square moved in the key option, or a disconnected figure`, () => {
      const t = clone(base())
      const key = t.spec.options[t.key.index] as unknown as { cells: Cell[] }
      const moved = movedVariants(key.cells).find((v) => cellsKey(v) !== cellsKey(key.cells)) as Cell[]
      key.cells = moved
      expect(ok(t)).toBe(false)
      const u = clone(base())
      ;(u.spec.figure as unknown as { cells: Cell[] }).cells = normalise([...u.spec.figure.cells.slice(1), [20, 20]])
      expect(ok(u)).toBe(false)
    })
  }

  it('rotate: a distractor made a second turned copy, an untilted option, the target listed unchanged', () => {
    const a = clone(rot)
    const d = (a.key.index + 1) % 4
    ;(a.spec.options[d] as unknown as { cells: Cell[] }).cells = turn(a.spec.figure.cells, 2)
    expect(ok(a)).toBe(false)
    const b = clone(rot)
    const opts = b.spec.options as unknown as { angle: number }[]
    const o = opts[(b.key.index + 2) % 4] as { angle: number }
    o.angle = o.angle === 0 ? 15 : 0
    expect(ok(b)).toBe(false)
    const c = clone(rot)
    const key = c.spec.options[c.key.index] as unknown as { cells: Cell[]; angle: number }
    key.cells = c.spec.figure.cells.map((x) => [x[0], x[1]] as Cell)
    expect(ok(c)).toBe(false)
  })

  it('mirror: the wrong line, a distractor replaced, a turned option', () => {
    const a = clone(mir)
    ;(a.spec as { mirror_line: string }).mirror_line = { v: 'h', h: 'v', d: 'a', a: 'd' }[a.spec.mirror_line as 'v']
    expect(ok(a)).toBe(false)
    const b = clone(mir)
    const d = (b.key.index + 1) % 4
    ;(b.spec.options[d] as unknown as { cells: Cell[] }).cells = turn(b.spec.figure.cells, 2)
    expect(ok(b)).toBe(false)
    const c = clone(mir)
    ;(c.spec.options[0] as unknown as { angle: number }).angle = 15
    expect(ok(c)).toBe(false)
  })

  it('never throws on garbage', () => {
    const t = clone(rot) as unknown as Record<string, any>
    for (const spec of [null, {}, { task: 'rotate' }, { task: 'mirror', figure: { cells: 'x' }, options: [] }]) {
      t.spec = spec
      expect(() => verifyFigure2d(t as unknown as Figure2dItem)).not.toThrow()
      expect(verifyFigure2d(t as unknown as Figure2dItem).ok).toBe(false)
    }
  })
})

describe('figure2d scoring', () => {
  const item = figure2d.generate('score-1')
  it('scores the key 1 and every other option 0', () => {
    for (let i = 0; i < 4; i++) expect(figure2d.score(item, i)).toEqual({ correct: i === item.key.index ? 1 : 0 })
  })
  it('throws MalformedResponseError on a response that is not an option index', () => {
    for (const bad of [-1, 4, 1.5, '1', null, undefined, Number.NaN, [1], {}]) {
      expect(() => figure2d.score(item, bad as unknown as number)).toThrow(MalformedResponseError)
    }
  })
})

/**
 * family_id parity vectors (A11 amended: one function in both repos). The bank twin's test pins the same three ids for
 * the same structures (`tests/gen/test_figure2d.py`).
 */
const FAMILY_ID_VECTORS: readonly { readonly structure: Record<string, unknown>; readonly id: string }[] = [
  {
    structure: {
      task: 'rotate',
      figure: [
        [0, 0],
        [0, 1],
        [0, 2],
        [0, 3],
        [0, 4],
        [1, 1],
        [1, 2],
      ],
      variant: [
        [0, 0],
        [0, 1],
        [0, 2],
        [1, 0],
        [1, 1],
        [2, 1],
        [3, 1],
      ],
    },
    id: 'f:figure2d:158fcac87d2e',
  },
  {
    structure: { figure: [[0, 0], [0, 1], [1, 1], [1, 2], [1, 3], [2, 1], [3, 1]], line: 'axis', set: 'pairs', task: 'mirror' },
    id: 'f:figure2d:64b1138478f0',
  },
  {
    structure: {
      figure: [[0, 0], [0, 1], [0, 2], [1, 1], [1, 2], [2, 1], [2, 2], [2, 3], [3, 1], [3, 2], [4, 2]],
      task: 'rotate',
      variant: [[0, 0], [0, 1], [0, 2], [1, 1], [1, 2], [2, 1], [2, 2], [2, 3], [3, 1], [3, 2], [4, 1]],
    },
    id: 'f:figure2d:e2dbb39925fa',
  },
]

describe('figure2d family_id', () => {
  it('hashes the canonical structure (A11) and matches the pinned parity vector', () => {
    for (const v of FAMILY_ID_VECTORS) expect(figure2d.familyIdOf(v.structure as never)).toBe(v.id)
    const it = figure2d.generate('ex-1')
    expect(canonicalJson(it.structural_params)).toBe(canonicalJson(FAMILY_ID_VECTORS[0]?.structure))
  })

  it('gives isomorphs one family_id: the same structure under any turn or flip of the figure', () => {
    const it = firstOf('mirror', 'iso')
    const f = it.spec.figure.cells
    for (const g of images(f)) expect(cellsKey(d4Canon(g))).toBe(cellsKey(d4Canon(f)))
  })

  it('validates as ItemInstance JSON (round trip)', () => {
    const it = figure2d.generate('json-1')
    const back = JSON.parse(JSON.stringify(it)) as ItemInstance
    expect(back).toEqual(it)
  })
})
