/**
 * Colour tokens out of the app's stylesheets, for the contrast unit test (`contrast.test.ts`, ROADMAP
 * M1.21; WCAG 1.4.3 text, 1.4.11 non-text). A small CSS reader, enough for what the app writes: rules and
 * `@media (prefers-color-scheme: dark)` blocks of custom properties, in `.css` files and in the
 * `<style>` of `.svelte` files. It reads the source, so the test checks what ships and not a copy of it.
 *
 * Vitest serves `.css?raw` as empty in the app's unit project, so this reads the files with `node:fs`
 * (the same reason `viz-palette-css.test.ts` is a Node test).
 */

import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'
import { fileURLToPath } from 'node:url'

export const WEB = fileURLToPath(new URL('..', import.meta.url))
export const SRC = join(WEB, 'src')

export type Scheme = 'light' | 'dark'

export interface Block {
  /** The selector or at-rule before the braces, whitespace collapsed. */
  readonly prelude: string
  /** `[property, value]` pairs of the declarations directly in the block. */
  readonly decls: [string, string][]
  readonly children: Block[]
}

/** The style text of a file: the file itself for `.css`, the `<style>` blocks for `.svelte`. */
export function styleText(file: string): string {
  const text = readFileSync(file, 'utf8')
  if (!file.endsWith('.svelte')) return stripComments(text)
  return [...text.matchAll(/<style\b[^>]*>([\s\S]*?)<\/style>/g)].map((m) => stripComments(m[1]!)).join('\n')
}

function stripComments(css: string): string {
  return css.replace(/\/\*[\s\S]*?\*\//g, '')
}

/** The rule tree of a stylesheet's text. */
export function parseBlocks(css: string): Block[] {
  const root: Block = { prelude: '', decls: [], children: [] }
  const stack: Block[] = [root]
  let buf = ''
  const flushDecl = (): void => {
    const i = buf.indexOf(':')
    if (i > 0) stack[stack.length - 1]!.decls.push([buf.slice(0, i).trim(), buf.slice(i + 1).trim()])
    buf = ''
  }
  for (const ch of css) {
    if (ch === '{') {
      const block: Block = { prelude: buf.trim().replace(/\s+/g, ' '), decls: [], children: [] }
      stack[stack.length - 1]!.children.push(block)
      stack.push(block)
      buf = ''
    } else if (ch === '}') {
      if (buf.trim() !== '') flushDecl()
      buf = ''
      if (stack.length > 1) stack.pop()
    } else if (ch === ';') {
      flushDecl()
    } else buf += ch
  }
  return root.children
}

export interface ScopeTokens {
  /** The selector the custom properties are declared on. */
  readonly selector: string
  /** Declared in the rule, light scheme. */
  readonly light: Readonly<Record<string, string>>
  /** Declared again for `prefers-color-scheme: dark` (overrides only). */
  readonly dark: Readonly<Record<string, string>>
}

/** The custom properties of a stylesheet (a path relative to `web/`), by selector, with their dark overrides. */
export function scopesOf(file: string): ScopeTokens[] {
  const light = new Map<string, Record<string, string>>()
  const dark = new Map<string, Record<string, string>>()
  const take = (into: Map<string, Record<string, string>>, selector: string, decls: [string, string][]): void => {
    const custom = decls.filter(([n]) => n.startsWith('--'))
    if (custom.length === 0) return
    into.set(selector, { ...(into.get(selector) ?? {}), ...Object.fromEntries(custom) })
  }
  for (const b of parseBlocks(styleText(join(WEB, file)))) {
    if (b.prelude.startsWith('@media')) {
      if (/prefers-color-scheme:\s*dark/.test(b.prelude)) for (const c of b.children) take(dark, c.prelude, c.decls)
    } else if (!b.prelude.startsWith('@')) take(light, b.prelude, b.decls)
  }
  const selectors = [...new Set([...light.keys(), ...dark.keys()])]
  return selectors.map((selector) => ({ selector, light: light.get(selector) ?? {}, dark: dark.get(selector) ?? {} }))
}

/** The tokens of one scope in one scheme: its light values, with the dark overrides on top in dark. */
export function themeOf(scope: ScopeTokens, scheme: Scheme): Record<string, string> {
  return scheme === 'light' ? { ...scope.light } : { ...scope.light, ...scope.dark }
}

/** `#rgb` or `#rrggbb` as `#rrggbb` lower case, or null. */
export function hex6(value: string): string | null {
  const m = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(value.trim())
  if (!m) return null
  const h = m[1]!.toLowerCase()
  return `#${h.length === 3 ? [...h].map((c) => c + c).join('') : h}`
}

const toHex = (channels: readonly number[]): string => `#${channels.map((c) => Math.round(Math.min(255, Math.max(0, c))).toString(16).padStart(2, '0')).join('')}`

/** The parts of a functional colour's arguments (`rgb(1, 2, 3)`, `rgb(1 2 3 / 50%)`): numbers and percentages, alpha last. */
function colourArgs(args: string): { readonly n: number; readonly pct: boolean }[] | null {
  const parts = args.trim().split(/\s*[,/]\s*|\s+/)
  if (parts.length < 3 || parts.length > 4) return null
  const out: { n: number; pct: boolean }[] = []
  for (const p of parts) {
    const m = /^([+-]?(?:\d+\.?\d*|\.\d+))(%|deg)?$/.exec(p)
    if (!m) return null
    out.push({ n: Number(m[1]), pct: m[2] === '%' })
  }
  // Translucent: what it looks like depends on what is behind it, so it is not read here.
  const alpha = out[3]
  if (alpha !== undefined && (alpha.pct ? alpha.n : alpha.n * 100) < 100) return null
  return out.slice(0, 3)
}

/** An opaque `rgb()` / `rgba()` or `hsl()` / `hsla()` as `#rrggbb`, or null (also for a translucent one). */
function functionalHex(value: string): string | null {
  const m = /^(rgba?|hsla?)\(\s*([^()]*?)\s*\)$/i.exec(value.trim())
  if (!m) return null
  const args = colourArgs(m[2]!)
  if (args === null) return null
  if (m[1]!.toLowerCase().startsWith('rgb')) return toHex(args.map((a) => (a.pct ? (a.n * 255) / 100 : a.n)))
  const [h, sat, lig] = [args[0]!, args[1]!, args[2]!]
  const s = Math.min(1, Math.max(0, sat.n / 100))
  const l = Math.min(1, Math.max(0, lig.n / 100))
  const a = s * Math.min(l, 1 - l)
  const f = (k: number): number => {
    const t = (k + (((h.n % 360) + 360) % 360) / 30) % 12
    return 255 * (l - a * Math.max(-1, Math.min(t - 3, 9 - t, 1)))
  }
  return toHex([f(0), f(8), f(4)])
}

/** A colour written as hex, opaque `rgb()` or opaque `hsl()` as `#rrggbb`, or null (a name, a translucent or other colour function, anything else). */
export function colourToHex(value: string): string | null {
  return hex6(value) ?? functionalHex(value)
}

/**
 * The colour a value stands for in `env` (custom properties by name): a colour written as hex, `rgb()` or `hsl()`,
 * or `var(--x)` / `var(--x, fallback)` followed through `env`. Null when it is neither (a keyword, a gradient, a length).
 */
export function resolveColour(value: string, env: Readonly<Record<string, string>>, depth = 0): string | null {
  if (depth > 8) return null
  const direct = colourToHex(value)
  if (direct !== null) return direct
  const m = /^var\(\s*(--[\w-]+)\s*(?:,\s*(.+))?\)$/.exec(value.trim())
  if (!m) return null
  const named = env[m[1]!]
  if (named !== undefined) return resolveColour(named, env, depth + 1)
  return m[2] === undefined ? null : resolveColour(m[2], env, depth + 1)
}

/** Every `.css` and `.svelte` file under `src/`, as paths relative to `web/`. */
export function styledFiles(dir = SRC): string[] {
  const out: string[] = []
  for (const name of readdirSync(dir)) {
    const full = join(dir, name)
    if (statSync(full).isDirectory()) {
      if (name === '__fixtures__' || name === '__snapshots__') continue
      out.push(...styledFiles(full))
    } else if (/\.(css|svelte)$/.test(name)) out.push(relative(WEB, full))
  }
  return out.sort()
}

/** CSS named colours (level 4). `transparent`, `currentcolor` and the system colours are not among them: they name no fixed colour. */
const NAMED_COLOURS: ReadonlySet<string> = new Set(
  (
    'aliceblue antiquewhite aqua aquamarine azure beige bisque black blanchedalmond blue blueviolet brown burlywood cadetblue chartreuse chocolate coral ' +
    'cornflowerblue cornsilk crimson cyan darkblue darkcyan darkgoldenrod darkgray darkgreen darkgrey darkkhaki darkmagenta darkolivegreen darkorange ' +
    'darkorchid darkred darksalmon darkseagreen darkslateblue darkslategray darkslategrey darkturquoise darkviolet deeppink deepskyblue dimgray dimgrey ' +
    'dodgerblue firebrick floralwhite forestgreen fuchsia gainsboro ghostwhite gold goldenrod gray green greenyellow grey honeydew hotpink indianred indigo ' +
    'ivory khaki lavender lavenderblush lawngreen lemonchiffon lightblue lightcoral lightcyan lightgoldenrodyellow lightgray lightgreen lightgrey lightpink ' +
    'lightsalmon lightseagreen lightskyblue lightslategray lightslategrey lightsteelblue lightyellow lime limegreen linen magenta maroon mediumaquamarine ' +
    'mediumblue mediumorchid mediumpurple mediumseagreen mediumslateblue mediumspringgreen mediumturquoise mediumvioletred midnightblue mintcream mistyrose ' +
    'moccasin navajowhite navy oldlace olive olivedrab orange orangered orchid palegoldenrod palegreen paleturquoise palevioletred papayawhip peachpuff peru ' +
    'pink plum powderblue purple rebeccapurple red rosybrown royalblue saddlebrown salmon sandybrown seagreen seashell sienna silver skyblue slateblue ' +
    'slategray slategrey snow springgreen steelblue tan teal thistle tomato turquoise violet wheat white whitesmoke yellow yellowgreen'
  ).split(' '),
)

/** Properties whose value can hold a colour (so a bare word such as `red` in them is a colour, and `tan` elsewhere is not). */
const COLOUR_PROPERTY = /color|background|border|outline|shadow|fill|stroke|decoration|column-rule|filter|mask|scrollbar/

/** The value without its `var(...)`, `url(...)` and quoted parts (what is left is what the rule itself says). */
function withoutIndirect(value: string): string {
  let out = ''
  let i = 0
  while (i < value.length) {
    const rest = value.slice(i)
    const m = /^(?:var|url)\(/i.exec(rest)
    if (m) {
      let depth = 0
      let j = i + m[0].length - 1
      for (; j < value.length; j++) {
        if (value[j] === '(') depth++
        else if (value[j] === ')' && --depth === 0) break
      }
      i = j + 1
      out += ' '
      continue
    }
    const q = /^(["'])(?:\\.|(?!\1)[^\\])*\1/.exec(rest)
    if (q) {
      i += q[0].length
      out += ' '
      continue
    }
    out += value[i]
    i++
  }
  return out
}

/** Colour functions: the ones `colourToHex` reads (`rgb`, `rgba`, `hsl`, `hsla`) and those it does not (their contrast is not computed here). */
const COLOUR_FUNCTION = /\b(?:rgba?|hsla?|hwb|lab|lch|oklab|oklch|color-mix|color|light-dark)\(/gi

/**
 * The colours a declaration value writes out: hex colours and colour functions (as `#rrggbb` when they can be read, as
 * written otherwise), and, when `named`, colour names. Colours behind a `var()` (a fallback) and inside `url()` or a string
 * are not counted. In a property that cannot hold a colour, pass `named: false` (`tan` is a colour name and a word).
 */
export function colourWords(value: string, named: boolean): string[] {
  let rest = withoutIndirect(value)
  const out: string[] = []
  for (let m = COLOUR_FUNCTION.exec(rest); m !== null; m = COLOUR_FUNCTION.exec(rest)) {
    let depth = 0
    let j = m.index + m[0].length - 1
    for (; j < rest.length; j++) {
      if (rest[j] === '(') depth++
      else if (rest[j] === ')' && --depth === 0) break
    }
    const text = rest.slice(m.index, j + 1)
    out.push(colourToHex(text) ?? text.replace(/\s+/g, ' '))
    rest = `${rest.slice(0, m.index)} ${rest.slice(j + 1)}`
    COLOUR_FUNCTION.lastIndex = 0
  }
  for (const m of rest.matchAll(/#[0-9a-fA-F]{3,8}\b/g)) out.push(hex6(m[0]) ?? m[0].toLowerCase())
  if (named) for (const m of rest.matchAll(/(?<![\w#-])[a-zA-Z]+(?![\w-])/g)) if (NAMED_COLOURS.has(m[0].toLowerCase())) out.push(m[0].toLowerCase())
  return out
}

/** Whether a declaration of `prop` can hold a named colour. */
export const holdsColourName = (prop: string): boolean => COLOUR_PROPERTY.test(prop)

export interface Literal {
  /** The property, e.g. `color`, `border`, `background`. */
  readonly prop: string
  /** The colour as `#rrggbb` when it can be read (hex, opaque `rgb()` / `hsl()`), else as written (a name, a translucent colour, `oklch(...)`). */
  readonly value: string
  /** The rule's selector, with `@media (prefers-color-scheme: dark)` in front inside that block. */
  readonly where: string
}

/**
 * The colours written straight into declarations (not custom-property definitions, and not as the
 * fallback of a `var()`): a colour nobody can switch for the other scheme or review as a token. Hex, `rgb()`,
 * `hsl()` and the other colour functions, and colour names in the properties that take a colour.
 */
export function literalColoursIn(blocks: readonly Block[]): Literal[] {
  const out: Literal[] = []
  const visit = (bs: readonly Block[], where: string): void => {
    for (const b of bs) {
      const here = where === '' ? b.prelude : `${where} > ${b.prelude}`
      for (const [prop, value] of b.decls) {
        if (prop.startsWith('--')) continue
        for (const v of colourWords(value, holdsColourName(prop))) out.push({ prop, value: v, where: here })
      }
      visit(b.children, here)
    }
  }
  visit(blocks, '')
  return out
}

/** The colours of a file's style written straight into declarations (see {@link literalColoursIn}). */
export function literalColours(file: string): Literal[] {
  return literalColoursIn(parseBlocks(styleText(join(WEB, file))))
}

export interface TokenDecl {
  readonly file: string
  /** The rule's selector (`:root`, `.hb-render`). */
  readonly selector: string
  /** The at-rules around the rule, outermost first, joined (`@media (prefers-color-scheme: dark)`); '' at the top level. */
  readonly media: string
  readonly name: string
  readonly value: string
}

/** Every custom property declared in the stylesheets, wherever it sits (keyframes and font faces hold none). */
export function customPropertyDecls(file: string, blocks: readonly Block[]): TokenDecl[] {
  const out: TokenDecl[] = []
  const visit = (bs: readonly Block[], media: string): void => {
    for (const b of bs) {
      if (b.prelude.startsWith('@')) {
        if (!/^@(keyframes|font-face)\b/.test(b.prelude)) visit(b.children, media === '' ? b.prelude : `${media} ${b.prelude}`)
        continue
      }
      for (const [name, value] of b.decls) if (name.startsWith('--')) out.push({ file, selector: b.prelude, media, name, value })
      visit(b.children, media)
    }
  }
  visit(blocks, '')
  return out
}

/**
 * The custom properties that hold a colour: those whose value writes one (hex, `rgb()`, a name, `oklch()`) and those
 * that are another colour token seen through `var(--x)`, followed to a fixed point. A colour token of a scope that no
 * contrast pair reads is a colour nobody checked.
 */
export function colourTokenDecls(decls: readonly TokenDecl[]): TokenDecl[] {
  const colour = new Set<TokenDecl>()
  const names = new Set<string>()
  for (let grew = true; grew; ) {
    grew = false
    for (const d of decls) {
      if (colour.has(d)) continue
      const alias = /^var\(\s*(--[\w-]+)\s*(?:,[^)]*)?\)$/.exec(d.value.trim())
      if (colourWords(d.value, true).length > 0 || (alias !== null && names.has(alias[1]!))) {
        colour.add(d)
        names.add(d.name)
        grew = true
      }
    }
  }
  return decls.filter((d) => colour.has(d))
}

/** Every colour token declared anywhere in `src/` (see {@link colourTokenDecls}). */
export function allColourTokens(): TokenDecl[] {
  const decls = styledFiles().flatMap((file) => customPropertyDecls(file, parseBlocks(styleText(join(WEB, file)))))
  return colourTokenDecls(decls)
}

const camelToKebab = (prop: string): string => prop.replace(/[A-Z]/g, (c) => `-${c.toLowerCase()}`)

/**
 * Colours written inline, outside the stylesheets: in a `style="..."` attribute or `style:prop` directive of a Svelte
 * template, a literal `fill` / `stroke` / `stop-color` / `color` attribute, and in script `el.style.prop = '...'`,
 * `style.cssText = '...'`, `style.setProperty('prop', '...')`. A colour set there is invisible to the contrast test and to
 * the dark scheme. Values from an expression (`fill={PAPER}`, the stimulus palettes) are not read.
 */
export function inlineColours(source: string, svelte: boolean): string[] {
  const out: string[] = []
  const note = (where: string, prop: string, value: string): void => {
    for (const c of colourWords(value, holdsColourName(prop))) out.push(`${where}: ${prop} ${c}`)
  }
  const declarations = (where: string, text: string): void => {
    for (const d of text.split(';')) {
      const i = d.indexOf(':')
      if (i > 0) note(where, d.slice(0, i).trim().toLowerCase(), d.slice(i + 1))
    }
  }
  let script = source
  if (svelte) {
    const markup = source.replace(/<style\b[^>]*>[\s\S]*?<\/style>/g, '').replace(/<script\b[^>]*>[\s\S]*?<\/script>/g, '')
    script = [...source.matchAll(/<script\b[^>]*>([\s\S]*?)<\/script>/g)].map((m) => m[1]!).join('\n')
    for (const m of markup.matchAll(/\sstyle\s*=\s*(?:"([^"]*)"|'([^']*)')/g)) declarations('style attribute', m[1] ?? m[2] ?? '')
    for (const m of markup.matchAll(/\sstyle:([\w-]+)\s*=\s*(?:"([^"]*)"|'([^']*)'|\{([^}]*)\})/g)) note('style directive', m[1]!, m[2] ?? m[3] ?? m[4] ?? '')
    for (const m of markup.matchAll(/\s(fill|stroke|stop-color|flood-color|lighting-color|color)\s*=\s*(?:"([^"{}]*)"|'([^'{}]*)')/g)) note('attribute', m[1]!, m[2] ?? m[3] ?? '')
  }
  for (const m of script.matchAll(/\.style\.(\w+)\s*=\s*(["'`])((?:\\.|(?!\2)[^\\])*)\2/g)) note('element style', camelToKebab(m[1]!), m[3]!)
  for (const m of script.matchAll(/\.style\.cssText\s*=\s*(["'`])((?:\\.|(?!\1)[^\\])*)\1/g)) declarations('cssText', m[2]!)
  for (const m of script.matchAll(/\.style\.setProperty\(\s*(["'])([\w-]+)\1\s*,\s*(["'`])((?:\\.|(?!\3)[^\\])*)\3/g)) note('setProperty', m[2]!, m[4]!)
  return out
}

/** Every file under `src/` that can set a style inline: `.svelte` and non-test `.ts`, as paths relative to `web/`. */
export function scriptedFiles(dir = SRC): string[] {
  const out: string[] = []
  for (const name of readdirSync(dir)) {
    const full = join(dir, name)
    if (statSync(full).isDirectory()) {
      if (name === '__fixtures__' || name === '__snapshots__') continue
      out.push(...scriptedFiles(full))
    } else if (/\.svelte$/.test(name) || (/\.ts$/.test(name) && !/\.test\.ts$/.test(name))) out.push(relative(WEB, full))
  }
  return out.sort()
}
