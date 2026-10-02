/**
 * The ready screen with a server (ROADMAP M2.7; DESIGN §8 "Tamper evidence"; ROADMAP A16): loading a
 * save shows which of its sessions the server could check, only the signed ones are sent to ask, a
 * server that cannot be reached never blocks the load, and a backup can be fetched back by identifier
 * and phrase. Without a server none of it is on the screen.
 */

import { flushSync } from 'svelte'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createBackendApi } from '../backend/api'
import { BackendError } from '../backend/errors'
import { ANON, CANNED, ScriptedTransport } from '../backend/testing'
import { buttonByText, click } from '../render/common/testing'
import { mountInto, type Mounted } from '../render/dom-testing'
import { jcs } from '../save/jcs'
import type { SaveFileV1, SaveSession } from '../save/types'
import { defaultReadyState, type ReadyState } from './ready-state'
import Ready from './Ready.svelte'

let mounted: Mounted | undefined
afterEach(() => {
  mounted?.destroy()
  mounted = undefined
})
const tick = async (n = 6): Promise<void> => {
  for (let i = 0; i < n; i++) await new Promise((r) => setTimeout(r, 0))
  flushSync()
}

const base = (CANNED.finish as { session: SaveSession }).session
const bare = ((): SaveSession => {
  const { sig: _s, ...rest } = base
  return rest
})()
const signed = (id: string, date: string): SaveSession => ({ ...base, session_id: id, started_utc: date })
const unsigned = (id: string, date: string): SaveSession => ({ ...bare, session_id: id, started_utc: date })
const save = (sessions: SaveSession[]): SaveFileV1 => ({ schema_version: '1.0.0', bank_version: 'b', anon_id: ANON, created_utc: '2026-10-03T17:20:02Z', sessions, seen_items: [], seen_families: [] })

function setup(server: boolean): { t: ScriptedTransport; root: HTMLElement; choices: { current: ReadyState } } {
  const t = new ScriptedTransport()
  const api = createBackendApi(t, { sleep: () => Promise.resolve() })
  const choices = { current: defaultReadyState(null) }
  mounted = mountInto(Ready, {
    restored: null,
    choices: choices.current,
    onchoices: (c: ReadyState) => {
      choices.current = c
    },
    onpractice: vi.fn(),
    onbegin: vi.fn(),
    ...(server ? { verify: (s: SaveFileV1) => api.verifySave(s), restore: (id: string, p: string) => api.mirrorGet(id, p) } : {}),
  })
  return { t, root: mounted.target, choices }
}
async function load(root: HTMLElement, s: SaveFileV1): Promise<void> {
  const area = root.querySelector<HTMLTextAreaElement>('textarea')!
  area.value = jcs(s)
  area.dispatchEvent(new Event('input', { bubbles: true }))
  flushSync()
  click(buttonByText(root, 'Load'))
  await tick(10)
}

describe('loading a save with a server', () => {
  it('asks about the signed sessions only, and shows the verdicts in words', async () => {
    const { t, root, choices } = setup(true)
    t.replies.verify_save = {
      anon_id: ANON,
      n_verified: 1,
      n_unverified: 1,
      sessions: [
        { session_id: 's_SIGNED0001', status: 'verified', reason: null },
        { session_id: 's_SIGNED0002', status: 'unverified', reason: 'bad_signature' },
      ],
    }
    await load(root, save([signed('s_SIGNED0001', '2026-10-01T10:00:00Z'), signed('s_SIGNED0002', '2026-10-02T10:00:00Z'), unsigned('s_LOCAL00001', '2026-10-03T10:00:00Z')]))
    expect(choices.current.loaded?.sessions).toHaveLength(3)
    expect(root.textContent).toContain('Loaded 3 earlier sessions')
    expect(t.callsOf('verify_save')).toBe(1)
    expect((t.args('verify_save').p_save as SaveFileV1).sessions.map((s) => s.session_id)).toEqual(['s_SIGNED0001', 's_SIGNED0002'])
    const check = root.querySelector('[data-section="save-check"]')!
    expect(check.textContent).toContain('1 session was checked by the server.')
    expect(check.textContent).toContain('2 sessions were not checked.')
    expect(check.textContent).toContain('Session of 2026-10-02: changed since the server saved it, or saved under another identifier.')
    expect(check.textContent).toContain('Session of 2026-10-03: made on this device, without the server.')
  })

  it('a save with no signed session is unverified without asking anyone', async () => {
    const { t, root } = setup(true)
    await load(root, save([unsigned('s_LOCAL00001', '2026-10-03T10:00:00Z')]))
    expect(t.callsOf('verify_save')).toBe(0)
    expect(root.querySelector('[data-section="save-check"]')?.textContent).toContain('1 session was not checked.')
  })

  it('a server that cannot be reached never blocks the load, and its sessions are "not checked", never "verified"', async () => {
    const { t, root, choices } = setup(true)
    t.script('verify_save', new BackendError('network', 'network_error'), new BackendError('network', 'network_error'), new BackendError('network', 'network_error'))
    await load(root, save([signed('s_SIGNED0001', '2026-10-01T10:00:00Z')]))
    expect(choices.current.loaded?.sessions).toHaveLength(1)
    expect(root.querySelector('[data-section="save-check"]')?.textContent).toContain('could not check these sessions just now')
    expect(root.querySelector('[data-verified]')).toBeNull()
  })

  it('fetches a backup by identifier and phrase and adds it to the choices', async () => {
    const { t, root, choices } = setup(true)
    const got = save([signed('s_SIGNED0001', '2026-10-01T10:00:00Z')])
    t.script('mirror_get', { found: true, save: got, updated_utc: '2026-10-04T10:00:00Z' }, { found: false })
    const details = root.querySelector('details.focus')!
    expect(details.textContent).toContain('Get a backup from the server')
    const [id, phrase] = [...details.querySelectorAll<HTMLInputElement>('input[type="text"]')]
    for (const [el, v] of [[id!, ANON], [phrase!, 'acorn acrobat action advice agate agenda aisle album alder alert almond amber']] as const) {
      el.value = v
      el.dispatchEvent(new Event('input', { bubbles: true }))
    }
    flushSync()
    click(buttonByText(details as HTMLElement, 'Get my backup'))
    await tick(10)
    expect(choices.current.loaded?.sessions.map((s) => s.session_id)).toEqual(['s_SIGNED0001'])
    expect(details.textContent).toContain('Loaded your backup with 1 earlier session')
    expect(phrase!.value).toBe('') // the phrase is not kept on screen
    phrase!.value = 'zzz'
    phrase!.dispatchEvent(new Event('input', { bubbles: true }))
    flushSync()
    click(buttonByText(details as HTMLElement, 'Get my backup'))
    await tick(10)
    expect(details.textContent).toContain('Nothing matched that identifier and phrase.')
  })
})

describe('the ready screen without a server', () => {
  it('has no backup to fetch, and shows no check of a loaded save', async () => {
    const { t, root } = setup(false)
    expect(root.querySelector('details.focus')).toBeNull()
    await load(root, save([signed('s_SIGNED0001', '2026-10-01T10:00:00Z')]))
    expect(root.textContent).toContain('Loaded 1 earlier session')
    expect(root.querySelector('[data-section="save-check"]')).toBeNull()
    expect(t.calls).toEqual([])
  })
})
