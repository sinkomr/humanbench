/**
 * The visual item renderers by family name (ROADMAP M1.13, A3, A18; DESIGN §4.2, §12): the
 * Three.js polycube renderer for `rotation` and the SVG cell renderer for `matrices`. The entry,
 * span, RT, coding and reading renderers are registered in `entry.ts`; the session (M1.15) and
 * the dev gallery look a family up in both maps.
 *
 * Every renderer takes {@link ItemRendererProps}: the item's `spec` and NEVER the item or its key,
 * and it calls `onrespond` with a value of exactly the type the family's `score()` accepts
 * (`visual.dom.test.ts` checks this at the type level and at run time). MC options are shown in
 * `spec.options` order, and the response is the display position (A18, `mcResponseIndex`).
 *
 * Importing this map does not load Three.js: the rotation renderer imports `three` lazily from
 * `rotation/three-view.ts` (the bundle test checks it lands in its own chunk).
 */

import type { Component } from 'svelte'
import type { FAMILY_NAMES } from '../tasks/registry'
import MatrixRenderer from './matrices/MatrixRenderer.svelte'
import RotationRenderer from './rotation/RotationRenderer.svelte'

/** A registered family name (`tasks/registry.ts`). */
export type FamilyName = (typeof FAMILY_NAMES)[number]

/** Props of every item renderer (the contract the session relies on). */
export interface ItemRendererProps<Spec, Response> {
  /** The item's render payload. Never the key, the item, its params or its difficulty. */
  spec: Spec
  /** Called once with the response, of the type the family's `score()` takes. */
  onrespond: (response: Response) => void
  /**
   * Timestamp (ms, performance.now() clock) of the first animation frame showing the stimulus
   * (§11.6): the rAF callback timestamp of the frame in which it is first on screen. Called once
   * per spec, and never before the stimulus is shown; the renderer accepts no response before.
   */
  onshown?: (onsetMs: number) => void
  /**
   * The stimulus cannot be shown in this browser (e.g. no WebGL for rotation), so the item cannot
   * be answered: called once per spec instead of `onshown`, with the options locked; the session
   * offers skipping (§13 "skip any axis", M1.15). Renderers that always draw never call it.
   */
  onunavailable?: () => void
  /** Blocks responding (e.g. while the session is paused). */
  disabled?: boolean
}

/** The typed renderers of this chain. */
export const visualRenderers = Object.freeze({
  rotation: RotationRenderer,
  matrices: MatrixRenderer,
})

/**
 * The same renderers as a partial map over family names, for lookups by `item.family`. The
 * components have different spec and response types, hence `Component<any>`; their pairing with
 * `family.score()` is checked in `visual.dom.test.ts`.
 */
export const VISUAL_RENDERERS: Readonly<Partial<Record<FamilyName, Component<any>>>> = visualRenderers
