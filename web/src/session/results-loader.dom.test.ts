/**
 * The loader of the results chunk (UX-100; `results-loader.ts`): memoised, retried with backoff, a fresh URL
 * for the retries once a failure has named the chunk (Chromium keeps failed module fetches), nothing asked
 * for while the browser is offline, and failed stylesheets put back before a retry. jsdom, for the
 * stylesheet part; the flow around it is in `SessionApp.flow.dom.test.ts` and `e2e/ux2-perf.spec.ts`.
 */

import fc from 'fast-check'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createResultsLoader, failedChunkPreload, failedModuleUrl, OfflineError, restyleFailed, RESULTS_CHUNK_FILE, RETRY_DELAYS_MS, resultsLoader, type ResultsModule } from './results-loader'

const MODULE = { default: (() => null) as unknown } as unknown as ResultsModule
const CHROMIUM = (url: string): Error => new TypeError(`Failed to fetch dynamically imported module: ${url}`)
const BASE = 'https://example.org/humanbench/'

afterEach(() => {
  document.head.innerHTML = ''
})

describe('failedModuleUrl', () => {
  it('reads the chunk URL out of a Chromium or Firefox error, without its query', () => {
    expect(failedModuleUrl(CHROMIUM('https://example.org/humanbench/assets/Finished-abc.js'), BASE)).toBe('https://example.org/humanbench/assets/Finished-abc.js')
    expect(failedModuleUrl(CHROMIUM('https://example.org/humanbench/assets/Finished-abc.js?retry=3'), BASE)).toBe('https://example.org/humanbench/assets/Finished-abc.js')
    expect(failedModuleUrl(new TypeError('error loading dynamically imported module: https://example.org/a/Finished-x.js'), BASE)).toBe('https://example.org/a/Finished-x.js')
  })

  it('is null for WebKit (no URL), another origin, something that is not a script, or no error at all', () => {
    expect(failedModuleUrl(new TypeError('Importing a module script failed.'), BASE)).toBeNull()
    expect(failedModuleUrl(CHROMIUM('https://evil.example/assets/Finished-abc.js'), BASE)).toBeNull()
    expect(failedModuleUrl(new Error('Unable to preload CSS for https://example.org/humanbench/assets/Finished-abc.css'), BASE)).toBeNull()
    expect(failedModuleUrl(undefined, BASE)).toBeNull()
  })
})

describe('createResultsLoader', () => {
  it('memoises: one import for any number of calls, and the module is at hand synchronously after', async () => {
    const importer = vi.fn(async () => MODULE)
    const loader = createResultsLoader({ importer, online: () => true })
    expect(loader.current()).toBeNull()
    const [a, b] = await Promise.all([loader.load(), loader.load()])
    expect(a).toBe(MODULE)
    expect(b).toBe(MODULE)
    expect(await loader.load()).toBe(MODULE)
    expect(loader.current()).toBe(MODULE)
    expect(importer).toHaveBeenCalledTimes(1)
  })

  it('retries after each delay; after the last it rejects, and the next call starts afresh (property)', async () => {
    await fc.assert(
      fc.asyncProperty(fc.array(fc.integer({ min: 1, max: 5000 }), { maxLength: 4 }), fc.integer({ min: 0, max: 6 }), async (delays, failures) => {
        let calls = 0
        const waits: number[] = []
        const importer = async (): Promise<ResultsModule> => {
          calls++
          if (calls <= failures) throw new TypeError('Importing a module script failed.')
          return MODULE
        }
        const loader = createResultsLoader({ importer, delays, sleep: async (ms) => void waits.push(ms), beforeRetry: async () => undefined, online: () => true })
        const attempts = delays.length + 1
        if (failures < attempts) {
          expect(await loader.load()).toBe(MODULE)
          expect(calls).toBe(failures + 1)
          expect(waits).toEqual(delays.slice(0, failures))
        } else {
          await expect(loader.load()).rejects.toThrow('Importing a module script failed.')
          expect(calls).toBe(attempts)
          expect(waits).toEqual(delays)
          expect(loader.current()).toBeNull()
          // The memo is cleared: "Try again" makes a new round of attempts.
          const again = loader.load().catch(() => null)
          await again
          expect(calls).toBeGreaterThan(attempts)
        }
      }),
      { numRuns: 60 },
    )
  })

  it('waits about five seconds in all before it gives up (four attempts)', () => {
    expect(RETRY_DELAYS_MS).toHaveLength(3)
    const total = RETRY_DELAYS_MS.reduce((a, b) => a + b, 0)
    expect(total).toBeGreaterThanOrEqual(3000)
    expect(total).toBeLessThanOrEqual(8000)
  })

  it('once an error names the chunk, every retry imports it under a fresh URL (Chromium keeps failed fetches)', async () => {
    const url = 'https://example.org/humanbench/assets/Finished-abc.js'
    const importer = vi.fn(async (): Promise<ResultsModule> => {
      throw CHROMIUM(url)
    })
    const byUrl: string[] = []
    const importUrl = vi.fn(async (u: string): Promise<ResultsModule> => {
      byUrl.push(u)
      if (byUrl.length < 3) throw CHROMIUM(u)
      return MODULE
    })
    const loader = createResultsLoader({ importer, importUrl, delays: [0, 0], sleep: async () => undefined, beforeRetry: async () => undefined, online: () => true, baseUrl: () => BASE })
    await expect(loader.load()).rejects.toThrow('Failed to fetch')
    expect(importer).toHaveBeenCalledTimes(1)
    expect(byUrl).toEqual([`${url}?retry=1`, `${url}?retry=2`])
    expect(await loader.load()).toBe(MODULE)
    expect(byUrl).toEqual([`${url}?retry=1`, `${url}?retry=2`, `${url}?retry=3`])
    expect(importer).toHaveBeenCalledTimes(1)
  })

  it('an error that names another file does not redirect the retries', async () => {
    let calls = 0
    const importer = async (): Promise<ResultsModule> => {
      if (++calls === 1) throw CHROMIUM('https://example.org/humanbench/assets/brief-gates-x1.js')
      return MODULE
    }
    const importUrl = vi.fn()
    const loader = createResultsLoader({ importer, importUrl, delays: [0], sleep: async () => undefined, beforeRetry: async () => undefined, online: () => true, baseUrl: () => BASE, failedChunk: () => null })
    expect(await loader.load()).toBe(MODULE)
    expect(importUrl).not.toHaveBeenCalled()
  })

  it('without a URL in the error, the chunk\'s failed modulepreload gives it (WebKit keeps that failure too)', async () => {
    const url = 'https://example.org/humanbench/assets/Finished-abc.js'
    const importer = vi.fn(async (): Promise<ResultsModule> => {
      throw new TypeError('Importing a module script failed.')
    })
    const importUrl = vi.fn(async (): Promise<ResultsModule> => MODULE)
    const loader = createResultsLoader({ importer, importUrl, delays: [0], sleep: async () => undefined, beforeRetry: async () => undefined, online: () => true, failedChunk: () => url })
    expect(await loader.load()).toBe(MODULE)
    expect(importer).toHaveBeenCalledTimes(1)
    expect(importUrl.mock.calls).toEqual([[`${url}?retry=1`]])
  })

  it('without a URL in the error or a failed preload (a WebKit without modulepreload) the same import is retried', async () => {
    let calls = 0
    const importer = async (): Promise<ResultsModule> => {
      if (++calls === 1) throw new TypeError('Importing a module script failed.')
      return MODULE
    }
    const importUrl = vi.fn()
    const loader = createResultsLoader({ importer, importUrl, delays: [0], sleep: async () => undefined, beforeRetry: async () => undefined, online: () => true, baseUrl: () => BASE, failedChunk: () => null })
    expect(await loader.load()).toBe(MODULE)
    expect(calls).toBe(2)
    expect(importUrl).not.toHaveBeenCalled()
  })

  it('asks for nothing while the browser is offline, and loads once it is back', async () => {
    let online = false
    const importer = vi.fn(async () => MODULE)
    const loader = createResultsLoader({ importer, delays: [0, 0], sleep: async () => undefined, beforeRetry: async () => undefined, online: () => online })
    await expect(loader.load()).rejects.toBeInstanceOf(OfflineError)
    expect(importer).not.toHaveBeenCalled()
    online = true
    expect(await loader.load()).toBe(MODULE)
    expect(importer).toHaveBeenCalledTimes(1)
  })

  it('puts back failed stylesheets before each retry, not before the first attempt', async () => {
    const order: string[] = []
    let n = 0
    const importer = async (): Promise<ResultsModule> => {
      order.push('import')
      if (++n < 3) throw new TypeError('Importing a module script failed.')
      return MODULE
    }
    const loader = createResultsLoader({ importer, delays: [0, 0], sleep: async () => undefined, beforeRetry: async () => void order.push('restyle'), online: () => true })
    await loader.load()
    expect(order).toEqual(['import', 'restyle', 'import', 'restyle', 'import'])
  })

  it('the page has one loader, which imports the real results component', async () => {
    const m = await resultsLoader.load()
    expect(typeof m.default).toBe('function')
    expect(resultsLoader.current()).toBe(m)
  }, 90_000)
})

describe('failedChunkPreload', () => {
  it('names the results chunk once its modulepreload link fails, and no other chunk', () => {
    void resultsLoader // the page's loader watches the document's error events
    expect(failedChunkPreload()).toBeNull()
    const preload = (href: string): HTMLLinkElement => {
      const link = document.createElement('link')
      link.rel = 'modulepreload'
      link.href = href
      document.head.appendChild(link)
      return link
    }
    preload('https://example.org/humanbench/assets/brief-gates-x1.js').dispatchEvent(new Event('error'))
    expect(failedChunkPreload()).toBeNull()
    preload('https://example.org/humanbench/assets/Finished-Ab_9-z.js').dispatchEvent(new Event('error'))
    expect(failedChunkPreload()).toBe('https://example.org/humanbench/assets/Finished-Ab_9-z.js')
    expect(RESULTS_CHUNK_FILE.test('/humanbench/assets/Finished-VVAL7Gd3.js')).toBe(true)
    expect(RESULTS_CHUNK_FILE.test('/humanbench/assets/Finished-VVAL7Gd3.css')).toBe(false)
  })
})

describe('restyleFailed', () => {
  function sheet(href: string): HTMLLinkElement {
    const link = document.createElement('link')
    link.rel = 'stylesheet'
    link.crossOrigin = ''
    link.href = href
    document.head.appendChild(link)
    return link
  }
  const links = (): string[] => [...document.head.querySelectorAll('link')].map((l) => new URL(l.href).pathname)

  it('adds a stylesheet that failed again, in its place, and drops the failed one when the new one loads', async () => {
    // The page's loader watches the document's `error` events (capture: they do not bubble).
    void resultsLoader
    sheet('/a.css')
    const failed = sheet('/b.css')
    sheet('/c.css')
    failed.dispatchEvent(new Event('error'))
    const done = restyleFailed()
    const fresh = document.head.querySelectorAll('link')[2] as HTMLLinkElement
    expect(links()).toEqual(['/a.css', '/b.css', '/b.css', '/c.css'])
    expect(fresh).not.toBe(failed)
    expect(fresh.hasAttribute('crossorigin')).toBe(true) // as Vite's helper adds it
    fresh.dispatchEvent(new Event('load'))
    await done
    expect(links()).toEqual(['/a.css', '/b.css', '/c.css'])
    expect(failed.isConnected).toBe(false)
    // Nothing failed since: nothing to do.
    await restyleFailed()
    expect(links()).toEqual(['/a.css', '/b.css', '/c.css'])
  })

  it('rejects when the stylesheet fails again, and keeps it for the next retry', async () => {
    const failed = sheet('/d.css')
    failed.dispatchEvent(new Event('error'))
    const first = restyleFailed()
    const fresh = document.head.querySelectorAll('link')[1] as HTMLLinkElement
    fresh.dispatchEvent(new Event('error'))
    await expect(first).rejects.toThrow('d.css')
    expect(links()).toEqual(['/d.css'])
    const second = restyleFailed()
    const again = document.head.querySelectorAll('link')[1] as HTMLLinkElement
    again.dispatchEvent(new Event('load'))
    await second
    expect(links()).toEqual(['/d.css'])
    expect(document.head.querySelector('link')).toBe(again)
  })
})
