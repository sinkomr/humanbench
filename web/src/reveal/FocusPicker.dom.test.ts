/**
 * The focus picker follows its options (ROADMAP M1.R review): the ticked suggestions belong to the
 * ranges shown, so when another save is loaded on the start screen (or the results change) the
 * picker starts afresh rather than keeping the ticks of the earlier options.
 */

import { flushSync } from 'svelte'
import { afterEach, describe, expect, it } from 'vitest'
import { render } from '../render/common/testing'
import { axisEstimates, type AxisEstimate } from '../viz/profile'
import RetestSection from './RetestSection.svelte'
import { reactiveProps } from './reactive.svelte'
import { buildResults } from './results'
import { botSave } from './test-support'

let cleanup: (() => void) | undefined
afterEach(() => {
  cleanup?.()
  cleanup = undefined
  document.body.innerHTML = ''
})

/** The person's estimates with these skills made the widest (the fuzziest are the suggested parts). */
function widest(base: readonly AxisEstimate[], codes: readonly string[]): AxisEstimate[] {
  return base.map((e) => (e.measured && e.sd !== undefined && e.theta !== undefined ? { ...e, sd: codes.includes(e.code) ? 1.5 : 0.2, lo90: e.theta - (codes.includes(e.code) ? 2.4 : 0.3), hi90: e.theta + (codes.includes(e.code) ? 2.4 : 0.3) } : e))
}

const ticked = (c: HTMLElement): string[] =>
  [...c.querySelectorAll<HTMLInputElement>('input[type="checkbox"]')].filter((b) => b.checked).map((b) => b.id.split('-').pop()!)

describe('FocusPicker inside the retest section', () => {
  it('re-ticks the suggested parts when the options change, and keeps the person’s ticks while they do not', () => {
    const base = axisEstimates(buildResults(botSave('s_FOCUSKEY00000001', { level: 0.5 }).save)!.input)
    const props = reactiveProps({ estimates: widest(base, ['MAT', 'SPA', 'WM']), sessions: 1, onfocus: () => undefined, focusLocked: false })
    const r = render(RetestSection, props)
    cleanup = r.destroy
    expect(ticked(r.container).sort()).toEqual(['matrix_series', 'memory', 'spatial'])
    // The person adds a part: unrelated updates leave it alone.
    r.container.querySelector<HTMLInputElement>('input[id$="quant"]')!.click()
    flushSync()
    expect(ticked(r.container).sort()).toEqual(['matrix_series', 'memory', 'quant', 'spatial'])
    props.sessions = 2
    flushSync()
    expect(ticked(r.container).sort()).toEqual(['matrix_series', 'memory', 'quant', 'spatial'])
    // Different ranges (another save): the suggestions follow them, and the earlier ticks are dropped.
    props.estimates = widest(base, ['QR', 'PS', 'RT'])
    flushSync()
    expect(ticked(r.container).sort()).toEqual(['coding_reading', 'quant', 'rt'])
  })
})
