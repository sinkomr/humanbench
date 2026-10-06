/**
 * The quant entry hints (`templates.ts` HINTS; UX-079) and the ids of saved answers (DESIGN §7.8,
 * R-8.1; ROADMAP A11, A18): every hint says "whole number" as every other entry box does, and the
 * hint wording is display copy, so ids saved by this generator version regenerate the same items.
 */

import { describe, expect, it } from 'vitest'
import { FORMAT_HINTS } from '../../render/common/entry-copy'
import type { JsonValue } from '../../engine/types'
import { structuralHash } from '../ids'
import { resolveItem } from '../registry'
import { quant } from '.'
import { HINTS } from './templates'

/** The version saved quant ids carry; the content digest below is of its items. */
const SAVED_VERSION = '1.3.0'
/**
 * `structuralHash` of the items of `i:quant:1.3.0:saved-<i>`, i < 300, each without its display
 * hint (`spec.hint`). It was the same before the hint wording changed, and must stay so while the
 * version is 1.3.0: a change to anything an item is (stem, given, key, params, priors) needs a new
 * generator version, and then this pin moves with it.
 */
const SAVED_CONTENT_DIGEST = '2b07f5d0355e'

function withoutHint(item: object): JsonValue {
  const copy = JSON.parse(JSON.stringify(item)) as { spec: Record<string, unknown> }
  delete copy.spec.hint
  return copy as unknown as JsonValue
}

describe('quant entry hints', () => {
  it('say "whole number", never "integer", in the same words as the other entry boxes', () => {
    for (const [format, hint] of Object.entries(HINTS)) {
      expect(hint, format).not.toMatch(/integer/i)
      expect(hint, format).toBe(FORMAT_HINTS[format as keyof typeof FORMAT_HINTS])
    }
    expect(HINTS.integer).toBe('Enter a whole number, such as 42 or -7.')
    expect(HINTS.fraction).toBe('Enter a fraction such as 3/8, or a whole number.')
  })

  it('reach every generated item of their format', () => {
    for (let i = 0; i < 200; i++) {
      const item = quant.generate(`hint-${i}`)
      expect(item.spec.hint, item.item_id).toBe(HINTS[item.spec.input_format])
    }
  })
})

describe('saved quant ids (§7.8: results are re-scored from raw responses)', () => {
  it(`ids saved by generator ${SAVED_VERSION} still regenerate, with the same content`, () => {
    expect(quant.generatorVersion).toBe(SAVED_VERSION)
    const items = Array.from({ length: 300 }, (_, i) => {
      const id = `i:quant:${SAVED_VERSION}:saved-${i}`
      const item = resolveItem(id)
      expect(item?.item_id, id).toBe(id)
      return withoutHint(item as object)
    })
    expect(structuralHash(items)).toBe(SAVED_CONTENT_DIGEST)
  })
})
