/**
 * Accessibility rules that the source can show without a browser (ROADMAP M1.21; DESIGN §13 WCAG 2.2
 * AA): the page shells allow zoom and say their language, text sizes follow the reader's setting, and
 * nothing moves unless the reader allows it (`prefers-reduced-motion`). The browser side of the pass,
 * which checks the same things on the rendered pages, is `e2e/a11y.spec.ts`.
 */

import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { DEV_ONLY_PAGES } from '../vite.config'
import { parseBlocks, styledFiles, styleText, WEB, type Block } from './css-tokens'

const pages = readdirSync(WEB).filter((f) => f.endsWith('.html')).sort()

describe('page shells (WCAG 3.1.1 language, 1.4.4 resize text, 1.4.10 reflow, 2.4.2 page titled)', () => {
  for (const page of pages) {
    const html = readFileSync(join(WEB, page), 'utf8')

    it(`${page}: declares its language and has a title`, () => {
      expect(html).toMatch(/<html lang="[a-z]{2}(-[A-Za-z]{2,4})?"/)
      expect(/<title>([^<]+)<\/title>/.exec(html)?.[1]?.trim().length ?? 0).toBeGreaterThan(2)
    })

    it(`${page}: lets the reader zoom (no user-scalable=no, no maximum-scale) and fits the device width`, () => {
      const viewport = /<meta\s+name="viewport"\s+content="([^"]*)"/.exec(html)?.[1] ?? ''
      expect(viewport).toContain('width=device-width')
      expect(viewport).not.toMatch(/user-scalable\s*=\s*(no|0)/i)
      expect(viewport).not.toMatch(/maximum-scale/i)
    })

    // The pages a person meets say what to do without JavaScript; the dev tools (the review and gallery pages) are not for them.
    if (!DEV_ONLY_PAGES.includes(page)) {
      it(`${page}: says what to do without JavaScript`, () => {
        expect(/<noscript>([\s\S]*?)<\/noscript>/.exec(html)?.[1]?.replace(/<[^>]+>/g, '').trim().length ?? 0).toBeGreaterThan(20)
        // Where results or notes are made, the disclaimer is there too (DESIGN §13).
        if (page === 'index.html' || page === 'notes.html') expect(html).toMatch(/<noscript>[\s\S]*Not an IQ test[\s\S]*<\/noscript>/)
      })
    }
  }
})

describe('text sizes follow the reader (WCAG 1.4.4)', () => {
  it('no style sets a font size in px or pt', () => {
    const found: string[] = []
    const visit = (file: string, blocks: Block[]): void => {
      for (const b of blocks) {
        for (const [prop, value] of b.decls) if (prop === 'font-size' && /\d(px|pt)\b/.test(value)) found.push(`${file}: ${b.prelude} { font-size: ${value} }`)
        visit(file, b.children)
      }
    }
    for (const file of styledFiles()) visit(file, parseBlocks(styleText(join(WEB, file))))
    expect(found).toEqual([])
  })

  it('the root font size is the reader\'s (100%), not a fixed length', () => {
    const css = readFileSync(join(WEB, 'src/app.css'), 'utf8')
    expect(css).toMatch(/:root\s*{[^}]*font-size:\s*100%/)
  })
})

describe('nothing moves unless the reader allows it (WCAG 2.2.2, 2.3.3; prefers-reduced-motion)', () => {
  type Kind = 'animation' | 'transition' | 'scroll'

  /** Motion declarations outside `@media (prefers-reduced-motion: no-preference)`, with the kind of each. */
  function unprotectedMotion(blocks: Block[], protectedBy = false): { readonly kind: Kind; readonly text: string }[] {
    const out: { kind: Kind; text: string }[] = []
    for (const b of blocks) {
      const here = protectedBy || /prefers-reduced-motion:\s*no-preference/.test(b.prelude)
      const reducing = /prefers-reduced-motion:\s*reduce/.test(b.prelude)
      if (!here && !reducing) {
        for (const [prop, value] of b.decls) {
          let kind: Kind | null = null
          if (/^(animation|animation-name)$/.test(prop) && !/^none\b/.test(value)) kind = 'animation'
          else if (/^(transition|transition-property)$/.test(prop) && !/^(none|0s)\b/.test(value)) kind = 'transition'
          else if (prop === 'scroll-behavior' && /smooth/.test(value)) kind = 'scroll'
          if (kind !== null) out.push({ kind, text: `${b.prelude} { ${prop}: ${value} }` })
        }
      }
      if (!reducing) out.push(...unprotectedMotion(b.children, here))
    }
    return out
  }

  /** The kinds of motion a file's `prefers-reduced-motion: reduce` blocks switch off. */
  function switchedOff(blocks: Block[]): Set<Kind> {
    const off = new Set<Kind>()
    const visit = (bs: Block[], inReduce: boolean): void => {
      for (const b of bs) {
        const reduce = inReduce || /prefers-reduced-motion:\s*reduce/.test(b.prelude)
        if (reduce) {
          for (const [prop, value] of b.decls) {
            if (/^animation(-name)?$/.test(prop) && /^none\b/.test(value)) off.add('animation')
            if (/^transition(-property)?$/.test(prop) && /^(none|0s)\b/.test(value)) off.add('transition')
            if (prop === 'scroll-behavior' && /^auto\b/.test(value)) off.add('scroll')
          }
        }
        visit(b.children, reduce)
      }
    }
    visit(blocks, false)
    return off
  }

  it('every animation, transition or smooth scroll is under no-preference, or its file switches motion off for reduce', () => {
    const bad: string[] = []
    let withMotion = 0
    for (const file of styledFiles()) {
      const blocks = parseBlocks(styleText(join(WEB, file)))
      const moving = unprotectedMotion(blocks)
      if (moving.length === 0) continue
      withMotion++
      const off = switchedOff(blocks)
      const left = moving.filter((m) => !off.has(m.kind))
      if (left.length > 0) bad.push(`${file}: ${left.map((m) => m.text).join('; ')} (no reduced-motion rule for it)`)
    }
    expect(bad).toEqual([])
    // The scan sees the motion the app has (the blob build-in); if it ever finds none, the scan is broken.
    expect(withMotion).toBeGreaterThan(0)
  })

  it('keyframes exist only in files that also switch motion off for reduce', () => {
    for (const file of styledFiles()) {
      const blocks = parseBlocks(styleText(join(WEB, file)))
      const hasKeyframes = blocks.some((b) => b.prelude.startsWith('@keyframes'))
      if (hasKeyframes) expect(switchedOff(blocks).has('animation'), file).toBe(true)
    }
  })

  it('script-driven motion (the reveal build-up, the self-test) asks matchMedia first', () => {
    for (const file of ['src/reveal/RevealProfile.svelte', 'src/selftest/RtSelfTest.svelte']) {
      expect(readFileSync(join(WEB, file), 'utf8'), file).toContain('(prefers-reduced-motion: reduce)')
    }
  })
})
