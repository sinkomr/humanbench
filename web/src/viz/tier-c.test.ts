/**
 * Tier (c) marks and the M6 facet labels (ROADMAP M6.4 "hatch rendering"; DESIGN §5 first paragraph
 * "tier-c axes are drawn hatched", §5.4 "Label this axis experimental", §9.6, §9.7, R-5.6.4): the
 * two tier (c) axes, Emotion Reading (EMO) and Creative Thinking (CRE), get a hatched wedge and a
 * ◇ on their label exactly when they are measured; unmeasured, they are the usual "not measured"
 * stub with no hatch. The M1 session does not change: the registry still marks both as v2, so a
 * first session shows them as not measured. Everything goes through the existing layout API
 * (`axisEstimates`, `buildBlob`, `spokeLines`, `clusterFacets`, `buildCard`); the DOM side is in
 * `tier-c.dom.test.ts`.
 */

import fc from 'fast-check'
import { describe, expect, it } from 'vitest'
import { AXES, AXIS_CODES, axis, type AxisCode } from '../engine/axes'
import { scoreAll, type ScoreResult } from '../engine/scorer'
import type { Observation } from '../engine/types'
import { buildBlob, DEFAULT_R, fitLayout, sectorPath, spokeLines, type BlobModel, type SpokeView } from './blob'
import { buildCard, cardAxes, type CardInput } from './card'
import { clusterFacets, FACET_LABELS, facetLabel, unmeasuredReasons, type FacetEstimate, type FacetObservation } from './facets'
import { spokeAngle } from './geometry'
import { axisEstimates, measuredFields, type AxisEstimate } from './profile'
import { syntheticProfile } from './synthetic'

// ---------------------------------------------------------------------------------- fixtures

const TIER_C: readonly AxisCode[] = ['EMO', 'CRE']
const GLYPH_C = '◇'

const estimatesOf = (id: string): AxisEstimate[] => axisEstimates(syntheticProfile(id)!.input)
const M1 = estimatesOf('m1')
const FULL = estimatesOf('full')

/** `est` with the given skills measured at `theta` ± `sd`. */
function measure(est: readonly AxisEstimate[], codes: readonly AxisCode[], theta = 0.8, sd = 0.4): AxisEstimate[] {
  return est.map((e) => (codes.includes(e.code) ? { ...e, ...measuredFields(theta, sd), reason: undefined } : e))
}

/** The estimates of the full profile where only `codes` have data (the rest are "not measured" stubs, as the scorer's output gives them). */
function onlyMeasured(codes: readonly AxisCode[]): AxisEstimate[] {
  const { score } = syntheticProfile('full')!.input
  const eap: ScoreResult['eap'] = {}
  for (const c of codes) eap[c] = score.eap[c]!
  return axisEstimates({ score: { ...score, eap } })
}

const hatchIds = (model: BlobModel): string[] => model.hatch.map((h) => h.id)
const spokeOf = (model: BlobModel, id: string): SpokeView => model.spokes.find((s) => s.id === id)!

/** Is the direction of `angle` inside the sector path from `sectorPath` (its two arc ends)? */
function inSector(d: string, angle: number): boolean {
  const m = /^M0,0L(-?[\d.]+),(-?[\d.]+)A[^ ]+ 0 [01],1 (-?[\d.]+),(-?[\d.]+)Z$/.exec(d)
  if (!m) throw new Error(`not a sector: ${d}`)
  const a = (x: number, y: number): number => (Math.atan2(x, -y) + 2 * Math.PI) % (2 * Math.PI)
  const a0 = a(Number(m[1]), Number(m[2]))
  const span = (a(Number(m[3]), Number(m[4])) - a0 + 2 * Math.PI) % (2 * Math.PI)
  return (angle - a0 + 2 * Math.PI) % (2 * Math.PI) < span
}

/** Observations of the M6 facets (tier c): a scored item is a 2PL answer, an alternative-uses score a Gaussian one. */
function twoPl(axisCode: AxisCode, n: number, y: (i: number) => 0 | 1): Observation[] {
  return Array.from({ length: n }, (_, i) => ({ kind: '2pl', axis: axisCode, a: 1.2, b: (i % 5) - 2, y: y(i) }) satisfies Observation)
}
function gaussian(axisCode: AxisCode, n: number): Observation[] {
  return Array.from({ length: n }, (_, i) => ({ kind: 'gaussian', axis: axisCode, lam: 1, d: 0, sigma: 0.45, x: 0.4 + 0.1 * (i % 3) }) satisfies Observation)
}
const tag = (facet: string, obs: readonly Observation[]): FacetObservation[] => obs.map((o) => ({ facet, obs: o }))

/** EMO: appraisal vignettes (6, enough) and situational judgment (3, not enough). CRE: remote associates (5) and alternative uses (5). */
const M6_OBS: readonly FacetObservation[] = [
  ...tag('appraisal_vignettes', twoPl('EMO', 6, (i) => (i % 3 === 0 ? 0 : 1))),
  ...tag('situational_judgment', twoPl('EMO', 3, () => 1)),
  ...tag('remote_associates', twoPl('CRE', 5, (i) => (i % 2 === 0 ? 1 : 0))),
  ...tag('alternative_uses', gaussian('CRE', 5)),
]
const M6_CATALOG = { EMO: ['appraisal_vignettes', 'situational_judgment'], CRE: ['remote_associates', 'alternative_uses'] } as const
const M6_SCORE = scoreAll(M6_OBS.map((o) => o.obs))

// ------------------------------------------------------------------------------- the registry

describe('the tier (c) axes stay v2 in the registry (DESIGN §3, §5)', () => {
  it('EMO and CRE are the tier (c) axes, with the ◇ glyph, and are the only v2 axes', () => {
    expect(AXES.filter((a) => a.tier === 'c').map((a) => a.code)).toEqual(TIER_C)
    expect(AXES.filter((a) => a.status === 'v2').map((a) => a.code)).toEqual(TIER_C)
    for (const code of TIER_C) expect(axis(code)).toMatchObject({ tier: 'c', glyph: GLYPH_C, status: 'v2' })
    // No other axis carries the tier (c) glyph.
    expect(AXES.filter((a) => a.glyph === GLYPH_C).map((a) => a.code)).toEqual(TIER_C)
  })

  it('the M1 session shows EMO and CRE as "not measured" (not yet available), with no hatch', () => {
    const p = syntheticProfile('m1')!
    for (const code of TIER_C) expect(p.facetObservations.some((o) => o.obs.axis === code)).toBe(false)
    const est = axisEstimates(p.input)
    for (const code of TIER_C) expect(est.find((e) => e.code === code)).toMatchObject({ measured: false, reason: 'not_yet_available', tier: 'c', glyph: GLYPH_C })
    expect(buildBlob(est).hatch).toEqual([])
  })
})

// ------------------------------------------------------------------------------------- hatch

describe('measured tier (c) spokes get a hatch wedge, and only they do (§9.7, M6.4)', () => {
  it('EMO and CRE measured: exactly those two spokes are hatched, each wedge centred on its spoke', () => {
    const est = measure(M1, TIER_C)
    const model = buildBlob(est)
    expect(model.spokes).toHaveLength(est.length)
    // Fourteen other measured skills (tiers a and b): no hatch on them.
    expect(est.filter((e) => e.measured && e.tier !== 'c').length).toBeGreaterThan(0)
    expect(hatchIds(model).sort()).toEqual([...TIER_C].sort())
    const k = est.length
    const half = Math.PI / k
    for (const h of model.hatch) {
      const i = est.findIndex((e) => e.id === h.id)
      const angle = spokeAngle(i, k)
      // The wedge is the spoke's own sector (± half a spoke spacing), a little beyond the outer ring.
      expect(h.d).toBe(sectorPath(angle - half, angle + half, DEFAULT_R + 4))
      expect(inSector(h.d, angle)).toBe(true)
      // It covers its own spoke and no other.
      for (let j = 0; j < k; j++) expect(inSector(h.d, spokeAngle(j, k)), `${h.id} wedge over spoke ${est[j]!.id}`).toBe(j === i)
    }
  })

  it('hatches follow spoke order, one wedge per measured tier (c) spoke', () => {
    const model = buildBlob(measure(M1, TIER_C))
    const order = model.spokes.map((s) => s.id).filter((id) => TIER_C.includes(id as AxisCode))
    expect(hatchIds(model)).toEqual(order)
  })

  it('only EMO measured: one wedge, on EMO; only CRE measured: one wedge, on CRE', () => {
    expect(hatchIds(buildBlob(measure(M1, ['EMO'])))).toEqual(['EMO'])
    expect(hatchIds(buildBlob(measure(M1, ['CRE'])))).toEqual(['CRE'])
  })

  it('unmeasured EMO and CRE are "not measured" stubs with no hatch, and keep the ◇ on their labels', () => {
    const model = buildBlob(M1)
    expect(model.hatch).toEqual([])
    for (const code of TIER_C) {
      const s = spokeOf(model, code)
      expect(s.measured).toBe(false)
      expect(s.stub).toBeDefined()
      expect(s.gap).toBeDefined()
      expect(s.marker).toBeUndefined()
      expect(s.whisker).toBeUndefined()
      // The label ends in the "not measured" note; the tier mark is the axis's, not the measurement's.
      expect(s.lines.at(-1)).toEqual({ text: 'not measured', note: true, glyph: false })
      expect(s.lines.filter((l) => l.glyph)).toHaveLength(1)
      expect(s.glyph).toBe(GLYPH_C)
    }
  })

  it('a skipped tier (c) axis is a stub with no hatch even when it has data', () => {
    const p = syntheticProfile('full')!
    const est = axisEstimates({ ...p.input, skipped: ['EMO'] })
    expect(est.find((e) => e.code === 'EMO')).toMatchObject({ measured: false, reason: 'skipped' })
    expect(hatchIds(buildBlob(est))).toEqual(['CRE'])
    expect(hatchIds(buildBlob(axisEstimates({ ...p.input, skipped: ['EMO', 'CRE'] })))).toEqual([])
  })

  it('every real profile hatches exactly its measured tier (c) skills', () => {
    for (const id of ['m1', 'full', 'skipped', 'sparse']) {
      const est = estimatesOf(id)
      expect(hatchIds(buildBlob(est)).sort(), id).toEqual(est.filter((e) => e.measured && e.tier === 'c').map((e) => e.code).sort())
    }
    expect(hatchIds(buildBlob(FULL)).sort()).toEqual([...TIER_C].sort())
  })

  it('for any set of measured skills, the hatched spokes are the measured tier (c) ones (property)', () => {
    fc.assert(
      fc.property(fc.subarray([...AXIS_CODES], { minLength: 1 }), (measuredCodes) => {
        const est = onlyMeasured(measuredCodes)
        expect(est.filter((e) => e.measured).map((e) => e.code).sort()).toEqual([...measuredCodes].sort())
        const model = buildBlob(est)
        expect(hatchIds(model).sort()).toEqual(measuredCodes.filter((c) => TIER_C.includes(c)).sort())
        for (const h of model.hatch) expect(spokeOf(model, h.id)).toMatchObject({ measured: true, tier: 'c' })
      }),
      { numRuns: 60 },
    )
  })
})

// ------------------------------------------------------------------------------------ glyphs

describe('the ◇ glyph is on the label of every tier (c) spoke (§9.7)', () => {
  it('spoke views carry the tier glyph, and exactly one label line gets it, in full and compact layouts', () => {
    for (const [name, est] of [
      ['M1', M1],
      ['full', FULL],
    ] as const) {
      for (const compact of [false, true]) {
        const model = buildBlob(est, { layout: { fontSize: 12.5, compact } })
        for (const s of model.spokes) {
          const tier = est.find((e) => e.id === s.id)!.tier
          expect(s.glyph, `${name} ${s.id}`).toBe({ a: '', b: '○', c: GLYPH_C }[tier])
          expect(s.lines.filter((l) => l.glyph), `${name} ${s.id} compact=${compact}`).toHaveLength(tier === 'a' ? 0 : 1)
        }
      }
    }
  })

  it('the narrow-screen fit keeps the glyph on tier (c) labels, measured or not', () => {
    for (const est of [M1, FULL]) {
      const model = buildBlob(est, { layout: fitLayout(est, 320) })
      for (const code of TIER_C) {
        const s = spokeOf(model, code)
        expect(s.glyph).toBe(GLYPH_C)
        expect(s.lines.filter((l) => l.glyph)).toHaveLength(1)
      }
    }
  })

  it('spokeLines puts the glyph on a main line, never on the stub note', () => {
    for (const code of TIER_C) {
      const e = M1.find((x) => x.code === code)!
      for (const compact of [false, true]) {
        const lines = spokeLines(e, compact)
        expect(lines.filter((l) => l.glyph)).toHaveLength(1)
        expect(lines.filter((l) => l.note).every((l) => !l.glyph)).toBe(true)
      }
    }
  })
})

// ------------------------------------------------------------------------------ facet labels

describe('M6 facet labels (DESIGN §5.4: "Label this axis experimental")', () => {
  const M6_LABELS = {
    situational_judgment: 'Situational judgment',
    remote_associates: 'Word links',
    alternative_uses: 'Unusual uses (experimental)',
    appraisal_vignettes: 'Emotion scenarios',
  } as const

  it('names the four M6 facets in plain words, alternative uses marked experimental', () => {
    // FACET_LABELS also names the M1 facets (UX-040, pinned in `facets.test.ts`); the four M6 entries are pinned here.
    expect(FACET_LABELS).toMatchObject(M6_LABELS)
    expect(facetLabel('situational_judgment')).toBe('Situational judgment')
    expect(facetLabel('remote_associates')).toBe('Word links')
    expect(facetLabel('alternative_uses')).toBe('Unusual uses (experimental)')
    expect(facetLabel('appraisal_vignettes')).toBe('Emotion scenarios')
    // Only the AUT facet is marked experimental, and no other facet shares an M6 facet's name on screen.
    expect(Object.entries(FACET_LABELS).filter(([, v]) => /experimental/.test(v)).map(([k]) => k)).toEqual(['alternative_uses'])
    const others = Object.entries(FACET_LABELS).filter(([k]) => !Object.hasOwn(M6_LABELS, k)).map(([, v]) => v)
    for (const label of Object.values(M6_LABELS)) expect(others, label).not.toContain(label)
    expect(Object.isFrozen(FACET_LABELS)).toBe(true)
  })

  it('leaves the label of every facet nobody named as the generic transform made it', () => {
    expect(facetLabel('odd_one_out')).toBe('Odd one out')
    expect(facetLabel('personal_finance')).toBe('Personal finance')
    expect(facetLabel('appraisal')).toBe('Appraisal') // the synthetic profile's EMO facet is not an M6 facet name
    expect(facetLabel('remote_associates_v2')).toBe('Remote associates v2')
  })

  it('looks the override up by own key only, so object-prototype names stay generic', () => {
    for (const name of ['constructor', 'toString', 'hasOwnProperty', '__proto__', 'valueOf']) {
      const generic = name.replace(/[_-]+/g, ' ').trim()
      expect(facetLabel(name), name).toBe(generic.charAt(0).toUpperCase() + generic.slice(1))
    }
  })

  const clusterRows = (est: readonly AxisEstimate[], score = M6_SCORE): FacetEstimate[] =>
    clusterFacets(score, M6_OBS, 'Social-Creative', { catalog: M6_CATALOG, unmeasured: unmeasuredReasons(est) })

  it('puts the labels on the facet rows of the Social-Creative drill-down, with the tier (c) mark', () => {
    const est = axisEstimates({ score: M6_SCORE })
    expect(est.filter((e) => e.measured).map((e) => e.code).sort()).toEqual([...TIER_C].sort())
    const rows = clusterRows(est)
    expect(rows.map((r) => [r.id, r.shortLabel[0]])).toEqual([
      ['EMO:appraisal_vignettes', 'Emotion scenarios'],
      ['EMO:situational_judgment', 'Situational judgment'],
      ['CRE:remote_associates', 'Word links'],
      ['CRE:alternative_uses', 'Unusual uses (experimental)'],
    ])
    // UX-040: a facet row is named by its label alone; the skill it belongs to is its group (the table's next column).
    expect(rows.map((r) => r.name)).toEqual(['Emotion scenarios', 'Situational judgment', 'Word links', 'Unusual uses (experimental)'])
    expect(rows.map((r) => r.group)).toEqual([axis('EMO').name, axis('EMO').name, axis('CRE').name, axis('CRE').name])
    for (const r of rows) expect(r).toMatchObject({ tier: 'c', glyph: GLYPH_C })
    // Counts and thresholds are as ever: 6, 3, 5 and 5 items, the 3-item facet short of the ≥ 5 bar.
    expect(rows.map((r) => [r.nItems, r.measured])).toEqual([
      [6, true],
      [3, false],
      [5, true],
      [5, true],
    ])
    expect(rows[1]).toMatchObject({ reason: 'insufficient_data' })
  })

  it('hatches the measured facets of a tier (c) axis in the facet sub-blob, and stubs the rest', () => {
    const rows = clusterRows(axisEstimates({ score: M6_SCORE }))
    const model = buildBlob(rows)
    expect(hatchIds(model).sort()).toEqual(['CRE:alternative_uses', 'CRE:remote_associates', 'EMO:appraisal_vignettes'])
    const sj = spokeOf(model, 'EMO:situational_judgment')
    expect(sj.measured).toBe(false)
    expect(sj.lines.at(-1)).toEqual({ text: 'insufficient data', note: true, glyph: false })
    expect(sj.glyph).toBe(GLYPH_C)
  })

  it('keeps "(experimental)" on the chart label of the alternative-uses facet, at every layout', () => {
    const rows = clusterRows(axisEstimates({ score: M6_SCORE }))
    const layouts = [{ fontSize: 12.5, compact: false }, { fontSize: 12.5, compact: true }, fitLayout(rows, 280), fitLayout(rows, 900)]
    for (const layout of layouts) {
      const s = spokeOf(buildBlob(rows, { layout }), 'CRE:alternative_uses')
      const text = s.lines.filter((l) => !l.note).map((l) => l.text).join(' ')
      expect(text, JSON.stringify(layout)).toBe('Unusual uses (experimental)')
      expect(s.lines.filter((l) => l.glyph)).toHaveLength(1)
    }
    // No other facet label says "experimental".
    for (const id of ['EMO:appraisal_vignettes', 'EMO:situational_judgment', 'CRE:remote_associates']) {
      expect(spokeOf(buildBlob(rows), id).lines.map((l) => l.text).join(' ')).not.toMatch(/experimental/)
    }
  })

  it('while EMO and CRE are not measured (M1), their facets are "not measured" stubs: no number, no hatch', () => {
    const p = syntheticProfile('m1')!
    const est = axisEstimates(p.input)
    const rows = clusterFacets(p.input.score, [], 'Social-Creative', { catalog: M6_CATALOG, unmeasured: unmeasuredReasons(est) })
    expect(rows).toHaveLength(4)
    for (const r of rows) {
      expect(r).toMatchObject({ measured: false, reason: 'not_yet_available', muted: false })
      expect(r.theta).toBeUndefined()
    }
    // Even the facet name that carries a label of its own gives no number on an unmeasured axis.
    expect(rows.find((r) => r.facet === 'alternative_uses')!.shortLabel).toEqual(['Unusual uses (experimental)'])
    const model = buildBlob(rows)
    expect(model.hatch).toEqual([])
    for (const s of model.spokes) expect(s.lines.at(-1)).toEqual({ text: 'not measured', note: true, glyph: false })
  })
})

// ------------------------------------------------------------------------------- the card

describe('the share card with tier (c) skills (§9.9, R-5.6.4)', () => {
  /** Hatch paths and ◇ labels drawn on a card. */
  const hatchCount = (svg: string): number => (svg.match(/<path class="hatch"/g) ?? []).length
  // The glyph follows its label line after a no-break space (U+00A0), so it never wraps onto a line of its own.
  const glyphLabels = (svg: string): number => (svg.match(/<tspan[^>]*>[^<]*\u00a0◇<\/tspan>/g) ?? []).length
  const everyText = (svg: string): string => [...svg.matchAll(/<(?:text|tspan|title|desc)\b[^>]*>([^<]+)<\/(?:text|tspan|title|desc)>/g)].map((m) => m[1]).join('\n')
  const facetWords = Object.values(FACET_LABELS)

  /** EMO and CRE facet rows over the M6 observations, with one EMO facet far below 0 SD (a low). */
  const lowEmoFacets = (): FacetEstimate[] =>
    clusterFacets(M6_SCORE, M6_OBS, 'Social-Creative', {
      catalog: M6_CATALOG,
      precomputed: { EMO: { situational_judgment: { mean: -1.9, sd: 0.3, n: 8 } } },
    })

  it('a measured high EMO and a measured CRE both appear, hatched, with ◇ on their labels', () => {
    const est = measure(measure(FULL, ['EMO'], 1.2), ['CRE'], 0.9)
    const card = buildCard({ estimates: est, sessions: 2 })
    expect(card.shown).toEqual(expect.arrayContaining([...TIER_C]))
    expect(hatchCount(card.svg)).toBe(2)
    expect(glyphLabels(card.svg)).toBe(2)
  })

  it('a low EMO is not drawn, hatched or marked, with an EMO facet present; CRE is unaffected', () => {
    const est = measure(FULL, ['EMO'], -1.6)
    const facets = lowEmoFacets()
    expect(facets.find((f) => f.id === 'EMO:situational_judgment')).toMatchObject({ measured: true, theta: -1.9 })
    const card = buildCard({ estimates: est, sessions: 2 })
    expect(cardAxes(est).find((a) => a.estimate.code === 'EMO')!.status).toBe('withheld')
    expect(card.shown).not.toContain('EMO')
    expect(card.shown).toContain('CRE')
    expect(hatchCount(card.svg)).toBe(1)
    expect(glyphLabels(card.svg)).toBe(1)
    const text = everyText(card.svg) + '\n' + card.alt + '\n' + card.inner
    expect(text).not.toMatch(/Emotion|scenarios|Situational/i)
    // No facet name is ever on a card, low or high.
    for (const w of facetWords) expect(text).not.toContain(w)
  })

  it('facet rows cannot reach the card: smuggled into the input, they change no byte', () => {
    for (const theta of [-2.2, -0.3, 0.6, 1.8]) {
      const est = measure(FULL, ['EMO'], theta)
      const plain = buildCard({ estimates: est, sessions: 2 })
      const smuggled: CardInput & { facets: FacetEstimate[]; facetObservations: readonly FacetObservation[] } = {
        estimates: est,
        sessions: 2,
        facets: lowEmoFacets(),
        facetObservations: M6_OBS,
      }
      const card = buildCard(smuggled)
      expect(card.svg, `θ = ${theta}`).toBe(plain.svg)
      for (const w of facetWords) expect(everyText(card.svg)).not.toContain(w)
    }
  })

  it('an EMO low is withheld whatever the facets and peaks say, byte for byte like a hidden one', () => {
    const est = measure(FULL, ['EMO'], -1.1)
    const plain = buildCard({ estimates: est, sessions: 2 })
    const peaks = [{ code: 'EMO' as const, name: axis('EMO').name, contrast: 1.4, lo90: 0.5, hi90: 2.3 }]
    const withPeak = buildCard({ estimates: est, peaks, sessions: 2 })
    expect(withPeak.peaks.map((p) => p.code)).not.toContain('EMO')
    expect(withPeak.svg).toBe(plain.svg)
    expect(buildCard({ estimates: est, hidden: ['EMO'], sessions: 2 }).svg).toBe(plain.svg)
    expect(buildCard({ estimates: measure(FULL, ['EMO'], -3, 0.2), sessions: 2 }).svg).toBe(plain.svg)
  })

  it('EMO is on the card, hatched and marked, exactly when its estimate is at or above 0 SD (property)', () => {
    fc.assert(
      fc.property(fc.double({ min: -3, max: 3, noNaN: true }), fc.double({ min: 0.05, max: 1.2, noNaN: true }), (theta, sd) => {
        const est = measure(FULL, ['EMO'], theta, sd)
        const card = buildCard({ estimates: est, sessions: 1 })
        const on = theta >= 0
        expect(card.shown.includes('EMO')).toBe(on)
        // CRE is always shown here; EMO adds a hatch and a ◇ label only when it is on the card.
        expect(hatchCount(card.svg)).toBe(on ? 2 : 1)
        expect(glyphLabels(card.svg)).toBe(on ? 2 : 1)
        if (!on) expect(everyText(card.svg)).not.toMatch(/Emotion/)
      }),
      { numRuns: 40 },
    )
  })

  it('unmeasured EMO and CRE (the M1 session) are not on the card at all, so no hatch or ◇', () => {
    const card = buildCard({ estimates: M1, sessions: 1 })
    expect(card.shown).not.toContain('EMO')
    expect(card.shown).not.toContain('CRE')
    expect(hatchCount(card.svg)).toBe(0)
    expect(everyText(card.svg)).not.toContain(GLYPH_C)
  })
})
