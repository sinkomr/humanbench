/**
 * The polycube renderer without WebGL (ROADMAP M1.13; DESIGN §13): jsdom has no WebGL context, so
 * the real `three-view.ts` (and Three.js) loads and fails to create its renderer. The item must
 * then still render its text alternatives, say that the figures cannot be drawn here, report its
 * onset (so the session can move on), and stay operable.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { rotation } from '../../tasks/rotation'
import { mountInto, nextFrame, optionInputs, press, type Mounted } from '../dom-testing'
import { ROTATION_UNAVAILABLE, targetAlt } from './copy'
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
  it('shows the notice, keeps the text alternatives, reports the onset and still responds', async () => {
    const item = rotation.generate('rotation-fallback-1')
    const onrespond = vi.fn<(r: number) => void>()
    const onshown = vi.fn<(t: number) => void>()
    mounted = mountInto(RotationRenderer, { spec: item.spec, onrespond, onshown })
    await vi.waitFor(() => expect(mounted?.target.textContent).toContain(ROTATION_UNAVAILABLE), { timeout: 5000 })
    await nextFrame()
    await nextFrame()
    const root = mounted.target
    expect(root.querySelector('[role="status"]')?.textContent).toBe(ROTATION_UNAVAILABLE)
    expect(root.querySelector('[role="img"]')?.getAttribute('aria-label')).toBe(targetAlt(item.spec.target.cubes.length))
    expect(onshown).toHaveBeenCalledTimes(1)
    expect(sharedPainterUsers()).toBe(0)
    const inputs = optionInputs(root)
    inputs[1]?.focus()
    press(inputs[1] as HTMLInputElement, '1')
    press(document.activeElement as Element, 'Enter')
    expect(onrespond).toHaveBeenCalledExactlyOnceWith(0)
  })
})
