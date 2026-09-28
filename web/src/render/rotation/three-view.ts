/**
 * The Three.js side of the polycube renderer (ROADMAP M1.13, A3: Three.js only for rotation
 * stimuli; DESIGN §4.2 "Rendering"). This is the ONLY module of the app that imports `three`,
 * and `RotationRenderer.svelte` loads it with a dynamic `import()`, so Three.js is a separate
 * chunk fetched when the first rotation item is shown (the bundle test checks both).
 *
 * **One WebGL context, not five** (iOS). WebKit caps the live WebGL contexts of a page (iOS
 * Safari has dropped the oldest context at around 8–16, and a lost context blanks its canvas),
 * and a rotation item shows five figures. So there is exactly one `WebGLRenderer`, on a detached
 * canvas, shared by every mounted rotation renderer: each figure is rendered into it in turn
 * and copied into that figure's own visible 2D canvas with `drawImage` (2D canvases are cheap and
 * not capped). The scene is static (fixed camera, no animation), so a figure is drawn once, and
 * again only when its canvas is resized or the context is restored. Consumers {@link
 * acquirePainter} on mount and `release()` on destroy; the last release disposes the geometry,
 * the materials and the renderer and calls `forceContextLoss()`, so an item that is gone holds no
 * GPU memory and no context.
 *
 * Lighting and colours come from `scene.ts` ({@link LIGHTING}); intensities are multiplied by π
 * because Three.js's Lambert BRDF divides by π, so a face's linear colour is albedo × `shade(n)`.
 * `preserveDrawingBuffer` keeps the frame readable by `drawImage` until the next render.
 */

import {
  AmbientLight,
  BoxGeometry,
  DirectionalLight,
  EdgesGeometry,
  Group,
  LineBasicMaterial,
  LineSegments,
  Mesh,
  MeshLambertMaterial,
  OrthographicCamera,
  Scene,
  WebGLRenderer,
} from 'three'
import { LIGHTING, type FigureScene, type IsoCamera } from './scene'

/** Draws figures into 2D canvases through the shared WebGL context. */
export interface FigurePainter {
  /**
   * Render `figure` with `camera` into `canvas` at its current pixel size (`canvas.width` ×
   * `canvas.height`). Returns false, drawing nothing, if the canvas has no size, it has no 2D
   * context, or the WebGL context is lost.
   */
  paint(canvas: HTMLCanvasElement, figure: FigureScene, camera: IsoCamera): boolean
  /** Calls `listener` whenever the shared context is restored after a loss (repaint then). */
  onRestored(listener: () => void): void
  /** Gives the shared context back; the last release destroys it. Idempotent. */
  release(): void
}

interface Shared {
  readonly renderer: WebGLRenderer
  readonly scene: Scene
  readonly group: Group
  readonly camera: OrthographicCamera
  readonly box: BoxGeometry
  readonly edges: EdgesGeometry
  readonly face: MeshLambertMaterial
  readonly edge: LineBasicMaterial
  readonly restored: Set<() => void>
  users: number
  lost: boolean
}

let shared: Shared | null = null

function create(): Shared {
  const canvas = document.createElement('canvas')
  // Throws "Error creating WebGL context." when WebGL is unavailable; the caller falls back to text.
  const renderer = new WebGLRenderer({ canvas, antialias: true, alpha: false, preserveDrawingBuffer: true, powerPreference: 'low-power' })
  renderer.setPixelRatio(1) // canvas sizes are already in device pixels
  renderer.setClearColor(LIGHTING.background, 1)

  const scene = new Scene()
  scene.add(new AmbientLight(0xffffff, Math.PI * LIGHTING.ambient))
  const sun = new DirectionalLight(0xffffff, Math.PI * LIGHTING.directional)
  const [lx, ly, lz] = LIGHTING.direction
  sun.position.set(lx, ly, lz) // target defaults to the origin: light travels along −direction
  scene.add(sun)
  const group = new Group()
  scene.add(group)

  const face = new MeshLambertMaterial({ color: LIGHTING.face })
  // Push faces back a little so the edges drawn at the same depth always win the depth test.
  face.polygonOffset = true
  face.polygonOffsetFactor = 1
  face.polygonOffsetUnits = 1
  const box = new BoxGeometry(1, 1, 1)
  const s: Shared = {
    renderer,
    scene,
    group,
    camera: new OrthographicCamera(-1, 1, 1, -1, 0.1, 10),
    box,
    edges: new EdgesGeometry(box),
    face,
    edge: new LineBasicMaterial({ color: LIGHTING.edge }),
    restored: new Set(),
    users: 0,
    lost: false,
  }
  // Three.js restores its own GL state on `webglcontextrestored`; we only need to repaint.
  canvas.addEventListener('webglcontextlost', () => {
    s.lost = true
  })
  canvas.addEventListener('webglcontextrestored', () => {
    s.lost = false
    for (const l of [...s.restored]) l()
  })
  return s
}

function destroy(s: Shared): void {
  s.group.clear()
  s.box.dispose()
  s.edges.dispose()
  s.face.dispose()
  s.edge.dispose()
  s.renderer.dispose()
  s.renderer.forceContextLoss()
  s.restored.clear()
}

function paintWith(s: Shared, canvas: HTMLCanvasElement, figure: FigureScene, cam: IsoCamera): boolean {
  const w = canvas.width
  const h = canvas.height
  if (s.lost || w === 0 || h === 0) return false
  const ctx = canvas.getContext('2d')
  if (!ctx) return false

  s.renderer.setSize(w, h, false)
  const aspect = w / h
  const e = cam.halfExtent
  const camera = s.camera
  camera.left = -e * Math.max(1, aspect)
  camera.right = e * Math.max(1, aspect)
  camera.top = e * Math.max(1, 1 / aspect)
  camera.bottom = -e * Math.max(1, 1 / aspect)
  camera.near = cam.near
  camera.far = cam.far
  camera.position.set(...cam.position)
  camera.up.set(...cam.up)
  camera.lookAt(...cam.lookAt)
  camera.updateProjectionMatrix()

  const group = s.group
  group.clear() // meshes share the geometry and materials, so nothing per cube needs disposing
  for (const [x, y, z] of figure.offsets) {
    const cube = new Mesh(s.box, s.face)
    cube.position.set(x, y, z)
    const outline = new LineSegments(s.edges, s.edge)
    outline.position.set(x, y, z)
    group.add(cube, outline)
  }
  group.quaternion.set(...figure.quaternionXyzw)

  s.renderer.render(s.scene, camera)
  ctx.drawImage(s.renderer.domElement, 0, 0, w, h)
  return true
}

/** Borrow the shared painter (creating the WebGL context on first use; throws without WebGL). */
export function acquirePainter(): FigurePainter {
  const s = shared ?? create()
  shared = s
  s.users++
  let released = false
  const mine = new Set<() => void>()
  return {
    paint: (canvas, figure, camera) => !released && paintWith(s, canvas, figure, camera),
    onRestored(listener) {
      mine.add(listener)
      s.restored.add(listener)
    },
    release() {
      if (released) return
      released = true
      for (const l of mine) s.restored.delete(l)
      s.users--
      if (s.users === 0) {
        destroy(s)
        if (shared === s) shared = null
      }
    },
  }
}

/** Live users of the shared context (tests and the dev gallery). */
export function sharedPainterUsers(): number {
  return shared?.users ?? 0
}
