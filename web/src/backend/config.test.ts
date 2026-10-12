import fc from 'fast-check'
import { describe, expect, it } from 'vitest'
import { TEXT_AXES } from '../engine/plan-table'
import { isLoopbackHost, keyProblem, normaliseUrl, parseTextAxes, selectBackend, urlProblem } from './config'

const ON = { override: false, compiledIn: true } as const
const KEY = 'sb_publishable_AbC123-xyz'
const URL_OK = 'https://abcdefgh.supabase.co'

describe('selectBackend (M2.7: the static fallback is the default build)', () => {
  it('is static with nothing set', () => {
    expect(selectBackend({}, '', ON)).toEqual({ kind: 'static' })
    expect(selectBackend({ VITE_HB_SUPABASE_URL: '', VITE_HB_SUPABASE_ANON_KEY: '' }, '', ON)).toEqual({ kind: 'static' })
    expect(selectBackend({ VITE_HB_SUPABASE_URL: '  ', VITE_HB_SUPABASE_ANON_KEY: ' ' }, '', ON)).toEqual({ kind: 'static' })
  })

  it('is a server with both set, with the URL tidied', () => {
    const sel = selectBackend({ VITE_HB_SUPABASE_URL: `${URL_OK}/`, VITE_HB_SUPABASE_ANON_KEY: KEY }, '', ON)
    expect(sel).toEqual({ kind: 'server', config: { url: URL_OK, anonKey: KEY }, origin: 'build', textAxes: [] })
  })

  it('is static, with the reason, when only one is set or either is bad', () => {
    expect(selectBackend({ VITE_HB_SUPABASE_URL: URL_OK }, '', ON)).toMatchObject({ kind: 'static', problem: expect.stringContaining('both') })
    expect(selectBackend({ VITE_HB_SUPABASE_ANON_KEY: KEY }, '', ON)).toMatchObject({ kind: 'static', problem: expect.stringContaining('both') })
    expect(selectBackend({ VITE_HB_SUPABASE_URL: 'http://example.com', VITE_HB_SUPABASE_ANON_KEY: KEY }, '', ON)).toMatchObject({ kind: 'static', problem: expect.stringContaining('https') })
    expect(selectBackend({ VITE_HB_SUPABASE_URL: URL_OK, VITE_HB_SUPABASE_ANON_KEY: 'a key' }, '', ON)).toMatchObject({ kind: 'static', problem: expect.stringContaining('key') })
  })

  it('is static when the build does not carry the client, whatever is set', () => {
    expect(selectBackend({ VITE_HB_SUPABASE_URL: URL_OK, VITE_HB_SUPABASE_ANON_KEY: KEY }, '?hb_backend=http://127.0.0.1:1&hb_key=k', { override: true, compiledIn: false })).toEqual({ kind: 'static' })
  })

  describe('the link cannot choose the server in a production build', () => {
    const env = { VITE_HB_SUPABASE_URL: URL_OK, VITE_HB_SUPABASE_ANON_KEY: KEY }
    it('ignores ?hb_backend= unless the build allows it', () => {
      expect(selectBackend(env, '?hb_backend=https://evil.example&hb_key=k', ON)).toMatchObject({ kind: 'server', config: { url: URL_OK } })
      expect(selectBackend({}, '?hb_backend=https://evil.example&hb_key=k', ON)).toEqual({ kind: 'static' })
    })
    it('honours it in a dev or test build, and ?hb_backend=off forces static', () => {
      const dev = { override: true, compiledIn: true } as const
      expect(selectBackend(env, '?hb_backend=http://127.0.0.1:54321&hb_key=anon-key', dev)).toEqual({
        kind: 'server',
        config: { url: 'http://127.0.0.1:54321', anonKey: 'anon-key' },
        origin: 'override',
        textAxes: [],
      })
      expect(selectBackend(env, '?hb_backend=off', dev)).toEqual({ kind: 'static' })
      expect(selectBackend(env, '?other=1', dev)).toMatchObject({ kind: 'server', origin: 'build' })
      expect(selectBackend(env, '?hb_backend=http://example.com&hb_key=k', dev)).toMatchObject({ kind: 'static', problem: expect.any(String) })
    })
  })
})

describe('urls and keys', () => {
  it('accepts https, and http only for this machine', () => {
    for (const u of [URL_OK, 'https://example.org/base', 'http://localhost:54321', 'http://127.0.0.1:3000', 'http://[::1]:3000', 'http://dev.localhost']) expect(urlProblem(u)).toBeNull()
    for (const u of ['http://example.org', 'ftp://example.org', 'javascript:alert(1)', 'example.org', '', 'https://user:pw@example.org', 'https://example.org/?a=1', 'https://example.org/#x', `https://${'a'.repeat(300)}.org`])
      expect(urlProblem(u), u).not.toBeNull()
  })

  it('accepts keys a header can carry and nothing else', () => {
    for (const k of [KEY, 'eyJhbGciOiJIUzI1NiJ9.eyJyb2xlIjoiYW5vbiJ9.c2ln', 'a']) expect(keyProblem(k)).toBeNull()
    for (const k of ['', 'has space', 'new\nline', 'quote"', 'é', 'a'.repeat(5000)]) expect(keyProblem(k), JSON.stringify(k)).not.toBeNull()
  })

  it('strips trailing slashes only', () => {
    expect(normaliseUrl('https://x.org///')).toBe('https://x.org')
    expect(normaliseUrl('https://x.org/a/b')).toBe('https://x.org/a/b')
  })

  it('knows the loopback hosts', () => {
    for (const h of ['localhost', 'LOCALHOST', '127.0.0.1', '[::1]', 'app.localhost']) expect(isLoopbackHost(h)).toBe(true)
    for (const h of ['example.org', '127.0.0.2', 'localhost.evil.org', '10.0.0.1']) expect(isLoopbackHost(h)).toBe(false)
  })

  it('never selects a server whose URL is not acceptable (property)', () => {
    fc.assert(
      fc.property(fc.string({ maxLength: 120 }), fc.string({ maxLength: 60 }), (url, key) => {
        const sel = selectBackend({ VITE_HB_SUPABASE_URL: url, VITE_HB_SUPABASE_ANON_KEY: key }, '', ON)
        if (sel.kind === 'server') {
          expect(urlProblem(sel.config.url)).toBeNull()
          expect(keyProblem(sel.config.anonKey)).toBeNull()
          expect(sel.config.url.endsWith('/')).toBe(false)
        }
      }),
      { numRuns: 500 },
    )
  })
})

describe('the served text parts of a build (M3.11 phase 1)', () => {
  const env = { VITE_HB_SUPABASE_URL: URL_OK, VITE_HB_SUPABASE_ANON_KEY: KEY }
  const dev = { override: true, compiledIn: true } as const

  it('are none unless the build names them: unset, empty, "off" and "none" are the six-part session', () => {
    for (const raw of [undefined, '', '   ', 'off', 'none', 'OFF']) expect(parseTextAxes(raw)).toEqual({ axes: [] })
    expect(selectBackend(env, '', ON)).toMatchObject({ kind: 'server', textAxes: [] })
  })

  it('reads codes in any case, order and separator, in canonical order without repeats, and "all"', () => {
    expect(parseTextAxes('all').axes).toEqual([...TEXT_AXES])
    expect(parseTextAxes('kap, LR  voc,LR').axes).toEqual(['LR', 'VOC', 'KAP'])
    expect(selectBackend({ ...env, VITE_HB_TEXT_AXES: 'KST,KHU' }, '', ON)).toMatchObject({ kind: 'server', origin: 'build', textAxes: ['KST', 'KHU'] })
  })

  it('leaves out a name that is not a text skill and says so, never guessing one', () => {
    const r = parseTextAxes('LR,RC,MAT,bogus')
    expect(r.axes).toEqual(['LR'])
    expect(r.problem).toContain('"RC"')
    expect(r.problem).toContain('"BOGUS"')
    expect(selectBackend({ ...env, VITE_HB_TEXT_AXES: 'RC' }, '', ON)).toMatchObject({ kind: 'server', textAxes: [], textProblem: expect.stringContaining('RC') })
    expect(parseTextAxes('x'.repeat(201))).toEqual({ axes: [], problem: expect.any(String) })
  })

  it('a link sets them only where a link may choose the server (dev and test builds), and never without a server', () => {
    expect(selectBackend(env, '?hb_text=all', ON)).toMatchObject({ kind: 'server', textAxes: [] })
    expect(selectBackend(env, '?hb_text=LR,VOC', dev)).toMatchObject({ kind: 'server', origin: 'build', textAxes: ['LR', 'VOC'] })
    expect(selectBackend({ ...env, VITE_HB_TEXT_AXES: 'all' }, '?hb_text=off', dev)).toMatchObject({ kind: 'server', textAxes: [] })
    expect(selectBackend({}, '?hb_backend=http://127.0.0.1:54321&hb_key=k&hb_text=KAP', dev)).toMatchObject({ kind: 'server', origin: 'override', textAxes: ['KAP'] })
    expect(selectBackend({ VITE_HB_TEXT_AXES: 'all' }, '?hb_text=all', dev)).toEqual({ kind: 'static' })
    expect(selectBackend(env, '?hb_backend=off&hb_text=all', dev)).toEqual({ kind: 'static' })
  })

  it('whatever the text, the result is a list of text skills in canonical order and the call does not throw', () => {
    fc.assert(
      fc.property(fc.string({ maxLength: 60 }), (raw) => {
        const { axes } = parseTextAxes(raw)
        expect(axes).toEqual(TEXT_AXES.filter((k) => axes.includes(k)))
      }),
    )
  })
})
