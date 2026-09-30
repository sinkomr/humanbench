/**
 * A finished simulated session (or two, a week apart) as a save file, for the reveal's Playwright
 * suite (ROADMAP M1.R; `e2e/reveal.spec.ts`). The browser suite cannot drive a full 25-minute
 * session, so it loads this save on the ready screen and finishes at once: the results then show a
 * rich profile from real families, selector, scorer and save library (the same `botSave` the jsdom
 * tests use). Deterministic (fixed seeds and times).
 *
 *   npx tsx scripts/e2e-save.ts [--sessions 1|2]
 *
 * Prints one JSON object to stdout: `{ save, peaks, measured }`, where `peaks` and `measured` are
 * what the results model computes from the save (the suite checks that the page shows them).
 */

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

const results = buildResults(last.save)
if (results === null) throw new Error('the simulated session measured nothing')
const measured = axisEstimates(results.input).filter((e) => e.measured)
const peaks = distinctivePeaks(results.rescore, measured.map((e) => e.code))
// The suite checks the peaks list, so the person must have one (a single session rarely gives more).
if (peaks.length === 0) throw new Error('the simulated person has no credible peak: change the levels')
process.stdout.write(JSON.stringify({ save: last.save, peaks: peaks.map((p) => p.name), measured: measured.map((e) => e.name) }))
