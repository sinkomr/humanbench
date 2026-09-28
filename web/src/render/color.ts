/**
 * WCAG 2.x colour maths for the renderers' contrast tests and palettes (ROADMAP M1.13; DESIGN §13
 * WCAG 2.2 AA: 1.4.3 text contrast, 1.4.11 non-text contrast ≥ 3:1).
 */

/** WCAG relative luminance of an sRGB hex colour `#rrggbb`. */
export function luminance(hex: string): number {
  const m = /^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(hex)
  if (!m) throw new RangeError(`not a #rrggbb colour: ${hex}`)
  const lin = (h: string): number => {
    const c = parseInt(h, 16) / 255
    return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4
  }
  return 0.2126 * lin(m[1] as string) + 0.7152 * lin(m[2] as string) + 0.0722 * lin(m[3] as string)
}

/** WCAG contrast ratio of two colours (1–21). */
export function contrast(a: string, b: string): number {
  const la = luminance(a)
  const lb = luminance(b)
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05)
}
