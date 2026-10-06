import { describe, expect, it } from 'vitest'
import { blend, contrastRatio, MARK_TOKENS, MIN_BAND_CONTRAST, MIN_MARK_CONTRAST, MIN_TEXT_CONTRAST, MUTED_GREY, OKABE_ITO, relativeLuminance, TEXT_TOKENS, themeVars, THEMES } from './palette'

describe('WCAG contrast maths', () => {
  it('matches known values', () => {
    expect(relativeLuminance('#ffffff')).toBeCloseTo(1, 12)
    expect(relativeLuminance('#000000')).toBe(0)
    expect(contrastRatio('#000000', '#ffffff')).toBeCloseTo(21, 10)
    expect(contrastRatio('#ffffff', '#ffffff')).toBe(1)
    // #767676 is the classic lightest grey that passes 4.5:1 on white.
    expect(contrastRatio('#767676', '#ffffff')).toBeGreaterThan(4.5)
    expect(contrastRatio('#777777', '#ffffff')).toBeLessThan(4.5)
    // §9.8's blob blue on white.
    expect(contrastRatio(OKABE_ITO.blue, '#ffffff')).toBeCloseTo(5.17, 1)
  })

  it('is symmetric and rejects malformed colours', () => {
    expect(contrastRatio('#0072B2', '#15151a')).toBe(contrastRatio('#15151a', '#0072B2'))
    expect(() => relativeLuminance('red')).toThrow(RangeError)
    expect(() => relativeLuminance('#fff')).toThrow(RangeError)
  })
})

describe('blend', () => {
  it('lays a colour over another at an opacity', () => {
    expect(blend('#000000', '#ffffff', 0)).toBe('#ffffff')
    expect(blend('#000000', '#ffffff', 1)).toBe('#000000')
    expect(blend('#ff0000', '#0000ff', 0.5)).toBe('#800080')
  })
})

describe('blob palette (§9.8, §13)', () => {
  for (const [name, theme] of Object.entries(THEMES)) {
    it(`${name}: every text token has ≥ 4.5:1 contrast on the background (§9.8)`, () => {
      for (const t of TEXT_TOKENS) expect(contrastRatio(theme[t], theme.bg), t).toBeGreaterThanOrEqual(MIN_TEXT_CONTRAST)
    })

    it(`${name}: meaningful marks have ≥ 3:1 non-text contrast (WCAG 1.4.11)`, () => {
      for (const t of MARK_TOKENS) expect(contrastRatio(theme[t], theme.bg), t).toBeGreaterThanOrEqual(MIN_MARK_CONTRAST)
    })

    it(`${name}: the band's outline shows against the page (≥ 1.5:1), while its hue stays the Okabe–Ito band colour (UX-047, §9.8)`, () => {
      const edge = blend(theme.band, theme.bg, theme.bandEdgeOpacity)
      expect(contrastRatio(edge, theme.bg)).toBeGreaterThanOrEqual(MIN_BAND_CONTRAST)
      // The translucent fill alone is far weaker: that is why the edge is drawn.
      expect(contrastRatio(blend(theme.band, theme.bg, 0.12), theme.bg)).toBeLessThan(MIN_BAND_CONTRAST)
      expect(theme.bandEdgeOpacity).toBeGreaterThan(0)
      expect(theme.bandEdgeOpacity).toBeLessThanOrEqual(1)
    })

    it(`${name}: blob, band and hatch are Okabe–Ito colours (§9.8)`, () => {
      const oi = Object.values(OKABE_ITO)
      for (const t of ['blob', 'band', 'hatch', 'textAccent'] as const) expect(oi, t).toContain(theme[t])
      expect(theme.hatch).toBe(OKABE_ITO.orange)
    })
  }

  it('keeps the §9.8 roles in light mode: blob #0072B2, band #56B4E9, hatch #E69F00', () => {
    expect(THEMES.light).toMatchObject({ blob: '#0072B2', band: '#56B4E9', hatch: '#E69F00' })
    // §9.8 muted grey: kept in dark mode; light mode darkens it for 3:1 (documented deviation).
    expect(THEMES.dark.muted).toBe(MUTED_GREY)
    expect(contrastRatio(MUTED_GREY, THEMES.light.bg)).toBeLessThan(MIN_MARK_CONTRAST)
  })

  it('swaps the two blue roles in dark mode (documented): #0072B2 is below 4.5:1 there', () => {
    expect(THEMES.dark).toMatchObject({ blob: OKABE_ITO.skyBlue, band: OKABE_ITO.blue, textAccent: OKABE_ITO.skyBlue })
    expect(contrastRatio(OKABE_ITO.blue, THEMES.dark.bg)).toBeLessThan(MIN_TEXT_CONTRAST)
    expect(contrastRatio(OKABE_ITO.blue, THEMES.dark.bg)).toBeGreaterThanOrEqual(MIN_MARK_CONTRAST)
    expect(THEMES.dark.textAccent).toBe(THEMES.dark.blob)
  })

  it('exposes every token as a --hb-* custom property', () => {
    const vars = themeVars(THEMES.light)
    expect(vars['--hb-blob']).toBe('#0072B2')
    expect(vars['--hb-text-muted']).toBe(THEMES.light.textMuted)
    expect(vars['--hb-band-edge-opacity']).toBe(String(THEMES.light.bandEdgeOpacity))
    expect(Object.keys(vars)).toHaveLength(Object.keys(THEMES.light).length)
  })
})
