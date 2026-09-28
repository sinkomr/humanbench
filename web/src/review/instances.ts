/**
 * The instances of the G7 review page (DESIGN §4.4; ROADMAP M1.G7, M1.13): for every registered
 * family, instances 1 … 30 from the seeds `review-<family>-<i>`, each with what the reviewer checks
 * (key, verify() checks, difficulty features, b prior, stratum, sibling group), and the renderer
 * that shows it: the entry/block map (`render/entry.ts`) or the visual map (`render/visual.ts`,
 * loaded only if that module exists in this build), else none (the page shows the spec as JSON).
 */

import type { Component } from 'svelte'
import { ENTRY_RENDERERS } from '../render/entry'
import type { AnyFamily, ItemInstance, VerifyResult } from '../tasks/family'
import { FAMILY_NAMES, getFamily } from '../tasks/registry'
import { REVIEW_PER_FAMILY, reviewSeed, type PlannedFamily } from './verdicts'

/** A renderer component; props per family (see `render/common/props.ts`). */
// Each renderer has its own spec and response types, so the map's values are erased here.
export type AnyRenderer = Component<any>

/** One review instance: the generated item and its verifier result, or the error generating it. */
export type ReviewInstance =
  | { readonly index: number; readonly seed: string; readonly ok: true; readonly item: ItemInstance<object, object>; readonly verify: VerifyResult }
  | { readonly index: number; readonly seed: string; readonly ok: false; readonly error: string }

/** The registered families, in registry order. */
export function reviewFamilies(): AnyFamily[] {
  return FAMILY_NAMES.map((n) => getFamily(n)).filter((f): f is AnyFamily => f !== undefined)
}

/** Each family with its current generator version (what an export summarises). */
export function plannedFamilies(): PlannedFamily[] {
  return reviewFamilies().map((f) => ({ family: f.name, generator_version: f.generatorVersion }))
}

/** Instance `index` (1 … 30) of `family`: generated and verified; a throw is reported, not raised. */
export function reviewInstance(family: AnyFamily, index: number): ReviewInstance {
  const seed = reviewSeed(family.name, index)
  try {
    const item = family.generate(seed)
    let verify: VerifyResult
    try {
      verify = family.verify(item)
    } catch (e) {
      verify = { ok: false, reason: `verify() threw: ${e instanceof Error ? e.message : String(e)}`, checks: {} }
    }
    return { index, seed, ok: true, item, verify }
  } catch (e) {
    return { index, seed, ok: false, error: e instanceof Error ? `${e.name}: ${e.message}` : String(e) }
  }
}

/** All 30 review instances of `family`. */
export function reviewInstances(family: AnyFamily): ReviewInstance[] {
  return Array.from({ length: REVIEW_PER_FAMILY }, (_, i) => reviewInstance(family, i + 1))
}

/** A module that may export renderer maps (e.g. `render/visual.ts` of the visual chain). */
type RendererModule = Readonly<Record<string, unknown>>

const isComponentMap = (v: unknown): v is Readonly<Record<string, AnyRenderer>> =>
  typeof v === 'object' && v !== null && Object.values(v).length > 0 && Object.values(v).every((c) => typeof c === 'function')

/**
 * The renderer maps exported by `modules` (the preferred export `VISUAL_RENDERERS`, else any
 * export that maps family names to components), merged.
 */
export function rendererMapsOf(modules: readonly RendererModule[]): Record<string, AnyRenderer> {
  const out: Record<string, AnyRenderer> = {}
  const names = new Set<string>(FAMILY_NAMES)
  for (const mod of modules) {
    const preferred = mod.VISUAL_RENDERERS
    const candidates = isComponentMap(preferred) ? [preferred] : Object.values(mod).filter(isComponentMap)
    for (const map of candidates) {
      for (const [k, c] of Object.entries(map)) if (names.has(k) && out[k] === undefined) out[k] = c
    }
  }
  return out
}

// The visual renderers ship from a sibling chain; glob keeps this page building without them.
const VISUAL_MODULES = Object.values(import.meta.glob<RendererModule>('../render/visual.ts', { eager: true }))

/** Visual renderers found in this build, by family name. */
export const VISUAL_MAP: Readonly<Record<string, AnyRenderer>> = Object.freeze(rendererMapsOf(VISUAL_MODULES))

/** The renderer of a family and where it comes from, or null (the page shows a JSON view). */
export function rendererFor(family: string): { readonly component: AnyRenderer; readonly source: 'entry' | 'visual' } | null {
  if (Object.hasOwn(ENTRY_RENDERERS, family)) return { component: (ENTRY_RENDERERS as Readonly<Record<string, AnyRenderer>>)[family] as AnyRenderer, source: 'entry' }
  const v = VISUAL_MAP[family]
  return v === undefined ? null : { component: v, source: 'visual' }
}
