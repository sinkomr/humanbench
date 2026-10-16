/**
 * The verifier's checks of hard quant table 1 (`hard1.ts`; generator 1.4.0, ROADMAP M3.12). Each
 * answer is recomputed by its own exact route, never the generator's closed form:
 *
 * - Heron: the triangle is placed in coordinates (side c on the x-axis); the height is an exact
 *   rational square root; the area is base × height / 2, the inradius the y-coordinate of the
 *   incentre (the side-weighted mean of the vertices);
 * - chords: the circle x² + y² + Dx + Ey + F = 0 through three chord endpoints by Cramer's rule,
 *   the fourth endpoint checked on it, the centre checked on the side the stem says, r by an exact root;
 * - point to line: the foot of the perpendicular, then the exact root of the squared distance;
 * - shortest path: reflect B in the x-axis, intersect A–B′ with the axis, add the two exact lengths;
 * - cone: Simpson's rule on the disc areas (exact for the quadratic integrand);
 * - trigonometry: cos θ (or cos α, sin β) as the exact root of 1 − sin², with the quadrant's sign,
 *   then tan = sin/cos, cos 2θ = 2cos²θ − 1, sin 2θ = 2 sin θ cos θ, and sin(α + β) as the y of
 *   (cos α, sin α) rotated by β;
 * - law of cosines: A = (0, 0), B = (c, 0), C = (b cos A, b sin A) with sin²A = 3/4, BC² exactly.
 */

import { Fraction, exactRoot } from './fraction'
import { num, type Given } from './kit'
import { f, gcd, type Check } from './verify-kit'

const isSquare = (n: number): boolean => n >= 0 && exactRoot(BigInt(n), 2) !== null

/** The exact square root of a rational x ≥ 0, or null if it is irrational. */
function ratSqrt(x: Fraction): Fraction | null {
  if (x.sign() < 0) return null
  const n = exactRoot(x.n, 2)
  const d = exactRoot(x.d, 2)
  return n === null || d === null ? null : Fraction.of(n, d)
}
function sqrtOrThrow(x: Fraction, what: string): Fraction {
  const r = ratSqrt(x)
  if (r === null) throw new RangeError(`${what} is irrational`)
  return r
}
const sq = (x: Fraction): Fraction => x.mul(x)

// --- Heron ------------------------------------------------------------------------------------

function heronRules(g: Given): Record<string, boolean> {
  const a = num(g, 'a'), b = num(g, 'b'), c = num(g, 'c')
  const P = BigInt(a + b + c) * BigInt(-a + b + c) * BigInt(a - b + c) * BigInt(a + b - c)
  const r = P > 0n ? exactRoot(P, 2) : null
  return {
    ordered: a <= b && b <= c,
    triangle: a + b > c,
    scalene: a < b && b < c,
    not_right: a * a + b * b !== c * c,
    integer_area: r !== null && r % 4n === 0n,
  }
}

/** Vertices (0, 0), (c, 0), (x, h): distance a from the origin, b from (c, 0); returns [x, h]. */
function placeTriangle(g: Given): [Fraction, Fraction] {
  const a = f(num(g, 'a')), b = f(num(g, 'b')), c = f(num(g, 'c'))
  const x = sq(a).sub(sq(b)).add(sq(c)).div(c.mul(f(2)))
  const h2 = sq(a).sub(sq(x))
  if (h2.sign() <= 0) throw new RangeError('heron: not a triangle')
  const h = sqrtOrThrow(h2, 'the height')
  // both side lengths reproduced exactly
  if (!(sq(x).add(sq(h)).eq(sq(a)) && sq(x.sub(c)).add(sq(h)).eq(sq(b)))) throw new Error('heron: placement')
  return [x, h]
}

const heronArea: Check = {
  rules: heronRules,
  solve(g) {
    const [, h] = placeTriangle(g)
    return f(num(g, 'c')).mul(h).div(f(2))
  },
}

const heronInradius: Check = {
  rules: heronRules,
  solve(g) {
    const [, h] = placeTriangle(g)
    // incentre = (a·P0 + b·P1 + c·P2) / (a + b + c) with the weight of each vertex the opposite side:
    // P0 = (0, 0) faces |P1P2| = b, P1 = (c, 0) faces |P0P2| = a, P2 = (x, h) faces c. Its y is r.
    const a = num(g, 'a'), b = num(g, 'b'), c = num(g, 'c')
    return f(c).mul(h).div(f(a + b + c))
  },
}

// --- chords -----------------------------------------------------------------------------------

function chordRules(g: Given, opposite: boolean): Record<string, boolean> {
  const L = num(g, 'long'), S = num(g, 'short'), d = num(g, 'd')
  const x = f(opposite ? S * S - L * L + 4 * d * d : L * L - S * S - 4 * d * d, 8 * d)
  const r2 = f(L * L, 4).add(sq(x))
  return {
    even: L % 2 === 0 && S % 2 === 0,
    longer: L > S,
    placed: opposite ? x.sign() > 0 && x.cmp(f(d)) < 0 : x.sign() > 0,
    integer_radius: r2.isInteger() && isSquare(Number(r2.n)),
  }
}

/** 3×3 determinant. */
function det3(m: readonly (readonly Fraction[])[]): Fraction {
  const [[a, b, c], [d, e, g], [h, i, j]] = m as [[Fraction, Fraction, Fraction], [Fraction, Fraction, Fraction], [Fraction, Fraction, Fraction]]
  return a.mul(e.mul(j).sub(g.mul(i))).sub(b.mul(d.mul(j).sub(g.mul(h)))).add(c.mul(d.mul(i).sub(e.mul(h))))
}

function chordCheck(opposite: boolean): Check {
  return {
    rules: (g) => chordRules(g, opposite),
    solve(g, stem) {
      if (stem.includes('opposite sides') !== opposite) throw new Error('chords: stem side')
      const A = f(num(g, 'long'), 2), B = f(num(g, 'short'), 2), d = f(num(g, 'd'))
      // Endpoints (±A, 0) on one chord, (±B, d) on the other. Circle: Dx + Ey + F = −(x² + y²).
      const pts: [Fraction, Fraction][] = [[A, f(0)], [A.neg(), f(0)], [B, d], [B.neg(), d]]
      const rows = pts.slice(0, 3).map(([x, y]) => [x, y, f(1)])
      const rhs = pts.slice(0, 3).map(([x, y]) => sq(x).add(sq(y)).neg())
      const M = det3(rows)
      if (M.isZero()) throw new Error('chords: collinear endpoints')
      const col = (k: number): Fraction => det3(rows.map((row, i) => row.map((v, j) => (j === k ? (rhs[i] as Fraction) : v)))).div(M)
      const [D, E, F] = [col(0), col(1), col(2)]
      const [x4, y4] = pts[3] as [Fraction, Fraction]
      if (!sq(x4).add(sq(y4)).add(D.mul(x4)).add(E.mul(y4)).add(F).isZero()) throw new Error('chords: fourth endpoint off the circle')
      // centre (−D/2, −E/2): between the chords (0 < y < d) iff they lie on opposite sides
      const cy = E.div(f(-2))
      const between = cy.sign() > 0 && cy.cmp(d) < 0
      if (between !== opposite) throw new Error('chords: the centre is on the wrong side')
      if (!opposite && !(cy.sign() < 0)) throw new Error('chords: the long chord is not nearer the centre')
      return sqrtOrThrow(sq(D).add(sq(E)).div(f(4)).sub(F), 'the radius')
    },
  }
}

// --- coordinates ------------------------------------------------------------------------------

const pointLine: Check = {
  rules(g) {
    const A = num(g, 'A'), B = num(g, 'B')
    return {
      hypotenuse: isSquare(A * A + B * B),
      primitive: gcd(A, B) === 1,
      off_line: A * num(g, 'x') + B * num(g, 'y') !== num(g, 'C'),
    }
  },
  solve(g) {
    const A = f(num(g, 'A')), B = f(num(g, 'B')), C = f(num(g, 'C')), x = f(num(g, 'x')), y = f(num(g, 'y'))
    // foot (x − tA, y − tB) on the line: A(x − tA) + B(y − tB) = C
    const t = A.mul(x).add(B.mul(y)).sub(C).div(sq(A).add(sq(B)))
    const fx = x.sub(t.mul(A)), fy = y.sub(t.mul(B))
    if (!A.mul(fx).add(B.mul(fy)).eq(C)) throw new Error('point_line: foot off the line')
    return sqrtOrThrow(sq(x.sub(fx)).add(sq(y.sub(fy))), 'the distance')
  },
}

const reflectPath: Check = {
  rules(g) {
    const dx = num(g, 'bx') - num(g, 'ax'), dy = num(g, 'ay') + num(g, 'by')
    return { distinct_x: dx !== 0, integer_length: isSquare(dx * dx + dy * dy) }
  },
  solve(g) {
    const ax = f(num(g, 'ax')), ay = f(num(g, 'ay')), bx = f(num(g, 'bx')), by = f(num(g, 'by'))
    // B′ = (bx, −by); A + t(B′ − A) has y = 0 at t = ay / (ay + by)
    const t = ay.div(ay.add(by))
    const px = ax.add(t.mul(bx.sub(ax)))
    const ap = sqrtOrThrow(sq(px.sub(ax)).add(sq(ay)), 'AP')
    const pb = sqrtOrThrow(sq(bx.sub(px)).add(sq(by)), 'PB')
    return ap.add(pb)
  },
}

// --- cone -------------------------------------------------------------------------------------

const coneVolume: Check = {
  rules(g) {
    const r = num(g, 'r'), s = num(g, 'slant')
    const h = s > r ? exactRoot(BigInt(s * s - r * r), 2) : null
    return {
      taller: s > r,
      integer_height: s > r && h !== null,
      integer_k: h !== null && (BigInt(r * r) * h) % 3n === 0n,
    }
  },
  solve(g) {
    const r = f(num(g, 'r'))
    const h = sqrtOrThrow(sq(f(num(g, 'slant'))).sub(sq(r)), 'the height')
    if (h.sign() <= 0) throw new RangeError('cone: no height')
    // disc area / π at height y: (r(1 − y/h))²; Simpson's rule is exact for this quadratic.
    const disc = (y: Fraction): Fraction => sq(r.mul(f(1).sub(y.div(h))))
    return h.div(f(6)).mul(disc(f(0)).add(f(4).mul(disc(h.div(f(2))))).add(disc(h)))
  },
}

// --- trigonometry -----------------------------------------------------------------------------

function sineRules(g: Given): Record<string, boolean> {
  const p = num(g, 'p'), r = num(g, 'r')
  return { pythagorean: r * r - p * p > 0 && isSquare(r * r - p * p), reduced: gcd(p, r) === 1 }
}

/** [sin θ, cos θ] for θ in (90°, 180°): the cosine is the negative root of 1 − sin²θ. */
function obtuse(g: Given, stem: string): [Fraction, Fraction] {
  if (!stem.includes('between 90° and 180°')) throw new Error('trig_sin: quadrant')
  const s = f(num(g, 'p'), num(g, 'r'))
  const c = sqrtOrThrow(f(1).sub(sq(s)), 'cos θ').neg()
  if (c.sign() >= 0) throw new RangeError('trig_sin: θ = 90°')
  return [s, c]
}

const trigTan: Check = {
  rules: sineRules,
  solve(g, stem) {
    const [s, c] = obtuse(g, stem)
    return s.div(c)
  },
}
const trigCosDouble: Check = {
  rules: sineRules,
  solve(g, stem) {
    const [, c] = obtuse(g, stem)
    return f(2).mul(sq(c)).sub(f(1))
  },
}
const trigSinDouble: Check = {
  rules: sineRules,
  solve(g, stem) {
    const [s, c] = obtuse(g, stem)
    return f(2).mul(s).mul(c)
  },
}

const sinSum: Check = {
  rules(g) {
    const a = num(g, 'a'), c = num(g, 'c'), d = num(g, 'd'), ff = num(g, 'f')
    return {
      pythagorean_alpha: c * c - a * a > 0 && isSquare(c * c - a * a),
      pythagorean_beta: ff * ff - d * d > 0 && isSquare(ff * ff - d * d),
      reduced: gcd(a, c) === 1 && gcd(d, ff) === 1,
      not_complementary: a * ff !== d * c,
    }
  },
  solve(g) {
    // acute angles: every cosine and sine is the positive root
    const sinA = f(num(g, 'a'), num(g, 'c'))
    const cosA = sqrtOrThrow(f(1).sub(sq(sinA)), 'cos α')
    const cosB = f(num(g, 'd'), num(g, 'f'))
    const sinB = sqrtOrThrow(f(1).sub(sq(cosB)), 'sin β')
    // rotate (cos α, sin α) by β: (x cos β − y sin β, x sin β + y cos β)
    const [x, y] = [cosA, sinA]
    const rx = x.mul(cosB).sub(y.mul(sinB))
    const ry = x.mul(sinB).add(y.mul(cosB))
    if (!sq(rx).add(sq(ry)).eq(f(1))) throw new Error('sin_sum: rotation')
    return ry
  },
}

const lawCosines: Check = {
  rules(g) {
    const b = num(g, 'b'), c = num(g, 'c')
    return { distinct: b !== c, integer_side: isSquare(b * b + c * c + (num(g, 'angle') === 60 ? -b * c : b * c)) }
  },
  solve(g) {
    const b = f(num(g, 'b')), c = f(num(g, 'c'))
    const cosA = f(num(g, 'angle') === 60 ? 1 : -1, 2)
    const sin2A = f(3, 4)
    // C = (b cos A, b sin A), B = (c, 0): BC² = (b cos A − c)² + b² sin²A
    return sqrtOrThrow(sq(b.mul(cosA).sub(c)).add(sq(b).mul(sin2A)), 'BC')
  },
}

export const CHECKS_HARD1: Readonly<Record<string, Check>> = {
  'heron/area': heronArea,
  'heron/inradius': heronInradius,
  'chords/same_side': chordCheck(false),
  'chords/opposite': chordCheck(true),
  'coord/point_line': pointLine,
  'coord/reflect_path': reflectPath,
  'solid/cone_volume': coneVolume,
  'trig_sin/tan': trigTan,
  'trig_sin/cos_double': trigCosDouble,
  'trig_sin/sin_double': trigSinDouble,
  'angle_sum/sin_sum': sinSum,
  'law_cosines/side': lawCosines,
}
