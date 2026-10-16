/**
 * Display parts of a quant stem (ROADMAP M1.8, M1.13): the templates write powers as `3^5`,
 * `x^2`, `9^(3/2)` or `5^(2x)` (`tasks/quant/templates.ts`); the renderer shows each exponent as a
 * superscript (brackets dropped, the superscript groups it) with a spoken "to the power" for
 * screen readers. Everything else is the stem text unchanged.
 */

export type StemPart = { readonly text: string } | { readonly sup: string; readonly inner?: readonly StemPart[] }

const POWER_RE = /\^(?:\(([^()]+)\)|([0-9A-Za-z]+))/g

/**
 * The parts of `stem`. An exponent that is itself a power (`3^(4^5)`, a tower of powers, quant
 * 1.4.0 `tower_mod`) keeps its text in `sup` and its own parts in `inner`, so the renderer nests the
 * superscripts (and says "to the power" twice) instead of showing a caret.
 */
export function stemParts(stem: string): StemPart[] {
  const out: StemPart[] = []
  let last = 0
  for (const m of stem.matchAll(POWER_RE)) {
    const at = m.index ?? 0
    if (at > last) out.push({ text: stem.slice(last, at) })
    const sup = m[1] ?? m[2] ?? ''
    out.push(sup.includes('^') ? { sup, inner: stemParts(sup) } : { sup })
    last = at + m[0].length
  }
  if (last < stem.length) out.push({ text: stem.slice(last) })
  return out
}
