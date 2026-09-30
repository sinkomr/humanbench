import { describe, expect, it } from 'vitest'
import { createRng } from '../engine/prng'
import type { ResponseTuple } from '../engine/types'
import type { SaveFileV1 } from '../save/types'
import { answerBlock } from '../sim/responders'
import { series } from '../tasks/series'
import { reading } from '../tasks/reading'
import { rtSimple } from '../tasks/rt'
import { spanBwd, spanFwd } from '../tasks/span'
import { runBlock } from '../tasks/span/score'
import { readingBlockObservation } from '../tasks/reading/score'
import type { ReadingKey, ReadingResponse, ReadingSpec } from '../tasks/reading/types'
import type { ItemInstance } from '../tasks/family'
import type { SpanItem } from '../tasks/span/config'
import { WEB_SIMPLE_RT_MEDIAN_MS, PACE_MIN_ANSWERS, TAKER_COMPARISON, hasNorms, normFacts, paceByAxis, paceLabel } from './norms'
import { botSave, DAY_MS, T0_MS } from './test-support'

/** A save with just the sessions (the norms read nothing else). */
function withSessions(...sessions: { id: string; started?: string; flags?: Record<string, boolean>; responses: ResponseTuple[] }[]): SaveFileV1 {
  return {
    sessions: sessions.map((s, i) => ({
      session_id: s.id,
      started_utc: s.started ?? `2026-10-0${i + 1}T10:00:00Z`,
      duration_s: 60,
      device: { class: 'desktop', input: 'keyboard', os_family: 'macOS', browser_family: 'Chrome', refresh_hz_est: 60, timer_res_ms: 0.1, viewport: [1280, 800] },
      flags: s.flags ?? {},
      responses: s.responses,
    })),
  } as unknown as SaveFileV1
}

const blockTuple = (item: { item_id: string }, response: unknown): ResponseTuple => [item.item_id, 0, response as never, null, 1000, null]

describe('external norms (§7.3)', () => {
  it('reading: words per minute of a passed, unskimmed block', () => {
    const item = reading.generate('norm-reading') as ItemInstance<ReadingSpec, ReadingKey>
    const response: ReadingResponse = { reading_time_ms: (item.spec.word_count * 60_000) / 200, choices: [...item.key.indices] }
    const f = normFacts(withSessions({ id: 's1', responses: [blockTuple(item, response)] }))
    expect(f.readingWpm).toBe(200)
    // The gate failed: no reading figure.
    const wrong: ReadingResponse = { ...response, choices: item.key.indices.map((i) => (i + 1) % 4) }
    expect(normFacts(withSessions({ id: 's1', responses: [blockTuple(item, wrong)] })).readingWpm).toBeNull()
    // Skimming (> 900 wpm): none.
    const skim: ReadingResponse = { ...response, reading_time_ms: (item.spec.word_count * 60_000) / 1200 }
    expect(normFacts(withSessions({ id: 's1', responses: [blockTuple(item, skim)] })).readingWpm).toBeNull()
    expect(readingBlockObservation(item, response).status).toBe('ok')
  })

  it('digit span: the longest length passed, forwards and backwards', () => {
    const fwd = spanFwd.generate('norm-fwd') as SpanItem
    const bwd = spanBwd.generate('norm-bwd') as SpanItem
    const a = answerBlock(spanFwd, fwd, 1.5, createRng('a'))
    const b = answerBlock(spanBwd, bwd, 0.2, createRng('b'))
    const f = normFacts(withSessions({ id: 's1', responses: [blockTuple(fwd, a.response), blockTuple(bwd, b.response)] }))
    const want = (item: SpanItem, r: unknown): number | null => {
      const st = runBlock(item, r as never)
      return st.finished && st.outcome.longest_passed > 0 ? st.outcome.longest_passed : null
    }
    expect(f.digitsForward).toBe(want(fwd, a.response))
    expect(f.digitsBackward).toBe(want(bwd, b.response))
    expect(f.digitsForward).toBeGreaterThanOrEqual(3)
  })

  it('simple reaction time: the median of the valid trials, in ms', () => {
    const item = rtSimple.generate('norm-rt')
    const n = item.key.positions.length
    const response = { rt_ms: Array.from({ length: n }, () => 300), choice: item.key.positions.slice() }
    expect(normFacts(withSessions({ id: 's1', responses: [blockTuple(item, response)] })).simpleRtMs).toBe(300)
    // Too few valid trials: none.
    const bad = { rt_ms: Array.from({ length: n }, () => null), choice: Array.from({ length: n }, () => null) }
    expect(normFacts(withSessions({ id: 's1', responses: [blockTuple(item, bad)] })).simpleRtMs).toBeNull()
  })

  it('takes the latest valid block, and leaves out sessions that skipped that part', () => {
    const item = rtSimple.generate('norm-rt2')
    const n = item.key.positions.length
    const at = (ms: number) => ({ rt_ms: Array.from({ length: n }, () => ms), choice: item.key.positions.slice() })
    const two = withSessions(
      { id: 's1', started: '2026-10-01T10:00:00Z', responses: [blockTuple(item, at(280))] },
      { id: 's2', started: '2026-10-08T10:00:00Z', responses: [blockTuple(item, at(340))] },
    )
    expect(normFacts(two).simpleRtMs).toBe(340)
    const skipped = withSessions(
      { id: 's1', started: '2026-10-01T10:00:00Z', responses: [blockTuple(item, at(280))] },
      { id: 's2', started: '2026-10-08T10:00:00Z', flags: { skipped_rt: true }, responses: [blockTuple(item, at(340))] },
    )
    expect(normFacts(skipped).simpleRtMs).toBe(280)
  })

  it('a malformed stored block is passed over, not fatal', () => {
    const item = rtSimple.generate('norm-rt3')
    expect(normFacts(withSessions({ id: 's1', responses: [blockTuple(item, { rt_ms: [1], choice: [0] })] })).simpleRtMs).toBeNull()
  })

  it('finds the facts in a real session, and says whether there is anything to compare', () => {
    const { save } = botSave('s_NORMS00000000001', { level: 1 })
    const f = normFacts(save)
    expect(hasNorms(f)).toBe(true)
    expect(f.simpleRtMs).toBeGreaterThan(100)
    expect(f.simpleRtMs).toBeLessThan(2000)
    expect(hasNorms({ readingWpm: null, digitsForward: null, digitsBackward: null, simpleRtMs: null })).toBe(false)
  })

  it('shows web-relative reaction norms only, and no percentiles among takers before M4 (A12)', () => {
    expect(WEB_SIMPLE_RT_MEDIAN_MS).toBe(300)
    expect(TAKER_COMPARISON.enabled).toBe(false)
    expect(TAKER_COMPARISON.minTakers).toBe(500)
  })
})

describe('pace (§7.1 (3): separate from the estimate)', () => {
  const tuples = (seedPrefix: string, factor: number, n = 4): ResponseTuple[] =>
    Array.from({ length: n }, (_, i) => {
      const item = series.generate(`${seedPrefix}${i}`, { stratum: 2 })
      return [item.item_id, 0, '1', 1, item.expected_time_s * 1000 * factor, 70] as ResponseTuple
    })

  it('compares the time taken with the question’s expected time, by skill', () => {
    const rows = paceByAxis(withSessions({ id: 's1', responses: [...tuples('quick', 0.5), ...tuples('slow', 2, 1)] }))
    // 4 quick + 1 slow: median ratio 0.5
    expect(rows).toHaveLength(1)
    expect(rows[0]!.code).toBe('MAT')
    expect(rows[0]!.n).toBe(5)
    expect(rows[0]!.ratio).toBeCloseTo(0.5, 6)
    expect(rows[0]!.label).toBe('quicker')
    expect(paceByAxis(withSessions({ id: 's1', responses: tuples('typ', 1) }))[0]!.label).toBe('typical')
    expect(paceByAxis(withSessions({ id: 's1', responses: tuples('slo', 1.8) }))[0]!.label).toBe('slower')
  })

  it('needs at least three answers on the skill, and leaves out time-outs, pretest items and skipped skills', () => {
    expect(paceByAxis(withSessions({ id: 's1', responses: tuples('few', 1, PACE_MIN_ANSWERS - 1) }))).toEqual([])
    const timeouts = tuples('to', 1).map((t) => [t[0], 0, null, 0, 180000, null] as ResponseTuple)
    expect(paceByAxis(withSessions({ id: 's1', responses: timeouts }))).toEqual([])
    const pretest = tuples('pt', 1).map((t) => [t[0], 1, t[2], t[3], t[4], t[5]] as ResponseTuple)
    expect(paceByAxis(withSessions({ id: 's1', responses: pretest }))).toEqual([])
    expect(paceByAxis(withSessions({ id: 's1', flags: { skipped_mat: true }, responses: tuples('sk', 1) }))).toEqual([])
  })

  it('label bounds: below 0.8 quicker, above 1.25 slower', () => {
    expect(paceLabel(0.79)).toBe('quicker')
    expect(paceLabel(0.8)).toBe('typical')
    expect(paceLabel(1.25)).toBe('typical')
    expect(paceLabel(1.26)).toBe('slower')
  })

  it('reads a real session, several sessions pooled, in canonical axis order', () => {
    const one = botSave('s_PACE0000000000001')
    const two = botSave('s_PACE0000000000002', { base: one.save, startedMs: T0_MS + 8 * DAY_MS })
    const rows = paceByAxis(two.save)
    expect(rows.length).toBeGreaterThan(0)
    const codes = rows.map((r) => r.code)
    expect(codes).toEqual([...codes].sort((a, b) => ['MAT', 'LR', 'LG', 'RC', 'VOC', 'QR', 'SPA'].indexOf(a) - ['MAT', 'LR', 'LG', 'RC', 'VOC', 'QR', 'SPA'].indexOf(b)))
    for (const r of rows) {
      expect(r.medianS).toBeGreaterThan(0)
      expect(r.typicalS).toBeGreaterThan(0)
    }
  })
})
