/**
 * Drawings and text alternatives of the 9 coding glyphs (ROADMAP M1.11, M1.13; DESIGN §3 row 10),
 * as `tasks/coding/config.ts` specifies them: simple solid or outline shapes, none of which reads
 * as a digit, a letter or a keyboard symbol (no circle outline, vertical strokes, plus, angle or
 * wave). Each is SVG in a 0–100 box; `name` is its text alternative (§13).
 */

import type { CodingSymbol } from '../../tasks/coding/config'

export interface GlyphShape {
  readonly kind: 'path' | 'polygon' | 'circle' | 'rect'
  /** Attributes of the element. */
  readonly attrs: Readonly<Record<string, string | number>>
  /** Filled (solid) or stroked (outline). */
  readonly filled: boolean
}

export interface GlyphDef {
  readonly name: string
  readonly shapes: readonly GlyphShape[]
}

const r2 = (x: number): number => Math.round(x * 100) / 100

/** Points of a regular polygon (or star when `inner` is set), point up, centre (50, cy). */
function polygonPoints(n: number, outer: number, cy: number, inner?: number): string {
  const pts: string[] = []
  const steps = inner === undefined ? n : 2 * n
  for (let k = 0; k < steps; k++) {
    const rad = inner !== undefined && k % 2 === 1 ? inner : outer
    const a = -Math.PI / 2 + (k * 2 * Math.PI) / steps
    pts.push(`${r2(50 + rad * Math.cos(a))},${r2(cy + rad * Math.sin(a))}`)
  }
  return pts.join(' ')
}

const fill = (kind: GlyphShape['kind'], attrs: GlyphShape['attrs']): GlyphShape => ({ kind, attrs, filled: true })
const line = (kind: GlyphShape['kind'], attrs: GlyphShape['attrs']): GlyphShape => ({ kind, attrs, filled: false })

export const GLYPHS: Readonly<Record<CodingSymbol, GlyphDef>> = Object.freeze({
  halfdisc: { name: 'half disc, flat side down', shapes: [fill('path', { d: 'M10 72 A40 40 0 0 1 90 72 Z' })] },
  star: { name: 'five-pointed star', shapes: [fill('polygon', { points: polygonPoints(5, 42, 54, 17) })] },
  wedge: { name: 'solid triangle, point up', shapes: [fill('polygon', { points: '50,14 88,82 12,82' })] },
  tridot: {
    name: 'three dots in a triangle',
    shapes: [fill('circle', { cx: 50, cy: 24, r: 12 }), fill('circle', { cx: 24, cy: 74, r: 12 }), fill('circle', { cx: 76, cy: 74, r: 12 })],
  },
  bowtie: {
    name: 'bow tie of two triangles',
    shapes: [fill('polygon', { points: '12,22 50,50 12,78' }), fill('polygon', { points: '88,22 50,50 88,78' })],
  },
  diamond: { name: 'diamond outline', shapes: [line('polygon', { points: '50,10 88,50 50,90 12,50' })] },
  trapezoid: { name: 'trapezoid outline, long side down', shapes: [line('polygon', { points: '32,24 68,24 90,78 10,78' })] },
  pentagon: { name: 'pentagon outline, point up', shapes: [line('polygon', { points: polygonPoints(5, 40, 54) })] },
  dotbox: {
    name: 'square outline with a centre dot',
    shapes: [line('rect', { x: 16, y: 16, width: 68, height: 68 }), fill('circle', { cx: 50, cy: 50, r: 9 })],
  },
})
