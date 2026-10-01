/**
 * Motion in the stylesheets and whether `prefers-reduced-motion` stops it (ROADMAP M1.21; WCAG 2.2.2,
 * 2.3.3), for `a11y-static.test.ts`. Rule by rule: an animation, a transition or a smooth scroll that
 * is not wrapped in `@media (prefers-reduced-motion: no-preference)` must be switched off for `reduce`
 * for the same selector (or for `*`), so a rule added later cannot hide behind the reset of another.
 */

import type { Block } from './css-tokens'

export type MotionKind = 'animation' | 'transition' | 'scroll'

export interface Motion {
  readonly kind: MotionKind
  /** The rule's selectors, whitespace collapsed (a selector list is split). */
  readonly selectors: readonly string[]
  readonly text: string
}

const REDUCE = /prefers-reduced-motion:\s*reduce/
const NO_PREFERENCE = /prefers-reduced-motion:\s*no-preference/

const selectorsOf = (prelude: string): string[] => prelude.split(',').map((s) => s.trim().replace(/\s+/g, ' '))

/** Motion declarations outside `@media (prefers-reduced-motion: no-preference)` and outside `reduce` blocks. */
export function unprotectedMotion(blocks: readonly Block[], protectedBy = false): Motion[] {
  const out: Motion[] = []
  for (const b of blocks) {
    const here = protectedBy || NO_PREFERENCE.test(b.prelude)
    const reducing = REDUCE.test(b.prelude)
    if (!here && !reducing) {
      for (const [prop, value] of b.decls) {
        let kind: MotionKind | null = null
        if (/^(animation|animation-name)$/.test(prop) && !/^none\b/.test(value)) kind = 'animation'
        else if (/^(transition|transition-property)$/.test(prop) && !/^(none|0s)\b/.test(value)) kind = 'transition'
        else if (prop === 'scroll-behavior' && /smooth/.test(value)) kind = 'scroll'
        if (kind !== null) out.push({ kind, selectors: selectorsOf(b.prelude), text: `${b.prelude} { ${prop}: ${value} }` })
      }
    }
    if (!reducing) out.push(...unprotectedMotion(b.children, here))
  }
  return out
}

/** The selectors whose motion of each kind a file's `prefers-reduced-motion: reduce` blocks switch off. */
export function switchedOff(blocks: readonly Block[]): Record<MotionKind, Set<string>> {
  const off: Record<MotionKind, Set<string>> = { animation: new Set(), transition: new Set(), scroll: new Set() }
  const visit = (bs: readonly Block[], inReduce: boolean): void => {
    for (const b of bs) {
      const reduce = inReduce || REDUCE.test(b.prelude)
      if (reduce && !b.prelude.startsWith('@')) {
        for (const [prop, value] of b.decls) {
          const kind: MotionKind | null =
            /^animation(-name)?$/.test(prop) && /^none\b/.test(value)
              ? 'animation'
              : /^transition(-property)?$/.test(prop) && /^(none|0s)\b/.test(value)
                ? 'transition'
                : prop === 'scroll-behavior' && /^auto\b/.test(value)
                  ? 'scroll'
                  : null
          if (kind !== null) for (const s of selectorsOf(b.prelude)) off[kind].add(s)
        }
      }
      visit(b.children, reduce)
    }
  }
  visit(blocks, false)
  return off
}

/** Whether any reduce rule switches off some motion of this kind. */
export const switchesOffAny = (blocks: readonly Block[], kind: MotionKind): boolean => switchedOff(blocks)[kind].size > 0

/** The motion no `reduce` rule stops: its own selector (or `*`) must be switched off for its kind. */
export function uncoveredMotion(blocks: readonly Block[]): Motion[] {
  const off = switchedOff(blocks)
  return unprotectedMotion(blocks).filter((m) => !m.selectors.every((s) => off[m.kind].has(s) || off[m.kind].has('*')))
}
