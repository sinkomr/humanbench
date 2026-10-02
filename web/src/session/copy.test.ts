import { describe, expect, it } from 'vitest'
import design from '../../../docs/DESIGN.md?raw'
import * as copy from './copy'

/** The quoted honour-code sentence of DESIGN §13. */
function designHonourCode(md: string): string {
  const match = /\*\*Honour code\*\*[^"\n]*"([^"\n]+)"/.exec(md)
  if (!match?.[1]) throw new Error('DESIGN §13 honour code not found in docs/DESIGN.md')
  return match[1]
}

describe('session copy (M1.15; DESIGN §13)', () => {
  it('the honour code is word for word DESIGN §13', () => {
    expect(copy.HONOUR_TEXT).toBe(designHonourCode(design))
  })

  it('the gate says 18 or older, and the privacy notice covers what DESIGN §13 lists', () => {
    expect(copy.GATE_AGREE).toContain('18 or older')
    expect(copy.GATE_POINTS).toHaveLength(3) // "a terms/privacy summary (3 bullets + link)"
    const notice = copy.PRIVACY_SECTIONS.flatMap((s) => [s.heading, ...s.paragraphs]).join('\n')
    expect(notice).toContain('Controller: TODO(user)')
    expect(notice).toContain('Contact: TODO(user)')
    expect(notice).toMatch(/24 months/) // the retention DESIGN §13 drafts
    expect(notice).toMatch(/consent/)
    expect(notice).toMatch(/18 or older/)
  })

  it('gives every skip and finish confirmation a way to keep going, and explains what skipping does', () => {
    expect(copy.SKIP_CONFIRM_NO).toBe('Keep going')
    expect(copy.FINISH_CONFIRM_NO).toBe('Keep going')
    expect(copy.SKIP_CONFIRM_TEXT).toMatch(/not measured/)
    expect(copy.noticeUnavailable('Spatial')).toMatch(/skip Spatial/)
  })

  it('never comments on a counted answer (DESIGN §10): only practice copy speaks of right or wrong', () => {
    const counted = [copy.CONFIDENCE_LEGEND, copy.confidenceHint(25, 4), copy.confidenceHint(0, null), copy.NOTICE_TIMEOUT, copy.NOTICE_TIMEOUT_SERVED, copy.NOTICE_MALFORMED]
    for (const t of counted) expect(t).not.toMatch(/\bcorrect\b(?!ly)|incorrect|wrong/i)
    // The legend asks how sure the person is; the time-out notice says the item counts as not answered correctly.
    // On the server a time-out is no answer at all, left out of the scores (R-11.1), and its notice says so.
    expect(copy.NOTICE_TIMEOUT_SERVED).toMatch(/left out/)
    expect(copy.NOTICE_TIMEOUT_SERVED).not.toMatch(/counts as/)
    expect(copy.PRACTICE_CORRECT).toMatch(/correct/)
  })
})

describe('summaryLine', () => {
  it('counts in the singular and the plural', () => {
    expect(copy.summaryLine(1, 1, 1)).toBe('You answered 1 question and completed 1 timed task in about 1 min.')
    expect(copy.summaryLine(0, 7, 28)).toBe('You answered 0 questions and completed 7 timed tasks in about 28 min.')
  })
})
