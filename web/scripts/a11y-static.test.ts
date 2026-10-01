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
import { switchesOffAny, uncoveredMotion, unprotectedMotion } from './motion'

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
  it('every animation, transition or smooth scroll is under no-preference, or a reduce rule switches off that very selector (or *)', () => {
    const bad: string[] = []
    let withMotion = 0
    for (const file of styledFiles()) {
      const blocks = parseBlocks(styleText(join(WEB, file)))
      if (unprotectedMotion(blocks).length > 0) withMotion++
      const left = uncoveredMotion(blocks)
      if (left.length > 0) bad.push(`${file}: ${left.map((m) => m.text).join('; ')} (no prefers-reduced-motion: reduce rule for this selector)`)
    }
    expect(bad).toEqual([])
    // The scan sees the motion the app has (the blob build-in); if it ever finds none, the scan is broken.
    expect(withMotion).toBeGreaterThan(0)
  })

  it('keyframes exist only in files that also switch animation off for reduce', () => {
    for (const file of styledFiles()) {
      const blocks = parseBlocks(styleText(join(WEB, file)))
      const hasKeyframes = blocks.some((b) => b.prelude.startsWith('@keyframes'))
      if (hasKeyframes) expect(switchesOffAny(blocks, 'animation'), file).toBe(true)
    }
  })

  describe('the scan itself', () => {
    const uncovered = (css: string): string[] => uncoveredMotion(parseBlocks(css)).map((m) => m.text)
    const reduce = (rules: string): string => `@media (prefers-reduced-motion: reduce) { ${rules} }`

    it('passes motion that is switched off for its own selector, or for *, or only runs under no-preference', () => {
      expect(uncovered(`.a { animation: grow 1s } ${reduce('.a { animation: none }')}`)).toEqual([])
      expect(uncovered(`.a, .b { transition: color 1s } ${reduce('.b, .a { transition: none !important }')}`)).toEqual([])
      expect(uncovered(`html { scroll-behavior: smooth } ${reduce('* { scroll-behavior: auto }')}`)).toEqual([])
      expect(uncovered(`@media (prefers-reduced-motion: no-preference) { .a { animation: grow 1s; transition: color 1s } }`)).toEqual([])
      expect(uncovered(`@media (max-width: 40rem) { .a { animation: grow 1s } } ${reduce('.a { animation: none }')}`)).toEqual([])
    })

    it('fails a rule that another selector\'s reset does not stop (the reduce rule of a file is not a blanket)', () => {
      expect(uncovered(`.a { animation: grow 1s } figure { animation: grow 900ms ease-out } ${reduce('.a { animation: none }')}`)).toEqual(['figure { animation: grow 900ms ease-out }'])
      expect(uncovered(`.a, .b { transition: color 1s } ${reduce('.a { transition: none }')}`)).toEqual(['.a, .b { transition: color 1s }'])
    })

    it('fails a kind of motion the file never switches off, and a reset of the wrong kind', () => {
      expect(uncovered('.a { transition: color 1s }')).toEqual(['.a { transition: color 1s }'])
      expect(uncovered(`.a { transition: color 1s } ${reduce('.a { animation: none }')}`)).toEqual(['.a { transition: color 1s }'])
      expect(uncovered(`html { scroll-behavior: smooth } ${reduce('.a { scroll-behavior: auto }')}`)).toEqual(['html { scroll-behavior: smooth }'])
    })
  })

  it('script-driven motion (the reveal build-up, the self-test) asks matchMedia first', () => {
    for (const file of ['src/reveal/RevealProfile.svelte', 'src/selftest/RtSelfTest.svelte']) {
      expect(readFileSync(join(WEB, file), 'utf8'), file).toContain('(prefers-reduced-motion: reduce)')
    }
  })
})
