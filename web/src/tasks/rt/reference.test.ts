/**
 * RT scores compare like with like (owner decision 2026-10-11, UX-REVIEW D3): a touch block is
 * scored against the touch reference, a keyboard or mouse block against the keyboard/mouse one, in
 * every scoring path. The paths are `scoreRtResponse` / `rtBlockObservation` (what the session
 * calls), the family's `score(item, response, context)` (what a re-score from a save calls), and
 * the reveal's median-against-reference line (`reveal/norms.test.ts`).
 */

import fc from 'fast-check'
import { describe, expect, it } from 'vitest'
import {
  RT_FAMILIES,
  RT_TOUCH_NORMS,
  RT_WEB_NORMS,
  generateRtBlock,
  rtBlockObservation,
  rtNorm,
  rtNormsOf,
  rtReferenceOf,
  scoreRtResponse,
  type RtDevice,
  type RtMode,
  type RtResponse,
} from '.'
import type { Observation } from '../../engine/types'

type Gaussian = Extract<Observation, { kind: 'gaussian' }>

/** θ̂ of a Gaussian RT observation: x = lam·θ + d, so θ = (x − d) / lam. */
const thetaOf = (o: Gaussian): number => (o.x - o.d) / o.lam

/**
 * A block whose median log-RT is exactly ln(`median`): scored trials spread symmetrically about it
 * (half faster, half slower), at the right positions.
 */
function aroundMedian(positions: readonly number[], median: number): RtResponse {
  const n = positions.length
  const rt_ms = positions.map((_, i) => {
    const k = i < n / 2 ? -(n / 2 - i) : i - n / 2 + 1 // -n/2 … -1, then 1 … n/2
    return median * Math.exp(0.012 * k)
  })
  return { rt_ms, choice: [...positions] }
}

const INPUTS = ['keyboard', 'mouse', 'touch', undefined] as const
const MODES: readonly RtMode[] = ['simple', 'choice4']

describe('the reference of an input type', () => {
  it('touch has its own reference; keyboard, mouse, unknown and unrecorded share one', () => {
    expect(rtReferenceOf('touch')).toBe('touch')
    for (const t of ['keyboard', 'mouse', 'pen', '', undefined]) expect(rtReferenceOf(t)).toBe('keyboard_mouse')
    expect(rtNormsOf('touch')).toBe(RT_TOUCH_NORMS)
    expect(rtNormsOf('keyboard_mouse')).toBe(RT_WEB_NORMS)
  })

  it('the norm and the reference group are one rule: rtNorm is the table of rtReferenceOf', () => {
    for (const mode of MODES) for (const t of INPUTS) expect(rtNorm(mode, 'desktop', t)).toBe(rtNormsOf(rtReferenceOf(t))[mode])
  })
})

describe.each(MODES)('%s block: every scoring path norms by the input type', (mode) => {
  const family = RT_FAMILIES[mode]
  const item = generateRtBlock(`like-${mode}`, mode)

  it.each(INPUTS)('input %s: a block at its own reference median lands at 0 SD, whichever path scores it', (input) => {
    const reference = rtNormsOf(rtReferenceOf(input))[mode].median_rt_ms
    const response = aroundMedian(item.key.positions, reference)
    const device: RtDevice = { device_class: 'desktop', ...(input === undefined ? {} : { input_type: input }) }
    // The session's path (`rtBlockObservation` with its RtDevice) ...
    const session = rtBlockObservation(item, response, device)
    expect(session.status).toBe('ok')
    if (session.status !== 'ok') return
    expect(Math.abs(thetaOf(session.observation))).toBeLessThan(1e-9)
    // ... and the family's `score()` with the context a re-score reads from the save (`extra`).
    const viaFamily = family.score(item, response, { device_class: 'desktop', ...(input === undefined ? {} : { input_type: input }) })
    expect(viaFamily.observation).toEqual(session.observation)
  })

  it('without a context (an older save) the family scores as keyboard/mouse, exactly like an explicit keyboard', () => {
    const response = aroundMedian(item.key.positions, RT_WEB_NORMS[mode].median_rt_ms)
    const bare = family.score(item, response)
    const kb = family.score(item, response, { input_type: 'keyboard' })
    expect(bare.observation).toEqual(kb.observation)
    expect(bare.observation).toEqual(family.score(item, response, {}).observation)
    expect(thetaOf(bare.observation as Gaussian)).toBeCloseTo(0, 9)
  })

  it('the same touch block is a low score against the keyboard reference and 0 SD against the touch one (the mismatch this prevents)', () => {
    const response = aroundMedian(item.key.positions, RT_TOUCH_NORMS[mode].median_rt_ms)
    const asTouch = family.score(item, response, { input_type: 'touch' }).observation as Gaussian
    const asKeyboard = family.score(item, response, { input_type: 'keyboard' }).observation as Gaussian
    expect(Math.abs(thetaOf(asTouch))).toBeLessThan(1e-9)
    expect(thetaOf(asKeyboard)).toBeLessThan(-1.5)
    expect(asTouch.lam).toBe(-RT_TOUCH_NORMS[mode].s)
    expect(asTouch.d).toBe(RT_TOUCH_NORMS[mode].beta)
    expect(asKeyboard.lam).toBe(-RT_WEB_NORMS[mode].s)
    expect(asKeyboard.d).toBe(RT_WEB_NORMS[mode].beta)
  })

  it('a device class alone changes nothing; the context carries only what the session recorded', () => {
    const response = aroundMedian(item.key.positions, 350)
    const a = family.score(item, response, { device_class: 'phone' }).observation
    const b = family.score(item, response, { device_class: 'desktop' }).observation
    const c = family.score(item, response).observation
    expect(a).toEqual(c)
    expect(b).toEqual(c)
  })
})

describe('score paths agree (property)', () => {
  const input = fc.constantFrom(...INPUTS)
  const median = fc.double({ min: 180, max: 1100, noNaN: true })
  it('family.score(item, response, { input_type }) = scoreRtResponse(..., { input_type }) for any median, mode and input type', () => {
    fc.assert(
      fc.property(fc.constantFrom(...MODES), median, input, (mode, ms, t) => {
        const item = generateRtBlock(`prop-${mode}`, mode)
        const response = aroundMedian(item.key.positions, ms)
        const device: RtDevice = { device_class: 'unspecified', ...(t === undefined ? {} : { input_type: t }) }
        const direct = scoreRtResponse(mode, item.key.positions, response, device)
        const viaFamily = RT_FAMILIES[mode].score(item, response, t === undefined ? undefined : { input_type: t })
        if (direct.status === 'ok') expect(viaFamily.observation).toEqual(direct.observation)
        else expect(viaFamily.reasons).toEqual([direct.reason])
      }),
    )
  })

  it('at its own reference a touch median and a keyboard median are both 0 SD, wherever the references differ', () => {
    fc.assert(
      fc.property(fc.constantFrom(...MODES), fc.constantFrom('touch', 'keyboard', 'mouse'), (mode, t) => {
        const item = generateRtBlock(`prop-ref-${mode}`, mode)
        const ref = rtNormsOf(rtReferenceOf(t))[mode].median_rt_ms
        const o = RT_FAMILIES[mode].score(item, aroundMedian(item.key.positions, ref), { input_type: t }).observation as Gaussian
        expect(Math.abs(thetaOf(o))).toBeLessThan(1e-9)
      }),
    )
  })
})
