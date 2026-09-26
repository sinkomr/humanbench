import { describe, expect, it } from 'vitest'
import design from '../../docs/DESIGN.md?raw'
import indexHtml from '../index.html?raw'
import { DISCLAIMER, HEADING } from './copy'

/** Extracts the quoted §13 "Non-diagnostic disclaimer" sentence from DESIGN.md. */
function designDisclaimer(md: string): string {
  const match = /\*\*Non-diagnostic disclaimer\*\*[^"\n]*"([^"\n]+)"/.exec(md)
  if (!match?.[1]) throw new Error('DESIGN §13 non-diagnostic disclaimer not found in docs/DESIGN.md')
  return match[1]
}

describe('copy', () => {
  it('DISCLAIMER is word-for-word the DESIGN §13 non-diagnostic disclaimer', () => {
    const expected = designDisclaimer(design)
    expect(expected.length).toBeGreaterThan(40)
    expect(DISCLAIMER).toBe(expected)
  })

  it('the M0 heading says hello (DESIGN §14.3 M0: Pages URL serves "hello")', () => {
    expect(HEADING).toBe('HumanBench — hello')
  })

  it('index.html says hello without JavaScript, so a plain fetch of the Pages URL finds it', () => {
    const noscript = /<noscript>([\s\S]*?)<\/noscript>/.exec(indexHtml)?.[1] ?? ''
    expect(noscript).toContain('HumanBench — hello')
  })
})
