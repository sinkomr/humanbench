import { afterEach, describe, expect, it } from 'vitest'
import { buttonByText, render } from '../render/common/testing'
import { saveWithSession } from '../save/create'
import type { SaveFileV1 } from '../save/types'
import { SAVE_CTX } from './constants'
import { Bot } from './bot'
import Finished from './Finished.svelte'

let cleanup: (() => void) | undefined
afterEach(() => {
  cleanup?.()
  cleanup = undefined
  document.body.innerHTML = ''
})

const ANON = 'hb_' + 'f'.repeat(17)
const meta = { ctx: SAVE_CTX, createdMs: 1_790_000_100_000, anonId: ANON }
const ALL_AXES = ['RT', 'MAT', 'SPA', 'WM', 'QR', 'PS'] as const

/** An earlier session with one answer: what a loaded file holds. */
function earlierSave(): SaveFileV1 {
  const bot = new Bot({ sessionId: 's_EARLIERSESSION2', skipped: ['RT', 'WM', 'PS', 'SPA', 'QR'] })
  bot.until((v) => v.phase === 'confidence')
  bot.run.confirmConfidence(bot.view().confidence!.startPct)
  bot.run.finishEarly()
  return saveWithSession(null, bot.run.sessionState(), meta)
}

function show(bot: Bot | null, base: SaveFileV1 | null, over: Record<string, unknown> = {}): HTMLElement {
  const make = (): SaveFileV1 => (bot === null ? base! : saveWithSession(base, bot.run.sessionState(), meta))
  const r = render(Finished, {
    result: bot === null ? null : bot.run.result(),
    makeSave: make,
    sessionId: bot === null ? undefined : bot.run.sessionId,
    autosave: 'ok',
    motion: 'reduce',
    onrestart: () => undefined,
    ...over,
  })
  cleanup = r.destroy
  return r.container
}

const lead = (c: HTMLElement): string => c.querySelector('main > p.lead')?.textContent ?? ''
const lines = (c: HTMLElement): string => [...c.querySelectorAll('main > p')].map((p) => p.textContent).join(' | ')

describe('Finished: the lines above the profile say what it rests on (UX-009a)', () => {
  it('a session that reached the end with parts skipped does not say it finished every part', () => {
    const bot = new Bot({ sessionId: 's_FINISHEDSKIP001', skipped: ['RT', 'MAT'] }, { theta: new Array<number>(17).fill(0.3) })
    bot.finish()
    expect(bot.run.result().reason).toBe('complete')
    const c = show(bot, null)
    expect(lead(c)).toBe('You reached the end of the session. You skipped 2 parts: Reaction Time and Matrix & Series.')
    expect(c.textContent).not.toContain('You finished every part.')
  })

  it('one skipped part, and three, are said in plain grammar', () => {
    const one = new Bot({ sessionId: 's_FINISHEDSKIP002', skipped: ['RT'] })
    one.finish()
    expect(lead(show(one, null))).toBe('You reached the end of the session. You skipped 1 part: Reaction Time.')
    cleanup?.()
    const three = new Bot({ sessionId: 's_FINISHEDSKIP003', skipped: ['RT', 'MAT', 'WM'] })
    three.finish()
    expect(lead(show(three, null))).toBe('You reached the end of the session. You skipped 3 parts: Reaction Time, Matrix & Series and Working Memory.')
  })

  it('a session that skipped nothing still says it finished every part', () => {
    const bot = new Bot({ sessionId: 's_FINISHEDSKIP004' }, { theta: new Array<number>(17).fill(0.2) })
    bot.finish()
    expect(lead(show(bot, null))).toBe('You finished every part.')
  })

  it('a session that skipped every part says nothing was measured this time, and offers the way back first', () => {
    const bot = new Bot({ sessionId: 's_FINISHEDSKIP005', skipped: [...ALL_AXES] })
    expect(bot.run.result().reason).toBe('complete')
    const c = show(bot, null)
    expect(lead(c)).toBe('You skipped every part, so nothing was measured this time.')
    expect(c.textContent).toContain('Nothing was measured in this session')
  })

  it('a visit that adds no answers to a profile of earlier sessions says so, instead of "you answered 0 questions"', () => {
    const base = earlierSave()
    const bot = new Bot({ sessionId: 's_FINISHEDEMPTY01' })
    bot.run.finishEarly()
    const c = show(bot, base)
    expect(c.querySelector('svg.hb-blob')).not.toBeNull() // the profile is the earlier session's
    expect(lines(c)).toContain('This visit added no new answers. Your profile below comes from 1 earlier session.')
    expect(c.textContent).not.toContain('You answered 0 questions')
    expect(c.textContent).not.toContain('You finished early')
    expect(c.querySelector('h1')?.textContent).toBe('Session complete')
  })

  it('a session with answers on top of earlier ones says how many sessions the profile combines', () => {
    const base = earlierSave()
    const bot = new Bot({ sessionId: 's_FINISHEDCOMB001', skipped: ['RT', 'WM', 'PS', 'SPA', 'QR'] })
    bot.until((v) => v.phase === 'confidence')
    bot.run.confirmConfidence(bot.view().confidence!.startPct)
    bot.run.finishEarly()
    const c = show(bot, base)
    expect(lead(c)).toBe('You finished early, so some parts are not measured.')
    expect(lines(c)).toMatch(/You answered 1 question and completed 0 timed tasks in about 1 minute\. This profile combines 2 sessions\./)
  })

  it('a first session alone does not talk about combining', () => {
    const bot = new Bot({ sessionId: 's_FINISHEDCOMB002', skipped: ['RT', 'WM', 'PS', 'SPA', 'QR'] })
    bot.until((v) => v.phase === 'confidence')
    bot.run.confirmConfidence(bot.view().confidence!.startPct)
    bot.run.finishEarly()
    const c = show(bot, null)
    expect(lines(c)).toContain('You answered 1 question')
    expect(c.textContent).not.toContain('combines')
  })
})

describe('Finished: nothing measured offers the way back, and keeps the file out of the way (UX-009a)', () => {
  it('"Back to the start" is the primary button, comes first, and the save is behind a closed disclosure', () => {
    const bot = new Bot({ sessionId: 's_FINISHEDNONE001' })
    bot.run.finishEarly()
    const c = show(bot, null)
    const main = c.querySelector('main')!
    const visible = [...main.querySelectorAll('button')].filter((b) => b.closest('details') === null)
    expect(visible.map((b) => b.textContent?.trim())).toEqual(['Back to the start'])
    expect(visible[0]!.classList.contains('hb-primary')).toBe(true)
    const details = main.querySelector('details')!
    expect(details.open).toBe(false)
    expect(details.querySelector('summary')?.textContent).toBe('Keep a file of this visit anyway')
    // The way back comes before the disclosure; the save panel (and so its buttons) is still in the page, inside it.
    expect(visible[0]!.compareDocumentPosition(details) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    expect(details.querySelector('[data-section="save"]')).not.toBeNull()
    expect(buttonByText(details, 'Download save file')).toBeTruthy()
    expect(buttonByText(details, 'Copy save code')).toBeTruthy()
    // No indent: the narrow column of the other plain screens.
    expect(main.classList.contains('wide')).toBe(false)
    // Nothing is complete: the session ended (UX-009b).
    expect(c.querySelector('h1')?.textContent).toBe('Session ended')
  })

  it('a profile on screen keeps the wide page', () => {
    const bot = new Bot({ sessionId: 's_FINISHEDWIDE001' }, { theta: new Array<number>(17).fill(0.5) })
    bot.finish()
    expect(show(bot, null).querySelector('main')?.classList.contains('wide')).toBe(true)
  })
})

describe('Finished: the results of a save, with no new session (UX-010)', () => {
  it('is "Your results", says how many earlier sessions the profile comes from, and adds none to the save', () => {
    const base = earlierSave()
    const c = show(null, base)
    expect(c.querySelector('h1')?.textContent).toBe('Your results')
    expect(c.querySelector('main > p.lead')?.textContent).toBe('Your profile from 1 earlier session.')
    expect(c.textContent).not.toContain('You answered')
    expect(c.textContent).not.toContain('You finished')
    expect(c.querySelector('svg.hb-blob')).not.toBeNull()
    expect(c.querySelector('[data-section="save"]')).not.toBeNull()
  })
})
