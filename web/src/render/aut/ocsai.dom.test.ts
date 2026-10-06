/**
 * The consent of the optional outside scoring service (ROADMAP M6.4; DESIGN §5.4, §8). With the flag off, which is every
 * build, the component draws one notice and no control. The opt-in flow behind the flag is tested with the flag overridden
 * by a prop: it says what would be sent, its one box starts unticked, and the choice is only reported, never acted on.
 */

import { afterEach, describe, expect, it, vi } from 'vitest'
import { OCSAI_COPY } from '../../tasks/aut/copy'
import { OCSAI_ENABLED } from '../../tasks/aut/ocsai'
import { click, render } from '../common/testing'
import OcsaiConsent from './OcsaiConsent.svelte'

let cleanup: (() => void)[] = []
afterEach(() => {
  for (const f of cleanup) f()
  cleanup = []
  vi.restoreAllMocks()
})

function mountConsent(props: Record<string, unknown> = {}) {
  const r = render(OcsaiConsent, props)
  cleanup.push(r.destroy)
  return r
}

describe('OcsaiConsent with the service off (every build)', () => {
  it('is the constant false that decides it', () => {
    expect(OCSAI_ENABLED).toBe(false)
  })

  it('shows only the short notice: no toggle, no checkbox, no button, no disabled control', () => {
    const { container } = mountConsent()
    expect(container.textContent?.trim()).toBe('An optional outside scoring service may be offered later. It is off, and nothing is sent.')
    expect(container.textContent?.trim()).toBe(OCSAI_COPY.off)
    expect(container.querySelectorAll('input, button, select, textarea, [role="switch"], [role="checkbox"], [disabled], [aria-disabled]')).toHaveLength(0)
    expect(container.querySelector('[data-testid="ocsai-note"]')).not.toBeNull()
    expect(container.querySelector('[data-testid="ocsai-consent"]')).toBeNull()
  })

  it('shows the same notice whatever it is given', () => {
    const { container } = mountConsent({ object: 'brick', responses: ['doorstop'], consent: 'on' })
    expect(container.textContent?.trim()).toBe(OCSAI_COPY.off)
    expect(container.querySelectorAll('input, button')).toHaveLength(0)
  })

  it('sends nothing', () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch')
    mountConsent({ object: 'brick', responses: ['doorstop'] })
    expect(fetchSpy).not.toHaveBeenCalled()
  })
})

describe('OcsaiConsent with the flag overridden by the prop (the opt-in flow, never reachable in a build)', () => {
  it('says what would be sent, lists the object and the ideas, and has one box, unticked', () => {
    const { container } = mountConsent({ enabled: true, object: 'brick', responses: ['doorstop', 'bookend'] })
    const group = container.querySelector('[role="group"]') as HTMLElement
    expect(group.getAttribute('aria-labelledby')).toBe(group.querySelector('.title')?.id)
    expect(group.textContent).toContain(OCSAI_COPY.sent)
    expect([...container.querySelectorAll('.payload .item')].map((e) => e.textContent)).toEqual(['brick', 'doorstop', 'bookend'])
    const boxes = container.querySelectorAll<HTMLInputElement>('input')
    expect(boxes).toHaveLength(1)
    expect(boxes[0]?.type).toBe('checkbox')
    expect(boxes[0]?.checked).toBe(false)
    expect(boxes[0]?.closest('label')?.textContent?.trim()).toBe(OCSAI_COPY.checkbox)
    expect(container.querySelectorAll('button')).toHaveLength(0)
    expect(container.textContent).not.toContain(OCSAI_COPY.off)
    expect(container.textContent).toContain(OCSAI_COPY.none)
  })

  it('reports the choice when the box is ticked and unticked, and starts from off', () => {
    const seen: string[] = []
    const { container } = mountConsent({ enabled: true, onconsent: (c: string) => seen.push(c) })
    const box = container.querySelector('input') as HTMLInputElement
    click(box)
    expect(box.checked).toBe(true)
    click(box)
    expect(box.checked).toBe(false)
    expect(seen).toEqual(['on', 'off'])
  })

  it('shows a box that is already ticked when the consent says so', () => {
    const { container } = mountConsent({ enabled: true, consent: 'on' })
    expect((container.querySelector('input') as HTMLInputElement).checked).toBe(true)
  })

  it('still sends nothing: it only reports the choice', () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch')
    const { container } = mountConsent({ enabled: true, object: 'brick', responses: ['doorstop'] })
    click(container.querySelector('input'))
    expect(fetchSpy).not.toHaveBeenCalled()
  })
})
