import fc from 'fast-check'
import { describe, expect, it } from 'vitest'
import { createRng, type Rng } from '../../engine'
import {
  FOREPERIOD_MAX_MS,
  FOREPERIOD_MIN_MS,
  MAX_POSITION_RUN,
  drawBalancedPositions,
  drawForeperiods,
  drawSchedule,
  generateRtBlock,
  maxRunLength,
  modeOfSeed,
  rt,
  rtBlockSeed,
  rtExpectedTimeS,
} from '.'
import { rtFeatures } from './prior'

describe('maxRunLength', () => {
  it('finds the longest run of equal neighbours', () => {
    expect(maxRunLength([])).toBe(0)
    expect(maxRunLength([2])).toBe(1)
    expect(maxRunLength([0, 1, 2, 3])).toBe(1)
    expect(maxRunLength([1, 1, 2, 2, 2, 3])).toBe(3)
    expect(maxRunLength([0, 0, 0, 0])).toBe(4)
    expect(maxRunLength([3, 1, 1, 1, 1, 1])).toBe(5)
  })
})

describe('mode tags in seeds', () => {
  it('reads a trailing #simple / #choice4, also before an @s<k> suffix', () => {
    expect(modeOfSeed('a#simple')).toBe('simple')
    expect(modeOfSeed('a#choice4')).toBe('choice4')
    expect(modeOfSeed('a#choice4@s3')).toBe('choice4')
    expect(modeOfSeed('a#simple#choice4')).toBe('choice4')
    expect(modeOfSeed('a')).toBeUndefined()
    expect(modeOfSeed('a#simplex')).toBeUndefined()
    expect(modeOfSeed('a#simple@s3x')).toBeUndefined()
    expect(modeOfSeed('#choice2')).toBeUndefined()
  })

  it('rtBlockSeed tags a seed and refuses bad input', () => {
    expect(rtBlockSeed('s', 'simple')).toBe('s#simple')
    expect(() => rtBlockSeed('', 'simple')).toThrow(RangeError)
    expect(() => rtBlockSeed('s', 'choice2' as never)).toThrow(RangeError)
  })
})

describe('foreperiods', () => {
  it('are integers in [800, 2000] with both ends reachable and a uniform mean', () => {
    const rng = createRng('fp')
    const xs = drawForeperiods(rng, 50_000)
    expect(xs.every((x) => Number.isInteger(x) && x >= FOREPERIOD_MIN_MS && x <= FOREPERIOD_MAX_MS)).toBe(true)
    expect(Math.min(...xs)).toBe(800)
    expect(Math.max(...xs)).toBe(2000)
    const mean = xs.reduce((a, b) => a + b, 0) / xs.length
    expect(Math.abs(mean - 1400)).toBeLessThan(5) // SD of the mean ≈ 346/√50000 ≈ 1.5
    // Deciles of the range each hold about 10%.
    const bins = Array<number>(10).fill(0)
    for (const x of xs) bins[Math.min(9, Math.floor((x - 800) / 120.1))]!++
    for (const b of bins) expect(Math.abs(b / xs.length - 0.1)).toBeLessThan(0.01)
  })
})

describe('balanced positions', () => {
  it('each position exactly 10 times, runs ≤ 3, for any seed', () => {
    fc.assert(
      fc.property(fc.string(), (seed) => {
        const seq = drawBalancedPositions(createRng(seed), 4, 10, MAX_POSITION_RUN)
        expect(seq).toHaveLength(40)
        for (let p = 0; p < 4; p++) expect(seq.filter((x) => x === p)).toHaveLength(10)
        expect(maxRunLength(seq)).toBeLessThanOrEqual(3)
      }),
      { numRuns: 500 },
    )
  })

  it('reaches runs of exactly 3 (the bound is not stricter than asked) and every position first', () => {
    let hit3 = false
    const firsts = new Set<number>()
    for (let i = 0; i < 300; i++) {
      const seq = drawBalancedPositions(createRng(`r3-${i}`), 4, 10, 3)
      if (maxRunLength(seq) === 3) hit3 = true
      firsts.add(seq[0]!)
    }
    expect(hit3).toBe(true)
    expect(firsts.size).toBe(4)
  })

  it('counts runs across a prefix (the practice positions shown first)', () => {
    for (let i = 0; i < 300; i++) {
      const prefix = [3, 1, i % 4]
      const seq = drawBalancedPositions(createRng(`pre-${i}`), 4, 10, 3, prefix)
      expect(maxRunLength([...prefix, ...seq])).toBeLessThanOrEqual(3)
    }
  })

  it('gives up (rather than looping forever) when the constraint is unsatisfiable', () => {
    expect(() => drawBalancedPositions(createRng('x'), 1, 5, 3)).toThrow(/no sequence/)
  })
})

describe('drawSchedule', () => {
  const rng = (): Rng => createRng('schedule')

  it('simple: 3 + 30 trials, one location', () => {
    const s = drawSchedule(rng(), 'simple')
    expect(s.mode).toBe('simple')
    expect(s.n_positions).toBe(1)
    expect(s.practice_positions).toEqual([0, 0, 0])
    expect(s.positions).toEqual(Array(30).fill(0))
    expect(s.practice_foreperiods_ms).toHaveLength(3)
    expect(s.foreperiods_ms).toHaveLength(30)
  })

  it('choice: 3 practice trials at distinct positions + 40 balanced scored trials', () => {
    for (let i = 0; i < 200; i++) {
      const s = drawSchedule(createRng(`c-${i}`), 'choice4')
      expect(s.n_positions).toBe(4)
      expect(new Set(s.practice_positions).size).toBe(3)
      expect(s.positions).toHaveLength(40)
      expect(maxRunLength(s.positions)).toBeLessThanOrEqual(3)
    }
  })

  it('choice: no run of 4 across the practice → scored boundary either', () => {
    // Drawn independently, about 1% of blocks would show the last practice position 4 times running.
    let boundaryRun3 = 0
    for (let i = 0; i < 5_000; i++) {
      const s = generateRtBlock(`p-${i}`, 'choice4').spec
      const shown = [...s.practice_positions, ...s.positions]
      expect(maxRunLength(shown)).toBeLessThanOrEqual(3)
      if (s.positions[0] === s.practice_positions[2] && s.positions[1] === s.positions[0]) boundaryRun3++
    }
    expect(boundaryRun3).toBeGreaterThan(0) // runs of 3 across the boundary still occur
  })

  it('is deterministic in the stream', () => {
    expect(drawSchedule(rng(), 'choice4')).toEqual(drawSchedule(rng(), 'choice4'))
  })
})

describe('reference responses', () => {
  it('are whole tenths of a ms (integer draws, the same on every engine), with every lapse kind', () => {
    const kinds = new Set<string>()
    for (let i = 0; i < 200; i++) {
      const ref = rt.generate(`tenths-${i}`).key.reference
      for (const v of [...ref.practice_rt_ms, ...ref.rt_ms]) {
        if (v === null) {
          kinds.add('miss')
          continue
        }
        expect(Math.round(v * 10) / 10).toBe(v)
        kinds.add(v < 0 ? 'anticipation' : v === 0 ? 'zero' : 'rt')
      }
    }
    expect([...kinds].sort()).toEqual(['anticipation', 'miss', 'rt', 'zero'])
  })
})

describe('priors and expected time (M1.P, [SPEC] v0)', () => {
  it('b = 0 for both modes (stratum 3), σ_b = 1, provenance says [SPEC] v0', () => {
    for (const mode of ['simple', 'choice4'] as const) {
      const item = rt.generate(rtBlockSeed('prior', mode))
      expect(item.difficulty.b_prior).toBe(0)
      expect(item.difficulty.sd_prior).toBe(1)
      expect(item.difficulty.provenance).toMatch(/^\[SPEC\] v0/)
      expect(item.stratum).toBe(3)
      expect(item.difficulty.features).toEqual(rtFeatures(item.spec))
    }
  })

  it('E[T] = 15 s + Σ (foreperiod + median RT + 500 ms ITI) over all 33 / 43 trials', () => {
    const s = drawSchedule(createRng('time'), 'simple')
    const fp = [...s.practice_foreperiods_ms, ...s.foreperiods_ms].reduce((a, b) => a + b, 0)
    expect(rtExpectedTimeS(s)).toBeCloseTo(15 + (fp + 33 * (300 + 500)) / 1000, 12)
    const c = drawSchedule(createRng('time'), 'choice4')
    const fc4 = [...c.practice_foreperiods_ms, ...c.foreperiods_ms].reduce((a, b) => a + b, 0)
    expect(rtExpectedTimeS(c)).toBeCloseTo(15 + (fc4 + 43 * (450 + 500)) / 1000, 12)
    // Typical blocks: about 88 s simple, 116 s choice.
    expect(15 + (33 * 1400 + 33 * 800) / 1000).toBeCloseTo(87.6, 9)
  })
})
