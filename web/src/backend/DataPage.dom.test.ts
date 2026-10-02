import { flushSync } from 'svelte'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { buttonByText, click } from '../render/common/testing'
import { mountInto, type Mounted } from '../render/dom-testing'
import { jcs } from '../save/jcs'
import type { SaveFileV1, SaveSession } from '../save/types'
import { createBackendApi } from './api'
import { BackendError } from './errors'
import DataPage from './DataPage.svelte'
import { ANON, CANNED, ScriptedTransport } from './testing'

let mounted: Mounted | undefined
afterEach(() => {
  mounted?.destroy()
  mounted = undefined
})

const tick = async (n = 6): Promise<void> => {
  for (let i = 0; i < n; i++) await new Promise((r) => setTimeout(r, 0))
  flushSync()
}
const setup = (): { t: ScriptedTransport; root: HTMLElement; download: ReturnType<typeof vi.fn> } => {
  const t = new ScriptedTransport()
  const download = vi.fn((_s: SaveFileV1) => 'file.json')
  mounted = mountInto(DataPage, { api: createBackendApi(t, { sleep: () => Promise.resolve() }), download })
  return { t, root: mounted.target, download }
}
const field = (root: HTMLElement, label: RegExp): HTMLInputElement | HTMLTextAreaElement => {
  const l = [...root.querySelectorAll('label')].find((x) => label.test(x.textContent ?? ''))
  const el = l?.control
  if (!(el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement)) throw new Error(`no field ${String(label)}`)
  return el
}
function fill(el: HTMLInputElement | HTMLTextAreaElement, value: string): void {
  el.value = value
  el.dispatchEvent(new Event('input', { bubbles: true }))
  flushSync()
}

const unsigned = (id: string): SaveSession => {
  const { sig: _sig, ...bare } = (CANNED.finish as { session: SaveSession }).session
  return { ...bare, session_id: id }
}
const signed = (anon: string, id: string): SaveSession => ({ ...unsigned(id), sig: { alg: 'HMAC-SHA256', kid: 'k2026a', mac: 'bWFj', anon_id: anon } })
const save = (sessions: SaveSession[], anon = ANON): SaveFileV1 => ({ schema_version: '1.0.0', bank_version: 'b', anon_id: anon, created_utc: '2026-10-03T17:20:02Z', sessions, seen_items: [], seen_families: [] })
const PHRASE = 'acorn acrobat action advice agate agenda aisle album alder alert almond amber'

describe('the data page (M2.7; DESIGN §8, §13)', () => {
  it('in the static fallback only explains that nothing is on a server', () => {
    mounted = mountInto(DataPage, { api: null })
    const text = mounted.target.textContent ?? ''
    expect(text).toContain('keeps nothing on a server')
    expect(mounted.target.querySelector('input')).toBeNull()
    expect(mounted.target.querySelector('a[href="#/"]')).not.toBeNull()
  })

  describe('getting a backup back', () => {
    it('finds it with the identifier and the phrase, and hands the file over', async () => {
      const { t, root, download } = setup()
      const got = save([signed(ANON, 's_ABCDEFGH1')])
      t.script('mirror_get', { found: true, save: got, updated_utc: '2026-10-04T10:00:00Z' })
      fill(field(root, /Save identifier/), ` ${ANON} `)
      fill(field(root, /Recovery phrase/), ` ${PHRASE.toUpperCase()}\n`)
      click(buttonByText(root, 'Get my backup'))
      await tick()
      expect(t.args('mirror_get')).toEqual({ p_anon_id: ANON, p_phrase: PHRASE })
      expect(root.textContent).toContain('Found your backup')
      click(buttonByText(root, 'Download the backup'))
      expect(download).toHaveBeenCalledTimes(1)
      expect(jcs(download.mock.calls[0]![0])).toBe(jcs(got))
      expect((field(root, /Recovery phrase/) as HTMLInputElement).value).toBe('') // the phrase is not kept on screen
    })

    it('says the same for a wrong phrase and an unknown identifier', async () => {
      const { t, root } = setup()
      t.script('mirror_get', { found: false })
      fill(field(root, /Save identifier/), ANON)
      fill(field(root, /Recovery phrase/), PHRASE)
      click(buttonByText(root, 'Get my backup'))
      await tick()
      expect(root.textContent).toContain('Nothing matched that identifier and phrase.')
      expect(root.textContent).not.toContain('Download the backup')
    })

    it('needs both fields', () => {
      const { root } = setup()
      expect(buttonByText(root, 'Get my backup').disabled).toBe(true)
      fill(field(root, /Save identifier/), ANON)
      expect(buttonByText(root, 'Get my backup').disabled).toBe(true)
    })

    it('tells a limit from a failure', async () => {
      const { t, root } = setup()
      t.script('mirror_get', new BackendError('limited', 'rate_limited', { status: 429 }))
      fill(field(root, /Save identifier/), ANON)
      fill(field(root, /Recovery phrase/), PHRASE)
      click(buttonByText(root, 'Get my backup'))
      await tick()
      expect(root.textContent).toContain('Too many tries')
      t.script('mirror_get', new BackendError('network', 'network_error'), new BackendError('network', 'network_error'), new BackendError('network', 'network_error'))
      click(buttonByText(root, 'Get my backup'))
      await tick()
      expect(root.textContent).toContain('could not be reached')
    })
  })

  describe('deleting', () => {
    it('with the phrase: asks first, says what it does not touch, then deletes and reports the counts', async () => {
      const { t, root } = setup()
      const did = [...root.querySelectorAll('form')][1]!
      fill(field(did, /Save identifier/), ANON)
      fill(field(did, /Recovery phrase/), PHRASE)
      click(buttonByText(did, 'Delete my data'))
      expect(root.querySelector('section.confirm h2')?.textContent).toBe('Delete for good?')
      expect(root.querySelector('section.confirm')?.textContent).toContain('Save files you downloaded stay with you')
      expect(t.callsOf('delete_my_data')).toBe(0)
      click(buttonByText(root.querySelector<HTMLElement>('section.confirm')!, 'Keep it'))
      expect(root.querySelector('section.confirm')).toBeNull()
      expect(t.callsOf('delete_my_data')).toBe(0)
      t.script('delete_my_data', { deleted: true, sessions: 3, mirror: true })
      click(buttonByText(did, 'Delete my data'))
      click(buttonByText(root.querySelector<HTMLElement>('section.confirm')!, 'Delete my data'))
      await tick()
      expect(t.args('delete_my_data')).toEqual({ p_anon_id: ANON, p_phrase: PHRASE })
      expect(root.textContent).toContain('Deleted 3 sessions and the backup.')
      expect((field(did, /Recovery phrase/) as HTMLInputElement).value).toBe('')
    })

    it('says nothing matched, in one way, whatever was wrong', async () => {
      const { t, root } = setup()
      const did = [...root.querySelectorAll('form')][1]!
      fill(field(did, /Save identifier/), ANON)
      fill(field(did, /Recovery phrase/), PHRASE)
      t.script('delete_my_data', { deleted: false })
      click(buttonByText(did, 'Delete my data'))
      click(buttonByText(root.querySelector<HTMLElement>('section.confirm')!, 'Delete my data'))
      await tick()
      expect(root.textContent).toContain('Nothing was deleted. The phrase or the file did not match anything stored.')
    })

    it('asks for something to prove with before it asks to confirm', () => {
      const { root } = setup()
      const did = [...root.querySelectorAll('form')][1]!
      click(buttonByText(did, 'Delete my data'))
      expect(root.querySelector('section.confirm')).toBeNull()
      expect(root.textContent).toContain('Enter your identifier and recovery phrase, or choose a save file.')
    })

    it('with a save: deletes under each identifier its signed sessions were issued to, sending only the signed sessions', async () => {
      const { t, root } = setup()
      const other = 'hb_Another0Person000'
      const file = save([signed(ANON, 's_ABCDEFGH1'), signed(ANON, 's_ABCDEFGH2'), signed(other, 's_ABCDEFGH3'), unsigned('s_ABCDEFGH4')])
      const did = [...root.querySelectorAll('form')][1]!
      click(did.querySelector<HTMLInputElement>('input[value="file"]')!)
      fill(field(did, /paste a save code/), jcs(file))
      t.script('delete_my_data', { deleted: true, sessions: 2, mirror: false }, { deleted: true, sessions: 1, mirror: true })
      click(buttonByText(did, 'Delete my data'))
      click(buttonByText(root.querySelector<HTMLElement>('section.confirm')!, 'Delete my data'))
      await tick(12)
      expect(t.callsOf('delete_my_data')).toBe(2)
      expect([t.args('delete_my_data', 0).p_anon_id, t.args('delete_my_data', 1).p_anon_id].sort()).toEqual([ANON, other].sort())
      for (const i of [0, 1]) {
        const sent = t.args('delete_my_data', i).p_save as SaveFileV1
        expect(sent.sessions.every((s) => s.sig !== undefined)).toBe(true)
        expect(sent.sessions).toHaveLength(3)
      }
      expect(root.textContent).toContain('Deleted 3 sessions and the backup.')
    })

    it('with a file that is not a save, says so and calls nothing', async () => {
      const { t, root } = setup()
      const did = [...root.querySelectorAll('form')][1]!
      click(did.querySelector<HTMLInputElement>('input[value="file"]')!)
      fill(field(did, /paste a save code/), 'not a save at all')
      click(buttonByText(did, 'Delete my data'))
      click(buttonByText(root.querySelector<HTMLElement>('section.confirm')!, 'Delete my data'))
      await tick(12)
      expect(t.callsOf('delete_my_data')).toBe(0)
      expect(root.querySelector('p[role="status"].error')?.textContent).toBeTruthy()
    })
  })
})
