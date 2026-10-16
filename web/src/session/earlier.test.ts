import { describe, expect, it } from 'vitest'
import { initialSigma, type AxisCode } from '../engine/axes'
import { sessionPosterior } from '../engine/selector'
import type { Observation } from '../engine/types'
import { sessionEvidence } from '../engine/xskill'
import { newAnonId } from '../save/ids'
import { saveWithSession } from '../save/create'
import { registryObservation } from '../save/rescore'
import { resolveItem } from '../tasks/registry'
import { Bot } from './bot'
import { SAVE_CTX } from './constants'
import { EARLIER_SESSIONS_MAX, earlierObservations } from './earlier'

const NO_BLOCKS = ['RT', 'WM', 'PS'] as const

function saveOf(bots: readonly Bot[]) {
  let base = null as ReturnType<typeof saveWithSession> | null
  const anonId = newAnonId()
  for (const b of bots) {
    const st = b.run.sessionState()
    base = saveWithSession(base, st, { ctx: SAVE_CTX, createdMs: st.startedMs + 1000, anonId })
  }
  return base!
}

/** The b of the first question the session served on `axis`. */
function firstB(bot: Bot, axis: AxisCode): number {
  for (const t of bot.run.sessionState().responses) {
    const item = resolveItem(String(t[0]))
    if (item !== null && item.axis === axis) return (item.params as { b: number }).b
  }
  throw new Error(`no ${axis} question`)
}

describe('earlierObservations: a returning person’s earlier sessions, for the aim only (owner request 2026-10-15)', () => {
  it('is empty without a save', () => {
    expect(earlierObservations(null)).toEqual([])
  })

  it('is one Gaussian term a skill a session, from that session’s own answers re-scored from the save', () => {
    const bot = new Bot({ sessionId: 's_EARLIER0000001', skipped: [...NO_BLOCKS] }, { theta: new Array<number>(17).fill(1.5) })
    bot.finish()
    const save = saveOf([bot])
    const obs: Observation[] = []
    for (const t of save.sessions[0]!.responses) {
      const r = registryObservation(t)
      if ('observation' in r) obs.push(r.observation)
    }
    const ev = earlierObservations(save)
    expect(ev).toEqual(sessionEvidence(obs, { sigma: initialSigma() }))
    expect(ev.map((o) => o.axis).sort()).toEqual(['MAT', 'QR', 'SPA'])
    expect(ev.every((o) => o.kind === 'gaussian')).toBe(true)
  })

  it('reads at most the last ten sessions', () => {
    expect(EARLIER_SESSIONS_MAX).toBe(10)
  })

  it('a returning strong taker’s parts start harder than a newcomer’s; the session’s own posterior is its own', () => {
    const theta = new Array<number>(17).fill(2.5)
    const first = new Bot({ sessionId: 's_EARLIER0000002', skipped: [...NO_BLOCKS] }, { theta })
    first.finish()
    const earlier = earlierObservations(saveOf([first]))
    const seenFamilies = first.run.sessionState().seenFamilies
    const back = new Bot({ sessionId: 's_EARLIER0000003', skipped: [...NO_BLOCKS], seenFamilies, earlierObservations: earlier }, { theta })
    const fresh = new Bot({ sessionId: 's_EARLIER0000003', skipped: [...NO_BLOCKS], seenFamilies }, { theta })
    back.finish()
    fresh.finish()
    // Matrix & Series is the first part: nothing in this session to borrow from, so only the earlier session moves it
    expect(firstB(fresh, 'MAT')).toBeLessThan(0.75)
    expect(firstB(back, 'MAT')).toBeGreaterThan(firstB(fresh, 'MAT') + 0.5)
    // the earlier session is not an answer of this one: the result's observations are the session's own items, and its
    // score is made from them alone
    const own: Observation[] = []
    for (const t of back.run.sessionState().responses) {
      const r = registryObservation(t)
      if ('observation' in r) own.push(r.observation)
    }
    const r = back.run.result()
    expect(r.observations.filter((o) => o.kind === '2pl' || o.kind === '3pl')).toEqual(own.filter((o) => o.kind === '2pl' || o.kind === '3pl'))
    expect(r.observations.some((o) => earlier.includes(o))).toBe(false)
    expect(sessionPosterior(r.observations.filter((o) => o.axis === 'MAT')).MAT).toEqual(sessionPosterior(r.observations).MAT)
  })
})
