import { flushSync, mount, tick, unmount } from 'svelte'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { buttonByText, click, fakeDisplay, type FakeDisplay } from '../render/common/testing'
import { DESKTOP, fakeEnv, type FakeEnv } from './dom-support'
import DeviceCheck from './DeviceCheck.svelte'

let app: ReturnType<typeof mount> | undefined
let host: HTMLElement

function open(fake: FakeEnv<FakeDisplay>, ondone: (...a: unknown[]) => void = () => undefined): void {
  host = document.createElement('div')
  document.body.appendChild(host)
  app = mount(DeviceCheck, { target: host, props: { env: fake.env, ondone } })
  flushSync()
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
