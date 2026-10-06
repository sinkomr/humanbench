/**
 * The optional outside scoring service is a stub and it is off (ROADMAP M6.4; DESIGN §5.4, §8): the flag is the constant
 * false, the request rejects and has no network code behind it, the consent starts 'off', and no source of the task or its
 * renderers (outside this file's tests) contains a network API or names the service in code.
 */

import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'
import { fileURLToPath } from 'node:url'
import ts from 'typescript'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { mayUseOcsai, OCSAI_CONSENT_DEFAULT, OCSAI_ENABLED, OcsaiDisabledError, requestOcsaiScores, type OcsaiConsent } from './ocsai'

afterEach(() => {
  vi.restoreAllMocks()
})

describe('the outside scoring stub', () => {
  it('is off: the flag is the literal false and the consent starts off', () => {
    expect(OCSAI_ENABLED).toBe(false)
    expect(OCSAI_CONSENT_DEFAULT).toBe('off')
  })

  it('rejects with an OcsaiDisabledError, takes no arguments, and never touches the network', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch')
    expect(requestOcsaiScores.length).toBe(0)
    const result = requestOcsaiScores()
    expect(result).toBeInstanceOf(Promise)
    await expect(result).rejects.toBeInstanceOf(OcsaiDisabledError)
    await expect(requestOcsaiScores()).rejects.toMatchObject({ name: 'OcsaiDisabledError', message: 'The outside scoring service is not offered.' })
    expect(new OcsaiDisabledError()).toBeInstanceOf(Error)
    expect(fetchSpy).not.toHaveBeenCalled()
  })

  it('allows sending only with the flag on and a yes: never in a build, since the flag is false', () => {
    const consents: OcsaiConsent[] = ['off', 'on']
    for (const c of consents) expect(mayUseOcsai(c), c).toBe(false)
    expect(mayUseOcsai('on', true)).toBe(true)
    expect(mayUseOcsai('off', true)).toBe(false)
    expect(mayUseOcsai('on', false)).toBe(false)
  })
})

// ---------------------------------------------------------------------------------------- the source scan

const WEB = fileURLToPath(new URL('../../../', import.meta.url))
const SCANNED = [join(WEB, 'src/tasks/aut'), join(WEB, 'src/render/aut')]

/** What may not be in the code of the task or its renderers: a way to send a text anywhere, and the service's name. */
const FORBIDDEN: readonly { readonly name: string; readonly re: RegExp }[] = [
  { name: 'fetch(', re: /\bfetch\s*\(/ },
  { name: 'XMLHttpRequest', re: /XMLHttpRequest/ },
  { name: 'sendBeacon', re: /sendBeacon/ },
  { name: 'WebSocket', re: /WebSocket/ },
  { name: 'EventSource', re: /EventSource/ },
  { name: 'openscoring', re: /openscoring/i },
]

function sourceFiles(dir: string): string[] {
  const out: string[] = []
  for (const name of readdirSync(dir)) {
    const full = join(dir, name)
    if (statSync(full).isDirectory()) out.push(...sourceFiles(full))
    else if (/\.(ts|svelte)$/.test(name) && !/\.(test|spec)\./.test(name)) out.push(full)
  }
  return out.sort()
}

/** TypeScript with its comments removed (string and template literals stay). */
function stripTs(source: string): string {
  return ts.transpileModule(source, { compilerOptions: { removeComments: true, target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext, verbatimModuleSyntax: false } }).outputText
}

/** A Svelte file's code: HTML comments removed, `<script>` as comment-free JavaScript, `<style>` without comments. */
function stripSvelte(source: string): string {
  return source
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/<script\b[^>]*>([\s\S]*?)<\/script>/g, (_m, code: string) => stripTs(code))
    .replace(/<style\b[^>]*>([\s\S]*?)<\/style>/g, (_m, css: string) => css.replace(/\/\*[\s\S]*?\*\//g, ''))
}

const codeOf = (file: string): string => (file.endsWith('.svelte') ? stripSvelte(readFileSync(file, 'utf8')) : stripTs(readFileSync(file, 'utf8')))
const sources = SCANNED.flatMap(sourceFiles)

describe('the sources of the task and its renderers hold no network API (the privacy promise of DESIGN §8)', () => {
  it('scans the files it should, so the check is not empty', () => {
    const names = sources.map((f) => relative(join(WEB, 'src'), f))
    for (const must of ['tasks/aut/ocsai.ts', 'tasks/aut/minilm.ts', 'tasks/aut/run.ts', 'tasks/aut/demo.ts', 'tasks/aut/spec.ts', 'tasks/aut/copy.ts', 'render/aut/AutRenderer.svelte', 'render/aut/OcsaiConsent.svelte', 'render/aut/AutResults.svelte']) {
      expect(names, must).toContain(must)
    }
    expect(names.some((n) => /\.test\./.test(n))).toBe(false)
  })

  it('finds each forbidden thing where it is (the patterns are not vacuous), and ignores a comment', () => {
    const samples: Record<string, string> = {
      'fetch(': 'await fetch("/x")',
      XMLHttpRequest: 'new XMLHttpRequest()',
      sendBeacon: 'navigator.sendBeacon(u, d)',
      WebSocket: 'new WebSocket(u)',
      EventSource: 'new EventSource(u)',
      openscoring: 'const u = "https://openscoring.du.edu/llm"',
    }
    for (const { name, re } of FORBIDDEN) {
      expect(re.test(stripTs(samples[name] as string)), name).toBe(true)
      expect(re.test(stripTs(`// ${samples[name] as string}\n/* ${samples[name] as string} */\nexport const x = 1`)), `${name} in a comment`).toBe(false)
    }
    expect(FORBIDDEN[0]?.re.test('const originalFetch = env.fetch; env.fetch = (i) => originalFetch(i)')).toBe(false)
  })

  it('has none of them in any code, comments aside', () => {
    const hits = sources.flatMap((file) => {
      const code = codeOf(file)
      return FORBIDDEN.filter(({ re }) => re.test(code)).map(({ name }) => `${relative(WEB, file)}: ${name}`)
    })
    expect(hits).toEqual([])
  })

  it('names the service only in comments of ocsai.ts', () => {
    const named = sources.filter((f) => /openscoring/i.test(readFileSync(f, 'utf8'))).map((f) => relative(join(WEB, 'src'), f))
    expect(named).toEqual(['tasks/aut/ocsai.ts'])
  })

  it('has no network code in ocsai.ts at all', () => {
    const code = codeOf(join(WEB, 'src/tasks/aut/ocsai.ts'))
    expect(code).not.toMatch(/\b(?:fetch|XMLHttpRequest|sendBeacon|WebSocket|EventSource|import\s*\(|require\s*\()/)
  })
})
