/**
 * The session clock (ROADMAP M1.15; DESIGN §7.4, §10, §13): active seconds since the session began,
 * with the time spent on a break left out. It reads an injected monotonic `now()` in ms (the
 * `performance.now()` timeline in the browser, a fake in tests), never the wall clock (CLAUDE.md
 * timing rule), and it is a pure function of that reading: nothing ticks, so a tab that was
 * throttled or a test that jumps ahead by an hour simply sees the later reading.
 *
 * Time stands still while any **hold** is on ({@link SessionClock.hold}): the session holds the
 * clock for several reasons that overlap (an "Up next" screen, a break, the wait for a served item),
 * and each reason is let go on its own, so one of them ending never restarts a clock another one
 * still holds, and holding twice for the same reason is the same as holding once (UX-066).
 */

export type NowMs = () => number

/** Why the clock is held. `pause` is the reason {@link SessionClock.pause} and {@link SessionClock.resume} use. */
export type HoldReason = 'pause' | 'between_parts' | 'break' | 'loading'

export class SessionClock {
  readonly #now: NowMs
  #startedAt: number | null = null
  #stoppedAt: number | null = null
  #pausedAt: number | null = null
  #pausedMs = 0
  readonly #holds = new Set<HoldReason>()

  constructor(now: NowMs) {
    this.#now = now
  }

  /** Begin counting. Throws if the clock already started. */
  start(): void {
    if (this.#startedAt !== null) throw new Error('SessionClock: already started')
    this.#startedAt = this.#now()
  }

  get started(): boolean {
    return this.#startedAt !== null
  }

  get paused(): boolean {
    return this.#pausedAt !== null
  }

  get stopped(): boolean {
    return this.#stoppedAt !== null
  }

  /**
   * Stop counting for good (the session ended); {@link elapsedS} then stays fixed. With `capS`, the
   * active time is at most that: a stop noticed late (a suspended tab, a throttled timer) is
   * recorded at the limit, not at the later reading. Not applied during a break, when time is not
   * running anyway.
   */
  stop(capS?: number): void {
    if (this.#startedAt === null || this.#stoppedAt !== null) return
    const now = this.#now()
    let at = now
    if (capS !== undefined && this.#pausedAt === null) {
      const overMs = now - this.#startedAt - this.#pausedMs - capS * 1000
      if (overMs > 0) at = now - overMs
    }
    this.#stoppedAt = at
  }

  /** Stop counting active time (a break): {@link hold} for `pause`. No effect when not running or already paused. */
  pause(): void {
    this.hold('pause')
  }

  /** Let go of the {@link pause}; time counts again unless another hold is still on. */
  resume(): void {
    this.release('pause')
  }

  /**
   * Hold the clock for `reason`: active time stands still until every hold is let go. Holding for a
   * reason already on changes nothing; no effect before the start or after the stop.
   */
  hold(reason: HoldReason): void {
    if (this.#startedAt === null || this.#stoppedAt !== null || this.#holds.has(reason)) return
    this.#holds.add(reason)
    if (this.#pausedAt === null) this.#pausedAt = this.#now()
  }

  /** Let go of the hold for `reason`; the time since the first hold is left out for good once none is left. */
  release(reason: HoldReason): void {
    if (!this.#holds.delete(reason) || this.#stoppedAt !== null) return
    if (this.#holds.size > 0 || this.#pausedAt === null) return
    this.#pausedMs += Math.max(0, this.#now() - this.#pausedAt)
    this.#pausedAt = null
  }

  /** Whether the clock is held for `reason`. */
  held(reason: HoldReason): boolean {
    return this.#holds.has(reason)
  }

  /** Total seconds spent paused so far. */
  pausedS(): number {
    const open = this.#pausedAt === null ? 0 : Math.max(0, (this.#stoppedAt ?? this.#now()) - this.#pausedAt)
    return (this.#pausedMs + open) / 1000
  }

  /**
   * Active seconds since {@link start}, excluding breaks and holds; 0 before the start. While the clock
   * is held the reading is the one at the moment it was held, exactly (it is computed from that moment,
   * not from the current reading less the held time, so it does not drift in the last digit).
   */
  elapsedS(): number {
    if (this.#startedAt === null) return 0
    const end = this.#stoppedAt ?? this.#now()
    const activeEnd = this.#pausedAt === null ? end : Math.min(this.#pausedAt, end)
    return Math.max(0, activeEnd - this.#startedAt - this.#pausedMs) / 1000
  }
}
