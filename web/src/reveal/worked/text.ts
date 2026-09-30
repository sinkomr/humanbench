/** Small text helpers of the worked solutions (typographic minus, lists), shared by the three kinds. */

/** An integer with "−" (U+2212) for negatives, as the items render them. */
export const num = (x: number): string => (x < 0 ? `−${-x}` : `${x}`)

/** A term inside a sentence: negatives in parentheses, "(−6)". */
export const paren = (x: number): string => (x < 0 ? `(${num(x)})` : `${x}`)

/** "+3" or "−3". */
export const signedNum = (x: number): string => (x < 0 ? `−${-x}` : `+${x}`)

/** "a, b, c" or "a, b and c". */
export function list(items: readonly string[], joiner = 'and'): string {
  if (items.length <= 1) return items.join('')
  return `${items.slice(0, -1).join(', ')} ${joiner} ${items[items.length - 1] as string}`
}

/** "add 5", "subtract 5" (for a negative amount). */
export function addPhrase(x: number): string {
  return x < 0 ? `subtract ${-x}` : `add ${x}`
}

export const cap = (s: string): string => s.charAt(0).toUpperCase() + s.slice(1)
