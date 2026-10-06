import fc from 'fast-check'
import { describe, expect, it } from 'vitest'
import { SessionClock, type HoldReason } from './clock'

function clockAt(): { clock: SessionClock; set: (ms: number) => void } {
  let t = 0
  return { clock: new SessionClock(() => t), set: (ms) => (t = ms) }
}

describe('SessionClock (M1.15)', () => {
  it('is 0 before it starts and counts active seconds after', () => {
    const { clock, set } = clockAt()
    expect(clock.elapsedS()).toBe(0)
    expect(clock.started).toBe(false)
    set(5000)
    clock.start()
    expect(clock.started).toBe(true)
    set(7500)
    expect(clock.elapsedS()).toBe(2.5)
  })

  it('leaves the time on a break out, and only that', () => {
    const { clock, set } = clockAt()
    clock.start()
    set(10_000)
    clock.pause()
    expect(clock.paused).toBe(true)
    set(70_000)
    expect(clock.elapsedS()).toBe(10)
    expect(clock.pausedS()).toBe(60)
    clock.resume()
    set(75_000)
    expect(clock.elapsedS()).toBe(15)
    expect(clock.pausedS()).toBe(60)
  })

  it('stop freezes the elapsed time, also from a break', () => {
    const { clock, set } = clockAt()
    clock.start()
    set(20_000)
    clock.pause()
    set(50_000)
    clock.stop()
    set(500_000)
    expect(clock.stopped).toBe(true)
    expect(clock.elapsedS()).toBe(20)
    clock.resume()
    clock.pause()
    expect(clock.elapsedS()).toBe(20)
  })

  it('refuses a second start', () => {
    const { clock } = clockAt()
    clock.start()
    expect(() => clock.start()).toThrow('already started')
  })

  it('a pause or resume out of turn changes nothing', () => {
    const { clock, set } = clockAt()
    clock.pause()
    clock.resume()
    clock.start()
    set(1000)
    clock.resume()
    expect(clock.elapsedS()).toBe(1)
    clock.pause()
    clock.pause()
    set(3000)
    clock.resume()
    clock.resume()
    expect(clock.elapsedS()).toBe(1)
  })

  it('elapsed is the wall span minus the breaks, whatever the order (property)', () => {
    fc.assert(
      fc.property(fc.array(fc.tuple(fc.integer({ min: 0, max: 5000 }), fc.boolean()), { minLength: 1, maxLength: 40 }), (steps) => {
        const { clock, set } = clockAt()
        clock.start()
        let t = 0
        let paused = false
        let breakMs = 0
        for (const [dt, toggle] of steps) {
          t += dt
          set(t)
          if (paused) breakMs += dt
          if (toggle) {
            if (paused) clock.resume()
            else clock.pause()
            paused = !paused
          }
        }
        expect(clock.elapsedS()).toBeCloseTo((t - breakMs) / 1000, 9)
        expect(clock.elapsedS()).toBeGreaterThanOrEqual(0)
      }),
    )
  })

  it('holds for several reasons overlap: time counts again only once every hold is let go (UX-066)', () => {
    const { clock, set } = clockAt()
    clock.start()
    set(1000)
    clock.hold('between_parts')
    expect(clock.paused).toBe(true)
    set(2000)
    clock.hold('loading')
    set(3000)
    clock.release('between_parts') // the wait for the server still holds it
    expect(clock.paused).toBe(true)
    set(4000)
    expect(clock.elapsedS()).toBe(1)
    clock.release('loading')
    set(4500)
    expect(clock.elapsedS()).toBe(1.5)
    expect(clock.pausedS()).toBe(3)
  })

  it('holding twice for one reason is holding once; letting go of a reason not held changes nothing', () => {
    const { clock, set } = clockAt()
    clock.start()
    clock.hold('break')
    clock.hold('break')
    expect(clock.held('break')).toBe(true)
    set(5000)
    clock.release('loading')
    expect(clock.paused).toBe(true)
    clock.release('break')
    expect(clock.held('break')).toBe(false)
    set(6000)
    expect(clock.elapsedS()).toBe(1)
    // pause/resume are the hold of their own reason.
    clock.pause()
    clock.hold('between_parts')
    clock.resume()
    set(9000)
    expect(clock.elapsedS()).toBe(1)
  })

  it('a held reading is exact: it does not drift while the source runs on', () => {
    const { clock, set } = clockAt()
    clock.start()
    set(509_222.95)
    clock.hold('between_parts')
    const at = clock.elapsedS()
    for (const t of [509_223.1, 600_000.3, 7_777_777.77]) {
      set(t)
      expect(clock.elapsedS()).toBe(at)
    }
  })

  it('elapsed is the time with no hold on, whatever the reasons and their order (property)', () => {
    const reasons: HoldReason[] = ['pause', 'between_parts', 'break', 'loading']
    fc.assert(
      fc.property(fc.array(fc.tuple(fc.integer({ min: 0, max: 5000 }), fc.constantFrom(...reasons), fc.boolean()), { minLength: 1, maxLength: 60 }), (steps) => {
        const { clock, set } = clockAt()
        clock.start()
        const on = new Set<HoldReason>()
        let t = 0
        let active = 0
        for (const [dt, reason, hold] of steps) {
          t += dt
          set(t)
          if (on.size === 0) active += dt
          if (hold) {
            clock.hold(reason)
            on.add(reason)
          } else {
            clock.release(reason)
            on.delete(reason)
          }
          expect(clock.paused).toBe(on.size > 0)
        }
        expect(clock.elapsedS()).toBeCloseTo(active / 1000, 9)
      }),
    )
  })

  it('never goes negative if the source runs backwards', () => {
    const { clock, set } = clockAt()
    set(10_000)
    clock.start()
    set(4000)
    expect(clock.elapsedS()).toBe(0)
  })
})
