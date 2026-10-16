/**
 * Hard quant table 1 (generator 1.4.0, ROADMAP M3.12): stratum 5 geometry and trigonometry —
 * Heron's formula, parallel chords, distances in coordinates, a cone, trigonometric values from a
 * Pythagorean sine, the sine of a sum and the law of cosines. See `templates.ts` (HARD). The bank
 * twin is `hb.gen.quant.hard1`; the verifier's routes are in `verify-hard1.ts`.
 *
 * Every draw comes from a Pythagorean triple or from an enumeration of the valid givens, so every
 * key is an exact integer or rational; the enumerations are computed once, lazily.
 */

import type { Rng } from '../../engine'
import { type Fraction, exactRoot, frac } from './fraction'
import { V, int, lin, num, oneOf, signed, until, type Given, type VariantDef } from './kit'

type Triple = readonly [number, number, number]

/** The 16 primitive Pythagorean triples with hypotenuse ≤ 100, (leg, leg, hypotenuse). */
const PT: readonly Triple[] = Object.freeze([
  [3, 4, 5], [5, 12, 13], [8, 15, 17], [7, 24, 25], [20, 21, 29], [12, 35, 37], [9, 40, 41], [28, 45, 53],
  [11, 60, 61], [33, 56, 65], [16, 63, 65], [48, 55, 73], [13, 84, 85], [36, 77, 85], [39, 80, 89], [65, 72, 97],
] as const)

/** The integer square root of n, or null if n is not a perfect square (n < 0 included). */
function isqrt(n: number): number | null {
  const r = exactRoot(BigInt(n), 2)
  return r === null ? null : Number(r)
}
/** The integer square root of n; throws if n is not a perfect square (a broken given). */
function root(n: number): number {
  const r = isqrt(n)
  if (r === null) throw new RangeError(`hard1: ${n} is not a perfect square`)
  return r
}

/** Heron's 16K² = (a+b+c)(−a+b+c)(a−b+c)(a+b−c). */
const heronP = (a: number, b: number, c: number): number => (a + b + c) * (-a + b + c) * (a - b + c) * (a + b - c)

let heronTable: readonly Triple[] | null = null
/** Every (a, b, c) in [3, 75]³, a < b < c, a triangle, not right, with an integer area. */
function heronTriangles(): readonly Triple[] {
  if (heronTable === null) {
    const out: Triple[] = []
    for (let a = 3; a <= 75; a++)
      for (let b = a + 1; b <= 75; b++)
        for (let c = b + 1; c < a + b && c <= 75; c++) {
          if (a * a + b * b === c * c) continue
          const r = isqrt(heronP(a, b, c))
          if (r !== null && r % 4 === 0) out.push([a, b, c])
        }
    heronTable = Object.freeze(out)
  }
  return heronTable
}

let chordTable: readonly Triple[] | null = null
/**
 * Every (r, x1, x2): r in 5..65 and distances 1 ≤ x1 < x2 < r from the centre at which a chord of
 * the circle has an integer half-length √(r² − x²).
 */
function chordPairs(): readonly Triple[] {
  if (chordTable === null) {
    const out: Triple[] = []
    for (let r = 5; r <= 65; r++) {
      const xs: number[] = []
      for (let x = 1; x < r; x++) if (isqrt(r * r - x * x) !== null) xs.push(x)
      for (const x1 of xs) for (const x2 of xs) if (x1 < x2) out.push([r, x1, x2])
    }
    chordTable = Object.freeze(out)
  }
  return chordTable
}

function drawChords(rng: Rng, opposite: boolean): Given {
  const [r, x1, x2] = rng.pick(chordPairs())
  return { long: 2 * root(r * r - x1 * x1), short: 2 * root(r * r - x2 * x2), d: opposite ? x1 + x2 : x2 - x1 }
}

/** r with r² = A² + x², x the long chord's distance from the centre (A = long/2). */
function chordRadius(g: Given, opposite: boolean): Fraction {
  const L = num(g, 'long'), S = num(g, 'short'), d = num(g, 'd')
  const x = frac(opposite ? S * S - L * L + 4 * d * d : L * L - S * S - 4 * d * d, 8 * d)
  const r2 = frac(L * L, 4).add(x.mul(x))
  if (!r2.isInteger()) throw new RangeError('chords: r² is not an integer')
  return frac(root(Number(r2.n)))
}

/** The legs (|A|, |B|) of the line's normal: Pythagorean legs ≤ 15, either order. */
const NORMALS: readonly (readonly [number, number])[] = Object.freeze([[3, 4], [4, 3], [5, 12], [12, 5], [8, 15], [15, 8]] as const)

/** Multiples (u, v, w) of the PT triples with u ≤ maxU, v ≤ maxV, w ≤ maxW, legs in both orders. */
function scaledTriples(maxU: number, maxV: number, maxW: number): Triple[] {
  const out: Triple[] = []
  for (const [p, q, h] of PT)
    for (let k = 1; k * h <= maxW; k++)
      for (const [u, v] of [[p, q], [q, p]] as const) if (k * u <= maxU && k * v <= maxV) out.push([k * u, k * v, k * h])
  return out
}
let pathTable: readonly Triple[] | null = null
/** (u, v, w): u = |bx − ax| ≤ 80, v = ay + by in [2, 80]. */
const pathTriples = (): readonly Triple[] => (pathTable ??= Object.freeze(scaledTriples(80, 80, 200)))
let coneTable: readonly Triple[] | null = null
/** (r, h, slant): r either leg, in [3, 84]; slant ≤ 100. */
const coneTriples = (): readonly Triple[] => (coneTable ??= Object.freeze(scaledTriples(84, 100, 100).filter(([r]) => r >= 3)))

/** (p, r): a leg and the hypotenuse of a PT triple (unscaled), either leg. */
const SINES: readonly (readonly [number, number])[] = Object.freeze(PT.flatMap(([p, q, h]) => [[p, h], [q, h]] as const))

const lawSquare = (b: number, c: number, angle: number): number => (angle === 60 ? b * b + c * c - b * c : b * b + c * c + b * c)
let lawTable: readonly Triple[] | null = null
/** Every (b, c, angle), b ≠ c in [1, 80], angle 60 or 120, with an integer third side. */
function lawTriangles(): readonly Triple[] {
  if (lawTable === null) {
    const out: Triple[] = []
    for (const angle of [60, 120])
      for (let b = 1; b <= 80; b++) for (let c = 1; c <= 80; c++) if (b !== c && isqrt(lawSquare(b, c, angle)) !== null) out.push([b, c, angle])
    lawTable = Object.freeze(out)
  }
  return lawTable
}

const heronArea = (g: Given): Fraction => frac(root(heronP(num(g, 'a'), num(g, 'b'), num(g, 'c'))), 4)
function drawHeron(rng: Rng): Given {
  const [a, b, c] = rng.pick(heronTriangles())
  return { a, b, c }
}
const heronStem = (g: Given): string => `A triangle has sides of length ${num(g, 'a')}, ${num(g, 'b')} and ${num(g, 'c')}.`
const chordStem = (g: Given, side: string): string =>
  `Two parallel chords of a circle have lengths ${num(g, 'long')} and ${num(g, 'short')}. They lie on ${side} of the centre of the circle, ${num(g, 'd')} apart. What is the radius of the circle?`
const sinStem = (g: Given, ask: string): string =>
  `The angle θ is between 90° and 180°, and sin θ = ${num(g, 'p')}/${num(g, 'r')}. What is the value of ${ask}?`
function drawSine(rng: Rng): Given {
  const [p, r] = rng.pick(SINES)
  return { p, r }
}
/** q = √(r² − p²) = −r·cos θ. */
const legQ = (g: Given): number => root(num(g, 'r') ** 2 - num(g, 'p') ** 2)

export const HARD1: VariantDef[] = [
  V({
    template: 'heron', variant: 'area', stratum: 5, format: 'integer', offset: -0.2,
    fields: { a: int(3, 75), b: int(3, 75), c: int(3, 75) },
    draw: drawHeron,
    render: (g) => `${heronStem(g)} What is its area?`,
    compute: heronArea,
  }),
  V({
    template: 'heron', variant: 'inradius', stratum: 5, format: 'fraction', offset: 0.1,
    fields: { a: int(3, 75), b: int(3, 75), c: int(3, 75) },
    draw: drawHeron,
    render: (g) => `${heronStem(g)} What is the radius of the circle inscribed in it?`,
    compute: (g) => heronArea(g).div(frac(num(g, 'a') + num(g, 'b') + num(g, 'c'), 2)),
  }),
  V({
    template: 'chords', variant: 'same_side', stratum: 5, format: 'integer', offset: 0.2,
    fields: { long: int(2, 130), short: int(2, 130), d: int(1, 130) },
    draw: (rng) => drawChords(rng, false),
    render: (g) => chordStem(g, 'the same side'),
    compute: (g) => chordRadius(g, false),
  }),
  V({
    template: 'chords', variant: 'opposite', stratum: 5, format: 'integer', offset: 0,
    fields: { long: int(2, 130), short: int(2, 130), d: int(1, 130) },
    draw: (rng) => drawChords(rng, true),
    render: (g) => chordStem(g, 'opposite sides'),
    compute: (g) => chordRadius(g, true),
  }),
  V({
    template: 'coord', variant: 'point_line', stratum: 5, format: 'fraction', offset: -0.2,
    fields: { x: int(-12, 12), y: int(-12, 12), A: int(-15, 15, true), B: int(-15, 15, true), C: int(-60, 60) },
    draw(rng) {
      const [p, q] = rng.pick(NORMALS)
      const A = p * rng.pick([1, -1])
      const B = q * rng.pick([1, -1])
      return until(
        () => ({ x: rng.int(-12, 12), y: rng.int(-12, 12), A, B, C: rng.int(-60, 60) }),
        (g) => g.A * g.x + g.B * g.y !== g.C,
        'a point off the line',
      )
    },
    render: (g) =>
      `What is the distance from the point (${signed(num(g, 'x'))}, ${signed(num(g, 'y'))}) to the line ${lin([[num(g, 'A'), 'x'], [num(g, 'B'), 'y']])} = ${signed(num(g, 'C'))}?`,
    compute(g) {
      const A = num(g, 'A'), B = num(g, 'B')
      return frac(Math.abs(A * num(g, 'x') + B * num(g, 'y') - num(g, 'C')), root(A * A + B * B))
    },
  }),
  V({
    template: 'coord', variant: 'reflect_path', stratum: 5, format: 'integer', offset: 0,
    fields: { ax: int(-20, 20), ay: int(1, 40), bx: int(-20, 60), by: int(1, 40) },
    draw(rng) {
      const [u, v] = rng.pick(pathTriples())
      const ay = rng.int(Math.max(1, v - 40), Math.min(40, v - 1))
      // bx = ax ± u with ax in [−20, 20] and bx in [−20, 60]: "+" always fits (u ≤ 80), "−" only if u ≤ 40.
      const s = u <= 40 ? rng.pick([1, -1]) : 1
      const ax = s > 0 ? rng.int(-20, Math.min(20, 60 - u)) : rng.int(u - 20, 20)
      return { ax, ay, bx: ax + s * u, by: v - ay }
    },
    render: (g) =>
      `A path goes from the point A(${signed(num(g, 'ax'))}, ${num(g, 'ay')}) to a point P on the x-axis and then on to the point B(${signed(num(g, 'bx'))}, ${num(g, 'by')}). What is the shortest possible length of the path?`,
    compute: (g) => frac(root((num(g, 'bx') - num(g, 'ax')) ** 2 + (num(g, 'ay') + num(g, 'by')) ** 2)),
  }),
  V({
    template: 'solid', variant: 'cone_volume', stratum: 5, format: 'integer', offset: -0.2,
    fields: { r: int(3, 84), slant: int(5, 100) },
    draw(rng) {
      const [r, , slant] = rng.pick(coneTriples())
      return { r, slant }
    },
    render: (g) =>
      `A right circular cone has a base radius of ${num(g, 'r')} and a slant height of ${num(g, 'slant')}. Its volume is kπ. What is k?`,
    compute(g) {
      const r = num(g, 'r')
      return frac(r * r * root(num(g, 'slant') ** 2 - r * r), 3)
    },
  }),
  V({
    template: 'trig_sin', variant: 'tan', stratum: 5, format: 'fraction', offset: -0.3,
    fields: { p: int(1, 99), r: int(5, 97) },
    draw: drawSine,
    render: (g) => sinStem(g, 'tan θ'),
    compute: (g) => frac(-num(g, 'p'), legQ(g)),
  }),
  V({
    template: 'trig_sin', variant: 'cos_double', stratum: 5, format: 'fraction', offset: -0.1,
    fields: { p: int(1, 99), r: int(5, 97) },
    draw: drawSine,
    render: (g) => sinStem(g, 'cos 2θ'),
    compute: (g) => frac(num(g, 'r') ** 2 - 2 * num(g, 'p') ** 2, num(g, 'r') ** 2),
  }),
  V({
    template: 'trig_sin', variant: 'sin_double', stratum: 5, format: 'fraction', offset: 0,
    fields: { p: int(1, 99), r: int(5, 97) },
    draw: drawSine,
    render: (g) => sinStem(g, 'sin 2θ'),
    compute: (g) => frac(-2 * num(g, 'p') * legQ(g), num(g, 'r') ** 2),
  }),
  V({
    template: 'angle_sum', variant: 'sin_sum', stratum: 5, format: 'fraction', offset: 0.1,
    fields: { a: int(1, 99), c: int(5, 97), d: int(1, 99), f: int(5, 97) },
    draw: (rng) =>
      until(
        () => {
          const [a, c] = rng.pick(SINES)
          const [d, f] = rng.pick(SINES)
          return { a, c, d, f }
        },
        (g) => g.a * g.f !== g.d * g.c,
        'two angles that are not complementary',
      ),
    render: (g) =>
      `The angles α and β are both between 0° and 90°, with sin α = ${num(g, 'a')}/${num(g, 'c')} and cos β = ${num(g, 'd')}/${num(g, 'f')}. What is the value of sin(α + β)?`,
    compute(g) {
      const a = num(g, 'a'), c = num(g, 'c'), d = num(g, 'd'), f = num(g, 'f')
      return frac(a * d + root(c * c - a * a) * root(f * f - d * d), c * f)
    },
  }),
  V({
    template: 'law_cosines', variant: 'side', stratum: 5, format: 'integer', offset: 0,
    fields: { b: int(1, 80), c: int(1, 80), angle: oneOf(60, 120) },
    draw(rng) {
      const [b, c, angle] = rng.pick(lawTriangles())
      return { b, c, angle }
    },
    render: (g) => `In triangle ABC, AB = ${num(g, 'c')}, AC = ${num(g, 'b')} and angle BAC = ${num(g, 'angle')}°. What is the length of BC?`,
    compute: (g) => frac(root(lawSquare(num(g, 'b'), num(g, 'c'), num(g, 'angle')))),
  }),
]

/** The sizes of the draw tables (content variety; tests only). */
export const hard1TableSizes = (): Record<string, number> => ({
  heron: heronTriangles().length,
  chords: chordPairs().length,
  path: pathTriples().length,
  cone: coneTriples().length,
  law: lawTriangles().length,
})
