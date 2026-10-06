import { describe, expect, it } from 'vitest'
import { AUT_PARAMS_V0, PROMPT_NORMS_V0, checkAutParams, promptNorm, type AutParams } from './params'

describe('AUT_PARAMS_V0 (M6.4; DESIGN §5.4)', () => {
  it('has the spec values', () => {
    expect(AUT_PARAMS_V0.version).toBe('aut-v0')
    expect(AUT_PARAMS_V0.topK).toBe(3)
    expect(AUT_PARAMS_V0.maxWords).toBe(12)
  })

  it('passes its own check, and its cosines are ordered sensibly', () => {
    expect(() => checkAutParams(AUT_PARAMS_V0)).not.toThrow()
    // the floor is far below the cluster join, which is below the duplicate cut
    expect(AUT_PARAMS_V0.plausibilityFloor).toBeLessThan(AUT_PARAMS_V0.clusterCosine)
    expect(AUT_PARAMS_V0.clusterCosine).toBeLessThan(AUT_PARAMS_V0.duplicateCosine)
    expect(AUT_PARAMS_V0.plausibilityFloor).toBeLessThanOrEqual(0.1)
  })

  it('is frozen', () => {
    expect(Object.isFrozen(AUT_PARAMS_V0)).toBe(true)
    expect(Object.isFrozen(PROMPT_NORMS_V0)).toBe(true)
  })

  it.each<[string, Partial<AutParams>]>([
    ['version', { version: '' }],
    ['topK', { topK: 0 }],
    ['topK', { topK: 2.5 }],
    ['maxWords', { maxWords: -1 }],
    ['duplicateCosine', { duplicateCosine: 1.5 }],
    ['plausibilityFloor', { plausibilityFloor: Number.NaN }],
    ['clusterCosine', { clusterCosine: Number.NEGATIVE_INFINITY }],
  ])('checkAutParams rejects a bad %s', (name, patch) => {
    expect(() => checkAutParams({ ...AUT_PARAMS_V0, ...patch })).toThrow(new RegExp(name))
  })
})

describe('PROMPT_NORMS_V0 (§14.6 example 17)', () => {
  it('covers the two demo objects only, with positive SDs', () => {
    expect(Object.keys(PROMPT_NORMS_V0).sort()).toEqual(['brick', 'paperclip'])
    for (const n of Object.values(PROMPT_NORMS_V0)) {
      expect(n.sd).toBeGreaterThan(0)
      expect(n.mean).toBeGreaterThan(0)
      expect(n.mean).toBeLessThan(2)
    }
  })

  it('promptNorm looks up the trimmed, lower-cased object', () => {
    expect(promptNorm('brick')).toBe(PROMPT_NORMS_V0.brick)
    expect(promptNorm('  Brick ')).toBe(PROMPT_NORMS_V0.brick)
    expect(promptNorm('PAPERCLIP')).toBe(PROMPT_NORMS_V0.paperclip)
    expect(promptNorm('paper clip')).toBeNull()
    expect(promptNorm('shoe')).toBeNull()
    // inherited keys are not norms
    expect(promptNorm('constructor')).toBeNull()
    expect(promptNorm('__proto__')).toBeNull()
  })

  it('promptNorm accepts another table', () => {
    expect(promptNorm('Shoe', { shoe: { mean: 1, sd: 0.1 } })).toEqual({ mean: 1, sd: 0.1 })
  })
})
