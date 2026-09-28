/**
 * Helpers for the renderers' jsdom tests (ROADMAP M1.13): mount a renderer with Svelte's `mount`
 * API, drive it with keys and clicks, and serialise its DOM. Test-only (imported by `*.dom.test.ts`).
 */

import { flushSync, mount, unmount, type Component } from 'svelte'

export interface Mounted {
  readonly target: HTMLElement
  destroy(): void
}

/** Mount `component` with `props` into a fresh element appended to the document body. */
export function mountInto<Props extends Record<string, any>>(component: Component<Props>, props: Props): Mounted {
  const target = document.createElement('div')
  document.body.appendChild(target)
  const instance = mount(component, { target, props })
  flushSync()
  return {
    target,
    destroy() {
      unmount(instance)
      target.remove()
    },
  }
}

/** Resolves on the next animation frame (jsdom runs rAF on a ~16 ms timer). */
export function nextFrame(): Promise<number> {
  return new Promise((resolve) => requestAnimationFrame(resolve))
}

/** The option radios of a rendered item, in DOM order. */
export function optionInputs(root: ParentNode): HTMLInputElement[] {
  return [...root.querySelectorAll<HTMLInputElement>('input[type="radio"]')]
}

/** Dispatch a keydown (bubbling, cancelable) on `el` and flush Svelte's updates. */
export function press(el: Element, key: string): KeyboardEvent {
  const e = new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true })
  el.dispatchEvent(e)
  flushSync()
  return e
}

/** Click `el` and flush Svelte's updates. */
export function click(el: HTMLElement): void {
  el.click()
  flushSync()
}

/** innerHTML with the per-instance radio group name (`$props.id()`) replaced, for snapshots. */
export function stableHtml(root: Element): string {
  return root.innerHTML.replace(/name="[^"]*"/g, 'name="(group)"')
}
