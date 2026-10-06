import fc from 'fast-check'
import { describe, expect, it } from 'vitest'
import {
  MAD_TO_SD,
  RT_NORMS_VERSION,
  RT_TOUCH_NORMS,
  RT_WEB_NORMS,
  SE_MEDIAN_FACTOR,
  classifyTrial,
  generateRtBlock,
  median,
  rtBlockObservation,
  rtEstimate,
  rtNorm,
  rtResponseProblems,
  scoreRtResponse,
  type RtBlockResult,
  type RtDevice,
  type RtMode,
  type RtResponse,
} from '.'

const DEVICE: RtDevice = { device_class: 'desktop' }
const SIMPLE_KEY: number[] = Array(30).fill(0)
const CHOICE_KEY: number[] = Array.from({ length: 40 }, (_, i) => i % 4)

/** A response with every scored trial at `rt` ms and the right position. */
function uniform(mode: RtMode, rt: number | ((i: number) => number | null)): { rt_ms: (number | null)[]; choice: (number | null)[] } {
  const key = mode === 'simple' ? SIMPLE_KEY : CHOICE_KEY
  const rts = key.map((_, i) => (typeof rt === 'number' ? rt : rt(i)))
  return { rt_ms: rts, choice: rts.map((v, i) => (v === null ? null : (key[i] as number))) }
}

const score = (mode: RtMode, r: RtResponse, device: RtDevice = DEVICE): RtBlockResult => scoreRtResponse(mode, mode === 'simple' ? SIMPLE_KEY : CHOICE_KEY, r, device)

const ok = (r: RtBlockResult): Extract<RtBlockResult, { status: 'ok' }> => {
  if (r.status !== 'ok') throw new Error(`expected an observation, got ${r.status}`)
  return r
}

describe('classifyTrial (trimming, §7.1)', () => {
  it('simple: valid iff 150 ≤ rt ≤ 1500, both ends inclusive', () => {
    expect(classifyTrial('simple', 150, 0, 0)).toBe('valid')
    expect(classifyTrial('simple', 1500, 0, 0)).toBe('valid')
    expect(classifyTrial('simple', 149.9, 0, 0)).toBe('too_fast')
    expect(classifyTrial('simple', 1500.1, 0, 0)).toBe('too_slow')
    expect(classifyTrial('simple', 0, 0, 0)).toBe('too_fast') // at onset: not before it
  })

  it('choice: valid iff the position is right and 200 ≤ rt ≤ 2000', () => {
    expect(classifyTrial('choice4', 200, 2, 2)).toBe('valid')
    expect(classifyTrial('choice4', 2000, 2, 2)).toBe('valid')
    expect(classifyTrial('choice4', 199.9, 2, 2)).toBe('too_fast')
    expect(classifyTrial('choice4', 2000.1, 2, 2)).toBe('too_slow')
    expect(classifyTrial('choice4', 500, 1, 2)).toBe('error')
    expect(classifyTrial('choice4', 175, 1, 1)).toBe('too_fast') // valid for simple, not for choice
  })

  it('anticipations (response before onset) and misses are flagged first', () => {
    expect(classifyTrial('simple', -0.1, 0, 0)).toBe('anticipation')
    expect(classifyTrial('choice4', -250, 3, 1)).toBe('anticipation') // before the error check
    expect(classifyTrial('choice4', null, null, 1)).toBe('miss')
    expect(classifyTrial('choice4', 150, 0, 1)).toBe('error') // error before too_fast
    expect(classifyTrial('choice4', 2500, 0, 1)).toBe('error') // error before too_slow
  })

  it('simple blocks ignore which key was pressed', () => {
    expect(classifyTrial('simple', 300, 3, 0)).toBe('valid')
  })
})

describe('median and the A10 estimate', () => {
  it('median of odd and even lists (mean of the middle two), unsorted input untouched', () => {
    const xs = [5, 1, 3]
    expect(median(xs)).toBe(3)
    expect(xs).toEqual([5, 1, 3])
    expect(median([4, 1, 3, 2])).toBe(2.5)
    expect(median([7])).toBe(7)
    expect(() => median([])).toThrow(RangeError)
  })

  it('x = median ln rt, MAD about x, SE = 1.2533 · 1.4826 · MAD / √n (worked example)', () => {
    const e = rtEstimate([400, 200, 300])
    expect(e.x).toBe(Math.log(300))
    const devs = [Math.log(400) - Math.log(300), 0, Math.log(300) - Math.log(200)]
    expect(e.mad).toBe(median(devs.map(Math.abs)))
    expect(e.mad).toBeCloseTo(0.28768207245178085, 15)
    expect(e.se).toBeCloseTo((1.2533 * 1.4826 * 0.28768207245178085) / Math.sqrt(3), 15)
    expect(SE_MEDIAN_FACTOR).toBe(1.2533)
    expect(MAD_TO_SD).toBe(1.4826)
  })

  it('an even count averages the two middle log RTs (the log of their geometric mean)', () => {
    const e = rtEstimate([100, 400])
    expect(e.x).toBeCloseTo(Math.log(200), 14)
    expect(e.mad).toBeCloseTo(Math.log(2), 14)
  })

  it('rejects empty or non-positive input', () => {
    expect(() => rtEstimate([])).toThrow(RangeError)
    expect(() => rtEstimate([300, 0])).toThrow(RangeError)
    expect(() => rtEstimate([300, Number.NaN])).toThrow(RangeError)
  })
})

describe('scoreRtResponse → Gaussian observation (A10)', () => {
  it('a constant 300 ms simple block sits exactly on the simple norm: x = β, SE = 0, sigma = τ_res', () => {
    const r = ok(score('simple', uniform('simple', 300)))
    expect(r.observation).toEqual({ kind: 'gaussian', axis: 'RT', lam: -0.15, d: Math.log(300), sigma: 0.05, x: Math.log(300) })
    expect(r.se).toBe(0)
    expect(Object.keys(r.observation).sort()).toEqual(['axis', 'd', 'kind', 'lam', 'sigma', 'x'])
  })

  it('θ̂ = (β − x)/s: a block 0.15 log units faster than the norm is +1 SD (faster = higher)', () => {
    const r = ok(score('choice4', uniform('choice4', 450 * Math.exp(-0.15))))
    const { lam, d, x } = r.observation
    expect((x - d) / lam).toBeCloseTo(1, 12)
    expect(ok(score('choice4', uniform('choice4', 450))).observation.x).toBeCloseTo(RT_WEB_NORMS.choice4.beta, 14)
  })

  it('sigma = √(SE² + τ_res²) with the SE of the valid trials only', () => {
    const rts = (i: number): number => 250 + 10 * i
    const r = ok(score('simple', uniform('simple', rts)))
    const e = rtEstimate(SIMPLE_KEY.map((_, i) => rts(i)))
    expect(r.observation.x).toBe(e.x)
    expect(r.se).toBe(e.se)
    expect(r.observation.sigma).toBeCloseTo(Math.sqrt(e.se ** 2 + 0.05 ** 2), 15)
    expect(r.se).toBeGreaterThan(0)
  })

  it('counts every outcome and scores only the valid trials', () => {
    // Choice block: trials 0–4 miss, 5–7 anticipations, 8–10 errors, 11 too fast, 12 too slow, the rest valid at 500 ms.
    const resp = uniform('choice4', (i) => (i < 5 ? null : i < 8 ? -100 : i === 11 ? 150 : i === 12 ? 2500 : 500))
    for (const i of [8, 9, 10]) resp.choice[i] = ((CHOICE_KEY[i] as number) + 1) % 4
    const r = score('choice4', resp)
    expect(r.meta).toMatchObject({ n_valid: 27, n_misses: 5, n_anticipations: 3, n_errors: 3, n_too_fast: 1, n_too_slow: 1 })
    expect(r.status).toBe('no_observation') // 27 < 30
  })

  it('minimum valid trials: 20 simple and 30 choice give an observation, 19 and 29 do not (reason recorded)', () => {
    const simple = (nValid: number): RtBlockResult => score('simple', uniform('simple', (i) => (i < nValid ? 300 : null)))
    expect(simple(20).status).toBe('ok')
    const s19 = simple(19)
    expect(s19.status).toBe('no_observation')
    if (s19.status === 'no_observation') {
      expect(s19.reason).toBe('too_few_valid_trials')
      expect(s19.detail).toBe('19 valid simple trials < 20 required')
      expect(s19.meta.n_valid).toBe(19)
      expect(s19.meta.min_valid).toBe(20)
    }
    const choice = (nValid: number): RtBlockResult => score('choice4', uniform('choice4', (i) => (i < nValid ? 450 : 90)))
    expect(choice(30).status).toBe('ok')
    const c29 = choice(29)
    expect(c29.status === 'no_observation' && c29.reason).toBe('too_few_valid_trials')
    expect(c29.meta.n_too_fast).toBe(11)
  })

  it('practice trials are excluded from scoring', () => {
    const scored = uniform('choice4', (i) => 380 + i)
    const a = score('choice4', scored)
    const b = score('choice4', { ...scored, practice_rt_ms: [-500, null, 99999], practice_choice: [0, null, 3] })
    const c = score('choice4', { ...scored, practice_rt_ms: [410, 420, 430], practice_choice: [0, 1, 2] })
    expect(b).toEqual(a)
    expect(c).toEqual(a)
  })

  it('stores the device class (and input type, refresh rate) and the norms version beside the observation', () => {
    const r = score('simple', uniform('simple', 300), { device_class: 'phone', input_type: 'touch', refresh_hz_est: 120 })
    expect(r.meta).toMatchObject({ device_class: 'phone', input_type: 'touch', refresh_hz_est: 120, norms_version: RT_NORMS_VERSION, mode: 'simple', n_trials: 30 })
    expect('input_type' in score('simple', uniform('simple', 300)).meta).toBe(false)
    expect(rtNorm('simple', 'phone')).toBe(RT_WEB_NORMS.simple) // device class alone does not pick a norm
  })

  it('the input type picks the norm: touch uses the touch norms, keyboard, mouse and unknown the web norms', () => {
    expect(rtNorm('simple', 'phone', 'touch')).toBe(RT_TOUCH_NORMS.simple)
    expect(rtNorm('choice4', 'phone', 'touch')).toBe(RT_TOUCH_NORMS.choice4)
    for (const t of ['keyboard', 'mouse', undefined]) expect(rtNorm('simple', 'desktop', t)).toBe(RT_WEB_NORMS.simple)
    expect(RT_TOUCH_NORMS.simple.median_rt_ms).toBeGreaterThanOrEqual(450)
    expect(RT_TOUCH_NORMS.simple.median_rt_ms).toBeLessThanOrEqual(500)
    expect(RT_TOUCH_NORMS.simple.s).toBeGreaterThanOrEqual(RT_WEB_NORMS.simple.s)
  })

  it('a typical touch median (470 ms simple) is near 0 SD on touch and no longer an extreme low', () => {
    const theta = (r: Extract<RtBlockResult, { status: 'ok' }>): number => (r.observation.d - r.observation.x) / -r.observation.lam
    const touch = ok(score('simple', uniform('simple', 470), { device_class: 'phone', input_type: 'touch' }))
    expect(touch.observation).toMatchObject({ lam: -0.2, d: Math.log(470) })
    expect(Math.abs(theta(touch))).toBeLessThan(1e-12)
    expect(ok(score('choice4', uniform('choice4', 620), { device_class: 'phone', input_type: 'touch' })).observation.d).toBe(Math.log(620))
    for (const input_type of ['keyboard', 'mouse']) {
      const r = ok(score('simple', uniform('simple', 300), { device_class: 'desktop', input_type }))
      expect(r.observation).toMatchObject({ lam: -0.15, d: Math.log(300) })
    }
    const kb470 = ok(score('simple', uniform('simple', 470), { device_class: 'desktop', input_type: 'keyboard' }))
    expect(theta(kb470)).toBeLessThan(-2.9) // unchanged for keyboard and mouse
  })

  it('rtBlockObservation scores against the item key', () => {
    const item = generateRtBlock('obs', 'choice4')
    const resp = { rt_ms: item.key.positions.map(() => 500), choice: [...item.key.positions] }
    const r = ok(rtBlockObservation(item, resp, DEVICE))
    expect(r.observation.x).toBe(Math.log(500))
    const wrong = { rt_ms: resp.rt_ms, choice: item.key.positions.map((p) => (p + 1) % 4) }
    expect(rtBlockObservation(item, wrong, DEVICE).meta.n_errors).toBe(40)
  })

  it('malformed responses throw a RangeError listing the problems', () => {
    const good = uniform('choice4', 400)
    const bad: [string, unknown][] = [
      ['short', { ...good, rt_ms: good.rt_ms.slice(1) }],
      ['NaN', { ...good, rt_ms: [Number.NaN, ...good.rt_ms.slice(1)] }],
      ['choice 4', { ...good, choice: [4, ...good.choice.slice(1)] }],
      ['choice 1.5', { ...good, choice: [1.5, ...good.choice.slice(1)] }],
      ['unpaired null', { ...good, choice: [null, ...good.choice.slice(1)] }],
      ['practice without choices', { ...good, practice_rt_ms: [300, 300, 300] }],
      ['practice of 2', { ...good, practice_rt_ms: [300, 300], practice_choice: [0, 1] }],
      ['not an object', [1, 2, 3]],
    ]
    for (const [label, r] of bad) {
      expect(rtResponseProblems('choice4', r).length, label).toBeGreaterThan(0)
      expect(() => score('choice4', r as RtResponse), label).toThrow(RangeError)
    }
    expect(rtResponseProblems('simple', { ...uniform('simple', 300), choice: [1, ...Array(29).fill(0)] })).toHaveLength(1)
    expect(() => scoreRtResponse('simple', SIMPLE_KEY.slice(1), uniform('simple', 300), DEVICE)).toThrow(RangeError)
    expect(() => score('simple', uniform('simple', 300), { device_class: '' })).toThrow(RangeError)
  })
})

describe('estimate properties (fast-check)', () => {
  const validRt = fc.double({ min: 200, max: 1500, noNaN: true })
  const block = fc.array(validRt, { minLength: 30, maxLength: 30 })

  it('x lies within the valid log RTs, SE ≥ 0, sigma ≥ τ_res', () => {
    fc.assert(
      fc.property(block, (rts) => {
        const r = ok(score('simple', uniform('simple', (i) => rts[i] as number)))
        const logs = rts.map(Math.log)
        expect(r.observation.x).toBeGreaterThanOrEqual(Math.min(...logs))
        expect(r.observation.x).toBeLessThanOrEqual(Math.max(...logs))
        expect(r.se).toBeGreaterThanOrEqual(0)
        expect(r.observation.sigma).toBeGreaterThanOrEqual(0.05)
      }),
      { numRuns: 300 },
    )
  })

  it('scaling every RT by k shifts x by ln k and keeps the SE; trial order does not matter', () => {
    // RTs in [200, 1200] ms scaled by k ∈ [0.8, 1.2] stay inside the simple window [150, 1500].
    const inner = fc.array(fc.double({ min: 200, max: 1200, noNaN: true }), { minLength: 30, maxLength: 30 })
    fc.assert(
      fc.property(inner, fc.double({ min: 0.8, max: 1.2, noNaN: true }), (rts, k) => {
        const a = ok(score('simple', uniform('simple', (i) => rts[i] as number)))
        const b = ok(score('simple', uniform('simple', (i) => (rts[i] as number) * k)))
        const c = ok(score('simple', uniform('simple', (i) => rts[29 - i] as number)))
        expect(b.observation.x - a.observation.x).toBeCloseTo(Math.log(k), 9)
        expect(b.se).toBeCloseTo(a.se, 9)
        expect(c.observation.x).toBe(a.observation.x)
        expect(c.se).toBe(a.se)
      }),
      { numRuns: 300 },
    )
  })

  it('robust: replacing one trial moves x by at most one order statistic on either side', () => {
    fc.assert(
      fc.property(block, fc.double({ min: 150, max: 1500, noNaN: true }), fc.nat(29), (rts, outlier, j) => {
        const b = ok(score('simple', uniform('simple', (i) => (i === j ? outlier : (rts[i] as number)))))
        const s = rts.map(Math.log).sort((p, q) => p - q) as number[]
        // n = 30: x = (s14 + s15)/2 before; with one value replaced it stays in [(s13 + s14)/2, (s15 + s16)/2].
        expect(b.observation.x).toBeGreaterThanOrEqual(((s[13] as number) + (s[14] as number)) / 2 - 1e-12)
        expect(b.observation.x).toBeLessThanOrEqual(((s[15] as number) + (s[16] as number)) / 2 + 1e-12)
      }),
      { numRuns: 300 },
    )
  })
})
