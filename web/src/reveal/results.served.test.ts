/**
 * The results of a save whose counted questions the server scored (ROADMAP M2.7; DESIGN §10; R-11.1):
 * the page does not score them, not even from the generator's own key, and shows what the server
 * returned for the axes it publishes. The rest of the save (the timed tasks, sessions made without the
 * server) is scored here as before.
 */

import { describe, expect, it } from 'vitest'
import type { RescoreReply } from '../backend/replies'
import { AXIS_CODES, AXIS_INDEX, N_AXES } from '../engine/axes'
import type { SaveFileV1 } from '../save/types'
import { axisEstimates } from '../viz/profile'
import { buildResults, overlayServed, scoredSessions, type ServedScores } from './results'
import { botSave } from './test-support'

const reply = (over: Partial<RescoreReply> = {}): RescoreReply => ({
  paramVersion: 'p',
  eap: { MAT: { mean: 0.6, sd: 0.4, n: 8 }, QR: { mean: -0.3, sd: 0.55, n: 7 } },
  facets: { MAT: { series: { mean: 0.7, sd: 0.5, n: 5 } } },
  sessions: [],
  ...over,
})

const SERVED_FAMILIES = ['rotation', 'matrices', 'series', 'quant']

/**
 * A bot session as a server would hold it: only the counted questions of the served parts, with no
 * verdict in the tuples (`correct` is null, R-11.1) and the server's signature on the session.
 */
function servedLike(id: string, opts: Parameters<typeof botSave>[1] = {}): SaveFileV1 {
  const b = botSave(id, opts)
  const sessions = b.save.sessions.map((s) => ({
    ...s,
    responses: s.responses.filter((t) => SERVED_FAMILIES.includes(t[0].split(':')[1] ?? '')).map((t) => [t[0], t[1], t[2], null, t[4], t[5]] as typeof t),
    sig: { alg: 'HMAC-SHA256' as const, kid: 'k2026a', mac: 'bWFj', anon_id: b.save.anon_id },
  }))
  return { ...b.save, sessions }
}

const served = servedLike('s_SERVEDRES00001')
const ids = (s: SaveFileV1): string[] => s.sessions.map((x) => x.session_id)
const servedScores = (estimates: RescoreReply | null, extra: string[] = []): ServedScores => ({ sessionIds: new Set([...ids(served), ...extra]), estimates })

describe('overlayServed', () => {
  const local = buildResults(botSave('s_SERVEDRES00009').save)!.rescore // a session scored on the page

  it('puts the server’s mean and sd in place of the axes it publishes, uncorrelated with the others, and leaves the rest', () => {
    const o = overlayServed(local, reply())
    for (const [k, e] of [['MAT', { mean: 0.6, sd: 0.4 }], ['QR', { mean: -0.3, sd: 0.55 }]] as const) {
      const i = AXIS_INDEX[k]
      expect(o.theta[i]).toBe(e.mean)
      expect(o.cov[i]![i]).toBeCloseTo(e.sd * e.sd, 12)
      expect(o.eap[k]).toEqual(e)
      for (let j = 0; j < N_AXES; j++) if (j !== i) expect(o.cov[i]![j]).toBe(0)
    }
    for (let i = 0; i < N_AXES; i++) {
      const k = AXIS_CODES[i]!
      if (k === 'MAT' || k === 'QR') continue
      expect(o.theta[i]).toBe(local.theta[i])
      expect(o.eap[k]).toEqual(local.eap[k])
    }
    // symmetric, finite, positive diagonal: the profile view's own checks
    for (let i = 0; i < N_AXES; i++) {
      expect(o.cov[i]![i]!).toBeGreaterThan(0)
      for (let j = 0; j < N_AXES; j++) expect(o.cov[i]![j]).toBe(o.cov[j]![i])
    }
    expect(() => axisEstimates({ score: o })).not.toThrow()
  })

  it('does not change its input, and keeps the axes in canonical order', () => {
    const before = JSON.stringify(local)
    const o = overlayServed(local, reply())
    expect(JSON.stringify(local)).toBe(before)
    const order = Object.keys(o.eap).map((k) => AXIS_CODES.indexOf(k as (typeof AXIS_CODES)[number]))
    expect(order).toEqual([...order].sort((a, b) => a - b))
  })

  it('a zero sd still gives a usable variance', () => {
    const o = overlayServed(local, reply({ eap: { MAT: { mean: 0.1, sd: 0, n: 5 } } }))
    expect(o.cov[AXIS_INDEX.MAT]![AXIS_INDEX.MAT]!).toBeGreaterThan(0)
  })
})

describe('buildResults with the server scoring the counted questions', () => {
  it('scores none of a served session itself: with no estimate the profile has nothing, and the save is the same', () => {
    // the page could score these answers by regenerating the items (the ids name them); it must not
    expect(served.sessions[0]!.responses.length).toBeGreaterThan(10)
    expect(buildResults(served, servedScores(null))).toBeNull()
    expect(buildResults(served, servedScores(reply({ eap: {}, facets: {} })))).toBeNull() // the server withheld everything
  })

  it('shows the server’s axes, the facets it computed, and counts its sessions', () => {
    const r = buildResults(served, servedScores(reply({ sessions: [{ sessionId: served.sessions[0]!.session_id, known: true }] })))!
    expect(r.rescore.eap.MAT).toEqual({ mean: 0.6, sd: 0.4 })
    expect(r.rescore.eap.QR).toEqual({ mean: -0.3, sd: 0.55 })
    expect(Object.keys(r.rescore.eap).sort()).toEqual(['MAT', 'QR'])
    expect(r.servedFacets).toEqual({ MAT: { series: { mean: 0.7, sd: 0.5, n: 5 } } })
    expect(r.facetObservations).toEqual([]) // nothing is scored here, not even for a facet
    expect(r.servedSessions).toBe(1)
    expect(scoredSessions(r)).toBe(1)
    const e = axisEstimates(r.input)
    expect(e.find((x) => x.code === 'MAT')).toMatchObject({ measured: true, theta: 0.6 })
    expect(e.find((x) => x.code === 'SPA')).toMatchObject({ measured: false })
  })

  it('a session the server does not score (made without it) is scored here, next to the served one', () => {
    const local = botSave('s_SERVEDRES00002', { level: 0.2 })
    const joined = { ...served, sessions: [...served.sessions, ...local.save.sessions] } as SaveFileV1
    const r = buildResults(joined, { sessionIds: new Set(ids(served)), estimates: reply({ eap: { MAT: { mean: 0.6, sd: 0.4, n: 8 } }, sessions: [{ sessionId: served.sessions[0]!.session_id, known: true }] }) })!
    expect(r.rescore.eap.MAT).toEqual({ mean: 0.6, sd: 0.4 }) // the server’s
    expect(Object.hasOwn(r.rescore.eap, 'SPA')).toBe(true) // the local session’s
    expect(r.facetObservations.length).toBeGreaterThan(0)
    expect(scoredSessions(r)).toBe(2)
  })

  it('a skipped axis is not shown even though the server returned a number for it', () => {
    const skipped = servedLike('s_SERVEDRES00003', { skipped: ['QR'] })
    const r = buildResults(skipped, { sessionIds: new Set(ids(skipped)), estimates: reply() })!
    expect(r.skipped).toContain('QR')
    expect(axisEstimates(r.input).find((e) => e.code === 'QR')).toMatchObject({ measured: false, reason: 'skipped' })
  })

  it('still counts a served session as a test of its axes for the practice model (§7.8)', () => {
    const second = botSave('s_SERVEDRES00004', { startedMs: 1_790_000_000_000 + 8 * 86_400_000 })
    const two = { ...served, sessions: [...served.sessions, ...second.save.sessions] } as SaveFileV1
    const r = buildResults(two, { sessionIds: new Set(ids(served)), estimates: null })!
    const later = r.rescore.sessions.find((s) => s.session_id === 's_SERVEDRES00004')!
    // the served session counted as the first test of each served axis; the second session's scored axes are its second
    for (const k of ['MAT', 'SPA', 'QR'] as const) expect(later.ordinals[k], k).toBe(2)
  })

  it('without a server nothing changes: the same model as before, with none of the new fields', () => {
    const r = buildResults(botSave('s_SERVEDRES00008').save)!
    expect(Object.keys(r).sort()).toEqual(['facetObservations', 'input', 'nSessions', 'practiceAdjusted', 'rescore', 'skipped'])
  })
})
