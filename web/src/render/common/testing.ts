/**
 * Test-only helpers for the renderers (ROADMAP M1.13): a fake display (rAF frames + a
 * `performance.now()` clock on one timeline) so timing tests run in jsdom without real time, and
 * DOM helpers for Svelte's mount API. Imported only by `*.test.ts` files.
 */

import { flushSync, mount, unmount, type Component } from 'svelte'
import type { Clock, FrameSource } from '../../tasks/rt/timing'
import type { RendererTiming } from './props'

/** A fake 60 Hz (by default) display: frames run only when the test advances time. */
export interface FakeDisplay extends RendererTiming {
  readonly frames: FrameSource
  readonly clock: Clock & { set(t: number): void }
  /** Current time (ms). */
  now(): number
  /** Run frames up to `now() + ms`, one every frame period; returns the frames run. */
  advance(ms: number): number
  /** Pending rAF callbacks. */
  pending(): number
}

export function fakeDisplay(frameMs = 1000 / 60, start = 1000): FakeDisplay {
  let t = start
  let next = 1
  let queue = new Map<number, (ts: number) => void>()
  const clock = {
    now: () => t,
    set: (v: number) => {
      t = v
    },
  }
  const frames: FrameSource = {
    request(cb) {
      const h = next++
      queue.set(h, cb)
      return h
    },
    cancel(h) {
      queue.delete(h)
    },
  }
  const runFrame = (): void => {
    const batch = queue
    queue = new Map()
    for (const cb of batch.values()) cb(t)
    flushSync()
  }
  return {
    frames,
    clock,
    now: () => t,
    pending: () => queue.size,
    advance(ms) {
      const end = t + ms
      let n = 0
      while (t + frameMs <= end + 1e-9) {
        t += frameMs
        runFrame()
        n++
      }
      t = end
      return n
    },
  }
}

/**
 * Mount a component into a fresh container in `document.body`; returns it and an idempotent
 * cleanup. Loosely typed on purpose: tests mount every renderer through one helper.
 */
export function render(component: Component<any>, props: Record<string, unknown>): { container: HTMLElement; destroy: () => void } {
  const container = document.createElement('div')
  document.body.appendChild(container)
  const app = mount(component, { target: container, props })
  flushSync()
  let live = true
  return {
    container,
    destroy: () => {
      if (!live) return
      live = false
      void unmount(app)
      container.remove()
    },
  }
}

/** Press a key: a keydown on `target` (default: the focused element or body), bubbling. */
export function press(key: string, target?: Element | null, init: KeyboardEventInit = {}, timeStamp = 0): KeyboardEvent {
  const el = target ?? document.activeElement ?? document.body
  const ev = new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true, ...init })
  Object.defineProperty(ev, 'timeStamp', { value: timeStamp })
  el.dispatchEvent(ev)
  flushSync()
  return ev
}

/** Click an element and flush. */
export function click(el: Element | null | undefined): void {
  if (!(el instanceof HTMLElement)) throw new Error(`click(): no element (${String(el)})`)
  el.click()
  flushSync()
}

/**
 * A pointerdown on an element (jsdom has no PointerEvent: a MouseEvent of that type, with
 * `pointerType` set when given, e.g. 'mouse' or 'touch').
 */
export function pointerDown(el: Element | null | undefined, pointerType?: string, timeStamp = 0): void {
  if (!(el instanceof HTMLElement)) throw new Error(`pointerDown(): no element (${String(el)})`)
  const ev = new MouseEvent('pointerdown', { bubbles: true, cancelable: true })
  Object.defineProperty(ev, 'timeStamp', { value: timeStamp })
  if (pointerType !== undefined) Object.defineProperty(ev, 'pointerType', { value: pointerType })
  el.dispatchEvent(ev)
  flushSync()
}

/** Type into an input (sets the value and fires input). */
export function typeInto(input: Element | null | undefined, value: string): void {
  if (!(input instanceof HTMLInputElement)) throw new Error('typeInto(): not an input')
  input.value = value
  input.dispatchEvent(new Event('input', { bubbles: true }))
  flushSync()
}

/** The button whose visible text is exactly `text` inside `root`. */
export function buttonByText(root: ParentNode, text: string): HTMLButtonElement {
  const found = [...root.querySelectorAll('button')].find((b) => (b.textContent ?? '').trim() === text)
  if (!found) throw new Error(`no button "${text}" in ${[...root.querySelectorAll('button')].map((b) => JSON.stringify((b.textContent ?? '').trim())).join(', ')}`)
  return found
}
