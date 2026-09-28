/**
 * Mental-rotation renderer in jsdom (ROADMAP M1.13, A3, A18; DESIGN §4.2 "Rendering", §11.6,
 * §13). jsdom has no WebGL, so `three-view.ts` is replaced by a recording painter: the tests check
 * what the component asks it to draw (the target and the options in display order, one shared
 * camera), the painter lifecycle (acquire on mount, release on destroy), text alternatives,
 * responding (never before the figures are painted) and the onset callback (the timestamp of the
 * frame that painted them, never after a failed paint). The WebGL-less fallback is in
 * `RotationFallback.dom.test.ts`, the Three.js drawing itself in the e2e suite.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { rotation } from '../../tasks/rotation'
import { CONFIRM_LABEL, optionLetter } from '../choice/keys'
import { click, mountInto, optionInputs, press, settle, stableHtml, type Mounted } from '../dom-testing'
import { ROTATION_STEM, ROTATION_UNAVAILABLE, optionAlt, targetAlt } from './copy'
import { rotationScene, type FigureScene, type IsoCamera } from './scene'
import RotationRenderer from './RotationRenderer.svelte'

interface PaintCall {
  readonly canvas: HTMLCanvasElement
  readonly figure: FigureScene
  readonly camera: IsoCamera
  /** Timestamp of the animation frame callback the paint ran in (null: outside any frame). */
  readonly frame: number | null
  readonly ok: boolean
}

const painter = vi.hoisted(() => ({
  calls: [] as PaintCall[],
  acquired: 0,
  released: 0,
  restored: [] as (() => void)[],
  /** Whether painting into `canvas` succeeds (false: lost context, zero-size canvas …). */
  accept: (_canvas: HTMLCanvasElement): boolean => true,
  /** Timestamp of the animation frame callback running now (see beforeEach). */
  frame: null as number | null,
}))

vi.mock('./three-view', () => ({
  acquirePainter: () => {
    painter.acquired++
    let released = false
    return {
      paint: (canvas: HTMLCanvasElement, figure: FigureScene, camera: IsoCamera) => {
        const ok = painter.accept(canvas)
        painter.calls.push({ canvas, figure, camera, frame: painter.frame, ok })
        return ok
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

beforeEach(() => {
  // Record which animation frame each paint runs in, to pin the onset to the painting frame.
  const raf = globalThis.requestAnimationFrame.bind(globalThis)
  vi.spyOn(globalThis, 'requestAnimationFrame').mockImplementation((cb) =>
    raf((t) => {
      painter.frame = t
      try {
        cb(t)
      } finally {
        painter.frame = null
      }
    }),
  )
})

afterEach(() => {
  mounted?.destroy()
  mounted = undefined
  painter.calls.length = 0
  painter.restored.length = 0
  painter.acquired = 0
  painter.released = 0
  painter.accept = () => true
  vi.restoreAllMocks()
})

function render(seed: string, onshown?: (t: number) => void) {
  const item = rotation.generate(seed)
  const onrespond = vi.fn<(r: number) => void>()
  mounted = mountInto(RotationRenderer, { spec: item.spec, onrespond, ...(onshown ? { onshown } : {}) })
  return { item, onrespond, root: mounted.target }
}

const confirmButton = (root: HTMLElement): HTMLButtonElement => {
  const b = [...root.querySelectorAll('button')].find((x) => x.textContent?.trim() === CONFIRM_LABEL)
  if (!b) throw new Error('no confirm button')
  return b
}

/** Try every way of responding with option `i` (key, Enter, pointer, Confirm). */
function tryRespond(root: HTMLElement, i: number): void {
  const inputs = optionInputs(root)
  inputs[i]?.focus()
  press(inputs[i] as HTMLInputElement, String(i + 1))
  press(inputs[i] as HTMLInputElement, 'Enter')
  click(inputs[i] as HTMLInputElement)
  click(confirmButton(root))
}

const locked = (root: HTMLElement): boolean => optionInputs(root).every((x) => x.matches(':disabled')) && confirmButton(root).disabled

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

  it('reports the onset once, with the timestamp of the frame that painted all five figures (§11.6)', async () => {
    const seen: { t: number; calls: number; frame: number | null }[] = []
    const onshown = vi.fn<(t: number) => void>((t) => seen.push({ t, calls: painter.calls.length, frame: painter.frame }))
    render('rotation-dom-5', onshown)
    expect(onshown).not.toHaveBeenCalled()
    await settle()
    expect(onshown).toHaveBeenCalledTimes(1)
    // Called inside the painting frame's callback, after its five paints, with that frame's timestamp.
    const [first] = seen
    const pass = painter.calls.slice(0, first?.calls)
    expect(pass).toHaveLength(5)
    expect(new Set(pass.map((c) => c.frame)).size).toBe(1)
    expect(first?.frame).toBe(pass[0]?.frame)
    expect(first?.t).toBe(pass[0]?.frame)
    for (const l of painter.restored) l()
    await settle()
    expect(onshown).toHaveBeenCalledTimes(1)
  })

  it('accepts no response before the figures are painted (the lazy load is still pending at mount)', async () => {
    const onshown = vi.fn<(t: number) => void>()
    const { onrespond, root } = render('rotation-dom-7', onshown)
    expect(painter.calls).toHaveLength(0)
    expect(locked(root)).toBe(true)
    tryRespond(root, 1)
    expect(optionInputs(root).some((x) => x.checked)).toBe(false)
    expect(onrespond).not.toHaveBeenCalled()
    await settle()
    expect(onshown).toHaveBeenCalledTimes(1)
    expect(locked(root)).toBe(false)
    tryRespond(root, 1)
    expect(onrespond).toHaveBeenCalledExactlyOnceWith(1)
  })

  for (const [what, accept] of [
    ['every paint fails', () => false],
    ['only the target fails to paint', (c: HTMLCanvasElement) => !c.closest('.target')],
    ['only the last option fails to paint', (c: HTMLCanvasElement) => c !== [...document.querySelectorAll('label canvas')].at(-1)],
  ] as const) {
    it(`reports no onset and stays locked while a draw pass fails (${what}); the first full pass unlocks it`, async () => {
      painter.accept = accept
      const onshown = vi.fn<(t: number) => void>()
      const { onrespond, root } = render(`rotation-dom-8-${what}`, onshown)
      await settle()
      expect(painter.calls.length).toBeGreaterThanOrEqual(5) // it tried
      expect(painter.calls.some((c) => !c.ok)).toBe(true)
      expect(onshown).not.toHaveBeenCalled()
      expect(locked(root)).toBe(true)
      tryRespond(root, 2)
      expect(onrespond).not.toHaveBeenCalled()
      // The WebGL context comes back: the redraw succeeds, and that pass reports the onset.
      painter.accept = () => true
      for (const l of painter.restored) l()
      await settle()
      expect(onshown).toHaveBeenCalledTimes(1)
      const okFrame = painter.calls.at(-1)?.frame
      expect(onshown).toHaveBeenCalledWith(okFrame)
      expect(locked(root)).toBe(false)
      tryRespond(root, 2)
      expect(onrespond).toHaveBeenCalledExactlyOnceWith(2)
    })
  }

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
