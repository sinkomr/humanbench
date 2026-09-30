import { describe, expect, it } from 'vitest'
import { AXIS_CODES } from '../engine/axes'
import { assertValidSave } from '../save/validate'
import { buildResults, skippedIn } from './results'
import { DAY_MS, T0_MS, botSave } from './test-support'

describe('buildResults (M1.Q re-score of the save)', () => {
  it('a single session re-scores to what the session itself scored (s = 1, ρ = 0)', () => {
    const { save, result } = botSave('s_RESULTS000000001')
    const r = buildResults(save)!
    expect(r).not.toBeNull()
    expect(r.nSessions).toBe(1)
    expect(r.practiceAdjusted).toBe(false)
    expect(r.skipped).toEqual([])
    expect(r.input.score).toBe(r.rescore)
    const score = result.score!
    r.rescore.theta.forEach((v, i) => expect(v).toBeCloseTo(score.theta[i]!, 6))
    for (const k of Object.keys(score.eap) as (keyof typeof score.eap)[]) expect(r.rescore.eap[k]!.mean).toBeCloseTo(score.eap[k]!.mean, 6)
  })

  it('two sessions are practice-adjusted: later ones are credited for the earlier practice', () => {
    const one = botSave('s_RESULTS000000002')
    const two = botSave('s_RESULTS000000003', { base: one.save, startedMs: T0_MS + 8 * DAY_MS })
    const r = buildResults(two.save)!
    expect(r.nSessions).toBe(2)
    expect(r.practiceAdjusted).toBe(true)
    const second = r.rescore.sessions.find((s) => s.session_id === 's_RESULTS000000003')!
    expect(Object.values(second.ordinals).every((n) => n === 2)).toBe(true)
    expect(Object.values(second.rho).every((v) => v! > 0)).toBe(true)
    // More data on the same skills: no wider than after one session.
    const r1 = buildResults(one.save)!
    const sd = (m: typeof r, k: number): number => Math.sqrt(m.rescore.cov[k]![k]!)
    const k = AXIS_CODES.indexOf('MAT')
    expect(sd(r, k)).toBeLessThan(sd(r1, k) + 1e-9)
  })

  it('a skill skipped from the start is a skipped stub, and nothing of it is scored', () => {
    const { save } = botSave('s_RESULTS000000004', { skipped: ['SPA'] })
    const r = buildResults(save)!
    expect(r.skipped).toEqual(['SPA'])
    expect(Object.hasOwn(r.rescore.eap, 'SPA')).toBe(false)
    expect(r.input.skipped).toEqual(['SPA'])
  })

  it('a skill skipped after some answers keeps its answers in the save but not in the estimate (§13)', () => {
    const { save } = botSave('s_RESULTS000000005', {
      drive: (bot) => {
        bot.until((v) => v.phase === 'item' && v.item?.axis === 'SPA')
        for (let i = 0; i < 6; i++) bot.step() // a few Spatial answers
        bot.run.skipAxis('SPA')
      },
    })
    const answered = save.sessions[0]!.responses.filter((t) => t[0].startsWith('i:rotation:'))
    expect(answered.length).toBeGreaterThan(0) // the answers stay in the save
    expect(skippedIn(save.sessions[0]!, 'SPA')).toBe(true)
    const r = buildResults(save)!
    expect(r.skipped).toContain('SPA')
    expect(Object.hasOwn(r.rescore.eap, 'SPA')).toBe(false)
    expect(r.facetObservations.every((f) => f.obs.axis !== 'SPA')).toBe(true)
    // Its items still count as a test of the skill for the practice model (they were presented).
    expect(r.rescore.sessions[0]!.ordinals.SPA).toBe(1)
  })

  it('a skill measured in one session and skipped in the next still shows, from the session that measured it', () => {
    const one = botSave('s_RESULTS000000006')
    const two = botSave('s_RESULTS000000007', { base: one.save, startedMs: T0_MS + 9 * DAY_MS, skipped: ['SPA'] })
    const r = buildResults(two.save)!
    expect(r.skipped).not.toContain('SPA')
    expect(Object.hasOwn(r.rescore.eap, 'SPA')).toBe(true)
  })

  it('a skill skipped in every session that took it stays skipped', () => {
    const one = botSave('s_RESULTS000000008', { skipped: ['SPA'] })
    const two = botSave('s_RESULTS000000009', { base: one.save, startedMs: T0_MS + 9 * DAY_MS, skipped: ['SPA'] })
    expect(buildResults(two.save)!.skipped).toEqual(['SPA'])
  })

  it('is null for a save with nothing scored (finished at once)', () => {
    const { save } = botSave('s_RESULTS000000010', { drive: (bot) => bot.run.finishEarly() })
    expect(buildResults(save)).toBeNull()
  })

  it('facet observations carry the item facet and count blocks once', () => {
    const { save } = botSave('s_RESULTS000000011')
    const r = buildResults(save)!
    const facets = new Set(r.facetObservations.map((f) => f.facet))
    expect(facets.has('3d_rotation')).toBe(true)
    expect(facets.has('digits_forward')).toBe(true)
    for (const f of r.facetObservations) if (f.block) expect(['digits_forward', 'digits_backward', 'corsi', 'simple_rt', 'choice_rt', 'coding', 'reading_speed']).toContain(f.facet)
    // Every scored response is one facet observation (the CAL observation has no facet).
    expect(r.facetObservations.length).toBe(r.rescore.n_scored - (r.rescore.eap.CAL === undefined ? 0 : 1))
  })

  it('is deterministic and does not change the save', () => {
    const { save } = botSave('s_RESULTS000000012')
    const before = JSON.stringify(save)
    const a = buildResults(save)!
    const b = buildResults(save)!
    expect(JSON.stringify(a.rescore.theta)).toBe(JSON.stringify(b.rescore.theta))
    expect(JSON.stringify(save)).toBe(before)
    assertValidSave(save)
  })

  it('never carries a total, a mean or an area across skills', () => {
    const r = buildResults(botSave('s_RESULTS000000013').save)!
    expect(Object.keys(r).sort()).toEqual(['facetObservations', 'input', 'nSessions', 'practiceAdjusted', 'rescore', 'skipped'])
  })
})
