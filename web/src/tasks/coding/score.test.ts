import fc from 'fast-check'
import { describe, expect, it } from 'vitest'
import { createRng } from '../../engine'
import {
  CODING_BETA,
  CODING_ERROR_FLAG_DENOM,
  CODING_MAX_ERROR_RATE,
  CODING_RATE_SCALE,
  CODING_SEQUENCE_LENGTH,
  CODING_TAU_RES,
  checkResponses,
  coding,
  codingOutcome,
  scoreCoding,
  type CodingResponse,
} from '.'
import { MalformedResponseError } from '../family'
import { evenTimes, scriptedResponses, syntheticResponses } from './synthetic'

const item = coding.generate('score')

describe('coding scoring (M1.11, A10)', () => {
  it('counts correct responses per minute over the 90 s window', () => {
    const r = scriptedResponses(item, evenTimes(60, 1_000))
    const o = codingOutcome(item, r)
    expect(o).toMatchObject({ attempted: 60, correct: 60, errors: 0, late: 0, error_rate: 0, high_error_rate: false, exhausted: false })
    expect(o.correct_per_min).toBe(40)
    expect(o.observation).toEqual({
      kind: 'gaussian',
      axis: 'PS',
      lam: CODING_RATE_SCALE,
      d: CODING_BETA,
      sigma: Math.sqrt(1 / 60 + CODING_TAU_RES ** 2),
      x: Math.log(40),
    })
    // A norm taker (40/min) sits exactly at θ = 0: x = lam·0 + d.
    expect(o.observation?.kind === 'gaussian' && o.observation.x - o.observation.d).toBe(0)
    expect(scoreCoding(item, r)).toEqual({ correct: null, observation: o.observation, flags: [], reasons: [] })
  })

  it('score() is a BlockScore: the observation with its own σ = √(1/correct + τ_res²), τ_res = params.sigma, and the flag (M1.F2)', () => {
    // 10 correct + 4 wrong: σ = √(1/10 + τ²) ≈ 0.32; params.sigma is τ_res = 0.05 only.
    const r = scriptedResponses(item, evenTimes(14, 1_000), (k) => k < 4)
    const s = coding.score(item, r)
    expect(codingOutcome(item, r)).toMatchObject({ correct: 10, errors: 4, high_error_rate: true })
    expect(s).toEqual({ correct: null, observation: codingOutcome(item, r).observation, flags: ['high_error_rate'], reasons: [] })
    expect(s.observation).toMatchObject({ kind: 'gaussian', sigma: Math.sqrt(1 / 10 + CODING_TAU_RES ** 2) })
    if (item.params.model !== 'gaussian' || s.observation?.kind !== 'gaussian') throw new Error('expected Gaussian params')
    expect(item.params.sigma).toBe(CODING_TAU_RES)
    expect(s.observation.sigma).toBe(Math.sqrt(1 / 10 + item.params.sigma ** 2))
  })

  it('the rate is over the full window, however early the responses stop', () => {
    const early = codingOutcome(item, scriptedResponses(item, evenTimes(30, 1_000))) // done by 30 s
    expect(early.correct_per_min).toBe(20)
  })

  it('counts only responses inside [0, 90 s): 89,999.999 ms counts, 90,000 ms is late', () => {
    const times = [...evenTimes(10, 1_000), 89_999.999, 90_000, 95_000]
    const o = codingOutcome(item, scriptedResponses(item, times))
    expect(o).toMatchObject({ attempted: 11, correct: 11, late: 2 })
    expect(codingOutcome(item, scriptedResponses(item, [0])).attempted).toBe(1)
  })

  it('late wrong answers do not count as errors either', () => {
    const o = codingOutcome(item, scriptedResponses(item, [...evenTimes(10, 1_000), 90_500, 91_000], (k) => k >= 10))
    expect(o).toMatchObject({ attempted: 10, correct: 10, errors: 0, late: 2, high_error_rate: false })
  })

  it('checks each response against the key of its own stimulus', () => {
    const r = scriptedResponses(item, evenTimes(20, 1_000), (k) => k % 4 === 1)
    const o = codingOutcome(item, r)
    expect(o).toMatchObject({ attempted: 20, correct: 15, errors: 5, error_rate: 0.25 })
    // Shifting the answers by one stimulus makes (almost) all of them wrong: no immediate repeats.
    const shifted: CodingResponse[] = r.slice(1).map((x, k) => ({ digit: x.digit, t_ms: (k + 1) * 1_000 }))
    expect(codingOutcome(item, shifted).correct).toBeLessThan(5)
    // 0 is a key the taker can press, and never right.
    expect(codingOutcome(item, [{ digit: 0, t_ms: 5 }]).errors).toBe(1)
  })

  it('flags an error rate above 20%, not at 20% (exact in integers)', () => {
    expect(CODING_MAX_ERROR_RATE).toBe(1 / CODING_ERROR_FLAG_DENOM)
    const at = codingOutcome(item, scriptedResponses(item, evenTimes(60, 1_000), (k) => k % 5 === 4))
    expect(at).toMatchObject({ errors: 12, attempted: 60, error_rate: 0.2, high_error_rate: false })
    const over = codingOutcome(item, scriptedResponses(item, evenTimes(60, 1_000), (k) => k % 5 === 4 || k === 0))
    expect(over).toMatchObject({ errors: 13, high_error_rate: true })
    expect(codingOutcome(item, scriptedResponses(item, evenTimes(5, 1_000), (k) => k === 0)).high_error_rate).toBe(false) // 1/5
    expect(codingOutcome(item, scriptedResponses(item, evenTimes(4, 1_000), (k) => k === 0)).high_error_rate).toBe(true) // 1/4
    // The flag is informational: the observation is still formed.
    expect(over.observation).not.toBeNull()
  })

  it('no correct response → no observation (ln 0), and score() gives the reason', () => {
    const none = codingOutcome(item, [])
    expect(none).toMatchObject({ attempted: 0, correct: 0, error_rate: 0, high_error_rate: false, correct_per_min: 0, observation: null })
    const wrong = scriptedResponses(item, evenTimes(30, 1_000), () => true)
    expect(codingOutcome(item, wrong)).toMatchObject({ correct: 0, errors: 30, high_error_rate: true, observation: null })
    expect(scoreCoding(item, wrong)).toEqual({ correct: null, flags: ['high_error_rate'], reasons: ['no_correct_responses'] })
    expect(scoreCoding(item, [])).toEqual({ correct: null, flags: [], reasons: ['no_correct_responses'] })
    const one = codingOutcome(item, scriptedResponses(item, [100]))
    expect(one.observation).toMatchObject({ x: Math.log(1 / 1.5), sigma: Math.sqrt(1 + 0.0025) })
  })

  it('SE follows the Poisson approximation 1/√correct, floored by τ_res', () => {
    fc.assert(
      fc.property(fc.integer({ min: 1, max: CODING_SEQUENCE_LENGTH }), (n) => {
        const o = codingOutcome(item, scriptedResponses(item, evenTimes(n, 80_000 / n)))
        if (o.observation?.kind !== 'gaussian') throw new Error('expected an observation')
        expect(o.observation.sigma).toBeCloseTo(Math.hypot(1 / Math.sqrt(n), CODING_TAU_RES), 14)
        expect(o.observation.sigma).toBeGreaterThan(CODING_TAU_RES)
        expect(o.observation.x).toBeCloseTo(Math.log(n / 1.5), 14)
      }),
    )
  })

  it('answering every stimulus inside the window marks the block exhausted (ceiling)', () => {
    const all = scriptedResponses(item, evenTimes(CODING_SEQUENCE_LENGTH, 400))
    expect(codingOutcome(item, all)).toMatchObject({ attempted: 200, correct: 200, exhausted: true })
    expect(codingOutcome(item, all.slice(0, 199)).exhausted).toBe(false)
  })

  it('all 200 answered but the last ones at or after 90 s: not exhausted, the late ones not counted', () => {
    const lastLate = scriptedResponses(item, [...evenTimes(199, 450), 90_000])
    expect(codingOutcome(item, lastLate)).toMatchObject({ attempted: 199, correct: 199, late: 1, exhausted: false })
    const tail = scriptedResponses(item, [...evenTimes(197, 456), 90_000, 90_000.5, 90_700], (k) => k >= 197)
    expect(codingOutcome(item, tail)).toMatchObject({ attempted: 197, correct: 197, errors: 0, late: 3, exhausted: false })
    const justIn = scriptedResponses(item, [...evenTimes(199, 450), 89_999.999])
    expect(codingOutcome(item, justIn)).toMatchObject({ attempted: 200, late: 0, exhausted: true })
  })

  it('rejects malformed streams', () => {
    const ok = scriptedResponses(item, evenTimes(3, 1_000))
    const bad: unknown[] = [
      [...ok.slice(0, 2), { digit: 3, t_ms: 500 }], // time goes backwards
      [{ digit: 10, t_ms: 1 }],
      [{ digit: -1, t_ms: 1 }],
      [{ digit: 2.5, t_ms: 1 }],
      [{ digit: '3', t_ms: 1 }],
      [{ digit: 3, t_ms: -1 }],
      [{ digit: 3, t_ms: Number.NaN }],
      [{ digit: 3, t_ms: Infinity }],
      [null],
      'not a stream',
      scriptedResponses(item, evenTimes(200, 10)).concat([{ digit: 1, t_ms: 5_000 }]), // 201 responses
    ]
    for (const b of bad) {
      expect(() => checkResponses(item, b as CodingResponse[])).toThrow(MalformedResponseError)
      expect(() => coding.score(item, b as CodingResponse[])).toThrow(MalformedResponseError)
    }
    // A hole in the stream is malformed too (not skipped).
    // eslint-disable-next-line no-sparse-arrays
    expect(() => coding.score(item, [ok[0], , ok[2]] as CodingResponse[])).toThrow(MalformedResponseError)
    expect(() => checkResponses(item, ok)).not.toThrow()
    expect(() => checkResponses(item, [{ digit: 1, t_ms: 5 }, { digit: 2, t_ms: 5 }])).not.toThrow() // equal times are fine
  })

  it('synthetic takers land near their pace (sanity of the parity-dump streams)', () => {
    const rng = createRng('pace')
    let sum = 0
    for (let i = 0; i < 40; i++) {
      const it = coding.generate(`pace-${i}`)
      const o = codingOutcome(it, syntheticResponses(it, { name: 't', rate_per_min: 40, error_p: 0, cv: 0.3, until_ms: 92_000 }, rng))
      sum += o.correct_per_min
    }
    expect(sum / 40).toBeGreaterThan(37)
    expect(sum / 40).toBeLessThan(43)
  })
})
