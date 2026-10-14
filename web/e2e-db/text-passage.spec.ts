/// <reference lib="dom" />
/**
 * Served passages, browser to database (ROADMAP M3.11 phase 2; DESIGN §3 row 4, §7.1, §7.4, §10, §11.2,
 * R-11.1): the app in Chromium, WebKit and an emulated iPhone, with the real supabase-js client, against the
 * real PL/pgSQL of `supabase/migrations` (the set rule of `20261013000100_item_sets.sql` included) on a local
 * PostgreSQL (`server.ts`, the "passage" database). The passages are made up (`scripts/db/bank-fixture.ts`
 * `passageItems`) and say so; nothing here is a real passage, a real item or a real key.
 *
 * The Reading Comprehension part reads two passages: every question of each, in the server's order, beside
 * its passage, which stays on screen from its first question to its last. The server scores the answers, signs
 * the session and publishes the skill; no reply holds a key or a verdict.
 */

import { expect, test, type Page, type Response } from '@playwright/test'
import { DB_PORT, PASSAGE_PORT_OFFSET, passageCredit } from './pool'

const PASSAGE_DB = `http://127.0.0.1:${DB_PORT + PASSAGE_PORT_OFFSET}`
const QUERY = `?hb_backend=${encodeURIComponent(PASSAGE_DB)}&hb_key=e2e-anon-key`
const QUESTION = 'div.hb-render.text-mc'
const PASSAGE = 'section.passage'

const h1 = (page: Page) => page.getByRole('heading', { level: 1 })
const button = (page: Page, name: string | RegExp) => page.getByRole('button', { name, exact: typeof name === 'string' })

interface Rpc {
  readonly fn: string
  readonly request: Record<string, unknown>
  readonly status: number
  readonly reply: unknown
}

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

async function toReady(page: Page): Promise<void> {
  await page.goto(`./${QUERY}`)
  await button(page, 'Start').click()
  await page.getByRole('checkbox', { name: /18 or older/ }).check()
  await button(page, 'Continue').click()
  await page.getByRole('checkbox', { name: /honour code/ }).check()
  await button(page, 'Continue').click()
  await expect(button(page, 'Continue')).toBeEnabled({ timeout: 30_000 })
  await button(page, 'Continue').click()
  await expect(h1(page)).toHaveText('Ready when you are')
}

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

interface Seen {
  readonly stem: string
  readonly position: string
  readonly passage: string
  readonly source: string | null
  /** A mark put on the passage's element when it was first seen: the same element has it on the later questions. */
  readonly mark: string
}

/** Answers the passage questions until the part is over; returns what each question showed. */
async function playReading(page: Page): Promise<Seen[]> {
  const title = 'Reading Comprehension'
  await button(page, 'Start').click()
  const seen: Seen[] = []
  for (;;) {
    await expect(h1(page)).toHaveText(/^(Reading Comprehension|Up next: .+|Time for a break\?|Session .+)$/, { timeout: 30_000 })
    const radios = page.locator(`${QUESTION} .options input[type="radio"]`)
    const points = page.locator(`${QUESTION} fieldset[data-confidence] input[type="radio"]`)
    await expect(radios.first().or(h1(page).filter({ hasText: /^(Up next: |Time for a break|Session )/ }))).toBeVisible({ timeout: 30_000 })
    if ((await h1(page).textContent()) !== title) return seen
    await expect(radios.first()).toBeEnabled()
    await expect(page.locator(`${QUESTION} fieldset:not([data-confidence]) > legend`)).toContainText('Made-up test question')
    await expect(page.getByRole('region', { name: 'Passage' })).toBeVisible()
    const mark = await page.locator(PASSAGE).evaluate((el, n) => {
      const host = el as unknown as { mark?: string }
      host.mark ??= `passage seen at question ${n}`
      return host.mark
    }, seen.length + 1)
    seen.push({
      stem: (await page.locator(`${QUESTION} legend`).textContent()) ?? '',
      position: (await page.locator('[data-set-position]').textContent()) ?? '',
      passage: (await page.locator(`${PASSAGE} .text`).textContent()) ?? '',
      source: (await page.locator(`${PASSAGE} .attribution`).count()) === 0 ? null : await page.locator(`${PASSAGE} .attribution`).textContent(),
      mark,
    })
    await radios.nth(seen.length % 4).check()
    // the optional confidence scale is in the question, beside the passage, which has not gone anywhere
    const name = (await points.first().getAttribute('name')) ?? ''
    await points.nth(3).check()
    await expect(page.getByRole('region', { name: 'Passage' })).toBeVisible()
    const answered = page.waitForResponse((r) => r.url().endsWith('/rpc/submit'))
    await page.locator(QUESTION).getByRole('button', { name: 'Confirm', exact: true }).click()
    await answered
    await expect(page.locator(`input[name="${name}"]`)).toHaveCount(0, { timeout: 30_000 })
    if (seen.length > 12) throw new Error('Reading Comprehension did not end')
  }
}

// (a set's `position` is not a key's `index`: the name was chosen so that this check can stay as strict as it is)
const KEYISH = /"key"|"index"|"correct"\s*:\s*(0|1|true|false)|rationale|tolerance|option_weights|"se_b"|"f:tst:/u

test.describe('the passage pool: made-up passages with their questions', () => {
  test('the part reads two passages whole, beside their questions; the server scores and signs them, and the skill is on the profile', async ({ page }) => {
    const calls = watch(page)
    await page.emulateMedia({ reducedMotion: 'reduce' })
    await toReady(page)
    await expect(page.locator('main')).toContainText('Up to seven short parts, about 40 minutes.')
    await button(page, 'Begin').click()
    const parts: string[] = []
    let seen: Seen[] = []
    for (;;) {
      const title = await nextScreen(page)
      if (!title.startsWith('Up next: ')) break
      const name = title.replace('Up next: ', '')
      parts.push(name)
      if (name === 'Reading Comprehension') {
        await expect(page.locator('main')).toContainText('About 9 minutes.')
        seen = await playReading(page)
      } else await skipPart(page)
    }
    expect(parts).toEqual(['Reaction Time', 'Matrix & Series', 'Spatial', 'Reading Comprehension', 'Working Memory', 'Quantitative Reasoning', 'Processing & Reading Speed'])
    await expect(h1(page)).toHaveText(/^Session /, { timeout: 30_000 })

    // Two passages, 3 and 4 questions or 4 and 3 or the like: six to eight questions, each passage whole and in order.
    expect(seen.length).toBeGreaterThanOrEqual(6)
    expect(seen.length).toBeLessThanOrEqual(8)
    const passages = [...new Set(seen.map((s) => s.passage))]
    expect(passages.length).toBe(2)
    let at = 0
    for (const text of passages) {
      const mine = seen.filter((s) => s.passage === text)
      expect(seen.slice(at, at + mine.length)).toEqual(mine) // one after the other
      expect(mine.map((s) => s.position)).toEqual(mine.map((_, i) => `Question ${i + 1} of ${mine.length} about this passage`))
      expect(mine.map((s) => s.stem)).toEqual(mine.map((_, i) => expect.stringContaining(`Made-up test question ${i + 1} about made-up passage`)))
      // the same element for every question of the passage: it was not rebuilt between them
      expect(new Set(mine.map((s) => s.mark)).size).toBe(1)
      expect(mine[0]!.mark).toBe(`passage seen at question ${at + 1}`)
      // the source line of the passage's family, or none
      const p = Number(/Made-up test passage (\d+)/u.exec(text)![1]) - 1
      const credit = passageCredit(p)
      expect(new Set(mine.map((s) => s.source))).toEqual(new Set([credit === undefined ? null : `Source: ${credit}`]))
      expect(text).toContain('placeholder')
      at += mine.length
    }

    // The results: the save the server signed and checked, and a profile with the skill.
    await expect(page.locator('[data-section="save"]')).toBeVisible({ timeout: 30_000 })
    await expect(page.locator('[data-section="online"] [data-section="save-check"]')).toContainText('1 session was checked by the server.')
    await expect(page.locator('svg.hb-blob').first()).toBeVisible()

    const of = (fn: string): Rpc[] => calls.filter((c) => c.fn === fn)
    expect(calls.filter((c) => c.status !== 200)).toEqual([])
    // Every question came with its passage, its place in the set, and nothing else; every answer went out as a position.
    const served = of('next_item').flatMap((c) => ((c.reply as { item?: Record<string, unknown> }).item === undefined ? [] : [c.reply as { item: Record<string, unknown>; set?: { position: number; of: number } }]))
    expect(served.length).toBe(seen.length)
    for (const r of served) {
      expect(Object.keys(r).sort()).toEqual(['item', 'seq', 'set'])
      expect(Object.keys(r.item).sort()).toEqual(['item_id', 'item_type', 'media', 'options', 'stem', 'time_limit_s'])
      expect(Object.keys(r.item.media as object).filter((k) => !['renderer', 'passage', 'attribution'].includes(k))).toEqual([])
      expect(r.item.time_limit_s).toBe(r.set!.position === 1 ? 300 : 180)
    }
    expect(served.map((r) => r.set!.position)).toEqual(seen.map((s) => Number(/Question (\d+)/u.exec(s.position)![1])))
    expect(of('next_item').every((c) => (c.request.p_axes as string[]).join() === 'RC')).toBe(true)
    expect(of('submit').length).toBe(seen.length)
    expect(of('submit').every((c) => Number.isInteger(c.request.p_response))).toBe(true)
    expect(JSON.stringify(calls.map((c) => c.reply))).not.toMatch(KEYISH)
    const finish = of('finish')[0]!.reply as { session: { responses: unknown[][]; sig?: { alg: string } } }
    expect(finish.session.sig?.alg).toBe('HMAC-SHA256')
    expect(finish.session.responses.length).toBe(seen.length)
    expect(finish.session.responses.every((r) => r[3] === null)).toBe(true)
    const rescore = of('rescore').at(-1)!.reply as { eap: Record<string, { mean: number; sd: number; n: number }> }
    expect(Object.keys(rescore.eap)).toEqual(['RC'])
    expect(rescore.eap.RC!.n).toBe(seen.length)
    await expect(page.locator('body')).not.toContainText(/\bincorrect\b|wrong answer/i)
  })
})
