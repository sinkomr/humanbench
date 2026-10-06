import { describe, expect, it } from 'vitest'
import { A15_TARGET_S } from '../src/engine/selector'
import { UsageError } from './dump-lib'
import { parseSimSessionArgs, simulate, simulateOne } from './sim-session'

describe('scripts/sim-session.ts: whole sessions of the real session machine (UX-066)', () => {
  it('parses its flags, with defaults, and refuses what it does not know', () => {
    expect(parseSimSessionArgs([], '/w')).toEqual({ n: 200, offset: 0, skip: null, interstitialS: 0, targetS: A15_TARGET_S })
    expect(parseSimSessionArgs(['--', '--n', '5', '--skip', 'SPA', '--interstitial-s', '20', '--target-min', '20', '--json', 'out.json'], '/w')).toEqual({
      n: 5,
      offset: 0,
      skip: 'SPA',
      interstitialS: 20,
      targetS: 1200,
      json: '/w/out.json',
    })
    expect(() => parseSimSessionArgs(['--skip', 'XYZ'], '/w')).toThrow(UsageError)
    expect(() => parseSimSessionArgs(['--n', '0'], '/w')).toThrow(UsageError)
    expect(() => parseSimSessionArgs(['--n'], '/w')).toThrow(UsageError)
    expect(() => parseSimSessionArgs(['--what', '1'], '/w')).toThrow(UsageError)
  })

  it('time on the "Up next" screens is not session time, the break comes once before Working Memory, and a skip shortens the session', () => {
    const base = { n: 1, offset: 0, skip: null, interstitialS: 0, targetS: A15_TARGET_S } as const
    const quick = simulateOne(3, base)
    const slow = simulateOne(3, { ...base, interstitialS: 120 })
    expect(slow.durationS).toBeCloseTo(quick.durationS, 6)
    expect(quick.breakOffers).toBe(1)
    expect(quick.breakBefore).toBe('memory')
    expect(quick.qrItems).toBeGreaterThanOrEqual(3)
    const skipped = simulateOne(3, { ...base, skip: 'SPA' })
    expect(skipped.partS.spatial).toBeUndefined()
    expect(skipped.durationS).toBeLessThan(quick.durationS)
  })

  it('summarises a run: lengths, part means, floor misses and where the break came', () => {
    const r = simulate({ n: 2, offset: 0, skip: 'MAT', interstitialS: 0, targetS: A15_TARGET_S })
    expect(r.n).toBe(2)
    expect(r.ended).toEqual({ complete: 2 })
    expect(r.qrFloorMisses).toBe(0)
    expect(r.breakOffersMax).toBe(1)
    expect(r.meanPartMin.matrix_series).toBeUndefined()
    expect(r.meanPartMin.quant).toBeGreaterThan(0)
  })
})
