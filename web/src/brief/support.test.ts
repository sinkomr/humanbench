/** The drawer, "what to look for", for-ai.md and the control-word card. */

import { describe, expect, it } from 'vitest'
import { cardWords, controlWordCardSvg } from './card'
import { DEFAULT_GATES, type GateFile } from './gates'
import { EXPLANATION_SETTINGS, MODE_TABLE, forAiMarkdown } from './forai'
import { TEMPLATES } from './grammar'
import { lintLine } from './lint'
import { NOTHING_APPEARS, whatToLookFor } from './look'
import { destination } from './surfaces'
import { BENEFIT_RE } from './testing'
import { checkedText, drawerRows } from './why'

describe('drawerRows ("Why this line?")', () => {
  const dest = destination('chatgpt_instructions')!

  it('answers the five questions of R-17.8 for every line type, with no number about the person', () => {
    for (const t of TEMPLATES) {
      const rows = drawerRows([t.id], DEFAULT_GATES, dest)
      expect(rows.map((r) => r.label), t.id).toEqual(['Why this line', 'How sure', 'What the research says', 'Checked with', 'What would change it'])
      for (const r of rows) {
        expect(r.text.length, `${t.id} ${r.label}`).toBeGreaterThan(5)
        expect(r.text, `${t.id} ${r.label}`).not.toMatch(/\d/)
        // A22: no drawer implies benefit (the drawer for every line, not only the research text).
        expect(r.text, `${t.id} ${r.label}`).not.toMatch(BENEFIT_RE)
        expect(lintLine(r.text).filter((h) => h.rule === 'a13'), t.id).toEqual([])
      }
    }
  })

  it('words the basis by kind: fixed clauses, defaults for everyone, and the person\'s own choice', () => {
    expect(drawerRows(['F1'], DEFAULT_GATES)[0]?.text).toContain('fixed clause')
    expect(drawerRows(['U5'], DEFAULT_GATES)[0]?.text).toContain('default for everyone')
    expect(drawerRows(['DS'], DEFAULT_GATES)[0]?.text).toBe('You chose it.')
    expect(drawerRows(['DS'], DEFAULT_GATES)[1]?.text).toContain('your own setting')
    expect(drawerRows(['DS'], DEFAULT_GATES)[2]?.text).toBe('Research on teaching supports matching depth to what you already know; not yet tested for AI notes.')
    expect(drawerRows(['DS'], DEFAULT_GATES)[4]?.text).toBe('You, at any time.')
  })

  it('treats a merged line as its most personal part, and marks unchecked personal lines experimental', () => {
    const merged = drawerRows(['U2', 'W3'], DEFAULT_GATES)
    expect(merged[0]?.text).toBe('You chose it.')
    expect(merged[1]?.text).toContain('experimental')
    expect(drawerRows(['F1'], DEFAULT_GATES)[1]?.text).not.toContain('experimental')
  })

  it('never implies the person\'s own assistant was tested when it was not', () => {
    expect(checkedText(DEFAULT_GATES, ['DS'], dest)).toBe('Checked with: not yet checked. On ChatGPT custom instructions: not yet checked.')
    const gates: GateFile = {
      ...DEFAULT_GATES,
      lines: { ...DEFAULT_GATES.lines, DS: { v: '1', status: 'experimental', families: ['Claude', 'Qwen'], checked: '2026-12' } },
      surfaces: { chatgpt_instructions: { date: '2026-12', result: 'pass' } },
    }
    expect(checkedText(gates, ['DS'], dest)).toBe('Checked with: Claude and Qwen (2026-12). On ChatGPT custom instructions: checked 2026-12, worked as expected.')
    const failed: GateFile = { ...gates, surfaces: { chatgpt_instructions: { date: '2026-12', result: 'fail' } } }
    expect(checkedText(failed, ['DS'], dest)).toContain('did not pass')
    expect(checkedText({ ...gates, lines: { ...gates.lines, DS: { v: '0', status: 'shipped', families: ['Claude'] } } }, ['DS'])).toBe('Checked with: not yet checked.')
  })

  it('returns nothing for no line', () => {
    expect(drawerRows([], DEFAULT_GATES)).toEqual([])
  })
})

describe('whatToLookFor', () => {
  it('gives one entry per behaviour present in the notes and none for lines that are not there', () => {
    expect(whatToLookFor(['F1', 'DS'])).toEqual(['On skip-the-basics topics it goes straight to the method and says when it skipped routine steps.'])
    expect(whatToLookFor(['DA', 'U6c', 'VOICE', 'CC']).length).toBe(4)
    expect(whatToLookFor(['F1'])).toEqual([])
    expect(whatToLookFor(['U4.t'])).toEqual(['On ask-first topics it asks you one quick question, once per conversation, then pitches to your answer.'])
    expect(NOTHING_APPEARS).toContain('start a new chat')
  })
})

describe('for-ai.md', () => {
  const md = forAiMarkdown()

  it('documents the three settings and the mode-by-setting table of proposal 4.6 and 4.7', () => {
    expect(EXPLANATION_SETTINGS.map((s) => s.name)).toEqual(['Build up', 'Meet me first', 'Skip the basics'])
    expect(MODE_TABLE.map((m) => m.setting)).toEqual(['Skip the basics', 'Meet me first', 'Build up'])
    expect(md).toContain('| Setting | Starts here when | Steps shown |')
    expect(md).toContain('| Setting | Just do it | Teach me | Challenge me |')
    expect(md).toContain('| Build up | A build-up topic |')
    expect(md).toContain('Falls back to teach me')
  })

  it('has no link, is deterministic, states the claim, and uses no clinical word', () => {
    expect(md).not.toMatch(/https?:|www\.|\]\(/)
    expect(forAiMarkdown()).toBe(md)
    expect(md).toContain('not yet shown to help HumanBench users')
    expect(md.replace('not yet shown to help HumanBench users', '')).not.toMatch(BENEFIT_RE)
    expect(lintLine(md).filter((h) => h.rule === 'a13' || h.rule === 'ascii')).toEqual([])
  })

  it('is not part of the notes: no template mentions it', () => {
    for (const t of TEMPLATES) expect(`${t.long ?? ''}${t.short ?? ''}`.toLowerCase()).not.toContain('for-ai')
  })
})

describe('control-word card', () => {
  it('lists the words the notes define, in order, and nothing else', () => {
    expect(cardWords({ 'teach me': 'learn', 'just do it': 'do', 'challenge me': 'challenge' }).map((w) => w.word)).toEqual(['teach me', 'just do it', 'challenge me'])
    // in learn mode "teach me" is the default and is not defined by a line, but it is still a word you can say
    expect(cardWords({ 'just do it': 'do', 'challenge me': 'challenge' }).map((w) => w.word)).toEqual(['teach me', 'just do it', 'challenge me'])
    expect(cardWords({ deeper: 'up', 'more steps': 'down', 'just do it': 'do' }).map((w) => w.word)).toEqual(['teach me', 'just do it', 'deeper', 'more steps'])
    expect(cardWords({})).toEqual([])
    expect(controlWordCardSvg({})).toBeNull()
  })

  it('is a self-contained, labelled SVG with the words and no script or link', () => {
    const svg = controlWordCardSvg({ 'teach me': 'learn', 'just do it': 'do', 'challenge me': 'challenge' })!
    expect(svg.startsWith('<svg ')).toBe(true)
    expect(svg).toContain('role="img"')
    expect(svg).toContain('Words you can say to your assistant')
    expect(svg).toContain('>teach me<')
    expect(svg).not.toMatch(/<script|href|onload|javascript:/i)
    expect(lintLine(svg.replace(/<[^>]+>/g, ' ')).filter((h) => h.rule === 'a13')).toEqual([])
  })
})
