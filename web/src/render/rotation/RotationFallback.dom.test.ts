/**
 * The polycube renderer without WebGL (ROADMAP M1.13; DESIGN §13): jsdom has no WebGL context, so
 * the real `three-view.ts` (and Three.js) loads and fails to create its renderer. The item must
 * then still render its text alternatives and say that the figures cannot be drawn here; it must
 * NOT report an onset (nothing was shown) or accept a response (a guess would be scored), and it
 * reports `onunavailable()` once instead, so the session can offer skipping (§13).
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { rotation } from '../../tasks/rotation'
import { CONFIRM_LABEL } from '../choice/keys'
import { click, mountInto, optionInputs, press, settle, type Mounted } from '../dom-testing'
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
  it('shows the notice and the text alternatives, reports unavailable (not an onset) and accepts no response', async () => {
    const item = rotation.generate('rotation-fallback-1')
    const onrespond = vi.fn<(r: number) => void>()
    const onshown = vi.fn<(t: number) => void>()
    const onunavailable = vi.fn<() => void>()
    mounted = mountInto(RotationRenderer, { spec: item.spec, onrespond, onshown, onunavailable })
    await vi.waitFor(() => expect(mounted?.target.textContent).toContain(ROTATION_UNAVAILABLE), { timeout: 5000 })
    await settle()
    const root = mounted.target
    expect(root.querySelector('[role="status"]')?.textContent).toBe(ROTATION_UNAVAILABLE)
    expect(root.querySelector('[role="img"]')?.getAttribute('aria-label')).toBe(targetAlt(item.spec.target.cubes.length))
    expect(onunavailable).toHaveBeenCalledTimes(1)
    expect(onshown).not.toHaveBeenCalled()
    expect(sharedPainterUsers()).toBe(0)
    // Locked: no key, Enter, click or Confirm gets a response through.
    const inputs = optionInputs(root)
    const confirm = [...root.querySelectorAll('button')].find((b) => b.textContent?.trim() === CONFIRM_LABEL) as HTMLButtonElement
    expect(inputs.every((x) => x.matches(':disabled'))).toBe(true)
    expect(confirm.disabled).toBe(true)
    inputs[1]?.focus()
    press(inputs[1] as HTMLInputElement, '1')
    press(inputs[1] as HTMLInputElement, 'Enter')
    click(inputs[0] as HTMLInputElement)
    click(confirm)
    expect(inputs.some((x) => x.checked)).toBe(false)
    expect(onrespond).not.toHaveBeenCalled()
    await settle()
    expect(onunavailable).toHaveBeenCalledTimes(1)
    expect(onshown).not.toHaveBeenCalled()
  })
})
