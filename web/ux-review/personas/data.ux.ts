/// <reference lib="dom" />
/**
 * Persona "rev-data": Dr Kim, a quantitative researcher who reads every caption and checks whether the chart is
 * honest and whether the numbers agree with each other (DESIGN §7.3, §7.6, §7.8, §9, §10; ROADMAP A7, A12).
 *
 * The heart of it is an evaluator that reads the DRAWN SVG (page blob, facet sub-blob, share card preview and the
 * exported SVG) and checks it against the numbers in the data table: every marker at R·(θ + 3)/6, whiskers at the
 * 90% interval, the crisp curve through the markers, the ±1 SD band and the §9.3 fuzz at the right radii, muting,
 * not-measured stubs, rings, glyphs and hatching. Measurements land in JSON next to the screenshots.
 *
 *   UX_PORT=4616 UX_RUN=data npx playwright test -c ux-review/playwright.ux.config.ts ux-review/personas/data.ux.ts --project=chromium --grep 'data: results 1'
 *
 * Tests (one --grep each): 'data: results 1', 'data: results 2', 'data: dev blob', 'data: journey', 'data: tour',
 * 'data: phone'. Output: web/test-results/ux-review/<UX_RUN>/<test>-<project>/.
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { expect, test, type Page } from '@playwright/test'
import { button, scheme, toResults } from '../../e2e/flow'
import { playJourney, REPO_ROOT, Shots, tour, trackConsole, UX_ROOT } from '../lib'

const RUN = process.env.UX_RUN ?? 'data'

// ------------------------------------------------------------------------------------------- types

interface TableRow {
  readonly id: string
  readonly name: string
  readonly glyph: string
  readonly group: string
  readonly measured: boolean
  readonly stub: string
  readonly theta: number | null
  readonly sd: number | null
  readonly lo: number | null
  readonly hi: number | null
  readonly relation: string
  readonly rowMuted: boolean
  /** Lollipop (bar view) positions in its own viewBox. */
  readonly lolli: { dot: number; x1: number; x2: number; zero: number; t1: number; t2: number } | null
}

interface SpokeCheck {
  readonly i: number
  readonly id: string
  readonly angleDeg: number
  readonly label: string
  readonly labelClass: string
  readonly measured: boolean
  readonly muted: boolean
  readonly spokeDash: string
  readonly markerR?: number
  readonly expectedR?: number
  readonly markerErrPx?: number
  readonly loErrPx?: number
  readonly hiErrPx?: number
  readonly curveToMarkerPx?: number
  readonly band?: Record<string, boolean>
  readonly fuzz?: Record<string, boolean>
  readonly dipToCurvePx?: number
  readonly bandAtHalfR?: boolean
  readonly fuzzAtHalfR?: boolean
  readonly stubLen?: number
  readonly gapR?: number
  readonly clampedLo?: boolean
  readonly clampedHi?: boolean
}

interface BlobCheck {
  readonly found: boolean
  readonly error?: string
  readonly pxPerUnit: number
  readonly R: number
  readonly rings: { r: number; expected: number; reference: boolean; dash: string }[]
  readonly ringLabels: string[]
  readonly ringNote: string
  readonly title: string
  readonly desc: string
  readonly order: string[]
  readonly spokes: SpokeCheck[]
  readonly crispMutedSpokes: string
  readonly nFuzz: number
  readonly fuzzOpacities: number[]
  readonly nHatch: number
  readonly hatchAngles: number[]
  readonly maxOvershootRings: number
  readonly overshootAt: string
  /** The crisp curve's path data and its §9.2 kind (data-curve), for the per-segment overshoot check in Node. */
  readonly crispD: string
  readonly curveKind: string
  readonly minTextPx: number
  readonly minTextWhat: string
  readonly colours: Record<string, string>
  /** Sample points (client px, relative to the svg's box) for the band legibility check. */
  readonly samples: { id: string; where: string; x: number; y: number }[]
}

// --------------------------------------------------------------------------------- page functions

/** Reads a BarTable (data table + lollipops). Runs in the page. */
function readTable(sel: string): TableRow[] {
  const num = (s: string): number => Number(s.replace(/−/g, '-').replace(/^\+/, '').trim())
  const table = document.querySelector(sel)
  if (table === null) return []
  return [...table.querySelectorAll('tbody tr[data-row]')].map((tr): TableRow => {
    const th = tr.querySelector('th')!
    const name = (th.firstChild?.textContent ?? '').replace(/​/g, '').trim()
    const glyph = (th.querySelector('.glyph')?.textContent ?? '').replace(/ /g, '').trim()
    const tds = [...tr.querySelectorAll('td')]
    const group = (tds[0]?.textContent ?? '').replace(/​/g, '').trim()
    const id = tr.getAttribute('data-row') ?? ''
    const rowMuted = tr.classList.contains('muted')
    const stubCell = tr.querySelector('td.stub')
    if (stubCell !== null) {
      return { id, name, glyph, group, measured: false, stub: (stubCell.textContent ?? '').trim(), theta: null, sd: null, lo: null, hi: null, relation: '', rowMuted, lolli: null }
    }
    const est = /([+−-]?\d+\.\d+)\s*\(SD\s*(\d+\.\d+)\)/.exec(tds[1]?.textContent ?? '')
    const iv = /([+−-]?\d+\.\d+)\s*to\s*([+−-]?\d+\.\d+)/.exec(tds[2]?.textContent ?? '')
    const svg = tds[2]?.querySelector('svg.lollipop')
    const attr = (q: string, a: string): number => Number(svg?.querySelector(q)?.getAttribute(a) ?? NaN)
    return {
      id,
      name,
      glyph,
      group,
      measured: true,
      stub: '',
      theta: est ? num(est[1]!) : null,
      sd: est ? num(est[2]!) : null,
      lo: iv ? num(iv[1]!) : null,
      hi: iv ? num(iv[2]!) : null,
      relation: (tds[3]?.textContent ?? '').replace(/\u00a0/g, ' ').trim(),
      rowMuted,
      lolli: svg ? { dot: attr('circle.dot', 'cx'), x1: attr('line.range', 'x1'), x2: attr('line.range', 'x2'), zero: attr('line.zero', 'x1'), t1: attr('line.track', 'x1'), t2: attr('line.track', 'x2') } : null,
    }
  })
}

interface EvalArg {
  readonly sel: string | null
  readonly svgText: string | null
  readonly rows: TableRow[]
  /** Ids of the marks in order, when the marks carry no data-spoke (the share card). */
  readonly ids: string[] | null
}

/** Reads a drawn blob and checks it against the table rows. Runs in the page. */
function evalBlob(arg: EvalArg): BlobCheck {
  const empty = (error: string): BlobCheck => ({
    found: false,
    error,
    pxPerUnit: 0,
    R: 0,
    rings: [],
    ringLabels: [],
    ringNote: '',
    title: '',
    desc: '',
    order: [],
    spokes: [],
    crispMutedSpokes: '',
    nFuzz: 0,
    fuzzOpacities: [],
    nHatch: 0,
    hatchAngles: [],
    maxOvershootRings: 0,
    overshootAt: '',
    crispD: '',
    curveKind: '',
    minTextPx: 0,
    minTextWhat: '',
    colours: {},
    samples: [],
  })
  let host: HTMLDivElement | null = null
  let svg: SVGSVGElement | null
  if (arg.svgText !== null) {
    host = document.createElement('div')
    host.style.cssText = 'position:absolute;left:0;top:0;width:1200px;height:630px;opacity:0.001;pointer-events:none;z-index:-1'
    host.innerHTML = arg.svgText.replace(/^<\?xml[^>]*>\s*/, '')
    document.body.appendChild(host)
    svg = host.querySelector('svg')
  } else svg = arg.sel === null ? null : document.querySelector<SVGSVGElement>(arg.sel)
  try {
    if (svg === null) return empty(`no svg at ${arg.sel}`)
    const rowsById = new Map(arg.rows.map((r) => [r.id, r]))
    const spokeLines = [...svg.querySelectorAll<SVGLineElement>('line.spoke')]
    const marks = [...svg.querySelectorAll<SVGGElement>('g.mark')]
    const labels = [...svg.querySelectorAll<SVGTextElement>('text.label')]
    if (spokeLines.length === 0) return empty('no spokes')
    const n = (el: Element | null, a: string): number => Number(el?.getAttribute(a) ?? NaN)
    const first = spokeLines[0]!
    const ctm = first.getCTM()
    const pxPerUnit = ctm === null ? NaN : Math.hypot(ctm.a, ctm.b)
    const R = Math.hypot(n(first, 'x2'), n(first, 'y2'))
    const ringUnit = R / 6
    const expectedR = (t: number): number => Math.min(R, Math.max(0.04 * R, (R * (t + 3)) / 6))
    const rings = [...svg.querySelectorAll<SVGCircleElement>('circle.ring')]
      .map((c) => ({ r: n(c, 'r'), reference: c.classList.contains('reference'), dash: getComputedStyle(c).strokeDasharray }))
      .sort((a, b) => a.r - b.r)
      .map((c, i) => ({ ...c, expected: expectedR(i - 2) }))
    const crisp = svg.querySelector<SVGPathElement>('path.crisp')
    const band = svg.querySelector<SVGPathElement>('path.band')
    const fuzz = [...svg.querySelectorAll<SVGPathElement>('g.fuzz path')]
    const pts: [number, number][] = []
    if (crisp !== null) {
      const total = crisp.getTotalLength()
      for (let s = 0; s <= total; s += 0.25) {
        const p = crisp.getPointAtLength(s)
        pts.push([p.x, p.y])
      }
    }
    const minDist = (x: number, y: number): number => pts.reduce((m, p) => Math.min(m, Math.hypot(p[0] - x, p[1] - y)), Infinity)
    const polar = (r: number, a: number): [number, number] => [r * Math.sin(a), -r * Math.cos(a)]
    const inFill = (el: SVGGeometryElement | null, xy: [number, number]): boolean => {
      if (el === null) return false
      const p = svg!.createSVGPoint()
      p.x = xy[0]
      p.y = xy[1]
      return el.isPointInFill(p)
    }
    const inAnyFuzz = (xy: [number, number]): boolean => fuzz.some((f) => inFill(f, xy))
    const angleOf = (x: number, y: number): number => {
      const a = Math.atan2(x, -y)
      return a < 0 ? a + 2 * Math.PI : a
    }
    const ids = marks.map((m, i) => m.getAttribute('data-spoke') ?? arg.ids?.[i] ?? `#${i}`)
    const k = spokeLines.length
    const drawnR: number[] = []
    const samples: BlobCheck['samples'] = []
    const box = svg.getBoundingClientRect()
    const toClient = (xy: [number, number]): { x: number; y: number } => {
      const m = first.getScreenCTM()
      if (m === null) return { x: NaN, y: NaN }
      return { x: m.a * xy[0] + m.c * xy[1] + m.e - box.left, y: m.b * xy[0] + m.d * xy[1] + m.f - box.top }
    }
    const spokes: SpokeCheck[] = spokeLines.map((line, i) => {
      const a = Math.atan2(n(line, 'x2'), -n(line, 'y2'))
      const ang = a < 0 ? a + 2 * Math.PI : a
      const mark = marks[i]
      const id = ids[i] ?? `#${i}`
      const row = rowsById.get(id)
      const label = labels[i]
      const base = {
        i,
        id,
        angleDeg: Math.round(((ang * 180) / Math.PI) * 100) / 100,
        label: (label?.textContent ?? '').replace(/ /g, ' '),
        labelClass: label?.getAttribute('class') ?? '',
        muted: mark?.classList.contains('muted') ?? false,
        spokeDash: getComputedStyle(line).strokeDasharray,
      }
      const marker = mark?.querySelector('circle.marker') ?? null
      if (marker === null) {
        const stub = mark?.querySelector('line.stub') ?? null
        const gap = mark?.querySelector('circle.gap') ?? null
        const dip = polar(0.04 * R, ang)
        drawnR.push(0.04 * R)
        return {
          ...base,
          measured: false,
          dipToCurvePx: minDist(dip[0], dip[1]) * pxPerUnit,
          bandAtHalfR: inFill(band, polar(0.5 * R, ang)),
          fuzzAtHalfR: inAnyFuzz(polar(0.5 * R, ang)),
          stubLen: stub === null ? NaN : Math.hypot(n(stub, 'x2'), n(stub, 'y2')) / R,
          gapR: gap === null ? NaN : Math.hypot(n(gap, 'cx'), n(gap, 'cy')) / R,
        }
      }
      const mx = n(marker, 'cx')
      const my = n(marker, 'cy')
      const markerR = Math.hypot(mx, my)
      drawnR.push(markerR)
      const wh = mark?.querySelector('line.whisker') ?? null
      const r1 = Math.hypot(n(wh, 'x1'), n(wh, 'y1'))
      const r2 = Math.hypot(n(wh, 'x2'), n(wh, 'y2'))
      const out: SpokeCheck = { ...base, measured: true, markerR, curveToMarkerPx: minDist(mx, my) * pxPerUnit }
      if (row === undefined || row.theta === null || row.sd === null || row.lo === null || row.hi === null) return out
      const exp = expectedR(row.theta)
      const at = (z: number): [number, number] => polar((R * (row.theta! + z * row.sd! + 3)) / 6, ang)
      const ok = (z: number): boolean => {
        const t = row.theta! + z * row.sd!
        return t > -2.76 && t < 3
      }
      const bandChecks: Record<string, boolean> = {}
      const fuzzChecks: Record<string, boolean> = {}
      for (const z of [-1.2, -0.85, 0.85, 1.2]) if (ok(z)) bandChecks[`${z > 0 ? '+' : ''}${z}sd`] = inFill(band, at(z))
      for (const z of [-1.8, -1.5, 1.5, 1.8]) if (ok(z)) fuzzChecks[`${z > 0 ? '+' : ''}${z}sd`] = inAnyFuzz(at(z))
      // Off-spoke sample points (3° clockwise) for the band's colour, away from the whisker and the marker.
      const off = ang + (3 * Math.PI) / 180
      for (const z of [-0.5, 0.5]) {
        if (!ok(z)) continue
        samples.push({ id, where: `${z > 0 ? '+' : ''}${z}sd`, ...toClient(polar((R * (row.theta + z * row.sd + 3)) / 6, off)) })
      }
      return {
        ...out,
        expectedR: exp,
        markerErrPx: Math.abs(markerR - exp) * pxPerUnit,
        loErrPx: Math.abs(Math.min(r1, r2) - expectedR(row.lo)) * pxPerUnit,
        hiErrPx: Math.abs(Math.max(r1, r2) - expectedR(row.hi)) * pxPerUnit,
        clampedLo: row.lo < -2.76,
        clampedHi: row.hi > 3,
        band: bandChecks,
        fuzz: fuzzChecks,
      }
    })
    // §9.2 overshoot between neighbouring spokes, in ring units.
    let maxOvershootRings = 0
    let overshootAt = ''
    const angles = spokes.map((s) => (s.angleDeg * Math.PI) / 180)
    for (let i = 0; i < k; i++) {
      const j = (i + 1) % k
      const a0 = angles[i]!
      let a1 = angles[j]!
      if (a1 <= a0) a1 += 2 * Math.PI
      const lo = Math.min(drawnR[i]!, drawnR[j]!)
      const hi = Math.max(drawnR[i]!, drawnR[j]!)
      for (const p of pts) {
        let a = angleOf(p[0], p[1])
        if (a < a0) a += 2 * Math.PI
        if (a <= a0 + 1e-3 || a >= a1 - 1e-3) continue
        const r = Math.hypot(p[0], p[1])
        const over = Math.max(0, r - hi, lo - r) / ringUnit
        if (over > maxOvershootRings) {
          maxOvershootRings = over
          overshootAt = `${spokes[i]!.id}→${spokes[j]!.id}`
        }
      }
    }
    const hatchClips = [...svg.querySelectorAll('path.hatch')].map((h) => (h.getAttribute('clip-path') ?? '').replace(/^url\(#|\)$/g, ''))
    const hatchAngles = hatchClips.map((cid) => {
      const p = svg!.querySelector<SVGPathElement>(`clipPath[id="${cid}"] path`)
      if (p === null) return NaN
      const bb = p.getBBox()
      const cx = bb.x + bb.width / 2
      const cy = bb.y + bb.height / 2
      return Math.round((angleOf(cx, cy) * 180) / Math.PI)
    })
    // Smallest chart text on screen.
    let minTextPx = Infinity
    let minTextWhat = ''
    for (const t of svg.querySelectorAll<SVGTextElement | SVGTSpanElement>('text, tspan')) {
      if ((t.textContent ?? '').trim() === '') continue
      const fs = parseFloat(getComputedStyle(t).fontSize)
      const m = (t as SVGGraphicsElement).getCTM?.()
      const s = m ? Math.hypot(m.a, m.b) : pxPerUnit
      const px = fs * s
      if (px < minTextPx) {
        minTextPx = px
        minTextWhat = (t.textContent ?? '').trim().slice(0, 40)
      }
    }
    const style = (q: string, p: 'stroke' | 'fill'): string => {
      const el = svg!.querySelector(q)
      return el === null ? '' : getComputedStyle(el)[p]
    }
    return {
      found: true,
      pxPerUnit,
      R,
      rings,
      ringLabels: [...svg.querySelectorAll('text.ring-label')].map((t) => t.textContent ?? ''),
      ringNote: [...svg.querySelectorAll('text.ring-note tspan')].map((t) => t.textContent ?? '').join(' | '),
      title: svg.querySelector('title')?.textContent ?? '',
      desc: svg.querySelector('desc')?.textContent ?? '',
      order: spokes.map((s) => s.id),
      spokes,
      crispMutedSpokes: svg.querySelector('path.crisp-muted')?.getAttribute('data-spokes') ?? '',
      nFuzz: fuzz.length,
      fuzzOpacities: fuzz.map((f) => Number(f.getAttribute('fill-opacity'))),
      nHatch: hatchClips.length,
      hatchAngles,
      maxOvershootRings,
      overshootAt,
      crispD: crisp?.getAttribute('d') ?? '',
      curveKind: crisp?.getAttribute('data-curve') ?? '',
      minTextPx,
      minTextWhat,
      colours: {
        crisp: style('path.crisp', 'stroke'),
        crispMuted: style('path.crisp-muted', 'stroke'),
        band: style('path.band', 'fill'),
        markerCredible: style('g.mark:not(.muted) circle.marker', 'fill'),
        markerMuted: style('g.mark.muted circle.marker', 'stroke'),
        stub: style('line.stub', 'stroke'),
        hatch: style('line.hatch-line', 'stroke'),
        bg: getComputedStyle(svg.closest('section') ?? document.body).backgroundColor,
      },
      samples,
    }
  } finally {
    host?.remove()
  }
}

// ------------------------------------------------------------------------------------ node helpers

const r2 = (v: number): number => Math.round(v * 100) / 100
const ensure = (abs: string): void => {
  mkdirSync(abs, { recursive: true })
}

/** Every word that would name a total, an area, a single score, a percentile, an IQ-like scale or a rank, with context. */
function scanTerms(where: string, text: string): { where: string; term: string; context: string }[] {
  const out: { where: string; term: string; context: string }[] = []
  const re = /\b(total|totals|area|overall|score|scores|scored|scoring|percentile|percentiles|IQ|rank|ranked|ranking|average|averages|composite|aggregate|g[- ]factor|genius|gifted|smart|intelligen\w*|out of \d+|\d+\s*\/\s*\d+\s*points?)\b/gi
  for (const m of text.matchAll(re)) {
    const at = m.index ?? 0
    out.push({ where, term: m[0], context: text.slice(Math.max(0, at - 70), at + 70).replace(/\s+/g, ' ') })
  }
  return out
}

/** WCAG relative luminance and contrast of rgb triples. */
function lum([r, g, b]: number[]): number {
  const c = (v: number): number => {
    const s = v / 255
    return s <= 0.04045 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4
  }
  return 0.2126 * c(r!) + 0.7152 * c(g!) + 0.0722 * c(b!)
}
function contrast(a: number[], b: number[]): number {
  const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p) as [number, number]
  return (x + 0.05) / (y + 0.05)
}
function parseRgb(s: string): number[] {
  const m = /rgba?\(([^)]+)\)/.exec(s)
  if (m === null) return [NaN, NaN, NaN]
  return m[1]!.split(',').slice(0, 3).map((v) => Number(v.trim()))
}

/** Colours of the svg's screenshot at the sample points; contrast of each against the page background. */
async function bandLegibility(page: Page, svgSel: string, check: BlobCheck): Promise<{ n: number; min: number; median: number; max: number; bg: number[] }> {
  const buf = await page.locator(svgSel).first().screenshot()
  const res = await page.evaluate(
    async (arg: { b64: string; pts: { x: number; y: number }[]; w: number }) => {
      const img = new Image()
      img.src = `data:image/png;base64,${arg.b64}`
      await img.decode()
      const c = document.createElement('canvas')
      c.width = img.naturalWidth
      c.height = img.naturalHeight
      const ctx = c.getContext('2d')!
      ctx.drawImage(img, 0, 0)
      const ratio = img.naturalWidth / arg.w
      const px = (x: number, y: number): number[] => [...ctx.getImageData(Math.round(x * ratio), Math.round(y * ratio), 1, 1).data].slice(0, 3)
      return { colours: arg.pts.map((p) => px(p.x, p.y)), corner: px(2, 2) }
    },
    { b64: buf.toString('base64'), pts: check.samples.map((s) => ({ x: s.x, y: s.y })), w: await page.locator(svgSel).first().evaluate((el) => el.getBoundingClientRect().width) },
  )
  const bg = parseRgb(check.colours.bg ?? '')
  const ref = Number.isFinite(bg[0]) && !(bg[0] === 0 && bg[1] === 0 && bg[2] === 0 && /rgba\(0, 0, 0, 0\)/.test(check.colours.bg ?? '')) ? bg : res.corner
  const cs = res.colours.map((c) => contrast(c, ref)).sort((a, b) => a - b)
  return { n: cs.length, min: r2(cs[0] ?? NaN), median: r2(cs[Math.floor(cs.length / 2)] ?? NaN), max: r2(cs.at(-1) ?? NaN), bg: ref }
}

/**
 * §9.2 overshoot of a drawn closed curve, measured independently of the app: each cubic segment of the path data
 * (M then C commands, one per pair of neighbouring spokes) is sampled at 400 points and its distance from the centre
 * compared with the segment's chord band [min(r0, r3, distance from the centre to the chord), max(r0, r3)]. Returns the
 * worst excess in rings (R / 6) and the pair of spokes where it happens. (An angular sweep misreads the curve where it
 * passes the centre at a not-measured spoke, where every angle is near.)
 */
function curveOvershoot(d: string, R: number, ids: readonly string[]): { rings: number; at: string; segments: number } {
  const nums = (d.match(/-?\d+(?:\.\d+)?/g) ?? []).map(Number)
  if (nums.length < 8 || !(R > 0)) return { rings: NaN, at: '', segments: 0 }
  let p0: [number, number] = [nums[0]!, nums[1]!]
  let worst = 0
  let at = ''
  let seg = 0
  for (let i = 2; i + 5 < nums.length; i += 6, seg++) {
    const c = nums.slice(i, i + 6)
    const p1: [number, number] = [c[0]!, c[1]!]
    const p2: [number, number] = [c[2]!, c[3]!]
    const p3: [number, number] = [c[4]!, c[5]!]
    const r0 = Math.hypot(...p0)
    const r3 = Math.hypot(...p3)
    const dx = p3[0] - p0[0]
    const dy = p3[1] - p0[1]
    const len2 = dx * dx + dy * dy
    const t0 = len2 === 0 ? 0 : Math.max(0, Math.min(1, -(p0[0] * dx + p0[1] * dy) / len2))
    const chordMin = Math.hypot(p0[0] + t0 * dx, p0[1] + t0 * dy)
    const lo = Math.min(r0, r3, chordMin)
    const hi = Math.max(r0, r3)
    for (let k = 0; k <= 400; k++) {
      const t = k / 400
      const u = 1 - t
      const x = u * u * u * p0[0] + 3 * u * u * t * p1[0] + 3 * u * t * t * p2[0] + t * t * t * p3[0]
      const y = u * u * u * p0[1] + 3 * u * u * t * p1[1] + 3 * u * t * t * p2[1] + t * t * t * p3[1]
      const r = Math.hypot(x, y)
      const e = Math.max(0, r - hi, lo - r) / (R / 6)
      if (e > worst) {
        worst = e
        at = `${ids[seg % ids.length] ?? seg}→${ids[(seg + 1) % ids.length] ?? seg + 1}`
      }
    }
    p0 = p3
  }
  return { rings: worst, at, segments: seg }
}

/** A compact verdict of a blob check against its table (what a finding quotes). */
function summarise(check: BlobCheck, rows: TableRow[]): Record<string, unknown> {
  const measured = check.spokes.filter((s) => s.measured)
  const stubs = check.spokes.filter((s) => !s.measured)
  const max = (xs: (number | undefined)[]): number => r2(Math.max(0, ...xs.filter((x): x is number => x !== undefined && Number.isFinite(x))))
  const rowById = new Map(rows.map((r) => [r.id, r]))
  const mutedMismatch = measured.filter((s) => {
    const r = rowById.get(s.id)
    return r !== undefined && (r.relation === 'Overlaps 0 SD') !== s.muted
  })
  const mutedVsNumbers = measured.filter((s) => {
    const r = rowById.get(s.id)
    if (r === undefined || r.lo === null || r.hi === null) return false
    return (r.lo <= 0 && r.hi >= 0) !== s.muted
  })
  const glyphMismatch = check.spokes.filter((s) => {
    const r = rowById.get(s.id)
    if (r === undefined) return false
    const g = /[○◇]/.exec(s.label)?.[0] ?? ''
    return g !== r.glyph
  })
  const bandFail = measured.filter((s) => s.band !== undefined && Object.entries(s.band).some(([k, v]) => (Math.abs(parseFloat(k)) < 1 ? !v : v)))
  const fuzzFail = measured.filter((s) => s.fuzz !== undefined && Object.entries(s.fuzz).some(([k, v]) => (Math.abs(parseFloat(k)) < 1.645 ? !v : v)))
  const missingRows = check.spokes.filter((s) => !rowById.has(s.id))
  const measuredMismatch = check.spokes.filter((s) => {
    const r = rowById.get(s.id)
    return r !== undefined && r.measured !== s.measured
  })
  return {
    spokes: check.spokes.length,
    measured: measured.length,
    notMeasured: stubs.length,
    pxPerUnit: r2(check.pxPerUnit),
    R: r2(check.R),
    ringErrUnits: max(check.rings.map((r) => Math.abs(r.r - r.expected))),
    rings: check.rings.map((r) => `${r2(r.r)}${r.reference ? ` (dashed ${r.dash})` : ''}`),
    ringLabels: check.ringLabels,
    ringNote: check.ringNote,
    maxMarkerErrPx: max(measured.map((s) => s.markerErrPx)),
    maxWhiskerLoErrPx: max(measured.map((s) => s.loErrPx)),
    maxWhiskerHiErrPx: max(measured.map((s) => s.hiErrPx)),
    maxCurveToMarkerPx: max(measured.map((s) => s.curveToMarkerPx)),
    maxDipToCurvePx: max(stubs.map((s) => s.dipToCurvePx)),
    stubsWithBandAtHalfR: stubs.filter((s) => s.bandAtHalfR || s.fuzzAtHalfR).map((s) => s.id),
    stubDash: [...new Set(stubs.map((s) => s.spokeDash))],
    measuredSpokeDash: [...new Set(measured.map((s) => s.spokeDash))],
    stubLenR: [...new Set(stubs.map((s) => r2(s.stubLen ?? NaN)))],
    gapR: [...new Set(stubs.map((s) => r2(s.gapR ?? NaN)))],
    clamped: measured.filter((s) => s.clampedHi || s.clampedLo).map((s) => s.id),
    bandFail: bandFail.map((s) => `${s.id} ${JSON.stringify(s.band)}`),
    fuzzFail: fuzzFail.map((s) => `${s.id} ${JSON.stringify(s.fuzz)}`),
    mutedMismatchVsTableText: mutedMismatch.map((s) => s.id),
    mutedMismatchVsNumbers: mutedVsNumbers.map((s) => s.id),
    mutedSpokes: measured.filter((s) => s.muted).map((s) => s.id),
    crispMutedSpokes: check.crispMutedSpokes,
    glyphMismatch: glyphMismatch.map((s) => `${s.id}: chart "${s.label}" vs table "${rowById.get(s.id)?.glyph}"`),
    missingRows: missingRows.map((s) => s.id),
    measuredMismatch: measuredMismatch.map((s) => s.id),
    nFuzz: check.nFuzz,
    nHatch: check.nHatch,
    hatchAngles: check.hatchAngles,
    ...(() => {
      const o = curveOvershoot(check.crispD, check.R, check.order)
      return { curveKind: check.curveKind, curveSegments: o.segments, maxOvershootRings: r2(o.rings), overshootAt: o.at, angularSweepOvershootRings: r2(check.maxOvershootRings) }
    })(),
    minTextPx: r2(check.minTextPx),
    minTextWhat: check.minTextWhat,
    colours: check.colours,
    order: check.order,
    title: check.title,
    desc: check.desc,
  }
}

/** Table internal consistency: hi − lo = 2·1.645·SD; the lollipop matches the numbers. */
function tableChecks(rows: TableRow[]): Record<string, unknown> {
  const m = rows.filter((r) => r.measured && r.theta !== null && r.sd !== null && r.lo !== null && r.hi !== null)
  const widthErr = m.map((r) => ({ id: r.id, err: r2(Math.abs(r.hi! - r.lo! - 2 * 1.6449 * r.sd!)), mid: r2(Math.abs((r.hi! + r.lo!) / 2 - r.theta!)) }))
  const x = (t: number): number => 6 + ((Math.min(3, Math.max(-3, t)) + 3) / 6) * 120
  const lolli = m
    .filter((r) => r.lolli !== null)
    .map((r) => ({ id: r.id, dotErr: r2(Math.abs(r.lolli!.dot - x(r.theta!))), loErr: r2(Math.abs(r.lolli!.x1 - x(r.lo!))), hiErr: r2(Math.abs(r.lolli!.x2 - x(r.hi!))), zeroErr: r2(Math.abs(r.lolli!.zero - x(0))) }))
  const relWrong = m.filter((r) => {
    const want = r.lo! > 0 ? 'Above 0 SD' : r.hi! < 0 ? 'Below 0 SD' : 'Overlaps 0 SD'
    return want !== r.relation
  })
  return {
    measured: m.length,
    maxIntervalWidthErr: Math.max(0, ...widthErr.map((w) => w.err)),
    maxMidpointErr: Math.max(0, ...widthErr.map((w) => w.mid)),
    lollipopMaxErrUnits: Math.max(0, ...lolli.flatMap((l) => [l.dotErr, l.loErr, l.hiErr, l.zeroErr])),
    lollipopClamped: m.filter((r) => r.lo! < -3 || r.hi! > 3).map((r) => `${r.id} ${r.lo} to ${r.hi}`),
    relationWrong: relWrong.map((r) => `${r.id}: ${r.relation} for ${r.lo} to ${r.hi}`),
    stubs: rows.filter((r) => !r.measured).map((r) => `${r.id}: ${r.stub}`),
  }
}

const PROFILE = 'section.hb-profile'
const MAIN_TABLE = `${PROFILE} > div.hb-bars-wrap table.hb-bars`
const MAIN_BLOB = `${PROFILE} figure.blob-figure svg.hb-blob`
const FACET_TABLE = 'section.facet-panel table.hb-bars'
const FACET_BLOB = 'section.facet-panel svg.hb-blob'

async function prime(page: Page): Promise<void> {
  await page.evaluate('globalThis.__name ??= (fn) => fn')
}

async function readMain(page: Page): Promise<{ rows: TableRow[]; check: BlobCheck }> {
  await prime(page)
  const rows = await page.evaluate(readTable, MAIN_TABLE)
  const check = await page.evaluate(evalBlob, { sel: MAIN_BLOB, svgText: null, rows, ids: null })
  return { rows, check }
}

interface Claims {
  readonly practiceBadge: string
  readonly sessionSummary: string
  readonly peaks: { text: string; code: string; contrast: number; lo: number; hi: number }[]
  readonly peaksSection: string
  readonly fuzzy: { text: string; code: string; lo: number; hi: number }[]
  readonly shrinkage: string
  readonly shrinkageBasis: string
  readonly norms: string[]
  readonly pace: string[]
  readonly numbers: string
  readonly captions: string[]
  readonly title: string
}

async function readClaims(page: Page): Promise<Claims> {
  await prime(page)
  return page.evaluate(() => {
    const num = (s: string): number => Number(s.replace(/−/g, '-').replace(/^\+/, ''))
    const t = (q: string): string => (document.querySelector(q)?.textContent ?? '').replace(/\s+/g, ' ').trim()
    const peaks = [...document.querySelectorAll('li[data-peak]')].map((li) => {
      const text = (li.textContent ?? '').replace(/\s+/g, ' ').trim()
      const m = /about ([\d.]+) SD.*?90% range ([+−-]?[\d.]+) to ([+−-]?[\d.]+) SD/.exec(text)
      return { text, code: li.getAttribute('data-peak') ?? '', contrast: m ? num(m[1]!) : NaN, lo: m ? num(m[2]!) : NaN, hi: m ? num(m[3]!) : NaN }
    })
    const fuzzy = [...document.querySelectorAll('li[data-fuzzy]')].map((li) => {
      const text = (li.textContent ?? '').replace(/\s+/g, ' ').trim()
      const m = /90% range ([+−-]?[\d.]+) to ([+−-]?[\d.]+) SD/.exec(text)
      return { text, code: li.getAttribute('data-fuzzy') ?? '', lo: m ? num(m[1]!) : NaN, hi: m ? num(m[2]!) : NaN }
    })
    const summary = [...document.querySelectorAll('main p')].slice(0, 3).map((p) => (p.textContent ?? '').trim()).join(' / ')
    return {
      practiceBadge: t('[data-practice-adjusted]'),
      sessionSummary: summary,
      peaks,
      peaksSection: t('[data-section="peaks"]'),
      fuzzy,
      shrinkage: t('[data-shrinkage]'),
      shrinkageBasis: t('[data-section="retest"] [data-shrinkage] + p'),
      norms: [...document.querySelectorAll('li[data-norm]')].map((li) => (li.textContent ?? '').trim()),
      pace: [...document.querySelectorAll('li[data-pace]')].map((li) => (li.textContent ?? '').trim()),
      numbers: t('[data-section="numbers"]'),
      captions: [...document.querySelectorAll('figure.blob-figure figcaption p')].map((p) => (p.textContent ?? '').trim()),
      title: document.title,
    }
  })
}

/** Agreement of the claims with the table: peaks vs θ_k − mean(θ measured), fuzziest vs SD order, shrinkage basis. */
function claimChecks(claims: Claims, rows: TableRow[]): Record<string, unknown> {
  const m = rows.filter((r) => r.measured && r.theta !== null)
  const mean = m.reduce((s, r) => s + r.theta!, 0) / Math.max(1, m.length)
  const byId = new Map(rows.map((r) => [r.id, r]))
  const peaks = claims.peaks.map((p) => {
    const r = byId.get(p.code)
    const recomputed = r?.theta == null ? NaN : r.theta - mean
    return {
      code: p.code,
      shown: p.contrast,
      recomputedFromTable: r2(recomputed),
      agree: Math.abs(recomputed - p.contrast) <= 0.06,
      peakRange: `${p.lo} to ${p.hi}`,
      tableRangeOfSameSkill: r === undefined ? '' : `${r.lo} to ${r.hi}`,
      contrastSd: r2((p.hi - p.lo) / (2 * 1.6449)),
      levelSd: r?.sd ?? null,
    }
  })
  const bySd = [...m].sort((a, b) => b.sd! - a.sd!)
  const fuzzy = claims.fuzzy.map((f, i) => {
    const r = byId.get(f.code)
    const lo1 = r?.lo == null ? NaN : Math.round(r.lo * 10) / 10
    const hi1 = r?.hi == null ? NaN : Math.round(r.hi * 10) / 10
    return { code: f.code, rank: i + 1, expectedAtRank: bySd[i]?.id, sd: r?.sd, shown: `${f.lo} to ${f.hi}`, table: `${r?.lo} to ${r?.hi}`, roundedAgree: Math.abs(lo1 - f.lo) < 1e-9 && Math.abs(hi1 - f.hi) < 1e-9 }
  })
  // §7.6 projection applied to THIS profile: one more session adds 2.1 precision units to each skill.
  const perSkill = m.map((r) => ({ id: r.id, sd: r.sd!, next: 1 / Math.sqrt(1 / (r.sd! * r.sd!) + 2.1) })).map((x) => ({ ...x, tighten: r2(1 - x.next / x.sd) }))
  const sorted = perSkill.map((x) => x.tighten).sort((a, b) => a - b)
  return {
    meanOfMeasuredTheta_hiddenOnPage: r2(mean),
    peaks,
    fuzzy,
    shrinkageShown: claims.shrinkage,
    shrinkageIfAppliedToThisProfile: { perSkill, median: sorted[Math.floor(sorted.length / 2)] ?? null, min: sorted[0] ?? null, max: sorted.at(-1) ?? null },
  }
}

/** Colour-blind simulation (Machado et al. 2009, severity 1) as SVG filters, applied to the chart and the card preview. */
const CB_FILTERS = `<svg xmlns="http://www.w3.org/2000/svg" id="ux-cb" style="position:absolute;width:0;height:0" aria-hidden="true"><defs>
<filter id="ux-protan" color-interpolation-filters="linearRGB"><feColorMatrix type="matrix" values="0.152286 1.052583 -0.204868 0 0 0.114503 0.786281 0.099216 0 0 -0.003882 -0.048116 1.051998 0 0 0 0 0 1 0"/></filter>
<filter id="ux-deutan" color-interpolation-filters="linearRGB"><feColorMatrix type="matrix" values="0.367322 0.860646 -0.227968 0 0 0.280085 0.672501 0.047413 0 0 -0.011820 0.042940 0.968881 0 0 0 0 0 1 0"/></filter>
<filter id="ux-gray" color-interpolation-filters="linearRGB"><feColorMatrix type="saturate" values="0"/></filter>
</defs></svg>`

async function colourBlind(page: Page, shots: Shots, sel: string, tag: string): Promise<string[]> {
  const out: string[] = []
  await page.evaluate((html) => {
    if (document.getElementById('ux-cb') === null) document.body.insertAdjacentHTML('beforeend', html)
  }, CB_FILTERS)
  for (const f of ['protan', 'deutan', 'gray']) {
    await page.locator(sel).first().evaluate((el, id) => ((el as HTMLElement).style.filter = `url(#ux-${id})`), f)
    out.push(await shots.shot(`${tag}-${f}`, { locator: page.locator(sel).first() }))
  }
  await page.locator(sel).first().evaluate((el) => ((el as HTMLElement).style.filter = ''))
  return out
}

async function pageTerms(page: Page): Promise<{ where: string; term: string; context: string }[]> {
  await prime(page)
  const parts = await page.evaluate(() => ({
    body: document.body.innerText,
    title: document.title,
    alts: [...document.querySelectorAll('[alt]')].map((e) => e.getAttribute('alt') ?? '').join(' | '),
    labels: [...document.querySelectorAll('[aria-label]')].map((e) => e.getAttribute('aria-label') ?? '').join(' | '),
    svgText: [...document.querySelectorAll('svg title, svg desc')].map((e) => e.textContent ?? '').join(' | '),
  }))
  return Object.entries(parts).flatMap(([k, v]) => scanTerms(k, v))
}

function writeJson(sub: string, name: string, data: unknown): string {
  const dir = path.join(UX_ROOT, RUN, sub)
  ensure(dir)
  const file = path.join(dir, `${name}.json`)
  writeFileSync(file, JSON.stringify(data, null, 2))
  return path.relative(REPO_ROOT, file)
}

// ------------------------------------------------------------------------------------- the tests

/** The whole results analysis of one state (page blob, table, bar view, claims, drill-down, card, exports). */
async function analyseResults(page: Page, sub: string, opts: { card: boolean; cb: boolean; dark: boolean; drill: boolean; widths?: number[] }): Promise<Record<string, unknown>> {
  const shots = new Shots(page, RUN, sub)
  const report: Record<string, unknown> = {}
  await expect(page.locator(MAIN_BLOB)).toBeVisible()
  await expect(page.locator('[data-section="peaks"]')).toBeVisible()
  await page.locator('details').evaluateAll((ds) => ds.forEach((d) => d.setAttribute('open', '')))
  report.page = await shots.all('results-light')
  report.chartShot = await shots.shot('chart-light', { locator: page.locator(`${PROFILE} figure.blob-figure`) })
  const { rows, check } = await readMain(page)
  report.table = rows
  report.tableChecks = tableChecks(rows)
  report.blob = summarise(check, rows)
  report.blobRaw = check
  report.band = { light: await bandLegibility(page, MAIN_BLOB, check) }
  const claims = await readClaims(page)
  report.claims = claims
  report.claimChecks = claimChecks(claims, rows)
  report.terms = await pageTerms(page)
  if (opts.widths !== undefined) {
    const vp = page.viewportSize()
    for (const w of opts.widths) {
      await page.setViewportSize({ width: w, height: vp?.height ?? 900 })
      await page.waitForTimeout(300)
      const at = await readMain(page)
      report[`blobAt${w}`] = summarise(at.check, at.rows)
      report[`chartAt${w}`] = await shots.shot(`chart-${w}`, { locator: page.locator(`${PROFILE} figure.blob-figure`) })
    }
    if (vp !== null) await page.setViewportSize(vp)
    await page.waitForTimeout(300)
  }
  // Bar view.
  await page.getByRole('button', { name: 'Bar view' }).click()
  await expect(page.locator('svg.lollipop').first()).toBeVisible()
  report.barsShot = await shots.shot('bars-light', { locator: page.locator(PROFILE) })
  const rowsBars = await page.evaluate(readTable, MAIN_TABLE)
  report.barsAgree = JSON.stringify(rowsBars.map((r) => [r.id, r.theta, r.sd, r.lo, r.hi, r.relation])) === JSON.stringify(rows.map((r) => [r.id, r.theta, r.sd, r.lo, r.hi, r.relation]))
  report.barsTableChecks = tableChecks(rowsBars)
  await page.getByRole('button', { name: 'Blob view' }).click()
  await expect(page.locator(MAIN_BLOB)).toBeVisible()
  if (opts.cb) report.colourBlind = await colourBlind(page, shots, `${PROFILE} figure.blob-figure`, 'chart')
  if (opts.dark) {
    await scheme(page, 'dark')
    await page.waitForTimeout(400)
    report.chartDark = await shots.shot('chart-dark', { locator: page.locator(`${PROFILE} figure.blob-figure`) })
    const d = await readMain(page)
    report.blobDark = summarise(d.check, d.rows)
    ;(report.band as Record<string, unknown>).dark = await bandLegibility(page, MAIN_BLOB, d.check)
    if (opts.cb) report.colourBlindDark = await colourBlind(page, shots, `${PROFILE} figure.blob-figure`, 'chart-dark')
    await scheme(page, 'light')
    await page.waitForTimeout(400)
  }
  // Drill-down: every cluster, the facets against the axis.
  if (opts.drill) {
    const clusters = await page.locator(`${PROFILE} .drill-buttons button`).allTextContents()
    const drill: Record<string, unknown>[] = []
    for (const c of clusters) {
      await page.locator(`${PROFILE} .drill-buttons button`, { hasText: c }).first().click()
      await expect(page.locator('section.facet-panel')).toBeVisible()
      await page.waitForTimeout(150)
      const facetRows = await page.evaluate(readTable, FACET_TABLE)
      const hasBlob = (await page.locator(FACET_BLOB).count()) > 0
      const fcheck = hasBlob ? await page.evaluate(evalBlob, { sel: FACET_BLOB, svgText: null, rows: facetRows, ids: null }) : null
      const axisSd = new Map(rows.map((r) => [r.name, r.sd]))
      const narrower = facetRows
        .filter((f) => f.measured && f.sd !== null)
        .map((f) => ({ facet: f.name, facetSd: f.sd, axis: f.group, axisSd: axisSd.get(f.group) ?? null }))
      drill.push({
        cluster: c,
        panelText: (await page.locator('section.facet-panel').innerText()).slice(0, 1500),
        facets: facetRows.map((f) => `${f.name} | ${f.measured ? `${f.theta} (SD ${f.sd}) ${f.lo} to ${f.hi} ${f.relation}` : f.stub}`),
        facetVsAxisSd: narrower,
        blob: fcheck === null ? null : summarise(fcheck, facetRows),
        shot: await shots.shot(`drill-${c}`, { locator: page.locator('section.facet-panel') }),
      })
      await page.locator(`${PROFILE} .drill-buttons button`, { hasText: c }).first().click()
    }
    report.drill = drill
  }
  // Save panel text, then the save and the share card.
  report.savePanel = await page.locator('[data-section="save"], section:has(> h2:text("Save your results"))').first().innerText().catch(() => '')
  if (opts.card) {
    await button(page, 'Download save file').click()
    await expect(page.locator('[data-share-card]')).toBeVisible()
    await expect(page.locator('img[data-preview]')).toBeVisible()
    report.afterSave = await shots.all('after-save')
    report.card = await analyseCard(page, shots, rows, check, 'light')
    await page.locator('[data-share-card]').getByRole('radio', { name: 'Dark' }).check()
    await page.waitForTimeout(400)
    report.cardDark = await analyseCard(page, shots, rows, check, 'dark')
    await page.locator('[data-share-card]').getByRole('radio', { name: 'Light' }).check()
    if (opts.cb) report.cardColourBlind = await colourBlind(page, shots, 'img[data-preview]', 'card')
    report.termsAfterSave = await pageTerms(page)
  }
  return report
}

async function analyseCard(page: Page, shots: Shots, rows: TableRow[], check: BlobCheck, theme: string): Promise<Record<string, unknown>> {
  const src = (await page.locator('img[data-preview]').getAttribute('src')) ?? ''
  const svgText = decodeURIComponent(src.replace(/^data:image\/svg\+xml;charset=utf-8,/, ''))
  const alt = (await page.locator('img[data-preview]').getAttribute('alt')) ?? ''
  const shown = check.order.filter((id) => {
    const r = rows.find((x) => x.id === id)
    return r !== undefined && r.measured && !(id === 'EMO' && (r.theta ?? 0) < 0)
  })
  await prime(page)
  const cardCheck = await page.evaluate(evalBlob, { sel: null, svgText, rows, ids: shown })
  const cardTexts = [...svgText.matchAll(/<text[^>]*>([^<]*)<\/text>/g)].map((m) => m[1]!).filter((t) => t.trim() !== '')
  const tspans = [...svgText.matchAll(/<tspan[^>]*>([^<]*)<\/tspan>/g)].map((m) => m[1]!)
  const sub = path.join(UX_ROOT, RUN, shots.sub)
  ensure(sub)
  const preview = await shots.shot(`card-preview-${theme}`, { locator: page.locator('img[data-preview]') })
  // The exports: SVG and PNG, saved where Read can show them.
  let svgFile = ''
  let pngFile = ''
  let svgSameAsPreview: boolean | null = null
  try {
    const [dl] = await Promise.all([page.waitForEvent('download', { timeout: 15_000 }), page.getByRole('button', { name: 'Download vector image (SVG)' }).click()])
    const abs = path.join(sub, `export-${theme}-${dl.suggestedFilename()}`)
    await dl.saveAs(abs)
    svgFile = path.relative(REPO_ROOT, abs)
    svgSameAsPreview = readFileSync(abs, 'utf8') === svgText
  } catch (e) {
    svgFile = `failed: ${String(e).slice(0, 200)}`
  }
  try {
    const pngButton = page.getByRole('button', { name: 'Download image (PNG)' })
    await expect(pngButton).toBeEnabled({ timeout: 15_000 })
    const [dl] = await Promise.all([page.waitForEvent('download', { timeout: 15_000 }), pngButton.click()])
    const abs = path.join(sub, `export-${theme}-${dl.suggestedFilename()}`)
    await dl.saveAs(abs)
    pngFile = path.relative(REPO_ROOT, abs)
  } catch (e) {
    pngFile = `failed: ${String(e).slice(0, 200)}`
  }
  const status = (await page.locator('[data-share-card] [role="status"], [data-share-card] [aria-live]').allTextContents().catch(() => [])).join(' | ')
  return {
    theme,
    alt,
    shownExpected: shown,
    blob: summarise(cardCheck, rows),
    texts: cardTexts,
    labelLines: tspans,
    terms: [...scanTerms('card-svg', cardTexts.concat(tspans).join(' \n ')), ...scanTerms('card-alt', alt)],
    svgDesc: /<desc[^>]*>([^<]*)<\/desc>/.exec(svgText)?.[1] ?? '',
    preview,
    svgFile,
    pngFile,
    svgSameAsPreview,
    status,
  }
}

test('data: results 1 session', async ({ page }, testInfo) => {
  const sub = `results1-${testInfo.project.name}`
  const log = trackConsole(page)
  await page.emulateMedia({ reducedMotion: 'reduce' })
  await page.setViewportSize({ width: 1280, height: 900 })
  await toResults(page, 1)
  await expect(button(page, 'Download save file')).toBeVisible()
  const report = await analyseResults(page, sub, { card: true, cb: testInfo.project.name === 'chromium', dark: true, drill: true, widths: testInfo.project.name === 'chromium' ? [1440] : undefined })
  report.console = log
  const file = writeJson(sub, 'report', report)
  console.log(`[data] wrote ${file}`)
})

test('data: results 2 sessions', async ({ page }, testInfo) => {
  const sub = `results2-${testInfo.project.name}`
  const log = trackConsole(page)
  await page.emulateMedia({ reducedMotion: 'reduce' })
  await page.setViewportSize({ width: 1280, height: 900 })
  await toResults(page, 2)
  await expect(button(page, 'Download save file')).toBeVisible()
  const report = await analyseResults(page, sub, { card: true, cb: false, dark: false, drill: true })
  // Session 1 vs session 1 + 2: what changed and what tightened (the 1-session report of the same project, if run).
  const one = path.join(UX_ROOT, RUN, `results1-${testInfo.project.name}`, 'report.json')
  if (existsSync(one)) {
    const r1 = JSON.parse(readFileSync(one, 'utf8')) as { table: TableRow[]; claims: Claims }
    const t2 = report.table as TableRow[]
    report.change = t2
      .filter((r) => r.measured)
      .map((r) => {
        const a = r1.table.find((x) => x.id === r.id)
        return {
          id: r.id,
          theta1: a?.theta ?? null,
          theta2: r.theta,
          sd1: a?.sd ?? null,
          sd2: r.sd,
          tightened: a?.sd == null || r.sd === null ? null : r2(1 - r.sd / a.sd),
        }
      })
    const t = (report.change as { tightened: number | null }[]).map((c) => c.tightened).filter((x): x is number => x !== null).sort((a, b) => a - b)
    report.tightenedMedian = t[Math.floor(t.length / 2)] ?? null
    report.predictedAfterOne = r1.claims.shrinkage
  }
  report.console = log
  console.log(`[data] wrote ${writeJson(sub, 'report', report)}`)
})

test('data: dev blob profiles', async ({ page }, testInfo) => {
  const sub = `devblob-${testInfo.project.name}`
  const shots = new Shots(page, RUN, sub)
  await page.emulateMedia({ reducedMotion: 'reduce' })
  await page.setViewportSize({ width: 1280, height: 900 })
  const out: Record<string, unknown> = {}
  for (const profile of ['full', 'm1']) {
    await page.goto(`./#/dev/blob?profile=${profile}`)
    await expect(page.locator(MAIN_BLOB)).toBeVisible()
    await page.waitForTimeout(300)
    const { rows, check } = await readMain(page)
    const entry: Record<string, unknown> = {
      shot: await shots.shot(`${profile}-chart`, { locator: page.locator(`${PROFILE} figure.blob-figure`) }),
      page: await shots.all(`${profile}`),
      table: rows,
      tableChecks: tableChecks(rows),
      blob: summarise(check, rows),
      captions: await page.locator('figure.blob-figure figcaption p').allTextContents(),
      band: await bandLegibility(page, MAIN_BLOB, check),
    }
    await scheme(page, 'dark')
    await page.waitForTimeout(400)
    const d = await readMain(page)
    entry.bandDark = await bandLegibility(page, MAIN_BLOB, d.check)
    entry.shotDark = await shots.shot(`${profile}-chart-dark`, { locator: page.locator(`${PROFILE} figure.blob-figure`) })
    await scheme(page, 'light')
    await page.waitForTimeout(300)
    if (profile === 'full') entry.colourBlind = await colourBlind(page, shots, `${PROFILE} figure.blob-figure`, `${profile}-chart`)
    const clusters = await page.locator(`${PROFILE} .drill-buttons button`).allTextContents()
    const drill: Record<string, unknown>[] = []
    for (const c of clusters) {
      await page.locator(`${PROFILE} .drill-buttons button`, { hasText: c }).first().click()
      await expect(page.locator('section.facet-panel')).toBeVisible()
      await page.waitForTimeout(150)
      const facetRows = await page.evaluate(readTable, FACET_TABLE)
      const hasBlob = (await page.locator(FACET_BLOB).count()) > 0
      const fcheck = hasBlob ? await page.evaluate(evalBlob, { sel: FACET_BLOB, svgText: null, rows: facetRows, ids: null }) : null
      const axisSd = new Map(rows.map((r) => [r.name, r.sd]))
      drill.push({
        cluster: c,
        facets: facetRows.map((f) => `${f.name} | ${f.measured ? `${f.theta} (SD ${f.sd}) ${f.lo} to ${f.hi} ${f.relation}` : f.stub}`),
        facetVsAxisSd: facetRows.filter((f) => f.measured).map((f) => ({ facet: f.name, facetSd: f.sd, axis: f.group, axisSd: axisSd.get(f.group) ?? null })),
        blob: fcheck === null ? null : summarise(fcheck, facetRows),
        shot: await shots.shot(`${profile}-drill-${c}`, { locator: page.locator('section.facet-panel') }),
      })
      await page.locator(`${PROFILE} .drill-buttons button`, { hasText: c }).first().click()
    }
    entry.drill = drill
    out[profile] = entry
  }
  console.log(`[data] wrote ${writeJson(sub, 'report', out)}`)
})

test('data: journey with two parts skipped', async ({ page }, testInfo) => {
  const sub = `journey-${testInfo.project.name}`
  const log = trackConsole(page)
  await page.setViewportSize({ width: 1280, height: 900 })
  const journey = await playJourney(page, { runId: RUN, touch: false, skipParts: ['Spatial', 'Working Memory'], shots: new Shots(page, RUN, `${sub}-steps`) })
  const report: Record<string, unknown> = { journey: { completed: journey.completed, error: journey.error, skipped: journey.skipped, answered: journey.answered, realMs: journey.realMs, played: journey.played } }
  if (journey.completed) {
    await expect(button(page, 'Download save file')).toBeVisible({ timeout: 30_000 })
    await expect(page.locator('.reveal[data-building="false"]')).toBeVisible({ timeout: 60_000 })
    Object.assign(report, await analyseResults(page, sub, { card: true, cb: false, dark: false, drill: true }))
  }
  report.console = log
  console.log(`[data] wrote ${writeJson(sub, 'report', report)}`)
})

test('data: finished nothing', async ({ page }, testInfo) => {
  const sub = `nothing-${testInfo.project.name}`
  const shots = new Shots(page, RUN, sub)
  const { ROUTES, openRoute } = await import('../../e2e/routes')
  await page.emulateMedia({ reducedMotion: 'reduce' })
  await openRoute(page, ROUTES.find((r) => r.id === 'finished-nothing')!)
  const all = await shots.all('finished-nothing')
  console.log(`[data] wrote ${writeJson(sub, 'report', { all, terms: await pageTerms(page), text: await page.locator('body').innerText() })}`)
})

test('data: tour of the results routes', async ({ context }, testInfo) => {
  const entries = await tour(context, {
    runId: RUN,
    sub: `tour-${testInfo.project.name}`,
    routes: ['results', 'results-drilldown', 'results-bars', 'results-open', 'results-saved', 'share-card-dark', 'share-card-too-few', 'finished-nothing'],
    widths: testInfo.project.use.hasTouch === true ? undefined : [1280, 1440],
    schemes: ['light', 'dark'],
    touch: testInfo.project.use.hasTouch === true,
  })
  console.log(`[data] tour: ${entries.map((e) => `${e.route}:${e.ok}`).join(', ')}`)
})

test('data: phone legibility', async ({ page }, testInfo) => {
  const sub = `phone-${testInfo.project.name}`
  const shots = new Shots(page, RUN, sub)
  await page.emulateMedia({ reducedMotion: 'reduce' })
  await toResults(page, 1)
  await expect(button(page, 'Download save file')).toBeVisible()
  const { rows, check } = await readMain(page)
  const out: Record<string, unknown> = {
    viewport: page.viewportSize(),
    chart: await shots.shot('chart', { locator: page.locator(`${PROFILE} figure.blob-figure`) }),
    blob: summarise(check, rows),
    peaks: await shots.shot('peaks', { locator: page.locator('[data-section="peaks"]') }),
    retest: await shots.shot('retest', { locator: page.locator('[data-section="retest"]') }),
    numbers: await shots.shot('numbers', { locator: page.locator('[data-section="numbers"]') }),
  }
  await page.getByRole('button', { name: 'Bar view' }).click()
  out.bars = await shots.shot('bars', { locator: page.locator(PROFILE) })
  out.barsOverflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)
  await page.getByRole('button', { name: 'Blob view' }).click()
  await button(page, 'Download save file').click()
  await expect(page.locator('img[data-preview]')).toBeVisible()
  out.card = await shots.shot('card', { locator: page.locator('img[data-preview]') })
  out.cardWidthPx = await page.locator('img[data-preview]').evaluate((el) => el.getBoundingClientRect().width)
  // The card's smallest text as it appears on this phone: card px × displayed width / 1200.
  out.cardSmallestTextOnScreenPx = r2((13 * (out.cardWidthPx as number)) / 1200)
  console.log(`[data] wrote ${writeJson(sub, 'report', out)}`)
})
