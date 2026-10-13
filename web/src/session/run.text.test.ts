/**
 * The served text parts in the session run (ROADMAP M3.11 phase 1; DESIGN §3, §7.4, §10, §11.2, R-11.1):
 * a part for Logical Reasoning, Vocabulary and the three knowledge skills, only with a server, only for
 * the skills the build names, and only when the server has questions for the skill. The server here is
 * a fake with a pool per skill and the real rule of a pending item (it is served again until it is
 * answered or let go); `scripts/db/text-mc.db.test.ts` plays the same against the real database.
 *
 * The first block of tests is the one the live site depends on: **a pool without these skills gives the
 * six-part session, unchanged**, whether or not the build asks for them.
 */

import fc from 'fast-check'
import { describe, expect, it } from 'vitest'
import { BackendError } from '../backend/errors'
import { toServedItem, type ServedItem } from '../backend/items'
import type { CatAnswer, CatNext, CatSource } from '../backend/session'
import type { AxisCode } from '../engine/axes'
import { A15_PLANNED_S, MIN_ITEMS_SLACK, PUBLISH_MIN_ITEMS, QUANT_EXTRA_S, QUANT_MIN_ITEMS, TEXT_AXES, TEXT_PARTS, textPartOf } from '../engine/plan-table'
import { createRng } from '../engine/prng'
import { demoTextItem } from '../render/text/demo'
import { TEXT_MC_RENDERER } from '../render/text/spec'
import { answerBlock } from '../sim/responders'
import { getFamily, resolveItem } from '../tasks/registry'
import { TEST_DEVICE } from './bot'
import { SessionRun, type RunConfig, type RunView } from './run'

/** Let pending promise callbacks run. */
const settle = async (): Promise<void> => {
  for (let i = 0; i < 20; i++) await Promise.resolve()
}

const A15_CAT: readonly AxisCode[] = ['MAT', 'SPA', 'QR']

/** A served item of `axis`: a made-up text question for a text skill, a typed-entry stand-in for an A15 one. */
function itemOf(axis: AxisCode, n: number, seq: number): ServedItem {
  if (textPartOf(axis) !== undefined) {
    const demo = demoTextItem(n)
    return toServedItem(seq, { itemId: `i:tst:${axis.toLowerCase()}:${n}`, itemType: 'mc_text', timeLimitS: 180, stem: demo.payload.stem, media: null, options: demo.payload.options })
  }
  const family = axis === 'MAT' ? 'series' : axis === 'SPA' ? 'rotation' : 'quant'
  return { seq, item_id: `i:${family}:1.0.0:${axis.toLowerCase()}${n}`, item_type: family, family, spec: {}, time_limit_s: 180, supported: true, ...(axis === 'SPA' ? { options_count: 4 } : {}) }
}

/** A fake server with a pool per skill and one pending item at a time, as `hb.serve_next` has. */
class PoolServer implements CatSource {
  readonly sessionId = 's_SERVERSESSION01'
  readonly asked: (readonly AxisCode[])[] = []
  readonly answers: CatAnswer[] = []
  readonly served: { axis: AxisCode; item: ServedItem }[] = []
  pending: { axis: AxisCode; item: ServedItem } | null = null
  /** Errors for the next `next` calls, in order. */
  failures: Error[] = []
  /** While set, `next` waits for it. */
  gate: Promise<void> | null = null
  /** The gate holds only requests for this skill (default: all). */
  gateFor: AxisCode | null = null
  private n = 0

  constructor(readonly pool: Partial<Record<AxisCode, number>>) {}

  async next(axes: readonly AxisCode[]): Promise<CatNext> {
    this.asked.push([...axes])
    if (this.gate !== null && (this.gateFor === null || axes.includes(this.gateFor))) await this.gate
    const f = this.failures.shift()
    if (f !== undefined) throw f
    if (this.pending !== null) return { kind: 'item', item: this.pending.item }
    for (const k of axes) {
      const left = this.pool[k] ?? 0
      if (left <= 0) continue
      this.pool[k] = left - 1
      this.pending = { axis: k, item: itemOf(k, this.n++, this.served.length + 1) }
      this.served.push(this.pending)
      return { kind: 'item', item: this.pending.item }
    }
    return { kind: 'done', reason: 'no_items' }
  }

  answer(a: CatAnswer): Promise<void> {
    this.answers.push(a)
    if (this.pending?.item.item_id === a.item.item_id) this.pending = null
    return Promise.resolve()
  }

  /** How many calls asked for exactly this skill. */
  askedFor(axis: AxisCode): number {
    return this.asked.filter((a) => a.length === 1 && a[0] === axis).length
  }

  answered(axis: AxisCode): CatAnswer[] {
    const ids = new Set(this.served.filter((s) => s.axis === axis).map((s) => s.item.item_id))
    return this.answers.filter((a) => ids.has(a.item.item_id))
  }
}

interface Step {
  readonly phase: string
  readonly segment: string | null
  readonly probing: boolean
  readonly targetS: number
  readonly minutes: number | null
  readonly elapsedS: number
  readonly item: string | null
  readonly notice: string | null
  readonly segments: string
  readonly breakBefore: string | null
}

/** A taker for a served session: real blocks (the sim responders), a well-formed answer to every served question. */
class Taker {
  t = 0
  readonly run: SessionRun
  readonly trace: Step[] = []
  readonly rng = createRng('taker')
  /** Seconds per served question (before the confidence). */
  itemS = 40
  /** What to answer; null leaves the question to run out of time. */
  respond: (v: RunView) => unknown | null = (v) => (v.item!.options_count === undefined ? '4' : 0)

  constructor(
    readonly server: PoolServer,
    cfg: Partial<RunConfig> = {},
  ) {
    this.run = new SessionRun({ sessionId: 's_LOCALSESSION001', startedMs: 1_790_000_000_000, now: () => this.t, device: TEST_DEVICE, rtInput: 'keyboard', cat: server, ...cfg })
  }

  v(): RunView {
    return this.run.view()
  }

  private note(v: RunView): void {
    this.trace.push({
      phase: v.phase,
      segment: v.segment?.id ?? null,
      probing: v.probing,
      targetS: v.targetS,
      minutes: v.phase === 'interstitial' ? (v.segment?.minutes ?? null) : null,
      elapsedS: v.elapsedS,
      item: v.item?.item_id ?? null,
      notice: v.notice?.kind ?? null,
      segments: v.segments.map((s) => `${s.id}:${s.status}`).join(' '),
      breakBefore: v.breakBefore,
    })
  }

  /** One thing a person would do; false once the session has finished. */
  async step(): Promise<boolean> {
    this.run.tick()
    const v = this.v()
    this.note(v)
    switch (v.phase) {
      case 'finished':
        return false
      case 'interstitial':
        this.run.startSegment()
        break
      case 'block': {
        const blk = v.block!
        const a = answerBlock(getFamily(blk.family)!, resolveItem(blk.item_id)!, 0, this.rng.fork(`block/${blk.family}`))
        this.t += a.timeS * 1000
        if (blk.family.startsWith('rt_')) this.run.blockInputType('keyboard')
        this.run.blockResponded(a.response)
        break
      }
      case 'item': {
        this.run.itemShown(this.t)
        const r = this.respond(v)
        if (r === null) {
          this.t += (v.item!.time_limit_s + 1) * 1000
          this.run.tick()
        } else {
          this.t += this.itemS * 1000
          this.run.itemResponded(r)
        }
        break
      }
      case 'confidence':
        this.t += 2000
        this.run.confirmConfidence(v.confidence!.startPct)
        break
      case 'loading':
        if (v.problem !== null) throw new Error(`the wait failed: ${v.problem}`)
        break
      case 'break_offer':
        this.run.declineBreak()
        break
      case 'on_break':
        this.run.resume()
        break
    }
    await settle()
    return true
  }

  async until(done: (v: RunView) => boolean, max = 3000): Promise<RunView> {
    for (let i = 0; i < max; i++) {
      await settle()
      const v = this.v()
      if (done(v)) return v
      if (!(await this.step())) return this.v()
    }
    throw new Error(`condition not met (phase ${this.run.phase})`)
  }

  async finish(): Promise<SessionRun> {
    await this.until((v) => v.phase === 'finished')
    return this.run
  }
}

const bigPool = (axes: readonly AxisCode[]): Partial<Record<AxisCode, number>> => Object.fromEntries(axes.map((k) => [k, 500]))

/** What a finished run leaves behind, for comparing two runs. */
function outcome(t: Taker): unknown {
  const r = t.run.result()
  return {
    reason: r.reason,
    durationS: r.durationS,
    itemsByAxis: r.itemsByAxis,
    budgets: r.budgets,
    segmentEnds: r.segmentEnds,
    blocks: r.blocks,
    flags: t.run.sessionState().flags,
    serverFlags: t.run.serverFlags(),
    catState: t.run.catSessionState(),
    served: t.server.served.map((s) => s.item.item_id),
    answers: t.server.answers,
  }
}

describe('a pool without the text skills gives the six-part session, unchanged (the live site today)', () => {
  it('without the setting: no text part is planned, and the server is never asked for a text skill', async () => {
    const t = new Taker(new PoolServer(bigPool(A15_CAT)))
    expect(t.v().segments.map((s) => s.id)).toEqual(['rt', 'matrix_series', 'spatial', 'memory', 'quant', 'coding_reading'])
    expect(t.v().targetS).toBe(A15_PLANNED_S)
    await t.finish()
    expect(t.server.asked.every((a) => a.length === 1 && A15_CAT.includes(a[0]!))).toBe(true)
    expect(t.trace.some((s) => s.probing)).toBe(false)
  })

  it('with the setting on and nothing in the pool: every screen a person sees, every budget, every answer and every flag is the same', async () => {
    const plain = new Taker(new PoolServer(bigPool(A15_CAT)))
    await plain.finish()
    const asked = new Taker(new PoolServer(bigPool(A15_CAT)), { textAxes: TEXT_AXES })
    await asked.finish()

    // What the person sees: the same screens in the same order, with the same times on them. The only extra
    // steps are the waits that name no part ("One moment"), and they add nothing to the session's clock.
    const seen = (t: Taker): unknown[] => t.trace.filter((s) => !s.probing).map((s) => ({ phase: s.phase, segment: s.segment, minutes: s.minutes, elapsedS: s.elapsedS, item: s.item, notice: s.notice }))
    expect(seen(asked)).toEqual(seen(plain))
    expect(outcome(asked)).toEqual(outcome(plain))

    // One question to the server per text skill, and no more.
    for (const k of TEXT_AXES) expect(asked.server.askedFor(k), k).toBe(1)
    // No text part was ever announced, listed as skipped, or left a flag.
    expect(asked.trace.filter((s) => s.phase === 'interstitial').map((s) => s.segment)).toEqual(['rt', 'matrix_series', 'spatial', 'memory', 'quant', 'coding_reading'])
    expect(asked.run.result().skipped).toEqual([])
    expect(Object.keys(asked.run.sessionState().flags).filter((f) => /logical|vocab|knowledge|_lr|_voc|_kst|_khu|_kap/u.test(f))).toEqual([])
    // By the end the plan is the six parts, and its target the six parts' target.
    const end = asked.v()
    expect(end.segments.map((s) => s.id)).toEqual(['rt', 'matrix_series', 'spatial', 'memory', 'quant', 'coding_reading'])
    expect(end.targetS).toBe(A15_PLANNED_S)
    expect(end.breakBefore).toBe(plain.v().breakBefore)
  })

  it('the wait before a text part names no part and no skill, and offers no skip', async () => {
    const server = new PoolServer(bigPool(A15_CAT))
    let open!: () => void
    const t = new Taker(server, { textAxes: ['LR'], skipped: ['RT'] })
    server.gateFor = 'LR'
    server.gate = new Promise<void>((resolve) => (open = resolve))
    // Finish the Matrix & Series part: the next thing is the question whether Logical Reasoning exists.
    await t.until((v) => v.phase === 'loading' && v.probing)
    const v = t.v()
    expect(v.probing).toBe(true)
    expect(v.skippable).toBeNull()
    expect(v.clockHeld).toBe(true)
    expect(v.segments.find((s) => s.id === 'logical_reasoning')?.status).toBe('upcoming')
    const before = v.elapsedS
    t.t += 60_000
    expect(t.v().elapsedS).toBe(before) // the wait is not on the session clock
    server.gate = null
    open()
    await settle()
    expect(t.v().phase).toBe('interstitial')
    expect(t.v().segment?.id).toBe('spatial')
    expect(t.v().segments.some((s) => s.id === 'logical_reasoning')).toBe(false)
    expect(t.v().notice).toBeNull()
  })

  it('whatever the server lacks, the six parts get the budgets they have without text parts', async () => {
    await fc.assert(
      fc.asyncProperty(fc.subarray([...TEXT_AXES]), fc.subarray([...TEXT_AXES]), fc.integer({ min: 15, max: 90 }), async (asked, present, itemS) => {
        const plain = new Taker(new PoolServer(bigPool(A15_CAT)))
        plain.itemS = itemS
        await plain.finish()
        const t = new Taker(new PoolServer(bigPool([...A15_CAT, ...present])), { textAxes: asked })
        t.itemS = itemS
        await t.finish()
        // To the microsecond: with a text part in between, the same seconds are reached by another sum of floats.
        const base = (x: Taker) => x.run.result().budgets.filter((b) => ['matrix_series', 'spatial', 'quant'].includes(b.segment))
        expect(base(t).map((b) => [b.segment, b.plannedS])).toEqual(base(plain).map((b) => [b.segment, b.plannedS]))
        base(t).forEach((b, i) => expect(b.budgetS).toBeCloseTo(base(plain)[i]!.budgetS, 6))
        const a15 = (x: Taker): unknown => Object.fromEntries(A15_CAT.map((k) => [k, x.run.result().itemsByAxis[k]]))
        expect(a15(t)).toEqual(a15(plain))
        // A text part ran exactly when it was both asked for and in the pool.
        const ran = TEXT_AXES.filter((k) => (t.run.result().itemsByAxis[k] ?? 0) > 0)
        const due = TEXT_AXES.filter((k) => asked.includes(k) && present.includes(k))
        // A slow taker with every part can reach the 57-minute hard stop before the last parts: then some are not reached.
        if (t.run.result().reason === 'hard_stop') expect(due).toEqual(expect.arrayContaining(ran))
        else expect(ran).toEqual(due)
      }),
      { numRuns: 12 },
    )
  })
})

describe('a text part the server has questions for', () => {
  it('is announced with its own share, then shows the question that was fetched before its "Up next" screen', async () => {
    const server = new PoolServer(bigPool([...A15_CAT, 'LR']))
    const t = new Taker(server, { textAxes: ['LR'], skipped: ['RT'] })
    const v = await t.until((x) => x.phase === 'interstitial' && x.segment?.id === 'logical_reasoning')
    expect(v.segment).toMatchObject({ title: 'Logical Reasoning', kind: 'cat', axes: ['LR'], minutes: 5 })
    expect(v.targetS).toBe(A15_PLANNED_S + 300)
    expect(v.clockHeld).toBe(true)
    // The question is the server's pending item, kept for Start: nothing was asked twice.
    expect(server.askedFor('LR')).toBe(1)
    const held = server.pending!.item.item_id
    t.run.startSegment()
    await settle()
    expect(t.v().phase).toBe('item')
    expect(t.v().item).toMatchObject({ item_id: held, family: TEXT_MC_RENDERER, axis: 'LR', options_count: 4, time_limit_s: 180 })
    expect(server.askedFor('LR')).toBe(1)
    expect(t.v().reportable).toBe(held) // the same "report a problem" as any served question
    expect(t.v().skippable).toBe('LR')
  })

  it('takes the answer as an option position, with the confidence slider of a multiple-choice question, and never a verdict', async () => {
    const server = new PoolServer(bigPool(['LR']))
    const t = new Taker(server, { textAxes: ['LR'], skipped: ['RT', 'MAT', 'SPA', 'WM', 'QR', 'PS'] })
    await t.until((x) => x.phase === 'interstitial')
    t.run.startSegment()
    await settle()
    t.run.itemShown(t.t)
    t.t += 30_000
    t.run.itemResponded('B') // a renderer never sends this
    expect(t.v().notice?.kind).toBe('malformed')
    t.run.itemResponded(4) // nor a position that is not there
    expect(t.v().phase).toBe('item')
    t.run.itemResponded(2)
    expect(t.v().phase).toBe('confidence')
    expect(t.v().confidence).toEqual({ floorPct: 25, startPct: expect.any(Number), optionsCount: 4 })
    t.run.confirmConfidence(80)
    await settle()
    expect(server.answers[0]).toMatchObject({ response: 2, rtMs: 30_000, confidence: 80 })
    const state = t.run.catSessionState()!
    expect(state.responses[0]).toEqual([server.served[0]!.item.item_id, 0, 2, null, 30_000, 80])
    expect(JSON.stringify(t.v())).not.toMatch(/"key"|"correct"|"index"/u)
  })

  it('goes on past its share until five questions are answered, and stops on its share once they are', async () => {
    const server = new PoolServer(bigPool(['VOC']))
    const t = new Taker(server, { textAxes: ['VOC'], skipped: ['RT', 'MAT', 'SPA', 'WM', 'QR', 'PS'] })
    t.itemS = 100 // one question takes most of the two-minute share
    await t.finish()
    expect(t.run.result().itemsByAxis.VOC).toBe(PUBLISH_MIN_ITEMS)
    expect(t.run.result().segmentEnds).toEqual([{ segment: 'vocabulary', reason: 'time' }])

    const quick = new Taker(new PoolServer(bigPool(['VOC'])), { textAxes: ['VOC'], skipped: ['RT', 'MAT', 'SPA', 'WM', 'QR', 'PS'] })
    quick.itemS = 10 // 12 s a question with the slider: ten fit in two minutes
    await quick.finish()
    expect(quick.run.result().itemsByAxis.VOC).toBe(10)
  })

  it('shows at most two more than five when questions run out of time, then lets the part end', async () => {
    const server = new PoolServer(bigPool(['KST']))
    const t = new Taker(server, { textAxes: ['KST'], skipped: ['RT', 'MAT', 'SPA', 'WM', 'QR', 'PS'] })
    t.respond = () => null // every question runs out of time
    await t.finish()
    expect(t.run.result().itemsByAxis.KST).toBe(PUBLISH_MIN_ITEMS + MIN_ITEMS_SLACK)
    expect(server.answers.every((a) => a.response === null)).toBe(true)
  })

  it('the Quantitative part has the same rule online: six answered, at most two more shown, and the server running out still ends it (A15 amended 2026-10-12)', async () => {
    const only = { skipped: ['RT', 'MAT', 'SPA', 'WM', 'PS'] as AxisCode[], targetS: 60 } // a minute of shared time, and the part's own minute
    const slow = new Taker(new PoolServer(bigPool(['QR'])), only)
    expect(slow.v().targetS).toBe(60 + QUANT_EXTRA_S)
    slow.itemS = 100
    await slow.finish()
    expect(slow.run.result().itemsByAxis.QR).toBe(QUANT_MIN_ITEMS)
    expect(slow.server.answered('QR').filter((a) => a.response !== null)).toHaveLength(QUANT_MIN_ITEMS)
    expect(slow.run.result().segmentEnds).toEqual([{ segment: 'quant', reason: 'time' }])
    expect(slow.run.result().budgets).toEqual([{ segment: 'quant', plannedS: 60 + QUANT_EXTRA_S, budgetS: 60 + QUANT_EXTRA_S }])

    // One time-out: a seventh question makes up for it.
    const one = new Taker(new PoolServer(bigPool(['QR'])), only)
    one.itemS = 100
    let n = 0
    one.respond = () => (n++ === 2 ? null : '4')
    await one.finish()
    expect(one.run.result().itemsByAxis.QR).toBe(QUANT_MIN_ITEMS + 1)
    expect(one.server.answered('QR').filter((a) => a.response !== null)).toHaveLength(QUANT_MIN_ITEMS)

    // Every question runs out of time: eight are shown, then the part ends.
    const none = new Taker(new PoolServer(bigPool(['QR'])), only)
    none.respond = () => null
    await none.finish()
    expect(none.run.result().itemsByAxis.QR).toBe(QUANT_MIN_ITEMS + MIN_ITEMS_SLACK)
    expect(none.run.result().reason).toBe('complete')

    // The server has four: the part ends there, as any served part does.
    const short = new Taker(new PoolServer({ QR: 4 }), only)
    await short.finish()
    expect(short.run.result().itemsByAxis.QR).toBe(4)
    expect(short.run.result().segmentEnds).toEqual([{ segment: 'quant', reason: 'exhausted' }])

    // With time to spare it is the time that ends the part, as before: more than six.
    const quick = new Taker(new PoolServer(bigPool(['QR'])), { ...only, targetS: 600 })
    quick.itemS = 40
    await quick.finish()
    expect(quick.run.result().itemsByAxis.QR).toBe(16) // 42 s a question with the slider, in 660 s
  })

  it('in a whole online session the Quantitative part has six answers or more, and Matrix & Series and Spatial are asked as they were', async () => {
    await fc.assert(
      fc.asyncProperty(fc.integer({ min: 20, max: 110 }), async (itemS) => {
        const t = new Taker(new PoolServer(bigPool(A15_CAT)))
        t.itemS = itemS
        await t.finish()
        const r = t.run.result()
        expect(r.reason).toBe('complete')
        expect(r.itemsByAxis.QR ?? 0).toBeGreaterThanOrEqual(QUANT_MIN_ITEMS)
        const [mat, spa, qr] = r.budgets
        // The first two start with their third of the shared time at most; Quant with that and its own minute.
        expect(mat!.budgetS).toBeLessThanOrEqual(mat!.plannedS + 1e-9)
        expect(spa!.plannedS).toBeCloseTo(mat!.plannedS, 9)
        expect(qr!.plannedS).toBeCloseTo(mat!.plannedS + QUANT_EXTRA_S, 9)
        expect(qr!.budgetS).toBeGreaterThanOrEqual(QUANT_EXTRA_S - 1e-9)
        // Two questions use up the part's time: the first two parts stop at the floor of three, as before.
        if ((itemS + 2) * 2 >= mat!.plannedS) for (const k of ['MAT', 'SPA'] as const) expect(r.itemsByAxis[k], k).toBe(3)
      }),
      { numRuns: 12 },
    )
  })

  it('ends when the server runs out, like any served part', async () => {
    const server = new PoolServer({ KHU: 3 })
    const t = new Taker(server, { textAxes: ['KHU'], skipped: ['RT', 'MAT', 'SPA', 'WM', 'QR', 'PS'] })
    await t.finish()
    expect(t.run.result().itemsByAxis.KHU).toBe(3)
    expect(t.run.result().segmentEnds).toEqual([{ segment: 'knowledge_humanities', reason: 'exhausted' }])
    expect(t.run.sessionState().flags.done_knowledge_humanities).toBe(true)
  })

  it('runs all five in the order of the plan, each with five answers or more, and the session is planned at 42 minutes', async () => {
    const server = new PoolServer(bigPool([...A15_CAT, ...TEXT_AXES]))
    const t = new Taker(server, { textAxes: TEXT_AXES })
    expect(t.v().targetS).toBe(42 * 60)
    await t.finish()
    expect(t.trace.filter((s) => s.phase === 'interstitial').map((s) => s.segment)).toEqual([
      'rt',
      'matrix_series',
      'logical_reasoning',
      'knowledge_stem',
      'spatial',
      'vocabulary',
      'memory',
      'quant',
      'knowledge_humanities',
      'knowledge_arts',
      'coding_reading',
    ])
    for (const k of TEXT_AXES) expect(t.run.result().itemsByAxis[k], k).toBeGreaterThanOrEqual(PUBLISH_MIN_ITEMS)
    expect(t.v().targetS).toBe(42 * 60)
    // Every text question went to the server under the skill it was asked for.
    for (const k of TEXT_AXES) expect(server.answered(k).length, k).toBe(t.run.result().itemsByAxis[k])
    for (const p of TEXT_PARTS) expect(t.run.sessionState().flags[`done_${p.id}`], p.id).toBe(true)
    expect(t.run.result().budgets.filter((b) => TEXT_PARTS.some((p) => p.id === b.segment))).toEqual(TEXT_PARTS.map((p) => ({ segment: p.id, plannedS: p.share_s, budgetS: p.share_s })))
  })

  it('the target shrinks by the share of each part the server does not have, and the break follows the parts that are left', async () => {
    const server = new PoolServer(bigPool([...A15_CAT, 'VOC']))
    const t = new Taker(server, { textAxes: TEXT_AXES })
    expect(t.v().targetS).toBe(42 * 60)
    await t.until((v) => v.phase === 'interstitial' && v.segment?.id === 'spatial')
    expect(t.v().targetS).toBe(42 * 60 - 300 - 130) // Logical Reasoning and STEM Knowledge were not there
    await t.finish()
    expect(t.v().targetS).toBe(A15_PLANNED_S + 120)
    expect(t.v().segments.map((s) => s.id)).toEqual(['rt', 'matrix_series', 'spatial', 'vocabulary', 'memory', 'quant', 'coding_reading'])
    expect(t.trace.filter((s) => s.phase === 'break_offer')).toHaveLength(1)
  })
})

describe('skipping a text part', () => {
  it('on its "Up next" screen: the question it was holding is let go, and the part shows as skipped', async () => {
    const server = new PoolServer(bigPool([...A15_CAT, 'LR']))
    const t = new Taker(server, { textAxes: ['LR'], skipped: ['RT'] })
    await t.until((x) => x.phase === 'interstitial' && x.segment?.id === 'logical_reasoning')
    const held = server.pending!.item.item_id
    t.run.skipAxis()
    await settle()
    expect(server.answers.at(-1)).toMatchObject({ response: null, release: 'skipped' })
    expect(server.answers.at(-1)!.item.item_id).toBe(held)
    expect(server.pending).toBeNull()
    expect(t.v().segment?.id).toBe('spatial')
    expect(t.v().segments.find((s) => s.id === 'logical_reasoning')?.status).toBe('skipped')
    expect(t.v().notice).toMatchObject({ kind: 'skipped', axis: 'LR' })
    // The next part gets its own question, not the one that was let go.
    t.run.startSegment()
    await settle()
    expect(t.v().item?.family).toBe('rotation')
    expect(t.run.catSessionState()?.responses.some((r) => r[0] === held) ?? false).toBe(false)
  })

  it('skipped from the start: the server is not asked for it at all', async () => {
    const server = new PoolServer(bigPool([...A15_CAT, ...TEXT_AXES]))
    const t = new Taker(server, { textAxes: TEXT_AXES, skipped: ['LR', 'KAP'] })
    await t.finish()
    expect(server.askedFor('LR')).toBe(0)
    expect(server.askedFor('KAP')).toBe(0)
    expect(t.v().targetS).toBe(A15_PLANNED_S + 130 + 120 + 130)
  })

  it('while its question is on its way: the item that still arrives is let go before the next part asks', async () => {
    const server = new PoolServer(bigPool([...A15_CAT, 'LR']))
    const t = new Taker(server, { textAxes: ['LR'], skipped: ['RT'] })
    await t.until((x) => x.phase === 'interstitial' && x.segment?.id === 'logical_reasoning')
    t.run.startSegment()
    await settle()
    // Answer the first question; the request for the second hangs.
    let open!: () => void
    server.gate = new Promise<void>((resolve) => (open = resolve))
    t.run.itemShown(t.t)
    t.t += 20_000
    t.run.itemResponded(1)
    t.run.confirmConfidence(60)
    await settle()
    expect(t.v().phase).toBe('loading')
    t.run.skipAxis('LR')
    await settle()
    expect(t.v().segment?.id).toBe('spatial')
    t.run.startSegment() // the Spatial part asks, but only after the stray answer has come and been let go
    await settle()
    expect(t.v().phase).toBe('loading')
    server.gate = null
    open()
    await settle()
    await settle()
    const strayId = server.served.filter((s) => s.axis === 'LR')[1]!.item.item_id
    expect(server.answers.find((a) => a.item.item_id === strayId)).toMatchObject({ response: null, release: 'skipped' })
    expect(t.v().phase).toBe('item')
    expect(t.v().item).toMatchObject({ family: 'rotation', axis: 'SPA' })
  })
})

describe('when the question for a text part cannot be asked', () => {
  it('says so, lets the person try again, and then goes on as if nothing had happened', async () => {
    const server = new PoolServer(bigPool([...A15_CAT, 'LR']))
    const t = new Taker(server, { textAxes: ['LR'], skipped: ['RT', 'MAT'] })
    server.failures = [new BackendError('network', 'network_error')]
    await settle()
    expect(t.v()).toMatchObject({ phase: 'loading', probing: true, problem: 'offline', skippable: 'LR' })
    t.run.retryLoad()
    await settle()
    expect(t.v()).toMatchObject({ phase: 'interstitial', probing: false, problem: null })
    expect(t.v().segment?.id).toBe('logical_reasoning')
  })

  it('or skip the part there: the session goes on to the next one', async () => {
    const server = new PoolServer(bigPool([...A15_CAT, 'LR']))
    const t = new Taker(server, { textAxes: ['LR'], skipped: ['RT', 'MAT'] })
    server.failures = [new BackendError('network', 'network_error')]
    await settle()
    t.run.skipAxis()
    await settle()
    expect(t.v().phase).toBe('interstitial')
    expect(t.v().segment?.id).toBe('spatial')
    expect(t.v().segments.find((s) => s.id === 'logical_reasoning')?.status).toBe('skipped')
    expect(t.run.result().skipped).toEqual(['RT', 'MAT', 'LR'])
  })

  it('finishing early during the wait ends the session, and a late reply changes nothing', async () => {
    const server = new PoolServer(bigPool(['LR']))
    let open!: () => void
    server.gate = new Promise<void>((resolve) => (open = resolve))
    const t = new Taker(server, { textAxes: ['LR'], skipped: ['RT', 'MAT'] })
    await settle()
    expect(t.v().probing).toBe(true)
    t.run.finishEarly()
    open()
    await settle()
    expect(t.v().phase).toBe('finished')
    expect(t.v().segments.find((s) => s.id === 'logical_reasoning')?.status).toBe('not_reached')
  })
})

describe('where text parts never are', () => {
  it('not in the static version, whatever the setting says', () => {
    const run = new SessionRun({ sessionId: 's_LOCALSESSION001', startedMs: 1, now: () => 0, device: TEST_DEVICE, rtInput: 'keyboard', textAxes: TEXT_AXES })
    expect(run.view().segments.map((s) => s.id)).toEqual(['rt', 'matrix_series', 'spatial', 'memory', 'quant', 'coding_reading'])
    expect(run.view().targetS).toBe(A15_PLANNED_S)
    expect(run.view().served).toBe(false)
  })

  it('not in a focus session', () => {
    const t = new Taker(new PoolServer(bigPool([...A15_CAT, ...TEXT_AXES])), { textAxes: TEXT_AXES, focus: ['MAT', 'LR'], targetS: 20 * 60 })
    expect(t.v().segments.map((s) => s.id)).toEqual(['matrix_series'])
    expect(t.v().targetS).toBe(20 * 60)
  })
})
