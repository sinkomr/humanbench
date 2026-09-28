import { describe, expect, it } from 'vitest'
import { infoGaussian } from '../../engine'
import { SIGMA_B_DEFAULT, linearB, stratumOfB } from '../priors'
import {
  CODING_BETA,
  CODING_NORM_CORRECT,
  CODING_NORM_CPM,
  CODING_PRIOR,
  CODING_PROVENANCE,
  CODING_RATE_SCALE,
  CODING_TAU_RES,
  codingDifficulty,
  codingExpectedTime,
  codingFeatures,
  codingParams,
  codingSigma,
  codingStratum,
} from '.'

describe('coding prior and norms (M1.P, A10; all [SPEC] provisional)', () => {
  it('uses the provisional norms β = ln 40, s = 0.25, τ_res = 0.05', () => {
    expect(CODING_NORM_CPM).toBe(40)
    expect(CODING_BETA).toBe(Math.log(40))
    expect(CODING_RATE_SCALE).toBe(0.25)
    expect(CODING_TAU_RES).toBe(0.05)
    expect(CODING_NORM_CORRECT).toBe(60)
  })

  it('v0 regression: b = 0 + 0.064·(n_symbols − 9), so the 9-glyph block has b = 0, stratum 3', () => {
    expect(CODING_PRIOR).toEqual({ anchorB: 0, terms: { n_symbols: { beta: 0.064, centre: 9 } } })
    expect(codingFeatures()).toEqual({ n_symbols: 9, sequence_length: 200, duration_s: 90 })
    expect(codingDifficulty()).toEqual({ features: codingFeatures(), b_prior: 0, sd_prior: SIGMA_B_DEFAULT, provenance: CODING_PROVENANCE })
    expect(linearB(CODING_PRIOR, { n_symbols: 12 })).toBeCloseTo(0.192, 12)
    expect(codingStratum()).toBe(3)
    expect(stratumOfB(0)).toBe(3)
    expect(CODING_PROVENANCE).toMatch(/^\[SPEC\] v0, provisional/)
  })

  it('Gaussian params: lam = s, d = β − s·b, sigma = τ_res (the one meaning of params.sigma, M1.F2)', () => {
    expect(codingParams(0)).toEqual({ model: 'gaussian', lam: 0.25, d: Math.log(40), sigma: CODING_TAU_RES })
    expect(CODING_TAU_RES).toBe(0.05)
    const p = codingParams(1)
    expect(p.model === 'gaussian' && p.d).toBeCloseTo(Math.log(40) - 0.25, 14)
    expect(codingSigma(60)).toBeCloseTo(0.138444, 6)
    // Block reliability in the norm population: s² / (s² + σ²) ≈ .77.
    expect(0.25 ** 2 / (0.25 ** 2 + codingSigma(60) ** 2)).toBeCloseTo(0.765, 3)
    // Information about θ_PS of one norm block (lam²/σ²) for the selector (§7.4).
    expect(infoGaussian(0.25, codingSigma(60))).toBeCloseTo(3.26, 2)
  })

  it('σ(correct) = √(1/correct + τ²), decreasing to the τ floor, and needs correct ≥ 1', () => {
    expect(codingSigma(1)).toBe(Math.sqrt(1 + 0.0025))
    expect(codingSigma(100)).toBeLessThan(codingSigma(99))
    expect(codingSigma(1_000_000)).toBeGreaterThan(0.05)
    for (const bad of [0, -1, 1.5, Number.NaN]) expect(() => codingSigma(bad)).toThrow(RangeError)
  })

  it('E[T] of the block is its 90 s window', () => {
    expect(codingExpectedTime()).toBe(90)
  })
})
