import { flushSync, mount, unmount } from 'svelte'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createRawSnippet } from 'svelte'
import Screen from './Screen.svelte'
import { pageTitle } from './title'

let app: ReturnType<typeof mount> | undefined
let host: HTMLElement
const body = createRawSnippet(() => ({ render: () => '<p>Body</p>' }))

function open(props: { title: string; focus?: boolean; translate?: 'yes' | 'no' }): void {
  host = document.createElement('div')
  document.body.appendChild(host)
  app = mount(Screen, { target: host, props: { ...props, children: body } })
  flushSync()
}

/** A scroll position the test controls: jsdom has none. */
function scrolledTo(y: number): void {
  Object.defineProperty(window, 'scrollY', { value: y, configurable: true })
  Object.defineProperty(window, 'scrollX', { value: 0, configurable: true })
}

let frames: FrameRequestCallback[]
beforeEach(() => {
  frames = []
  vi.stubGlobal('requestAnimationFrame', (cb: FrameRequestCallback) => frames.push(cb))
  vi.stubGlobal('cancelAnimationFrame', () => undefined)
  document.title = 'HumanBench'
})
afterEach(() => {
  if (app) unmount(app)
  app = undefined
  document.body.innerHTML = ''
  vi.unstubAllGlobals()
  scrolledTo(0)
})

describe('Screen: a new screen opens at its heading (UX-001, WCAG 2.4.3)', () => {
  it('focuses the heading without the browser scroll, then scrolls to the top once the screen is laid out', () => {
    scrolledTo(942)
    const scrollTo = vi.fn()
    vi.stubGlobal('scrollTo', scrollTo)
    const focus = vi.spyOn(HTMLElement.prototype, 'focus')
    open({ title: 'Matrix & Series' })
    const h1 = host.querySelector('h1')!
    expect(document.activeElement).toBe(h1)
    expect(focus).toHaveBeenCalledWith({ preventScroll: true })
    // Not before the frame: the old, longer page would clamp the offset.
    expect(scrollTo).not.toHaveBeenCalled()
    expect(frames).toHaveLength(1)
    frames[0]!(0)
    expect(scrollTo).toHaveBeenCalledTimes(1)
    expect(scrollTo).toHaveBeenCalledWith({ top: 0, left: 0, behavior: 'instant' })
    focus.mockRestore()
  })

  it('does not scroll a page that is already at the top', () => {
    scrolledTo(0)
    const scrollTo = vi.fn()
    vi.stubGlobal('scrollTo', scrollTo)
    open({ title: 'Honour code' })
    frames[0]!(0)
    expect(scrollTo).not.toHaveBeenCalled()
  })

  it('the first screen of a page load (focus off) takes neither focus nor scroll', () => {
    scrolledTo(300)
    const scrollTo = vi.fn()
    vi.stubGlobal('scrollTo', scrollTo)
    open({ title: 'HumanBench', focus: false })
    expect(document.activeElement).toBe(document.body)
    expect(frames).toHaveLength(0)
    expect(scrollTo).not.toHaveBeenCalled()
  })

  it('a heading that is a name is kept from page translators', () => {
    open({ title: 'HumanBench', focus: false, translate: 'no' })
    expect(host.querySelector('h1')?.getAttribute('translate')).toBe('no')
    unmount(app!)
    host.remove()
    open({ title: 'Check your device' })
    expect(host.querySelector('h1')?.hasAttribute('translate')).toBe(false)
  })
})

describe('Screen: the tab names the screen (UX-006, WCAG 2.4.2)', () => {
  it('"Honour code · HumanBench" on the honour screen, just "HumanBench" on the welcome screen', () => {
    open({ title: 'Honour code' })
    expect(document.title).toBe('Honour code · HumanBench')
    unmount(app!)
    host.remove()
    open({ title: 'HumanBench', focus: false })
    expect(document.title).toBe('HumanBench')
  })

  it('pageTitle: the product name alone, or the screen then the product name', () => {
    expect(pageTitle('HumanBench')).toBe('HumanBench')
    expect(pageTitle('')).toBe('HumanBench')
    expect(pageTitle('  Up next: Spatial ')).toBe('Up next: Spatial · HumanBench')
    expect(pageTitle('Session complete')).toBe('Session complete · HumanBench')
  })
})
