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

/**
 * The colour a value stands for in `env` (custom properties by name): a hex colour, or `var(--x)` /
 * `var(--x, fallback)` followed through `env`. Null when it is neither (a keyword, a gradient, a length).
 */
export function resolveColour(value: string, env: Readonly<Record<string, string>>, depth = 0): string | null {
  if (depth > 8) return null
  const direct = hex6(value)
  if (direct !== null) return direct
  const m = /^var\(\s*(--[\w-]+)\s*(?:,\s*([^)]+))?\)$/.exec(value.trim())
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

export interface Literal {
  /** The property, e.g. `color`, `border`, `background`. */
  readonly prop: string
  /** The hex colour as written, lower case `#rrggbb`. */
  readonly value: string
  /** The rule's selector, with `@media (prefers-color-scheme: dark)` in front inside that block. */
  readonly where: string
}

/**
 * The hex colours written straight into declarations (not custom-property definitions, and not as the
 * fallback of a `var()`): a colour nobody can switch for the other scheme or review as a token.
 */
export function literalColours(file: string): Literal[] {
  const out: Literal[] = []
  const visit = (blocks: Block[], where: string): void => {
    for (const b of blocks) {
      const here = where === '' ? b.prelude : `${where} > ${b.prelude}`
      for (const [prop, value] of b.decls) {
        if (prop.startsWith('--')) continue
        const bare = value.replace(/var\([^)]*\)/g, '')
        for (const m of bare.matchAll(/#[0-9a-fA-F]{3,8}\b/g)) {
          const v = hex6(m[0])
          if (v !== null) out.push({ prop, value: v, where: here })
        }
      }
      visit(b.children, here)
    }
  }
  visit(parseBlocks(styleText(join(WEB, file))), '')
  return out
}
