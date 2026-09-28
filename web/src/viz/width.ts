/**
 * The rendered width of a chart box, for the blob's text layout (ROADMAP M1.16; `blob.ts`
 * fitLayout). Replaces `bind:clientWidth`, whose ResizeObserver callback re-lays the chart out
 * synchronously: the new viewBox changes the box's height inside the same observer pass, and
 * WebKit / iOS then raise "ResizeObserver loop completed with undelivered notifications" on every
 * narrowing resize or rotation (post-merge audit). Here the observer only schedules a read, and
 * the width reaches the layout on the next animation frame, outside the observer's delivery; a
 * box whose width did not change (a height-only resize) reports nothing.
 */

import type { Attachment } from 'svelte/attachments'

/** The animation-frame calls this needs (injectable for tests). */
export interface FrameScheduler {
  request(cb: () => void): number
  cancel(handle: number): void
}

const browserFrames: FrameScheduler = {
  request: (cb) => requestAnimationFrame(() => cb()),
  cancel: (h) => cancelAnimationFrame(h),
}

/**
 * Report `node.clientWidth` to `onwidth` on the animation frame after each resize (at most once
 * per frame, and only when it changed). Returns the cleanup. Without a ResizeObserver (jsdom)
 * nothing is reported, so the caller keeps its default layout.
 */
export function observeWidth(node: HTMLElement, onwidth: (width: number) => void, frames: FrameScheduler = browserFrames): () => void {
  if (typeof ResizeObserver === 'undefined') return () => {}
  let handle: number | null = null
  let last: number | null = null
  const push = (): void => {
    handle = null
    const w = node.clientWidth
    if (w === last) return
    last = w
    onwidth(w)
  }
  const ro = new ResizeObserver(() => {
    if (handle === null) handle = frames.request(push)
  })
  ro.observe(node)
  return () => {
    ro.disconnect()
    if (handle !== null) frames.cancel(handle)
    handle = null
  }
}

/** {@link observeWidth} as a Svelte attachment: `<div {@attach widthOf((w) => (width = w))}>`. */
export function widthOf(onwidth: (width: number) => void, frames?: FrameScheduler): Attachment<HTMLElement> {
  return (node) => observeWidth(node, onwidth, frames)
}
