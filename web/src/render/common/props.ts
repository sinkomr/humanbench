/**
 * The renderer contract of the entry and block renderers (ROADMAP M1.13, A18; DESIGN §4.2, §10,
 * §11.6, §13). A renderer is a Svelte 5 component that takes an item's `spec` (the render payload,
 * never the key, `family.ts`) and reports the taker's answer through `onrespond`, typed as exactly
 * the response the family's `score()` accepts (contract v2), so the session can score it as is:
 *
 * - item renderers (series, quant): one typed entry, `onrespond(text)` once per submit;
 * - block renderers (span, Corsi, RT, coding, reading): they drive the family's block protocol
 *   and call `onrespond(response)` once, with the whole block's response, when the block ends.
 *
 * Nothing a renderer puts in the DOM (text, attributes, classes, ids, option order) may depend on
 * the key; `entry-leak.dom.test.ts` renders many generated instances per family and checks it.
 */

import type { PasteEvent } from '../../engine/integrity'
import { browserFrameSource, performanceClock, type Clock, type FrameSource } from '../../tasks/rt/timing'

export type { Clock, FrameSource }

/**
 * Where a renderer reads time (§11.6): rAF frames for onsets and `performance.now()` for
 * responses. Injectable so tests run on a fake clock; the default is the browser's.
 */
export interface RendererTiming {
  readonly frames: FrameSource
  readonly clock: Clock
}

/** The browser's rAF and `performance.now()`. */
export function browserTiming(): RendererTiming {
  return { frames: browserFrameSource(), clock: performanceClock }
}

/** Props every renderer takes. `Resp` is the family's `score()` response type (A18). */
export interface RendererProps<Spec, Resp> {
  /** The item's render payload (`ItemInstance.spec`). Never the key. */
  readonly spec: Spec
  /** Called with the response `score()` takes: once per submit (items) or once at the end (blocks). */
  readonly onrespond: (response: Resp) => void
  /** rAF + clock; defaults to {@link browserTiming}. */
  readonly timing?: RendererTiming
}

/** Extra props of the typed-entry item renderers (series, quant). */
export interface EntryRendererProps<Spec, Resp> extends RendererProps<Spec, Resp> {
  /**
   * Called once with the timestamp of the first frame the item is drawn in (the §13 item window's
   * `onset_ms`, M1.19), on the `performance.now()` timeline.
   */
  readonly onshown?: (onsetMs: number) => void
  /** Each paste into the entry field (§13 anomaly heuristics; M1.19 `PasteEvent`). */
  readonly onpaste?: (event: PasteEvent) => void
  /** Blocks responding (e.g. while the session is paused); the same prop as the visual renderers'. */
  readonly disabled?: boolean
}
