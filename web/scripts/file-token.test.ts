/**
 * The notes page shows its download name (`hb-notes-2026-10-k3f9.txt`), so the random token in it is copy the language lint
 * scans (A13, R-5.6.1). A free draw over letters and digits once spelled `iq5y`, and e2e/notes.spec.ts failed on "iq";
 * fileToken alternates letters and digits so no banned term can appear, whatever the bytes.
 */

import fc from 'fast-check'
import { describe, expect, it } from 'vitest'
import { fileToken } from '../src/brief/browser'
import { lintText } from './language-lint'

function fixed(bytes: Uint8Array): Pick<Crypto, 'getRandomValues'> {
  return {
    getRandomValues: <T extends ArrayBufferView | null>(a: T): T => {
      ;(a as unknown as Uint8Array).set(bytes.subarray(0, (a as unknown as Uint8Array).length))
      return a
    },
  }
}

describe('fileToken and the language lint (A13)', () => {
  it('no token, whatever the bytes, puts a banned term in a download name', () => {
    fc.assert(
      fc.property(fc.integer({ min: 1, max: 12 }), fc.uint8Array({ minLength: 12, maxLength: 12 }), (length, bytes) => {
        const name = `hb-notes-2026-10-${fileToken(length, fixed(bytes))}.txt`
        expect(lintText(`<code>${name}</code>`, 'rendered.html')).toEqual([])
      }),
      { numRuns: 2000 },
    )
  })

  it('the bytes that drew "iq5y" before now draw a name the lint passes', () => {
    // 8 -> "i", 16 -> "q" in the old 36-symbol alphabet: a free draw put "iq" in the page.
    const token = fileToken(4, fixed(Uint8Array.from([8, 16, 5, 24])))
    expect(token).toBe('i6f4')
    expect(lintText(`hb-notes-2026-10-${token}.txt`, 'rendered.html')).toEqual([])
  })

  it('the lint does catch two touching letters that spell a term, so the property above tests something', () => {
    expect(lintText('hb-notes-2026-10-iq5y.txt', 'rendered.html').map((h) => h.term)).toEqual(['iq'])
  })
})
