/**
 * How the Pages deploy gets its server (ROADMAP M2.6, M2.7; DESIGN §11.2, §15; R-12.1): the build step
 * of `pages.yml` takes the project's URL and anon key from repository variables, so the repository
 * names no project, an unset variable gives the static version (the empty strings GitHub passes for
 * it select no server and compile none in), and nothing secret is ever given to a build whose every
 * byte is served to every visitor.
 */

import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { selectBackend } from '../src/backend/config'
import { backendCompiledIn } from '../vite.config'

const ROOT = fileURLToPath(new URL('../..', import.meta.url))
const pages = readFileSync(`${ROOT}.github/workflows/pages.yml`, 'utf8')
const ci = readFileSync(`${ROOT}.github/workflows/ci.yml`, 'utf8')

describe('the Pages build and the server', () => {
  it('passes the two public values from repository variables to the build step, and only there', () => {
    const build = pages.slice(pages.indexOf('- run: npm run build'))
    const env = build.slice(0, build.indexOf('- uses:'))
    expect(env).toContain('VITE_HB_SUPABASE_URL: ${{ vars.HB_SUPABASE_URL }}')
    expect(env).toContain('VITE_HB_SUPABASE_ANON_KEY: ${{ vars.HB_SUPABASE_ANON_KEY }}')
    expect(pages.match(/VITE_HB_SUPABASE_/gu)).toHaveLength(2)
  })

  it('names no project, no key and no secret', () => {
    expect(pages).not.toMatch(/secrets\./u)
    for (const wf of [pages, ci]) {
      expect(wf).not.toMatch(/supabase\.(co|com|in)\b/u)
      expect(wf).not.toMatch(/sb_(publishable|secret)_|eyJ[A-Za-z0-9_-]{10,}/u) // a key's shape
      expect(wf).not.toMatch(/SERVICE_ROLE|SUPABASE_DB_URL/u) // a variable that would carry a secret
    }
    // CI builds and tests the static version: it is given no server.
    expect(ci).not.toContain('VITE_HB_SUPABASE_')
  })

  it('is the static version while a variable is unset (GitHub passes an empty string for it)', () => {
    const on = { override: false, compiledIn: true }
    expect(backendCompiledIn('production', { VITE_HB_SUPABASE_URL: '', VITE_HB_SUPABASE_ANON_KEY: '' })).toBe(false)
    expect(selectBackend({ VITE_HB_SUPABASE_URL: '', VITE_HB_SUPABASE_ANON_KEY: '' }, '', on)).toEqual({ kind: 'static' })
    // One of the two set is a mistake: still static, with the reason (config.ts), never half a server.
    expect(selectBackend({ VITE_HB_SUPABASE_URL: 'https://example.test', VITE_HB_SUPABASE_ANON_KEY: '' }, '', on).kind).toBe('static')
    expect(selectBackend({ VITE_HB_SUPABASE_URL: '', VITE_HB_SUPABASE_ANON_KEY: 'k' }, '', on).kind).toBe('static')
    // Both set: the server, and a link cannot point a production page elsewhere.
    const both = { VITE_HB_SUPABASE_URL: 'https://example.test/', VITE_HB_SUPABASE_ANON_KEY: 'sb_publishable_x' }
    expect(selectBackend(both, '?hb_backend=https://evil.test&hb_key=k', on)).toEqual({ kind: 'server', config: { url: 'https://example.test', anonKey: 'sb_publishable_x' }, origin: 'build' })
  })
})
