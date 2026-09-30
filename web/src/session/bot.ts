/**
 * Test-only helpers of the session flow (ROADMAP M1.15): a fake session timeline and a simulated
 * taker that drives a {@link SessionRun} through the real families with the sim responders
 * (`sim/responders.ts`). Never imported by the app.
 */

import { createRng, type Rng } from '../engine/prng'
import { N_AXES, AXIS_INDEX, type AxisCode } from '../engine/axes'
import type { AnyItem } from '../engine/selector'
import type { StorageLike } from '../save/autosave'
import type { DeviceInfo } from '../save/types'
import { getFamily, resolveItem } from '../tasks/registry'
import { answerBlock, answerItem } from '../sim/responders'
import { confidenceFloorPct } from './calibration'
import { SessionRun, type RunConfig, type RunView } from './run'

export const TEST_DEVICE: DeviceInfo = Object.freeze({
  class: 'desktop',
  input: 'keyboard',
  os_family: 'macOS',
  browser_family: 'Chrome',
  refresh_hz_est: 60,
  timer_res_ms: 0.1,
  viewport: [1280, 800],
}) as DeviceInfo

export interface BotOptions {
  /** True θ per axis (default all 0). */
  readonly theta?: readonly number[]
  /** Multiplier on the taker's block durations, per family or overall (default 1). */
  readonly blockScale?: number | Readonly<Record<string, number>>
  /** Multiplier on a CAT item's time, E[T] × this (default 1). */
  readonly itemScale?: number
  /** Seconds spent on the confidence slider (default 2). */
  readonly confidenceS?: number
  /** Confidence to give: 'mid' (default), 'floor' or 'max'. */
  readonly confidence?: 'mid' | 'floor' | 'max'
  /** What to do when a break is offered (default 'decline'). */
  readonly onBreakOffer?: 'decline' | 'take'
  /** Seconds a break lasts when taken (default 300). */
  readonly breakS?: number
  readonly seed?: string
}

/** A fake-timeline run and the simulated taker that drives it. */
export class Bot {
  /** The session timeline, ms. */
  t = 0
  readonly run: SessionRun
  readonly rng: Rng
  readonly opts: BotOptions
  readonly phases: string[] = []
  private readonly theta: readonly number[]

  constructor(cfg: Partial<RunConfig> = {}, opts: BotOptions = {}) {
    this.opts = opts
    this.theta = opts.theta ?? new Array<number>(N_AXES).fill(0)
    const sessionId = cfg.sessionId ?? 's_TESTSESSION0001'
    this.rng = createRng(`bot:${opts.seed ?? sessionId}`)
    this.run = new SessionRun({
      sessionId,
      startedMs: 1_790_000_000_000,
      now: () => this.t,
      device: TEST_DEVICE,
      rtInput: 'keyboard',
      ...cfg,
    })
  }

  view(): RunView {
    return this.run.view()
  }

  /** Move the timeline forward `s` seconds. */
  wait(s: number): void {
    this.t += s * 1000
  }

  private blockFactor(family: string): number {
    const b = this.opts.blockScale
    if (b === undefined) return 1
    return typeof b === 'number' ? b : (b[family] ?? 1)
  }

  private thetaOf(axis: AxisCode): number {
    return this.theta[AXIS_INDEX[axis]] ?? 0
  }

  /** The full item (with key) the run presented: what only the test may see. */
  fullItem(id: string): AnyItem {
    const item = resolveItem(id)
    if (item === null) throw new Error(`cannot regenerate ${id}`)
    return item
  }

  /** Do the next thing a taker would do; false once the session has finished. */
  step(): boolean {
    const v = this.run.view()
    this.phases.push(v.phase)
    switch (v.phase) {
      case 'finished':
        return false
      case 'interstitial':
        this.run.startSegment()
        return true
      case 'block': {
        const blk = v.block!
        const item = this.fullItem(blk.item_id)
        const family = getFamily(blk.family)!
        const a = answerBlock(family, item, this.thetaOf(blk.axis), this.rng.fork(`block/${blk.family}`))
        this.wait(a.timeS * this.blockFactor(blk.family))
        if (blk.family.startsWith('rt_')) this.run.blockInputType('keyboard')
        this.run.blockResponded(a.response)
        return true
      }
      case 'item': {
        const it = v.item!
        const item = this.fullItem(it.item_id)
        const family = getFamily(it.family)!
        this.run.itemShown(this.t)
        this.wait(item.expected_time_s * (this.opts.itemScale ?? 1))
        const a = answerItem(family, item, this.thetaOf(it.axis), this.rng.fork(`item/${it.item_id}`))
        this.run.itemResponded(a.response)
        return true
      }
      case 'confidence': {
        const c = v.confidence!
        this.wait(this.opts.confidenceS ?? 2)
        const pct = this.opts.confidence === 'floor' ? c.floorPct : this.opts.confidence === 'max' ? 100 : c.startPct
        this.run.confirmConfidence(pct)
        return true
      }
      case 'break_offer':
        if (this.opts.onBreakOffer === 'take') this.run.takeBreak()
        else this.run.declineBreak()
        return true
      case 'on_break':
        this.wait(this.opts.breakS ?? 300)
        this.run.resume()
        return true
    }
  }

  /** Step until the session finishes (or `maxSteps`, to fail a runaway test). */
  finish(maxSteps = 5000): SessionRun {
    for (let i = 0; i < maxSteps; i++) {
      this.run.tick()
      if (!this.step()) return this.run
    }
    throw new Error(`session did not finish in ${maxSteps} steps (phase ${this.run.phase})`)
  }

  /** Step while `until` is false, stopping at the first view for which it is true. */
  until(until: (v: RunView) => boolean, maxSteps = 5000): RunView {
    for (let i = 0; i < maxSteps; i++) {
      const v = this.run.view()
      if (until(v)) return v
      this.run.tick()
      if (!this.step()) return this.run.view()
    }
    throw new Error(`condition not met in ${maxSteps} steps (phase ${this.run.phase})`)
  }
}

/** The least confidence the slider offers for an item of `optionsCount` options (re-export for tests). */
export const floorPctOf = confidenceFloorPct

/** A Web Storage that logs its calls. `writes` are the calls that change it. */
export class SpyStorage implements StorageLike {
  readonly data = new Map<string, string>()
  readonly calls: string[] = []
  get writes(): string[] {
    return this.calls.filter((c) => c.startsWith('set:') || c.startsWith('remove:'))
  }
  get length(): number {
    return this.data.size
  }
  key(i: number): string | null {
    this.calls.push(`key:${i}`)
    return [...this.data.keys()][i] ?? null
  }
  getItem(k: string): string | null {
    this.calls.push(`get:${k}`)
    return this.data.get(k) ?? null
  }
  setItem(k: string, v: string): void {
    this.calls.push(`set:${k}`)
    this.data.set(k, v)
  }
  removeItem(k: string): void {
    this.calls.push(`remove:${k}`)
    this.data.delete(k)
  }
}
