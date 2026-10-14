/**
 * The alternate-uses task is suspended (owner decision 2026-10-13: "suspend the alternate uses family. i don't want to
 * use a model for any scoring"; ROADMAP M6.4). Its code stays, on the dev route only; no session plans or asks for it,
 * no served item is drawn by it, Creative Thinking is measured by the word links alone, and no screen of a session
 * says anything about it.
 */

import { describe, expect, it } from 'vitest'
import { AXIS_CODES } from '../../engine/axes'
import { SEGMENT_ORDER, TEXT_PARTS, servedPartAxes } from '../../engine/plan-table'
import { planSession } from '../../engine/selector'
import { SERVED_RENDERERS, toServedItem } from '../../backend/items'
import { isLazyRenderer } from '../../session/served-renderers'
import { SEGMENT_INFO } from '../../session/segments'
import * as sessionCopy from '../../session/copy'
import * as backendCopy from '../../backend/copy'

const AUT_WORDS = /unusual uses|alternate uses|alternative uses|uses for|aut\b/iu

describe('the alternate-uses task is suspended (ROADMAP M6.4)', () => {
  it('no part of any session plans it: Creative Thinking is the word-links part, and nothing else is on its axis', () => {
    expect(TEXT_PARTS.filter((p) => p.axis === 'CRE').map((p) => p.id)).toEqual(['word_links'])
    expect(SEGMENT_ORDER.some((id) => /aut|uses/u.test(id))).toBe(false)
    for (let n = 0; n < 6; n++) {
      const plan = planSession({ sessionSeed: `aut${n}`, textAxes: servedPartAxes([...AXIS_CODES], n) })
      for (const step of plan) {
        expect(step.segment).not.toMatch(/aut|uses/u)
        if (step.kind === 'block') expect(step.family).not.toMatch(/^aut/u)
      }
    }
  })

  it('no served item is drawn by it: a payload of it is unsupported, and no served renderer is its', () => {
    expect([...SERVED_RENDERERS].some((r) => /aut/u.test(r))).toBe(false)
    expect(isLazyRenderer('aut_v1')).toBe(false)
    expect(toServedItem(1, { itemId: 'i:aut:v1:made-up', itemType: 'aut_prompt', timeLimitS: 180, stem: 'A made-up object', media: { renderer: 'aut_v1', object: 'a made-up object' }, options: null }).supported).toBe(false)
  })

  it('no session copy mentions it: the part blurbs, the session words and the online words', () => {
    for (const info of Object.values(SEGMENT_INFO)) expect(info.blurb, info.id).not.toMatch(AUT_WORDS)
    expect(SEGMENT_INFO.word_links.blurb).toContain('Three words appear.')
    for (const copy of [sessionCopy, backendCopy]) {
      for (const [name, value] of Object.entries(copy)) if (typeof value === 'string') expect(value, name).not.toMatch(AUT_WORDS)
    }
  })
})
