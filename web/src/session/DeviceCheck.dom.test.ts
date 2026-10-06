import { flushSync, mount, tick, unmount } from 'svelte'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { buttonByText, click, fakeDisplay, type FakeDisplay } from '../render/common/testing'
import { DESKTOP, fakeEnv, type FakeEnv } from './dom-support'
import DeviceCheck from './DeviceCheck.svelte'
import { PROBE_MAX_AGE_MS, startRefreshProbe, type RefreshProbe } from './device'

let app: ReturnType<typeof mount> | undefined
let host: HTMLElement

function open(fake: FakeEnv<FakeDisplay>, ondone: (...a: unknown[]) => void = () => undefined, probe: RefreshProbe | null = null): void {
  host = document.createElement('div')
  document.body.appendChild(host)
  app = mount(DeviceCheck, { target: host, props: { env: fake.env, ondone, probe } })
  flushSync()
}

/** The measurement the flow starts on the gate, on the same fake display. */
function probeOn(fake: FakeEnv<FakeDisplay>): RefreshProbe {
  const probe = startRefreshProbe({ frames: fake.env.realFrames, clock: fake.env.realClock })
  if (probe === null) throw new Error('no probe: the page is hidden')
  return probe
}

afterEach(() => {
  if (app) unmount(app)
  app = undefined
  document.body.innerHTML = ''
})

async function measured(fake: FakeEnv<FakeDisplay>): Promise<void> {
  fake.display.advance(1200)
  await new Promise((resolve) => setTimeout(resolve, 0))
  flushSync()
}

describe('DeviceCheck (UX-013)', () => {
  it('puts the choice and "Continue" before the facts, so "Continue" does not move when they arrive', async () => {
    const fake = fakeEnv(fakeDisplay())
    open(fake)
    const form = host.querySelector('form')!
    const button = buttonByText(host, 'Continue')
    expect(host.querySelector('dl.facts')).toBeNull()
    await measured(fake)
    const facts = host.querySelector('dl.facts')!
    expect(form.compareDocumentPosition(facts) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    // Nothing was added above it, and the same button is still there.
    expect(host.querySelector('form')).toBe(form)
    expect(buttonByText(host, 'Continue')).toBe(button)
  })

  it('"Continue" waits with aria-disabled, stays in the tab order, and does nothing while it measures', async () => {
    const fake = fakeEnv(fakeDisplay())
    const done = vi.fn()
    open(fake, done)
    const button = buttonByText(host, 'Continue')
    expect(button.disabled).toBe(false)
    expect(button.getAttribute('aria-disabled')).toBe('true')
    click(button)
    host.querySelector('form')!.requestSubmit()
    expect(done).not.toHaveBeenCalled()
    await measured(fake)
    expect(button.hasAttribute('aria-disabled')).toBe(false)
    click(button)
    expect(done).toHaveBeenCalledTimes(1)
  })

  it('the "checking" line is in a status region that was on the page before its words, and the words are taken out when done', async () => {
    const fake = fakeEnv(fakeDisplay())
    open(fake)
    const region = host.querySelector('p[role="status"]')!
    expect(region.textContent).toBe('')
    await tick()
    flushSync()
    expect(host.querySelector('p[role="status"]')).toBe(region)
    expect(region.textContent).toBe('Checking your screen…')
    await measured(fake)
    expect(host.querySelector('p[role="status"]')).toBe(region)
    expect(region.textContent).toBe('')
    expect(region.children).toHaveLength(0)
  })

  it('explains its units: updates per second, thousandths of a second', async () => {
    const fake = fakeEnv(fakeDisplay(), { device: DESKTOP })
    // A timer that moves by a tenth of a millisecond at every reading.
    let t = 0
    const env = { ...fake.env, realClock: { now: () => (t += 0.1) } }
    open({ ...fake, env })
    await measured(fake)
    const text = host.querySelector('dl.facts')?.textContent ?? ''
    expect(text).toMatch(/\d+ Hz \(screen updates per second\)/)
    expect(text).toMatch(/[\d.]+ ms \(thousandths of a second\)/)
  })

  it('asks for a browser window that is open and in front', () => {
    const fake = fakeEnv(fakeDisplay())
    open(fake)
    expect(host.textContent).toContain('keep this browser window open and in front of other windows')
  })
})

describe('DeviceCheck with the measurement started on the gate (provisional default, UX-REVIEW D23)', () => {
  /** The device the check hands on, from the screen with no probe: the reference. */
  async function plain(): Promise<unknown> {
    const fake = fakeEnv(fakeDisplay())
    const done = vi.fn()
    open(fake, done)
    await measured(fake)
    click(buttonByText(host, 'Continue'))
    const info = done.mock.calls[0]![0]
    unmount(app!)
    app = undefined
    document.body.innerHTML = ''
    return info
  }

  it('a measurement that is done is used at once: the facts are there when the screen opens, nothing is measured again', async () => {
    const fake = fakeEnv(fakeDisplay())
    const probe = probeOn(fake)
    fake.display.advance(1200)
    await probe.done
    const done = vi.fn()
    open(fake, done, probe)
    expect(host.querySelector('dl.facts')?.textContent).toContain('60 Hz (screen updates per second)')
    expect(host.textContent).not.toContain('Checking your screen')
    expect(buttonByText(host, 'Continue').hasAttribute('aria-disabled')).toBe(false)
    await tick()
    flushSync()
    expect(host.textContent).not.toContain('Checking your screen')
    // No frame is asked for by the screen itself.
    expect(fake.display.pending()).toBe(0)
    click(buttonByText(host, 'Continue'))
    expect(done).toHaveBeenCalledTimes(1)
    // The same device record as when the screen measures it itself.
    expect(done.mock.calls[0]![0]).toEqual(await plain())
    expect(done.mock.calls[0]![1]).toBe('keyboard')
  })

  it('a measurement still under way is waited for, once: only what is left of it, and no second one', async () => {
    const fake = fakeEnv(fakeDisplay())
    const probe = probeOn(fake)
    fake.display.advance(500)
    const done = vi.fn()
    open(fake, done, probe)
    await tick()
    flushSync()
    expect(host.textContent).toContain('Checking your screen')
    expect(buttonByText(host, 'Continue').getAttribute('aria-disabled')).toBe('true')
    // Still the probe's one frame: the screen did not start its own.
    expect(fake.display.pending()).toBe(1)
    await measured(fake)
    expect(host.textContent).not.toContain('Checking your screen')
    expect(host.querySelector('dl.facts')?.textContent).toContain('60 Hz')
    expect(fake.display.pending()).toBe(0)
    click(buttonByText(host, 'Continue'))
    expect(done.mock.calls[0]![0]).toEqual(await plain())
  })

  it('a measurement that was dropped (the page was hidden, or it was cancelled) is made here, as it always was', async () => {
    const fake = fakeEnv(fakeDisplay())
    const probe = probeOn(fake)
    fake.display.advance(300)
    probe.cancel()
    await probe.done
    open(fake, undefined, probe)
    await tick()
    flushSync()
    expect(host.textContent).toContain('Checking your screen')
    expect(fake.display.pending()).toBe(1)
    await measured(fake)
    expect(host.querySelector('dl.facts')?.textContent).toContain('60 Hz')
  })

  it('one still under way when it is dropped comes to a measurement here too', async () => {
    const fake = fakeEnv(fakeDisplay())
    const probe = probeOn(fake)
    open(fake, undefined, probe)
    probe.cancel()
    await probe.done
    await tick()
    flushSync()
    expect(fake.display.pending()).toBe(1)
    await measured(fake)
    expect(host.querySelector('dl.facts')?.textContent).toContain('60 Hz')
  })

  it('a measurement that is too old is made again (the window may have moved to another screen)', async () => {
    const fake = fakeEnv(fakeDisplay())
    const probe = probeOn(fake)
    fake.display.advance(1200)
    await probe.done
    fake.display.clock.set(fake.display.clock.now() + PROBE_MAX_AGE_MS + 1)
    open(fake, undefined, probe)
    await tick()
    flushSync()
    expect(host.textContent).toContain('Checking your screen')
    expect(fake.display.pending()).toBe(1)
    await measured(fake)
    expect(host.querySelector('dl.facts')).not.toBeNull()
  })

  it('leaving the screen while the measurement is under way is harmless: nothing is set or thrown when it ends', async () => {
    const fake = fakeEnv(fakeDisplay())
    const probe = probeOn(fake)
    open(fake, undefined, probe)
    unmount(app!)
    app = undefined
    fake.display.advance(1200)
    await probe.done
    await new Promise((resolve) => setTimeout(resolve, 0))
    expect(probe.hz).toBe(60)
    expect(host.textContent).toBe('')
  })
})
