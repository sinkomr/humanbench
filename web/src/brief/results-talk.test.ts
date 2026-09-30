/**
 * The results-talk text (AI.6b; requirement R-17.13; gate metric E22): the preamble is the approved
 * 340 characters, says nothing about the person's results, uses no clinical word, is pinned by hash
 * so a wording change needs a new version (ADR A22), and its status comes from the gates file.
 */

import { describe, expect, it } from 'vitest'
import pins from './__fixtures__/wording-pins.json'
import drafts from './__fixtures__/proposal/ui-copy.txt?raw'
import helper from './__fixtures__/proposal/results-helper.txt?raw'
import raw from './brief-gates.json'
import { CLAIM } from './copy'
import { DEFAULT_GATES } from './gates'
import { lintLine } from './lint'
import { NOTES_LEAK_MARKERS } from './leak-markers'
import { PREAMBLE, RESULTS_TALK, RESULTS_TALK_ID, RESULTS_TALK_TEXT, RESULTS_TALK_V, REVEAL_CARD } from './results-talk'
import { resultsTalkStatus } from './results-talk-gate'
import { BENEFIT_RE } from './testing'

const sha256 = async (s: string): Promise<string> => [...new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s)))].map((b) => b.toString(16).padStart(2, '0')).join('')

describe('the preamble', () => {
  it('is the approved text, 340 characters, word for word', () => {
    expect(PREAMBLE).toBe(helper.trim())
    expect(PREAMBLE.length).toBe(340)
    expect(RESULTS_TALK_TEXT).toBe(drafts.split('\n').find((l) => l.startsWith('Talking about your results with an AI?')))
    expect(RESULTS_TALK_TEXT).toBe(
      'Talking about your results with an AI? Paste this first. Never paste your save file: it holds your raw answers, and assistants may keep or learn from what you paste.',
    )
  })

  it('has 0 A13 hits, no digits, no markup, and is plain ASCII', () => {
    for (const t of [PREAMBLE, ...Object.values(RESULTS_TALK), ...Object.values(REVEAL_CARD), RESULTS_TALK_TEXT]) {
      expect(lintLine(t).filter((h) => h.rule === 'a13' || h.rule === 'digit' || h.rule === 'ascii'), t).toEqual([])
    }
    expect(/[^\x20-\x7E]/.test(PREAMBLE)).toBe(false)
  })

  it('asks the assistant for the three things E22 measures, and gives it no result of the person\'s', () => {
    expect(PREAMBLE).toContain('Ranges that overlap are not real differences')
    expect(PREAMBLE).toContain('Don\'t turn them into an intelligence number, a rank against other people or one overall figure')
    expect(PREAMBLE).toContain('Don\'t guess at health or medical explanations')
    // it is the same words for everyone: no name of an axis, no number, no level
    expect(PREAMBLE).not.toMatch(/\d|\baxis\b|\baxes\b|percentile|theta|\bSD\b|reasoning|memory|vocabulary|quantitative|spatial/i)
  })

  it('never says or implies the notes or the preamble help (A22)', () => {
    for (const t of [...Object.values(RESULTS_TALK), ...Object.values(REVEAL_CARD)]) expect(BENEFIT_RE.test(t), t).toBe(false)
    expect(BENEFIT_RE.test(PREAMBLE.replace('Help me think', 'Think with me'))).toBe(false)
  })

  it('words the reveal card as purpose only: no outcome ("so it ...", "the way you like") and no promise, since it carries no CLAIM sentence (A22, proposal 3.7)', () => {
    // BENEFIT_RE catches benefit words; an outcome clause is a benefit claim without one, so it is checked here too.
    const OUTCOME_RE = /\bso (?:it|that|the assistant|you|answers?)\b|\bthe way you (?:like|want|prefer)\b|\bexplains? (?:things )?(?:better|clearly|well)\b|\bfits? you\b/i
    for (const t of Object.values(REVEAL_CARD)) expect(OUTCOME_RE.test(t), t).toBe(false)
    expect(REVEAL_CARD.body).toContain('tell your own AI assistant how you like explanations')
    expect(REVEAL_CARD.body).not.toContain(CLAIM)
  })

  it('is pinned by hash: a wording change needs a new version and a new pin (the wording is the treatment)', async () => {
    const table = pins.pins as Record<string, Record<string, string>>
    const pinned = table[RESULTS_TALK_ID]?.[RESULTS_TALK_V]
    expect(pinned, `add "${RESULTS_TALK_V}": "${await sha256(JSON.stringify([PREAMBLE, 'same']))}" under "${RESULTS_TALK_ID}" in wording-pins.json`).toBeDefined()
    expect(await sha256(JSON.stringify([PREAMBLE, 'same'])), 'the preamble changed but its version did not').toBe(pinned)
    expect(await sha256(JSON.stringify([`${PREAMBLE} `, 'same']))).not.toBe(pinned)
  })
})

describe('its gate status (A22, E22)', () => {
  it('has an entry in the bundled gates file at the current version, and ships', () => {
    expect(raw.lines.RT).toEqual({ v: RESULTS_TALK_V, status: 'shipped' })
    expect(resultsTalkStatus()).toBe('shipped')
    expect(resultsTalkStatus(DEFAULT_GATES)).toBe('shipped')
  })

  it('follows an entry for the current wording, and ignores other wording, unknown statuses and a missing entry', () => {
    const g = (e: unknown): { lines: Record<string, unknown> } => ({ lines: { RT: e } })
    expect(resultsTalkStatus(g({ v: '1', status: 'blocked' }) as never)).toBe('blocked')
    expect(resultsTalkStatus(g({ v: '1', status: 'experimental' }) as never)).toBe('experimental')
    expect(resultsTalkStatus(g({ v: '0', status: 'blocked' }) as never)).toBe('shipped')
    expect(resultsTalkStatus(g({ v: '1', status: 'wonderful' }) as never)).toBe('shipped')
    expect(resultsTalkStatus({ lines: {} })).toBe('shipped')
    expect(resultsTalkStatus({})).toBe('shipped')
  })
})

describe('what a share card must not contain', () => {
  it('lists the notes and results-talk strings, none of them empty or short enough to match ordinary words', () => {
    expect(NOTES_LEAK_MARKERS.length).toBeGreaterThanOrEqual(6)
    for (const m of NOTES_LEAK_MARKERS) expect(m.length, m).toBeGreaterThan(10)
    expect(NOTES_LEAK_MARKERS).toContain('Notes for your AI')
    expect(NOTES_LEAK_MARKERS).toContain(RESULTS_TALK.neverPaste)
  })
})

const sources = import.meta.glob<string>(['./results-talk.ts', './results-talk-gate.ts'], { query: '?raw', import: 'default', eager: true })
const importsOf = (file: string): (string | undefined)[] => [...(sources[file] ?? '').matchAll(/^import .* from '([^']+)'/gm)].map((m) => m[1])

describe('the modules stay light', () => {
  it('the texts import nothing, and the gate module imports only the gates file and the texts: no grammar, topics or gates code reaches the reveal screens', () => {
    expect(Object.keys(sources).sort()).toEqual(['./results-talk-gate.ts', './results-talk.ts'])
    expect(importsOf('./results-talk.ts')).toEqual([])
    expect(importsOf('./results-talk-gate.ts')).toEqual(['./brief-gates.json', './results-talk'])
  })
})
