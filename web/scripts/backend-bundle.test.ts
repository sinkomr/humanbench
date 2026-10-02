/**
 * What the builds ship of the server client (ROADMAP M2.7; DESIGN §11.7): the static fallback is the
 * default build, so a plain production build must contain no trace of supabase-js and never name a
 * server; a build that names one loads supabase-js as a chunk of its own, on demand, after the person
 * has passed the gate, and not through the entry page. Like `dev-routes.test.ts`, these build the real
 * app (minified, in memory) with the variables of the case.
 */

import { fileURLToPath } from 'node:url'
import { build, type Rolldown } from 'vite'
import { afterEach, describe, expect, it } from 'vitest'
import { backendCompiledIn } from '../vite.config'

const WEB = fileURLToPath(new URL('..', import.meta.url))
const VARS = ['VITE_HB_SUPABASE_URL', 'VITE_HB_SUPABASE_ANON_KEY', 'VITE_HB_DEV_ROUTES'] as const
const saved = Object.fromEntries(VARS.map((k) => [k, process.env[k]]))

afterEach(() => {
  for (const k of VARS) {
    if (saved[k] === undefined) delete process.env[k]
    else process.env[k] = saved[k]
  }
})

interface Built {
  readonly chunks: { readonly name: string; readonly code: string; readonly isEntry: boolean; readonly imports: readonly string[]; readonly dynamicImports: readonly string[] }[]
  readonly html: string
  readonly text: string
}

async function appBuild(env: Partial<Record<(typeof VARS)[number], string>>): Promise<Built> {
  for (const k of VARS) delete process.env[k]
  for (const [k, v] of Object.entries(env)) process.env[k] = v
  const result = await build({ configFile: `${WEB}vite.config.ts`, root: WEB, mode: 'production', logLevel: 'silent', build: { write: false } })
  const outputs = (Array.isArray(result) ? result : [result]) as Rolldown.RolldownOutput[]
  const files = outputs.flatMap((o) => o.output)
  const chunks = files.flatMap((c) => (c.type === 'chunk' ? [{ name: c.fileName, code: c.code, isEntry: c.isEntry, imports: c.imports, dynamicImports: c.dynamicImports }] : []))
  const asset = (c: (typeof files)[number]): string => (c.type === 'chunk' ? c.code : typeof c.source === 'string' ? c.source : new TextDecoder().decode(c.source))
  const html = files.filter((f) => f.fileName === 'index.html').map(asset).join('\n')
  return { chunks, html, text: files.map(asset).join('\n') }
}

/** Strings only supabase-js and its parts contain. */
const SUPABASE_MARKERS = ['GoTrueClient', 'PostgrestClient', 'RealtimeClient', 'StorageClient', 'supabase-js-']

describe('backendCompiledIn', () => {
  it('is on in dev and tests, in a build that names a server, and in the Playwright build; off in a plain production build', () => {
    expect(backendCompiledIn('development', {})).toBe(true)
    expect(backendCompiledIn('test', {})).toBe(true)
    expect(backendCompiledIn('production', {})).toBe(false)
    expect(backendCompiledIn('production', { VITE_HB_SUPABASE_URL: '' })).toBe(false)
    expect(backendCompiledIn('production', { VITE_HB_SUPABASE_URL: 'https://x.supabase.co' })).toBe(true)
    expect(backendCompiledIn('production', { VITE_HB_DEV_ROUTES: '1' })).toBe(true)
  })
})

describe('the default build (the static fallback)', () => {
  it('ships no supabase-js and names no server', async () => {
    const b = await appBuild({})
    expect(b.text).toContain('HumanBench')
    for (const m of SUPABASE_MARKERS) expect(b.text, m).not.toContain(m)
    expect(b.text).not.toContain('/rest/v1/')
    expect(b.text).not.toContain('supabase.co')
    expect(b.text).not.toContain('hb_backend') // the dev override is not even compiled in
    expect(b.chunks.every((c) => !c.dynamicImports.some((d) => /supabase/iu.test(d)))).toBe(true)
  }, 120_000)
})

describe('a build that names a server', () => {
  it('loads supabase-js as a chunk of its own, on demand, and not through the entry page', async () => {
    const b = await appBuild({ VITE_HB_SUPABASE_URL: 'https://abcdefgh.supabase.co', VITE_HB_SUPABASE_ANON_KEY: 'sb_publishable_test' })
    const holders = b.chunks.filter((c) => SUPABASE_MARKERS.some((m) => c.code.includes(m)))
    expect(holders.length).toBeGreaterThan(0)
    for (const h of holders) {
      expect(h.isEntry, h.name).toBe(false)
      // nothing the entry reaches by static imports holds it
      const entry = b.chunks.find((c) => c.isEntry && /index/u.test(c.name))!
      const reached = new Set<string>()
      const walk = (name: string): void => {
        if (reached.has(name)) return
        reached.add(name)
        for (const i of b.chunks.find((c) => c.name === name)?.imports ?? []) walk(i)
      }
      walk(entry.name)
      expect(reached.has(h.name), `${h.name} is reached statically from ${entry.name}`).toBe(false)
      expect(b.html).not.toContain(h.name) // and the page does not preload it
    }
    // the entry asks for it by a dynamic import
    expect(b.chunks.some((c) => c.dynamicImports.some((d) => holders.some((h) => h.name === d)))).toBe(true)
    // the URL and the public key are in the build (that is how a deploy names its project); nothing else secret-shaped is
    expect(b.text).toContain('https://abcdefgh.supabase.co')
    expect(b.text).not.toMatch(/service_role|SERVICE_ROLE/u)
  }, 120_000)
})
