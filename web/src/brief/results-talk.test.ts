/**
 * The results-talk text (AI.6b; requirement R-17.13; gate metric E22): the preamble is wording
 * version 2 (346 characters), says nothing about the person's results, uses no clinical word, is
 * pinned by hash so a wording change needs a new version (ADR A22), and its status comes from the
 * gates file. Version 1 is the proposal text (`__fixtures__/proposal/results-helper.txt`, 340
 * characters, "Ranges that overlap are not real differences."); version 2 is the owner decision of
 * 2026-10-05 (UX-REVIEW D2), which replaced that sentence because it is not true of overlapping 90%
 * ranges, in the same change that added the "what comes next" sentence to the screen text (D18).
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

/** The sentence of wording version 1 (the proposal text): wrong for overlapping 90% ranges, retired by the owner on 2026-10-05. */
const V1_OVERLAP = 'Ranges that overlap are not real differences.'
/** The replacement (wording version 2). */
const V2_OVERLAP = 'Where ranges overlap, a difference may not be real.'
/** What comes after "Paste this first." on the screen (UX-REVIEW D18). */
const NEXT = 'Then describe your results in your own words, or attach your share card picture.'
/** The preamble hash, as in `wording-pins.json`. */
const pinOf = (preamble: string): Promise<string> => sha256(JSON.stringify([preamble, 'same']))

describe('the preamble', () => {
  it('is wording version 2: the proposal text (version 1, 340 characters) with the overlap sentence replaced, 346 characters', () => {
    const v1 = helper.trim()
    expect(v1.length).toBe(340)
    expect(v1).toContain(V1_OVERLAP)
    expect(RESULTS_TALK_V).toBe('2')
    expect(PREAMBLE).toBe(v1.replace(V1_OVERLAP, V2_OVERLAP))
    expect(PREAMBLE.length).toBe(346)
    expect(PREAMBLE).toContain(V2_OVERLAP)
  })

  it('has a screen text that is the proposal draft (version 1) with the "what comes next" sentence after "Paste this first." (D18)', () => {
    const draft = drafts.split('\n').find((l) => l.startsWith('Talking about your results with an AI?'))
    expect(draft).toBe('Talking about your results with an AI? Paste this first. Never paste your save file: it holds your raw answers, and assistants may keep or learn from what you paste.')
    expect(RESULTS_TALK_TEXT).toBe(draft?.replace('Paste this first.', `Paste this first. ${NEXT}`))
    expect(RESULTS_TALK.paste).toBe(`Paste this first. ${NEXT}`)
    expect(RESULTS_TALK_TEXT).toBe(
      'Talking about your results with an AI? Paste this first. Then describe your results in your own words, or attach your share card picture. Never paste your save file: it holds your raw answers, and assistants may keep or learn from what you paste.',
    )
  })

  it('does not say, anywhere in the texts, that ranges that overlap are not real differences', () => {
    const texts = [PREAMBLE, RESULTS_TALK_TEXT, ...Object.values(RESULTS_TALK), ...Object.values(REVEAL_CARD)]
    for (const t of texts) expect(t, t).not.toContain(V1_OVERLAP)
    for (const t of texts) expect(t, t).not.toMatch(/overlap\w*[^.]{0,40}\bnot real\b/i)
  })

  it('has 0 A13 hits, no digits, no markup, and is plain ASCII', () => {
    for (const t of [PREAMBLE, ...Object.values(RESULTS_TALK), ...Object.values(REVEAL_CARD), RESULTS_TALK_TEXT]) {
      expect(lintLine(t).filter((h) => h.rule === 'a13' || h.rule === 'digit' || h.rule === 'ascii'), t).toEqual([])
    }
    expect(/[^\x20-\x7E]/.test(PREAMBLE)).toBe(false)
  })

  it('asks the assistant for the three things E22 measures, and gives it no result of the person\'s', () => {
    expect(PREAMBLE).toContain('Where ranges overlap, a difference may not be real')
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
    expect(pinned, `add "${RESULTS_TALK_V}": "${await pinOf(PREAMBLE)}" under "${RESULTS_TALK_ID}" in wording-pins.json`).toBeDefined()
    expect(await pinOf(PREAMBLE), 'the preamble changed but its version did not').toBe(pinned)
    expect(await pinOf(`${PREAMBLE} `)).not.toBe(pinned)
  })

  it('keeps the pin of version 1 (the proposal text) and gives version 2 its own: the two differ', async () => {
    const table = pins.pins as Record<string, Record<string, string>>
    const rt = table[RESULTS_TALK_ID] ?? {}
    expect(Object.keys(rt).sort()).toEqual(['1', '2'])
    expect(await pinOf(helper.trim()), 'version 1 is the proposal text, unchanged').toBe(rt['1'])
    expect(rt['1']).not.toBe(rt['2'])
  })
})

describe('its gate status (A22, E22)', () => {
  it('has an entry in the bundled gates file at the current version, and ships', () => {
    expect(raw.lines.RT).toEqual({ v: RESULTS_TALK_V, status: 'shipped' })
    expect(resultsTalkStatus()).toBe('shipped')
    expect(resultsTalkStatus(DEFAULT_GATES)).toBe('shipped')
  })

  it('follows an entry for the current wording (version 2), and ignores other wording (including version 1, the proposal text), unknown statuses and a missing entry', () => {
    const g = (e: unknown): { lines: Record<string, unknown> } => ({ lines: { RT: e } })
    expect(resultsTalkStatus(g({ v: '2', status: 'blocked' }) as never)).toBe('blocked')
    expect(resultsTalkStatus(g({ v: '2', status: 'experimental' }) as never)).toBe('experimental')
    expect(resultsTalkStatus(g({ v: '1', status: 'blocked' }) as never), 'a check of the retired wording says nothing about this one').toBe('shipped')
    expect(resultsTalkStatus(g({ v: '0', status: 'blocked' }) as never)).toBe('shipped')
    expect(resultsTalkStatus(g({ v: '2', status: 'wonderful' }) as never)).toBe('shipped')
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

/**
 * The retired sentence in rendered copy: every module that holds words a person reads (the source
 * of the app, not its tests and not the historical proposal fixtures) is scanned, so a copy of the
 * sentence in a new place fails here. The comments of a file may quote it; code and strings may not.
 */
const copySources = import.meta.glob<string>(['../**/*.ts', '../**/*.svelte', '../../*.html', '!../**/*.test.ts', '!../**/__fixtures__/**', '!../**/*.d.ts'], { query: '?raw', import: 'default', eager: true })

describe('the retired overlap sentence', () => {
  /** Source with its comments removed (block, line and HTML comments), so a comment that explains the change may quote the old words. */
  const code = (src: string): string => src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '').replace(/<!--[\s\S]*?-->/g, '')
  const RETIRED = /ranges\s+that\s+overlap\s+are\s+not\s+real\s+differences?/i

  it('appears nowhere in the code or strings of the app (copy, card, reveal, results talk, screens, the html pages)', () => {
    expect(Object.keys(copySources).length, 'the scan reads the source').toBeGreaterThan(200)
    expect(Object.keys(copySources), 'and the html pages').toContain('../../index.html')
    const hits = Object.entries(copySources)
      .filter(([, src]) => RETIRED.test(code(src)))
      .map(([file]) => file)
    expect(hits).toEqual([])
  })

  it('is still in the proposal fixture, which stays as the historical version 1 text', () => {
    expect(helper).toContain(V1_OVERLAP)
  })
})

describe('the modules stay light', () => {
  it('the texts import nothing, and the gate module imports only the gates file and the texts: no grammar, topics or gates code reaches the reveal screens', () => {
    expect(Object.keys(sources).sort()).toEqual(['./results-talk-gate.ts', './results-talk.ts'])
    expect(importsOf('./results-talk.ts')).toEqual([])
    expect(importsOf('./results-talk-gate.ts')).toEqual(['./brief-gates.json', './results-talk'])
  })
})
