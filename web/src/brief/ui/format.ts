/**
 * Small pieces of page wording that depend on a count (UX-052): a list read aloud the way a person
 * would say it, and a "line" or "lines" label. Pure, so the Checker and its tests share them.
 */

/** `14`, `14 and 15`, `14, 15 and 16`: items joined the way they are said. */
export function sayList(items: readonly (string | number)[]): string {
  if (items.length <= 1) return items.map(String).join('')
  return `${items.slice(0, -1).join(', ')} and ${String(items[items.length - 1])}`
}

/** `line 14`, `lines 14 and 15`: which lines of the pasted notes a warning is about. */
export function lineRef(lines: readonly number[]): string {
  return `${lines.length === 1 ? 'line' : 'lines'} ${sayList(lines)}`
}
