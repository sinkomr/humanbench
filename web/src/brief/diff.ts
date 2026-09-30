/**
 * The out-of-date diff (AI.6; proposal §3.2 "which lines are ... out of date", §3.6 item 7): notes
 * written under an older release are compared line by line with the same lines in the current
 * wording, so the person sees exactly which lines would change before they copy again.
 *
 * `diffLines` is a plain longest-common-subsequence diff over lines: it never reorders, so the
 * old text is the `same`, `removed` and `changed.from` lines in order, and the new text is the
 * `same`, `added` and `changed.to` lines in order (`diff.test.ts` checks both on random input). A
 * `changed` op is a removed line and an added line from the same gap that belong together: they
 * read as the same template line, or are alike enough (`similarity`) to be an edit of one another.
 * Pure: no clock, no network.
 */

import { matchLine } from './match'
import type { Form } from './types'

export type DiffOp =
  | { readonly kind: 'same'; readonly old: number; readonly new: number; readonly text: string }
  | { readonly kind: 'removed'; readonly old: number; readonly text: string }
  | { readonly kind: 'added'; readonly new: number; readonly text: string }
  | { readonly kind: 'changed'; readonly old: number; readonly new: number; readonly from: string; readonly to: string }

/** Lines beyond this are not compared (the checker caps its input long before). */
export const MAX_DIFF_LINES = 600

/** Word-set overlap (Dice coefficient) of two lines, 0 to 1. */
export function similarity(a: string, b: string): number {
  const words = (s: string): Set<string> => new Set(s.toLowerCase().match(/[a-z]+/gu) ?? [])
  const x = words(a)
  const y = words(b)
  if (x.size === 0 || y.size === 0) return 0
  let both = 0
  for (const w of x) if (y.has(w)) both++
  return (2 * both) / (x.size + y.size)
}

/** Lines at least this alike, in one gap between unchanged lines, are shown as one changed line. */
export const CHANGED_MIN_SIMILARITY = 0.5

interface Gap {
  removed: { i: number; text: string }[]
  added: { j: number; text: string }[]
}

/** The template a line reads as (any form), or null. Used to pair a removed and an added line. */
function templateId(text: string, form: Form): string | null {
  const bullet = /^- (.+)$/u.exec(text)
  const m = matchLine(bullet ? (bullet[1] as string) : text, form)
  return m ? m.line.id : null
}

/**
 * Line diff of `a` (old) against `b` (new). Line numbers in the result are 1-based positions in
 * `a` (`old`) and `b` (`new`). `form` only helps to recognise which lines are the same template.
 */
export function diffLines(a: readonly string[], b: readonly string[], form: Form = 'long'): DiffOp[] {
  const n = Math.min(a.length, MAX_DIFF_LINES)
  const m = Math.min(b.length, MAX_DIFF_LINES)
  // lcs[i][j] = length of the longest common subsequence of a[i..] and b[j..].
  const lcs: Uint16Array[] = Array.from({ length: n + 1 }, () => new Uint16Array(m + 1))
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      lcs[i]![j] = a[i] === b[j] ? lcs[i + 1]![j + 1]! + 1 : Math.max(lcs[i + 1]![j]!, lcs[i]![j + 1]!)
    }
  }
  const ops: DiffOp[] = []
  let gap: Gap = { removed: [], added: [] }
  const flush = (): void => {
    ops.push(...pairGap(gap, form))
    gap = { removed: [], added: [] }
  }
  let i = 0
  let j = 0
  while (i < n && j < m) {
    if (a[i] === b[j]) {
      flush()
      ops.push({ kind: 'same', old: i + 1, new: j + 1, text: a[i] as string })
      i++
      j++
    } else if (lcs[i + 1]![j]! >= lcs[i]![j + 1]!) {
      gap.removed.push({ i: i + 1, text: a[i] as string })
      i++
    } else {
      gap.added.push({ j: j + 1, text: b[j] as string })
      j++
    }
  }
  for (; i < n; i++) gap.removed.push({ i: i + 1, text: a[i] as string })
  for (; j < m; j++) gap.added.push({ j: j + 1, text: b[j] as string })
  flush()
  return ops
}

/** Pair removed and added lines of one gap in order; unpaired ones stay removed or added. */
function pairGap(gap: Gap, form: Form): DiffOp[] {
  const { removed, added } = gap
  const ops: DiffOp[] = []
  const used = new Set<number>()
  let from = 0 // an added line may pair only with one after the previous pair, so order is kept
  const pairs = new Map<number, number>() // removed index -> added index
  removed.forEach((r, ri) => {
    const rid = templateId(r.text, form)
    for (let ai = from; ai < added.length; ai++) {
      if (used.has(ai)) continue
      const a = added[ai] as { j: number; text: string }
      const aid = templateId(a.text, form)
      const related = (rid !== null && rid === aid) || similarity(r.text, a.text) >= CHANGED_MIN_SIMILARITY
      if (!related) continue
      used.add(ai)
      pairs.set(ri, ai)
      from = ai + 1
      return
    }
  })
  // Emit in an order that keeps both sides in sequence: removed lines up to a pair, the added lines
  // before its partner, then the pair.
  let nextAdded = 0
  removed.forEach((r, ri) => {
    const ai = pairs.get(ri)
    if (ai === undefined) {
      ops.push({ kind: 'removed', old: r.i, text: r.text })
      return
    }
    for (; nextAdded < ai; nextAdded++) {
      if (!used.has(nextAdded)) ops.push({ kind: 'added', new: (added[nextAdded] as { j: number }).j, text: (added[nextAdded] as { text: string }).text })
    }
    const a = added[ai] as { j: number; text: string }
    ops.push({ kind: 'changed', old: r.i, new: a.j, from: r.text, to: a.text })
    nextAdded = ai + 1
  })
  for (; nextAdded < added.length; nextAdded++) {
    if (!used.has(nextAdded)) ops.push({ kind: 'added', new: (added[nextAdded] as { j: number }).j, text: (added[nextAdded] as { text: string }).text })
  }
  return ops
}

/** Diff of two texts, line by line (`\n` separates lines; a final empty line is ignored). */
export function diffText(oldText: string, newText: string, form: Form = 'long'): DiffOp[] {
  const lines = (s: string): string[] => {
    const l = s.replace(/\r\n?/gu, '\n').split('\n')
    if (l.at(-1) === '') l.pop()
    return l
  }
  return diffLines(lines(oldText), lines(newText), form)
}

/** How many lines differ: everything that is not `same`. */
export const changedCount = (ops: readonly DiffOp[]): number => ops.filter((o) => o.kind !== 'same').length
