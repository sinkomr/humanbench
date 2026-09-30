import { describe, expect, it } from 'vitest'
import { CAL_NORMS, brierScore, brierStandardError, calibrationParams } from './priors'
import { calibrationObservation, calibrationSummary, type RatedAnswer } from './calibration'

describe('calibration of rated answers (DESIGN §7.1, §14.6 ex. 9)', () => {
  it('summarises the rated answers: Brier, mean confidence, accuracy and calibration in the large', () => {
    expect(calibrationSummary([])).toBeNull()
    const s = calibrationSummary([
      { pct: 90, correct: 0 },
      { pct: 60, correct: 1 },
    ])!
    expect(s.n).toBe(2)
    expect(s.brier).toBeCloseTo((0.81 + 0.16) / 2, 12)
    expect(s.mean_confidence).toBeCloseTo(0.75, 12)
    expect(s.accuracy).toBe(0.5)
    expect(s.in_the_large).toBeCloseTo(0.25, 12)
  })

  it('is a Gaussian observation on CAL, x = −Brier, only from min_responses rated answers', () => {
    const answers = (n: number): RatedAnswer[] => Array.from({ length: n }, (_, i) => ({ pct: 60 + (i % 5) * 10, correct: (i % 3 === 0 ? 0 : 1) as 0 | 1 }))
    expect(calibrationObservation(answers(CAL_NORMS.min_responses - 1))).toBeNull()
    const a = answers(CAL_NORMS.min_responses + 5)
    const o = calibrationObservation(a)!
    const c = a.map((x) => x.pct / 100)
    const y = a.map((x) => x.correct)
    const p = calibrationParams()
    expect(o.kind).toBe('gaussian')
    expect(o.axis).toBe('CAL')
    expect(o.x).toBeCloseTo(-brierScore(c, y), 12)
    expect(o.lam).toBe(p.lam)
    expect(o.d).toBe(p.d)
    expect(o.sigma).toBeCloseTo(Math.sqrt(brierStandardError(c, y) ** 2 + p.sigma ** 2), 12)
  })
})
