/**
 * The session run with the CAT parts served by the server (ROADMAP M2.7; DESIGN §11.2, R-11.1):
 * the run waits for each item, keeps every answer until the server has it, never learns a verdict,
 * and records the served part as an unsigned session with the server's id. The server is a fake
 * `CatSource`; `backend/` and the database tests cover the real one.
 */

import { describe, expect, it } from 'vitest'
import { BackendError } from '../backend/errors'
import { toServedItem, type ServedItem } from '../backend/items'
import type { CatAnswer, CatNext, CatSource } from '../backend/session'
import type { AxisCode } from '../engine/axes'
import { TEST_DEVICE } from './bot'
import { SessionRun, servedResponseFits, type RunView } from './run'

/** Let pending promise callbacks run. */
const settle = async (): Promise<void> => {
  for (let i = 0; i < 10; i++) await Promise.resolve()
}

function served(n: number, over: Partial<ServedItem> = {}): ServedItem {
  return {
    seq: n,
    item_id: `i:series:1.0.0:${n}`,
    item_type: 'series',
    family: 'series',
    spec: { input_format: 'integer', terms: [1, 2, 3] },
    time_limit_s: 120,
    supported: true,
    ...over,
  }
}

type Step = CatNext | Error | 'hang'

/** A fake server: a script of replies to `next`, a log of what it was asked and given. */
class FakeCat implements CatSource {
  readonly sessionId = 's_SERVERSESSION01'
  readonly asked: (readonly AxisCode[])[] = []
  readonly answers: CatAnswer[] = []
  readonly order: string[] = []
  steps: Step[] = []
  failAnswers = 0
  private hung: ((r: CatNext) => void)[] = []

  next(axes: readonly AxisCode[]): Promise<CatNext> {
    this.asked.push(axes)
    this.order.push('next')
    const step = this.steps.shift()
    if (step === undefined) return Promise.resolve({ kind: 'done', reason: 'axes_done' })
    if (step === 'hang') return new Promise((resolve) => this.hung.push(resolve))
    if (step instanceof Error) return Promise.reject(step)
    return Promise.resolve(step)
  }

  /** Answers a `next` that is hanging. */
  release(r: CatNext): void {
    this.hung.shift()?.(r)
  }

  answer(a: CatAnswer): Promise<void> {
    if (this.failAnswers > 0) {
      this.failAnswers--
      this.order.push('answer-failed')
      return Promise.reject(new BackendError('network', 'network_error'))
    }
    this.answers.push(a)
    this.order.push('answer')
    return Promise.resolve()
  }
}

class Harness {
  t = 0
  readonly cat = new FakeCat()
  readonly run: SessionRun
  constructor(over: { focus?: readonly AxisCode[]; cat?: CatSource | undefined } = {}) {
    this.run = new SessionRun({
      sessionId: 's_LOCALSESSION001',
      startedMs: 1_790_000_000_000,
      now: () => this.t,
      device: TEST_DEVICE,
      rtInput: 'keyboard',
      cat: 'cat' in over ? over.cat : this.cat,
      ...(over.focus === undefined ? {} : { focus: over.focus }),
    })
  }
  v(): RunView {
    return this.run.view()
  }
  /** Skip the reaction-time part and start Matrix & Series. */
  async toMatrix(): Promise<void> {
    this.run.skipAxis('RT')
    expect(this.v().segment?.id).toBe('matrix_series')
    this.run.startSegment()
    await settle()
  }
  /** Answer the item on screen and give the confidence. */
  answerOnScreen(response: unknown = '4', confidence = 60, seconds = 5): void {
    this.run.itemShown(this.t)
    this.t += seconds * 1000
    this.run.itemResponded(response)
    expect(this.v().phase).toBe('confidence')
    this.run.confirmConfidence(confidence)
  }
}

describe('a served part', () => {
  it('waits in the loading phase, with the clock stopped, until the server hands over an item', async () => {
    const h = new Harness()
    h.cat.steps = ['hang']
    await h.toMatrix()
    expect(h.v().phase).toBe('loading')
    expect(h.v().served).toBe(true)
    expect(h.v().problem).toBeNull()
    const before = h.v().elapsedS
    h.t += 30_000
    expect(h.v().elapsedS).toBe(before) // waiting for the network is not working
    h.cat.release({ kind: 'item', item: served(1) })
    await settle()
    expect(h.v().phase).toBe('item')
    expect(h.v().item).toMatchObject({ item_id: 'i:series:1.0.0:1', family: 'series', axis: 'MAT', time_limit_s: 120 })
    h.t += 10_000
    expect(h.v().elapsedS).toBe(before + 10) // and runs again once it is up
  })

  it('asks for the axes of the part that runs', async () => {
    const h = new Harness()
    h.cat.steps = [{ kind: 'item', item: served(1) }]
    await h.toMatrix()
    expect(h.cat.asked).toEqual([['MAT']])
  })

  it('hands an answer over after the confidence is given, then asks for the next item (answer first)', async () => {
    const h = new Harness()
    h.cat.steps = [{ kind: 'item', item: served(1) }, { kind: 'item', item: served(2) }]
    await h.toMatrix()
    h.answerOnScreen('42', 70, 6)
    await settle()
    expect(h.cat.order).toEqual(['next', 'answer', 'next'])
    expect(h.cat.answers).toHaveLength(1)
    expect(h.cat.answers[0]).toMatchObject({ response: '42', rtMs: 6000, confidence: 70, flags: {} })
    expect(h.cat.answers[0]!.item.item_id).toBe('i:series:1.0.0:1')
    expect(h.v().phase).toBe('item')
    expect(h.v().item?.item_id).toBe('i:series:1.0.0:2')
  })

  it('never learns whether an answer was right: the tuple has no verdict and nothing is scored here', async () => {
    const h = new Harness()
    h.cat.steps = [{ kind: 'item', item: served(1) }]
    await h.toMatrix()
    h.answerOnScreen('42')
    const cat = h.run.catSessionState()
    expect(cat?.sessionId).toBe('s_SERVERSESSION01')
    expect(cat?.responses).toEqual([['i:series:1.0.0:1', 0, '42', null, 5000, 60]])
    expect(cat?.seenItems).toEqual(['i:series:1.0.0:1'])
    expect(h.run.sessionState().responses).toEqual([]) // the local session holds the timed tasks only
    expect(h.run.result().observations).toEqual([]) // no observation for a served answer
    expect(h.run.result().itemsByAxis).toEqual({ MAT: 1 })
    expect(h.v().counts.items).toBe(1)
  })

  it('records a time-out as a null answer at the item limit', async () => {
    const h = new Harness()
    h.cat.steps = [{ kind: 'item', item: served(1, { time_limit_s: 20 }) }]
    await h.toMatrix()
    h.run.itemShown(h.t)
    h.t += 21_000
    h.run.tick()
    await settle()
    expect(h.cat.answers[0]).toMatchObject({ response: null, rtMs: 20_000, confidence: null })
    expect(h.run.catSessionState()?.responses[0]).toEqual(['i:series:1.0.0:1', 0, null, null, 20_000, null])
    expect(h.v().notice).toMatchObject({ kind: 'timeout', served: true }) // the server leaves it out of the scores: the notice says so
  })

  it('refuses a response a renderer could not have given', async () => {
    const h = new Harness()
    h.cat.steps = [{ kind: 'item', item: served(1) }]
    await h.toMatrix()
    h.run.itemResponded({ not: 'text' })
    expect(h.v().phase).toBe('item')
    expect(h.v().notice?.kind).toBe('malformed')
    expect(servedResponseFits(served(1), 'x'.repeat(300))).toBe(false)
    expect(servedResponseFits(served(1, { options_count: 4, family: 'matrices' }), 3)).toBe(true)
    expect(servedResponseFits(served(1, { options_count: 4, family: 'matrices' }), 4)).toBe(false)
    expect(servedResponseFits(served(1, { options_count: 4, family: 'matrices' }), 1.5)).toBe(false)
    expect(servedResponseFits(served(1, { options_count: 4, family: 'matrices' }), '1')).toBe(false)
  })

  it('ends the part when the server says the axis is done or nothing is left', async () => {
    const h = new Harness()
    h.cat.steps = [{ kind: 'done', reason: 'axes_done' }]
    await h.toMatrix()
    expect(h.v().segment?.id).toBe('spatial')
    expect(h.v().phase).toBe('interstitial')
    expect(h.run.result().segmentEnds).toEqual([{ segment: 'matrix_series', reason: 'axes_done' }])
    h.run.startSegment()
    h.cat.steps = [{ kind: 'done', reason: 'no_items' }]
    await settle()
    expect(h.run.result().segmentEnds.at(-1)).toEqual({ segment: 'spatial', reason: 'exhausted' })
  })

  it('shows a connection problem, keeps waiting, and asks again when told to', async () => {
    const h = new Harness()
    h.cat.steps = [new BackendError('network', 'network_error'), { kind: 'item', item: served(1) }]
    await h.toMatrix()
    expect(h.v().phase).toBe('loading')
    expect(h.v().problem).toBe('offline')
    h.t += 60_000
    expect(h.v().elapsedS).toBe(0) // still stopped
    h.run.retryLoad()
    expect(h.v().problem).toBeNull()
    await settle()
    expect(h.v().phase).toBe('item')
  })

  it.each([
    [new BackendError('limited', 'too_fast', { status: 429 }), 'pace'],
    [new BackendError('limited', 'rate_limited', { status: 429 }), 'busy'],
    [new BackendError('auth', 'invalid_session', { status: 401 }), 'ended'],
    [new BackendError('conflict', 'session_finished', { status: 409 }), 'ended'],
    [new BackendError('server', 'server_error', { status: 503 }), 'offline'],
  ] as const)('tells %s apart: %s', async (error, problem) => {
    const h = new Harness()
    h.cat.steps = [error]
    await h.toMatrix()
    expect(h.v().problem).toBe(problem)
  })

  it('does not retry a session that has ended on the server', async () => {
    const h = new Harness()
    h.cat.steps = [new BackendError('auth', 'invalid_session', { status: 401 }), { kind: 'item', item: served(1) }]
    await h.toMatrix()
    h.run.retryLoad()
    await settle()
    expect(h.v().phase).toBe('loading')
    expect(h.v().problem).toBe('ended')
  })

  it('keeps an answer the server did not take and sends it again before asking for anything else', async () => {
    const h = new Harness()
    h.cat.steps = [{ kind: 'item', item: served(1) }, { kind: 'item', item: served(2) }]
    await h.toMatrix()
    h.cat.failAnswers = 2 // the send that starts at once (the request waits for it) and the first retry both fail
    h.answerOnScreen('7')
    await settle()
    expect(h.v().phase).toBe('loading')
    expect(h.v().problem).toBe('offline')
    expect(h.run.unsentAnswers).toBe(1)
    h.run.retryLoad()
    await settle()
    expect(h.v().problem).toBe('offline') // the second failure
    expect(h.run.unsentAnswers).toBe(1)
    h.run.retryLoad()
    await settle()
    expect(h.cat.answers.map((a) => a.response)).toEqual(['7'])
    expect(h.run.unsentAnswers).toBe(0)
    expect(h.v().phase).toBe('item')
    expect(h.v().item?.item_id).toBe('i:series:1.0.0:2')
  })

  it('lets go of an item that is on screen when its part is skipped (the server needs it closed)', async () => {
    const h = new Harness()
    h.cat.steps = [{ kind: 'item', item: served(1) }]
    await h.toMatrix()
    h.run.skipAxis()
    await settle()
    expect(h.cat.answers).toEqual([expect.objectContaining({ response: null, release: 'skipped' })])
    expect(h.run.catSessionState()).toBeNull() // a released item is not an answer
    expect(h.v().segment?.id).toBe('spatial')
  })

  it('keeps the answer waiting for its confidence when the part is skipped, and lets nothing else go', async () => {
    const h = new Harness()
    h.cat.steps = [{ kind: 'item', item: served(1) }]
    await h.toMatrix()
    h.run.itemShown(h.t)
    h.t += 4000
    h.run.itemResponded('9')
    h.run.skipAxis()
    await settle()
    expect(h.cat.answers).toHaveLength(1)
    expect(h.cat.answers[0]).toMatchObject({ response: '9', confidence: null })
    expect(h.cat.answers[0]!.release).toBeUndefined()
    expect(h.run.catSessionState()?.responses).toEqual([['i:series:1.0.0:1', 0, '9', null, 4000, null]])
  })

  it('ignores the reply of a request that was abandoned by a skip', async () => {
    const h = new Harness()
    h.cat.steps = ['hang']
    await h.toMatrix()
    h.run.skipAxis()
    expect(h.v().segment?.id).toBe('spatial')
    h.cat.release({ kind: 'item', item: served(1) })
    await settle()
    expect(h.v().phase).toBe('interstitial')
    expect(h.v().item).toBeNull()
  })

  it('finishes early while waiting, and a late reply changes nothing', async () => {
    const h = new Harness()
    h.cat.steps = ['hang']
    await h.toMatrix()
    h.run.finishEarly()
    expect(h.v().phase).toBe('finished')
    h.cat.release({ kind: 'item', item: served(1) })
    await settle()
    expect(h.v().phase).toBe('finished')
    expect(h.v().item).toBeNull()
  })

  it('offers the skip for an item no renderer can draw, and releases it as unavailable', async () => {
    const h = new Harness()
    h.cat.steps = [{ kind: 'item', item: toServedItem(1, { itemId: 'i:fin:1.0.0:x', itemType: 'mc', timeLimitS: 60, stem: 'A stem', media: null, options: ['a', 'b'] }) }]
    await h.toMatrix()
    expect(h.v().phase).toBe('item')
    expect(h.v().unavailable).toBe(true)
    expect(h.v().notice?.kind).toBe('unsupported')
    h.t += 500_000 // no time-out for what could not be shown
    h.run.tick()
    expect(h.v().phase).toBe('item')
    h.run.skipAxis()
    await settle()
    expect(h.cat.answers[0]).toMatchObject({ response: null, release: 'unavailable' })
  })

  it('lets go of an item left pending by another part and asks again', async () => {
    const h = new Harness()
    h.cat.steps = [{ kind: 'item', item: served(1, { family: 'rotation', item_id: 'i:rot:1.0.0:1', spec: {} }) }, { kind: 'item', item: served(2) }]
    await h.toMatrix()
    expect(h.cat.answers).toEqual([expect.objectContaining({ release: 'skipped', response: null })])
    expect(h.v().item?.item_id).toBe('i:series:1.0.0:2')
  })

  it('reports a paste and a long absence of the page with the answer', async () => {
    const h = new Harness()
    h.cat.steps = [{ kind: 'item', item: served(1) }]
    await h.toMatrix()
    h.run.itemShown(h.t)
    h.t += 1000
    h.run.noteVisibility('hidden')
    h.t += 15_000
    h.run.noteVisibility('visible')
    h.run.notePaste('i:series:1.0.0:1')
    h.t += 1000
    h.run.itemResponded('3')
    h.run.confirmConfidence(50)
    await settle()
    expect(h.cat.answers[0]!.flags).toEqual({ visibility_hidden: true, paste: true })
    expect(h.run.serverFlags()).toMatchObject({ visibility_hidden_s: 15, paste_events: 1 })
  })

  it('does not flag a short absence', async () => {
    const h = new Harness()
    h.cat.steps = [{ kind: 'item', item: served(1) }]
    await h.toMatrix()
    h.run.itemShown(h.t)
    h.run.noteVisibility('hidden')
    h.t += 4000
    h.run.noteVisibility('visible')
    h.t += 1000
    h.run.itemResponded('3')
    h.run.confirmConfidence(50)
    await settle()
    expect(h.cat.answers[0]!.flags).toEqual({})
  })

  it('stops a part on its time once the coverage floor is met, not before', async () => {
    const h = new Harness()
    // budget of the part: (target - elapsed - blocks still to run) / CAT parts left
    h.cat.steps = Array.from({ length: 30 }, (_, i): Step => ({ kind: 'item', item: served(i + 1) }))
    await h.toMatrix()
    let answered = 0
    while (h.v().segment?.id === 'matrix_series' && answered < 25) {
      if (h.v().phase !== 'item') break
      h.answerOnScreen('1', 50, 400) // slow: 400 s each, the budget is gone after the first
      answered++
      await settle()
    }
    expect(answered).toBe(3) // the floor of 3 items per axis, then the part's time ends it
    expect(h.run.result().segmentEnds[0]).toEqual({ segment: 'matrix_series', reason: 'time' })
  })

  it('has the flags the server takes: counters and what the person chose', async () => {
    const h = new Harness()
    h.cat.steps = []
    h.run.skipAxis('RT')
    h.run.finishEarly()
    const f = h.run.serverFlags()
    expect(f).toMatchObject({ visibility_hidden_s: 0, paste_events: 0, skipped_rt: true, finished_early: true })
    for (const [k, v] of Object.entries(f)) {
      expect(k).toMatch(/^[a-z][a-z0-9_]{0,63}$/u)
      expect(['number', 'boolean']).toContain(typeof v)
    }
  })
})

describe('the static run is untouched', () => {
  it('has no served part, no problem and nothing to send', () => {
    const h = new Harness({ cat: undefined })
    expect(h.v().served).toBe(false)
    expect(h.v().problem).toBeNull()
    expect(h.v().reportable).toBeNull()
    expect(h.run.catSessionState()).toBeNull()
    expect(h.run.unsentAnswers).toBe(0)
    return expect(h.run.flushAnswers()).resolves.toBeUndefined()
  })
})

describe('the item the person may report', () => {
  it('is the served item on screen, and only while it is there', async () => {
    const h = new Harness()
    h.cat.steps = ['hang']
    await h.toMatrix()
    expect(h.v().reportable).toBeNull()
    h.cat.release({ kind: 'item', item: served(1) })
    await settle()
    expect(h.v().reportable).toBe('i:series:1.0.0:1')
    h.run.itemShown(h.t)
    h.run.itemResponded('2')
    expect(h.v().reportable).toBe('i:series:1.0.0:1')
  })
})
