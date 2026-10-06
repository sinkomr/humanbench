import { describe, expect, it } from 'vitest'
import { AXIS_CODES } from '../engine/axes'
import { saveWithSession } from '../save/create'
import { assertValidSave } from '../save/validate'
import { Bot } from '../session/bot'
import { SAVE_CTX } from '../session/constants'
import { axisEstimates } from '../viz/profile'
import { buildResults, OFFERED_AXES, scoredSessions, skippedIn } from './results'
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

describe('the skills this build offers (§9.7, UX-048b)', () => {
  it('are the axes of the session plan and Calibration, which every rated answer measures', () => {
    expect([...OFFERED_AXES].sort()).toEqual(['CAL', 'MAT', 'PS', 'QR', 'RT', 'SPA', 'WM'])
  })

  it('a skill no part measures is "not offered yet"; a skipped one stays skipped; an offered one with no answers has no data', () => {
    const { save } = botSave('s_RESULTS000000030', {
      skipped: ['SPA'],
      drive: (bot) => {
        bot.until((v) => v.phase === 'block')
        bot.step()
        bot.run.finishEarly()
      },
    })
    const r = buildResults(save)!
    expect(r.input.offered).toBe(OFFERED_AXES)
    const reason = (code: string): string | undefined => axisEstimates(r.input).find((e) => e.code === code)?.reason
    for (const code of ['LR', 'LG', 'RC', 'VOC', 'FER', 'KST', 'KHU', 'KAP', 'EMO', 'CRE']) expect(reason(code), code).toBe('not_yet_available')
    expect(reason('SPA')).toBe('skipped')
    for (const code of ['MAT', 'WM', 'QR', 'PS']) expect(reason(code), code).toBe('no_data')
  })
})

describe('scoredSessions (the count a share card states, M1.18)', () => {
  it('counts the sessions that contributed a scored answer, not every session in the save', () => {
    const one = botSave('s_RESULTS000000090')
    expect(scoredSessions(buildResults(one.save)!)).toBe(1)
    const two = botSave('s_RESULTS000000091', { base: one.save, startedMs: T0_MS + 8 * DAY_MS })
    expect(scoredSessions(buildResults(two.save)!)).toBe(2)
    // A session finished at once is in the save but is not one the profile rests on.
    const empty = botSave('s_RESULTS000000092', { base: two.save, startedMs: T0_MS + 16 * DAY_MS, drive: (b) => b.run.finishEarly() })
    const r = buildResults(empty.save)!
    expect(r.nSessions).toBe(3)
    expect(scoredSessions(r)).toBe(2)
  })
})

describe('scoredSessions counts an interrupted session and its continuation once (UX-064)', () => {
  it('the two are one sitting: "Based on 1 session", and nothing is practice-adjusted between them', () => {
    const first = new Bot({ sessionId: 's_RESULTS000000095', startedMs: T0_MS })
    first.until((v) => v.phase === 'interstitial' && v.segment?.id === 'spatial')
    const base = saveWithSession(null, first.run.sessionState(), { ctx: SAVE_CTX, createdMs: T0_MS + 60_000, anonId: 'hb_' + 'a'.repeat(17) })
    const cont = botSave('s_RESULTS000000096', { base, startedMs: T0_MS + 600_000, cfg: { continues: { done: ['rt', 'matrix_series'], skipped: [] } } })
    const r = buildResults(cont.save)!
    expect(r.nSessions).toBe(2)
    expect(r.rescore.sessions[1]!.continuation).toBe(true)
    expect(scoredSessions(r)).toBe(1)
    expect(r.practiceAdjusted).toBe(false)
    // A separate session a week later is a second sitting, practice-adjusted against the first.
    const later = botSave('s_RESULTS000000097', { base: cont.save, startedMs: T0_MS + 8 * DAY_MS })
    const r2 = buildResults(later.save)!
    expect(scoredSessions(r2)).toBe(2)
    expect(r2.practiceAdjusted).toBe(true)
  })

  it('counts a sitting once when any of its sessions scored, with the device halves paired by sitting', () => {
    const rescore = (sessions: { session_id: string; n_observations: number; continuation?: true }[]) => ({ rescore: { sessions } }) as unknown as Parameters<typeof scoredSessions>[0]
    expect(scoredSessions(rescore([{ session_id: 's_a', n_observations: 0 }, { session_id: 's_b', n_observations: 4, continuation: true }]))).toBe(1)
    expect(scoredSessions(rescore([{ session_id: 's_a', n_observations: 3 }, { session_id: 's_b', n_observations: 4, continuation: true }, { session_id: 's_c', n_observations: 2 }]))).toBe(2)
    expect(scoredSessions({ ...rescore([{ session_id: 's_a', n_observations: 3 }, { session_id: 's_b', n_observations: 4, continuation: true }]), devicePartSessions: 1, servedSessions: 1 })).toBe(1)
  })
})
