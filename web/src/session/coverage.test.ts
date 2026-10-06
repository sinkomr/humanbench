import { describe, expect, it } from 'vitest'
import { newAnonId } from '../save/ids'
import { saveWithSession } from '../save/create'
import { SAVE_CTX } from './constants'
import { priorItemCounts, questionsAnswered } from './coverage'
import { Bot } from './bot'

const CAT_ONLY = ['RT', 'WM', 'PS'] as const

function saveOf(bots: readonly Bot[]) {
  let base = null as ReturnType<typeof saveWithSession> | null
  const anonId = newAnonId()
  for (const b of bots) {
    const st = b.run.sessionState()
    base = saveWithSession(base, st, { ctx: SAVE_CTX, createdMs: st.startedMs + 1000, anonId })
  }
  return base
}

describe('priorItemCounts: CAT items per axis in a save (M1.15 review, §7.4 L584)', () => {
  it('is empty for no save, and for a session with no answers', () => {
    expect(priorItemCounts(null)).toEqual({})
    expect(priorItemCounts(saveOf([new Bot({ sessionId: 's_COVERAGE000001' })]))).toEqual({})
  })

  it('counts the answers and time-outs of power items by axis; fixed blocks do not count', () => {
    const bot = new Bot({ sessionId: 's_COVERAGE000002' })
    bot.finish()
    const st = bot.run.sessionState()
    const blocks = st.responses.filter((t) => t[3] === null).length
    expect(blocks).toBe(7) // rt ×2, span ×3, coding, reading: none of them counted
    const counts = priorItemCounts(saveOf([bot]))
    const items = bot.run.result().itemsByAxis
    expect(counts).toEqual(items)
    expect(Object.keys(counts).sort()).toEqual(['MAT', 'QR', 'SPA'])
    expect(counts.RT).toBeUndefined()
    expect(counts.WM).toBeUndefined()
  })

  it('adds the sessions of a save together', () => {
    const a = new Bot({ sessionId: 's_COVERAGE000003', skipped: [...CAT_ONLY, 'SPA', 'QR'] })
    a.finish()
    const b = new Bot({ sessionId: 's_COVERAGE000004', skipped: [...CAT_ONLY, 'SPA', 'QR'], seenFamilies: a.run.sessionState().seenFamilies })
    b.finish()
    const counts = priorItemCounts(saveOf([a, b]))
    expect(counts.MAT).toBe((a.run.result().itemsByAxis.MAT ?? 0) + (b.run.result().itemsByAxis.MAT ?? 0))
    expect(counts.SPA).toBeUndefined()
  })

  it('leaves out pretest responses and ids of no registered family', () => {
    const bot = new Bot({ sessionId: 's_COVERAGE000005', skipped: [...CAT_ONLY, 'SPA', 'QR'] })
    bot.until((v) => v.phase === 'confidence')
    bot.run.confirmConfidence(bot.view().confidence!.startPct)
    const save = saveOf([bot])!
    const extra = [
      [save.sessions[0]!.responses[0]![0], 1, 0, 0, 1000, null], // pretest of a counted item
      ['i:nosuchfamily:1.0.0:x', 0, 0, 1, 1000, null], // a family this build does not know
      ['not an item id', 0, 0, 1, 1000, null],
    ] as const
    const withExtra = { ...save, sessions: [{ ...save.sessions[0]!, responses: [...save.sessions[0]!.responses, ...extra.map((t) => [...t] as never)] }] }
    expect(priorItemCounts(withExtra)).toEqual(priorItemCounts(save))
    expect(priorItemCounts(save)).toEqual({ MAT: 1 })
  })
})

describe('questionsAnswered: the power items one session holds (UX-012a)', () => {
  it('is 0 for a session with no answers, and counts the answers and time-outs of power items, not fixed blocks', () => {
    expect(questionsAnswered(saveOf([new Bot({ sessionId: 's_COVERAGE000009' })])!.sessions[0]!)).toBe(0)
    const bot = new Bot({ sessionId: 's_COVERAGE000010' })
    bot.finish()
    const save = saveOf([bot])!
    const items = Object.values(bot.run.result().itemsByAxis).reduce<number>((n, c) => n + (c ?? 0), 0)
    expect(items).toBeGreaterThan(0)
    expect(questionsAnswered(save.sessions[0]!)).toBe(items)
    expect(save.sessions[0]!.responses.length).toBeGreaterThan(items) // the blocks are in the session too
  })
})

