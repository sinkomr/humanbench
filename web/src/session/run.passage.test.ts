/**
 * Served passages in the session run (ROADMAP M3.11 phase 2; DESIGN §3 row 4, §7.1, §7.4, §10, R-11.1; owner
 * decision 2026-10-12: the passage stays visible while its questions are answered). The server here is a fake
 * with the set rule of the real one (`supabase/migrations/20261013000100_item_sets.sql`): a passage's
 * questions one after the other, each with its place in the set, and a call for another skill leaves the
 * passage. `scripts/db/passage.db.test.ts` plays the same against the real database. Every passage is made up.
 */

import fc from 'fast-check'
import { describe, expect, it } from 'vitest'
import { toServedItem, type ServedItem } from '../backend/items'
import type { CatAnswer, CatNext, CatSource } from '../backend/session'
import type { AxisCode } from '../engine/axes'
import { A15_TYPICAL_S, MIN_ITEMS_SLACK, PUBLISH_MIN_ITEMS, RC_PASSAGES, sessionOutline, textPartOf } from '../engine/plan-table'
import { demoPassage, demoPassagePayload } from '../render/text/demo-passage'
import { TEXT_PASSAGE_RENDERER } from '../render/text/passage'
import { TEST_DEVICE } from './bot'
import { SessionRun, type RunConfig, type RunView } from './run'

const settle = async (): Promise<void> => {
  for (let i = 0; i < 20; i++) await Promise.resolve()
}

const ALL_A15: readonly AxisCode[] = ['RT', 'MAT', 'SPA', 'WM', 'QR', 'PS']
const RC = textPartOf('RC')!
const idOf = (passage: number, q: number): string => `i:tst:rc:p${String(passage + 1).padStart(2, '0')}-q${q + 1}`
const placeOf = (itemId: string): { passage: number; q: number } => {
  const m = /p(\d+)-q(\d+)$/u.exec(itemId)!
  return { passage: Number(m[1]) - 1, q: Number(m[2]) - 1 }
}

/** A fake server of made-up passages: `sizes[p]` questions for passage p, served as sets; other skills get plain made-up items. */
class SetServer implements CatSource {
  readonly sessionId = 's_SERVERSESSION01'
  readonly asked: (readonly AxisCode[])[] = []
  readonly answers: CatAnswer[] = []
  readonly served: ServedItem[] = []
  pending: ServedItem | null = null
  #open: { passage: number; served: number } | null = null
  #next = 0

  constructor(
    readonly sizes: readonly number[],
    /** The first question's time limit, and the later ones'. */
    readonly limits: readonly [number, number] = [300, 180],
  ) {}

  next(axes: readonly AxisCode[]): Promise<CatNext> {
    this.asked.push([...axes])
    if (this.pending !== null) return Promise.resolve({ kind: 'item', item: this.pending })
    if (!axes.includes('RC')) {
      this.#open = null
      return Promise.resolve({ kind: 'done', reason: 'no_items' })
    }
    if (this.#open === null || this.#open.served >= this.sizes[this.#open.passage]!) {
      if (this.#next >= this.sizes.length) return Promise.resolve({ kind: 'done', reason: 'no_items' })
      this.#open = { passage: this.#next++, served: 0 }
    }
    const { passage, served } = this.#open
    const of = this.sizes[passage]!
    const demo = demoPassage(passage)
    const payload = demoPassagePayload(demo, served % demo.questions.length)
    const media = { ...payload.media, passage: [`Made-up passage ${passage + 1} of this test.`, ...payload.media.passage] }
    const item = toServedItem(this.served.length + 1, { itemId: idOf(passage, served), itemType: 'mc_passage', timeLimitS: served === 0 ? this.limits[0] : this.limits[1], stem: payload.stem, media, options: payload.options }, of >= 2 ? { index: served + 1, of } : null)
    this.#open.served++
    this.pending = item
    this.served.push(item)
    return Promise.resolve({ kind: 'item', item })
  }

  answer(a: CatAnswer): Promise<void> {
    this.answers.push(a)
    if (this.pending?.item_id === a.item.item_id) this.pending = null
    return Promise.resolve()
  }
}

interface Seen {
  readonly phase: string
  readonly item: string | null
  readonly passageKey: string | null
  readonly position: { index: number; of: number } | null
}

/** What a taker does with the question on screen: an option, `null` to let it run out of time, 'skip' or 'finish'. */
type Act = number | null | 'skip' | 'finish'

class Taker {
  t = 0
  readonly run: SessionRun
  readonly seen: Seen[] = []
  /** The passage paragraphs array of every question shown, by item id (object identity matters). */
  readonly texts = new Map<string, readonly string[]>()
  itemS = 30
  act: (v: RunView, n: number) => Act = () => 0
  #n = 0

  constructor(
    readonly server: SetServer,
    cfg: Partial<RunConfig> = {},
  ) {
    this.run = new SessionRun({ sessionId: 's_LOCALSESSION001', startedMs: 1_790_000_000_000, now: () => this.t, device: TEST_DEVICE, rtInput: 'keyboard', cat: server, textAxes: ['RC'], skipped: ALL_A15, ...cfg })
    // every screen the run announces, the short waits for the server included
    this.run.subscribe(() => this.#note(this.run.view()))
  }

  #note(v: RunView): void {
    this.seen.push({ phase: v.phase, item: v.item?.item_id ?? null, passageKey: v.passage?.passageKey ?? null, position: v.passage?.position ?? null })
    if (v.item !== null && v.passage !== null) this.texts.set(v.item.item_id, v.passage.passage)
  }

  /** Plays until the session is finished (or `until` says so). */
  async play(until: (v: RunView) => boolean = () => false): Promise<RunView> {
    for (let guard = 0; guard < 2000; guard++) {
      await settle()
      this.run.tick()
      const v = this.run.view()
      this.#note(v)
      if (v.phase === 'finished' || until(v)) return v
      if (v.phase === 'loading') {
        if (v.problem !== null) throw new Error(`the wait failed: ${v.problem}`)
        continue
      }
      if (v.phase === 'interstitial') this.run.startSegment()
      else if (v.phase === 'break_offer') this.run.declineBreak()
      else if (v.phase === 'item') {
        const act = this.act(v, this.#n++)
        this.run.itemShown(this.t)
        if (act === 'skip') this.run.skipAxis()
        else if (act === 'finish') this.run.finishEarly()
        else if (act === null) {
          this.t += (v.item!.time_limit_s + 1) * 1000
          this.run.tick()
        } else {
          this.t += this.itemS * 1000
          this.run.itemResponded(act, 50)
        }
      } else throw new Error(`unexpected phase ${v.phase}`)
    }
    throw new Error('the session did not finish')
  }

  /** The questions shown, in order. */
  shown(): string[] {
    const out: string[] = []
    for (const s of this.seen) if (s.phase === 'item' && s.item !== null && out[out.length - 1] !== s.item) out.push(s.item)
    return out
  }
}

describe('a Reading Comprehension part of made-up passages', () => {
  it('reads two passages, every question of each, and ends: seven questions, with time left on its share', async () => {
    const t = new Taker(new SetServer([3, 4, 3, 4]))
    const end = await t.play()
    expect(t.shown()).toEqual([idOf(0, 0), idOf(0, 1), idOf(0, 2), idOf(1, 0), idOf(1, 1), idOf(1, 2), idOf(1, 3)])
    expect(t.server.served.length).toBe(7) // nothing of a third passage was asked for
    expect(end.elapsedS).toBeLessThan(RC.share_s)
    expect(t.run.result().itemsByAxis.RC).toBe(7)
    expect(t.run.result().segmentEnds).toEqual([{ segment: 'reading_comprehension', reason: 'time' }])
    expect(t.run.sessionState().flags.done_reading_comprehension).toBe(true)
    expect(RC_PASSAGES).toBe(2)
    // every answer went to the server as a position, with no verdict anywhere on the page
    expect(t.server.answers.map((a) => a.response)).toEqual([0, 0, 0, 0, 0, 0, 0])
    expect(t.run.catSessionState()!.responses.every((r) => r[3] === null)).toBe(true)
  })

  it('keeps the passage on screen from its first question to its last, the waits between them included, and shows the next passage as a new one', async () => {
    const t = new Taker(new SetServer([3, 4, 3]))
    await t.play()
    const first = [idOf(0, 0), idOf(0, 1), idOf(0, 2)]
    // one object for the passage's text across its questions: nothing about it changes between them
    expect(new Set(first.map((id) => t.texts.get(id))).size).toBe(1)
    expect(t.texts.get(idOf(1, 0))).not.toBe(t.texts.get(idOf(0, 0)))
    const keyA = t.seen.find((s) => s.item === idOf(0, 0))!.passageKey
    const keyB = t.seen.find((s) => s.item === idOf(1, 0))!.passageKey
    expect(keyA).not.toBeNull()
    expect(keyB).not.toBe(keyA)
    // from the first question of passage one to its last, every screen is the passage's: the question, the wait
    const from = t.seen.findIndex((s) => s.item === idOf(0, 0))
    const to = t.seen.findLastIndex((s) => s.item === idOf(0, 2))
    const during = t.seen.slice(from, to + 1)
    expect(during.every((s) => s.passageKey === keyA)).toBe(true)
    expect(during.some((s) => s.phase === 'loading')).toBe(true)
    expect(during.filter((s) => s.phase === 'loading').every((s) => s.position === null)).toBe(true)
    expect(first.every((id) => during.some((s) => s.phase === 'item' && s.item === id))).toBe(true)
    // the place of each question among the passage's own
    expect(first.map((id) => t.seen.find((s) => s.item === id)!.position)).toEqual([1, 2, 3].map((index) => ({ index, of: 3 })))
    // between two passages nothing of the first is left on screen
    const gap = t.seen.slice(to + 1, t.seen.findIndex((s) => s.item === idOf(1, 0))).filter((s) => s.phase === 'loading')
    expect(gap.length).toBeGreaterThan(0)
    expect(gap.every((s) => s.passageKey === null)).toBe(true)
    // and no other screen of the session has a passage
    expect(t.seen.filter((s) => s.phase === 'interstitial' || s.phase === 'finished').every((s) => s.passageKey === null)).toBe(true)
  })

  it('shows each question with the time limit the server states: the first question\'s covers the reading, and nothing is timed afresh between questions', async () => {
    const t = new Taker(new SetServer([3, 3], [420, 150]))
    const limits: number[] = []
    t.act = (v) => {
      limits.push(v.item!.time_limit_s)
      return 0
    }
    await t.play()
    expect(limits).toEqual([420, 150, 150, 420, 150, 150])
    expect(t.run.view().item).toBeNull()
    // the response time of a question is its own: thirty seconds each, the first one included
    expect(t.server.answers.map((a) => a.rtMs)).toEqual([30_000, 30_000, 30_000, 30_000, 30_000, 30_000])
  })

  it('finishes a passage it has started although the part\'s time is used up, and then ends when it has its five answers', async () => {
    const t = new Taker(new SetServer([5, 3, 3]))
    t.itemS = 200 // five questions take far more than the part's share
    const end = await t.play()
    expect(t.shown().length).toBe(5)
    expect(end.elapsedS).toBeGreaterThan(RC.share_s)
    expect(t.server.served.length).toBe(5)
  })

  it('past its time with fewer than five answers it reads the next passage, whole', async () => {
    const t = new Taker(new SetServer([4, 4, 4]))
    t.itemS = 200
    await t.play()
    expect(t.shown()).toEqual([0, 1, 2, 3].map((q) => idOf(0, q)).concat([0, 1, 2, 3].map((q) => idOf(1, q))))
  })

  it('short of five answers after two passages (some questions ran out of time) it reads one more; with enough shown it stops', async () => {
    const more = new Taker(new SetServer([3, 3, 4, 3]))
    more.act = (_v, n) => (n === 1 || n === 4 ? null : 0) // four answered of six shown
    await more.play()
    expect(more.shown().length).toBe(10)
    expect(more.server.answers.filter((a) => a.response !== null).length).toBe(8)

    const enough = new Taker(new SetServer([4, 4, 4]))
    enough.act = (_v, n) => (n < 4 ? null : 0) // four answered of eight shown: at the limit of what is shown to get to five
    await enough.play()
    expect(enough.shown().length).toBe(8)
    expect(PUBLISH_MIN_ITEMS + MIN_ITEMS_SLACK).toBe(7)
  })

  it('a question that ran out of time does not end its passage, and is handed to the server without an answer', async () => {
    const t = new Taker(new SetServer([3, 3]))
    t.act = (_v, n) => (n === 0 ? null : 0)
    await t.play()
    expect(t.shown()).toEqual([idOf(0, 0), idOf(0, 1), idOf(0, 2), idOf(1, 0), idOf(1, 1), idOf(1, 2)])
    expect(t.server.answers[0]).toMatchObject({ response: null, confidence: null })
    expect(t.server.answers[0]!.release).toBeUndefined()
  })

  it('a skip inside a passage lets the question go and takes the passage off the screen; "finish early" and the hard stop end it where it is', async () => {
    const skip = new Taker(new SetServer([4, 4]))
    skip.act = (_v, n) => (n === 1 ? 'skip' : 0)
    const end = await skip.play()
    expect(skip.shown()).toEqual([idOf(0, 0), idOf(0, 1)])
    expect(skip.server.answers[1]).toMatchObject({ response: null, release: 'skipped' })
    expect(end.passage).toBeNull()
    expect(end.skipped).toContain('RC')

    const early = new Taker(new SetServer([4, 4]))
    early.act = (_v, n) => (n === 2 ? 'finish' : 0)
    const done = await early.play()
    expect(done.ended).toBe('finish_early')
    expect(done.passage).toBeNull()
    expect(early.run.result().itemsByAxis.RC).toBe(2)

    const stop = new Taker(new SetServer([4, 4]), { hardStopS: 100 })
    stop.itemS = 40
    const hard = await stop.play()
    expect(hard.ended).toBe('hard_stop')
    expect(hard.passage).toBeNull()
    expect(stop.shown().length).toBeLessThan(4)
  })

  it('a server without passages: the part is dropped without a word, as any text part', async () => {
    const t = new Taker(new SetServer([]))
    const end = await t.play()
    expect(end.segments).toEqual([])
    expect(t.server.asked).toEqual([['RC']])
    expect(end.notice).toBeNull()
    expect(t.run.catSessionState()).toBeNull()
  })

  it('a passage of one question has no place to state and is a passage all the same', async () => {
    const t = new Taker(new SetServer([1, 1, 1, 1, 1, 1, 1, 1]))
    await t.play()
    // two passages are two answers: short of five, so it reads on until it has them
    expect(t.shown().length).toBe(5)
    expect(t.seen.filter((s) => s.phase === 'item').every((s) => s.passageKey !== null && s.position === null)).toBe(true)
  })

  it('is drawn by the passage renderer and counts toward the session\'s typical length, which the ring shows', async () => {
    // (the six parts are planned; these two runs are only read, not played)
    expect(new Taker(new SetServer([3, 4]), { skipped: [], textAxes: [] }).run.view().targetS).toBe(A15_TYPICAL_S)
    expect(new Taker(new SetServer([3, 4]), { skipped: [] }).run.view().targetS).toBe(A15_TYPICAL_S + RC.typical_s)
    const alone = new Taker(new SetServer([3, 4]))
    const v = await alone.play((x) => x.phase === 'item')
    expect(v.item!.family).toBe(TEXT_PASSAGE_RENDERER)
    expect(v.segment).toMatchObject({ id: 'reading_comprehension', title: 'Reading Comprehension', minutes: Math.round(RC.share_s / 60) })
    expect(sessionOutline(['RC']).typical_s).toBe(A15_TYPICAL_S + RC.typical_s)
  })

  it('never leaves a passage unfinished and ends with five answers or with seven questions shown, whatever the passages and the pace (fast-check)', async () => {
    await fc.assert(
      fc.asyncProperty(fc.array(fc.integer({ min: 1, max: 5 }), { minLength: 12, maxLength: 12 }), fc.array(fc.boolean(), { minLength: 40, maxLength: 40 }), fc.integer({ min: 5, max: 240 }), async (sizes, timeouts, itemS) => {
        const t = new Taker(new SetServer(sizes))
        t.itemS = itemS
        t.act = (_v, n) => (timeouts[n] === true && n % 3 === 0 ? null : 0)
        const end = await t.play()
        expect(end.ended).toBe('complete')
        const shown = t.shown().map(placeOf)
        // whole passages, in order, each question once
        const passages = [...new Set(shown.map((s) => s.passage))]
        expect(passages).toEqual(passages.map((_, i) => i))
        for (const p of passages) expect(shown.filter((s) => s.passage === p).map((s) => s.q)).toEqual(Array.from({ length: sizes[p]! }, (_, q) => q))
        const answered = t.server.answers.filter((a) => a.response !== null).length
        // before the last passage the part was still short of its answers, of its passages, or of both
        const before = shown.filter((s) => s.passage !== passages[passages.length - 1]).length
        expect(answered >= PUBLISH_MIN_ITEMS || shown.length >= PUBLISH_MIN_ITEMS + MIN_ITEMS_SLACK).toBe(true)
        expect(before < PUBLISH_MIN_ITEMS + MIN_ITEMS_SLACK || passages.length <= RC_PASSAGES).toBe(true)
        expect(t.server.served.length).toBe(shown.length)
      }),
      { numRuns: 60 },
    )
  })
})
