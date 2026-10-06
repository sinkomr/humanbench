/**
 * The static welcome shell of index.html (UX-100; DESIGN §10, §13): before any script runs, the page shows
 * the welcome screen's heading, tagline and intro and the footer disclaimer, in the app's own words and look.
 *
 * - The words are placeholders in index.html, filled in by the `humanbench-static-shell` plugin of
 *   vite.config.ts from the app's constants (src/session/copy.ts, src/copy.ts), so they cannot drift.
 * - The inline styles repeat the app's for that screen (app.css, render.css, session.css, App.svelte's
 *   footer) in light and dark: these tests compare them declaration by declaration, so a change on one side
 *   that is not made on the other fails here instead of making the page jump when the app mounts.
 * - The shell has nothing to press (a "Loading…" line in place of Start), one main and one footer, the
 *   noscript text inside it, and a deep link (#/privacy, #/data, #/dev/...) hides its welcome text.
 * The built page itself is checked in `results-split.test.ts`; the browser side in `e2e/ux2-perf.spec.ts`.
 */

import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import fc from 'fast-check'
import { describe, expect, it } from 'vitest'
import { DISCLAIMER } from '../src/copy'
import { WELCOME_HEADING, WELCOME_INTRO, WELCOME_TAGLINE } from '../src/session/copy'
import { fillShell, loadShellText, SHELL_MARK, SHELL_TEXT_NAMES, type ShellText } from '../vite.config'
import { parseBlocks, styleText, WEB, type Block } from './css-tokens'

const RAW = readFileSync(join(WEB, 'index.html'), 'utf8')
const TEXT: ShellText = { WELCOME_HEADING, WELCOME_TAGLINE, WELCOME_INTRO, DISCLAIMER }
const FILLED = fillShell(RAW, TEXT)
/** The shell: everything inside `<div id="app">` of the source. */
const SHELL = /<div id="app">([\s\S]*?)\n {4}<\/div>/.exec(RAW)?.[1] ?? ''

const unescapeHtml = (s: string): string => s.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&amp;/g, '&')

describe('the shell says what the welcome screen says (no drift)', () => {
  it('index.html has one placeholder per shell text, and nothing else in their place', () => {
    const names = [...RAW.matchAll(/<!--hb-shell:([A-Z_]+)-->/g)].map((m) => m[1])
    expect(names.sort()).toEqual([...SHELL_TEXT_NAMES].sort())
    expect(RAW).toContain(SHELL_MARK)
  })

  it('the plugin reads the same constants as the app (through Vite\'s module runner)', async () => {
    expect(await loadShellText()).toEqual(TEXT)
  }, 60_000)

  it('fills them into the heading, the tagline, the intro and the footer', () => {
    expect(FILLED).not.toContain('<!--hb-shell:')
    expect(/<h1 id="hb-shell-h"[^>]*translate="no">([^<]*)<\/h1>/.exec(FILLED)?.[1]).toBe(WELCOME_HEADING)
    expect(/<p class="lead hb-shell-welcome">([^<]*)<\/p>/.exec(FILLED)?.[1]).toBe(WELCOME_TAGLINE)
    expect(/<p class="hb-shell-welcome">([^<]*)<\/p>/.exec(FILLED)?.[1]).toBe(WELCOME_INTRO)
    expect(/<footer class="hb-shell-foot">\s*<p>([^<]*)<\/p>/.exec(FILLED)?.[1]).toBe(DISCLAIMER)
  })

  it('escapes whatever the text holds (property)', () => {
    fc.assert(
      fc.property(fc.string(), (s) => {
        const out = fillShell(`<head></head><body><div ${SHELL_MARK}><h1><!--hb-shell:WELCOME_HEADING--></h1></div></body>`, { ...TEXT, WELCOME_HEADING: s })
        const inner = /<h1>([\s\S]*)<\/h1>/.exec(out)?.[1] ?? null
        expect(inner).not.toBeNull()
        expect(inner).not.toMatch(/[<>"]/)
        expect(unescapeHtml(inner as string)).toBe(s)
      }),
    )
  })

  it('an unknown placeholder fails the build; a page without the shell is left alone', () => {
    expect(() => fillShell(`<head></head><body><main ${SHELL_MARK}><!--hb-shell:NOPE--></main></body>`, TEXT)).toThrow('NOPE')
    const notes = readFileSync(join(WEB, 'notes.html'), 'utf8')
    expect(fillShell(notes, TEXT)).toBe(notes)
  })

  it('moves the build\'s stylesheets to the end of the body and leaves scripts and preloads in the head', () => {
    const built = [
      '<!doctype html><html><head>',
      '    <script type="module" crossorigin src="/b/assets/index-x.js"></script>',
      '    <link rel="modulepreload" crossorigin href="/b/assets/copy-x.js">',
      '    <link rel="stylesheet" crossorigin href="/b/assets/copy-x.css">',
      '    <link rel="stylesheet" crossorigin href="/b/assets/index-x.css">',
      '  </head>',
      `  <body><div id="app"><main ${SHELL_MARK}></main></div>`,
      '  </body></html>',
    ].join('\n')
    const out = fillShell(built, TEXT)
    const [head, body] = out.split('</head>') as [string, string]
    expect(head).toContain('<script type="module" crossorigin src="/b/assets/index-x.js"></script>')
    expect(head).toContain('<link rel="modulepreload" crossorigin href="/b/assets/copy-x.js">')
    expect(head).not.toContain('rel="stylesheet"')
    expect(body.indexOf('copy-x.css')).toBeGreaterThan(body.indexOf('</div>'))
    expect(body.indexOf('copy-x.css')).toBeLessThan(body.indexOf('index-x.css')) // in their order
    expect(body.indexOf('index-x.css')).toBeLessThan(body.indexOf('</body>'))
  })
})

describe('the shell has nothing to press and no landmark twice', () => {
  it('no control or focus stop: a status line stands in for Start', () => {
    expect(SHELL).not.toMatch(/<(button|a|input|select|textarea|details|summary)\b/i)
    expect(SHELL).not.toMatch(/tabindex/i)
    expect(SHELL).toContain('<p class="hb-shell-wait">Loading…</p>')
  })

  it('one main with the one h1, one footer; the noscript text is inside the main and the disclaimer is in it', () => {
    expect(SHELL.match(/<main\b/g)).toHaveLength(1)
    expect(SHELL.match(/<h1\b/g)).toHaveLength(1)
    expect(SHELL.match(/<footer\b/g)).toHaveLength(1)
    const main = /<main[\s\S]*<\/main>/.exec(SHELL)?.[0] ?? ''
    expect(main).toMatch(/<noscript>[\s\S]*HumanBench needs JavaScript[\s\S]*<\/noscript>/)
    expect(main.replace(/\s+/g, ' ')).toContain(DISCLAIMER)
    // The welcome screen's footer has the disclaimer only (its privacy link is under Start), and so has the shell's.
    expect(/<footer[\s\S]*<\/footer>/.exec(SHELL)?.[0].match(/<p\b/g)).toHaveLength(1)
  })

  it('the head script marks a page with JavaScript, and a deep link hides the welcome text', () => {
    const script = /<script>([\s\S]*?)<\/script>/.exec(RAW)?.[1] ?? ''
    const run = (hash: string): string[] => {
      const classes = new Set<string>()
      const doc = { documentElement: { classList: { add: (...c: string[]) => c.forEach((x) => classes.add(x)) } } }
      new Function('document', 'location', script)(doc, { hash })
      return [...classes].sort()
    }
    for (const hash of ['', '#', '#/']) expect(run(hash), hash).toEqual(['hb-shell-js'])
    for (const hash of ['#/privacy', '#/data', '#/dev/blob', '#x']) expect(run(hash), hash).toEqual(['hb-shell-deep', 'hb-shell-js'])
    // What the classes do: the line and the footer only with JavaScript, the welcome text not on a deep link.
    const css = shellCss()
    expect(get(css, '.hb-shell .hb-shell-wait', 'display')).toBe('none')
    expect(get(css, '.hb-shell-js .hb-shell .hb-shell-wait', 'display')).toBe('flex')
    expect(get(css, '.hb-shell-foot', 'display')).toBe('none')
    expect(get(css, '.hb-shell-js .hb-shell-foot', 'display')).toBe('block')
    expect(get(css, '.hb-shell-deep .hb-shell-welcome', 'display')).toBe('none')
    expect(SHELL.match(/class="[^"]*hb-shell-welcome/g)).toHaveLength(3)
  })
})

// ---------------------------------------------------------------------------- the look

const DARK = '@media screen and (prefers-color-scheme: dark)'
const NARROW = '@media (max-width: 30rem)'

function shellCss(): Block[] {
  return parseBlocks([...RAW.matchAll(/<style>([\s\S]*?)<\/style>/g)].map((m) => m[1]).join('\n').replace(/\/\*[\s\S]*?\*\//g, ''))
}
const fileCss = (file: string): Block[] => parseBlocks(styleText(join(WEB, file)))

/** A declaration of the block `selector` (inside the at-rule `media` when given), or undefined. */
function get(blocks: readonly Block[], selector: string, prop: string, media?: string): string | undefined {
  const scope = media === undefined ? blocks : blocks.filter((b) => b.prelude === media).flatMap((b) => b.children)
  const found = scope.filter((b) => b.prelude === selector).flatMap((b) => b.decls.filter(([p]) => p === prop).map(([, v]) => v))
  return found.at(-1)
}

/** `[shell selector, app file, app selector, properties, media?]`: each property must be the same on both sides. */
type Pair = readonly [string, string, string, readonly string[], string?]

const PAIRS: readonly Pair[] = [
  [':root', 'src/app.css', ':root', ['--text', '--text-strong', '--bg', '--border', 'font-family', 'font-size', 'line-height', 'color-scheme', 'color', 'background']],
  [':root', 'src/app.css', ':root', ['--text', '--text-strong', '--bg', '--border'], DARK],
  ['body', 'src/app.css', 'body', ['margin', 'background']],
  ['#app', 'src/app.css', '#app', ['min-height', 'display', 'flex-direction']],
  ['.hb-shell', 'src/render/common/render.css', '.hb-render', ['--r-fg', '--r-muted', '--r-bg', 'color', 'background', 'min-width', 'box-sizing', 'font-size', 'line-height']],
  ['.hb-shell', 'src/render/common/render.css', '.hb-render', ['--r-fg', '--r-muted', '--r-bg'], DARK],
  ['.hb-shell', 'src/session/session.css', '.hb-screen', ['width', 'max-width', 'margin', 'padding', 'flex', 'overflow-wrap']],
  ['.hb-shell', 'src/session/session.css', '.hb-screen', ['padding'], NARROW],
  ['.hb-shell h1', 'src/session/session.css', '.hb-screen h1', ['margin', 'font-size', 'line-height', 'letter-spacing']],
  ['.hb-shell p', 'src/session/session.css', '.hb-screen p', ['margin', 'max-width']],
  ['.hb-shell .lead', 'src/session/session.css', '.hb-screen .lead', ['font-size']],
  ['.hb-shell .hb-shell-wait', 'src/render/common/render.css', '.hb-render .hb-actions', ['margin']],
  ['.hb-shell-foot', 'src/App.svelte', 'footer', ['border-top', 'padding', 'text-align']],
  ['.hb-shell-foot p', 'src/App.svelte', '.disclaimer', ['margin', 'max-width', 'font-size']],
]

describe('the shell looks like the welcome screen, light and dark (no jump when the app mounts)', () => {
  const shell = shellCss()
  for (const [sel, file, appSel, props, media] of PAIRS) {
    it(`${media ?? ''} ${sel} = ${file} ${appSel}: ${props.join(', ')}`.trim(), () => {
      const app = fileCss(file)
      for (const prop of props) {
        const want = get(app, appSel, prop, media)
        expect(want, `${file} ${appSel} has no ${prop}`).toBeDefined()
        expect(get(shell, sel, prop, media), `${sel} ${prop}`).toBe(want)
      }
    })
  }

  it('the "Loading…" line is as tall as the row of the Start button', () => {
    expect(get(shellCss(), '.hb-shell .hb-shell-wait', 'min-height')).toBe(get(fileCss('src/render/common/render.css'), '.hb-render .hb-btn', 'min-height'))
  })
})
