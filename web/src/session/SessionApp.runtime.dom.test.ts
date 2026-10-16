/**
 * The session runtime as a chunk of its own (UX-100; `runtime.ts`, `runtime-loader.ts`): the welcome screen and the
 * screens up to the device check come up without it; it is fetched in idle time on the welcome screen and at Start;
 * a step that needs it before it has arrived says "Getting ready" and goes on when it does, with "Try again" if not.
 */
import { flushSync, mount, tick, unmount } from 'svelte'
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import { buttonByText, click, fakeDisplay, type FakeDisplay } from '../render/common/testing'
import { fakeEnv, type FakeEnv } from './dom-support'
import { resultsLoader } from './results-loader'
import { RUNTIME_FAILED, RUNTIME_PENDING_HEADING, RUNTIME_PREPARING, createRuntimeLoader, runtimeLoader, whenIdle, type RuntimeLoader, type SessionRuntime } from './runtime-loader'
import SessionApp from './SessionApp.svelte'

let module: SessionRuntime
beforeAll(async () => {
  await resultsLoader.load()
  module = await runtimeLoader.load()
}, 90_000)

let app: ReturnType<typeof mount> | undefined
let host: HTMLElement

afterEach(() => {
  if (app) unmount(app)
  app = undefined
  document.body.innerHTML = ''
  vi.restoreAllMocks()
  vi.useRealTimers()
})

const h1 = (): string => document.querySelector('main h1')?.textContent?.trim() ?? ''
const box = (label: RegExp): HTMLInputElement => {
  const l = [...document.querySelectorAll('label')].find((x) => label.test(x.textContent ?? ''))
  const el = l?.control
  if (!(el instanceof HTMLInputElement)) throw new Error(`no checkbox for ${String(label)}`)
  return el
}

/** A runtime loader whose import waits until the test says so (resolve or fail), counting the attempts. */
function gatedLoader(): { loader: RuntimeLoader; calls: () => number; settle: (ok: boolean) => void } {
  let calls = 0
  let pending: { resolve: (m: SessionRuntime) => void; reject: (e: Error) => void }[] = []
  const loader = createRuntimeLoader({
    importer: () => {
      calls++
      return new Promise<SessionRuntime>((resolve, reject) => pending.push({ resolve, reject }))
    },
    delays: [],
    beforeRetry: async () => undefined,
    online: () => true,
    failedChunk: () => null,
  })
  return {
    loader,
    calls: () => calls,
    settle: (ok) => {
      for (const p of pending) {
        if (ok) p.resolve(module)
        else p.reject(new Error('chunk failed'))
      }
      pending = []
    },
  }
}

function open(fake: FakeEnv<FakeDisplay>, runtime: RuntimeLoader): void {
  host = document.createElement('div')
  document.body.appendChild(host)
  app = mount(SessionApp, { target: host, props: { env: fake.env, runtime } })
  flushSync()
}

const flush = async (): Promise<void> => {
  for (let i = 0; i < 5; i++) await Promise.resolve()
  await tick()
  flushSync()
}

/** Gate, honour code and device check, which need no runtime; ends on the device screen's Continue. */
async function throughDevice(fake: FakeEnv<FakeDisplay>): Promise<void> {
  click(buttonByText(host, 'Start'))
  expect(h1()).toBe('Before you start') // the gate, at once
  click(box(/18 or older/))
  click(buttonByText(host, 'Continue'))
  click(box(/honour code/))
  click(buttonByText(host, 'Continue'))
  expect(h1()).toBe('Check your device')
  fake.display.advance(1200)
  await new Promise((resolve) => setTimeout(resolve, 0))
  flushSync()
  click(buttonByText(host, 'Continue'))
}

describe('the session runtime is fetched behind the welcome screen (UX-100)', () => {
  it('is not asked for while the welcome screen is drawn; after Start, once the gate\'s refresh measurement has settled (D23)', async () => {
    const fake = fakeEnv(fakeDisplay())
    const g = gatedLoader()
    open(fake, g.loader)
    expect(h1()).not.toBe('')
    expect(g.calls()).toBe(0)
    click(buttonByText(host, 'Start'))
    expect(h1()).toBe('Before you start')
    // its code runs in one long task, which would hold up the frames being counted: not while they are
    await flush()
    expect(g.calls()).toBe(0)
    fake.display.advance(1200)
    await flush()
    expect(g.calls()).toBe(1)
  })

  it('is fetched in idle time on the welcome screen, so Start finds it in memory', async () => {
    vi.useFakeTimers()
    const g = gatedLoader()
    open(fakeEnv(fakeDisplay()), g.loader)
    expect(g.calls()).toBe(0)
    vi.advanceTimersByTime(1500) // jsdom has no requestIdleCallback: the fallback timer
    expect(g.calls()).toBe(1)
    vi.useRealTimers()
    g.settle(true)
    await flush()
    expect(g.loader.current()).toBe(module)
  })

  it('waits on "Getting ready" when the ready screen comes before the runtime, and goes on when it arrives', async () => {
    const fake = fakeEnv(fakeDisplay())
    const g = gatedLoader()
    open(fake, g.loader)
    await throughDevice(fake)
    expect(h1()).toBe(RUNTIME_PENDING_HEADING)
    expect(host.querySelector('[role="status"]')?.textContent).toBe(RUNTIME_PREPARING)
    g.settle(true)
    await flush()
    expect(h1()).toBe('Ready when you are')
  })

  it('offers "Try again" when the runtime does not arrive, and goes on once it does', async () => {
    const fake = fakeEnv(fakeDisplay())
    const g = gatedLoader()
    open(fake, g.loader)
    await throughDevice(fake)
    g.settle(false)
    await flush()
    expect(h1()).toBe(RUNTIME_PENDING_HEADING)
    expect(host.querySelector('[role="status"]')?.textContent).toBe(RUNTIME_FAILED)
    const before = g.calls()
    click(buttonByText(host, 'Try again'))
    await flush() // a retry first re-adds failed stylesheets (here a no-op), then imports
    expect(g.calls()).toBe(before + 1)
    expect(host.querySelector('[role="status"]')?.textContent).toBe(RUNTIME_PREPARING)
    g.settle(true)
    await flush()
    expect(h1()).toBe('Ready when you are')
  })

  it('goes straight on when the runtime is in memory already: no waiting screen', async () => {
    const fake = fakeEnv(fakeDisplay())
    open(fake, runtimeLoader)
    await throughDevice(fake)
    expect(h1()).toBe('Ready when you are')
  })
})

describe('whenIdle', () => {
  it('uses requestIdleCallback where there is one, and can be cancelled', () => {
    const calls: string[] = []
    const g = globalThis as { requestIdleCallback?: unknown; cancelIdleCallback?: unknown }
    let queued: (() => void) | null = null
    g.requestIdleCallback = (cb: () => void) => {
      queued = cb
      return 7
    }
    g.cancelIdleCallback = (h: number) => calls.push(`cancel ${h}`)
    try {
      const cancel = whenIdle(() => calls.push('ran'))
      expect(calls).toEqual([])
      ;(queued as unknown as () => void)()
      expect(calls).toEqual(['ran'])
      cancel()
      expect(calls).toEqual(['ran', 'cancel 7'])
    } finally {
      delete g.requestIdleCallback
      delete g.cancelIdleCallback
    }
  })
})
