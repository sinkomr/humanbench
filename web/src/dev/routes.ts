/**
 * Dev-only routes, `#/dev/<name>[?query]` (ROADMAP M1.16: a dev-only demo route for e2e + axe).
 * Loaded only through the `__HB_DEV_ROUTES__` branch of `main.ts`, so a production build ships
 * none of this (`scripts/dev-routes.test.ts`). Hash routes, because GitHub Pages serves one page.
 */

import { mount, type Component } from 'svelte'

export interface DevRouteProps {
  /** The query part of the hash (`#/dev/blob?profile=full` → profile=full). */
  readonly params: URLSearchParams
}

/** Route name → lazy page module. */
export const DEV_ROUTES: Readonly<Record<string, () => Promise<{ default: Component<DevRouteProps> }>>> = Object.freeze({
  blob: () => import('./BlobDemo.svelte'),
  'reveal-ai': () => import('./RevealAiDemo.svelte'),
  fermi: () => import('./FermiDemo.svelte'),
})

/** `#/dev/blob?profile=full` → { name: 'blob', params }, or null for any other hash. */
export function parseDevHash(hash: string): { name: string; params: URLSearchParams } | null {
  const m = /^#\/dev\/([a-z0-9-]+)(?:\?(.*))?$/.exec(hash)
  if (!m) return null
  return { name: m[1]!, params: new URLSearchParams(m[2] ?? '') }
}

/** Mount the dev route named by `hash` into `target`; false when there is no such route. */
export async function mountDevRoute(target: HTMLElement, hash: string): Promise<boolean> {
  const route = parseDevHash(hash)
  const load = route && Object.hasOwn(DEV_ROUTES, route.name) ? DEV_ROUTES[route.name] : undefined
  if (!route || !load) return false
  const { default: Page } = await load()
  mount(Page, { target, props: { params: route.params } })
  return true
}
