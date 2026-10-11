/**
 * A finished simulated session (or two, a week apart) as a save file, for the reveal's Playwright
 * suite (ROADMAP M1.R; `e2e/reveal.spec.ts`). The browser suite cannot drive a full 25-minute
 * session, so it loads this save on the ready screen and finishes at once: the results then show a
 * rich profile from real families, selector, scorer and save library (the same `botSave` the jsdom
 * tests use). Deterministic (fixed seeds and times).
 *
 *   npx tsx scripts/e2e-save.ts [--sessions 1|2] [--rt touch|keyboard]
 *
 * `--rt` rewrites every reaction-time block of the save as one given with that input type (stored
 * in the block's `extra.input_type`, as the session does) whose median is exactly that input's own
 * reference (`rt/prior.ts`): the reveal must then read 0 SD on the RT axis, and compare the median
 * with that input's reference, whichever the input (UX-REVIEW D3, owner decision 2026-10-11).
 *
 * Prints one JSON object to stdout: `{ save, peaks, measured }`, where `peaks` and `measured` are
 * what the results model computes from the save (the suite checks that the page shows them).
 */

import type { ResponseTuple } from '../src/engine/types'
import type { SaveFileV1 } from '../src/save/types'
import { resolveItem } from '../src/tasks/registry'
import { RT_TOUCH_NORMS, RT_WEB_NORMS, type RtMode } from '../src/tasks/rt'
import { axisEstimates } from '../src/viz/profile'
import { distinctivePeaks } from '../src/reveal/peaks'
import { buildResults } from '../src/reveal/results'
import { DAY_MS, T0_MS, botSave } from '../src/reveal/test-support'

const sessions = process.argv.includes('--sessions') ? Number(process.argv[process.argv.indexOf('--sessions') + 1]) : 1
if (sessions !== 1 && sessions !== 2) throw new Error('--sessions must be 1 or 2')

// A jagged simulated person: strong on matrices, spatial well above the rest, a little below elsewhere.
const level = { MAT: 3, SPA: 0.2, QR: -0.5, WM: -0.4, RT: -0.3, PS: -0.3, CAL: 0 } as const
const first = botSave('s_E2ERICH00000001', { level, seed: 'e2e-rich-1' })
const last = sessions === 1 ? first : botSave('s_E2ERICH00000002', { level, seed: 'e2e-rich-2', base: first.save, startedMs: T0_MS + 8 * DAY_MS })

const rtArg = process.argv.includes('--rt') ? process.argv[process.argv.indexOf('--rt') + 1] : undefined
if (rtArg !== undefined && rtArg !== 'touch' && rtArg !== 'keyboard') throw new Error('--rt must be touch or keyboard')

/** Every RT block of the save, given with `input` and a median exactly at that input's own reference. */
function atReference(save: SaveFileV1, input: 'touch' | 'keyboard'): SaveFileV1 {
  const norms = input === 'touch' ? RT_TOUCH_NORMS : RT_WEB_NORMS
  const rewrite = (t: ResponseTuple): ResponseTuple => {
    const mode: RtMode | null = t[0].startsWith('i:rt_simple:') ? 'simple' : t[0].startsWith('i:rt_choice4:') ? 'choice4' : null
    if (mode === null) return t
    const item = resolveItem(t[0]) as { key: { positions: number[] } } | null
    if (item === null) throw new Error(`cannot regenerate ${t[0]}`)
    const n = item.key.positions.length
    // Half the trials faster and half slower than the reference, so the median log-RT is exactly its ln.
    const rt_ms = item.key.positions.map((_, i) => norms[mode].median_rt_ms * Math.exp(0.012 * (i < n / 2 ? -(n / 2 - i) : i - n / 2 + 1)))
    const response = { ...(t[2] as Record<string, unknown>), rt_ms, choice: [...item.key.positions] }
    return [t[0], t[1], response as never, t[3], t[4], t[5], { ...((t[6] ?? {}) as Record<string, unknown>), input_type: input } as never]
  }
  return { ...save, sessions: save.sessions.map((s) => ({ ...s, responses: s.responses.map(rewrite) })) }
}
const saved = rtArg === undefined ? last.save : atReference(last.save, rtArg)

const results = buildResults(saved)
if (results === null) throw new Error('the simulated session measured nothing')
const measured = axisEstimates(results.input).filter((e) => e.measured)
const peaks = distinctivePeaks(results.rescore, measured.map((e) => e.code))
// The suite checks the peaks list, so the person must have one (a single session rarely gives more).
if (peaks.length === 0) throw new Error('the simulated person has no credible peak: change the levels')
process.stdout.write(JSON.stringify({ save: saved, peaks: peaks.map((p) => p.name), measured: measured.map((e) => e.name) }))
