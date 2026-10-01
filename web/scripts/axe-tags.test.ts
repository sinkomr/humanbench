/**
 * The axe scan of the e2e suite (`e2e/axe.ts`) leaves out only rules that cannot fail a page (ROADMAP M1.A, M1.21;
 * DESIGN §13). axe tags each rule with the standard it comes from, and a scan that names tags runs only the rules
 * carrying one of them. The scan names the WCAG 2.0/2.1/2.2 A and AA tags and `best-practice`; a rule that carries
 * none of them is never run, so a serious rule filed under another tag would never fail the sweep. This test lists
 * what the tags leave out, in the installed axe-core, and fails when a rule that is not AAA or retired is among them.
 */

import axe from 'axe-core'
import { describe, expect, it } from 'vitest'
import { BLOCKING_IMPACTS, REPORT_TAGS, WCAG_AA_TAGS } from '../e2e/axe'

/** Tags of rules that are off by default and are not asked for: level AAA success criteria and retired rules. */
const OUT_OF_SCOPE = ['wcag2aaa', 'wcag21aaa', 'wcag22aaa', 'deprecated']

describe('the axe rule set of the e2e suite (M1.21)', () => {
  it('is the WCAG A/AA tags and the best-practice rules, split by impact between the two helpers', () => {
    expect([...REPORT_TAGS].sort()).toEqual([...WCAG_AA_TAGS, 'best-practice'].sort())
    expect([...BLOCKING_IMPACTS].sort()).toEqual(['critical', 'serious'])
  })

  it('runs the best-practice rules that are rated serious, which the WCAG tags alone would miss', () => {
    const run = new Set(axe.getRules([...REPORT_TAGS]).map((r) => r.ruleId))
    const wcagOnly = new Set(axe.getRules([...WCAG_AA_TAGS]).map((r) => r.ruleId))
    for (const id of ['tabindex', 'label-title-only', 'aria-dialog-name', 'accesskeys']) {
      expect(run.has(id), `${id} runs in the scan`).toBe(true)
      expect(wcagOnly.has(id), `${id} is not a WCAG-tagged rule`).toBe(false)
    }
  })

  it('leaves out only AAA and retired rules', () => {
    const left = axe.getRules().filter((r) => !r.tags.some((t) => REPORT_TAGS.includes(t)))
    const surprising = left.filter((r) => !r.tags.some((t) => OUT_OF_SCOPE.includes(t))).map((r) => `${r.ruleId} [${r.tags.join(', ')}]`)
    expect(surprising, 'rules the scan never runs: add their tag to REPORT_TAGS, or say here why they are out of scope').toEqual([])
  })
})
