/**
 * Colour contrast of every stylesheet, in light and dark (ROADMAP M1.21; DESIGN §13 WCAG 2.2 AA:
 * 1.4.3 text 4.5:1, 1.4.11 non-text 3:1; §9.8 blob palette). The axe pass in the browser checks the
 * pixels of the screens it visits; this checks the tokens themselves, so a colour on a screen no test
 * opens (a rare state, a disabled control) cannot slip through, and the failing pair is named.
 *
 * - Every colour custom property of the app's stylesheets is in a pair below (foreground, the
 *   background it is drawn on, the ratio it must reach) or is listed as decorative with the reason.
 *   A new token with neither fails the test, wherever it is declared: a rule no sheet below stands
 *   for fails as well, and so does a colour that cannot be read (a name, `oklch()`, a translucent one).
 * - Every colour written straight into a declaration (hex, `rgb()`, `hsl()`, any colour function, a
 *   name in a property that takes a colour) is listed (`LITERALS`) with the pairs it takes part in.
 *   A new one fails the test until its contrast is reviewed.
 * - No colour is set inline (a `style` attribute, `style:` directive, `el.style.x = ...`), where neither
 *   this test nor the dark scheme would see it.
 * - The blob palette (`src/viz/palette.ts`, also drawn into the share card) has its own ratios in
 *   `src/viz/palette.test.ts`; here its backgrounds are tied to the page's.
 *
 * A Node test: it reads the sources (`css-tokens.ts`), because vitest serves `.css?raw` as empty in the
 * app's unit project.
 */

import { describe, expect, it } from 'vitest'
import { contrastRatio, MIN_MARK_CONTRAST, MIN_TEXT_CONTRAST, THEMES } from '../src/viz/palette'
import { allColourTokens, colourWords, hex6, inlineColours, literalColours, parseBlocks, resolveColour, scopesOf, scriptedFiles, styledFiles, styleText, themeOf, WEB, type Literal, type Scheme, type ScopeTokens } from './css-tokens'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const SCHEMES: readonly Scheme[] = ['light', 'dark']
const TEXT = MIN_TEXT_CONTRAST
const UI = MIN_MARK_CONTRAST

/** A foreground token drawn on a background token, and the least contrast it needs. */
interface Pair {
  readonly fg: string
  readonly bg: string
  readonly min: number
  readonly use: string
}

const pair = (fg: string, bg: string, min: number, use: string): Pair => ({ fg, bg, min, use })

interface Sheet {
  readonly file: string
  readonly selector: string
  /** Tokens of the sheets this one sits on (the page's `app.css`), by file and selector. */
  readonly on: readonly { readonly file: string; readonly selector: string }[]
  readonly pairs: readonly Pair[]
  /** Tokens that are not read for contrast, each with why. */
  readonly decorative: Readonly<Record<string, string>>
}

const APP = { file: 'src/app.css', selector: ':root' } as const

const SHEETS: readonly Sheet[] = [
  {
    ...APP,
    on: [],
    pairs: [
      pair('--text', '--bg', TEXT, 'body text'),
      pair('--text-strong', '--bg', TEXT, 'headings, button labels, results text'),
      pair('--text-strong', '--bg', UI, 'the 1px outline of a plain button'),
    ],
    decorative: { '--border': 'hairline dividers between sections (footer, table rules); no control is bounded by it alone and the content it separates is also separated by headings and spacing' },
  },
  {
    file: 'src/render/common/render.css',
    selector: '.hb-render',
    on: [APP],
    pairs: [
      pair('--r-fg', '--r-bg', TEXT, 'text'),
      pair('--r-fg', '--r-surface', TEXT, 'text in cards and on buttons'),
      pair('--r-muted', '--r-bg', TEXT, 'secondary text'),
      pair('--r-muted', '--r-surface', TEXT, 'secondary text in cards'),
      pair('--r-accent', '--r-bg', TEXT, 'links'),
      pair('--r-accent', '--r-surface', TEXT, 'links in cards'),
      pair('--r-accent-fg', '--r-accent', TEXT, 'the label of a primary button'),
      pair('--r-accent', '--r-bg', UI, 'the edge of a primary button'),
      pair('--r-border', '--r-bg', UI, 'edges of inputs, stages and buttons (1.4.11)'),
      pair('--r-border', '--r-surface', UI, 'edges of buttons and cards on a surface'),
      pair('--r-focus', '--r-bg', UI, 'the focus ring (2.4.11, 1.4.11)'),
      pair('--r-focus', '--r-surface', UI, 'the focus ring on a surface'),
      pair('--r-note', '--r-bg', TEXT, 'notes and errors'),
      pair('--r-note', '--r-surface', TEXT, 'notes in cards'),
      // Corsi: unlit blocks and the board they sit on, and the lit state, shown by its fill and by a ring round the block.
      pair('--r-block', '--r-surface', UI, 'an unlit Corsi block against the board'),
      pair('--r-lit-ring', '--r-surface', UI, 'the ring that marks the lit block, against the board'),
      pair('--r-lit', '--r-block', UI, 'the fill of a lit block against an unlit one (the ring marks it too)'),
    ],
    decorative: {},
  },
  {
    file: 'src/brief/notes.css',
    selector: ':root',
    on: [APP],
    pairs: [
      pair('--text', '--surface', TEXT, 'text on the notes preview and cards'),
      pair('--text-strong', '--surface', TEXT, 'notes text in the preview block'),
      pair('--text', '--note-bg', TEXT, 'text in a note'),
      pair('--text-strong', '--note-bg', TEXT, 'text in a note'),
      pair('--muted', '--bg', TEXT, 'hints'),
      pair('--muted', '--surface', TEXT, 'hints on a surface'),
      pair('--muted', '--note-bg', TEXT, 'hints in a note'),
      pair('--muted', '--bg', UI, 'the edge of a button, a text box and a badge'),
      pair('--accent', '--bg', TEXT, 'links'),
      pair('--accent', '--surface', TEXT, 'links on a surface'),
      pair('--accent', '--note-bg', TEXT, 'links in a note'),
      pair('--accent-text', '--accent', TEXT, 'the label of a primary button'),
      pair('--accent', '--bg', UI, 'the edge of a primary button, and a ticked box or radio'),
      pair('--focus', '--bg', UI, 'the focus ring'),
      pair('--focus', '--surface', UI, 'the focus ring on a surface'),
      pair('--focus', '--note-bg', UI, 'the focus ring in a note'),
      pair('--focus', '--warn-bg', UI, 'the focus ring in a warning'),
      pair('--warn-text', '--warn-bg', TEXT, 'the text of a warning'),
      pair('--warn-border', '--bg', UI, 'the edge of a warning box'),
    ],
    decorative: {},
  },
  {
    file: 'src/brief/ui/ResultsTalk.svelte',
    selector: '.results-talk',
    on: [APP],
    pairs: [
      pair('--text-strong', '--rt-quote-bg', TEXT, 'the text to paste'),
      pair('--rt-note-text', '--rt-note-bg', TEXT, 'the "never paste your save file" warning'),
      pair('--rt-note-border', '--bg', UI, 'the edge of the warning'),
      pair('--rt-quote-edge', '--bg', UI, 'the bar beside the text and the edge of the badge'),
      pair('--rt-quote-edge', '--rt-quote-bg', UI, 'the bar beside the text'),
    ],
    decorative: {},
  },
  {
    file: 'src/render/choice/OptionGroup.svelte',
    selector: '.choice',
    on: [APP],
    pairs: [
      pair('--hb-card-border', '--hb-surface', UI, 'the edge of an option card, the target of a radio (1.4.11)'),
      pair('--hb-chosen', '--hb-surface', UI, 'the chosen option'),
      pair('--hb-surface', '--hb-chosen', TEXT, 'the letter on the chosen option'),
    ],
    decorative: {},
  },
]

/** The colours of a sheet in a scheme: the sheets it sits on first, then its own tokens. */
function envOf(sheet: Sheet, scheme: Scheme): Record<string, string> {
  const env: Record<string, string> = {}
  for (const base of [...sheet.on, sheet]) {
    const scope = scopesOf(base.file).find((s) => s.selector === base.selector)
    if (scope === undefined) throw new Error(`${base.file} has no rule for ${base.selector}`)
    Object.assign(env, themeOf(scope, scheme))
  }
  return env
}

function colour(env: Readonly<Record<string, string>>, token: string): string {
  const value = env[token]
  if (value === undefined) throw new Error(`token ${token} is not defined`)
  const resolved = resolveColour(value, env)
  if (resolved === null) throw new Error(`token ${token} is ${JSON.stringify(value)}, not a colour`)
  return resolved
}

describe('colour tokens: contrast of every text and control colour, light and dark (WCAG 1.4.3, 1.4.11)', () => {
  for (const sheet of SHEETS) {
    for (const scheme of SCHEMES) {
      it(`${sheet.file} ${sheet.selector} (${scheme}): every pair reaches its ratio`, () => {
        const env = envOf(sheet, scheme)
        const failing: string[] = []
        for (const p of sheet.pairs) {
          const ratio = contrastRatio(colour(env, p.fg), colour(env, p.bg))
          if (ratio < p.min) failing.push(`${p.fg} on ${p.bg} is ${ratio.toFixed(2)}:1, needs ${p.min}:1 (${p.use})`)
        }
        expect(failing).toEqual([])
      })
    }

    it(`${sheet.file} ${sheet.selector}: every colour token is read for contrast or listed as decorative`, () => {
      const scope = scopesOf(sheet.file).find((s) => s.selector === sheet.selector) as ScopeTokens
      // A token is a colour when it writes one (hex, rgb(), a name, oklch(), ...) or is another colour token seen through var().
      const light = themeOf(scope, 'light')
      const dark = themeOf(scope, 'dark')
      const isColour = (n: string): boolean => [light, dark].some((env) => colourWords(env[n] ?? '', true).length > 0 || resolveColour(env[n] ?? '', env) !== null)
      const declared = new Set([...Object.keys(scope.light), ...Object.keys(scope.dark)].filter(isColour))
      const used = new Set([...sheet.pairs.flatMap((p) => [p.fg, p.bg]), ...Object.keys(sheet.decorative)])
      const own = [...declared].filter((n) => !used.has(n))
      expect(own, 'colour tokens nobody checked: add them to a pair, or to `decorative` with the reason').toEqual([])
      // Every colour token can be read, so its contrast can be computed: hex, an opaque rgb() or hsl(), or var() of one.
      const unreadable = SCHEMES.flatMap((scheme) => {
        const env = envOf(sheet, scheme)
        return [...declared].filter((n) => env[n] !== undefined && resolveColour(env[n]!, env) === null).map((n) => `${n}: ${env[n]} (${scheme})`)
      })
      expect(unreadable, 'colour tokens written as a name, oklch(), color-mix() or with an alpha: write them as #rrggbb').toEqual([])
      // And a pair names only tokens that exist (its own, or those of the sheet it sits on).
      const env = envOf(sheet, 'light')
      const unknown = [...used].filter((n) => env[n] === undefined)
      expect(unknown).toEqual([])
    })

    it(`${sheet.file} ${sheet.selector}: a token has a dark value whenever its light value would not do on the dark page`, () => {
      // A light-only token must pass in dark too (same value), which the pair test above already checks;
      // here: the dark overrides are only for tokens that exist, so a renamed token cannot leave a stale override.
      const scope = scopesOf(sheet.file).find((s) => s.selector === sheet.selector) as ScopeTokens
      expect(Object.keys(scope.dark).filter((n) => scope.light[n] === undefined)).toEqual([])
    })
  }
})

describe('no colour token is declared where the sheets above do not read it', () => {
  /** The dark scheme, on any medium or on screens only (paper stays light: UX-015, UX-027, UX-053). */
  const DARK = new Set(['@media (prefers-color-scheme: dark)', '@media screen and (prefers-color-scheme: dark)'])
  const tokens = allColourTokens()

  it('sees the tokens of the app (a scan that finds none is broken)', () => {
    expect(tokens.length).toBeGreaterThan(40)
    expect(new Set(tokens.map((t) => t.file)).size).toBeGreaterThanOrEqual(SHEETS.length)
  })

  it('every colour token of src/ sits in a rule that a sheet above stands for, at the top level or under prefers-color-scheme: dark', () => {
    const known = new Set(SHEETS.map((s) => `${s.file} ${s.selector}`))
    const stray = tokens.filter((t) => !known.has(`${t.file} ${t.selector}`) || (t.media !== '' && !DARK.has(t.media)))
    expect(
      stray.map((t) => `${t.file}: ${t.media === '' ? '' : `${t.media} `}${t.selector} { ${t.name}: ${t.value} }`),
      'colour tokens no contrast pair reads: add the rule to SHEETS with its pairs (or the token to `decorative` with the reason)',
    ).toEqual([])
  })
})

describe('colours written straight into declarations are reviewed', () => {
  /** `prop value` of each literal, per file; the pairs they take part in are in `LITERAL_PAIRS`. */
  const LITERALS: Readonly<Record<string, readonly string[]>> = {
    'src/render/rotation/RotationRenderer.svelte': ['background #ffffff', 'border #767676'],
    'src/review/InstanceCard.svelte': ['border-color #b42318', 'border-color #ff9b91', 'color #0a6b2f', 'color #b42318', 'color #8a4b00', 'color #6ee7a0', 'color #ff9b91', 'color #fbbf24', 'color #b42318', 'color #ff9b91'],
    'src/review/Review.svelte': [
      'outline #b45309',
      'outline #b45309',
      'border-color #0a6b2f',
      'background #d9f2e2',
      'color #06381a',
      'border-color #b42318',
      'background #fde2df',
      'color #5c1109',
      'border-color #8a4b00',
      'background #fdf0d5',
      'color #452600',
    ],
  }

  it('lists every hard-coded colour of src/: review the contrast of a new one, then add it here', () => {
    const found: Record<string, string[]> = {}
    for (const file of styledFiles()) {
      const lits = literalColours(file)
      if (lits.length > 0) found[file] = lits.map((l: Literal) => `${l.prop} ${l.value}`)
    }
    const sorted = (o: Readonly<Record<string, readonly string[]>>): Record<string, string[]> => Object.fromEntries(Object.entries(o).map(([k, v]) => [k, [...v].sort()]))
    expect(sorted(found)).toEqual(sorted(LITERALS))
  })

  const page = (scheme: Scheme): string => hex6(THEMES[scheme].bg)!
  const LITERAL_PAIRS: readonly { readonly what: string; readonly fg: string; readonly bg: (s: Scheme) => string; readonly min: number; readonly schemes?: readonly Scheme[] }[] = [
    { what: 'rotation: the edge of the target figure on the page', fg: '#767676', bg: page, min: UI },
    // The review page (G7, dev only): verdict chips carry their colours with their text, in both schemes.
    { what: 'review chip pass: text on its fill', fg: '#06381a', bg: () => '#d9f2e2', min: TEXT },
    { what: 'review chip fail: text on its fill', fg: '#5c1109', bg: () => '#fde2df', min: TEXT },
    { what: 'review chip unsure: text on its fill', fg: '#452600', bg: () => '#fdf0d5', min: TEXT },
    { what: 'review: the focus ring on the page', fg: '#b45309', bg: page, min: UI },
    { what: 'review card: badge pass', fg: '#0a6b2f', bg: page, min: TEXT, schemes: ['light'] },
    { what: 'review card: badge fail', fg: '#b42318', bg: page, min: TEXT, schemes: ['light'] },
    { what: 'review card: badge unsure', fg: '#8a4b00', bg: page, min: TEXT, schemes: ['light'] },
    { what: 'review card: badge pass (dark)', fg: '#6ee7a0', bg: page, min: TEXT, schemes: ['dark'] },
    { what: 'review card: badge fail (dark)', fg: '#ff9b91', bg: page, min: TEXT, schemes: ['dark'] },
    { what: 'review card: badge unsure (dark)', fg: '#fbbf24', bg: page, min: TEXT, schemes: ['dark'] },
  ]
  for (const p of LITERAL_PAIRS) {
    for (const scheme of p.schemes ?? SCHEMES) {
      it(`${p.what} (${scheme})`, () => {
        expect(contrastRatio(p.fg, p.bg(scheme))).toBeGreaterThanOrEqual(p.min)
      })
    }
  }

  it('the review page error text and the failed-card edge read on both pages (each scheme has its own red)', () => {
    expect(contrastRatio('#b42318', page('light'))).toBeGreaterThanOrEqual(TEXT)
    expect(contrastRatio('#ff9b91', page('dark'))).toBeGreaterThanOrEqual(TEXT)
    // #b42318 alone would not do on the dark page, which is why the dark rules override it.
    expect(contrastRatio('#b42318', page('dark'))).toBeLessThan(TEXT)
  })
})

describe('the fallbacks written next to var() are the app tokens (they stand in for them on a page without app.css)', () => {
  it('OptionGroup and the rotation notice fall back to the light values of app.css', () => {
    const app = scopesOf('src/app.css').find((s) => s.selector === ':root') as ScopeTokens
    const light = themeOf(app, 'light')
    const fallbacks: Record<string, string> = { '--text-strong': '#0b0a0f', '--text': '#3d3a44', '--bg': '#ffffff' }
    for (const [name, value] of Object.entries(fallbacks)) expect(hex6(light[name] ?? ''), name).toBe(value)
  })
})

describe('the blob palette sits on the page background (§9.8)', () => {
  it('uses the backgrounds of app.css in both schemes', () => {
    const app = scopesOf('src/app.css').find((s) => s.selector === ':root') as ScopeTokens
    for (const scheme of SCHEMES) expect(hex6(themeOf(app, scheme)['--bg'] ?? ''), scheme).toBe(THEMES[scheme].bg.toLowerCase())
  })
})

describe('a dark-scheme rule is not undone by a later rule', () => {
  it('no rule of the same selector sets the same property after its prefers-color-scheme: dark override', () => {
    // Same specificity, so the later rule wins in the cascade: a dark colour placed before its base rule never shows.
    const shadowed: string[] = []
    for (const file of styledFiles()) {
      const overridden = new Set<string>()
      for (const b of parseBlocks(styleText(join(WEB, file)))) {
        if (/^@media.*prefers-color-scheme:\s*dark/.test(b.prelude)) {
          for (const c of b.children) for (const [prop] of c.decls) overridden.add(`${c.prelude} | ${prop}`)
        } else if (!b.prelude.startsWith('@')) {
          for (const [prop] of b.decls) if (overridden.has(`${b.prelude} | ${prop}`)) shadowed.push(`${file}: ${b.prelude} { ${prop} } comes after its dark override`)
        }
      }
    }
    expect(shadowed).toEqual([])
  })
})

describe('no colour is set inline, where neither this test nor the dark scheme would see it', () => {
  it('no style attribute, style: directive, literal fill / stroke attribute or element.style assignment of src/ holds a colour', () => {
    const found: Record<string, string[]> = {}
    for (const file of scriptedFiles()) {
      const hits = inlineColours(readFileSync(join(WEB, file), 'utf8'), file.endsWith('.svelte'))
      if (hits.length > 0) found[file] = hits
    }
    expect(found, 'a colour belongs in a token of a stylesheet (and in the dark scheme), not in markup or script').toEqual({})
  })
})
