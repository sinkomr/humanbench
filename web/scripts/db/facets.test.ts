/**
 * The server's facets match the app's drill-down (UX review D4, a provisional default; viz/facets.ts), checked on
 * the SQL text (no database; `npm run test:db` runs the same function, rescore.db.test.ts):
 *   - 20261007000100_rescore_facets.sql re-creates rescore exactly as 20261004000100_response_archive.sql did, with
 *     only the two edits its header names (the drill-down facet; a facet's mean and sd are its axis's);
 *   - hb.drill_facet lists every quant template once, under the group of tasks/quant/topics.ts.
 */

import { describe, expect, it } from 'vitest'
import { QUANT_GROUPS } from '../../src/tasks/quant/topics'
import { QUANT_TEMPLATES } from '../../src/tasks/quant/templates'
import { drillFacet } from '../../src/viz/facets'
import { MIGRATIONS_DIR, readMigrations } from './sql'

const migrations = readMigrations(MIGRATIONS_DIR)
const byName = (suffix: string): string => migrations.find((m) => m.name.endsWith(suffix))!.sql
const facetsSql = byName('_rescore_facets.sql')

/** The text of `create [or replace] function <name>(` up to its closing `$$;`. */
function functionText(sql: string, name: string): string {
  const start = sql.search(new RegExp(`create\\s+(?:or\\s+replace\\s+)?function\\s+${name.replace('.', '\\.')}\\s*\\(`))
  expect(start, name).toBeGreaterThanOrEqual(0)
  return sql.slice(start, sql.indexOf('\n$$;', start) + 4)
}

describe('rescore facets (UX review D4)', () => {
  it('is re-created twice since: by the remaining families (Gaussian and GRM answers, 20261015000200_continuous_items.sql), which keeps every line of it but the grid sum, then by the server\'s Calibration (20261015000400_server_calibration.sql, which keeps that body but for CAL)', () => {
    const recreating = migrations.filter((m) => /create\s+(?:or\s+replace\s+)?function\s+public\.rescore\s*\(/i.test(m.sql)).map((m) => m.name)
    expect(recreating.slice(-3)).toEqual(['20261007000100_rescore_facets.sql', '20261015000200_continuous_items.sql', '20261015000400_server_calibration.sql'])
    const facets = functionText(facetsSql, 'public.rescore').split('\n').map((l) => l.trim()).filter((l) => l !== '' && !l.startsWith('--'))
    const now = functionText(byName('_continuous_items.sql'), 'public.rescore').split('\n').map((l) => l.trim()).filter((l) => l !== '' && !l.startsWith('--'))
    // the lines that gained the continuous observation (cobs, the parameter row's extra) and the grid sum that became the
    // 2PL/3PL branch of a union with the continuous terms; every other line is there, in order
    const replaced = new Set([
      'r.response) as in_space',
      'select ip.model, ip.a, ip.b, ip.c',
      'select c.session_id, c.started_utc, c.counts, c.correct, c.axis, c.facet, c.model, c.a, c.b, c.c,',
      "select c.axis, coalesce(c.facet, '') as facet, c.a, c.b, c.c, c.y,",
      'select c0.session_id, c0.axis, hb.drill_facet(c0.axis, c0.facet) as facet, c0.a, c0.b - r.rho as b, c0.c, c0.correct as y',
      'pg_catalog.sum(',
      'end) as ll',
      'group by o.axis, o.facet, o.facet_ok, gr.i, gr.g',
    ])
    let at = 0
    for (const line of facets) {
      if (replaced.has(line)) continue
      const found = now.indexOf(line, at)
      expect(found, line).toBeGreaterThanOrEqual(0)
      at = found + 1
    }
  })

  it('re-creates rescore as before, with only the drill-down facet and the leave-facet-out facets changed', () => {
    const before = functionText(byName('_response_archive.sql'), 'public.rescore')
    const now = functionText(facetsSql, 'public.rescore')
    // 1. every counted answer under its drill-down facet (hb.drill_facet), for the per-session minimum too
    const obsBefore = before.slice(before.indexOf('    -- the answers that count.'), before.indexOf('    grid as ('))
    const obsNow = now.slice(now.indexOf('    -- the answers that count,'), now.indexOf('    grid as ('))
    expect(obsNow).toContain('hb.drill_facet(c0.axis, c0.facet) as facet')
    expect(obsNow).toContain('partition by c.session_id, c.axis, c.facet')
    // 2. no facet grid of its own: a facet takes its axis's mean and sd (leave-facet-out is exact on the grid)
    const facetsBefore = before.slice(before.indexOf('    -- every axis here has a session'), before.indexOf("    select pg_catalog.jsonb_build_object(\n      'retest_version'"))
    const facetsNow = now.slice(now.indexOf('    -- every axis here has a session'), now.indexOf("    select pg_catalog.jsonb_build_object(\n      'retest_version'"))
    expect(facetsNow).not.toMatch(/facet_w|facet_mean/)
    expect(facetsNow).toContain('select o.axis, o.facet, e.mean, e.sd, pg_catalog.count(*) as n')
    // and nothing else
    expect(now.replace(obsNow, '<obs>').replace(facetsNow, '<facets>')).toBe(before.replace(obsBefore, '<obs>').replace(facetsBefore, '<facets>'))
  })

  it('maps every quant template to its topic group in hb.drill_facet, once each, and names no other', () => {
    // The latest migration that (re)defines it: 20261016000100_quant_hard_facets.sql for quant 1.4.0 (M3.12).
    const defining = migrations.filter((m) => /create\s+(?:or\s+replace\s+)?function\s+hb\.drill_facet\s*\(/i.test(m.sql))
    expect(defining.map((m) => m.name)).toEqual(['20261007000100_rescore_facets.sql', '20261016000100_quant_hard_facets.sql'])
    const body = functionText(defining[defining.length - 1]!.sql, 'hb.drill_facet')
    const pairs = [...body.matchAll(/\('([a-z0-9_]+)', '(quant\/[a-z_]+)'\)/g)].map((m) => [m[1]!, m[2]!] as const)
    expect(pairs.map(([t]) => t).sort()).toEqual([...QUANT_TEMPLATES].sort())
    for (const [t, g] of pairs) expect(g, t).toBe(drillFacet('QR', t))
    expect(new Set(pairs.map(([, g]) => g))).toEqual(new Set(QUANT_GROUPS.map((g) => g.id)))
    expect(body).toMatch(/when p_axis = 'QR' then/)
  })
})
