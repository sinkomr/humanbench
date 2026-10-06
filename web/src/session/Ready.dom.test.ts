import { flushSync } from 'svelte'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { buttonByText, click, render } from '../render/common/testing'
import { saveWithSession } from '../save/create'
import { encodeSaveCode } from '../save/codec'
import { newAnonId } from '../save/ids'
import { saveText } from '../save/io'
import type { SaveFileV1 } from '../save/types'
import { SAVE_CTX } from './constants'
import { READY_NOT_LOADED } from './copy'
import { Bot } from './bot'
import { defaultReadyState, type ReadyState } from './ready-state'
import Ready from './Ready.svelte'

let cleanup: (() => void) | undefined
afterEach(() => {
  cleanup?.()
  cleanup = undefined
  document.body.innerHTML = ''
})

/** A save of one session: one Matrix & Series answer, then the rest skipped. */
async function savedFile(createdMs = 1_790_000_100_000): Promise<SaveFileV1> {
  const bot = new Bot({ sessionId: 's_READYSAVE000002', skipped: ['RT', 'WM', 'PS', 'SPA', 'QR'] })
  bot.until((v) => v.phase === 'confidence')
  bot.run.confirmConfidence(bot.view().confidence!.startPct)
  bot.run.finishEarly()
  return saveWithSession(null, bot.run.sessionState(), { ctx: SAVE_CTX, createdMs, anonId: newAnonId() })
}

const none: ReadyState = { includeFound: false, loaded: null }

function ready(over: Record<string, unknown> = {}): { c: HTMLElement; reported: ReadyState[]; begun: ReturnType<typeof vi.fn> } {
  const reported: ReadyState[] = []
  const begun = vi.fn()
  const r = render(Ready, { restored: null, choices: none, onchoices: (s: ReadyState) => reported.push(s), onpractice: () => undefined, onbegin: begun, ...over })
  cleanup = r.destroy
  return { c: r.container, reported, begun }
}

const fileInput = (c: HTMLElement): HTMLInputElement => c.querySelector<HTMLInputElement>('input[type="file"]')!
const area = (c: HTMLElement): HTMLTextAreaElement => c.querySelector('textarea')!
const status = (c: HTMLElement): HTMLElement => c.querySelector('p[role="status"]')!
/** The line that says why a load failed: a role=alert element of its own, present only while there is a failure (UX-012a). */
const alertOf = (c: HTMLElement): HTMLElement | null => c.querySelector('p[role="alert"]')

/** Put a file in the file field the way the browser does: the field holds it, and a change event says so. */
function chooseFile(c: HTMLElement, upload: File | null): void {
  Object.defineProperty(fileInput(c), 'files', { value: upload === null ? [] : [upload], configurable: true })
  fileInput(c).dispatchEvent(new Event('change', { bubbles: true }))
  flushSync()
}

function paste(c: HTMLElement, text: string): void {
  area(c).value = text
  area(c).dispatchEvent(new Event('input', { bubbles: true }))
  flushSync()
}

const photo = new File(['this is not a save'], 'photo.txt', { type: 'text/plain' })

describe('Ready: a chosen file is never silently left unread (UX-012a)', () => {
  it('reads the file as soon as it is chosen, with no press of Load', async () => {
    const file = await savedFile()
    const { c, reported } = ready()
    chooseFile(c, new File([saveText(file)], 'humanbench.txt', { type: 'text/plain' }))
    await vi.waitFor(() => expect(reported).toHaveLength(1))
    flushSync()
    expect(reported[0]?.loaded?.anon_id).toBe(file.anon_id)
    expect(status(c).textContent).toBe('Loaded 1 earlier session. Your new session will be added to it.')
    expect(alertOf(c)).toBeNull()
  })

  it('a file that is not a save says so in an alert, tied to the file field and not the code box; the status line stays empty', async () => {
    const { c, reported } = ready()
    chooseFile(c, photo)
    await vi.waitFor(() => expect(alertOf(c)?.textContent).toContain('not a HumanBench save'))
    flushSync()
    expect(reported).toEqual([])
    expect(c.querySelectorAll('[role="alert"]')).toHaveLength(1)
    expect(status(c).textContent).toBe('')
    expect(alertOf(c)!.classList.contains('error')).toBe(true)
    const id = alertOf(c)!.id
    expect(id).not.toBe('')
    expect(fileInput(c).getAttribute('aria-describedby')).toBe(id)
    expect(fileInput(c).getAttribute('aria-invalid')).toBe('true')
    expect(area(c).hasAttribute('aria-describedby')).toBe(false)
    expect(area(c).hasAttribute('aria-invalid')).toBe(false)
  })

  it('a bad code is one alert tied to the code box; typing again drops the message about the old text', async () => {
    const { c } = ready()
    paste(c, 'hello there')
    click(buttonByText(c, 'Load'))
    await vi.waitFor(() => expect(alertOf(c)?.textContent).toContain('not a HumanBench save'))
    flushSync()
    expect(c.querySelectorAll('[role="alert"]')).toHaveLength(1)
    expect(status(c).textContent).toBe('')
    expect(area(c).getAttribute('aria-describedby')).toBe(alertOf(c)!.id)
    expect(area(c).getAttribute('aria-invalid')).toBe('true')
    expect(fileInput(c).hasAttribute('aria-describedby')).toBe(false)
    paste(c, 'hello there again')
    expect(alertOf(c)).toBeNull()
    expect(area(c).hasAttribute('aria-describedby')).toBe(false)
    expect(area(c).hasAttribute('aria-invalid')).toBe(false)
  })

  it('pasted raw JSON that is not a save, or is cut off, is worded as text, not as a file', async () => {
    const { c } = ready()
    paste(c, '{"a": 1}')
    click(buttonByText(c, 'Load'))
    await vi.waitFor(() => expect(alertOf(c)?.textContent).toContain('This text is not a HumanBench save or save code.'))
    expect(alertOf(c)!.textContent).toContain('Choose your downloaded save file, or paste the save code you copied.')
    paste(c, '{"sessions": [')
    click(buttonByText(c, 'Load'))
    await vi.waitFor(() => expect(alertOf(c)?.textContent).toMatch(/^This pasted save looks cut off/))
    expect(alertOf(c)!.textContent).not.toMatch(/\bThis (save )?file\b/)
  })

  it('the status line and the alert are two elements: the status keeps its role through a failure and a success', async () => {
    const file = await savedFile()
    const { c, reported } = ready()
    const line = status(c)
    paste(c, 'hello there')
    click(buttonByText(c, 'Load'))
    await vi.waitFor(() => expect(alertOf(c)).not.toBeNull())
    expect(status(c)).toBe(line)
    expect(line.getAttribute('role')).toBe('status')
    expect(line.getAttribute('aria-live')).toBeNull()
    expect(line.textContent).toBe('')
    paste(c, await encodeSaveCode(file))
    click(buttonByText(c, 'Load'))
    await vi.waitFor(() => expect(reported).toHaveLength(1))
    flushSync()
    expect(status(c)).toBe(line)
    expect(line.getAttribute('role')).toBe('status')
    expect(line.textContent).toContain('Loaded 1 earlier session')
    expect(alertOf(c)).toBeNull()
  })

  it('a file that is not a save does not keep a valid pasted code from loading', async () => {
    const file = await savedFile()
    const { c, reported } = ready()
    paste(c, await encodeSaveCode(file))
    chooseFile(c, photo)
    await vi.waitFor(() => expect(reported).toHaveLength(1))
    flushSync()
    expect(reported[0]?.loaded?.sessions).toHaveLength(1)
    expect(status(c).textContent).toContain('Loaded 1 earlier session')
    expect(alertOf(c)).toBeNull()
  })

  it('the failure of a file stays when Load is pressed after it (the file is gone from the field, the reason is not)', async () => {
    const { c } = ready()
    chooseFile(c, photo)
    await vi.waitFor(() => expect(alertOf(c)?.textContent).toContain('not a HumanBench save'))
    chooseFile(c, null) // the field is cleared (the screen clears it after a failure)
    expect(alertOf(c)).toBeNull() // a person who clears the field has dealt with it ...
    chooseFile(c, photo)
    await vi.waitFor(() => expect(alertOf(c)?.textContent).toContain('not a HumanBench save'))
    Object.defineProperty(fileInput(c), 'files', { value: [], configurable: true })
    click(buttonByText(c, 'Load'))
    await new Promise((resolve) => setTimeout(resolve, 0))
    flushSync()
    // ... but Load pressed on an empty field keeps the better message instead of "choose a file".
    expect(alertOf(c)?.textContent).toContain('not a HumanBench save')
    expect(c.querySelectorAll('[role="alert"]')).toHaveLength(1)
  })

  it('Load with nothing chosen asks for a file or a code, in one alert that both fields point at', async () => {
    const { c } = ready()
    click(buttonByText(c, 'Load'))
    await vi.waitFor(() => expect(alertOf(c)?.textContent).toBe('Choose a save file or paste a save code first.'))
    flushSync()
    expect(c.querySelectorAll('[role="alert"]')).toHaveLength(1)
    expect(fileInput(c).getAttribute('aria-describedby')).toBe(alertOf(c)!.id)
    expect(area(c).getAttribute('aria-describedby')).toBe(alertOf(c)!.id)
    expect(status(c).textContent).toBe('')
  })

  it('the code box is for the page translator to leave alone', () => {
    const { c } = ready()
    expect(area(c).getAttribute('translate')).toBe('no')
  })
})

describe('Ready: the backup fetched from the server says so the same way (UX-012a)', () => {
  function backupFields(c: HTMLElement): HTMLElement {
    const details = c.querySelector<HTMLElement>('details.focus:last-of-type')!
    const [id, phrase] = [...details.querySelectorAll<HTMLInputElement>('input[type="text"]')]
    for (const [el, v] of [[id!, 'hb_7Q3m9Kx2Vw5rT8pL'], [phrase!, 'acorn acrobat']] as const) {
      el.value = v
      el.dispatchEvent(new Event('input', { bubbles: true }))
    }
    flushSync()
    return details
  }

  it('nothing found, or the server cannot be reached, is an alert of its own; the status line stays a status line', async () => {
    const restore = vi.fn().mockResolvedValueOnce({ found: false }).mockRejectedValueOnce(new Error('offline'))
    const { c } = ready({ restore })
    const details = backupFields(c)
    const line = details.querySelector('p[role="status"]')!
    expect(details.querySelector('[role="alert"]')).toBeNull()
    click(buttonByText(details, 'Get my backup'))
    await vi.waitFor(() => expect(details.querySelector('[role="alert"]')?.textContent).toBe('Nothing matched that identifier and phrase.'))
    expect(line.textContent).toBe('')
    expect(details.querySelector('p[role="status"]')).toBe(line)
    click(buttonByText(details, 'Get my backup'))
    await vi.waitFor(() => expect(details.querySelector('[role="alert"]')?.textContent).toBe('The server could not be reached. Please try again.'))
    expect(details.querySelectorAll('[role="alert"]')).toHaveLength(1)
    expect(line.textContent).toBe('')
  })

  it('a backup that is found is said in the status line, with no alert', async () => {
    const file = await savedFile()
    const restore = vi.fn().mockResolvedValue({ found: true, save: file, updatedUtc: '2026-10-04T10:00:00Z' })
    const { c } = ready({ restore })
    const details = backupFields(c)
    click(buttonByText(details, 'Get my backup'))
    await vi.waitFor(() => expect(details.querySelector('p[role="status"]')?.textContent).toContain('Loaded your backup with 1 earlier session'))
    expect(details.querySelector('[role="alert"]')).toBeNull()
  })
})

describe('Ready: Begin does not start while something chosen is not loaded (UX-012a)', () => {
  it('a chosen file that is not loaded stops Begin and says so in an alert', async () => {
    const file = await savedFile()
    const { c, begun } = ready()
    // The file is in the field but its change was never seen (the load is what the person forgot).
    Object.defineProperty(fileInput(c), 'files', { value: [new File([saveText(file)], 'x.txt')], configurable: true })
    click(buttonByText(c, 'Begin'))
    await new Promise((resolve) => setTimeout(resolve, 0))
    flushSync()
    expect(begun).not.toHaveBeenCalled()
    expect(c.querySelector('[role="alert"]')?.textContent).toBe(READY_NOT_LOADED)
    expect(READY_NOT_LOADED).toBe('You chose a save file or pasted a code, but it is not loaded yet. Press Load to add your new session to it, or clear it to begin without it.')
  })

  it('a pasted code that is not loaded stops it too; clearing the box lets Begin go', async () => {
    const { c, begun } = ready()
    paste(c, 'H4sIAAAA')
    click(buttonByText(c, 'Begin'))
    await new Promise((resolve) => setTimeout(resolve, 0))
    flushSync()
    expect(begun).not.toHaveBeenCalled()
    expect(c.querySelector('[role="alert"]')).not.toBeNull()
    paste(c, '')
    expect(c.querySelector('[role="alert"]')).toBeNull()
    click(buttonByText(c, 'Begin'))
    await new Promise((resolve) => setTimeout(resolve, 0))
    expect(begun).toHaveBeenCalledTimes(1)
  })

  it('with nothing chosen, or the save already loaded, Begin starts at once', async () => {
    const file = await savedFile()
    const plain = ready()
    click(buttonByText(plain.c, 'Begin'))
    expect(plain.begun).toHaveBeenCalledTimes(1) // synchronously: nothing to wait for
    cleanup?.()
    const loaded = ready({ choices: { includeFound: false, loaded: file } })
    paste(loaded.c, 'still in the box')
    click(buttonByText(loaded.c, 'Begin'))
    await new Promise((resolve) => setTimeout(resolve, 0))
    expect(loaded.begun).toHaveBeenCalledTimes(1)
    expect(loaded.c.querySelector('[role="alert"]')).toBeNull()
  })

  it('the Ready screen has one status line and no alert at rest, for the page and for tests that look for them', () => {
    const { c } = ready()
    expect(c.querySelectorAll('[role="status"]')).toHaveLength(1)
    expect(c.querySelectorAll('[role="alert"]')).toHaveLength(0)
  })
})

describe('Ready: what Begin adds to, and what is already here (UX-012a, UX-010)', () => {
  it('beside Begin: once a save is loaded, the new session is said to be added to its sessions', async () => {
    const file = await savedFile()
    const without = ready()
    expect(without.c.textContent).not.toContain('Your new session will be added to')
    cleanup?.()
    const { c } = ready({ choices: { includeFound: false, loaded: file } })
    const line = [...c.querySelectorAll('p')].find((p) => (p.textContent ?? '').startsWith('Your new session will be added to'))
    expect(line?.textContent).toBe('Your new session will be added to 1 earlier session.')
  })

  it('the autosave found on this device says when it was written and what the newest session holds, in the person’s own time', async () => {
    const written = new Date(2026, 9, 5, 14, 3, 0)
    const file = { ...(await savedFile(written.getTime())), created_utc: written.toISOString() }
    const restored = { save: file, keys: ['k'], failures: [], anonIds: [file.anon_id] }
    const now = (): number => new Date(2026, 9, 5, 18, 0, 0).getTime()
    const { c } = ready({ restored, choices: defaultReadyState(restored), now })
    const label = [...c.querySelectorAll('label')].find((l) => (l.textContent ?? '').includes('saved on this device'))!
    // The label is as it was.
    expect((label.textContent ?? '').replace(/\s+/g, ' ').trim()).toBe('Add my new session to the 1 earlier session saved on this device.')
    const note = c.querySelector('p.muted[id$="-found-note"]')!
    expect(note.textContent).toBe('Last saved today at 14:03, 1 question answered.')
    expect(c.querySelector('input[type="checkbox"]')?.getAttribute('aria-describedby')).toBe(note.id)
    expect(note.getAttribute('role')).toBeNull()
  })

  it('yesterday and an older date are said as such', async () => {
    const written = new Date(2026, 9, 4, 9, 5, 0)
    const file = { ...(await savedFile(written.getTime())), created_utc: written.toISOString() }
    const restored = { save: file, keys: ['k'], failures: [], anonIds: [file.anon_id] }
    const a = ready({ restored, choices: defaultReadyState(restored), now: () => new Date(2026, 9, 5, 8, 0, 0).getTime() })
    expect(a.c.textContent).toContain('Last saved yesterday at 09:05, 1 question answered.')
    cleanup?.()
    const b = ready({ restored, choices: defaultReadyState(restored), now: () => new Date(2026, 9, 20, 8, 0, 0).getTime() })
    expect(b.c.textContent).toContain('Last saved 4 October at 09:05, 1 question answered.')
  })

  it('"See my results" follows Begin when there is a profile to see, and not otherwise', async () => {
    const file = await savedFile()
    const restored = { save: file, keys: ['k'], failures: [], anonIds: [file.anon_id] }
    const shown = vi.fn()
    const { c } = ready({ restored, choices: defaultReadyState(restored), onresults: shown })
    const labels = [...c.querySelectorAll('.hb-actions')][0]!.querySelectorAll('button')
    expect([...labels].map((b) => b.textContent?.trim())).toEqual(['Begin', 'See my results', 'Try practice questions first'])
    expect(labels[1]!.classList.contains('hb-primary')).toBe(false)
    click(labels[1]!)
    expect(shown).toHaveBeenCalledTimes(1)
    cleanup?.()
    // No earlier save: nothing to see. An earlier save the person left out: nothing either.
    expect([...ready({ onresults: shown }).c.querySelectorAll('button')].map((b) => b.textContent?.trim())).not.toContain('See my results')
    cleanup?.()
    const left = ready({ restored, choices: { includeFound: false, loaded: null }, onresults: shown })
    expect([...left.c.querySelectorAll('button')].map((b) => b.textContent?.trim())).not.toContain('See my results')
    cleanup?.()
    // No handler (a server version): no button.
    const noHandler = ready({ restored, choices: defaultReadyState(restored) })
    expect([...noHandler.c.querySelectorAll('button')].map((b) => b.textContent?.trim())).not.toContain('See my results')
  })
})
