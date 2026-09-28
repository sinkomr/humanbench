import { describe, expect, it } from 'vitest'
import { cachedMeasure, canvasTextMeasure, MEASURE_HEADROOM, MEASURE_REF_PX } from './measure'

describe('text measure (M1.16 text layout)', () => {
  it('measures each text and style once at the reference size and scales it, with headroom', () => {
    const seen: string[] = []
    const m = cachedMeasure((t, italic) => {
      seen.push(`${t}${italic ? '/i' : ''}`)
      return t.length * MEASURE_REF_PX * (italic ? 0.6 : 0.5)
    })
    expect(m('abcd', MEASURE_REF_PX)).toBeCloseTo(2 * MEASURE_REF_PX * MEASURE_HEADROOM, 9)
    expect(m('abcd', 2 * MEASURE_REF_PX)).toBeCloseTo(4 * MEASURE_REF_PX * MEASURE_HEADROOM, 9)
    expect(m('abcd', 10, true)).toBeCloseTo(24 * MEASURE_HEADROOM, 9)
    expect(seen).toEqual(['abcd', 'abcd/i'])
  })

  it('uses the canvas at the reference size and style, and gives null without a canvas', () => {
    const orig = HTMLCanvasElement.prototype.getContext
    try {
      HTMLCanvasElement.prototype.getContext = (() => null) as typeof orig
      expect(canvasTextMeasure('sans-serif')).toBeNull()
      HTMLCanvasElement.prototype.getContext = (() => {
        throw new Error('no canvas')
      }) as typeof orig
      expect(canvasTextMeasure('sans-serif')).toBeNull()
      const fonts: string[] = []
      const fake = {
        set font(f: string) {
          fonts.push(f)
        },
        measureText: (t: string) => ({ width: t.length * 6 }),
      }
      HTMLCanvasElement.prototype.getContext = (() => fake) as unknown as typeof orig
      const m = canvasTextMeasure('Test Sans')!
      expect(m('abc', MEASURE_REF_PX)).toBeCloseTo(18 * MEASURE_HEADROOM, 9)
      expect(m('abc', 2 * MEASURE_REF_PX)).toBeCloseTo(36 * MEASURE_HEADROOM, 9)
      m('abc', 30, true)
      expect(fonts).toEqual([`${MEASURE_REF_PX}px Test Sans`, `italic ${MEASURE_REF_PX}px Test Sans`])
    } finally {
      HTMLCanvasElement.prototype.getContext = orig
    }
  })
})
