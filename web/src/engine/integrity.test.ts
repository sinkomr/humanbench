import fc from 'fast-check'
import { describe, expect, it } from 'vitest'
import type { AxisCode } from './axes'
import {
  bayesModalTheta,
  calibrationEligible,
  dichotomousObservation,
  FLAG_KINDS,
  HARD_ITEM_ALPHA,
  HARD_ITEM_MARGIN,
  hardItemCheck,
  HIDDEN_MAX_S,
  hiddenIntervals,
  integrityReport,
  LZ_STAR_MAX,
  LZ_STAR_MIN_ITEMS,
  lzStar,
  pasteCheck,
  pCorrect,
  personFitCheck,
  poissonBinomialPmf,
  poissonBinomialUpperTail,
  TOO_FAST_MIN_MEDIAN_S,
  TOO_FAST_RATIO,
  tooFastCheck,
  UNIFORM_RT_MAX_SD,
  UNIFORM_RT_MIN_ITEMS,
  UNIFORM_RT_MIN_TIME_RATIO,
  uniformRtCheck,
  visibilityCheck,
  type DichotomousObservation,
  type IntegrityResponse,
  type IntegritySession,
  type VisibilityEvent,
} from './integrity'
import { logistic, p2pl, p3pl } from './irt'
import { createRng, type Rng } from './prng'
import type { ItemParams } from './types'

// ------------------------------------------------------------------------------ helpers

const close = (actual: number | null, expected: number, tol = 1e-12) => {
  expect(actual).not.toBeNull()
  expect(Math.abs(actual! - expected)).toBeLessThanOrEqual(tol * (1 + Math.abs(expected)))
}

/** A response on a 30 s-expected 2PL item, window [onset, onset + rt]. */
function resp(i: number, over: Partial<IntegrityResponse> = {}): IntegrityResponse {
  const onset = over.onset_ms ?? 1000 + i * 60_000
  const rt = over.rt_ms ?? 25_000
  return {
    item_id: `i:${i}`,
    axis: 'MAT',
    params: { model: '2pl', a: 1, b: 0 },
    expected_time_s: 30,
    correct: 1,
    rt_ms: rt,
    onset_ms: onset,
    end_ms: onset + rt,
    ...over,
  }
}

/** Rasch items at the given difficulties with the given responses, all on MAT. */
function rasch(bs: readonly number[], ys: readonly (0 | 1)[]): DichotomousObservation[] {
  return bs.map((b, i) => ({ kind: '2pl', axis: 'MAT', a: 1, b, y: ys[i]! }))
}

const toResponses = (obs: readonly DichotomousObservation[]): IntegrityResponse[] =>
  obs.map((o, i) =>
    resp(i, {
      axis: o.axis,
      params: o.kind === '3pl' ? { model: '3pl', a: o.a, b: o.b, c: o.c } : { model: '2pl', a: o.a, b: o.b },
      correct: o.y,
    }),
  )

const SIM_AXES: readonly AxisCode[] = ['MAT', 'SPA', 'QR', 'LR']

/**
 * A well-behaved simulated session (the null model of the false-positive properties): 4 axes ×
 * `perAxis` items, θ_k ~ N(0, 1); a ~ lognormal(0.2, 0.3), b ~ θ_k + N(0, 1) (CAT-like targeting);
 * half 3PL with c = 1/4; responses from the model; expected times log-uniform on 10–60 s and
 * lognormal RTs around them, ln RT = ln E[T] − τ + N(0, 0.4²) with person speed τ ~ N(0, 0.3²)
 * (van der Linden lognormal RT model; α = 2.5 is mid-range for cognitive items); items run
 * back-to-back with 0.5 s gaps; one brief tab switch (0.5–8 s, within the item) in ~10% of items;
 * no paste.
 */
function simulateSession(rng: Rng, perAxis = 10): IntegritySession {
  const tau = rng.normal(0, 0.3)
  const responses: IntegrityResponse[] = []
  const visibility: VisibilityEvent[] = []
  let t = 1000
  let id = 0
  for (const axis of SIM_AXES) {
    const theta = rng.normal()
    for (let j = 0; j < perAxis; j++) {
      const a = Math.exp(rng.normal(0.2, 0.3))
      const b = theta + rng.normal(0, 1)
      const three = rng.next() < 0.5
      const params: ItemParams = three ? { model: '3pl', a, b, c: 0.25 } : { model: '2pl', a, b }
      const p = three ? p3pl(theta, a, b, 0.25) : p2pl(theta, a, b)
      const expected = 10 * Math.exp(rng.next() * Math.log(6))
      const rt = 1000 * Math.exp(Math.log(expected) - tau + rng.normal(0, 0.4))
      responses.push({
        item_id: `i:sim:${id++}`,
        axis,
        params,
        expected_time_s: expected,
        correct: rng.next() < p ? 1 : 0,
        rt_ms: rt,
        onset_ms: t,
        end_ms: t + rt,
      })
      if (rng.next() < 0.1) {
        const len = Math.min(500 + rng.next() * 7500, rt)
        const start = t + rng.next() * (rt - len)
        visibility.push({ t_ms: start, state: 'hidden' }, { t_ms: start + len, state: 'visible' })
      }
      t += rt + 500
    }
  }
  return { responses, visibility, paste: [] }
}

// ----------------------------------------------------------------------------- constants

describe('§13 thresholds', () => {
  it('match DESIGN §13 / ROADMAP M1.19', () => {
    expect(HIDDEN_MAX_S).toBe(10)
    expect(TOO_FAST_RATIO).toBe(0.25)
    expect(TOO_FAST_MIN_MEDIAN_S).toBe(20)
    expect(UNIFORM_RT_MAX_SD).toBe(0.1)
    expect(UNIFORM_RT_MIN_TIME_RATIO).toBe(2)
    expect(HARD_ITEM_MARGIN).toBe(1.5)
    expect(HARD_ITEM_ALPHA).toBe(0.01)
    expect(LZ_STAR_MAX).toBe(-2)
    expect(LZ_STAR_MIN_ITEMS).toBe(20)
  })
})

// ---------------------------------------------------------------------------- visibility

describe('hiddenIntervals', () => {
  it('pairs hidden→visible, ignores repeats, sorts by time and leaves a trailing spell open', () => {
    const ev: VisibilityEvent[] = [
      { t_ms: 5000, state: 'visible' },
      { t_ms: 1000, state: 'hidden' },
      { t_ms: 2000, state: 'hidden' }, // repeat: still the spell from 1000
      { t_ms: 6000, state: 'visible' }, // repeat: ignored
      { t_ms: 9000, state: 'hidden' },
    ]
    expect(hiddenIntervals(ev)).toEqual([
      [1000, 5000],
      [9000, Infinity],
    ])
  })

  it('treats a leading visible event as a no-op and drops zero-length spells', () => {
    expect(
      hiddenIntervals([
        { t_ms: 0, state: 'visible' },
        { t_ms: 10, state: 'hidden' },
        { t_ms: 10, state: 'visible' },
      ]),
    ).toEqual([])
  })

  it('rejects malformed events', () => {
    expect(() => hiddenIntervals([{ t_ms: NaN, state: 'hidden' }])).toThrow(RangeError)
    expect(() => hiddenIntervals([{ t_ms: 1, state: 'prerender' as 'hidden' }])).toThrow(RangeError)
  })

  it('is invariant under reordering a log with distinct times', () => {
    fc.assert(
      fc.property(
        fc.uniqueArray(fc.integer({ min: 0, max: 100_000 }), { minLength: 0, maxLength: 12 }),
        fc.array(fc.boolean(), { minLength: 12, maxLength: 12 }),
        fc.integer(),
        (times, states, seed) => {
          const ev: VisibilityEvent[] = times.map((t, i) => ({ t_ms: t, state: states[i] ? 'hidden' : 'visible' }))
          expect(hiddenIntervals(createRng(seed).shuffle(ev))).toEqual(hiddenIntervals(ev))
        },
      ),
    )
  })
})

describe('visibilityCheck (hidden > 10 s during an item)', () => {
  const items = [resp(0), resp(1), resp(2)] // windows [1000, 26000], [61000, 86000], [121000, 146000]
  const spell = (from: number, to: number): VisibilityEvent[] => [
    { t_ms: from, state: 'hidden' },
    { t_ms: to, state: 'visible' },
  ]

  it('flags a 10.5 s spell inside an item, with evidence', () => {
    const res = visibilityCheck(items, spell(62_000, 72_500))
    expect(res.flagged).toBe(true)
    expect(res.evidence.items).toEqual([{ item_id: 'i:1', hidden_s: 10.5, longest_spell_s: 10.5 }])
    expect(res.evidence.total_hidden_s).toBe(10.5)
  })

  it('does not flag exactly 10 s (strictly greater than)', () => {
    expect(visibilityCheck(items, spell(62_000, 72_000)).flagged).toBe(false)
  })

  it('sums repeated short switches within one item', () => {
    const ev = [...spell(62_000, 66_000), ...spell(70_000, 74_000), ...spell(78_000, 82_000)]
    const res = visibilityCheck(items, ev)
    expect(res.flagged).toBe(true)
    expect(res.evidence.items[0]).toEqual({ item_id: 'i:1', hidden_s: 12, longest_spell_s: 4 })
  })

  it('ignores hidden time outside every item window (breaks, interstitials)', () => {
    const res = visibilityCheck(items, spell(27_000, 60_000))
    expect(res.flagged).toBe(false)
    expect(res.evidence.total_hidden_s).toBe(0)
  })

  it('clips a spell that never ends to the item window', () => {
    const res = visibilityCheck(items, [{ t_ms: 130_000, state: 'hidden' }])
    expect(res.flagged).toBe(true)
    expect(res.evidence.items).toEqual([{ item_id: 'i:2', hidden_s: 16, longest_spell_s: 16 }])
  })

  it('never flags items shorter than 10 s, whatever the log', () => {
    fc.assert(
      fc.property(
        fc.array(fc.tuple(fc.integer({ min: 0, max: 60_000 }), fc.boolean()), { maxLength: 20 }),
        fc.array(fc.integer({ min: 100, max: 10_000 }), { minLength: 1, maxLength: 6 }),
        (log, durations) => {
          let t = 0
          const rs = durations.map((d, i) => {
            const r = resp(i, { onset_ms: t, rt_ms: d })
            t += d + 1000
            return r
          })
          const ev: VisibilityEvent[] = log.map(([t_ms, h]) => ({ t_ms, state: h ? 'hidden' : 'visible' }))
          const res = visibilityCheck(rs, ev)
          expect(res.flagged).toBe(false)
          expect(res.evidence.total_hidden_s).toBeLessThanOrEqual(durations.reduce((s, d) => s + d, 0) / 1000 + 1e-9)
        },
      ),
    )
  })

  it('adding a hidden spell never removes a flag (monotone)', () => {
    fc.assert(
      fc.property(
        fc.array(fc.integer({ min: 0, max: 160_000 }), { maxLength: 8 }),
        fc.integer({ min: 0, max: 150_000 }),
        fc.integer({ min: 1, max: 30_000 }),
        (cuts, from, len) => {
          const sorted = [...cuts].sort((x, y) => x - y)
          const ev: VisibilityEvent[] = sorted.map((t_ms, i) => ({ t_ms, state: i % 2 === 0 ? 'hidden' : 'visible' }))
          if (sorted.length % 2 === 1) ev.push({ t_ms: 200_000, state: 'visible' })
          const before = visibilityCheck(items, ev)
          // The union of the old spells and [from, from + len) as a fresh log.
          const spells = [...hiddenIntervals(ev), [from, from + len] as [number, number]].sort((x, y) => x[0] - y[0])
          const merged: [number, number][] = []
          for (const [s, e] of spells) {
            const last = merged[merged.length - 1]
            if (last !== undefined && s <= last[1]) last[1] = Math.max(last[1], e)
            else merged.push([s, e])
          }
          const after = visibilityCheck(items, merged.flatMap(([s, e]) => spell(s, e)))
          expect(after.evidence.total_hidden_s).toBeGreaterThanOrEqual(before.evidence.total_hidden_s - 1e-9)
          for (const it of before.evidence.items) expect(after.evidence.items.map((x) => x.item_id)).toContain(it.item_id)
        },
      ),
    )
  })
})

// ---------------------------------------------------------------------------------- paste

describe('pasteCheck', () => {
  const items = [resp(0), resp(1)]

  it('does not flag a session without paste events', () => {
    expect(pasteCheck(items, [])).toEqual({ flagged: false, evidence: { count: 0, item_ids: [] } })
  })

  it('flags any paste event and attributes it by item_id or by window', () => {
    const res = pasteCheck(items, [{ t_ms: 70_000 }, { t_ms: 5, item_id: 'i:0' }, { t_ms: 40_000 }])
    expect(res.flagged).toBe(true)
    expect(res.evidence.count).toBe(3) // the one between items is counted but not attributed
    expect(res.evidence.item_ids).toEqual(['i:0', 'i:1'])
  })

  it('flagged ⇔ at least one event; attributed ids are response ids', () => {
    fc.assert(
      fc.property(fc.array(fc.integer({ min: 0, max: 130_000 }), { maxLength: 10 }), (ts) => {
        const res = pasteCheck(items, ts.map((t_ms) => ({ t_ms })))
        expect(res.flagged).toBe(ts.length > 0)
        expect(res.evidence.count).toBe(ts.length)
        for (const id of res.evidence.item_ids) expect(['i:0', 'i:1']).toContain(id)
      }),
    )
  })
})

// ------------------------------------------------------------------------------- too fast

describe('tooFastCheck (correct, RT < 25% of median, median > 20 s)', () => {
  it('flags a correct 5 s answer on a 30 s item; median source is expected_time_s until norms exist', () => {
    const res = tooFastCheck([resp(0, { rt_ms: 5000 }), resp(1)])
    expect(res.flagged).toBe(true)
    expect(res.evidence).toEqual({
      count: 1,
      items: [{ item_id: 'i:0', rt_s: 5, median_s: 30, median_source: 'expected_time', ratio: 5 / 30 }],
    })
  })

  it('ignores wrong answers and blocks without a correct/incorrect score', () => {
    expect(tooFastCheck([resp(0, { rt_ms: 1000, correct: 0 }), resp(1, { rt_ms: 1000, correct: null })]).flagged).toBe(false)
  })

  it('needs median > 20 s and RT strictly below 25%', () => {
    expect(tooFastCheck([resp(0, { rt_ms: 1000, expected_time_s: 20 })]).flagged).toBe(false)
    expect(tooFastCheck([resp(0, { rt_ms: 7500, expected_time_s: 30 })]).flagged).toBe(false) // exactly 25%
    expect(tooFastCheck([resp(0, { rt_ms: 7499, expected_time_s: 30 })]).flagged).toBe(true)
  })

  it('uses the norms median when present, in both directions', () => {
    // expected 30 s but norms median 18 s: not a long item any more.
    expect(tooFastCheck([resp(0, { rt_ms: 3000, expected_time_s: 30, median_time_s: 18 })]).flagged).toBe(false)
    // expected 15 s but norms median 40 s: 8 s is under 25%.
    const res = tooFastCheck([resp(0, { rt_ms: 8000, expected_time_s: 15, median_time_s: 40 })])
    expect(res.flagged).toBe(true)
    expect(res.evidence.items[0]!.median_source).toBe('norms')
  })

  it('slowing every response down never adds a too-fast item', () => {
    fc.assert(
      fc.property(
        fc.array(fc.tuple(fc.integer({ min: 1, max: 90_000 }), fc.double({ min: 5, max: 90, noNaN: true }), fc.boolean()), {
          minLength: 1,
          maxLength: 12,
        }),
        fc.double({ min: 1, max: 5, noNaN: true }),
        (rows, k) => {
          const rs = rows.map(([rt, e, c], i) => resp(i, { rt_ms: rt, expected_time_s: e, correct: c ? 1 : 0 }))
          const slow = rs.map((r) => ({ ...r, rt_ms: r.rt_ms * k, end_ms: r.onset_ms + r.rt_ms * k }))
          expect(tooFastCheck(slow).evidence.count).toBeLessThanOrEqual(tooFastCheck(rs).evidence.count)
        },
      ),
    )
  })
})

// ----------------------------------------------------------------------------- uniform RT

describe('uniformRtCheck (SD of ln RT < 0.1 across items of very different lengths)', () => {
  const expected = [10, 15, 20, 30, 45, 60]

  it('flags near-constant RTs on items whose expected times span 6×', () => {
    const rs = expected.map((e, i) => resp(i, { expected_time_s: e, rt_ms: 20_000 * (1 + 0.02 * (i % 3)) }))
    const res = uniformRtCheck(rs)
    expect(res.flagged).toBe(true)
    expect(res.evidence.applies).toBe(true)
    expect(res.evidence.time_ratio).toBe(6)
    expect(res.evidence.sd_log_rt!).toBeLessThan(0.1)
  })

  it('does not flag RTs that track the item lengths', () => {
    const rs = expected.map((e, i) => resp(i, { expected_time_s: e, rt_ms: 900 * e }))
    const res = uniformRtCheck(rs)
    expect(res.flagged).toBe(false)
    expect(res.evidence.sd_log_rt!).toBeGreaterThan(0.5)
  })

  it('does not apply when the expected times span less than 2× or there are too few items', () => {
    const narrow = [20, 25, 30, 35, 39].map((e, i) => resp(i, { expected_time_s: e, rt_ms: 20_000 }))
    expect(uniformRtCheck(narrow)).toMatchObject({ flagged: false, evidence: { applies: false } })
    const few = [10, 60, 30, 20].map((e, i) => resp(i, { expected_time_s: e, rt_ms: 20_000 }))
    expect(few.length).toBeLessThan(UNIFORM_RT_MIN_ITEMS)
    expect(uniformRtCheck(few)).toMatchObject({ flagged: false, evidence: { applies: false, sd_log_rt: 0 } })
    expect(uniformRtCheck([]).evidence).toEqual({ n_items: 0, time_ratio: null, sd_log_rt: null, applies: false })
  })

  it('skips zero RTs (no log) and is invariant to the time unit', () => {
    fc.assert(
      fc.property(
        fc.array(fc.tuple(fc.integer({ min: 1, max: 100_000 }), fc.double({ min: 5, max: 120, noNaN: true })), {
          minLength: 2,
          maxLength: 15,
        }),
        fc.double({ min: 1e-3, max: 1e3, noNaN: true }),
        (rows, k) => {
          const rs = rows.map(([rt, e], i) => resp(i, { rt_ms: rt, expected_time_s: e }))
          const a = uniformRtCheck([...rs, resp(99, { rt_ms: 0, expected_time_s: 1000 })])
          const b = uniformRtCheck(rs.map((r) => ({ ...r, rt_ms: r.rt_ms * k, end_ms: r.onset_ms + r.rt_ms * k })))
          expect(a.evidence.n_items).toBe(rs.length)
          close(b.evidence.sd_log_rt, a.evidence.sd_log_rt!, 1e-9)
          expect(a.flagged).toBe(a.evidence.applies && a.evidence.sd_log_rt! < UNIFORM_RT_MAX_SD)
        },
      ),
    )
  })
})

// ------------------------------------------------------------------------ Poisson-binomial

describe('Poisson-binomial', () => {
  const binom = (n: number, k: number): number => {
    let c = 1
    for (let i = 1; i <= k; i++) c = (c * (n - k + i)) / i
    return c
  }

  it('reduces to the binomial when all p are equal', () => {
    const pmf = poissonBinomialPmf(new Array(10).fill(0.2))
    for (let k = 0; k <= 10; k++) close(pmf[k]!, binom(10, k) * 0.2 ** k * 0.8 ** (10 - k), 1e-13)
    // P(X ≥ 5 | Bin(10, 0.2)) = 0.0327934976 (1 − 0.9672065024).
    close(poissonBinomialUpperTail(new Array(10).fill(0.2), 5), 0.0327934976, 1e-12)
  })

  it('matches brute-force enumeration over all 2^n outcomes', () => {
    fc.assert(
      fc.property(fc.array(fc.double({ min: 0, max: 1, noNaN: true }), { minLength: 0, maxLength: 10 }), (ps) => {
        const n = ps.length
        const brute = new Array<number>(n + 1).fill(0)
        for (let mask = 0; mask < 1 << n; mask++) {
          let pr = 1
          let k = 0
          for (let j = 0; j < n; j++) {
            if (mask & (1 << j)) {
              pr *= ps[j]!
              k++
            } else pr *= 1 - ps[j]!
          }
          brute[k]! += pr
        }
        const pmf = poissonBinomialPmf(ps)
        expect(pmf.length).toBe(n + 1)
        for (let k = 0; k <= n; k++) expect(Math.abs(pmf[k]! - brute[k]!)).toBeLessThan(1e-12)
        for (let x = 0; x <= n + 1; x++) {
          const tail = brute.slice(x).reduce((s, v) => s + v, 0)
          expect(Math.abs(poissonBinomialUpperTail(ps, x) - tail)).toBeLessThan(1e-12)
        }
      }),
    )
  })

  it('has the right edges and keeps tiny tails accurate', () => {
    expect(poissonBinomialPmf([])).toEqual([1])
    expect(poissonBinomialUpperTail([0.3, 0.4], 0)).toBe(1)
    expect(poissonBinomialUpperTail([0.3, 0.4], -1)).toBe(1)
    expect(poissonBinomialUpperTail([0.3, 0.4], 3)).toBe(0)
    expect(Math.abs(poissonBinomialUpperTail(new Array(20).fill(1e-3), 20) / 1e-60 - 1)).toBeLessThan(1e-12)
    close(poissonBinomialUpperTail([0.1, 0.2, 0.3], 1.5), 0.1 * 0.2 + 0.1 * 0.3 + 0.2 * 0.3 - 2 * 0.1 * 0.2 * 0.3, 1e-12)
    expect(() => poissonBinomialPmf([1.5])).toThrow(RangeError)
    expect(() => poissonBinomialPmf([NaN])).toThrow(RangeError)
  })
})

// ---------------------------------------------------------------------------- hard items

describe('hardItemCheck (accuracy on b > θ + 1.5 above expectation, exact p < .01)', () => {
  const hard = [2.0, 2.2, 2.5, 2.8, 3.0, 3.3]
  const rs = (ys: readonly (0 | 1)[]) => hard.map((b, i) => resp(i, { params: { model: '2pl', a: 1.2, b }, correct: ys[i]! }))

  it('flags all six hard items correct, with the exact tail Π P_j as the p-value', () => {
    const res = hardItemCheck(rs([1, 1, 1, 1, 1, 1]), { MAT: 0 })
    const ps = hard.map((b) => logistic(1.2 * (0 - b)))
    expect(res.flagged).toBe(true)
    expect(res.evidence.n_hard).toBe(6)
    expect(res.evidence.n_correct).toBe(6)
    close(res.evidence.p_value, ps.reduce((s, p) => s * p, 1), 1e-12)
    close(res.evidence.expected_correct, ps.reduce((s, p) => s + p, 0), 1e-12)
    expect(res.evidence.items[0]).toEqual({ item_id: 'i:0', axis: 'MAT', b: 2.0, theta: 0, p: ps[0], correct: 1 })
  })

  it('does not flag one hard item correct out of six', () => {
    const res = hardItemCheck(rs([0, 0, 1, 0, 0, 0]), { MAT: 0 })
    expect(res.flagged).toBe(false)
    expect(res.evidence.p_value).toBeGreaterThan(0.1)
  })

  it('counts only b > θ + 1.5 (strict), dichotomous scored items, at θ of the item axis', () => {
    const items = [
      resp(0, { params: { model: '2pl', a: 1, b: 1.5 }, correct: 1 }), // b = θ + 1.5: not hard
      resp(1, { params: { model: '3pl', a: 1, b: 1.6, c: 0.25 }, correct: 1 }), // hard, 3PL
      resp(2, { params: { model: '2pl_testlet', a: 1, b: 1.7 }, correct: 0 }), // hard, as 2PL
      resp(3, { params: { model: 'grm', a: 1, b: [2, 3] }, correct: null }), // not dichotomous
      resp(4, { axis: 'SPA', params: { model: '2pl', a: 1, b: 1.6 }, correct: 1 }), // θ_SPA = 1: not hard
    ]
    const res = hardItemCheck(items, { MAT: 0, SPA: 1 })
    expect(res.evidence.items.map((x) => x.item_id)).toEqual(['i:1', 'i:2'])
    close(res.evidence.items[0]!.p, p3pl(0, 1, 1.6, 0.25))
    expect(res.evidence.n_correct).toBe(1)
    expect(() => hardItemCheck(items, { MAT: 0 })).toThrow(RangeError) // θ missing for SPA
  })

  it('reports p = 1 and no flag without hard items', () => {
    expect(hardItemCheck([resp(0)], { MAT: 0 }).evidence).toMatchObject({ n_hard: 0, n_correct: 0, p_value: 1 })
  })

  it('is an exact level-.01 test: responses drawn from the model at θ are flagged at most 1% of the time', () => {
    const rng = createRng('hard-level')
    const bs = [1.8, 2.0, 2.1, 2.4, 2.6, 3.0, 3.5, 2.2, 1.9, 2.9]
    const params = bs.map((b, i) => ({ a: 0.8 + 0.1 * i, b }))
    const n = 20_000
    let flagged = 0
    for (let s = 0; s < n; s++) {
      const items = params.map(({ a, b }, i) => resp(i, { params: { model: '2pl', a, b }, correct: rng.next() < p2pl(0, a, b) ? 1 : 0 }))
      if (hardItemCheck(items, { MAT: 0 }).flagged) flagged++
    }
    // The exact test has size ≤ α; with a discrete statistic it is below α. SE of the rate ≈ 0.0007.
    expect(flagged / n).toBeLessThanOrEqual(HARD_ITEM_ALPHA + 0.002)
  })
})

// ---------------------------------------------------------------------------------- lz*

describe('lzStar (Snijders 2001)', () => {
  const s = logistic

  it('hand example 1: Rasch b = (−1, 1), θ̂ = 0 by symmetry: lz* = √(2/e) for (1, 0), −√(2e) for (0, 1)', () => {
    // W = ±2σ(∓1), c = 0 (symmetric), Var = 2σ(1)σ(−1).
    close(lzStar(rasch([-1, 1], [1, 0]), { MAT: 0 }, { MAT: 0 }).lz_star, Math.sqrt(2 / Math.E))
    close(lzStar(rasch([-1, 1], [0, 1]), { MAT: 0 }, { MAT: 0 }).lz_star, -Math.sqrt(2 * Math.E))
  })

  it('hand example 2: Rasch b = (−2, −1, 1, 2), θ̂ = 0, Guttman and reversed patterns', () => {
    const v = 8 * s(2) * s(-2) + 2 * s(1) * s(-1)
    close(lzStar(rasch([-2, -1, 1, 2], [1, 1, 0, 0]), { MAT: 0 }, { MAT: 0 }).lz_star, (4 * s(-2) + 2 * s(-1)) / Math.sqrt(v))
    close(lzStar(rasch([-2, -1, 1, 2], [0, 0, 1, 1]), { MAT: 0 }, { MAT: 0 }).lz_star, -(4 * s(2) + 2 * s(1)) / Math.sqrt(v))
    // The same through the Bayes modal path: the N(0, 1) prior keeps θ̂ = 0 and r_0 = 0.
    const fit = personFitCheck(toResponses(rasch([-2, -1, 1, 2], [0, 0, 1, 1])))
    close(fit.evidence.theta.MAT!, 0, 1e-9)
    close(fit.evidence.lz_star, -(4 * s(2) + 2 * s(1)) / Math.sqrt(v), 1e-9)
  })

  it('hand example 3 (correction active): Rasch b = (0, 1), X = (1, 0), θ = 0, r_0 = 0.5', () => {
    // P = (½, σ(−1)); w = (0, −1); r = 1; W = σ(−1); c = −σ(1)σ(−1)/(¼ + σ(1)σ(−1));
    // numerator = W + ½c; Var = ¼c² + σ(1)σ(−1)(1 + c)².
    const pq = s(1) * s(-1)
    const c = -pq / (0.25 + pq)
    const res = lzStar(rasch([0, 1], [1, 0]), { MAT: 0 }, { MAT: 0.5 })
    close(res.c.MAT!, c)
    close(res.lz_star, (s(-1) + 0.5 * c) / Math.sqrt(0.25 * c * c + pq * (1 + c) * (1 + c)))
    close(res.lz_star, 0.147183, 1e-5) // by calculator
    close(res.lz, s(-1) / Math.sqrt(pq))
  })

  it('matches an independent 40-digit mpmath computation (2 axes, 2PL + 3PL, Bayes modal θ̂)', () => {
    // Reference: Magis et al. (2012) formulas with P' by mpmath numerical differentiation and θ̂
    // by mpmath.findroot on the numerically differentiated log posterior (N(0, 1) prior).
    const obs: DichotomousObservation[] = [
      { kind: '2pl', axis: 'MAT', a: 1.2, b: -1.0, y: 1 },
      { kind: '2pl', axis: 'MAT', a: 0.8, b: -0.3, y: 1 },
      { kind: '2pl', axis: 'MAT', a: 1.5, b: 0.4, y: 0 },
      { kind: '2pl', axis: 'MAT', a: 1.0, b: 1.1, y: 1 },
      { kind: '2pl', axis: 'MAT', a: 0.7, b: 2.0, y: 0 },
      { kind: '3pl', axis: 'SPA', a: 1.3, b: -0.5, c: 0.25, y: 1 },
      { kind: '3pl', axis: 'SPA', a: 0.9, b: 0.2, c: 0.25, y: 0 },
      { kind: '3pl', axis: 'SPA', a: 1.6, b: 0.9, c: 0.25, y: 1 },
      { kind: '3pl', axis: 'SPA', a: 1.1, b: 1.5, c: 0.25, y: 0 },
    ]
    const theta = bayesModalTheta(obs)
    close(theta.MAT!, 0.32119296313751961, 1e-9)
    close(theta.SPA!, 0.13258452628945279, 1e-9)
    const res = lzStar(obs, theta, { MAT: -theta.MAT!, SPA: -theta.SPA! })
    close(res.c.MAT!, 0.001306475460310718, 1e-9)
    close(res.c.SPA!, 0.3365808446765492, 1e-9)
    close(res.w, 0.24206039300123942, 1e-9)
    close(res.lz_star, 0.18662764647390906, 1e-9)
    close(res.lz, 0.22253311136631941, 1e-9)
    close(personFitCheck(toResponses(obs)).evidence.lz_star, 0.18662764647390906, 1e-9)
  })

  const obsArb = fc.array(
    fc.record({
      three: fc.boolean(),
      axis: fc.constantFrom<AxisCode>('MAT', 'SPA', 'QR'),
      a: fc.double({ min: 0.3, max: 2.5, noNaN: true }),
      b: fc.double({ min: -3, max: 3, noNaN: true }),
      y: fc.constantFrom<0 | 1>(0, 1),
    }),
    { minLength: 1, maxLength: 25 },
  ).map((rows) =>
    rows.map(({ three, axis, a, b, y }): DichotomousObservation =>
      three ? { kind: '3pl', axis, a, b, c: 0.25, y } : { kind: '2pl', axis, a, b, y },
    ),
  )

  it('agrees with a naive re-derivation (numerical P′, ln P − ln(1 − P)) on random multi-axis patterns', () => {
    const P = (o: DichotomousObservation, t: number) => (o.kind === '3pl' ? p3pl(t, o.a, o.b, o.c) : p2pl(t, o.a, o.b))
    fc.assert(
      fc.property(obsArb, fc.double({ min: -2, max: 2, noNaN: true }), fc.double({ min: -1, max: 1, noNaN: true }), (obs, t0, r0) => {
        const theta: Partial<Record<AxisCode, number>> = { MAT: t0, SPA: t0 / 2, QR: -t0 }
        const r0s: Partial<Record<AxisCode, number>> = { MAT: r0, SPA: -r0, QR: 2 * r0 }
        let W = 0
        let numerator = 0
        let v = 0
        let v0 = 0
        for (const axis of ['MAT', 'SPA', 'QR'] as const) {
          const mine = obs.filter((o) => o.axis === axis)
          if (mine.length === 0) continue
          const t = theta[axis]!
          const h = 1e-6
          const rows = mine.map((o) => {
            const p = P(o, t)
            const dp = (P(o, t + h) - P(o, t - h)) / (2 * h)
            return { y: o.y, p, dp, w: Math.log(p) - Math.log(1 - p), r: dp / (p * (1 - p)) }
          })
          const c = rows.reduce((acc, x) => acc + x.dp * x.w, 0) / rows.reduce((acc, x) => acc + x.dp * x.r, 0)
          const Wk = rows.reduce((acc, x) => acc + (x.y - x.p) * x.w, 0)
          W += Wk
          numerator += Wk + c * r0s[axis]!
          v += rows.reduce((acc, x) => acc + (x.w - c * x.r) ** 2 * x.p * (1 - x.p), 0)
          v0 += rows.reduce((acc, x) => acc + x.w * x.w * x.p * (1 - x.p), 0)
        }
        const res = lzStar(obs, theta, r0s)
        close(res.w, W, 1e-7)
        // Compare where the corrected variance is well conditioned; a degenerate one (e.g. one
        // item per axis: w̃ ≡ 0) must come back null rather than as rounding noise. The naive
        // ln P − ln(1 − P) carries ~1e-16 absolute error, hence the absolute floor.
        if (res.lz_star === null) expect(v).toBeLessThanOrEqual(1e-8 * v0 + 1e-20)
        else if (v > 1e-6 * v0) close(res.lz_star, numerator / Math.sqrt(v), 1e-6)
      }),
    )
  })

  it('at the Bayes modal θ̂, W + c·r_0 equals the projected residual Σ (X − P) w̃ (estimating equation)', () => {
    // Snijders' numerator is Σ (X − P)(w − c r) exactly when θ̂ solves r_0 + Σ (X − P) r = 0, so
    // this checks the sign and scale of r_0 = −θ̂ for the N(0, 1) Bayes modal estimator.
    fc.assert(
      fc.property(obsArb, (obs) => {
        const theta = bayesModalTheta(obs)
        const r0: Partial<Record<AxisCode, number>> = {}
        for (const [k, t] of Object.entries(theta)) r0[k as AxisCode] = -t
        const res = lzStar(obs, theta, r0)
        let numerator = res.w
        for (const [k, c] of Object.entries(res.c)) numerator += c * r0[k as AxisCode]!
        let projected = 0
        for (const o of obs) {
          const t = theta[o.axis]!
          const p = pCorrect(o, t)
          const dp = (pCorrect(o, t + 1e-6) - pCorrect(o, t - 1e-6)) / 2e-6
          projected += (o.y - p) * (Math.log(p / (1 - p)) - res.c[o.axis]! * (dp / (p * (1 - p))))
        }
        expect(Math.abs(numerator - projected)).toBeLessThan(1e-6 * (1 + Math.abs(projected)))
      }),
    )
  })

  it('is undefined (null) when the correction absorbs every residual, not rounding noise', () => {
    // Equal-difficulty Rasch items: w ∝ r, so w̃ ≡ 0.
    expect(lzStar(rasch([0.3, 0.3, 0.3, 0.3], [1, 1, 0, 0]), { MAT: 0 }, { MAT: 0 }).lz_star).toBeNull()
    // One item per axis (w̃ = w − (w/r)·r cancels only to rounding).
    const single: DichotomousObservation[] = [
      { kind: '2pl', axis: 'MAT', a: 1.3, b: 0.7, y: 1 },
      { kind: '3pl', axis: 'SPA', a: 0.9, b: -0.4, c: 0.25, y: 0 },
      { kind: '2pl', axis: 'QR', a: 0.6, b: 1.9, y: 0 },
    ]
    const res = lzStar(single, { MAT: 0.1, SPA: -0.3, QR: 0.2 }, { MAT: 0, SPA: 0, QR: 0 })
    expect(res.lz_star).toBeNull()
    expect(res.lz).not.toBeNull()
    expect(lzStar([], {}, {})).toMatchObject({ n_items: 0, lz_star: null, lz: null, w: 0 })
  })

  it('rejects missing θ / r_0 and non-dichotomous observations', () => {
    expect(() => lzStar(rasch([0, 1], [1, 0]), {}, { MAT: 0 })).toThrow(RangeError)
    expect(() => lzStar(rasch([0, 1], [1, 0]), { MAT: 0 }, {})).toThrow(RangeError)
    const bad = [{ kind: 'grm', axis: 'MAT', a: 1, b: [0, 1], y: 1 }] as unknown as DichotomousObservation[]
    expect(() => lzStar(bad, { MAT: 0 }, { MAT: 0 })).toThrow(RangeError)
  })

  it('null distribution by simulation: lz* ≈ N(0, 1) while the uncorrected lz is too narrow', () => {
    // 2,000 simulees, one axis, 40 2PL items (a ~ lognormal(0.2, 0.3), b ~ N(0, 1.2)), θ ~ N(0, 1),
    // Bayes modal θ̂. Measured (seed below): lz* mean ≈ 0.08, SD ≈ 0.98, P(lz* < −2) ≈ 0.028;
    // lz SD ≈ 0.90 (Snijders' point: estimating θ shrinks lz's variance).
    const rng = createRng('lz-null')
    const star: number[] = []
    const raw: number[] = []
    for (let s = 0; s < 2000; s++) {
      const th = rng.normal()
      const obs: DichotomousObservation[] = []
      for (let j = 0; j < 40; j++) {
        const a = Math.exp(rng.normal(0.2, 0.3))
        const b = rng.normal(0, 1.2)
        obs.push({ kind: '2pl', axis: 'MAT', a, b, y: rng.next() < p2pl(th, a, b) ? 1 : 0 })
      }
      const fit = personFitCheck(toResponses(obs)).evidence
      star.push(fit.lz_star!)
      raw.push(fit.lz!)
    }
    const mean = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / xs.length
    const sd = (xs: number[]) => Math.sqrt(xs.reduce((a, b) => a + (b - mean(xs)) ** 2, 0) / (xs.length - 1))
    expect(Math.abs(mean(star))).toBeLessThan(0.2)
    expect(sd(star)).toBeGreaterThan(0.92)
    expect(sd(star)).toBeLessThan(1.06)
    expect(sd(raw)).toBeLessThan(sd(star) - 0.04)
    const tail = star.filter((x) => x < -2).length / star.length
    expect(tail).toBeGreaterThan(0.01)
    expect(tail).toBeLessThan(0.045) // Φ(−2) = 0.0228
  })

  it('aberrant patterns give low lz*: preknowledge, random responding and reversed Guttman', () => {
    // 30 2PL items per simulee, 300 simulees per pattern. Measured: mean lz* ≈ −6.9 / −5.0 / −9.8,
    // P(lz* < −2) ≈ 1.00 / 0.94 / 0.96 (vs ≈ 0.02 for model-conforming patterns).
    const kinds = ['preknowledge', 'random', 'reversed'] as const
    for (const kind of kinds) {
      const rng = createRng(`lz-aberrant-${kind}`)
      let low = 0
      let total = 0
      for (let s = 0; s < 300; s++) {
        const th = kind === 'preknowledge' ? -1 : rng.normal()
        const obs: DichotomousObservation[] = []
        for (let j = 0; j < 30; j++) {
          const a = Math.exp(rng.normal(0.2, 0.3))
          const b = rng.normal(0, 1.2)
          let y: 0 | 1
          if (kind === 'preknowledge') y = b > 0 ? 1 : rng.next() < p2pl(th, a, b) ? 1 : 0 // hard items known
          else if (kind === 'random') y = rng.next() < 0.5 ? 1 : 0
          else y = b > th ? 1 : 0 // right on hard items, wrong on easy ones
          obs.push({ kind: '2pl', axis: 'MAT', a, b, y })
        }
        const fit = personFitCheck(toResponses(obs))
        total += fit.evidence.lz_star!
        if (fit.flagged) low++
      }
      expect(total / 300, kind).toBeLessThan(-3.5)
      expect(low / 300, kind).toBeGreaterThan(0.85)
    }
  })
})

describe('personFitCheck (lz* < −2 with ≥ 20 items)', () => {
  const reversedGuttman = (n: number): IntegrityResponse[] => {
    const bs = Array.from({ length: n }, (_, i) => -2 + (4 * i) / (n - 1))
    return toResponses(rasch(bs, bs.map((b) => (b > 0 ? 1 : 0))))
  }

  it('flags a reversed Guttman pattern on 20 items', () => {
    const res = personFitCheck(reversedGuttman(20))
    expect(res.evidence.n_items).toBe(20)
    expect(res.evidence.lz_star!).toBeLessThan(LZ_STAR_MAX)
    expect(res.flagged).toBe(true)
  })

  it('does not flag the same kind of pattern on 19 items (too few), though lz* < −2', () => {
    const res = personFitCheck(reversedGuttman(19))
    expect(res.evidence.lz_star!).toBeLessThan(LZ_STAR_MAX)
    expect(res.flagged).toBe(false)
  })

  it('does not flag a Guttman (perfectly ordered) pattern, and ignores non-dichotomous responses', () => {
    const bs = Array.from({ length: 24 }, (_, i) => -2 + (4 * i) / 23)
    const rs = [
      ...toResponses(rasch(bs, bs.map((b) => (b < 0 ? 1 : 0)))),
      resp(100, { params: { model: 'gaussian', lam: -1, d: 0, sigma: 0.3 }, correct: null }),
      resp(101, { params: { model: '2pl', a: 1, b: 0 }, correct: null }),
    ]
    const res = personFitCheck(rs)
    expect(res.evidence.n_items).toBe(24)
    expect(res.evidence.lz_star!).toBeGreaterThan(0)
    expect(res.flagged).toBe(false)
  })
})

describe('dichotomousObservation', () => {
  it('maps 2PL, 3PL and 2PL-testlet items and skips the rest', () => {
    expect(dichotomousObservation(resp(0, { params: { model: '2pl_testlet', a: 1.1, b: 0.2 }, correct: 0 }))).toEqual({
      kind: '2pl',
      axis: 'MAT',
      a: 1.1,
      b: 0.2,
      y: 0,
    })
    expect(dichotomousObservation(resp(0, { params: { model: '3pl', a: 1, b: 0, c: 0.25 } }))).toMatchObject({ kind: '3pl', c: 0.25 })
    expect(dichotomousObservation(resp(0, { params: { model: 'grm', a: 1, b: [0] }, correct: 1 }))).toBeNull()
    expect(dichotomousObservation(resp(0, { correct: null }))).toBeNull()
  })
})

// ------------------------------------------------------------------------------- report

describe('integrityReport', () => {
  const clean = (): IntegrityResponse[] => Array.from({ length: 6 }, (_, i) => resp(i, { expected_time_s: 20 + 10 * i, rt_ms: 700 * (20 + 10 * i) }))

  it('a clean session: no flags, eligible, zero save-file counters', () => {
    const rep = integrityReport({ responses: clean() })
    expect(rep.flags).toEqual([])
    expect(rep.item_flags).toEqual({})
    expect(rep.save_flags).toEqual({ visibility_hidden_s: 0, paste_events: 0, fast_guess_n: 0 })
    expect(rep.calibration_eligible).toBe(true)
    expect(Object.keys(rep.checks)).toEqual([...FLAG_KINDS])
  })

  it('one flag keeps the session eligible; two kinds make it ineligible; item flags and §8 counters', () => {
    const rs = clean()
    const one = integrityReport({ responses: rs, paste: [{ t_ms: rs[1]!.onset_ms + 10 }] })
    expect(one.flags.map((f) => f.kind)).toEqual(['paste'])
    expect(one.calibration_eligible).toBe(true)

    const fast = rs.map((r, i) => (i === 3 ? { ...r, rt_ms: 5000, end_ms: r.onset_ms + 5000 } : r))
    const visibility: VisibilityEvent[] = [
      { t_ms: fast[3]!.onset_ms + 100, state: 'hidden' },
      { t_ms: fast[3]!.onset_ms + 200, state: 'visible' },
      { t_ms: fast[1]!.onset_ms + 1000, state: 'hidden' },
      { t_ms: fast[1]!.onset_ms + 13_240, state: 'visible' },
    ]
    const two = integrityReport({ responses: fast, paste: [{ t_ms: 0, item_id: fast[3]!.item_id }], visibility })
    expect(two.flags.map((f) => f.kind)).toEqual(['visibility_hidden', 'paste', 'too_fast'])
    expect(two.calibration_eligible).toBe(false)
    expect(two.item_flags).toEqual({ 'i:1': ['visibility_hidden'], 'i:3': ['paste', 'too_fast'] })
    expect(two.save_flags).toEqual({ visibility_hidden_s: 12.3, paste_events: 1, fast_guess_n: 1 })
  })

  it('person_fit alone makes the session ineligible (§13 "or lz* < −2")', () => {
    const bs = Array.from({ length: 24 }, (_, i) => -2 + (4 * i) / 23)
    const rs = toResponses(rasch(bs, bs.map((b) => (b > 0 ? 1 : 0)))).map((r, i) => ({
      ...r,
      expected_time_s: 20 + i,
      rt_ms: 800 * (20 + i) * (1 + 0.3 * Math.sin(i)),
      end_ms: r.onset_ms + 800 * (20 + i) * (1 + 0.3 * Math.sin(i)),
    }))
    const rep = integrityReport({ responses: rs })
    expect(rep.flags.map((f) => f.kind)).toContain('person_fit')
    expect(rep.calibration_eligible).toBe(false)
    expect(calibrationEligible([{ kind: 'person_fit' }])).toBe(false)
    expect(calibrationEligible([{ kind: 'uniform_rt' }])).toBe(true)
    expect(calibrationEligible([{ kind: 'uniform_rt' }, { kind: 'too_fast' }])).toBe(false)
    expect(calibrationEligible([])).toBe(true)
  })

  it('flags uniform RT and hard-item accuracy in a session; the caller θ overrides the Bayes modal θ̂', () => {
    const bs = [-1, -0.5, 0, 0.5, 2.2, 2.5, 2.8, 3.1]
    const rs = bs.map((b, i) =>
      resp(i, { params: { model: '2pl', a: 1.3, b }, correct: 1, expected_time_s: 10 + 8 * i, rt_ms: 30_000 }),
    )
    const own = integrityReport({ responses: rs })
    expect(own.checks.uniform_rt.flagged).toBe(true)
    const withTheta = integrityReport({ responses: rs, theta: { MAT: 0 } })
    expect(withTheta.checks.hard_item_accuracy.flagged).toBe(true)
    expect(withTheta.checks.hard_item_accuracy.evidence.n_hard).toBe(4)
    expect(withTheta.flags.map((f) => f.kind)).toEqual(['uniform_rt', 'hard_item_accuracy'])
    // The session's own θ̂ is pulled up by the hard correct answers (a conservative test).
    expect(own.checks.person_fit.evidence.theta.MAT!).toBeGreaterThan(0.5)
    expect(() => integrityReport({ responses: rs, theta: { XYZ: 0 } as Partial<Record<AxisCode, number>> })).toThrow(RangeError)
    expect(() => integrityReport({ responses: rs, theta: { MAT: NaN } })).toThrow(RangeError)
  })

  it('is plain snake_case JSON and uses neutral, non-diagnostic wording (R-5.6.x, A13)', () => {
    const rng = createRng('report-json')
    const session = simulateSession(rng)
    const rep = integrityReport({ ...session, paste: [{ t_ms: session.responses[0]!.onset_ms + 1 }] })
    const text = JSON.stringify(rep)
    expect(JSON.parse(text)).toEqual(rep) // no Infinity, NaN or undefined
    const keys: string[] = []
    const walk = (v: unknown): void => {
      if (Array.isArray(v)) v.forEach(walk)
      else if (v !== null && typeof v === 'object') {
        for (const [k, x] of Object.entries(v)) {
          if (!/^i:/.test(k)) keys.push(k)
          walk(x)
        }
      }
    }
    walk(rep)
    for (const k of keys) expect(k, k).toMatch(/^[a-z0-9_]+$|^[A-Z]{2,3}$/)
    const banned = /autis|adhd|alexithym|diagnos|disorder|clinical|patholog|symptom|deficit|impair|cheat|fraud|liar|dishonest/i
    expect(text).not.toMatch(banned)
    for (const k of FLAG_KINDS) expect(k).not.toMatch(banned)
  })

  it('rejects malformed input', () => {
    expect(() => integrityReport({ responses: [resp(0), resp(0)] })).toThrow(RangeError) // duplicate id
    expect(() => integrityReport({ responses: [resp(0, { axis: 'XX' as AxisCode })] })).toThrow(RangeError)
    expect(() => integrityReport({ responses: [resp(0, { rt_ms: -1 })] })).toThrow(RangeError)
    expect(() => integrityReport({ responses: [resp(0, { rt_ms: Infinity })] })).toThrow(RangeError)
    expect(() => integrityReport({ responses: [resp(0, { expected_time_s: 0 })] })).toThrow(RangeError)
    expect(() => integrityReport({ responses: [resp(0, { median_time_s: -3 })] })).toThrow(RangeError)
    expect(() => integrityReport({ responses: [resp(0, { onset_ms: 10, end_ms: 5 })] })).toThrow(RangeError)
    expect(() => integrityReport({ responses: [resp(0, { correct: 2 as 1 })] })).toThrow(RangeError)
    expect(() => integrityReport({ responses: [resp(0)], paste: [{ t_ms: NaN }] })).toThrow(RangeError)
  })
})

// ------------------------------------------------------------ false positives (null model)

describe('well-behaved simulated sessions (controlled false-positive rate)', () => {
  it('never raise visibility, paste or uniform-RT flags', () => {
    fc.assert(
      fc.property(fc.integer(), (seed) => {
        const rep = integrityReport(simulateSession(createRng(seed)))
        expect(rep.checks.visibility_hidden.flagged).toBe(false)
        expect(rep.checks.paste.flagged).toBe(false)
        expect(rep.checks.uniform_rt.evidence.applies).toBe(true)
        expect(rep.checks.uniform_rt.flagged).toBe(false)
      }),
      { numRuns: 200 },
    )
  })

  it('flag rates stay at their nominal levels over batches of 300 sessions', () => {
    // Measured on 4,000 sessions of this model: person_fit 0.023 (nominal Φ(−2) = 0.023),
    // too_fast 0.031, hard_item_accuracy 0.0015, calibration-ineligible 0.023, others 0.
    fc.assert(
      fc.property(fc.integer(), (seed) => {
        const rng = createRng(`fp-${seed}`)
        const n = 300
        const count: Record<string, number> = {}
        let ineligible = 0
        for (let s = 0; s < n; s++) {
          const rep = integrityReport(simulateSession(rng))
          for (const f of rep.flags) count[f.kind] = (count[f.kind] ?? 0) + 1
          if (!rep.calibration_eligible) ineligible++
        }
        expect((count.person_fit ?? 0) / n).toBeLessThanOrEqual(0.06)
        expect((count.hard_item_accuracy ?? 0) / n).toBeLessThanOrEqual(0.02)
        expect((count.too_fast ?? 0) / n).toBeLessThanOrEqual(0.08)
        expect(ineligible / n).toBeLessThanOrEqual(0.06)
      }),
      { numRuns: 5 },
    )
  })
})
