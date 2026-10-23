/**
 * The renderers of the scope-variety families (DESIGN §3 rows 1, 2, 6, 7; ROADMAP M3.13): paper folding, 2D figures
 * (turning and mirror images) and cube nets on Spatial, tables, charts and everyday word problems on Quantitative.
 *
 * Statically imported ONLY by the dev pages (the visual gallery, the G7 review page) and the tests: the session gets
 * them as lazy chunks of their own (`session/served-renderers.ts`, the same names), so neither the entry chunk nor the
 * session runtime carries them (`scripts/results-split.test.ts`). Each takes `ItemRendererProps` (`visual.ts`) or, for
 * typed entry, the entry renderer props (`common/props.ts`), and only the item's `spec`.
 */

import type { Component } from 'svelte'
import CubenetRenderer from './cubenet/CubenetRenderer.svelte'
import Figure2dRenderer from './figure2d/Figure2dRenderer.svelte'
import FoldingRenderer from './folding/FoldingRenderer.svelte'
import QdataRenderer from './qdata/QdataRenderer.svelte'
import SyllogismRenderer from './syllogism/SyllogismRenderer.svelte'

/** The variety renderers by family name. */
export const VARIETY_RENDERERS: Readonly<Record<string, Component<any>>> = Object.freeze({
  cubenet: CubenetRenderer,
  figure2d: Figure2dRenderer,
  folding: FoldingRenderer,
  qdata: QdataRenderer,
  syllogism: SyllogismRenderer,
})
