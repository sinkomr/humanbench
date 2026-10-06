/**
 * Compares the verify2 tour summaries (web/test-results/ux-review/verify2/tour-<project>/summary.json) with the wave-1
 * verify tours (web/test-results/ux-review/verify/tour-<project>/summary.json), state by state ('<width>-<scheme>'), and
 * lists what is new: a route that fails to open, sideways overflow, clipped text, a small target, a serious or critical
 * axe issue, a console or page error. WebKit has no wave-1 tour: its 1280-light states are set against Chromium's, and
 * only what is new there is listed (an engine difference is said to be one).
 *
 *   npx tsx ux-review/verify2-compare.ts            (from web/)
 *
 * Writes web/test-results/ux-review/verify2/tour-compare.json and prints the headline.
 */

import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import type { TourEntry } from './lib/tour'

const WEB = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const UX = path.join(WEB, 'test-results', 'ux-review')

function load(file: string): TourEntry[] {
  if (!existsSync(file)) return []
  return JSON.parse(readFileSync(file, 'utf8')) as TourEntry[]
}

/** A console line without the hashed asset names and the port, so the same message on two builds compares equal. */
const normalise = (s: string): string => s.replace(/https?:\/\/[^\s)]+/g, '<url>').replace(/-[A-Za-z0-9_-]{8}\.(js|css)/g, '.$1').trim()

interface StateDiff {
  readonly route: string
  readonly state: string
  readonly kind: 'route-failed' | 'overflow' | 'clipped' | 'small-target' | 'axe-serious' | 'console-error' | 'page-error' | 'failed-request'
  readonly now: string
  readonly before: string
}

interface Compared {
  readonly project: string
  readonly against: string
  readonly routes: number
  readonly routesOk: number
  readonly states: number
  readonly newProblems: StateDiff[]
  /** Problems of the wave-1 tour that are gone now (for the record). */
  readonly resolved: StateDiff[]
  /** Every console error seen now, by route (the expected THREE message on the no-WebGL route among them). */
  readonly consoleErrorsNow: Record<string, string[]>
  readonly axeSeriousNow: Record<string, string[]>
  readonly overflowNow: Record<string, number>
  readonly clippedNow: Record<string, string[]>
  readonly smallTargetsNow: Record<string, string[]>
  readonly headingChanges: Record<string, { before: string; now: string }>
}

function compare(project: string, against: string, map: (state: string) => string): Compared {
  const now = load(path.join(UX, 'verify2', `tour-${project}`, 'summary.json'))
  const old = load(path.join(UX, 'verify', `tour-${against}`, 'summary.json'))
  const byRoute = new Map(old.map((e) => [e.route, e]))
  const newProblems: StateDiff[] = []
  const resolved: StateDiff[] = []
  const consoleErrorsNow: Record<string, string[]> = {}
  const axeSeriousNow: Record<string, string[]> = {}
  const overflowNow: Record<string, number> = {}
  const clippedNow: Record<string, string[]> = {}
  const smallTargetsNow: Record<string, string[]> = {}
  const headingChanges: Record<string, { before: string; now: string }> = {}
  let states = 0
  for (const e of now) {
    const o = byRoute.get(e.route)
    if (!e.ok) {
      newProblems.push({ route: e.route, state: '*', kind: 'route-failed', now: (e.error ?? '').split('\n')[0] ?? '', before: o === undefined ? '(no wave-1 entry)' : o.ok ? 'ok' : (o.error ?? '').split('\n')[0] ?? '' })
      continue
    }
    if (o !== undefined && !o.ok) resolved.push({ route: e.route, state: '*', kind: 'route-failed', now: 'ok', before: (o.error ?? '').split('\n')[0] ?? '' })
    const errs = [...(e.console?.errors ?? []), ...(e.console?.pageErrors ?? [])].map(normalise)
    const oldErrs = new Set([...(o?.console?.errors ?? []), ...(o?.console?.pageErrors ?? [])].map(normalise))
    if (errs.length > 0) consoleErrorsNow[e.route] = errs
    for (const err of errs) if (!oldErrs.has(err)) newProblems.push({ route: e.route, state: '*', kind: 'console-error', now: err.slice(0, 200), before: '(not in wave 1)' })
    const failedNow = (e.console?.failed ?? []).map(normalise).filter((f) => !/favicon/.test(f))
    const failedOld = new Set((o?.console?.failed ?? []).map(normalise))
    for (const f of failedNow) if (!failedOld.has(f)) newProblems.push({ route: e.route, state: '*', kind: 'failed-request', now: f.slice(0, 200), before: '(not in wave 1)' })
    for (const [state, m] of Object.entries(e.metrics)) {
      states++
      const om = o?.metrics[map(state)]
      const key = `${e.route} ${state}`
      if (m.overflowX.px > 0) overflowNow[key] = m.overflowX.px
      if (m.overflowX.px > 0 && (om === undefined || om.overflowX.px <= 0)) newProblems.push({ route: e.route, state, kind: 'overflow', now: `${m.overflowX.px}px: ${m.overflowX.culprits.slice(0, 2).join(' | ')}`, before: om === undefined ? '(no wave-1 state)' : `${om.overflowX.px}px` })
      if (om !== undefined && om.overflowX.px > 0 && m.overflowX.px <= 0) resolved.push({ route: e.route, state, kind: 'overflow', now: '0', before: `${om.overflowX.px}px` })
      if (m.clipped.length > 0) clippedNow[key] = m.clipped
      const oldClipped = new Set(om?.clipped ?? [])
      for (const c of m.clipped) if (!oldClipped.has(c)) newProblems.push({ route: e.route, state, kind: 'clipped', now: c, before: om === undefined ? '(no wave-1 state)' : '(not clipped)' })
      const small = m.smallTargets.filter((t) => !t.inline).map((t) => `${t.role} "${t.name}" ${t.size.w}x${t.size.h} (<${t.under})`)
      if (small.length > 0) smallTargetsNow[key] = small
      const oldSmall = new Set((om?.smallTargets ?? []).filter((t) => !t.inline).map((t) => `${t.role} "${t.name}"`))
      for (const t of m.smallTargets.filter((t) => !t.inline)) {
        const id = `${t.role} "${t.name}"`
        if (!oldSmall.has(id)) newProblems.push({ route: e.route, state, kind: 'small-target', now: `${id} ${t.size.w}x${t.size.h} (<${t.under})`, before: om === undefined ? '(no wave-1 state)' : '(not small)' })
      }
      const axe = (m.axe?.serious ?? []).map((v) => `${v.id} x${v.nodes}`)
      if (axe.length > 0) axeSeriousNow[key] = axe
      const oldAxe = new Set((om?.axe?.serious ?? []).map((v) => v.id))
      for (const v of m.axe?.serious ?? []) if (!oldAxe.has(v.id)) newProblems.push({ route: e.route, state, kind: 'axe-serious', now: `${v.id} (${v.impact}) x${v.nodes}: ${v.targets.slice(0, 2).join(', ')}`, before: om === undefined ? '(no wave-1 state)' : om.axe === undefined ? '(wave 1 ran no axe)' : '(none)' })
      if (om !== undefined && om.h1 !== m.h1 && headingChanges[e.route] === undefined) headingChanges[e.route] = { before: om.h1, now: m.h1 }
    }
  }
  return { project, against, routes: now.length, routesOk: now.filter((e) => e.ok).length, states, newProblems, resolved, consoleErrorsNow, axeSeriousNow, overflowNow, clippedNow, smallTargetsNow, headingChanges }
}

const out = {
  compared: [
    compare('chromium', 'chromium', (s) => s),
    compare('iphone', 'iphone', (s) => s),
    // WebKit at 1280 light against Chromium's 1280 light (no wave-1 WebKit tour): only what is new there.
    compare('webkit', 'chromium', (s) => s),
  ],
}
const file = path.join(UX, 'verify2', 'tour-compare.json')
writeFileSync(file, JSON.stringify(out, null, 2))
for (const c of out.compared) {
  console.log(`${c.project} vs wave-1 ${c.against}: ${c.routesOk}/${c.routes} routes ok, ${c.states} states; new: ${c.newProblems.length}; resolved: ${c.resolved.length}`)
  for (const p of c.newProblems) console.log(`  NEW ${p.kind} ${p.route} ${p.state}: ${p.now}  [before: ${p.before}]`)
}
console.log(`written: ${path.relative(path.resolve(WEB, '..'), file)}`)
