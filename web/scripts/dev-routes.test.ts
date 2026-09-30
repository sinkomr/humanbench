/**
 * Dev-only routes stay out of production (ROADMAP M1.16: "a dev-only demo route with synthetic
 * profiles for e2e + axe, excluded from production; test").
 *
 * `main.ts` loads `src/dev/routes.ts` only inside `if (__HB_DEV_ROUTES__ && …)`, a constant that
 * vite.config.ts defines as false for a plain production build, so the bundler drops the branch
 * and its dynamic import. The Playwright build sets VITE_HB_DEV_ROUTES=1 to test the demo; the
 * Pages and CI builds must not.
 */

import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { build, type Rolldown } from 'vite'
import { afterEach, describe, expect, it } from 'vitest'
import config from '../playwright.config'
import { FAST_FACTOR } from '../src/session/constants'
import { devRoutesEnabled } from '../vite.config'

const WEB = fileURLToPath(new URL('..', import.meta.url))
const FLAG = 'VITE_HB_DEV_ROUTES'
const saved = process.env[FLAG]

afterEach(() => {
  if (saved === undefined) delete process.env[FLAG]
  else process.env[FLAG] = saved
})

/** A production build of the real app (in memory): its file names and all emitted text. */
async function appBuild(flag: string | undefined): Promise<{ files: string[]; text: string }> {
  if (flag === undefined) delete process.env[FLAG]
  else process.env[FLAG] = flag
  const result = await build({ configFile: `${WEB}vite.config.ts`, root: WEB, mode: 'production', logLevel: 'silent', build: { write: false } })
  const outputs = (Array.isArray(result) ? result : [result]) as Rolldown.RolldownOutput[]
  const chunks = outputs.flatMap((o) => o.output)
  return {
    files: chunks.map((c) => c.fileName),
    text: chunks.map((c) => (c.type === 'chunk' ? c.code : typeof c.source === 'string' ? c.source : new TextDecoder().decode(c.source))).join('\n'),
  }
}

/**
 * `sessionTimeScale` (session/fast.ts) as a build with `__HB_DEV_ROUTES__` = `devRoutes` makes it:
 * the module is bundled on its own (minified, as in production), with the constant defined the way
 * vite.config.ts defines it, and the function is evaluated. This checks what the flag does, not
 * what strings the bundle holds, so a build that honoured `?fast=1` fails whatever its code looks like.
 */
async function builtSessionTimeScale(devRoutes: boolean): Promise<(search: string) => number> {
  const result = await build({
    configFile: false,
    root: WEB,
    mode: 'production',
    logLevel: 'silent',
    define: { __HB_DEV_ROUTES__: JSON.stringify(devRoutes) },
    build: { write: false, minify: true, lib: { entry: `${WEB}src/session/fast.ts`, formats: ['iife'], name: 'HbFast' } },
  })
  const outputs = (Array.isArray(result) ? result : [result]) as Rolldown.RolldownOutput[]
  const chunk = outputs.flatMap((o) => o.output).find((c) => c.type === 'chunk')
  if (chunk?.type !== 'chunk') throw new Error('no chunk built for session/fast.ts')
  const mod = new Function(`${chunk.code}\nreturn HbFast;`)() as { sessionTimeScale: (search: string) => number }
  return mod.sessionTimeScale
}

/**
 * Strings only the dev routes contain, and the dev banner of the `?fast=1` flag (ROADMAP M1.15:
 * "production builds ignore it"): `sessionTimeScale` folds to 1 where `__HB_DEV_ROUTES__` is false,
 * and the banner text goes with it.
 */
const DEV_MARKERS = ['Blob demo (development only)', 'Synthetic profiles scored by the engine', '#/dev/', 'Typical first session', 'Fast mode (development only)']

describe('dev-only routes (M1.16)', () => {
  it('are on in dev and tests, off in production unless VITE_HB_DEV_ROUTES=1', () => {
    expect(devRoutesEnabled('development', {})).toBe(true)
    expect(devRoutesEnabled('test', {})).toBe(true)
    expect(devRoutesEnabled('production', {})).toBe(false)
    expect(devRoutesEnabled('production', { VITE_HB_DEV_ROUTES: '0' })).toBe(false)
    expect(devRoutesEnabled('production', { VITE_HB_DEV_ROUTES: '1' })).toBe(true)
  })

  it('a plain production build ships no dev route, demo page or synthetic profile', async () => {
    const { files, text } = await appBuild(undefined)
    expect(text).toContain('HumanBench')
    expect(files.filter((f) => /BlobDemo|routes|synthetic/i.test(f))).toEqual([])
    for (const m of DEV_MARKERS) expect(text, m).not.toContain(m)
  }, 60_000)

  it('a plain production build ignores ?fast=1: the flag parser and its banner are not shipped (M1.15)', async () => {
    const { text } = await appBuild(undefined)
    expect(text).not.toContain('Fast mode (development only)')
    expect(text).not.toContain('Response times are not valid scores')
  }, 60_000)

  it('the production time scale is 1 whatever the query says; with the dev constant on, ?fast=1 is 20 (M1.15, behaviour)', async () => {
    const production = await builtSessionTimeScale(false)
    for (const q of ['?fast=1', '?fast=true', '?a=b&fast=1', '', '?fast=0']) expect(production(q), `production ${q}`).toBe(1)
    // Not vacuous: the same module built with the constant on does honour the flag.
    const dev = await builtSessionTimeScale(true)
    expect(dev('?fast=1')).toBe(FAST_FACTOR)
    expect(dev('?fast=true')).toBe(FAST_FACTOR)
    expect(dev('')).toBe(1)
    expect(dev('?fast=0')).toBe(1)
  }, 60_000)

  it('the e2e build (VITE_HB_DEV_ROUTES=1) does ship them, so the check above is not vacuous', async () => {
    const { files, text } = await appBuild('1')
    expect(files.some((f) => /BlobDemo/.test(f))).toBe(true)
    for (const m of DEV_MARKERS) expect(text, m).toContain(m)
  }, 60_000)

  it('only the Playwright build turns them on: not the Pages deploy, not the CI build', () => {
    const server = Array.isArray(config.webServer) ? config.webServer[0] : config.webServer
    expect(server?.env?.[FLAG]).toBe('1')
    for (const wf of ['pages.yml', 'ci.yml']) expect(readFileSync(`${WEB}../.github/workflows/${wf}`, 'utf8'), wf).not.toContain(FLAG)
    expect(readFileSync(`${WEB}package.json`, 'utf8')).not.toContain(FLAG)
  })
})
