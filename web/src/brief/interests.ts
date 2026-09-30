/**
 * Interests: hobbies or subjects the person likes, used only to pick examples (I1, proposal §4.2).
 * They are typed, never stored (R-17.12), and read back from finished notes by the same rules, so
 * `parse(render(p)) = p` holds for them too.
 *
 * Written as `cooking`, `cooking or football`, `cooking, football or chess` (at most three).
 */

export const MAX_INTERESTS = 3
/** One interest: lower-case letters, spaces, hyphens and apostrophes, 2-24 characters, no "or" / "and". */
export const INTEREST_RE = /^[a-z][a-z' -]{1,23}$/u

/** Whether `s` is a well-formed single interest (before the lint, which `sanitize.ts` also applies). */
export function isInterest(s: string): boolean {
  return INTEREST_RE.test(s) && !/(?:^|[ -])(?:or|and)(?:$|[ -])/u.test(s) && s === s.trim() && !s.includes('  ')
}

export function joinInterests(items: readonly string[]): string {
  if (items.length <= 1) return items.join('')
  return `${items.slice(0, -1).join(', ')} or ${items[items.length - 1]}`
}

/** The interests in a written list, or null when it is not one (wrong shape, too many, repeats). */
export function parseInterestList(text: string): string[] | null {
  const orAt = text.lastIndexOf(' or ')
  const parts = orAt < 0 ? text.split(', ') : [...text.slice(0, orAt).split(', '), text.slice(orAt + 4)]
  if (parts.length < 1 || parts.length > MAX_INTERESTS) return null
  if (orAt < 0 && parts.length > 1) return null
  if (!parts.every(isInterest)) return null
  if (new Set(parts).size !== parts.length) return null
  return joinInterests(parts) === text ? parts : null
}
