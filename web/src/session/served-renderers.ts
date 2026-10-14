/**
 * The renderers of the remaining families, loaded when a session needs them (ROADMAP M3.11; UX-100): a Fermi
 * estimate, a word-links puzzle, an emotion vignette and a situational judgment are drawn by components that are not in
 * the entry chunk (`scripts/results-split.test.ts` holds the entry under its bound), so a person who never meets one
 * never downloads it. A session whose plan has one of their parts asks for all four when it starts
 * ({@link preloadServedRenderers}), long before its first such question; `Stage.svelte` shows a short wait if one is
 * still on its way, and lets the session offer the skip of §13 if it cannot be fetched (`onunavailable`).
 *
 * The names are the bank's renderer names (`backend/items.ts` SERVED_RENDERERS); written out here so that this module
 * pulls nothing of the task families into the entry chunk.
 */

import type { Component } from 'svelte'

/** A renderer, and what it checks of a spec before it draws it (the Fermi units table travels with the renderer). */
export interface LazyRenderer {
  readonly component: Component<any>
  readonly fits: (spec: object) => boolean
}

type Loader = () => Promise<LazyRenderer>

const LOADERS: Readonly<Record<string, Loader>> = Object.freeze({
  fermi_v1: async () => {
    const [c, spec] = await Promise.all([import('../render/fermi/FermiRenderer.svelte'), import('../tasks/fermi/spec')])
    return { component: c.default, fits: (s: object) => spec.specProblems(s as never).length === 0 }
  },
  rat_triad_v1: async () => {
    const [c, spec] = await Promise.all([import('../render/rat/RatRenderer.svelte'), import('../tasks/rat/spec')])
    return { component: c.default, fits: (s: object) => spec.specProblems(s as never).length === 0 }
  },
  emotion_vignette_v1: async () => {
    const [c, spec] = await Promise.all([import('../render/emotion/EmotionRenderer.svelte'), import('../tasks/emotion/spec')])
    return { component: c.default, fits: (s: object) => spec.specProblems(s as never).length === 0 }
  },
  sjt_rating_v1: async () => {
    const [c, spec] = await Promise.all([import('../render/sjt/SjtRenderer.svelte'), import('../tasks/sjt/spec')])
    return { component: c.default, fits: (s: object) => spec.specProblems(s as never).length === 0 }
  },
})

const loaded = new Map<string, LazyRenderer>()
const pending = new Map<string, Promise<LazyRenderer>>()

/** Whether `family` is drawn by a renderer of this module. */
export function isLazyRenderer(family: string): boolean {
  return Object.hasOwn(LOADERS, family)
}

/** The renderer of `family` if it has arrived, else undefined. */
export function loadedRenderer(family: string): LazyRenderer | undefined {
  return loaded.get(family)
}

/** Fetches the renderer of `family` once (a failed fetch is tried again by the next call). */
export function loadRenderer(family: string): Promise<LazyRenderer> {
  const have = loaded.get(family)
  if (have !== undefined) return Promise.resolve(have)
  const loader = LOADERS[family]
  if (loader === undefined) return Promise.reject(new RangeError(`no served renderer ${family}`))
  let p = pending.get(family)
  if (p === undefined) {
    p = loader().then(
      (r) => {
        loaded.set(family, r)
        pending.delete(family)
        return r
      },
      (e: unknown) => {
        pending.delete(family)
        throw e
      },
    )
    pending.set(family, p)
  }
  return p
}

/** Starts fetching every renderer of this module (a session with one of their parts calls it when it starts). Never rejects. */
export function preloadServedRenderers(): void {
  for (const family of Object.keys(LOADERS)) void loadRenderer(family).catch(() => undefined)
}
