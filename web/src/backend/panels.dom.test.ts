/**
 * The panels an online session adds (ROADMAP M2.7, AI.26): the server backup, the report, the survey
 * and the check of a save. Their wiring to the server is in `SessionApp.served.dom.test.ts`; here are
 * their own rules: what is shown once, what is never sent, what is said when the server says no.
 */

import { flushSync } from 'svelte'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { buttonByText, click } from '../render/common/testing'
import { mountInto, type Mounted } from '../render/dom-testing'
import type { ProblemReport, Survey as SurveyAnswers } from './api'
import { BackendError } from './errors'
import MirrorPanel from './MirrorPanel.svelte'
import type { MirrorPutReply } from './replies'
import ReportProblem from './ReportProblem.svelte'
import SaveCheck from './SaveCheck.svelte'
import { standingFromRescore, standingFromVerify, countStanding, type SessionStanding } from './standing'
import Survey from './Survey.svelte'
import { ANON, CANNED } from './testing'
import type { SaveFileV1, SaveSession } from '../save/types'

let mounted: Mounted | undefined
afterEach(() => {
  mounted?.destroy()
  mounted = undefined
})
const tick = async (n = 4): Promise<void> => {
  for (let i = 0; i < n; i++) await new Promise((r) => setTimeout(r, 0))
  flushSync()
}
const PHRASE = 'acorn acrobat action advice agate agenda aisle album alder alert almond amber'
const stored = (phrase: string | null): MirrorPutReply => ({ stored: true, anonId: ANON, sizeBytes: 100, recoveryPhrase: phrase })

describe('MirrorPanel', () => {
  it('says what the backup is, that it leaves out the notes settings, and shows the phrase once, with a confirmation before it goes', async () => {
    const put = vi.fn(async (_p?: string) => stored(PHRASE))
    mounted = mountInto(MirrorPanel, { put })
    const root = mounted.target
    expect(root.querySelector('[data-mirror-note]')?.textContent).toBe("Your server backup doesn't include your notes settings. Keep your downloaded save if you want them on another device.")
    expect(root.textContent).toContain('no accounts and no email')
    click(buttonByText(root, 'Keep a backup on the server'))
    await tick()
    expect(put).toHaveBeenCalledWith(undefined)
    expect(root.querySelector('[data-recovery-phrase]')?.textContent).toBe(PHRASE)
    expect(root.textContent).toContain('shown once')
    expect(buttonByText(root, 'Done').disabled).toBe(true)
    const kept = root.querySelector<HTMLInputElement>('input[type="checkbox"]')!
    click(kept)
    click(buttonByText(root, 'Done'))
    expect(root.querySelector('[data-recovery-phrase]')).toBeNull()
    expect(root.textContent).not.toContain(PHRASE)
    // from here on the panel is for updating: that needs the phrase
    expect(buttonByText(root, 'Update my backup')).toBeTruthy()
  })

  it('shows the save identifier next to the phrase, and keeps it after the phrase is gone (the way back takes both)', async () => {
    mounted = mountInto(MirrorPanel, { put: async () => stored(PHRASE) })
    const root = mounted.target
    expect(root.querySelector('[data-anon-id]')).toBeNull() // nothing stored yet
    click(buttonByText(root, 'Keep a backup on the server'))
    await tick()
    expect(root.querySelector('[data-phrase] [data-anon-id]')?.textContent).toBe(ANON)
    expect(root.textContent).toContain('also in your save file')
    click(root.querySelector<HTMLInputElement>('input[type="checkbox"]')!)
    click(buttonByText(root, 'Done'))
    expect(root.querySelector('[data-recovery-phrase]')).toBeNull()
    expect(root.querySelector('[data-anon-id]')?.textContent).toBe(ANON)
  })

  it('names the identifier of the session when the backup exists already and the reply carries none', async () => {
    mounted = mountInto(MirrorPanel, {
      anonId: ANON,
      put: async () => {
        throw new BackendError('conflict', 'mirror_exists', { status: 409 })
      },
    })
    click(buttonByText(mounted.target, 'Keep a backup on the server'))
    await tick()
    expect(mounted.target.querySelector('[data-anon-id]')?.textContent).toBe(ANON)
  })

  it('copies the phrase, or says to select it', async () => {
    const copyText = vi.fn(async (_t: string) => true)
    mounted = mountInto(MirrorPanel, { put: async () => stored(PHRASE), copyText })
    click(buttonByText(mounted.target, 'Keep a backup on the server'))
    await tick()
    click(buttonByText(mounted.target, 'Copy phrase'))
    await tick()
    expect(copyText).toHaveBeenCalledWith(PHRASE)
    expect(mounted.target.textContent).toContain('Phrase copied.')
    copyText.mockResolvedValueOnce(false)
    click(buttonByText(mounted.target, 'Copy phrase'))
    await tick()
    expect(mounted.target.textContent).toContain('could not be copied automatically')
  })

  it('an update with the phrase says so and shows no new phrase; a wrong phrase is refused in words', async () => {
    const put = vi.fn(async (p?: string): Promise<MirrorPutReply> => (p === PHRASE ? stored(null) : { stored: false, error: 'wrong_phrase' }))
    mounted = mountInto(MirrorPanel, { put })
    const root = mounted.target
    const input = root.querySelector<HTMLInputElement>('input[type="text"]')!
    input.value = 'not the phrase'
    input.dispatchEvent(new Event('input', { bubbles: true }))
    flushSync()
    click(buttonByText(root, 'Update my backup'))
    await tick()
    expect(root.textContent).toContain('That phrase does not match your backup.')
    input.value = PHRASE
    input.dispatchEvent(new Event('input', { bubbles: true }))
    flushSync()
    click(buttonByText(root, 'Update my backup'))
    await tick()
    expect(put).toHaveBeenLastCalledWith(PHRASE)
    expect(root.textContent).toContain('Your backup was updated.')
    expect(root.querySelector('[data-recovery-phrase]')).toBeNull()
  })

  it.each([
    [new BackendError('conflict', 'mirror_exists', { status: 409 }), 'already exists'],
    [new BackendError('server', 'mirror_full', { status: 507 }), 'not taking new backups'],
    [new BackendError('rejected', 'save_too_large', { status: 413 }), 'too large'],
    [new BackendError('network', 'network_error'), 'could not be stored just now'],
    [new BackendError('limited', 'rate_limited', { status: 429 }), 'could not be stored just now'],
  ])('says in words what went wrong: %s', async (error, words) => {
    mounted = mountInto(MirrorPanel, {
      put: async () => {
        throw error
      },
    })
    click(buttonByText(mounted.target, 'Keep a backup on the server'))
    await tick()
    expect(mounted.target.textContent).toContain(words)
    expect(mounted.target.querySelector('[data-recovery-phrase]')).toBeNull()
  })

  it('does not send twice while the first is on its way', async () => {
    let release: (r: MirrorPutReply) => void = () => undefined
    const put = vi.fn(() => new Promise<MirrorPutReply>((resolve) => (release = resolve)))
    mounted = mountInto(MirrorPanel, { put })
    const b = buttonByText(mounted.target, 'Keep a backup on the server')
    click(b)
    click(b)
    expect(put).toHaveBeenCalledTimes(1)
    release(stored(PHRASE))
    await tick()
  })
})

describe('ReportProblem', () => {
  const item = 'i:series:1.0.0:abc'

  it('offers the five question kinds and the notes request on a question, and the notes request alone outside one', () => {
    mounted = mountInto(ReportProblem, { itemId: item, report: async () => undefined })
    click(buttonByText(mounted.target, 'Report a problem'))
    expect([...mounted.target.querySelectorAll('input[type="radio"]')].map((r) => (r as HTMLInputElement).value)).toEqual(['wrong_key', 'ambiguous', 'typo', 'offensive', 'broken', 'notes_requested'])
    mounted.destroy()
    mounted = mountInto(ReportProblem, { itemId: null, report: async () => undefined })
    click(buttonByText(mounted.target, 'Report a problem'))
    expect([...mounted.target.querySelectorAll('input[type="radio"]')].map((r) => (r as HTMLInputElement).value)).toEqual(['notes_requested'])
    expect(buttonByText(mounted.target, 'Send report').disabled).toBe(false) // preselected: there is nothing else to choose
  })

  it('sends nothing until a kind is chosen, never text with the notes request, and the question with the others', async () => {
    const report = vi.fn(async (_r: ProblemReport) => undefined)
    mounted = mountInto(ReportProblem, { itemId: item, report })
    const root = mounted.target
    click(buttonByText(root, 'Report a problem'))
    expect(buttonByText(root, 'Send report').disabled).toBe(true)
    click(root.querySelector<HTMLInputElement>('input[value="ambiguous"]')!)
    expect(root.querySelector('textarea')).not.toBeNull()
    const text = root.querySelector('textarea')!
    text.value = 'Two terms fit'
    text.dispatchEvent(new Event('input', { bubbles: true }))
    flushSync()
    click(root.querySelector<HTMLInputElement>('input[value="notes_requested"]')!)
    expect(root.querySelector('textarea')).toBeNull() // no text box: nothing but the fact is kept
    expect(root.textContent).toContain('We keep no details with it')
    root.querySelector<HTMLFormElement>('form')!.requestSubmit()
    await tick()
    expect(report).toHaveBeenCalledTimes(1)
    expect(report).toHaveBeenLastCalledWith({ kind: 'notes_requested' })
    expect(root.textContent).toContain('Thank you. The report was sent.')
    click(buttonByText(root, 'Report a problem'))
    click(root.querySelector<HTMLInputElement>('input[value="broken"]')!)
    root.querySelector<HTMLFormElement>('form')!.requestSubmit()
    await tick()
    expect(report).toHaveBeenLastCalledWith({ kind: 'broken', itemId: item, detail: '' })
  })

  it('limits the text to 500 characters, and offers a retry when the server cannot take the report', async () => {
    const report = vi.fn(async (_r: ProblemReport) => {
      throw new BackendError('network', 'network_error')
    })
    mounted = mountInto(ReportProblem, { itemId: item, report })
    const root = mounted.target
    click(buttonByText(root, 'Report a problem'))
    click(root.querySelector<HTMLInputElement>('input[value="typo"]')!)
    expect(root.querySelector('textarea')!.maxLength).toBe(500)
    root.querySelector<HTMLFormElement>('form')!.requestSubmit()
    await tick()
    expect(root.querySelector('[role="alert"]')?.textContent).toContain('could not be sent')
    expect(buttonByText(root, 'Send report').disabled).toBe(false)
    click(buttonByText(root, 'Cancel'))
    expect(buttonByText(root, 'Report a problem')).toBeTruthy()
  })
})

describe('Survey', () => {
  it('sends only what was chosen', async () => {
    const send = vi.fn(async (_s: SurveyAnswers) => true)
    mounted = mountInto(Survey, { send })
    const root = mounted.target
    expect(root.textContent).toContain('optional, kept apart from your answers, and never shown with your results')
    expect([...root.querySelectorAll<HTMLInputElement>('input[name$="-age"]')].map((i) => i.value)).toEqual(['18-24', '25-34', '35-44', '45-54', '55-64', '65+', ''])
    click(root.querySelector<HTMLInputElement>('input[value="no"]')!)
    root.querySelector<HTMLFormElement>('form')!.requestSubmit()
    await tick()
    expect(send).toHaveBeenCalledWith({ ageBand: null, englishFirst: false })
    expect(root.textContent).toContain('Thank you.')
    expect(root.querySelector('form')).toBeNull()
  })

  it('sends nothing for two skipped questions, or for "No thanks"', async () => {
    const send = vi.fn(async (_s: SurveyAnswers) => true)
    mounted = mountInto(Survey, { send })
    mounted.target.querySelector<HTMLFormElement>('form')!.requestSubmit()
    await tick()
    expect(send).not.toHaveBeenCalled()
    expect(mounted.target.textContent).toContain('Nothing was chosen, so nothing was sent.')
    mounted.destroy()
    mounted = mountInto(Survey, { send })
    click(buttonByText(mounted.target, 'No thanks'))
    expect(send).not.toHaveBeenCalled()
    expect(mounted.target.textContent).toContain('Skipped. Nothing was sent.')
  })

  it('says it could not send, and keeps the form so the person can try again or skip', async () => {
    const send = vi.fn(async (_s: SurveyAnswers) => {
      throw new BackendError('network', 'network_error')
    })
    mounted = mountInto(Survey, { send })
    click(mounted.target.querySelector<HTMLInputElement>('input[value="25-34"]')!)
    mounted.target.querySelector<HTMLFormElement>('form')!.requestSubmit()
    await tick()
    expect(mounted.target.querySelector('[role="alert"]')?.textContent).toContain('could not be sent just now')
    expect(mounted.target.querySelector('form')).not.toBeNull()
  })
})

describe('what the server could check', () => {
  const session = (id: string, sig: boolean, date = '2026-10-03T17:20:02Z'): SaveSession => {
    const { sig: s, ...bare } = (CANNED.finish as { session: SaveSession }).session
    return { ...bare, session_id: id, started_utc: date, ...(sig ? { sig: s! } : {}) }
  }
  const save = (sessions: SaveSession[]): SaveFileV1 => ({ schema_version: '1.0.0', bank_version: 'b', anon_id: ANON, created_utc: '2026-10-03T17:20:02Z', sessions, seen_items: [], seen_families: [] })

  it('an unsigned session is unverified without asking anyone; a signed one is what the server says', () => {
    const s = save([session('s_AAAAAAAA1', false), session('s_AAAAAAAA2', true), session('s_AAAAAAAA3', true), session('s_AAAAAAAA4', true)])
    const list = standingFromVerify(s, {
      anonId: ANON,
      nVerified: 1,
      nUnverified: 2,
      sessions: [
        { sessionId: 's_AAAAAAAA2', status: 'verified', reason: null },
        { sessionId: 's_AAAAAAAA3', status: 'unverified', reason: 'bad_signature' },
      ],
    })
    expect(list.map((x) => [x.sessionId, x.standing, x.reason])).toEqual([
      ['s_AAAAAAAA1', 'unverified', 'unsigned'],
      ['s_AAAAAAAA2', 'verified', null],
      ['s_AAAAAAAA3', 'unverified', 'bad_signature'],
      ['s_AAAAAAAA4', 'unchecked', null],
    ])
    expect(countStanding(list)).toEqual({ verified: 1, unverified: 2, unchecked: 1 })
    // the server could not be asked: signed sessions are "not checked", never "verified"
    expect(standingFromVerify(s, null).filter((x) => x.standing === 'verified')).toEqual([])
  })

  it('rescore’s session list gives verified for the ones it holds', () => {
    const s = save([session('s_AAAAAAAA2', true), session('s_AAAAAAAA3', true)])
    const list = standingFromRescore(s, { paramVersion: 'p', eap: {}, facets: {}, sessions: [{ sessionId: 's_AAAAAAAA2', known: true }, { sessionId: 's_AAAAAAAA3', known: false }] })
    expect(list.map((x) => x.standing)).toEqual(['verified', 'unverified'])
    expect(standingFromRescore(s, null).map((x) => x.standing)).toEqual(['unchecked', 'unchecked'])
  })

  it('SaveCheck says how many were checked and why the others were not, and that notes settings do not matter', () => {
    const rows: SessionStanding[] = [
      { sessionId: 's_AAAAAAAA1', date: '2026-10-01', standing: 'unverified', reason: 'unsigned' },
      { sessionId: 's_AAAAAAAA2', date: '2026-10-02', standing: 'verified', reason: null },
      { sessionId: 's_AAAAAAAA3', date: '2026-10-03', standing: 'verified', reason: null },
      { sessionId: 's_AAAAAAAA4', date: '2026-10-04', standing: 'unverified', reason: 'bad_signature' },
    ]
    mounted = mountInto(SaveCheck, { sessions: rows, localTasks: true })
    const text = mounted.target.textContent ?? ''
    expect(text).toContain('2 sessions were checked by the server.')
    expect(text).toContain('2 sessions were not checked.')
    expect(text).toContain('Session of 2026-10-01: made on this device, without the server.')
    expect(text).toContain('Session of 2026-10-04: changed since the server saved it, or saved under another identifier.')
    expect(text).toContain('The timed tasks of this session stay on your device')
    expect(text).toContain('Changing your notes settings does not affect this.')
  })

  it('SaveCheck shows nothing for a save with no sessions', () => {
    mounted = mountInto(SaveCheck, { sessions: [] })
    expect(mounted.target.querySelector('section')).toBeNull()
  })
})
