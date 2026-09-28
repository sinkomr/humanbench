/**
 * The entry and block renderers by family name (ROADMAP M1.13 part B, A18; DESIGN §4.2, §10, §13):
 * typed entry for series and quant, the span boards (digits forward / backward, Corsi), the RT
 * stimuli (simple, 4-choice), coding and reading. `visual.ts` maps the image renderers (rotation,
 * matrices) the same way.
 *
 * Every renderer follows `common/props.ts`: it takes `spec` (never the key) and calls
 * `onrespond(response)` with exactly the response type of its family's `score()` (checked at
 * compile time and by `entry.dom.test.ts` at run time), shows options in `spec.options` / spec
 * order, and puts nothing key-dependent in the DOM (`entry-leak.dom.test.ts`).
 */

import type { Component } from 'svelte'
import type { FAMILY_NAMES } from '../tasks/registry'
import CodingRenderer from './coding/CodingRenderer.svelte'
import QuantRenderer from './quant/QuantRenderer.svelte'
import ReadingRenderer from './reading/ReadingRenderer.svelte'
import RtRenderer from './rt/RtRenderer.svelte'
import SeriesRenderer from './series/SeriesRenderer.svelte'
import CorsiRenderer from './span/CorsiRenderer.svelte'
import DigitSpanRenderer from './span/DigitSpanRenderer.svelte'

/** A registered family name. */
export type FamilyName = (typeof FAMILY_NAMES)[number]

/**
 * A renderer of some family. The props differ per family (their spec and response types), so the
 * map's value type is erased; each entry is typed against its family in `entry.dom.test.ts`.
 */
export type AnyRenderer = Component<any>

/** The entry and block renderers (M1.13 part B), by family name. */
export const ENTRY_RENDERERS = Object.freeze({
  series: SeriesRenderer,
  quant: QuantRenderer,
  span_fwd: DigitSpanRenderer,
  span_bwd: DigitSpanRenderer,
  corsi: CorsiRenderer,
  rt_simple: RtRenderer,
  rt_choice4: RtRenderer,
  coding: CodingRenderer,
  reading: ReadingRenderer,
} satisfies Partial<Record<FamilyName, AnyRenderer>>)

/** Families with an entry or block renderer. */
export const ENTRY_RENDERER_FAMILIES = Object.freeze(Object.keys(ENTRY_RENDERERS) as (keyof typeof ENTRY_RENDERERS)[])

/** The entry or block renderer of `family`, or undefined. */
export function entryRenderer(family: string): AnyRenderer | undefined {
  return Object.hasOwn(ENTRY_RENDERERS, family) ? (ENTRY_RENDERERS as Readonly<Record<string, AnyRenderer>>)[family] : undefined
}
