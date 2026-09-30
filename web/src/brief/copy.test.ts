/**
 * Page copy (proposal §6 "Copy drafts"; A22 copy-claim rule; A13): the approved drafts are used
 * word for word, none of the copy uses clinical words, and no screen says or implies that the
 * notes help until F18/F19 pass.
 */

import { describe, expect, it } from 'vitest'
import { lintLine } from './lint'
import { CLAIM, COPY, DATA_FREE_SNIPPET, SETTING_LABELS, STEPS } from './copy'
import { DESTINATIONS } from './surfaces'

const drafts = import.meta.glob<string>('./__fixtures__/proposal/ui-copy.txt', { query: '?raw', import: 'default', eager: true })['./__fixtures__/proposal/ui-copy.txt'] ?? ''
const helper = import.meta.glob<string>('./__fixtures__/proposal/results-helper.txt', { query: '?raw', import: 'default', eager: true })['./__fixtures__/proposal/results-helper.txt'] ?? ''
const sources = import.meta.glob<string>(['./NotesBuilder.svelte', './ui/*.svelte'], { query: '?raw', import: 'default', eager: true })
const lines = drafts.split('\n')
const draft = (start: string): string => {
  const l = lines.find((x) => x.startsWith(start))
  if (l === undefined) throw new Error(`no draft starting ${start}`)
  return l
}

describe('approved copy drafts are used word for word', () => {
  it('matches proposal §6 for the trust line, provider warning, anti-coercion, placement, claim, science, interests and removal', () => {
    expect(lines.length).toBeGreaterThan(15)
    expect(COPY.trust).toBe(draft('Nothing on this page leaves your device.'))
    expect(COPY.providerWarning).toBe(draft('Before you paste:'))
    expect(COPY.antiCoercion).toBe(draft('This is yours.'))
    expect(COPY.placement).toBe(draft('Put these in your personal settings'))
    expect(CLAIM).toBe(draft('Designed from research on explanations'))
    expect(COPY.science).toBe(draft('Measured science lines'))
    expect(COPY.interests).toBe(draft('Hobbies or subjects you like.'))
    expect(COPY.remove).toBe(draft('Remove my notes settings.'))
    expect(COPY.troubleshooting).toBe(draft('Your assistant may not be reading your notes.'))
    expect(COPY.fitLog).toBe(draft('Your fit notes change only'))
  })

  it('carries the floor-rule note word for word (in build.ts)', async () => {
    const { NOTICE_TEXT } = await import('./build')
    expect(NOTICE_TEXT.floor).toBe(draft("We're still checking that assistants handle this line respectfully."))
  })

  it('keeps the results-talk preamble fixture at 341 characters with no clinical words (for AI.6b)', () => {
    expect(helper.trim().length).toBe(340)
    expect(lintLine(helper).filter((h) => h.rule === 'a13')).toEqual([])
  })
})

describe('copy rules', () => {
  const all = (): string[] => [
    ...(Object.values(COPY).filter((v) => typeof v === 'string') as string[]),
    CLAIM,
    DATA_FREE_SNIPPET,
    ...Object.values(STEPS).flatMap((s) => [s.heading, s.hint]),
    ...Object.values(SETTING_LABELS).flatMap((s) => [s.label, s.hint]),
  ]

  it('uses no clinical or diagnostic word anywhere (A13)', () => {
    for (const t of all()) expect(lintLine(t).filter((h) => h.rule === 'a13'), t).toEqual([])
  })

  it('never says or implies the notes help, on any screen, until F18/F19 pass (A22)', () => {
    const BENEFIT = /\b(?:helps?|helped|improves?|improved|boosts?|better results?|works better|more accurate|learn faster|proven|guarantee\w*|effective)\b/i
    for (const t of all()) {
      // The claim itself is the one sentence that names "help": it says it is NOT shown to help.
      if (t === CLAIM) continue
      expect(BENEFIT.test(t), t).toBe(false)
    }
    for (const [path, text] of Object.entries(sources)) {
      // Markup only: the script blocks and comments are code.
      const markup = text.replace(/<script[\s\S]*?<\/script>/g, '').replace(/<!--[\s\S]*?-->/g, '').replace(/<style[\s\S]*?<\/style>/g, '')
      expect(BENEFIT.test(markup), path).toBe(false)
    }
    expect(sources && Object.keys(sources).length).toBeGreaterThanOrEqual(7)
    for (const d of DESTINATIONS) for (const t of [d.label, d.limit_note, ...d.install, ...d.remove]) expect(BENEFIT.test(t), t).toBe(false)
  })

  it('carries the claim on the page and never changes it (the fixed banner and drawer copy)', () => {
    expect(CLAIM).toBe('Designed from research on explanations; not yet shown to help HumanBench users.')
    expect(COPY.instructionsNotTraits).toContain('never describe you')
  })

  it('has a function for the download message that names the file', () => {
    expect(COPY.downloaded('hb-notes-2026-11-k3f9.txt')).toBe('Downloaded hb-notes-2026-11-k3f9.txt.')
  })
})
