/**
 * observeWidth (ROADMAP M1.16; post-merge audit): the chart width reaches the layout on the next
 * animation frame, never inside the ResizeObserver callback, so re-laying the chart out cannot
 * loop the observer (WebKit "ResizeObserver loop completed with undelivered notifications").
 */

import fc from 'fast-check'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { observeWidth, type FrameScheduler } from './width'

/** A ResizeObserver stand-in whose notifications the test fires. */
class FakeObserver {
  static all: FakeObserver[] = []
  observed: Element[] = []
  disconnected = false
  constructor(readonly cb: ResizeObserverCallback) {
    FakeObserver.all.push(this)
  }
  observe(el: Element): void {
    this.observed.push(el)
  }
  unobserve(): void {}
  disconnect(): void {
    this.disconnected = true
  }
  fire(): void {
    this.cb([], this as unknown as ResizeObserver)
  }
}

function fakeFrames(): FrameScheduler & { run(): void; pending(): number } {
  let next = 1
  const queue = new Map<number, () => void>()
  return {
    request: (cb) => (queue.set(next, cb), next++),
    cancel: (h) => void queue.delete(h),
    run: () => {
      const cbs = [...queue.values()]
      queue.clear()
      for (const cb of cbs) cb()
    },
    pending: () => queue.size,
  }
}

function box(width: number): HTMLElement & { w: number } {
  const el = Object.assign(document.createElement('div'), { w: width })
  Object.defineProperty(el, 'clientWidth', { get: () => el.w })
  return el
}

const saved = globalThis.ResizeObserver
beforeEach(() => {
  FakeObserver.all = []
  globalThis.ResizeObserver = FakeObserver as unknown as typeof ResizeObserver
})
afterEach(() => {
  globalThis.ResizeObserver = saved
})

describe('observeWidth', () => {
  it('reports the width on the next frame, not inside the observer callback', () => {
    const frames = fakeFrames()
    const el = box(360)
    const seen: number[] = []
    observeWidth(el, (w) => seen.push(w), frames)
    const ro = FakeObserver.all[0]!
    expect(ro.observed).toEqual([el])
    ro.fire()
    expect(seen).toEqual([])
    frames.run()
    expect(seen).toEqual([360])
  })

  it('reports at most once per frame and only a changed width (a height-only resize is silent)', () => {
    fc.assert(
      fc.property(fc.array(fc.array(fc.integer({ min: 0, max: 1200 }), { minLength: 1, maxLength: 4 }), { maxLength: 12 }), (framesOfWidths) => {
        FakeObserver.all = []
        const frames = fakeFrames()
        const el = box(0)
        const seen: number[] = []
        observeWidth(el, (w) => seen.push(w), frames)
        const ro = FakeObserver.all[0]!
        const want: number[] = []
        let last: number | null = null
        for (const widths of framesOfWidths) {
          for (const w of widths) {
            el.w = w
            ro.fire()
          }
          expect(frames.pending()).toBe(1)
          frames.run()
          const w = widths.at(-1)!
          if (w !== last) want.push(w)
          last = w
        }
        expect(seen).toEqual(want)
      }),
    )
  })

  it('stops on cleanup: disconnects and drops a pending frame', () => {
    const frames = fakeFrames()
    const seen: number[] = []
    const stop = observeWidth(box(500), (w) => seen.push(w), frames)
    const ro = FakeObserver.all[0]!
    ro.fire()
    stop()
    expect(ro.disconnected).toBe(true)
    expect(frames.pending()).toBe(0)
    frames.run()
    expect(seen).toEqual([])
  })

  it('does nothing without a ResizeObserver (jsdom): the caller keeps its default layout', () => {
    globalThis.ResizeObserver = undefined as unknown as typeof ResizeObserver
    const frames = fakeFrames()
    const seen: number[] = []
    const stop = observeWidth(box(300), (w) => seen.push(w), frames)
    expect(frames.pending()).toBe(0)
    stop()
    expect(seen).toEqual([])
  })
})
