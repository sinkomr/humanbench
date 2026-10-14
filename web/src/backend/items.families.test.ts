/**
 * The remaining families as the session gets them from the server (ROADMAP M3.11; owner decisions 2026-10-13): a
 * Fermi estimate, a word-links puzzle, an emotion vignette, a situational judgment and a logic game's question are
 * drawn by their renderers; a payload that does not fit is unsupported (the skip of §13); the answer the session
 * sends is one the renderer could give and the server takes (`hb.response_fits`); the confidence slider follows the
 * tier-a answers only (§3 row 12). Every payload here is made up (`render/served-demo.ts`).
 */

import fc from 'fast-check'
import { describe, expect, it } from 'vitest'
import { demoEmotionPayload, demoFermiPayload, demoLogicGamePayload, demoRatPayload, demoSjtPayload, DEMO_SETUPS, type DemoServedPayload } from '../render/served-demo'
import { TEXT_PASSAGE_RENDERER, isPassageSpec, passageTextOf, setupSentences } from '../render/text/passage'
import { isLazyRenderer, loadRenderer } from '../session/served-renderers'
import { asksConfidence, SERVED_RENDERERS, servedResponseFits, toServedItem, type ServedItem } from './items'
import { parseNext } from './replies'
import { UNITS } from '../tasks/fermi/units'

function served(p: DemoServedPayload, set: { position: number; of: number } | null = null): ServedItem {
  const w = parseNext({ seq: 4, item: { item_id: 'i:test:v1:made-up', item_type: p.itemType, time_limit_s: 180, stem: p.stem, media: p.media, ...(p.options === null ? {} : { options: p.options }) }, ...(set === null ? {} : { set }) })
  if (w.kind !== 'item') throw new Error('not an item')
  return toServedItem(w.seq, w.item, w.set)
}

describe('the remaining families are drawn by their renderers', () => {
  it('a Fermi estimate: the stem and the entry shape, no options, no confidence slider', () => {
    const s = served(demoFermiPayload(1))
    expect(s).toMatchObject({ family: 'fermi_v1', supported: true, item_type: 'fermi_estimate' })
    expect(s.options_count).toBeUndefined()
    expect(s.spec).toMatchObject({ interval_pct: 80 })
    expect(asksConfidence(s)).toBe(false)
  })

  it('a word-links puzzle: three cues, typed entry, rated for confidence (tier a)', () => {
    const s = served(demoRatPayload(2))
    expect(s).toMatchObject({ family: 'rat_triad_v1', supported: true })
    expect((s.spec as { cues: string[] }).cues).toHaveLength(3)
    expect(s.options_count).toBeUndefined()
    expect(asksConfidence(s)).toBe(true)
  })

  it('an emotion vignette: five feelings, no confidence slider (tier c)', () => {
    const s = served(demoEmotionPayload(3))
    expect(s).toMatchObject({ family: 'emotion_vignette_v1', supported: true, options_count: 5 })
    expect(asksConfidence(s)).toBe(false)
  })

  it('a situational judgment: four responses to rate, no confidence slider (no right answer)', () => {
    const s = served(demoSjtPayload(4))
    expect(s).toMatchObject({ family: 'sjt_rating_v1', supported: true, options_count: 4 })
    expect(asksConfidence(s)).toBe(false)
  })

  it('a logic game: drawn as a passage question, its setup in the passage place as an opening and a list of rules, with its place in the set', () => {
    const s = served(demoLogicGamePayload(0, 1), { position: 2, of: 4 })
    expect(s).toMatchObject({ family: TEXT_PASSAGE_RENDERER, supported: true, options_count: 5, set: { index: 2, of: 4 } })
    expect(isPassageSpec(s.spec)).toBe(true)
    const text = passageTextOf(s.spec as never)
    expect(text.kind).toBe('setup')
    expect(text.passage).toEqual([setupSentences(DEMO_SETUPS[0]!)[0]])
    expect(text.rules).toEqual(setupSentences(DEMO_SETUPS[0]!).slice(1))
    expect(text.rules!.length).toBe(3)
    // the questions of one game share the setup's key, so the screen keeps it in place across them
    expect(passageTextOf(served(demoLogicGamePayload(0, 2)).spec as never).passageKey).toBe(text.passageKey)
    expect(passageTextOf(served(demoLogicGamePayload(1, 0)).spec as never).passageKey).not.toBe(text.passageKey)
    expect(asksConfidence(s)).toBe(true)
  })

  it('splits a setup into its sentences only at a full stop followed by a capital or a digit', () => {
    expect(setupSentences('Six things (F, G and H) are in slots 1 through 6. F is before G. If H is in slot 2, then G is not.')).toEqual(['Six things (F, G and H) are in slots 1 through 6.', 'F is before G.', 'If H is in slot 2, then G is not.'])
    expect(setupSentences('  One sentence only.  ')).toEqual(['One sentence only.'])
  })

  it('marks a payload that does not fit its family as unsupported: an unknown media field, a missing part, another interval; the renderer checks the rest when it arrives', async () => {
    const f = demoFermiPayload(1)
    expect(served({ ...f, media: { ...f.media, extra: 1 } }).supported).toBe(false)
    expect(served({ ...f, media: { ...f.media, interval_pct: 90 } }).supported).toBe(false)
    // units of two dimensions have the payload's shape; the Fermi renderer, with the units table, refuses the spec
    // (`session/served-renderers.ts`; Stage then offers the skip), and takes a good one
    const mixed = served({ ...f, media: { ...f.media, units: ['m', 's'] } })
    expect(mixed.supported).toBe(true)
    const fermi = await loadRenderer('fermi_v1')
    expect(fermi.fits(mixed.spec)).toBe(false)
    expect(fermi.fits(served(f).spec)).toBe(true)
    for (const [family, p] of [['rat_triad_v1', demoRatPayload(1)], ['emotion_vignette_v1', demoEmotionPayload(1)], ['sjt_rating_v1', demoSjtPayload(1)]] as const) {
      expect((await loadRenderer(family)).fits(served(p).spec), family).toBe(true)
    }
    // a triad whose cues are not lowercase words has the shape and not the spec
    expect((await loadRenderer('rat_triad_v1')).fits(served({ ...demoRatPayload(1), media: { renderer: 'rat_triad_v1', cues: ['Aa', 'bb b', 'cc'] } }).spec)).toBe(false)
    const r = demoRatPayload(1)
    expect(served({ ...r, media: { ...r.media, cues: ['a', 'b'] } }).supported).toBe(false)
    const j = demoSjtPayload(1)
    expect(served({ ...j, options: j.options!.slice(0, 3) }).supported).toBe(false)
    const g = demoLogicGamePayload(0, 0)
    expect(served({ ...g, media: { renderer: 'logic_game_v1', setup: '   ' } }).supported).toBe(false)
    expect(served({ ...g, media: { ...g.media, formal: {} } }).supported).toBe(false)
    expect(served({ ...g, options: null }).supported).toBe(false)
  })

  it('names each served renderer once, as its task module does, and every one of them is drawn (fetched when needed)', async () => {
    expect(new Set(SERVED_RENDERERS).size).toBe(SERVED_RENDERERS.length)
    const names = await Promise.all([import('../tasks/fermi/spec'), import('../tasks/rat/spec'), import('../tasks/emotion/spec'), import('../tasks/sjt/spec')])
    expect([...SERVED_RENDERERS]).toEqual([names[0].FERMI_RENDERER, names[1].RAT_RENDERER, names[2].EMOTION_RENDERER, names[3].SJT_RENDERER])
    for (const f of SERVED_RENDERERS) expect(isLazyRenderer(f), f).toBe(true)
    expect(isLazyRenderer('text_mc')).toBe(false)
    for (const p of [demoFermiPayload(0), demoRatPayload(0), demoEmotionPayload(0), demoSjtPayload(0)]) expect(SERVED_RENDERERS).toContain(served(p).family)
  })
})

describe('the answer the session sends is one the renderer could give (and hb.response_fits takes)', () => {
  it('Fermi: {value, unit, low, high}, magnitudes in range, a unit the entry offers, low ≤ value ≤ high, at most 8 dex across', () => {
    const s = served(demoFermiPayload(1))
    const m = (s.spec as { units: string[] }).units[0]!
    const offered = (s.spec as { units: string[] }).units
    const other = UNITS.map((u) => u.symbol).find((u) => !offered.includes(u))!
    expect(servedResponseFits(s, { value: 10, unit: m, low: 5, high: 20 })).toBe(true)
    for (const bad of [{ value: 10, unit: m, low: 20, high: 30 }, { value: 10, unit: 'furlong', low: 5, high: 20 }, { value: 10, unit: other, low: 5, high: 20 }, { value: 10, unit: m, low: 5 }, { value: 10, unit: m, low: 1e-10, high: 20 }, { value: 0, unit: m, low: 0, high: 1 }, '10', 10, null]) {
      expect(servedResponseFits(s, bad), JSON.stringify(bad)).toBe(false)
    }
  })

  it('situational judgment: four whole ratings 1 to 4', () => {
    const s = served(demoSjtPayload(1))
    expect(servedResponseFits(s, [1, 2, 3, 4])).toBe(true)
    for (const bad of [[1, 2, 3], [0, 2, 3, 4], [1.5, 2, 3, 4], { most: 0, least: 1 }, 2]) expect(servedResponseFits(s, bad)).toBe(false)
  })

  it('word links: text of 1 to 40 characters; emotion vignettes and logic games: an option position', () => {
    const r = served(demoRatPayload(1))
    expect(servedResponseFits(r, 'word')).toBe(true)
    for (const bad of ['', '   ', 'a'.repeat(41), 3]) expect(servedResponseFits(r, bad)).toBe(false)
    const e = served(demoEmotionPayload(1))
    expect(servedResponseFits(e, 4)).toBe(true)
    expect(servedResponseFits(e, 5)).toBe(false)
    const g = served(demoLogicGamePayload(0, 0))
    expect(servedResponseFits(g, 0)).toBe(true)
    expect(servedResponseFits(g, 'A')).toBe(false)
  })

  it('never throws, whatever the response (fuzzed)', () => {
    const items = [demoFermiPayload(1), demoRatPayload(1), demoEmotionPayload(1), demoSjtPayload(1), demoLogicGamePayload(1, 0)].map((p) => served(p))
    fc.assert(
      fc.property(fc.anything(), (v) => {
        for (const s of items) expect(typeof servedResponseFits(s, v)).toBe('boolean')
      }),
    )
  })
})
