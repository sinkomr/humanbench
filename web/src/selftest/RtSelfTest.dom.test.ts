/**
 * The RT timing self-test page as a person meets it (ROADMAP M1.23; UX review UX-054, UX-055): plain
 * words, a way back to the app, a Start button that keeps focus while a run is going, key names the
 * translator leaves alone, copy messages in one pattern. The run is driven by a fake display (frames
 * on a timer, 60 Hz on the frame clock), so the whole flow takes about a second of real time.
 */

import { flushSync } from 'svelte'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { buttonByText, click, pointerDown } from '../render/common/testing'
import { mountInto, type Mounted } from '../render/dom-testing'
import RtSelfTest from './RtSelfTest.svelte'
import { EVENT_CLOCK_NOTE, EVENT_OFFSET_NOTE, INPUT_LATENCY_NOTE, QUICK_PLAN } from './measure'

const display = vi.hoisted(() => ({ requests: 0, now: 1000 }))

vi.mock('../tasks/rt/timing', async (importOriginal) => {
  const real = await importOriginal<typeof import('../tasks/rt/timing')>()
  return {
    ...real,
    browserFrameSource: () => ({
      request: (cb: (ts: number) => void) => {
        display.requests += 1
        return window.setTimeout(() => {
          display.now += 1000 / 60
          cb(display.now)
        }, 0)
      },
      cancel: (h: number) => window.clearTimeout(h),
    }),
  }
})

let mounted: Mounted | undefined
beforeEach(() => {
  display.requests = 0
  display.now = 1000
})
afterEach(() => {
  mounted?.destroy()
  mounted = undefined
  vi.restoreAllMocks()
})

const root = (): HTMLElement => (mounted as Mounted).target
const startButton = (): HTMLButtonElement => root().querySelector('.controls button') as HTMLButtonElement
const status = (): string => root().querySelector('#selftest-status')?.textContent?.trim() ?? ''

async function waitFor(done: () => boolean, what: string, timeoutMs = 20_000): Promise<void> {
  const t0 = performance.now()
  while (!done()) {
    if (performance.now() - t0 > timeoutMs) throw new Error(`timed out waiting for ${what}`)
    await new Promise((r) => setTimeout(r, 5))
    flushSync()
  }
}
const heading = (name: string): HTMLElement | undefined => [...root().querySelectorAll<HTMLElement>('h2')].find((h) => h.textContent === name)

function mountQuick(): void {
  mounted = mountInto(RtSelfTest, { quick: true })
}

/** Start with the keyboard's focus on the button, as a keyboard user has it, and wait for the key phase. */
async function startToKeys(clicks = 1): Promise<void> {
  const b = startButton()
  b.focus()
  for (let i = 0; i < clicks; i++) click(b)
  await waitFor(() => heading('Key presses') !== undefined, 'the key-press phase')
}

describe('RtSelfTest: the page before a run', () => {
  it('has a link back to the app under the base path, with the brand name left untranslated', () => {
    mountQuick()
    const link = root().querySelector<HTMLAnchorElement>('header a')
    expect(link?.textContent?.trim()).toBe('HumanBench')
    expect(link?.getAttribute('href')).toBe(import.meta.env.BASE_URL)
    expect(link?.getAttribute('href')?.endsWith('/')).toBe(true)
    expect(link?.getAttribute('translate')).toBe('no')
    expect(root().querySelectorAll('header, main, footer')).toHaveLength(3)
  })

  it('keeps the page and heading name (the routes and tests look for it) and says nothing is saved or sent', () => {
    mountQuick()
    expect(root().querySelector('h1')?.textContent).toBe('RT timing self-test')
    expect(root().querySelector('main')?.textContent).toContain('Nothing is saved or sent.')
  })

  it('reads in short sentences: none over 25 words, and the measurements are a list', () => {
    mountQuick()
    expect(root().querySelectorAll('main ul li').length).toBeGreaterThanOrEqual(4)
    const text = [...root().querySelectorAll('main p, main li')].map((p) => p.textContent ?? '').join(' ')
    const sentences = text.split(/(?<=[.;:])\s+/).filter((s) => s.trim() !== '')
    expect(sentences.length).toBeGreaterThan(5)
    for (const s of sentences) expect(s.split(/\s+/).length, s).toBeLessThanOrEqual(25)
  })

  it('uses plain words: no developer names, and the input delays are "for information only"', () => {
    mountQuick()
    const text = root().textContent ?? ''
    expect(text).not.toMatch(/event\.timeStamp|performance\.now|dispatch|Informational/)
    expect(text).toContain('for information only')
    expect(text).toContain('time stamp of the press itself')
  })

  it('has a Start button that is a real, enabled button with a polite status line it is described by', () => {
    mountQuick()
    const b = startButton()
    expect(b.disabled).toBe(false)
    expect(b.hasAttribute('aria-disabled')).toBe(false)
    expect(b.getAttribute('aria-describedby')).toBe('selftest-status')
    const live = root().querySelector('#selftest-status')
    expect(live?.getAttribute('role')).toBe('status')
  })
})

describe('RtSelfTest: Start keeps focus during the run (WCAG 2.4.3)', () => {
  it('stays focused, stays in the Tab order (not disabled) and is marked aria-disabled until the key phase', async () => {
    mountQuick()
    const b = startButton()
    b.focus()
    click(b)
    expect(status()).toMatch(/^Measuring the display refresh/)
    expect(b.disabled).toBe(false)
    expect(b.getAttribute('aria-disabled')).toBe('true')
    expect(document.activeElement).toBe(b)
    await waitFor(() => status().startsWith('Timing stimulus onsets'), 'the onset trials')
    expect(document.activeElement).toBe(b)
    expect(document.activeElement).not.toBe(document.body)
    await waitFor(() => heading('Key presses') !== undefined, 'the key-press phase')
    // The key phase takes over: the prompt has the focus.
    expect(document.activeElement).toBe(root().querySelector('.zone'))
  })

  it('a press on Start while a run is going does nothing (one run, not two)', async () => {
    mountQuick()
    await startToKeys(1)
    const one = display.requests
    expect(one).toBeGreaterThan(QUICK_PLAN.frames)
    mounted?.destroy()
    mounted = undefined
    display.requests = 0
    display.now = 1000
    mountQuick()
    const b = startButton()
    b.focus()
    click(b)
    click(b)
    click(b)
    await waitFor(() => heading('Key presses') !== undefined, 'the key-press phase')
    expect(display.requests).toBe(one)
  })

  it('is back to a plain Run again button once the results are there, and then it works again', async () => {
    mountQuick()
    await startToKeys()
    click(buttonByText(root(), 'Skip: no keyboard'))
    await waitFor(() => heading('Pointer presses') !== undefined, 'the pointer phase')
    click(buttonByText(root(), 'Skip: no mouse or touch'))
    flushSync()
    await waitFor(() => heading('Results') !== undefined, 'the results')
    const again = startButton()
    expect(again.textContent?.trim()).toBe('Run again')
    expect(again.hasAttribute('aria-disabled')).toBe(false)
    await waitFor(() => document.activeElement === heading('Results'), 'focus on the Results heading')
    again.focus()
    click(again)
    expect(heading('Results')).toBeUndefined()
    expect(again.getAttribute('aria-disabled')).toBe('true')
    expect(document.activeElement).toBe(again)
    await waitFor(() => heading('Key presses') !== undefined, 'the second key-press phase')
  })
})

describe('RtSelfTest: the key prompt', () => {
  it('names the key as the app does ("Space bar") and keeps it out of the translator', async () => {
    mountQuick()
    await startToKeys()
    const zone = root().querySelector<HTMLElement>('.zone')
    expect(zone?.textContent?.replace(/\s+/g, ' ').trim()).toBe(`Press the Space bar ${QUICK_PLAN.presses} times, at your own pace (0 of ${QUICK_PLAN.presses}).`)
    const kbd = zone?.querySelector('kbd')
    expect(kbd?.textContent).toBe('Space bar')
    expect(kbd?.getAttribute('translate')).toBe('no')
  })
})

describe('RtSelfTest: the results', () => {
  async function toResults(): Promise<void> {
    await startToKeys()
    for (let i = 0; i < QUICK_PLAN.presses; i++) window.dispatchEvent(new KeyboardEvent('keydown', { key: ' ', bubbles: true, cancelable: true }))
    flushSync()
    await waitFor(() => heading('Pointer presses') !== undefined, 'the pointer phase')
    const target = buttonByText(root(), 'Tap target')
    for (let i = 0; i < QUICK_PLAN.presses; i++) pointerDown(target)
    flushSync()
    await waitFor(() => heading('Results') !== undefined, 'the results')
  }

  it('marks every number cell and the n column, so phones can keep numbers on one line and drop n', async () => {
    mountQuick()
    await toResults()
    const rows = [...root().querySelectorAll('tbody tr')]
    expect(rows).toHaveLength(7)
    for (const tr of rows) {
      expect(tr.querySelector('th[scope="row"]')?.classList.contains('name')).toBe(true)
      expect([...tr.querySelectorAll('td.num')].map((c) => c.classList.contains('n'))).toEqual([false, false, false, true])
      expect(tr.querySelectorAll('td')).toHaveLength(5)
      expect(tr.lastElementChild?.classList.contains('result')).toBe(true)
    }
    // On a phone the result moves under the name (the Result column is hidden there): the same words, once in each place.
    for (const tr of rows) {
      const verdict = tr.querySelector('th .verdict')
      expect(verdict?.textContent, tr.textContent ?? '').toBe(tr.querySelector('td.result')?.textContent)
      expect(verdict?.classList.contains('pass')).toBe(tr.querySelector('td.result')?.classList.contains('pass'))
    }
    const heads = [...root().querySelectorAll('thead th')]
    expect(heads.map((h) => h.textContent)).toEqual(['Check', 'p50', 'p95', 'Max', 'n', 'Result'])
    expect(heads.map((h) => [...h.classList].filter((c) => !c.startsWith('svelte-')).join(' '))).toEqual(['name', 'num', 'num', 'num', 'num n', 'result'])
    expect(root().querySelector('caption')?.textContent).toContain('n is the number of samples')
    // The Result column says "For information" for the delays; the names say, in short words, when a delay is checked.
    expect(rows.map((r) => r.querySelector('th')?.firstChild?.textContent)).toEqual([
      'Frame interval',
      'Frame interval jitter',
      'Timer resolution',
      'Stimulus onset error',
      'Wait from onset target to next frame',
      'Key press handling delay (checked only if press time stamps are offset)',
      'Pointer press handling delay (checked only if press time stamps are offset)',
    ])
  })

  it('writes the notes of the copied report in plain words', async () => {
    mountQuick()
    await toResults()
    const report = JSON.parse((root().querySelector('textarea') as HTMLTextAreaElement).value) as { metrics: Record<string, { note?: string }> }
    // jsdom's synthetic events carry no performance.now() time stamp (an epoch key time, a zero pointer time), so the run
    // reports a fallback note; all three notes are plain words.
    for (const k of ['key_latency_ms', 'pointer_latency_ms']) {
      const note = report.metrics[k]?.note ?? ''
      expect([INPUT_LATENCY_NOTE, EVENT_CLOCK_NOTE, EVENT_OFFSET_NOTE], k).toContain(note)
      expect(note, k).not.toMatch(/\bRT\b|event\.timeStamp|performance\.now|dispatch|Informational/)
    }
  })

  /** A run whose presses carry time stamps `lagMs` before the page handles them (a browser clock offset when large). */
  async function toResultsWithLag(lagMs: number): Promise<void> {
    await startToKeys()
    for (let i = 0; i < QUICK_PLAN.presses; i++) {
      const ev = new KeyboardEvent('keydown', { key: ' ', bubbles: true, cancelable: true })
      Object.defineProperty(ev, 'timeStamp', { value: performance.now() - lagMs })
      window.dispatchEvent(ev)
    }
    flushSync()
    await waitFor(() => heading('Pointer presses') !== undefined, 'the pointer phase')
    const target = buttonByText(root(), 'Tap target')
    for (let i = 0; i < QUICK_PLAN.presses; i++) pointerDown(target, 'mouse', performance.now() - lagMs)
    flushSync()
    await waitFor(() => heading('Results') !== undefined, 'the results')
  }

  const delayRows = (): HTMLTableRowElement[] => [...root().querySelectorAll<HTMLTableRowElement>('tbody tr')].slice(5)
  const warnings = (): string[] => [...root().querySelectorAll('.warn')].map((p) => p.textContent?.trim() ?? '')
  const reportOf = <T,>(): T => JSON.parse((root().querySelector('textarea') as HTMLTextAreaElement).value) as T

  it('press time stamps offset beyond the bound (Safari): a short Fail in the row, the reason in plain words above the table', async () => {
    mountQuick()
    await toResultsWithLag(205)
    for (const tr of delayRows()) {
      expect(tr.querySelector('td.result')?.textContent, tr.textContent ?? '').toBe('Fail: offset time stamps')
      expect(tr.querySelector('th .verdict')?.textContent).toBe('Fail: offset time stamps')
      expect(tr.querySelector('td.result')?.classList.contains('over')).toBe(true)
    }
    expect(warnings()).toContain(EVENT_OFFSET_NOTE)
    expect(root().querySelector('.overall strong')?.textContent).toBe('Fail')
    const report = reportOf<{
      report_version: string
      event_lag: { max_ms: number; key_rt_source: string | null; pointer_rt_source: string | null }
      metrics: Record<string, { pass: boolean | null; note?: string }>
    }>()
    expect(report.report_version).toBe('rt_selftest_v3')
    expect(report.event_lag).toEqual({ max_ms: 25, key_rt_source: 'handler', pointer_rt_source: 'handler' })
    for (const k of ['key_latency_ms', 'pointer_latency_ms']) expect(report.metrics[k], k).toMatchObject({ pass: false, note: EVENT_OFFSET_NOTE })
    // Plain words on the page (the page's own name, "RT timing self-test", is kept: the routes and tests look for it).
    const visible = (root().querySelector('main')?.textContent ?? '').replace('RT timing self-test', '')
    expect(visible).not.toMatch(/\bRT\b|performance\.now|dispatch|handler/)
  })

  it('press time stamps on the timer (a few ms of delay): the delays stay "For information" and no offset reason is shown', async () => {
    mountQuick()
    await toResultsWithLag(3)
    for (const tr of delayRows()) expect(tr.querySelector('td.result')?.textContent, tr.textContent ?? '').toBe('For information')
    expect(warnings()).not.toContain(EVENT_OFFSET_NOTE)
    const report = reportOf<{ event_lag: { key_rt_source: string | null; pointer_rt_source: string | null }; metrics: Record<string, { note?: string }> }>()
    expect(report.event_lag).toMatchObject({ key_rt_source: 'event', pointer_rt_source: 'event' })
    expect(report.metrics.key_latency_ms?.note).toBe(INPUT_LATENCY_NOTE)
  })

  it('says "Report copied." after a copy', async () => {
    mountQuick()
    await toResults()
    const writeText = vi.fn(async () => undefined)
    vi.stubGlobal('navigator', { clipboard: { writeText } })
    click(buttonByText(root(), 'Copy JSON'))
    await waitFor(() => (root().querySelector('.controls span[role="status"]')?.textContent ?? '') !== '', 'the copy message')
    expect(writeText).toHaveBeenCalledOnce()
    expect(root().querySelector('.controls span[role="status"]')?.textContent).toBe('Report copied.')
    vi.unstubAllGlobals()
  })

  it('says what happened, where the text is and what to do when copying is blocked, and selects the report', async () => {
    mountQuick()
    await toResults()
    vi.stubGlobal('navigator', {
      clipboard: {
        writeText: async () => {
          throw new Error('blocked')
        },
      },
    })
    click(buttonByText(root(), 'Copy JSON'))
    await waitFor(() => (root().querySelector('.controls span[role="status"]')?.textContent ?? '') !== '', 'the copy message')
    expect(root().querySelector('.controls span[role="status"]')?.textContent).toBe('Copying was blocked. The report is selected: copy it yourself.')
    const box = root().querySelector('textarea') as HTMLTextAreaElement
    expect([box.selectionStart, box.selectionEnd]).toEqual([0, box.value.length])
    vi.unstubAllGlobals()
  })
})
