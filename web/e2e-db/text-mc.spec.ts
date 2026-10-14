/// <reference lib="dom" />
/**
 * Served text multiple choice, browser to database (ROADMAP M3.11 phase 1; DESIGN §3, §7.4, §10, §11.2,
 * R-11.1): the app in Chromium, WebKit and an emulated iPhone, with the real supabase-js client, against
 * the real PL/pgSQL of `supabase/migrations` on a local PostgreSQL (`server.ts`). The questions are made
 * up (`scripts/db/bank-fixture.ts` `textItems`); nothing here is a real item or a real key.
 *
 * - "plain": a pool with no text item, as the live project has today. A page that asks for the text parts
 *   gets the six parts and nothing else, and the server is asked once per text skill.
 * - "text": the same pool plus questions for three of the five text skills. Those three parts run, the
 *   server scores them, signs the session and publishes the three skills; no reply holds a key or a verdict.
 */

import { expect, test, type Page, type Response } from '@playwright/test'
import { DB_PORT, TEXT_PER_AXIS } from './pool'

const PLAIN = `http://127.0.0.1:${DB_PORT}`
const TEXT = `http://127.0.0.1:${DB_PORT + 1}`
/** A page pointed at a database; the parts come from what it has (`live_axes`), no build variable or link names them. */
const query = (server: string): string => `?hb_backend=${encodeURIComponent(server)}&hb_key=e2e-anon-key`
const ROOT = 'div.hb-render.text-mc'

const h1 = (page: Page) => page.getByRole('heading', { level: 1 })
const button = (page: Page, name: string | RegExp) => page.getByRole('button', { name, exact: typeof name === 'string' })

interface Rpc {
  readonly fn: string
  readonly request: Record<string, unknown>
  readonly status: number
  readonly reply: unknown
}

/** Every call to the server and its reply, as they crossed the wire. */
function watch(page: Page): Rpc[] {
  const calls: Rpc[] = []
  page.on('response', (response: Response) => {
    const m = /\/rest\/v1\/rpc\/(\w+)$/u.exec(new URL(response.url()).pathname)
    if (m === null || response.request().method() !== 'POST') return
    void response
      .json()
      .catch(() => null)
      .then((reply: unknown) => calls.push({ fn: m[1]!, request: (response.request().postDataJSON() ?? {}) as Record<string, unknown>, status: response.status(), reply }))
  })
  return calls
}

async function toReady(page: Page, q: string): Promise<void> {
  await page.goto(`./${q}`)
  await button(page, 'Start').click()
  await page.getByRole('checkbox', { name: /18 or older/ }).check()
  await button(page, 'Continue').click()
  await page.getByRole('checkbox', { name: /honour code/ }).check()
  await button(page, 'Continue').click()
  await expect(button(page, 'Continue')).toBeEnabled({ timeout: 30_000 })
  await button(page, 'Continue').click()
  await expect(h1(page)).toHaveText('Ready when you are')
}

/** The next screen that is not the break offer (declined) or a wait. */
async function nextScreen(page: Page): Promise<string> {
  await expect(h1(page)).toHaveText(/^(Up next: .+|Time for a break\?|Session .+)$/, { timeout: 30_000 })
  if ((await h1(page).textContent()) === 'Time for a break?') {
    await button(page, 'Keep going').click()
    await expect(h1(page)).toHaveText(/^(Up next: .+|Session .+)$/, { timeout: 30_000 })
  }
  return ((await h1(page).textContent()) ?? '').trim()
}

async function skipPart(page: Page): Promise<void> {
  await button(page, 'Skip this part').click()
  await page.locator('section.confirm').getByRole('button', { name: /^Skip / }).click()
}

/** Answers text questions until the part is over; returns how many. */
async function playTextPart(page: Page, title: string): Promise<number> {
  await button(page, 'Start').click()
  let n = 0
  for (;;) {
    await expect(h1(page)).toHaveText(new RegExp(`^(${title.replace(/[&]/gu, '\\&')}|Up next: .+|Time for a break\\?|Session .+)$`), { timeout: 30_000 })
    const radios = page.locator(`${ROOT} input[type="radio"]`)
    const slider = page.getByRole('slider')
    await expect(radios.first().or(h1(page).filter({ hasText: /^(Up next: |Time for a break|Session )/ }))).toBeVisible({ timeout: 30_000 })
    if ((await h1(page).textContent()) !== title) return n
    await expect(radios.first()).toBeEnabled()
    await expect(page.locator(`${ROOT} legend`)).toContainText('Made-up test question')
    await radios.nth(n % 4).check()
    await page.locator(ROOT).getByRole('button', { name: 'Confirm', exact: true }).click()
    await expect(slider).toBeVisible()
    await slider.press('ArrowRight')
    const answered = page.waitForResponse((r) => r.url().endsWith('/rpc/submit'))
    await button(page, 'Continue').click()
    await answered
    n++
    // The next question, or the end of the part: wait for this question to be gone.
    await expect(slider).toBeHidden({ timeout: 30_000 })
    if (n > TEXT_PER_AXIS + 2) throw new Error(`${title} did not end`)
  }
}

const KEYISH = /"key"|"index"|"correct"\s*:\s*(0|1|true|false)|rationale|tolerance|option_weights|"se_b"/u

test.describe('the plain pool: no text item on the server (the live project today)', () => {
  test('a server with no text item says so (live_axes): the six parts, and no text skill is ever asked for', async ({ page }) => {
    const calls = watch(page)
    await page.emulateMedia({ reducedMotion: 'reduce' }) // the results are complete at once
    await toReady(page, query(PLAIN))
    await expect(page.locator('main')).toContainText('Six short parts, about 30 minutes.')
    await button(page, 'Begin').click()
    const seen: string[] = []
    for (;;) {
      const title = await nextScreen(page)
      if (!title.startsWith('Up next: ')) break
      seen.push(title.replace('Up next: ', ''))
      if (title === 'Up next: Matrix & Series') {
        // One real question of a part the pool does have, answered through the real server.
        await button(page, 'Start').click()
        const box = page.locator('form.entry').getByRole('textbox')
        await box.fill('1')
        await box.press('Enter')
        await expect(page.getByRole('slider')).toBeVisible()
        await button(page, 'Continue').click()
        await expect(page.locator('form.entry').getByRole('textbox')).toBeVisible()
        await button(page, 'Skip Matrix & Series').or(button(page, 'Skip')).first().click()
        await page.locator('section.confirm').getByRole('button', { name: /^Skip / }).click()
      } else await skipPart(page)
    }
    expect(seen).toEqual(['Reaction Time', 'Matrix & Series', 'Spatial', 'Working Memory', 'Quantitative Reasoning', 'Processing & Reading Speed'])
    await expect(h1(page)).toHaveText(/^Session /, { timeout: 30_000 })
    // The session was closed on the server (one answer is too few for a profile, so there is no chart to wait for).
    await expect.poll(() => calls.some((c) => c.fn === 'finish' && c.status === 200), { timeout: 30_000 }).toBe(true)

    const asked = calls.filter((c) => c.fn === 'next_item')
    expect(asked.filter((c) => !['MAT', 'SPA', 'QR'].includes((c.request.p_axes as string[])[0]!))).toEqual([])
    expect(calls.find((c) => c.fn === 'live_axes')?.reply).toEqual({ axes: ['MAT'] })
    expect(calls.every((c) => c.status === 200)).toBe(true)
    expect(JSON.stringify(calls.map((c) => c.reply))).not.toMatch(KEYISH)
    await expect(page.locator('body')).not.toContainText(/Logical Reasoning skipped|cannot be shown/)
  })
})

test.describe('the text pool: made-up questions for three of the five text skills', () => {
  test('the first turn of the rotation runs (Logical Reasoning; Vocabulary and STEM come next time), the server scores and signs it, and the skill is on the profile', async ({ page }) => {
    const calls = watch(page)
    await page.emulateMedia({ reducedMotion: 'reduce' })
    await toReady(page, query(TEXT))
    await expect(page.locator('main')).toContainText('Up to seven short parts, about 35 minutes.')
    await button(page, 'Begin').click()
    const seen: string[] = []
    const answered: Record<string, number> = {}
    for (;;) {
      const title = await nextScreen(page)
      if (!title.startsWith('Up next: ')) break
      const name = title.replace('Up next: ', '')
      seen.push(name)
      if (['Logical Reasoning', 'STEM Knowledge', 'Vocabulary & Verbal Analogies'].includes(name)) answered[name] = await playTextPart(page, name)
      else await skipPart(page)
    }
    // The parts the pool does not have never appeared, and the other two of the pool wait for the next turn (plan-table.ts ROTATION).
    expect(seen).toEqual(['Reaction Time', 'Matrix & Series', 'Logical Reasoning', 'Spatial', 'Working Memory', 'Quantitative Reasoning', 'Processing & Reading Speed'])
    expect(calls.find((c) => c.fn === 'live_axes')?.reply).toEqual({ axes: ['MAT', 'LR', 'VOC', 'KST'] })
    for (const n of Object.values(answered)) expect(n).toBeGreaterThanOrEqual(5)
    await expect(h1(page)).toHaveText(/^Session /, { timeout: 30_000 })

    // The results: the save the server signed and checked, and a profile with the three skills.
    await expect(page.locator('[data-section="save"]')).toBeVisible({ timeout: 30_000 })
    await expect(page.locator('[data-section="online"] [data-section="save-check"]')).toContainText('1 session was checked by the server.')
    await expect(page.locator('svg.hb-blob').first()).toBeVisible()

    const of = (fn: string): Rpc[] => calls.filter((c) => c.fn === fn)
    expect(calls.filter((c) => c.status !== 200)).toEqual([])
    // Every text question came as text and nothing else; every answer went out as a position.
    const items = of('next_item').flatMap((c) => ((c.reply as { item?: Record<string, unknown> }).item === undefined ? [] : [(c.reply as { item: Record<string, unknown> }).item]))
    expect(items.length).toBeGreaterThanOrEqual(5)
    for (const item of items) expect(Object.keys(item).sort()).toEqual(['item_id', 'item_type', 'options', 'stem', 'time_limit_s'])
    expect(of('submit').every((c) => Number.isInteger(c.request.p_response))).toBe(true)
    expect(JSON.stringify(calls.map((c) => c.reply))).not.toMatch(KEYISH)
    const finish = of('finish')[0]!.reply as { session: { responses: unknown[][]; sig?: { alg: string } } }
    expect(finish.session.sig?.alg).toBe('HMAC-SHA256')
    expect(finish.session.responses.every((r) => r[3] === null)).toBe(true)
    const rescore = of('rescore').at(-1)!.reply as { eap: Record<string, { mean: number; sd: number; n: number }> }
    expect(Object.keys(rescore.eap).sort()).toEqual(['LR'])
    for (const e of Object.values(rescore.eap)) expect(e.n).toBeGreaterThanOrEqual(5)
    await expect(page.locator('body')).not.toContainText(/\bincorrect\b|wrong answer/i)
  })
})
