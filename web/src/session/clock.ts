/**
 * The session clock (ROADMAP M1.15; DESIGN §7.4, §10, §13): active seconds since the session began,
 * with the time spent on a break left out. It reads an injected monotonic `now()` in ms (the
 * `performance.now()` timeline in the browser, a fake in tests), never the wall clock (CLAUDE.md
 * timing rule), and it is a pure function of that reading: nothing ticks, so a tab that was
 * throttled or a test that jumps ahead by an hour simply sees the later reading.
 */

export type NowMs = () => number

export class SessionClock {
  readonly #now: NowMs
  #startedAt: number | null = null
  #stoppedAt: number | null = null
  #pausedAt: number | null = null
  #pausedMs = 0

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

  /** Stop counting for good (the session ended); {@link elapsedS} then stays fixed. */
  stop(): void {
    if (this.#startedAt === null || this.#stoppedAt !== null) return
    this.#stoppedAt = this.#now()
  }

  /** Stop counting active time (a break). No effect when not running or already paused. */
  pause(): void {
    if (this.#startedAt === null || this.#stoppedAt !== null || this.#pausedAt !== null) return
    this.#pausedAt = this.#now()
  }

  /** Count again; the time since {@link pause} is left out for good. */
  resume(): void {
    if (this.#pausedAt === null || this.#stoppedAt !== null) return
    this.#pausedMs += Math.max(0, this.#now() - this.#pausedAt)
    this.#pausedAt = null
  }

  /** Total seconds spent paused so far. */
  pausedS(): number {
    const open = this.#pausedAt === null ? 0 : Math.max(0, (this.#stoppedAt ?? this.#now()) - this.#pausedAt)
    return (this.#pausedMs + open) / 1000
  }

  /** Active seconds since {@link start}, excluding breaks; 0 before the start. */
  elapsedS(): number {
    if (this.#startedAt === null) return 0
    const end = this.#stoppedAt ?? this.#now()
    return Math.max(0, end - this.#startedAt - this.pausedS() * 1000) / 1000
  }
}
