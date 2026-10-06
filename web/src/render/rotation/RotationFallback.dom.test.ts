/**
 * The polycube renderer without WebGL (ROADMAP M1.13; DESIGN §13): jsdom has no WebGL context, so
 * the real `three-view.ts` (and Three.js) loads and fails to create its renderer. The renderer must
 * then draw nothing but a one-line note that the figures cannot be drawn here (no empty frames, no
 * options, no Confirm; UX-017b); it must NOT report an onset (nothing was shown) or accept a
 * response (a guess would be scored), and it reports `onunavailable()` once instead, so the session
 * can offer skipping (§13). While the chunk loads, the target box says so.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { rotation } from '../../tasks/rotation'
import { mountInto, optionInputs, press, settle, type Mounted } from '../dom-testing'
import { ROTATION_LOADING, ROTATION_UNAVAILABLE } from './copy'
import RotationRenderer from './RotationRenderer.svelte'
import { sharedPainterUsers } from './three-view'

let mounted: Mounted | undefined

beforeEach(() => {
  // jsdom logs "not implemented" for getContext; a browser without WebGL returns null.
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(null)
  // Three.js reports the failed context on console.error; keep the test output clean.
  vi.spyOn(console, 'error').mockImplementation(() => {})
})

afterEach(() => {
  mounted?.destroy()
  mounted = undefined
  vi.restoreAllMocks()
})

describe('RotationRenderer without WebGL', () => {
  it('shows only a one-line note (no frames, no options, no Confirm), reports unavailable once and never an onset', async () => {
    const item = rotation.generate('rotation-fallback-1')
    const onrespond = vi.fn<(r: number) => void>()
    const onshown = vi.fn<(t: number) => void>()
    const onunavailable = vi.fn<() => void>()
    mounted = mountInto(RotationRenderer, { spec: item.spec, onrespond, onshown, onunavailable })
    await vi.waitFor(() => expect(mounted?.target.textContent).toContain(ROTATION_UNAVAILABLE), { timeout: 5000 })
    await settle()
    const root = mounted.target
    expect(root.querySelector('[role="status"]')?.textContent).toBe(ROTATION_UNAVAILABLE)
    // Nothing else of the item is drawn: no target frame, no canvas, no option, no Confirm, no stem.
    expect(root.querySelector('[role="img"]')).toBeNull()
    expect(root.querySelector('canvas')).toBeNull()
    expect(root.querySelector('form')).toBeNull()
    expect(optionInputs(root)).toHaveLength(0)
    expect(root.querySelectorAll('button')).toHaveLength(0)
    expect(root.textContent?.trim()).toBe(ROTATION_UNAVAILABLE)
    expect(onunavailable).toHaveBeenCalledTimes(1)
    expect(onshown).not.toHaveBeenCalled()
    expect(sharedPainterUsers()).toBe(0)
    // And nothing can answer it: a key or Enter anywhere reaches no response.
    press(root, '2')
    press(root, 'Enter')
    expect(onrespond).not.toHaveBeenCalled()
    await settle()
    expect(onunavailable).toHaveBeenCalledTimes(1)
    expect(onshown).not.toHaveBeenCalled()
  })

  it('the loading line is gone and the frames with it once the browser has said it cannot draw', async () => {
    const item = rotation.generate('rotation-fallback-2')
    mounted = mountInto(RotationRenderer, { spec: item.spec, onrespond: vi.fn() })
    await vi.waitFor(() => expect(mounted?.target.textContent).toContain(ROTATION_UNAVAILABLE), { timeout: 5000 })
    expect(mounted.target.textContent).not.toContain(ROTATION_LOADING)
  })
})

describe('RotationRenderer while the figures load', () => {
  it('says so in the target box, keeps the options locked, and reports no onset yet', () => {
    const item = rotation.generate('rotation-loading-1')
    const onshown = vi.fn<(t: number) => void>()
    const onunavailable = vi.fn<() => void>()
    mounted = mountInto(RotationRenderer, { spec: item.spec, onrespond: vi.fn(), onshown, onunavailable })
    const root = mounted.target
    // Straight after the mount the three-view chunk has not arrived: the frames are there and say why they are empty.
    const frame = root.querySelector('.frame')
    expect(frame?.querySelector('.loading')?.textContent).toBe(ROTATION_LOADING)
    expect(ROTATION_LOADING).toBe('Loading figures…')
    expect(optionInputs(root)).toHaveLength(4)
    expect(optionInputs(root).every((x) => x.matches(':disabled'))).toBe(true)
    expect(onshown).not.toHaveBeenCalled()
    expect(onunavailable).not.toHaveBeenCalled()
  })
})
