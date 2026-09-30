import { describe, expect, it } from 'vitest'
import design from '../../docs/DESIGN.md?raw'
import indexHtml from '../index.html?raw'
import { DISCLAIMER, HEADING, RESOURCE_LINE } from './copy'

/** Extracts the quoted §13 "Non-diagnostic disclaimer" sentence from DESIGN.md. */
function designDisclaimer(md: string): string {
  const match = /\*\*Non-diagnostic disclaimer\*\*[^"\n]*"([^"\n]+)"/.exec(md)
  if (!match?.[1]) throw new Error('DESIGN §13 non-diagnostic disclaimer not found in docs/DESIGN.md')
  return match[1]
}

/** Extracts the quoted R-5.6.5 resource sentence from DESIGN.md. */
function designResourceLine(md: string): string {
  const match = /^- R-5\.6\.5:[^"\n]*"([^"\n]+)"/m.exec(md)
  if (!match?.[1]) throw new Error('DESIGN R-5.6.5 resource sentence not found in docs/DESIGN.md')
  return match[1]
}

/** The text of the no-JavaScript fallback in index.html, whitespace collapsed. */
const noscriptText = (): string => (/<noscript>([\s\S]*?)<\/noscript>/.exec(indexHtml)?.[1] ?? '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ')

describe('copy', () => {
  it('DISCLAIMER is word-for-word the DESIGN §13 non-diagnostic disclaimer', () => {
    const expected = designDisclaimer(design)
    expect(expected.length).toBeGreaterThan(40)
    expect(DISCLAIMER).toBe(expected)
  })

  it('RESOURCE_LINE is word-for-word the DESIGN R-5.6.5 sentence (the A13 allow-listed constant)', () => {
    const expected = designResourceLine(design)
    expect(expected).toMatch(/^If you're curious about /)
    expect(RESOURCE_LINE).toBe(expected)
  })

  it('the heading is the product name (the start screen of the M1.15 session flow)', () => {
    expect(HEADING).toBe('HumanBench')
  })

  it('index.html names the site and says it needs JavaScript, so a plain fetch of the Pages URL finds it', () => {
    expect(noscriptText()).toContain('HumanBench needs JavaScript')
  })

  it('index.html carries the §13 disclaimer word for word without JavaScript too (M1.20)', () => {
    expect(noscriptText()).toContain(DISCLAIMER)
  })
})
