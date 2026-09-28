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
 *
 * Relative to `visual.ts`'s `ItemRendererProps` (§11.6, §13): these renderers always draw (DOM text
 * and inline SVG), so none declares `onunavailable`. The typed-entry item renderers (series, quant)
 * report `onshown` once per mount and do not lock the entry until it fires, since a response needs
 * typing plus a submit in a field that did not exist before the mount, which cannot happen within
 * the single frame between mount and the frame that draws the item. The session must therefore
 * mount them afresh for each item (`{#key}`), as the review page does. The block renderers take
 * each trial's onset from their own rAF-locked phases.
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
