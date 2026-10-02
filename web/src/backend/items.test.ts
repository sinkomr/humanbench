import { describe, expect, it } from 'vitest'
import { ENTRY_RENDERERS } from '../render/entry'
import { VISUAL_RENDERERS } from '../render/visual'
import { getFamily } from '../tasks/registry'
import { SUPPORTED_RENDERERS, isSupportedRenderer, specOf, toServedItem } from './items'
import { parseNext } from './replies'

/** The row the bank stores for a generated instance (hb.items.from_twin): media = spec + renderer, options = labels. */
function wireOf(name: string, seed: string): ReturnType<typeof parseNext> {
  const item = getFamily(name)!.generate(seed)
  const labels = item.options_count === undefined ? null : Array.from({ length: item.options_count }, (_, i) => String.fromCharCode(65 + i))
  return parseNext({
    seq: 3,
    item: { item_id: item.item_id, item_type: item.item_type, time_limit_s: Math.ceil(item.time_limit_s ?? 180), media: { renderer: name, ...(item.spec as object) }, ...(labels === null ? {} : { options: labels }) },
  })
}

describe('the served families (M2.7)', () => {
  it('each has a renderer in the app, and is a family the registry knows', () => {
    for (const name of SUPPORTED_RENDERERS) {
      const hasRenderer = Object.hasOwn(VISUAL_RENDERERS, name) || Object.hasOwn(ENTRY_RENDERERS, name)
      expect(hasRenderer, name).toBe(true)
      expect(getFamily(name), name).toBeDefined()
      expect(getFamily(name)!.kind, name).toBe('item')
    }
  })

  it.each(SUPPORTED_RENDERERS)('%s: the spec the renderer takes comes back from what the bank stores', (name) => {
    for (const seed of ['a', 'b', 'c']) {
      const original = getFamily(name)!.generate(seed)
      const w = wireOf(name, seed)
      expect(w.kind).toBe('item')
      if (w.kind !== 'item') return
      const served = toServedItem(w.seq, w.item)
      expect(served).toMatchObject({ seq: 3, item_id: original.item_id, family: name, supported: true, item_type: original.item_type })
      expect(served.spec).toEqual(JSON.parse(JSON.stringify(original.spec)))
      expect(Object.hasOwn(served.spec, 'renderer')).toBe(false)
      expect(served.options_count).toBe(original.options_count)
      expect(served.time_limit_s).toBe(Math.ceil(original.time_limit_s ?? 180))
    }
  })
})

describe('toServedItem', () => {
  const base = { itemId: 'i:x', itemType: 'mc', timeLimitS: null, stem: null, media: null, options: null } as const

  it('marks an item with no renderer, or one this build does not have, as unsupported (never blank, never guessed)', () => {
    expect(toServedItem(1, { ...base, stem: 'Which is larger?', options: ['a', 'b', 'c'] })).toEqual({ seq: 1, item_id: 'i:x', item_type: 'mc', family: '', spec: {}, options_count: 3, time_limit_s: null, supported: false })
    expect(toServedItem(1, { ...base, media: { renderer: 'polycube_v9', target: [] } })).toMatchObject({ supported: false, family: 'polycube_v9', spec: {} })
    expect(toServedItem(1, { ...base, media: { target: [] } })).toMatchObject({ supported: false, family: '' })
    expect(toServedItem(1, { ...base, media: { renderer: 'reading', passage: 'x' } })).toMatchObject({ supported: false }) // a block family is never a served item
  })

  it('does not mistake a prototype name or a non-string for a renderer', () => {
    for (const r of ['constructor', '__proto__', 'toString', 7, null, ['rotation']]) expect(isSupportedRenderer(r)).toBe(false)
    expect(toServedItem(1, { ...base, media: { renderer: 'constructor' } }).supported).toBe(false)
  })

  it('specOf drops only the renderer name', () => {
    expect(specOf({ renderer: 'quant', stem: 'x', unit: 'km' })).toEqual({ stem: 'x', unit: 'km' })
  })
})

describe('parseNext', () => {
  it('reads an item and the three reasons for none, and nothing else', () => {
    expect(parseNext({ done: true, reason: 'item_limit' })).toEqual({ kind: 'done', reason: 'item_limit' })
    expect(parseNext({ done: true, reason: 'no_items' })).toEqual({ kind: 'done', reason: 'no_items' })
    expect(() => parseNext({ done: true, reason: 'bored' })).toThrowError(/unknown reason/u)
    expect(() => parseNext({ seq: 1, item: { item_id: 'x', item_type: 'mc', time_limit_s: null, options: [1] } })).toThrowError(/strings/u)
    expect(() => parseNext(null)).toThrowError(/object/u)
  })
})
