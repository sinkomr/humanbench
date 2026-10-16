import fc from 'fast-check'
import { describe, expect, it } from 'vitest'
import { AXIS_CODES, AXIS_INDEX, N_AXES, initialSigma, type AxisCode } from './axes'
import { inverse } from './linalg'
import { eapByAxis } from './scorer'
import { selectionAim, sessionPosterior } from './selector'
import { SELECTION_PRIOR_SD_FACTOR } from './startup'
import type { Observation } from './types'
import { AIM_GRID, XSKILL_BORROW, crossSkillAimByAxis, crossSkillAims, gridLoglik, gridPosterior, sessionEvidence, summaryEvidence } from './xskill'

const SIGMA = initialSigma()
const CAT: readonly AxisCode[] = ['MAT', 'LR', 'LG', 'RC', 'VOC', 'QR', 'SPA', 'KST', 'KHU', 'KAP']
const run = (axis: AxisCode, bs: readonly number[], y: 0 | 1 | readonly (0 | 1)[]): Observation[] => bs.map((b, i) => ({ kind: '2pl', axis, a: 1, b, y: typeof y === 'number' ? y : y[i]! }))

const arbObs: fc.Arbitrary<Observation[]> = fc.array(
  fc.record({ axis: fc.constantFrom(...CAT), a: fc.double({ min: 0.4, max: 2.5, noNaN: true }), b: fc.double({ min: -3, max: 3.4, noNaN: true }), y: fc.constantFrom<0 | 1>(0, 1) }).map((o): Observation => ({ kind: '2pl', ...o })),
  { maxLength: 40 },
)

describe('the cross-skill aim (owner request 2026-10-15; DESIGN §7.4)', () => {
  it('borrows by default, at three quarters of Σ’s correlations, around the wider aim of 2026-10-13', () => {
    expect(XSKILL_BORROW).toBe(0.75)
    expect(SELECTION_PRIOR_SD_FACTOR).toBe(2)
    expect(AIM_GRID).toHaveLength(61)
    expect(AIM_GRID[0]).toBe(-4)
    expect(AIM_GRID[60]).toBe(4)
  })

  it('with no answer anywhere every skill is aimed at the population mean', () => {
    for (const v of Object.values(selectionAim([]))) expect(v).toBe(0)
  })

  it('a strong first part lifts the start of every correlated part, more where Σ says the skills go together', () => {
    const obs = run('QR', [0, 1, 2, 3, 3, 3], 1)
    const a = selectionAim(obs)
    // QR–MAT .60, QR–FER .40, QR–(LR, VOC, …) .35, QR–RT .20 (Σ_init v2, ROADMAP A8)
    expect(a.MAT!).toBeGreaterThan(1.5)
    expect(a.MAT!).toBeGreaterThan(a.FER!)
    expect(a.FER!).toBeGreaterThan(a.LR!)
    expect(a.LR!).toBeGreaterThan(a.RT!)
    expect(a.RT!).toBeGreaterThan(0)
    // before 2026-10-15 (no borrowing): every other skill at 0
    const before = selectionAim(obs, { borrow: 0 })
    for (const k of AXIS_CODES) if (k !== 'QR') expect(before[k]).toBe(0)
    // a weak first part lowers them the same way
    const weak = selectionAim(run('QR', [0, -1, -2, -3, -3], 0))
    expect(weak.MAT!).toBeLessThan(-1.2)
  })

  it('the owner’s case: a near-perfect session starts its later parts high (strata 4 to 5), not at stratum 2 to 3', () => {
    const obs = [...run('MAT', [0, 1, 2, 3, 3, 3, 3, 3], 1), ...run('LR', [0, 1, 2, 3, 3, 3], 1), ...run('KST', [0, 1, 2, 3, 3, 3], 1), ...run('SPA', [0, 1, 2, 3, 3, 3], 1)]
    const a = selectionAim(obs)
    for (const k of ['VOC', 'RC', 'QR', 'KHU', 'KAP', 'LG'] as const) expect(a[k]!, k).toBeGreaterThan(1.75)
  })

  it('a skill’s own answers take over: a dip is found, not flattened (the borrowed prior does not hold the aim up)', () => {
    const strong = [...run('MAT', [0, 1, 2, 3, 3, 3], 1), ...run('LR', [0, 1, 2, 3, 3, 3], 1), ...run('SPA', [0, 1, 2, 3, 3, 3], 1)]
    const start = selectionAim(strong).QR!
    expect(start).toBeGreaterThan(1.5)
    // six misses stepping down on QR
    const dip = [...strong, ...run('QR', [2, 1, 0, -1, -2, -2], 0)]
    expect(selectionAim(dip).QR!).toBeLessThan(-1)
    // and the session's posterior of QR is that of its own answers alone, whatever the other skills did
    const own = run('QR', [2, 1, 0, -1, -2, -2], 0)
    expect(sessionPosterior(dip).QR).toEqual(sessionPosterior(own).QR)
  })

  it('without borrowing it is exactly the aim of 2026-10-13: the per-skill EAP under a prior twice as wide (fast-check)', () => {
    const wide = SIGMA.map((r) => r.map((x) => x * SELECTION_PRIOR_SD_FACTOR ** 2))
    fc.assert(
      fc.property(arbObs, (obs) => {
        const a = selectionAim(obs, { borrow: 0 })
        const e = eapByAxis(obs, new Array<number>(N_AXES).fill(0), wide)
        for (const k of AXIS_CODES) expect(a[k]!).toBeCloseTo(e[k]?.mean ?? 0, 10)
      }),
      { numRuns: 60 },
    )
  })

  it('the conditional prior is the Gaussian regression on the other skills’ messages: the information form agrees (fast-check)', () => {
    const f2 = SELECTION_PRIOR_SD_FACTOR ** 2
    fc.assert(
      fc.property(arbObs, fc.double({ min: 0, max: 1, noNaN: true }), (obs, borrow) => {
        const S = SIGMA.map((r, i) => r.map((x, j) => f2 * (i === j ? x : borrow * x)))
        const Sinv = inverse(S)
        const ll = gridLoglik(obs)
        const lam = new Array<number>(N_AXES).fill(0)
        const h = new Array<number>(N_AXES).fill(0)
        for (const [j, l] of ll) {
          const p = gridPosterior(l, 0, S[j]![j]!)
          const p0 = gridPosterior(null, 0, S[j]![j]!)
          const L = 1 / p.sd ** 2 - 1 / p0.sd ** 2
          if (L > 1e-9) {
            lam[j] = L
            h[j] = p.mean / p.sd ** 2 - p0.mean / p0.sd ** 2
          }
        }
        const got = crossSkillAims(obs, { sigma: SIGMA, borrow })
        for (let k = 0; k < N_AXES; k++) {
          // precision of everything but k's own message; the conditional of k is read off its inverse
          const P = Sinv.map((r, i) => r.map((x, j) => x + (i === j && i !== k ? lam[i]! : 0)))
          const C = inverse(P)
          const m = C.map((r) => r.reduce((t, x, j) => t + x * (j === k ? 0 : h[j]!), 0))
          if (borrow === 0) continue
          expect(got[k]!.priorMean).toBeCloseTo(m[k]!, 7)
          expect(got[k]!.priorVar).toBeCloseTo(C[k]![k]!, 7)
        }
      }),
      { numRuns: 40 },
    )
  })

  it('is odd in the answers: mirrored records give mirrored aims (μ = 0) (fast-check)', () => {
    fc.assert(
      fc.property(arbObs, (obs) => {
        const mirror = obs.map((o): Observation => (o.kind === '2pl' ? { ...o, b: -o.b, y: o.y === 1 ? 0 : 1 } : o))
        const a = selectionAim(obs)
        const b = selectionAim(mirror)
        for (const k of AXIS_CODES) expect(a[k]! + b[k]!).toBeCloseTo(0, 6)
      }),
      { numRuns: 40 },
    )
  })

  // (Only for a skill's first answer: with more, a message is a Gaussian summary, and a right answer that also
  // sharpens a low summary can move a correlated aim down by a hair.)
  it('a first right answer on another skill never lowers a skill’s aim, a first wrong one never raises it (fast-check)', () => {
    fc.assert(
      fc.property(arbObs, fc.constantFrom(...CAT), fc.constantFrom(...CAT), fc.double({ min: -2, max: 3, noNaN: true }), (all, other, target, b) => {
        fc.pre(other !== target)
        const obs = all.filter((o) => o.axis !== other)
        const base = selectionAim(obs)[target]!
        expect(selectionAim([...obs, ...run(other, [b], 1)])[target]!).toBeGreaterThanOrEqual(base - 1e-9)
        expect(selectionAim([...obs, ...run(other, [b], 0)])[target]!).toBeLessThanOrEqual(base + 1e-9)
      }),
      { numRuns: 60 },
    )
  })

  it('stays on the grid and finite, whatever the record (fast-check)', () => {
    fc.assert(
      fc.property(arbObs, fc.double({ min: 0, max: 1, noNaN: true }), (obs, borrow) => {
        for (const v of Object.values(selectionAim(obs, { borrow }))) {
          expect(Number.isFinite(v)).toBe(true)
          expect(Math.abs(v!)).toBeLessThanOrEqual(4)
        }
      }),
      { numRuns: 60 },
    )
  })

  it('uses the Σ it is given: a re-estimated Σ moves the aim, a Σ without correlations borrows nothing', () => {
    const obs = run('QR', [0, 1, 2, 3], 1)
    const identity = SIGMA.map((r, i) => r.map((_, j) => (i === j ? 1 : 0)))
    expect(selectionAim(obs, { sigma: identity }).MAT).toBe(0)
    const stronger = SIGMA.map((r, i) => r.map((x, j) => (i === j ? 1 : Math.min(0.8, x * 1.3))))
    expect(selectionAim(obs, { sigma: stronger }).MAT!).toBeGreaterThan(selectionAim(obs).MAT!)
  })

  it('earlier sessions are evidence for the aim, as if answered first (a returning person)', () => {
    const earlier = [...run('VOC', [0, 1, 2, 3, 3], 1), ...run('QR', [0, 1, 2], 1)]
    const now = run('MAT', [1, 2], 1)
    expect(selectionAim(now, { earlier })).toEqual(selectionAim([...earlier, ...now]))
    // the returning person's first VOC question is aimed where they left it, not at 0
    expect(selectionAim([], { earlier }).VOC!).toBeGreaterThan(2)
    expect(selectionAim([]).VOC).toBe(0)
  })

  it('an earlier session is read as one Gaussian term a skill that carries its posterior: alone under the prior, it gives that posterior back (fast-check)', () => {
    fc.assert(
      fc.property(arbObs, (obs) => {
        const ev = sessionEvidence(obs, { sigma: SIGMA })
        expect(ev.every((o) => o.kind === 'gaussian')).toBe(true)
        expect(new Set(ev.map((o) => o.axis)).size).toBe(ev.length)
        const own = sessionPosterior(obs)
        const back = sessionPosterior(ev)
        for (const o of ev) {
          // the grid is truncated at ±4, so the Gaussian term is the posterior's only to the grid's resolution
          expect(back[o.axis].mean).toBeCloseTo(own[o.axis].mean, 1)
          expect(back[o.axis].sd).toBeCloseTo(own[o.axis].sd, 1)
        }
      }),
      { numRuns: 40 },
    )
    // a summary that says nothing beyond the prior gives nothing
    expect(summaryEvidence('VOC', 0, 1, 0, 1)).toEqual([])
    expect(summaryEvidence('VOC', 0.3, 0, 0, 1)).toEqual([])
    const [e] = summaryEvidence('VOC', 1, 0.5, 0, 1) as [Extract<Observation, { kind: 'gaussian' }>]
    // N(0, 1) on ±4 is all but untruncated: λ = 4 − 1, x = 4/3
    expect(e.sigma).toBeCloseTo(1 / Math.sqrt(3), 3)
    expect(e.x).toBeCloseTo(4 / 3, 3)
  })

  it('rejects options out of range', () => {
    expect(() => crossSkillAims([], { sigma: SIGMA, borrow: 1.5 })).toThrow(RangeError)
    expect(() => crossSkillAims([], { sigma: SIGMA, borrow: -0.1 })).toThrow(RangeError)
    expect(() => crossSkillAims([], { sigma: SIGMA, factor: 0 })).toThrow(RangeError)
    expect(() => crossSkillAims([], { sigma: [[1]] })).toThrow(RangeError)
    expect(() => gridPosterior(null, 0, 0)).toThrow(RangeError)
  })

  it('a skill whose answers say nothing (none) sends no message; a Gaussian observation does', () => {
    const fer: Observation = { kind: 'gaussian', axis: 'FER', lam: 1, d: 0, sigma: 0.5, x: 1.5 }
    const a = crossSkillAimByAxis([fer], { sigma: SIGMA })
    expect(a.QR).toBeGreaterThan(0.3)
    expect(a.KST).toBeGreaterThan(0.3)
    expect(AXIS_INDEX.FER).toBeGreaterThanOrEqual(0)
  })
})
