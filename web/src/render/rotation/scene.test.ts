/**
 * The polycube renderer's pure scene module (ROADMAP M1.13; DESIGN §4.2 "Rendering"): geometry,
 * the fixed `iso_v1` camera, the shared scale and the deterministic lighting, tested in Node
 * without WebGL. Three.js's math classes (no WebGL needed) pin the conventions the view relies on:
 * quaternion order and `lookAt`.
 */

import fc from 'fast-check'
import { OrthographicCamera, Quaternion, Vector3 } from 'three'
import { describe, expect, it } from 'vitest'
import { mat3FromQuat, quatNormalize, type Quat, type Vec3 } from '../../tasks/rotation/geometry'
import { ISO_V1_VIEW_AXIS, type RotationSpec } from '../../tasks/rotation/spec'
import { rotation } from '../../tasks/rotation'
import { contrast, luminance } from '../color'
import {
  CUBE_HALF_DIAGONAL,
  FRAME_MARGIN,
  ISO_BASIS,
  LIGHTING,
  cubeCorners,
  dot3,
  figureScene,
  isoCamera,
  rotate,
  rotationScene,
  shade,
  toDepth,
  toScreen,
  worldCentres,
} from './scene'

const close = (a: readonly number[], b: readonly number[], tol = 1e-9): boolean => a.length === b.length && a.every((x, i) => Math.abs(x - (b[i] as number)) <= tol)

const quatArb = fc
  .tuple(fc.double({ min: -1, max: 1, noNaN: true }), fc.double({ min: -1, max: 1, noNaN: true }), fc.double({ min: -1, max: 1, noNaN: true }), fc.double({ min: -1, max: 1, noNaN: true }))
  .filter((q) => Math.hypot(...q) > 0.1)
  .map((q) => quatNormalize(q as Quat))

const vecArb = fc.tuple(fc.double({ min: -5, max: 5, noNaN: true }), fc.double({ min: -5, max: 5, noNaN: true }), fc.double({ min: -5, max: 5, noNaN: true })) as fc.Arbitrary<Vec3>

const items = (n: number, prefix: string): RotationSpec[] => Array.from({ length: n }, (_, i) => rotation.generate(`${prefix}-${i}`).spec)

describe('rotation scene: conventions shared with Three.js', () => {
  it('rotate() is geometry.mat3FromQuat, and Three.js Quaternion(x, y, z, w) applies the same rotation', () => {
    fc.assert(
      fc.property(quatArb, vecArb, (q, v) => {
        const m = mat3FromQuat(q)
        const expected: Vec3 = [dot3(m[0], v), dot3(m[1], v), dot3(m[2], v)]
        expect(close(rotate(q, v), expected, 1e-12)).toBe(true)
        const fig = figureScene({ cubes: [[0, 0, 0]], quat: q })
        const three = new Vector3(...v).applyQuaternion(new Quaternion(...fig.quaternionXyzw))
        expect(close([three.x, three.y, three.z], expected, 1e-9)).toBe(true)
      }),
      { numRuns: 500 },
    )
  })

  it('ISO_BASIS is the camera frame Three.js lookAt builds for iso_v1, looking along −ISO_V1_VIEW_AXIS', () => {
    const cam = isoCamera('iso_v1', 5)
    const three = new OrthographicCamera(-1, 1, 1, -1, cam.near, cam.far)
    three.position.set(...cam.position)
    three.up.set(...cam.up)
    three.lookAt(...cam.lookAt)
    three.updateMatrixWorld()
    const e = three.matrixWorld.elements
    // Columns of the world matrix: the camera's x (right), y (up) and z (back) axes.
    expect(close([e[0], e[1], e[2]] as number[], ISO_BASIS.right)).toBe(true)
    expect(close([e[4], e[5], e[6]] as number[], ISO_BASIS.up)).toBe(true)
    expect(close([e[8], e[9], e[10]] as number[], ISO_BASIS.back)).toBe(true)
    expect(close(ISO_BASIS.back, ISO_V1_VIEW_AXIS)).toBe(true)
    // World +z points up on screen; the frame is orthonormal and right-handed.
    expect(ISO_BASIS.up[2]).toBeGreaterThan(0)
    expect(Math.abs(dot3(ISO_BASIS.right, ISO_BASIS.up))).toBeLessThan(1e-12)
    expect(toScreen([1, 1, 1])).toEqual([expect.closeTo(0, 12), expect.closeTo(0, 12)])
    expect(toDepth(cam.position)).toBeGreaterThan(0)
  })

  it('only the iso_v1 camera exists, and a view needs cubes and a unit quaternion', () => {
    expect(() => isoCamera('persp_v2', 3)).toThrow(RangeError)
    expect(() => isoCamera('iso_v1', 0)).toThrow(RangeError)
    expect(() => figureScene({ cubes: [], quat: [1, 0, 0, 0] })).toThrow(RangeError)
    expect(() => figureScene({ cubes: [[0, 0, 0]], quat: [2, 0, 0, 0] })).toThrow(RangeError)
  })
})

describe('rotation scene: figures', () => {
  it('centres each figure on its centroid and keeps its shape (distances) under the display rotation', () => {
    for (const spec of items(60, 'scene-shape')) {
      for (const view of [spec.target, ...spec.options]) {
        const fig = figureScene(view)
        const sum = fig.offsets.reduce((s, o) => [s[0] + o[0], s[1] + o[1], s[2] + o[2]], [0, 0, 0])
        expect(close(sum, [0, 0, 0], 1e-9)).toBe(true)
        const world = worldCentres(fig)
        for (let i = 0; i < world.length; i++) {
          for (let j = 0; j < i; j++) {
            const d0 = Math.hypot(...(fig.offsets[i] as Vec3).map((x, k) => x - ((fig.offsets[j] as Vec3)[k] as number)))
            const d1 = Math.hypot(...(world[i] as Vec3).map((x, k) => x - ((world[j] as Vec3)[k] as number)))
            expect(d1).toBeCloseTo(d0, 9)
          }
        }
        // Face-adjacent cubes stay one unit apart: the drawn object is the spec's polycube.
        expect(fig.offsets.length).toBe(view.cubes.length)
      }
    }
  })

  it('the radius bounds every cube corner and does not depend on the display rotation', () => {
    fc.assert(
      fc.property(fc.integer({ min: 0, max: 10_000 }), quatArb, (seed, q) => {
        const spec = rotation.generate(`scene-radius-${seed}`).spec
        const a = figureScene(spec.target)
        const b = figureScene({ cubes: spec.target.cubes, quat: q })
        expect(b.radius).toBeCloseTo(a.radius, 12)
        for (const o of b.offsets) for (const c of cubeCorners(b, o)) expect(Math.hypot(...c)).toBeLessThanOrEqual(b.radius + 1e-9)
        // Tight: some corner reaches within a cube's half-diagonal of the radius.
        const far = Math.max(...b.offsets.map((o) => Math.hypot(...o)))
        expect(b.radius).toBeCloseTo(far + CUBE_HALF_DIAGONAL, 12)
      }),
      { numRuns: 80 },
    )
  })

  it('one camera per item: all five figures share the scale and fit inside the square frustum', () => {
    for (const spec of items(300, 'scene-fit')) {
      const sc = rotationScene(spec)
      const figs = [sc.target, ...sc.options]
      expect(figs).toHaveLength(5)
      const maxR = Math.max(...figs.map((f) => f.radius))
      expect(sc.camera.halfExtent).toBeCloseTo(maxR * FRAME_MARGIN, 12)
      const h = sc.camera.halfExtent
      for (const f of figs) {
        for (const o of f.offsets) {
          for (const c of cubeCorners(f, o)) {
            const [x, y] = toScreen(c)
            expect(Math.abs(x)).toBeLessThan(h)
            expect(Math.abs(y)).toBeLessThan(h)
            // Inside the near/far planes: the camera sits at distance d on the view axis.
            const depth = toDepth(sc.camera.position) - toDepth(c)
            expect(depth).toBeGreaterThan(sc.camera.near)
            expect(depth).toBeLessThan(sc.camera.far)
          }
        }
      }
    }
  })

  it('each figure depends on its own view only: option order and position never change a figure', () => {
    for (const spec of items(40, 'scene-order')) {
      const sc = rotationScene(spec)
      const reversed = rotationScene({ ...spec, options: [...spec.options].reverse() })
      expect(reversed.options).toEqual([...sc.options].reverse())
      expect(reversed.camera).toEqual(sc.camera)
      sc.options.forEach((fig, i) => expect(fig).toEqual(figureScene(spec.options[i] as (typeof spec.options)[number])))
    }
  })
})

describe('rotation scene: deterministic lighting', () => {
  it('is frozen, with a unit light direction from the upper left, in front of the figures', () => {
    expect(Object.isFrozen(LIGHTING)).toBe(true)
    expect(Math.hypot(...LIGHTING.direction)).toBeCloseTo(1, 12)
    expect(dot3(LIGHTING.direction, ISO_BASIS.back)).toBeGreaterThan(0)
    expect(dot3(LIGHTING.direction, ISO_BASIS.up)).toBeGreaterThan(0)
    expect(dot3(LIGHTING.direction, ISO_BASIS.right)).toBeLessThan(0)
  })

  it('gives the three faces of an unrotated cube (identity quat, the plain iso view) three clearly different shades', () => {
    const faces = [shade([1, 0, 0]), shade([0, 1, 0]), shade([0, 0, 1])]
    for (let i = 0; i < 3; i++) for (let j = 0; j < i; j++) expect(Math.abs((faces[i] as number) - (faces[j] as number))).toBeGreaterThan(0.08)
  })

  it('cannot shade the visible faces apart at every orientation, so the edges carry the structure there', () => {
    // A turn by θ about the line of sight keeps the three iso faces visible (each at cos = 1/√3)
    // and at 120° cycles them, so some θ gives two of them the same shade (intermediate values).
    const back = ISO_BASIS.back
    const edge = luminance(LIGHTING.edge)
    let closest = Infinity
    for (let deg = 0; deg <= 120; deg += 0.25) {
      const h = (deg * Math.PI) / 360
      const q: Quat = [Math.cos(h), Math.sin(h) * back[0], Math.sin(h) * back[1], Math.sin(h) * back[2]]
      const shades = ([[1, 0, 0], [0, 1, 0], [0, 0, 1]] as Vec3[]).map((n) => shade(rotate(q, n)))
      for (let i = 0; i < 3; i++) for (let j = 0; j < i; j++) closest = Math.min(closest, Math.abs((shades[i] as number) - (shades[j] as number)))
      // Whatever the shades, every face keeps its ≥ 3:1 edges (WCAG 1.4.11).
      for (const sh of shades) expect((luminance(LIGHTING.face) * sh + 0.05) / (edge + 0.05)).toBeGreaterThanOrEqual(3)
    }
    expect(closest).toBeLessThan(0.005)
  })

  it('still shades the visible faces of most generated figures apart (≤ 20% with two faces within 1.1:1)', () => {
    const axes: Vec3[] = [[1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1]]
    const face = luminance(LIGHTING.face)
    const closest: number[] = []
    for (const spec of items(150, 'scene-shade')) {
      for (const fig of [spec.target, ...spec.options].map(figureScene)) {
        // Face directions turned towards the viewer by more than a sliver (cos > 0.2).
        const visible = axes.map((a) => rotate(fig.quat, a)).filter((n) => dot3(n, ISO_BASIS.back) > 0.2)
        if (visible.length < 2) continue
        const lum = visible.map((n) => face * shade(n))
        let ratio = Infinity
        for (let i = 0; i < lum.length; i++) for (let j = 0; j < i; j++) ratio = Math.min(ratio, (Math.max(lum[i] as number, lum[j] as number) + 0.05) / (Math.min(lum[i] as number, lum[j] as number) + 0.05))
        closest.push(ratio)
      }
    }
    closest.sort((a, b) => a - b)
    expect(closest.length).toBeGreaterThan(500)
    expect(closest.filter((r) => r < 1.1).length / closest.length).toBeLessThanOrEqual(0.2)
    expect(closest[Math.floor(closest.length / 2)]).toBeGreaterThanOrEqual(1.25)
  })

  it('keeps every shade within [ambient, 1] (no clipped highlights) for any normal', () => {
    fc.assert(
      fc.property(vecArb.filter((v) => Math.hypot(...v) > 1e-3), (n) => {
        const s = shade(n)
        expect(s).toBeGreaterThanOrEqual(LIGHTING.ambient)
        expect(s).toBeLessThanOrEqual(1)
      }),
    )
  })

  it('draws edges at ≥ 3:1 against the background and against every face shade (WCAG 1.4.11)', () => {
    expect(contrast(LIGHTING.edge, LIGHTING.background)).toBeGreaterThanOrEqual(3)
    expect(contrast(LIGHTING.edge, LIGHTING.face)).toBeGreaterThanOrEqual(3)
    // A face's linear colour is albedo × shade (Lambert, no tone mapping), so its luminance scales
    // the same way; the darkest face gets the ambient term only.
    const darkest = luminance(LIGHTING.face) * LIGHTING.ambient
    expect((darkest + 0.05) / (luminance(LIGHTING.edge) + 0.05)).toBeGreaterThanOrEqual(3)
  })
})
