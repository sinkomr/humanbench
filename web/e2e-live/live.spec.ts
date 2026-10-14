/// <reference lib="dom" />
/**
 * One short session through the production build against a real project (see
 * `playwright.live.config.ts`): the consent says what is sent, the server opens a session and serves
 * real questions, the answers go to it and no reply carries a key or a verdict, the session is
 * closed and signed, the results say the server checked it, and the data page deletes it again.
 * A second test cuts the server off and checks that the person can go on with this device only.
 */

import { readFileSync } from 'node:fs'
import { expect, test, type Page, type Response } from '@playwright/test'
import { agreeGate, answerItem, button, h1 } from '../e2e/flow'

const SERVER = (process.env.HB_LIVE_SUPABASE_URL ?? '').replace(/\/+$/u, '')
const ANON_KEY = process.env.HB_LIVE_SUPABASE_ANON_KEY ?? ''
const ANSWERS = 3
/** Names no reply to a taker may carry (R-11.1): the key, its tolerance, a verdict, an item's parameters. */
const KEY_NAMES = new Set(['key', 'tolerance', 'tol', 'option_weights', 'rationale', 'answer', 'solution', 'verdict', 'is_correct', 'se_b', 'difficulty_prior', 'verification', 'provenance', 'server_tags'])

interface Call { readonly rpc: string; readonly status: number; readonly body: unknown }

function keyNames(value: unknown, path = ''): string[] {
  if (Array.isArray(value)) return value.flatMap((v) => keyNames(v, `${path}[]`))
  if (typeof value !== 'object' || value === null) return []
  return Object.entries(value).flatMap(([k, v]) => [...(KEY_NAMES.has(k) ? [`${path}/${k}`] : []), ...(k === 'correct' && v !== null ? [`${path}/correct`] : []), ...keyNames(v, `${path}/${k}`)])
}

function record(page: Page): Call[] {
  const calls: Call[] = []
  page.on('response', (res: Response) => {
    const at = res.url()
    if (!at.startsWith(`${SERVER}/rest/v1/rpc/`) || res.request().method() !== 'POST') return
    void res.json().then((body: unknown) => calls.push({ rpc: at.slice(`${SERVER}/rest/v1/rpc/`.length), status: res.status(), body }), () => calls.push({ rpc: at.slice(`${SERVER}/rest/v1/rpc/`.length), status: res.status(), body: null }))
  })
  return calls
}

/**
 * The safety net of the clean-up: if the test stopped before the data page deleted the session, delete it
 * with the signed session of the `finish` reply, as the anonymous client would (`delete_my_data`).
 */
async function deleteLeftover(calls: readonly Call[]): Promise<void> {
  const start = calls.find((c) => c.rpc === 'start_session')?.body as { bank_version: string | null } | undefined
  const fin = calls.find((c) => c.rpc === 'finish')?.body as { anon_id: string; session: unknown } | undefined
  if (start === undefined || fin === undefined) {
    if (start !== undefined) console.warn('live smoke: a session was started and never finished; its token expires on its own and it holds no signed copy to delete with.')
    return
  }
  const save = { schema_version: '1.0.0', bank_version: start.bank_version ?? 'unknown', anon_id: fin.anon_id, created_utc: new Date().toISOString().replace(/\.\d+Z$/u, 'Z'), sessions: [fin.session], seen_items: [], seen_families: [] }
  const res = await fetch(`${SERVER}/rest/v1/rpc/delete_my_data`, { method: 'POST', headers: { apikey: ANON_KEY, 'Content-Type': 'application/json' }, body: JSON.stringify({ p_anon_id: fin.anon_id, p_save: save }) })
  console.warn(`live smoke: clean-up through the API: ${res.status} ${await res.text()}`)
}

/** The save file the results offer. A visit that measured nothing keeps it behind a disclosure. */
async function downloadSave(page: Page): Promise<string> {
  const offer = button(page, 'Download save file')
  const disclosure = page.getByText('Keep a file of this visit anyway')
  await expect(offer.or(disclosure).first()).toBeVisible({ timeout: 30_000 })
  if (!(await offer.isVisible())) await disclosure.click()
  const download = page.waitForEvent('download')
  await offer.click()
  return readFileSync((await (await download).path())!, 'utf8')
}

/**
 * "Delete my data from the server" with a save file, up to the confirmation. The session's screens
 * stay in the page, hidden, behind the data page, so everything is found by role inside the screen
 * that is shown (a bare `form` locator finds the hidden ones first).
 */
async function deleteWithFile(page: Page, text: string): Promise<void> {
  await page.goto('./#/data')
  await expect(h1(page)).toHaveText('Your data on the server')
  const data = page.locator('main').filter({ has: page.getByRole('heading', { level: 1, name: 'Your data on the server' }) })
  await data.getByRole('radio', { name: 'With a save file' }).check()
  await data.getByLabel('Save file', { exact: true }).setInputFiles({ name: 'humanbench-save.txt', mimeType: 'text/plain', buffer: Buffer.from(text) })
  await data.getByRole('button', { name: 'Delete my data' }).click()
  await data.locator('section.confirm').getByRole('button', { name: 'Delete my data' }).click()
}

async function toReady(page: Page): Promise<void> {
  await page.goto('./')
  await button(page, 'Start').click()
  await expect(page.locator('ul.points')).toContainText('sent to a server')
  await agreeGate(page)
  await page.getByRole('checkbox', { name: /honour code/ }).check()
  await button(page, 'Continue').click()
  await expect(button(page, 'Continue')).toBeEnabled({ timeout: 30_000 })
  await button(page, 'Continue').click()
  await expect(h1(page)).toHaveText('Ready when you are')
}

async function skipReactionTime(page: Page): Promise<void> {
  await expect(h1(page)).toHaveText('Up next: Reaction Time', { timeout: 30_000 })
  await button(page, 'Skip this part').click()
  await page.locator('section.confirm').getByRole('button', { name: /^Skip / }).click()
  await expect(h1(page)).toHaveText('Up next: Matrix & Series')
}

test('a short session against the live server: served questions, no key in any reply, a signed session, and its deletion', async ({ page }) => {
  expect(SERVER).toMatch(/^https:\/\//u)
  await page.emulateMedia({ reducedMotion: 'reduce' })
  const calls = record(page)
  let deleted = false
  try {
    await session(page, calls)
    deleted = true
  } finally {
    if (!deleted) await deleteLeftover(calls)
  }
})

async function session(page: Page, calls: Call[]): Promise<void> {
  // The notice of the online version, not the static one.
  await page.goto('./#/privacy')
  await expect(h1(page)).toHaveText('Privacy and terms')
  await expect(page.getByRole('heading', { name: 'What is sent to the server' })).toBeVisible()
  await expect(page.locator('footer').getByRole('link', { name: 'Your data on the server' })).toBeVisible()

  await toReady(page)
  await expect(page.getByText('sent to the server as you give them')).toBeVisible()
  await button(page, 'Begin').click()
  await skipReactionTime(page)
  await button(page, 'Start').click()

  for (let i = 0; i < ANSWERS; i++) {
    await expect(page.locator('form.choice').or(page.locator('form.entry'))).toBeVisible({ timeout: 30_000 })
    await page.waitForTimeout(2500) // nobody answers in no time; the server's own clock sees it
    await answerItem(page)
  }
  await expect(page.locator('body')).not.toContainText(/\b(correct|incorrect|wrong answer)\b/i)
  await button(page, 'Finish early').click()
  await button(page, 'Finish now').click()
  await expect(h1(page)).toHaveText(/^Session (complete|ended)$/, { timeout: 60_000 })
  await expect(page.locator('[data-section="online"] [data-section="save-check"]')).toContainText('1 session was checked by the server.', { timeout: 30_000 })

  // What went over the wire.
  const by = (rpc: string): Call[] => calls.filter((c) => c.rpc === rpc)
  expect(calls.filter((c) => c.status !== 200).map((c) => `${c.rpc} ${c.status}`)).toEqual([])
  expect(by('start_session')).toHaveLength(1)
  expect(by('submit').length).toBeGreaterThanOrEqual(ANSWERS)
  expect(by('finish')).toHaveLength(1)
  const served = [...by('next_item'), ...by('submit').map((c) => ({ ...c, body: (c.body as { next?: unknown }).next ?? null }))].map((c) => (c.body as { item?: Record<string, unknown> } | null)?.item).filter((x) => x !== undefined)
  expect(served.length).toBeGreaterThanOrEqual(ANSWERS)
  for (const item of served) expect(Object.keys(item).sort()).toEqual(['item_id', 'item_type', 'media', 'options', 'stem', 'time_limit_s'].filter((k) => k in item))
  expect(calls.flatMap((c) => keyNames(c.body).map((p) => `${c.rpc}${p}`))).toEqual([])
  const started = by('start_session')[0]!.body as { bank_version: string | null; session_id: string }
  expect(started.bank_version).not.toBeNull()

  // The save the page offers holds the signed session, with no verdict in it. Three answers measure
  // nothing (an axis needs five), so the results have no profile and the save is behind a disclosure.
  const text = await downloadSave(page)
  const saved = JSON.parse(text) as { anon_id: string; sessions: { session_id: string; sig?: { mac: string; kid: string }; responses: unknown[][] }[] }
  const session = saved.sessions.find((s) => s.session_id === started.session_id)!
  expect(session.sig?.mac).toBeTruthy()
  expect(session.responses.length).toBeGreaterThanOrEqual(ANSWERS)
  for (const r of session.responses) expect(r[3]).toBeNull()
  console.log(`live session ${started.session_id}: ${session.responses.length} answers, bank ${started.bank_version}, signed with ${session.sig?.kid}; calls: ${[...new Set(calls.map((c) => c.rpc))].join(', ')}`)

  // Clean up through the page a person would use: the data page, with the save file.
  await deleteWithFile(page, text)
  await expect(page.getByText('Deleted 1 session.')).toBeVisible({ timeout: 30_000 })
}

test('with the server cut off the person goes on with this device only', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' }) // the results are complete at once
  let reached = 0
  const rpcs: string[] = []
  await page.route(`${SERVER}/**`, (route) => {
    reached++
    rpcs.push(new URL(route.request().url()).pathname.replace(/^.*\/rpc\//u, ''))
    return route.abort('connectionrefused')
  })
  await toReady(page)
  await button(page, 'Begin').click()
  await expect(h1(page)).toHaveText('Getting your session ready')
  await expect(page.getByRole('alert')).toContainText('could not reach the server', { timeout: 60_000 })
  expect(reached).toBeGreaterThan(0)
  await button(page, 'Use this device only').click()
  await skipReactionTime(page)
  const before = reached
  await button(page, 'Start').click()
  await expect(page.locator('form.choice').or(page.locator('form.entry'))).toBeVisible({ timeout: 30_000 }) // a question made on the device
  await answerItem(page)
  expect(reached).toBe(before) // and nothing more is asked of the server

  // Its file holds no session the server issued, so the data page has nothing to delete with it and asks the server nothing.
  await button(page, 'Finish early').click()
  await button(page, 'Finish now').click()
  await expect(h1(page)).toHaveText(/^Session (complete|ended)$/, { timeout: 60_000 })
  expect(reached).toBe(before) // the session's end asked nothing either
  const text = await downloadSave(page)
  expect((JSON.parse(text) as { sessions: { sig?: unknown }[] }).sessions.every((s) => s.sig === undefined)).toBe(true)
  await deleteWithFile(page, text)
  await expect(page.getByText('Nothing was deleted.')).toBeVisible()
  // The data page is opened by a new page load (`deleteWithFile`), and every page load asks once which skills the server
  // has questions for (`live_axes`, ROADMAP M3.11), which here fails as well. The data page itself asks nothing.
  expect(rpcs.slice(before)).toEqual(['live_axes'])
})
