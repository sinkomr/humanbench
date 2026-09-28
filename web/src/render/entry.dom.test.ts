/**
 * The entry/block renderer map (ROADMAP M1.13 part B, A18): it covers exactly the entry and block
 * families, every renderer mounts on generated instances of its family, and each renderer's
 * `onrespond` takes exactly the response type of its family's `score()` (checked at compile time
 * by `npm run check`, which type-checks this file).
 */

import type { Component, ComponentProps } from 'svelte'
import { afterEach, describe, expect, expectTypeOf, it } from 'vitest'
import { coding } from '../tasks/coding'
import { quant } from '../tasks/quant'
import { reading } from '../tasks/reading'
import { FAMILY_NAMES, getFamily } from '../tasks/registry'
import { rtChoice4, rtSimple } from '../tasks/rt'
import { series } from '../tasks/series'
import { corsi, spanBwd, spanFwd } from '../tasks/span'
import CodingRenderer from './coding/CodingRenderer.svelte'
import { fakeDisplay, render } from './common/testing'
import { ENTRY_RENDERERS, ENTRY_RENDERER_FAMILIES, entryRenderer } from './entry'
import QuantRenderer from './quant/QuantRenderer.svelte'
import ReadingRenderer from './reading/ReadingRenderer.svelte'
import RtRenderer from './rt/RtRenderer.svelte'
import SeriesRenderer from './series/SeriesRenderer.svelte'
import CorsiRenderer from './span/CorsiRenderer.svelte'
import DigitSpanRenderer from './span/DigitSpanRenderer.svelte'

type RespOf<C extends Component<any>> = ComponentProps<C> extends { onrespond: (response: infer R) => void } ? R : never
type SpecOf<C extends Component<any>> = ComponentProps<C> extends { spec: infer S } ? S : never
type ScoreResp<F> = F extends { score(item: never, response: infer R): unknown } ? R : never
type SpecOfFamily<F> = F extends { generate(seed: string): { spec: infer S } } ? S : never

let cleanup: (() => void)[] = []
afterEach(() => {
  for (const f of cleanup) f()
  cleanup = []
})

describe('ENTRY_RENDERERS', () => {
  it('covers exactly the entry and block families of M1.13 part B, all registered', () => {
    expect([...ENTRY_RENDERER_FAMILIES].sort()).toEqual(['coding', 'corsi', 'quant', 'reading', 'rt_choice4', 'rt_simple', 'series', 'span_bwd', 'span_fwd'])
    for (const f of ENTRY_RENDERER_FAMILIES) expect(FAMILY_NAMES as readonly string[]).toContain(f)
    expect(entryRenderer('series')).toBe(SeriesRenderer)
    expect(entryRenderer('rotation')).toBeUndefined()
    expect(entryRenderer('toString')).toBeUndefined()
  })

  it('each renderer takes its family spec and responds with exactly what score() takes (compile time)', () => {
    expectTypeOf<RespOf<typeof SeriesRenderer>>().toEqualTypeOf<ScoreResp<typeof series>>()
    expectTypeOf<RespOf<typeof QuantRenderer>>().toEqualTypeOf<ScoreResp<typeof quant>>()
    expectTypeOf<RespOf<typeof DigitSpanRenderer>>().toEqualTypeOf<ScoreResp<typeof spanFwd>>()
    expectTypeOf<RespOf<typeof DigitSpanRenderer>>().toEqualTypeOf<ScoreResp<typeof spanBwd>>()
    expectTypeOf<RespOf<typeof CorsiRenderer>>().toEqualTypeOf<ScoreResp<typeof corsi>>()
    expectTypeOf<RespOf<typeof RtRenderer>>().toEqualTypeOf<ScoreResp<typeof rtSimple>>()
    expectTypeOf<RespOf<typeof RtRenderer>>().toEqualTypeOf<ScoreResp<typeof rtChoice4>>()
    expectTypeOf<RespOf<typeof CodingRenderer>>().toEqualTypeOf<ScoreResp<typeof coding>>()
    expectTypeOf<RespOf<typeof ReadingRenderer>>().toEqualTypeOf<ScoreResp<typeof reading>>()
    expectTypeOf<SpecOf<typeof SeriesRenderer>>().toEqualTypeOf<SpecOfFamily<typeof series>>()
    expectTypeOf<SpecOf<typeof QuantRenderer>>().toEqualTypeOf<SpecOfFamily<typeof quant>>()
    expectTypeOf<SpecOf<typeof CorsiRenderer>>().toEqualTypeOf<SpecOfFamily<typeof corsi>>()
    expectTypeOf<SpecOf<typeof RtRenderer>>().toEqualTypeOf<SpecOfFamily<typeof rtSimple>>()
    expectTypeOf<SpecOf<typeof CodingRenderer>>().toEqualTypeOf<SpecOfFamily<typeof coding>>()
    expectTypeOf<SpecOf<typeof ReadingRenderer>>().toEqualTypeOf<SpecOfFamily<typeof reading>>()
    // Not vacuous: the inferred types are the concrete response types.
    expectTypeOf<RespOf<typeof SeriesRenderer>>().toEqualTypeOf<number | string>()
    expectTypeOf<ScoreResp<typeof quant>>().toEqualTypeOf<string>()
    expectTypeOf<RespOf<typeof ReadingRenderer>>().not.toBeNever()
    expectTypeOf<ScoreResp<typeof coding>>().not.toBeNever()
    // No renderer takes a key.
    expectTypeOf<ComponentProps<typeof SeriesRenderer>>().not.toHaveProperty('key')
    expectTypeOf<ComponentProps<typeof ReadingRenderer>>().not.toHaveProperty('key')
  })

  it('every renderer mounts on 20 instances of each of its families with only spec and onrespond', () => {
    for (const name of ENTRY_RENDERER_FAMILIES) {
      const family = getFamily(name)
      expect(family, name).toBeDefined()
      for (let i = 0; i < 20; i++) {
        const item = family?.generate(`entry-mount-${name}-${i}`)
        const r = render(ENTRY_RENDERERS[name], { spec: item?.spec, onrespond: () => {}, timing: fakeDisplay() })
        cleanup.push(r.destroy)
        expect(r.container.querySelector('.hb-render'), name).not.toBeNull()
        r.destroy()
      }
    }
  })
})
