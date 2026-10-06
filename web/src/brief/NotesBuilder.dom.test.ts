/**
 * The notes builder page in jsdom (ROADMAP AI.5; proposal §3.3): the five steps, the preview that
 * shows exactly what will be pasted, ticks and the drawer, the floor-rule note, the length warning,
 * copy and download (through injected functions), the install commands, and the guarantees that
 * typed text reaches no storage and nothing is sent. Browser-only behaviour (real clipboard and
 * download, axe, reflow, keyboard) is in `e2e/notes.spec.ts`.
 */

import { flushSync, mount, tick, unmount } from 'svelte'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { DISCLAIMER } from '../copy'
import { CLAIM, COPY, COPY_TARGET_ID, STEPS } from './copy'
import NotesBuilder from './NotesBuilder.svelte'
import { NOTICE_TEXT } from './build'

let app: ReturnType<typeof mount> | undefined
let copy: ReturnType<typeof vi.fn<(text: string) => Promise<boolean>>>
let download: ReturnType<typeof vi.fn<(text: string, name: string, mime: string) => string>>

function open(props: Partial<{ asOf: string; token: string; today: string }> = {}): void {
  app = mount(NotesBuilder, { target: document.body, props: { asOf: '2026-11', token: 'k3f9', copy, download, ...props } })
  flushSync()
}
const $ = <T extends Element = HTMLElement>(sel: string): T => {
  const el = document.querySelector<T>(sel)
  if (!el) throw new Error(`not found: ${sel}`)
  return el
}
const notes = (): string => $('#notes-text').textContent ?? ''
const labelled = <T extends HTMLElement = HTMLInputElement>(text: string | RegExp, within: ParentNode = document): T => {
  const label = [...within.querySelectorAll('label')].find((l) => (typeof text === 'string' ? (l.textContent ?? '').replace(/\s+/g, ' ').includes(text) : text.test(l.textContent ?? '')))
  if (!label) throw new Error(`no label ${String(text)}`)
  const control = label.querySelector<T>('input, select') ?? (label.htmlFor ? document.getElementById(label.htmlFor) : null)
  if (!control) throw new Error(`label without control ${String(text)}`)
  return control as T
}
const button = (text: string | RegExp): HTMLButtonElement => {
  const b = [...document.querySelectorAll('button')].find((x) => (typeof text === 'string' ? (x.textContent ?? '').replace(/\s+/g, ' ').trim().includes(text) : text.test(x.textContent ?? '')))
  if (!b) throw new Error(`no button ${String(text)}`)
  return b
}
const click = (el: HTMLElement): void => {
  el.click()
  flushSync()
}
const type = (el: HTMLInputElement, value: string): void => {
  el.value = value
  el.dispatchEvent(new Event('input', { bubbles: true }))
  flushSync()
}
const pickUse = (label: string): void => click(labelled(label, $('fieldset')))
const chip = (label: string): HTMLButtonElement => button(new RegExp(`^\\s*[+\\u2713]?\\s*${label}\\s*$`))
const setting = (topic: string, label: string): HTMLInputElement => {
  const fieldset = [...document.querySelectorAll('fieldset')].find((f) => f.querySelector('legend')?.textContent?.trim() === topic)
  if (!fieldset) throw new Error(`no fieldset for ${topic}`)
  return labelled(label, fieldset)
}

beforeEach(() => {
  copy = vi.fn(async () => true)
  download = vi.fn((_t: string, name: string) => name)
})
afterEach(() => {
  if (app) void unmount(app)
  app = undefined
  document.body.innerHTML = ''
  vi.restoreAllMocks()
})

describe('the page', () => {
  it('has one h1, the five steps, the trust line, the claim and the exact §13 disclaimer', () => {
    open()
    expect(document.querySelectorAll('h1')).toHaveLength(1)
    expect($('h1').textContent).toBe('Notes for your AI')
    expect([...document.querySelectorAll('h2')].map((h) => h.textContent)).toEqual([
      '1. Where will you use these notes?',
      '2. Which topics come up there?',
      '3. Anything else?',
      '4. Your notes',
      '5. Where to paste',
      'Keep my settings',
      'Check notes',
      'More',
    ])
    expect($('[data-testid=trust]').textContent).toBe(COPY.trust)
    expect($('[data-testid=claim]').textContent).toBe(CLAIM)
    expect(CLAIM).toBe('Designed from research on explanations; not yet shown to help HumanBench users.')
    expect($('footer .disclaimer').textContent).toBe(DISCLAIMER)
  })

  it('shows exactly what will be pasted, with the count for the chosen destination', () => {
    open()
    // General use defaults to ChatGPT instructions: the short notes, at most 1,500 characters.
    expect(notes().startsWith("How I like explanations: my own preferences, not an assessment of me. Written 2026-11. After 2027-05,")).toBe(true)
    const chars = notes().length
    expect($('[data-testid=counter]').textContent?.replace(/\s+/g, ' ').trim()).toBe(`${chars.toLocaleString('en-US')} of 1,500 characters for ChatGPT custom instructions (short form)`)
  })

  it('offers no send button, no pre-filled chat link and no external link', () => {
    open()
    // the keep and load forms are local: they have no action, and nothing is submitted anywhere
    expect(document.querySelectorAll('[src], [action], form[method]')).toHaveLength(0)
    // The only links are the page's frame (UX-049): the skip link, the way back to the app and the privacy notice, all on this site.
    const links = [...document.querySelectorAll('a, [href]')]
    expect(links.every((l) => l.tagName === 'A')).toBe(true)
    expect(links.map((l) => l.getAttribute('href'))).toEqual(['#copy-notes', '/', '/index.html#/privacy'])
    expect(links.every((l) => document.querySelector('main')?.contains(l) === false)).toBe(true)
    expect([...document.querySelectorAll('form')].every((f) => f.getAttribute('action') === null && f.getAttribute('method') === null)).toBe(true)
    expect(document.body.textContent).not.toMatch(/Send to (?:ChatGPT|Claude|Gemini)/i)
    // (the control-word card's SVG namespace is the only web address in the page, and it is not a link)
    expect(document.body.innerHTML.replace('http://www.w3.org/2000/svg', '')).not.toMatch(/https?:\/\//)
  })
})

describe('steps 1 to 3', () => {
  it('follows the context: coding gives a Skill file with the locked coding clause and its collaboration choices', () => {
    open()
    pickUse('Coding and data')
    expect(notes().startsWith('---\nname: working-with-me\ndescription: How I like explanations. Use when explaining a concept, code or an error')).toBe(true)
    expect(notes()).toContain("These notes are for explanations to me in the chat. Don't apply them to code")
    expect(notes()).toContain('Lead with the answer or the code')
    expect(document.body.textContent).toContain('Working with a coding agent')
    click(labelled('Tell me the plan before a large change'))
    expect(notes()).toContain('Before a large change, tell me the plan in a few lines and wait for my go-ahead.')
    pickUse('Writing')
    expect(document.body.textContent).not.toContain('Working with a coding agent')
    expect(notes()).toContain('keep my voice and word choices')
  })

  it('writes a topic line from the person\'s own setting, grouped and in list order', () => {
    open()
    pickUse('Coding and data')
    click(chip('Programming'))
    click(chip('Statistics'))
    click(setting('Programming', 'I know this well'))
    click(setting('Statistics', 'I know this well'))
    expect(notes()).toContain('- Programming and statistics: skip the basics and go straight to the method. Mention a step only if it is unusual.')
    click(setting('Statistics', 'New to me'))
    expect(notes()).toContain('- Programming: skip the basics')
    expect(notes()).toContain('- Statistics: start from a small concrete example')
  })

  it('stops at five topics and says so', () => {
    open()
    for (const l of ['Programming', 'Statistics', 'Data analysis', 'Machine learning', 'Probability and counting']) click(chip(l))
    expect([...document.querySelectorAll('[role=status]')].map((el) => el.textContent)).toContain('You have picked five topics, the most a set of notes can list. Remove one to pick another.')
    expect(document.body.textContent).toContain('You have picked five topics')
    expect(chip('Probability and counting').getAttribute('aria-pressed')).toBe('true')
    const disabled = [...document.querySelectorAll<HTMLButtonElement>('.chip')].filter((b) => b.disabled)
    expect(disabled.length).toBeGreaterThan(0)
  })

  it('explains the floor rule where "new to me" is shown as ask-first, and writes the ask-first line', () => {
    open()
    pickUse('Learning something new')
    click(labelled('Claude Project'))
    click(chip('Arithmetic, fractions and percentages'))
    click(setting('Arithmetic, fractions and percentages', 'New to me'))
    expect(document.body.textContent).toContain(NOTICE_TEXT.floor)
    expect(notes()).toContain('Arithmetic, fractions and percentages: before a long explanation, ask me one quick question')
    expect(notes()).not.toContain('Arithmetic, fractions and percentages: start from a small concrete example')
    click(chip('Probability and counting'))
    click(setting('Probability and counting', 'New to me'))
    expect(notes()).toContain('Probability and counting: start from a small concrete example')
    expect(notes()).toContain('On probability and counting, show one worked example')
  })

  it('says measured science lines are not available, and to set science topics yourself', () => {
    open()
    click(chip('Physics'))
    expect(document.body.textContent).toContain(COPY.science)
  })

  it('applies length, mode, words, sentences, format, voice and language as plain lines', () => {
    open()
    click(labelled('Short answers, with more detail offered'))
    click(labelled('General and academic vocabulary is fine'))
    click(labelled('Short sentences, one idea each'))
    click(labelled('Plain text: no tables'))
    click(labelled('I sometimes talk to my assistant by voice'))
    click(labelled('Teach me', $('fieldset:has(input[name=mode])')))
    const t = notes()
    expect(t).toContain('- Keep answers short and offer more detail at the end.')
    expect(t).toContain('- General and academic vocabulary is fine; define only terms specific to a field.')
    expect(t).toContain('- Use short sentences, one idea per sentence.')
    expect(t).not.toContain('Use plain words')
    expect(t).toContain('- Use plain text: no tables, no Markdown symbols and no emoji.')
    expect(t).toContain('- By default, teach: ask what')
    click(labelled('These notes apply in whatever language I chat in'))
    expect(notes()).not.toContain('whatever language we use')
  })

  it('writes interests and the person\'s own line, and refuses a line with a web address or a number, saying why', () => {
    open()
    type(labelled<HTMLInputElement>('Hobbies or subjects'), 'chess, cooking')
    expect(notes()).toContain('- When you need an example, use chess or cooking.')
    const own = $<HTMLInputElement>('#custom-0')
    type(own, 'Use metric units')
    expect(notes()).toContain('- Use metric units.')
    type(own, 'See https://example.org for 3 tips')
    expect(notes()).not.toContain('example.org')
    expect(document.body.textContent).toContain('Leave out web addresses and email addresses.')
    expect(document.body.textContent).toContain('Leave out numbers.')
    type(labelled<HTMLInputElement>('Hobbies or subjects'), 'my level is low')
    expect(notes()).not.toContain('level is low')
    expect(document.body.textContent).toContain('Describe how you want answers')
  })
})

describe('step 4: the preview', () => {
  it('lists every line with a tick box, locks the fixed clauses, and marks the person\'s own lines experimental', () => {
    open()
    pickUse('Learning something new')
    click(chip('Physics'))
    click(setting('Physics', 'I know this well'))
    const rows = [...document.querySelectorAll<HTMLElement>('.lines li')]
    const row = (text: string): HTMLElement => {
      const r = rows.find((x) => (x.textContent ?? '').includes(text))
      if (!r) throw new Error(`no row ${text}`)
      return r
    }
    const locked = row('My requests in the chat win').querySelector<HTMLInputElement>('input[type=checkbox]')
    expect(locked?.disabled).toBe(true)
    expect(locked?.checked).toBe(true)
    expect(row('My requests in the chat win').textContent).toContain('Always included')
    expect(row('Physics: skip the basics').textContent).toContain('Experimental')
    expect(row('Physics: skip the basics').textContent).not.toContain('Always included')
    expect(row('My own preferences').textContent).toContain('Always included')
  })

  it('leaves out an unticked line and keeps it in the list so it can be ticked again', () => {
    open()
    const rows = (): HTMLElement[] => [...document.querySelectorAll<HTMLElement>('.lines li')]
    const box = (): HTMLInputElement => rows().find((r) => (r.textContent ?? '').includes('Give chances and risks as counts'))!.querySelector('input')!
    expect(notes()).toContain('Give chances and risks as counts')
    click(box())
    expect(notes()).not.toContain('Give chances and risks as counts')
    expect(rows().find((r) => (r.textContent ?? '').includes('Give chances and risks'))?.textContent).toContain('Not included')
    click(box())
    expect(notes()).toContain('Give chances and risks as counts')
  })

  it('lets the person pick another wording from the grammar', () => {
    open()
    const row = [...document.querySelectorAll<HTMLElement>('.lines li')].find((r) => (r.textContent ?? '').includes('Start with the answer in a sentence or two'))!
    const choices = [...row.querySelectorAll<HTMLInputElement>('.wording input[type=radio]')]
    expect(choices.map((c) => c.value)).toEqual(['U1', 'U1c'])
    expect(choices[0]?.checked).toBe(true)
    click(choices[1]!)
    expect(notes()).toContain('Lead with the answer or the code')
    expect(notes()).not.toContain('Start with the answer in a sentence or two')
  })

  it('shows a "Why this line?" drawer that says what was and was not checked, with no numbers about the person', () => {
    open()
    const drawers = [...document.querySelectorAll<HTMLElement>('.lines details')]
    expect(drawers.length).toBeGreaterThan(5)
    const text = drawers.map((d) => d.textContent ?? '').join('\n')
    expect(text).toContain('Checked with: not yet checked.')
    expect(text).toContain('On ChatGPT custom instructions: not yet checked.')
    expect(text).toContain('Why this line')
    expect(text).toContain('What would change it')
    expect(text).not.toMatch(/\d/)
  })

  it('names the lines that do not fit instead of cutting them', () => {
    open()
    pickUse('Learning something new')
    for (const l of ['Physics', 'Chemistry', 'Biology', 'History', 'Geography']) click(chip(l))
    click(labelled('Plain text: no tables'))
    click(labelled('Describe diagrams and charts in words'))
    click(labelled('Short paragraphs, each step on its own line'))
    click(labelled('I sometimes talk to my assistant by voice'))
    for (const t of ['Physics', 'Chemistry', 'Biology', 'History', 'Geography']) click(setting(t, 'I know this well'))
    type(labelled<HTMLInputElement>('Hobbies or subjects'), 'chess, cooking, jazz')
    click(labelled('ChatGPT custom instructions'))
    const warn = $('.warn[role=status]')
    expect(warn.textContent).toContain('Some lines do not fit')
    expect(warn.querySelectorAll('li').length).toBeGreaterThan(0)
    expect(notes().length).toBeLessThanOrEqual(1500)
    expect(warn.textContent).toContain('choose the longer notes below')
    click(labelled('Long notes'))
    expect(document.querySelector('.warn[role=status]')).toBeNull()
  })

  it('needs an acknowledgement before the all-topics tier takes effect, and then lists topics from every set', () => {
    open()
    click(chip('History'))
    click(setting('History', 'I know this well'))
    click(button('Add another set of notes'))
    click(chip('Physics'))
    click(setting('Physics', 'I know this well'))
    click(labelled('Every topic I have set in all of my sets of notes'))
    expect(notes()).toContain('Physics: skip the basics')
    expect(notes()).not.toContain('History')
    expect(document.body.textContent).toContain('I understand, include every topic')
    click(labelled('I understand, include every topic'))
    expect(notes()).toContain('Physics and history: skip the basics')
    expect(document.body.textContent).toContain(NOTICE_TEXT.tier)
    click(button('Set 1'))
    expect(notes()).toContain('History: skip the basics')
    expect(notes()).not.toContain('Physics')
  })
})

describe('step 5: where to paste', () => {
  it('shows the provider warning, the anti-coercion notice and the placement advice above the copy button', () => {
    open()
    const warning = $('[data-testid=provider-warning]')
    const anti = $('[data-testid=anti-coercion]')
    const placement = $('[data-testid=placement]')
    const lookFor = $('[data-testid=look-for]')
    const copyButton = button('Copy the notes')
    // proposal §3.3 step 5: the provider warning, the anti-coercion notice, placement advice and "What to look for" come before copying
    for (const el of [warning, anti, placement, lookFor]) expect(el.compareDocumentPosition(copyButton) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    expect(lookFor.querySelector('h3')?.textContent).toBe('What to look for')
    expect(lookFor.textContent).toContain(COPY.troubleshooting)
    expect(button('Download hb-notes-2026-11-k3f9.txt').compareDocumentPosition(lookFor) & Node.DOCUMENT_POSITION_PRECEDING).toBeTruthy()
    expect(warning.textContent).toBe(COPY.providerWarning)
    expect(anti.textContent).toBe(COPY.antiCoercion)
    expect(placement.textContent).toBe(COPY.placement)
  })

  it('copies exactly the text in the preview and announces it', async () => {
    open()
    click(button('Copy the notes'))
    await vi.waitFor(() => expect($('[data-testid=status]').textContent).toBe(COPY.copied))
    expect(copy).toHaveBeenCalledTimes(1)
    expect(copy).toHaveBeenCalledWith(notes())
    expect($('[data-testid=status]').getAttribute('role')).toBe('status')
    expect($('[data-testid=status]').getAttribute('aria-live')).toBe('polite')
  })

  it('selects the notes for manual copying when the clipboard is refused', async () => {
    copy.mockResolvedValueOnce(false)
    open()
    click(button('Copy the notes'))
    await vi.waitFor(() => expect($('[data-testid=status]').textContent).toBe(COPY.copyFailed))
    expect(window.getSelection()?.toString().length).toBeGreaterThan(100)
  })

  it('downloads a uniquely named file whose bytes are the preview plus a final newline', () => {
    open()
    click(button('Download hb-notes-2026-11-k3f9.txt'))
    expect(download).toHaveBeenCalledWith(`${notes()}\n`, 'hb-notes-2026-11-k3f9.txt', 'text/plain')
    expect($('[data-testid=file-name]').textContent).toBe('hb-notes-2026-11-k3f9.txt')
  })

  it('gives a coding agent a Skill file to download and commands that refuse to overwrite, with removal steps', () => {
    open()
    pickUse('Coding and data')
    expect($('[data-testid=file-name]').textContent).toBe('hb-skill-2026-11-k3f9.md')
    const posix = $('[data-testid=install-commands]').textContent ?? ''
    expect(posix).toBe(
      [
        'mkdir -p ~/.claude/skills/working-with-me',
        '[ -e ~/.claude/skills/working-with-me/SKILL.md ] && echo "A file with that name already exists; nothing was changed." || mv ~/Downloads/hb-skill-2026-11-k3f9.md ~/.claude/skills/working-with-me/SKILL.md',
      ].join('\n'),
    )
    expect(posix).not.toContain('#')
    click(labelled('Windows (PowerShell)'))
    expect($('[data-testid=install-commands]').textContent).toContain('Move-Item "$HOME\\Downloads\\hb-skill-2026-11-k3f9.md"')
    expect($('[data-testid=install-commands]').textContent).not.toContain('#')
    const remove = [...document.querySelectorAll('details')].find((d) => d.querySelector('summary')?.textContent === 'How to remove these notes later')!
    expect(remove.textContent).toContain('Remove-Item')
    expect(remove.textContent).toContain(COPY.memoryNote)
  })

  it('says to paste into a shared personal file and never replace it', () => {
    open()
    click(labelled('Codex personal instructions'))
    expect(document.body.textContent).toMatch(/Never replace the file/)
    expect(document.querySelector('[data-testid=install-commands]')).toBeNull()
  })

  it('lets a destination that takes both lengths choose, and follows the choice', () => {
    open()
    click(labelled('Claude preferences'))
    const short = notes().length
    click(labelled('Long notes'))
    expect(notes().length).toBeGreaterThan(short)
    expect(notes().startsWith('# How I like explanations')).toBe(true)
    expect($('[data-testid=counter]').textContent).toContain('of 5,000 characters')
  })

  it('writes hb-brief/1 JSON for a destination that takes JSON, mirroring the text', () => {
    open()
    click(labelled('Your own app (JSON)'))
    const doc = JSON.parse(notes()) as { format: string; lines: { id: string }[] }
    expect(doc.format).toBe('hb-brief/1')
    expect(doc.lines.map((l) => l.id).slice(0, 5)).toEqual(['H', 'F1', 'F2', 'F3', 'F4'])
    click(button('Download hb-notes-2026-11-k3f9.json'))
    expect(download.mock.calls.at(-1)?.[2]).toBe('application/json')
  })

  it('lists what to look for, matching the lines in the notes, and the fallback', () => {
    open()
    pickUse('Learning something new')
    click(chip('Physics'))
    click(setting('Physics', 'I know this well'))
    const text = $('[data-testid=look-for]').textContent ?? ''
    expect(text).toContain('On skip-the-basics topics it goes straight to the method')
    expect(text).toContain('On answers that matter it says how sure it is')
    expect(text).toContain(`If none of this appears: ${COPY.troubleshooting}`)
    expect(text).not.toContain('By voice')
  })
})

describe('step 5: the date of the steps (R-17.10)', () => {
  it('shows when the install and removal steps were last checked, with no warning while they are fresh', () => {
    open()
    expect($('[data-testid=steps-checked]').textContent).toBe('Steps last checked 2026-09-28.')
    expect(document.querySelector('[data-testid=steps-stale]')).toBeNull()
  })

  it('warns once the steps are more than 120 days old', () => {
    open({ today: '2027-01-27' })
    expect($('[data-testid=steps-stale]').textContent).toContain('last checked on 2026-09-28, 121 days ago')
    // the warning does not hide the steps
    expect($('[data-testid=steps-checked]').textContent).toBe('Steps last checked 2026-09-28.')
    expect(document.body.textContent).toContain('Steps for ChatGPT custom instructions')
  })
})

describe('what HumanBench results add (proposal §3.1)', () => {
  it('says for Writing that HumanBench adds little and the notes never use results, and follows the chosen use', () => {
    open()
    expect($('[data-testid=results-note]').textContent).toBe('These notes use your own settings only.')
    pickUse('Writing')
    expect($('[data-testid=results-note]').textContent).toBe('HumanBench adds little here, so these notes never use results.')
    pickUse('Coding and data')
    expect($('[data-testid=results-note]').textContent).toBe('These notes use your own settings only.')
  })
})

describe('more', () => {
  it('offers the control-word card, the data-free snippet and for-ai.md, and downloads them', () => {
    open()
    expect($('[data-testid=card]').textContent).toContain('teach me')
    click(button('Download the card (SVG)'))
    expect(download.mock.calls.at(-1)?.[1]).toBe('hb-control-words.svg')
    expect(download.mock.calls.at(-1)?.[0]).toMatch(/^<svg /)
    expect($('[data-testid=snippet]').textContent).toContain('Never copy them into this repository.')
    click(button('Copy the snippet'))
    expect(copy).toHaveBeenLastCalledWith($('[data-testid=snippet]').textContent)
    click(button('Download for-ai.md'))
    expect(download.mock.calls.at(-1)?.[1]).toBe('for-ai.md')
    expect($('[data-testid=for-ai]').textContent).toContain('| Build up |')
    expect(document.querySelectorAll('main a[href]')).toHaveLength(0) // the notes never link to it (the frame's links sit outside the main part)
  })

  it('removes the settings on request and announces it', async () => {
    open()
    // nothing is stored yet (AI.7), so the text does not talk about a device copy or a fresh save download
    expect(document.body.textContent).toContain(COPY.removeStorageless)
    expect(document.body.textContent).not.toContain('Download a fresh save')
    expect(document.body.textContent).not.toContain('deletes your notes preferences from this device')
    pickUse('Coding and data')
    click(chip('Programming'))
    type(labelled<HTMLInputElement>('Hobbies or subjects'), 'chess')
    click(button('Remove my notes settings'))
    await vi.waitFor(() => expect($('[data-testid=more-status]').textContent).toBe(COPY.removeDone))
    expect(notes()).not.toContain('chess')
    expect(notes()).not.toContain('Programming')
    expect(labelled('General', $('fieldset')).checked).toBe(true)
  })
})

describe('local only: nothing is stored and nothing is sent', () => {
  it('writes nothing to any storage and sets no cookie, however much is typed or changed', async () => {
    const writes: string[] = []
    for (const name of ['setItem', 'removeItem', 'clear'] as const) {
      vi.spyOn(Storage.prototype, name).mockImplementation(() => {
        writes.push(name)
      })
    }
    const cookie = vi.spyOn(document, 'cookie', 'set').mockImplementation(() => {
      writes.push('cookie')
    })
    open()
    pickUse('Coding and data')
    click(chip('Programming'))
    click(setting('Programming', 'I know this well'))
    type(labelled<HTMLInputElement>('Hobbies or subjects'), 'chess, cooking')
    type($<HTMLInputElement>('#custom-0'), 'Use metric units')
    click(button('Copy the notes'))
    click(button('Download hb-skill-2026-11-k3f9.md'))
    click(button('Remove my notes settings'))
    await tick()
    expect(writes).toEqual([])
    expect(cookie).not.toHaveBeenCalled()
    expect(localStorage.length).toBe(0)
    expect(sessionStorage.length).toBe(0)
  })

  it('makes no request of any kind', async () => {
    const fetchSpy = vi.fn(() => Promise.reject(new Error('network use')))
    const xhrSpy = vi.fn()
    const beacon = vi.fn()
    vi.stubGlobal('fetch', fetchSpy)
    vi.stubGlobal('XMLHttpRequest', xhrSpy)
    vi.stubGlobal('WebSocket', xhrSpy)
    Object.defineProperty(navigator, 'sendBeacon', { value: beacon, configurable: true })
    open()
    click(button('Copy the notes'))
    click(button('Add another set of notes'))
    pickUse('Coding and data')
    type(labelled<HTMLInputElement>('Hobbies or subjects'), 'chess')
    click(button('Download hb-skill-2026-11-k3f9.md'))
    await tick()
    expect(fetchSpy).not.toHaveBeenCalled()
    expect(xhrSpy).not.toHaveBeenCalled()
    expect(beacon).not.toHaveBeenCalled()
    vi.unstubAllGlobals()
  })
})

/** The accessible name of an element that is named by `aria-labelledby` (what a screen reader reads first). */
const nameOf = (el: Element): string =>
  (el.getAttribute('aria-labelledby') ?? '')
    .split(/\s+/)
    .filter(Boolean)
    .map((id) => document.getElementById(id)?.textContent ?? '')
    .join(' ')
    .replace(/\s+/g, ' ')
    .trim()
const descriptionOf = (el: Element): string =>
  (el.getAttribute('aria-describedby') ?? '')
    .split(/\s+/)
    .filter(Boolean)
    .map((id) => document.getElementById(id)?.textContent ?? '')
    .join(' ')
    .replace(/\s+/g, ' ')
    .trim()

describe('the way around the page (UX-049)', () => {
  it('starts with a skip link that targets the copy section, and says where it goes', () => {
    open()
    const first = document.querySelector('a[href], button, input, select, textarea, summary')
    expect(first?.tagName).toBe('A')
    expect(first?.textContent).toBe(COPY.skipToCopy)
    expect(first?.getAttribute('href')).toBe(`#${COPY_TARGET_ID}`)
    const target = $(`#${COPY_TARGET_ID}`)
    expect(target.getAttribute('tabindex')).toBe('-1') // focusable by script, not an extra Tab stop
    expect(target.getAttribute('role')).toBe('group')
    expect(target.getAttribute('aria-label')).toBe(COPY.copyGroup)
  })

  it('moves focus to the warnings that come before copying, and the copy button is the next control', () => {
    open()
    const skip = $<HTMLAnchorElement>('a.skip-link')
    skip.focus()
    const event = new MouseEvent('click', { bubbles: true, cancelable: true })
    skip.dispatchEvent(event)
    flushSync()
    expect(event.defaultPrevented).toBe(true) // the page moves focus itself; the address does not gain a "#copy-notes"
    expect(document.activeElement).toBe($(`#${COPY_TARGET_ID}`))
    // the warnings are inside the target, before the buttons: they are not skipped over
    const target = $(`#${COPY_TARGET_ID}`)
    for (const id of ['provider-warning', 'anti-coercion', 'placement', 'look-for']) expect(target.contains($(`[data-testid=${id}]`)), id).toBe(true)
    const tabbable = [...target.querySelectorAll<HTMLElement>('a[href], button, input, select, textarea, summary')]
    expect(tabbable[0]?.textContent).toBe('Copy the notes') // the primary action is the first stop after the skip
    expect(tabbable.map((t) => t.textContent?.trim())).toContain(`Download hb-notes-2026-11-k3f9.txt`)
    // the status line stays inside, so what the buttons announce is read from the same place
    expect(target.contains($('[data-testid=status]'))).toBe(true)
  })

  it('puts the download first inside the target for a coding agent, and the copy button is then the second stop', () => {
    open()
    pickUse('Coding and data')
    const tabbable = [...$(`#${COPY_TARGET_ID}`).querySelectorAll<HTMLElement>('button')].map((b) => b.textContent?.trim() ?? '')
    expect(tabbable[0]).toMatch(/^Download hb-skill-/)
    expect(tabbable[1]).toBe('Copy the notes')
  })

  it('links back to the app and to the privacy notice, the privacy notice in its own tab so nothing typed here is lost', () => {
    open()
    const home = $<HTMLAnchorElement>('header.site a')
    expect(home.textContent).toBe('HumanBench')
    expect(home.getAttribute('href')).toBe(import.meta.env.BASE_URL)
    expect(home.hasAttribute('target')).toBe(false)
    const privacy = $<HTMLAnchorElement>('footer a')
    expect(privacy.textContent).toBe(`Privacy and terms${COPY.newTab}`)
    expect(privacy.getAttribute('href')).toBe(`${import.meta.env.BASE_URL}index.html#/privacy`)
    expect(privacy.getAttribute('target')).toBe('_blank')
    expect(privacy.getAttribute('rel')).toBe('noopener')
    // both stay on this site
    for (const a of [home, privacy]) expect(a.getAttribute('href')).not.toMatch(/^[a-z]+:\/\//i)
  })

  it('keeps the frame outside the main part, with one banner-level header and the disclaimer footer', () => {
    open()
    expect($('header.site').closest('main')).toBeNull()
    expect($('footer').closest('main')).toBeNull()
    expect(document.querySelectorAll('main')).toHaveLength(1)
    expect($('footer .disclaimer').textContent).toBe(DISCLAIMER)
  })
})

describe('where to use the notes: radios named by their short label (UX-051)', () => {
  it('names each radio by the short label and describes it with the longer line', () => {
    open()
    const radios = [...document.querySelectorAll<HTMLInputElement>('input[name=preset]')]
    expect(radios).toHaveLength(6)
    const names = radios.map(nameOf)
    expect([...names].sort()).toEqual(['Coding and data', 'Everyday numbers', 'General', 'Learning something new', 'Reading dense material', 'Writing'])
    for (const r of radios) {
      const hint = descriptionOf(r)
      expect(hint.length).toBeGreaterThan(20)
      expect(nameOf(r)).not.toContain(hint)
      expect(nameOf(r).length).toBeLessThan(hint.length)
      // the longer line is still inside the label, so a tap anywhere in the block picks it
      expect(r.closest('label')?.textContent).toContain(hint)
    }
  })

  it('gives every radio its own ids, and a click on the long line still picks the radio', () => {
    open()
    const radios = [...document.querySelectorAll<HTMLInputElement>('input[name=preset]')]
    const ids = radios.flatMap((r) => [r.getAttribute('aria-labelledby'), r.getAttribute('aria-describedby')])
    expect(new Set(ids).size).toBe(ids.length)
    const coding = radios.find((r) => nameOf(r) === 'Coding and data') as HTMLInputElement
    const hintEl = document.getElementById(coding.getAttribute('aria-describedby') as string) as HTMLElement
    hintEl.click()
    flushSync()
    expect(coding.checked).toBe(true)
    expect(notes().startsWith('---\nname: working-with-me')).toBe(true)
  })
})

describe('copy polish (UX-052)', () => {
  it('says "Maths", and tells the assistant how to adjust its explanations, not how to pitch them', () => {
    open()
    expect([...document.querySelectorAll('h3')].some((h) => h.textContent === 'Maths and numbers')).toBe(true)
    expect(document.body.textContent).not.toMatch(/\bMath and\b/)
    expect(document.body.textContent).toContain('and your notes tell the assistant how to adjust its explanations.')
    expect(STEPS.topics.hint).not.toMatch(/pitch/) // (the word is gated elsewhere, in the notes' own lines; only this hint changed)
  })

  it('names the form in lower case beside the others: "(short form)", then "(skill form)"', () => {
    open()
    expect($('[data-testid=counter]').textContent?.replace(/\s+/g, ' ')).toContain('(short form)')
    pickUse('Coding and data')
    expect($('[data-testid=counter]').textContent?.replace(/\s+/g, ' ')).toContain('(skill form)')
    expect($('[data-testid=counter]').textContent).not.toContain('Skill form')
  })
})
