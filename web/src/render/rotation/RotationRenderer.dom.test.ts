/**
 * Mental-rotation renderer in jsdom (ROADMAP M1.13, A3, A18; DESIGN §4.2 "Rendering", §11.6,
 * §13). jsdom has no WebGL, so `three-view.ts` is replaced by a recording painter: the tests check
 * what the component asks it to draw (the target and the options in display order, one shared
 * camera), the painter lifecycle (acquire on mount, release on destroy), text alternatives,
 * responding and the onset callback. The WebGL-less fallback is in `RotationFallback.dom.test.ts`,
 * the Three.js drawing itself in the e2e suite.
 */

import { afterEach, describe, expect, it, vi } from 'vitest'
import { rotation } from '../../tasks/rotation'
import { optionLetter } from '../choice/keys'
import { mountInto, nextFrame, optionInputs, press, stableHtml, type Mounted } from '../dom-testing'
import { ROTATION_STEM, ROTATION_UNAVAILABLE, optionAlt, targetAlt } from './copy'
import { rotationScene, type FigureScene, type IsoCamera } from './scene'
import RotationRenderer from './RotationRenderer.svelte'

interface PaintCall {
  readonly canvas: HTMLCanvasElement
  readonly figure: FigureScene
  readonly camera: IsoCamera
}

const painter = vi.hoisted(() => ({
  calls: [] as PaintCall[],
  acquired: 0,
  released: 0,
  restored: [] as (() => void)[],
}))

vi.mock('./three-view', () => ({
  acquirePainter: () => {
    painter.acquired++
    let released = false
    return {
      paint: (canvas: HTMLCanvasElement, figure: FigureScene, camera: IsoCamera) => {
        painter.calls.push({ canvas, figure, camera })
        return true
      },
      onRestored: (l: () => void) => painter.restored.push(l),
      release: () => {
        if (!released) painter.released++
        released = true
      },
    }
  },
}))

let mounted: Mounted | undefined
afterEach(() => {
  mounted?.destroy()
  mounted = undefined
  painter.calls.length = 0
  painter.restored.length = 0
  painter.acquired = 0
  painter.released = 0
})

/** Let the lazy import resolve and the draw frame run. */
async function settle(): Promise<void> {
  for (let i = 0; i < 3; i++) await nextFrame()
}

function render(seed: string, onshown?: (t: number) => void) {
  const item = rotation.generate(seed)
  const onrespond = vi.fn<(r: number) => void>()
  mounted = mountInto(RotationRenderer, { spec: item.spec, onrespond, ...(onshown ? { onshown } : {}) })
  return { item, onrespond, root: mounted.target }
}

describe('RotationRenderer', () => {
  it('matches the DOM snapshot of a fixed item', async () => {
    const { root } = render('snapshot-rotation-1')
    await settle()
    expect(stableHtml(root)).toMatchSnapshot()
  })

  it('names the target and the four options structurally (the cube count only), the same for every option', async () => {
    const { item, root } = render('rotation-dom-1')
    await settle()
    const n = item.spec.target.cubes.length
    expect(root.querySelector('.stem')?.textContent).toBe(ROTATION_STEM)
    const target = root.querySelector('[role="img"]')
    expect(target?.getAttribute('aria-label')).toBe(targetAlt(n))
    expect(target?.querySelector('canvas')?.textContent).toBe(targetAlt(n))
    const inputs = optionInputs(root)
    expect(inputs.map((x) => x.getAttribute('aria-label'))).toEqual([0, 1, 2, 3].map((i) => optionAlt(optionLetter(i), n)))
    // Canvas fallback content carries the same text alternative.
    const canvases = [...root.querySelectorAll('label canvas')]
    expect(canvases.map((c) => c.textContent)).toEqual([0, 1, 2, 3].map((i) => optionAlt(optionLetter(i), n)))
    expect(root.textContent).not.toContain(ROTATION_UNAVAILABLE)
  })

  it('draws the target and the options in display order, with one shared camera and scale', async () => {
    const { item, root } = render('rotation-dom-2')
    await settle()
    const expected = rotationScene(item.spec)
    const canvases = [root.querySelector('.target canvas'), ...root.querySelectorAll('label canvas')]
    // Every draw pass paints the five figures, target first, then options 0–3 in spec order.
    expect(painter.calls.length).toBeGreaterThanOrEqual(5)
    const pass = painter.calls.slice(-5)
    expect(pass.map((c) => c.canvas)).toEqual(canvases)
    expect(pass.map((c) => c.figure)).toEqual([expected.target, ...expected.options])
    for (const c of pass) expect(c.camera).toEqual(expected.camera)
  })

  it('acquires the shared painter once and releases it on destroy', async () => {
    render('rotation-dom-3')
    await settle()
    expect(painter.acquired).toBe(1)
    expect(painter.released).toBe(0)
    mounted?.destroy()
    mounted = undefined
    expect(painter.released).toBe(1)
  })

  it('redraws when the WebGL context is restored', async () => {
    render('rotation-dom-4')
    await settle()
    const before = painter.calls.length
    for (const l of painter.restored) l()
    await settle()
    expect(painter.calls.length).toBe(before + 5)
  })

  it('reports the onset once, after the figures were drawn, from an animation frame (§11.6)', async () => {
    const onshown = vi.fn<(t: number) => void>()
    render('rotation-dom-5', onshown)
    expect(onshown).not.toHaveBeenCalled()
    await settle()
    expect(onshown).toHaveBeenCalledTimes(1)
    expect(painter.calls.length).toBeGreaterThanOrEqual(5)
    for (const l of painter.restored) l()
    await settle()
    expect(onshown).toHaveBeenCalledTimes(1)
  })

  it('responds with the display position, which rotation.score() accepts and scores against the key', async () => {
    const { item, onrespond, root } = render('rotation-dom-6')
    await settle()
    const inputs = optionInputs(root)
    inputs[0]?.focus()
    press(inputs[0] as HTMLInputElement, 'd')
    expect(inputs[3]?.checked).toBe(true)
    press(document.activeElement as Element, 'Enter')
    expect(onrespond).toHaveBeenCalledExactlyOnceWith(3)
    expect(rotation.score(item, 3).correct).toBe(item.key.index === 3 ? 1 : 0)
    expect(() => press(document.activeElement as Element, '5')).not.toThrow()
  })
})
