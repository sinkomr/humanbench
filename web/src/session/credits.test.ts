/**
 * The credits section of the privacy notice (owner decision of 2026-10-06 on the word resources the Remote Associates
 * items are checked against). The app has no page of its own for credits, so `CREDITS_SECTION` is the last section of
 * "Privacy and terms", in the static version (`PRIVACY_SECTIONS`) and in the online one (`SERVER_PRIVACY_SECTIONS`).
 *
 * What is checked: the constant and its place in both lists; paragraph 1 word for word as the memo gives it; the heading
 * is a unique key (`Privacy.svelte` keys its sections by heading); the copy rules (A13 language lint, no TODO, no benefit
 * claim, the house style of the notice); and the rendered `Privacy` component of both versions shows the heading and both
 * paragraphs, after every other section.
 *
 * The rendering is Svelte's server render, because this file runs in the `unit` project (node). The jsdom side is
 * covered where it already is: `App.dom.test.ts` and `App.served.dom.test.ts` mount the whole app at `#/privacy` and
 * assert every heading of `PRIVACY_SECTIONS` and `SERVER_PRIVACY_SECTIONS`, so "Credits" is asserted there in both
 * versions; `e2e/credits.spec.ts` looks at it in real browsers. The repo-wide checks that already cover this copy are
 * `scripts/language-lint.test.ts` (A13, every string of `copy.ts` and `backend/copy.ts`) and `session/copy.test.ts` (no
 * claim of a benefit, over every exported string).
 */

import { render } from 'svelte/server'
import { describe, expect, it } from 'vitest'
import { lintText } from '../../scripts/language-lint'
import { SERVER_PRIVACY_SECTIONS } from '../backend/copy'
import { CREDITS_SECTION, PRIVACY_SECTIONS, type PrivacySection } from './copy'
import Privacy from './Privacy.svelte'

/** The memo's credits line (the bank's `docs/rat-corpus.md` §6), the first paragraph word for word. */
const MEMO_LINE =
  'Remote-associates items are original to HumanBench. They were checked against Google Books Ngram Viewer data (https://books.google.com/ngrams, CC BY 3.0), Open English WordNet (CC BY 4.0, based on Princeton WordNet), the Moby Word Lists by Grady Ward (public domain) and VarCon by Kevin Atkinson.'

/** Paragraph 2: the attribution for wordfreq, the secondary signal the owner also approved. */
const WORDFREQ_LINE =
  'Word frequencies were also checked with wordfreq by Robyn Speer (data CC BY-SA 4.0), which draws on Google Books Ngram Viewer data, Wikipedia, the Leeds Internet Corpus, ParaCrawl, OpenSubtitles and the SUBTLEX word lists by Marc Brysbaert, Boris New and colleagues (SUBTLEX is freely available data).'

const VERSIONS: readonly (readonly [string, readonly PrivacySection[]])[] = [
  ['static', PRIVACY_SECTIONS],
  ['online', SERVER_PRIVACY_SECTIONS],
]

describe('CREDITS_SECTION', () => {
  it('is headed Credits and has the memo line, then the wordfreq line', () => {
    expect(CREDITS_SECTION.heading).toBe('Credits')
    expect(CREDITS_SECTION.paragraphs[0]).toBe(MEMO_LINE)
    expect(CREDITS_SECTION.paragraphs[1]).toBe(WORDFREQ_LINE)
    expect(CREDITS_SECTION.paragraphs).toHaveLength(2)
  })

  it('names every resource and licence the memo lists, and the sources behind the word frequencies', () => {
    const text = CREDITS_SECTION.paragraphs.join('\n')
    for (const part of [
      'https://books.google.com/ngrams',
      'CC BY 3.0',
      'Open English WordNet (CC BY 4.0, based on Princeton WordNet)',
      'Moby Word Lists by Grady Ward (public domain)',
      'VarCon by Kevin Atkinson',
      'wordfreq by Robyn Speer (data CC BY-SA 4.0)',
      'SUBTLEX word lists by Marc Brysbaert, Boris New and colleagues',
    ]) {
      expect(text, part).toContain(part)
    }
  })

  it('credits wordfreq in full in paragraph 2: its author and data licence, every source its licence text lists, and that SUBTLEX is freely available', () => {
    const p2 = CREDITS_SECTION.paragraphs[1] ?? ''
    for (const part of ['Robyn Speer', 'CC BY-SA 4.0', 'Google Books Ngram Viewer', 'Wikipedia', 'Leeds Internet Corpus', 'ParaCrawl', 'OpenSubtitles', 'SUBTLEX', 'freely available']) {
      expect(p2, part).toContain(part)
    }
    // The freely-available condition is about SUBTLEX, in the same breath as its name.
    expect(p2).toContain('(SUBTLEX is freely available data)')
  })

  it('is the very same section in both versions, and the last one', () => {
    for (const [name, sections] of VERSIONS) {
      expect(sections.at(-1), name).toBe(CREDITS_SECTION)
      expect(sections.filter((s) => s === CREDITS_SECTION), name).toHaveLength(1)
    }
  })

  it('leaves the sections before it as they were, in the same order: Credits is added after the terms in the static notice (six sections) and in the online one (eight)', () => {
    expect(PRIVACY_SECTIONS.map((s) => s.heading)).toEqual(['Who runs this site', 'What this version keeps', 'Where it stays', 'When there is an online version', 'Your choices', 'Terms of use', 'Credits'])
    expect(SERVER_PRIVACY_SECTIONS.map((s) => s.heading)).toEqual([
      'Who runs this site',
      'What this version keeps',
      'What is sent to the server',
      'Your notes settings stay on your device',
      'Your save file and the server backup',
      'How long it is kept, and your rights',
      'Your choices',
      'Terms of use',
      'Credits',
    ])
  })

  it('has a heading that is a unique key in each list (Privacy.svelte keys its sections by heading), and no repeated paragraph', () => {
    for (const [name, sections] of VERSIONS) {
      const headings = sections.map((s) => s.heading)
      expect(new Set(headings).size, name).toBe(headings.length)
      expect(headings.filter((h) => h === CREDITS_SECTION.heading), name).toHaveLength(1)
    }
    expect(new Set(CREDITS_SECTION.paragraphs).size).toBe(CREDITS_SECTION.paragraphs.length)
  })

  it('is frozen, so nothing can change what both notices say', () => {
    expect(Object.isFrozen(CREDITS_SECTION)).toBe(true)
    expect(Object.isFrozen(CREDITS_SECTION.paragraphs)).toBe(true)
  })
})

describe('the credits text keeps the rules of the copy', () => {
  const lines: readonly [string, string][] = [['heading', CREDITS_SECTION.heading], ...CREDITS_SECTION.paragraphs.map((p, i): [string, string] => [`paragraph ${i + 1}`, p])]

  it('passes the language lint (A13, R-5.6.x): no clinical or diagnostic word', () => {
    for (const [name, text] of lines) expect(lintText(text, `credits-${name}.txt`), name).toEqual([])
  })

  it('has no placeholder, and none of the notice’s house style is broken: plain text, straight quotes, no dash for a pause, whole sentences', () => {
    for (const [name, text] of lines) {
      expect(text, name).not.toMatch(/TODO/)
      expect(text, name).toBe(text.trim())
      expect(text, name).not.toMatch(/\s{2,}|\n/)
      expect(text, name).not.toMatch(/[‘’“”–—]/) // curly quotes, en and em dashes
    }
    for (const p of CREDITS_SECTION.paragraphs) expect(p).toMatch(/[A-Z].*\.$/)
  })

  it('credits sources and says nothing about the person, what the site keeps, or a benefit', () => {
    const text = CREDITS_SECTION.paragraphs.join('\n')
    expect(text).not.toMatch(/\byou(r|rs)?\b/i)
    expect(text).not.toMatch(/\b(?:helps?|improves?|boosts?|proven|guarantee\w*|effective|better|accurate)\b/i)
  })
})

/** What the server render of `Privacy` shows of its sections: the `h2` headings and the paragraphs, in order. */
function shown(html: string): { headings: string[]; paragraphs: string[] } {
  const text = (inner: string): string => inner.replace(/<!--[\s\S]*?-->/g, '').replace(/<[^>]+>/g, '').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&#39;/g, "'").replace(/&quot;/g, '"').trim()
  const all = (tag: string): string[] => [...html.matchAll(new RegExp(`<${tag}(?:\\s[^>]*)?>([\\s\\S]*?)</${tag}>`, 'g'))].map((m) => text(m[1] ?? ''))
  return { headings: all('h2'), paragraphs: all('p') }
}

describe('the rendered notice', () => {
  const versions: readonly (readonly [string, readonly PrivacySection[], { sections?: readonly PrivacySection[]; dataLink?: boolean }])[] = [
    ['static (the default sections)', PRIVACY_SECTIONS, {}],
    ['online (the sections and the data link App passes with a server)', SERVER_PRIVACY_SECTIONS, { sections: SERVER_PRIVACY_SECTIONS, dataLink: true }],
  ]

  for (const [name, sections, props] of versions) {
    it(`${name}: the Credits heading comes last, with both paragraphs under it`, () => {
      const { body } = render(Privacy, { props })
      const { headings, paragraphs } = shown(body)

      // Every section is there, in order, and Credits is the last of them.
      expect(headings).toEqual(sections.map((s) => s.heading))
      expect(headings.at(-1)).toBe('Credits')
      expect(headings.filter((h) => h === 'Credits')).toHaveLength(1)

      // Both paragraphs are in the page, one after the other, after the paragraphs of the terms.
      const first = paragraphs.indexOf(MEMO_LINE)
      expect(first).toBeGreaterThan(-1)
      expect(paragraphs[first + 1]).toBe(WORDFREQ_LINE)
      expect(paragraphs.filter((p) => p === MEMO_LINE || p === WORDFREQ_LINE)).toHaveLength(2)
      const terms = sections.find((s) => s.heading === 'Terms of use')
      expect(terms).toBeDefined()
      for (const p of terms?.paragraphs ?? []) expect(paragraphs.indexOf(p)).toBeLessThan(first)

      // The markup puts the two paragraphs between the Credits heading and the delete button.
      const at = body.indexOf('<h2>Credits</h2>')
      expect(at).toBeGreaterThan(-1)
      expect(body.indexOf(MEMO_LINE)).toBeGreaterThan(at)
      expect(body.indexOf(WORDFREQ_LINE)).toBeGreaterThan(body.indexOf(MEMO_LINE))
      expect(body.indexOf('hb-actions')).toBeGreaterThan(body.indexOf(WORDFREQ_LINE))
    })
  }

  it('the page heading, the delete button and the Back link are as they were', () => {
    const { body } = render(Privacy, {})
    expect(body).toContain('Privacy and terms')
    expect(body).toContain('Delete the data this site keeps in this browser')
    expect(body).toContain('>Back</a>')
  })
})
