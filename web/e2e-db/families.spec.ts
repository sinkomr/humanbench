/**
 * The remaining families in real browsers against the real local database (ROADMAP M3.11; owner decisions 2026-10-13;
 * DESIGN §3 rows 3, 11, 12, 16 and 17, R-5.6.x, R-11.1): logic games with their setup kept in view, Fermi estimates,
 * emotion vignettes and situational judgments, and word-links puzzles, served, answered, scored on the server and
 * published by `rescore`. Two databases of made-up items (`server.ts`, "games" and "estimates";
 * `scripts/db/families-fixture.ts`), so that each first session has its turn of the rotation. Nothing here is a real
 * item or a real key; every item says it is made up.
 */

import { expect, test, type Page, type Response } from '@playwright/test'
import { DB_PORT, ESTIMATES_PORT_OFFSET, GAMES_PORT_OFFSET } from './pool'

const query = (offset: number): string => `?hb_backend=${encodeURIComponent(`http://127.0.0.1:${DB_PORT + offset}`)}&hb_key=e2e-anon-key`
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

/**
 * Through the closing screen to the results. `finish` is safe to repeat, and the screen offers "Try again" when it
 * fails: here, with three browsers playing on one database on a loaded machine, it has run past the anon role's 3 s
 * statement timeout (alone it takes under 0.1 s), so the person's way on is taken, at most twice.
 */
async function throughClosing(page: Page): Promise<void> {
  for (let attempt = 0; attempt < 3; attempt++) {
    const retry = button(page, 'Try again')
    await expect(h1(page).filter({ hasText: /^Session / }).or(retry)).toBeVisible({ timeout: 30_000 })
    if ((await h1(page).textContent())?.startsWith('Session ')) return
    await retry.click()
  }
}

async function nextScreen(page: Page): Promise<string> {
  await expect(h1(page)).toHaveText(/^(Up next: .+|Time for a break\?|Session .+|Saving your answers)$/, { timeout: 30_000 })
  if ((await h1(page).textContent()) === 'Saving your answers') await throughClosing(page)
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

/** Waits for the question on screen or the end of the part; true while a question of `title` is on screen. */
async function onQuestion(page: Page, title: string, control: string): Promise<boolean> {
  await expect(page.locator(control).first().or(h1(page).filter({ hasText: /^(Up next: |Time for a break|Session |Saving your answers)/ }))).toBeVisible({ timeout: 30_000 })
  return (await h1(page).textContent())?.trim() === title
}

const submitted = (page: Page): Promise<Response> => page.waitForResponse((r) => r.url().endsWith('/rpc/submit'))
const KEYISH = /"key"|"index"|"correct"\s*:\s*(0|1|true|false)|rationale|tolerance|option_weights|"se_b"|true_value|"accept"|"ratings"|thresholds/u

test.describe('the "games" pool: made-up logic games', () => {
  test('Logic Games: the setup beside every question of a game, two games whole, the slider, and the skill published', async ({ page }) => {
    const calls = watch(page)
    await page.emulateMedia({ reducedMotion: 'reduce' })
    await toReady(page, query(GAMES_PORT_OFFSET))
    await button(page, 'Begin').click()
    let answered = 0
    const seen: string[] = []
    for (;;) {
      const title = await nextScreen(page)
      if (!title.startsWith('Up next: ')) break
      seen.push(title.replace('Up next: ', ''))
      if (title !== 'Up next: Logic Games') {
        await skipPart(page)
        continue
      }
      await expect(page.locator('main')).toContainText('The rules stay on screen while you answer.')
      await button(page, 'Start').click()
      while (await onQuestion(page, 'Logic Games', 'div.hb-render.text-mc input[type="radio"]')) {
        const setup = page.locator('section.passage')
        await expect(setup.getByRole('heading', { level: 2 })).toHaveText('Setup')
        await expect(setup.locator('.rules li')).toHaveCount(3)
        await expect(setup).toContainText('Made-up game')
        await expect(page.locator('[data-set-position]')).toHaveText(/^Question \d of [34] about this setup$/)
        const radios = page.locator('div.hb-render.text-mc input[type="radio"]')
        await expect(radios.first()).toBeEnabled()
        await radios.nth(answered % 5).check()
        await page.locator('div.hb-render.text-mc').getByRole('button', { name: 'Confirm', exact: true }).click()
        await expect(page.getByRole('slider')).toBeVisible()
        await page.getByRole('slider').press('ArrowRight')
        const done = submitted(page)
        await button(page, 'Continue').click()
        await done
        answered++
        if (answered > 12) throw new Error('the part did not end')
      }
    }
    expect(seen).toEqual(['Reaction Time', 'Matrix & Series', 'Spatial', 'Working Memory', 'Quantitative Reasoning', 'Processing & Reading Speed', 'Logic Games'])
    expect([6, 7]).toContain(answered) // two of the three games (3, 4 and 3 questions), whole
    await throughClosing(page)
    await expect(page.locator('[data-section="save"]')).toBeVisible({ timeout: 30_000 })
    const of = (fn: string): Rpc[] => calls.filter((c) => c.fn === fn)
    expect(calls.filter((c) => c.status !== 200)).toEqual([])
    expect(JSON.stringify(calls.map((c) => c.reply))).not.toMatch(KEYISH)
    const rescore = of('rescore').at(-1)!.reply as { eap: Record<string, { n: number }> }
    expect(rescore.eap.LG?.n).toBe(answered)
  })
})

test.describe('the "estimates" pool: made-up Fermi estimates, vignettes, judgments and word links', () => {
  test('Fermi Estimation, Emotion Reading and Creative Thinking run on their own screens, the ranges and ratings go out with no confidence rating, and the three skills are published', async ({ page }) => {
    const calls = watch(page)
    await page.emulateMedia({ reducedMotion: 'reduce' })
    await toReady(page, query(ESTIMATES_PORT_OFFSET))
    await button(page, 'Begin').click()
    const played: Record<string, number> = {}
    for (;;) {
      const title = await nextScreen(page)
      if (!title.startsWith('Up next: ')) break
      const name = title.replace('Up next: ', '')
      if (name === 'Fermi Estimation') {
        await button(page, 'Start').click()
        let n = 0
        while (await onQuestion(page, name, 'section.fermi input')) {
          const field = (label: string) => page.locator('section.fermi').getByLabel(label, { exact: true })
          await field('Your best guess').fill('3e6')
          await field('Low end of your 80% range').fill('1e6')
          await field('High end of your 80% range').fill('9e6')
          await page.locator('section.fermi select').selectOption('count')
          const done = submitted(page)
          await page.locator('section.fermi').getByRole('button', { name: 'Submit', exact: true }).click()
          await done
          await expect(page.getByRole('slider')).toHaveCount(0)
          n++
          if (n > 40) throw new Error('the Fermi part did not end') // (a part goes on while its time lasts and the pool has items)
        }
        played[name] = n
      } else if (name === 'Emotion Reading (text scenarios)') {
        await button(page, 'Start').click()
        let n = 0
        while (await onQuestion(page, name, 'section.emotion input[type="radio"], section.sjt input[type="radio"]')) {
          if ((await page.locator('section.sjt').count()) > 0) {
            for (let r = 0; r < 4; r++) await page.locator(`section.sjt input[type="radio"][name$="-r${r}"]`).nth(r % 4).check()
            const done = submitted(page)
            await page.locator('section.sjt').getByRole('button', { name: 'Confirm', exact: true }).click()
            await done
          } else {
            const radios = page.locator('section.emotion input[type="radio"]')
            await expect(radios.first()).toBeEnabled()
            await radios.nth(n % 5).check()
            const done = submitted(page)
            await page.locator('section.emotion').getByRole('button', { name: 'Confirm', exact: true }).click()
            await done
          }
          n++
          if (n > 40) throw new Error('the Emotion Reading part did not end')
        }
        played[name] = n
      } else if (name === 'Creative Thinking') {
        await button(page, 'Start').click()
        let n = 0
        while (await onQuestion(page, name, 'section.rat input')) {
          await expect(page.locator('section.rat .cues li')).toHaveCount(3)
          await page.locator('section.rat input').fill('made up')
          await page.locator('section.rat').getByRole('button', { name: 'Confirm', exact: true }).click()
          await expect(page.getByRole('slider')).toBeVisible()
          await page.getByRole('slider').press('ArrowRight')
          const done = submitted(page)
          await button(page, 'Continue').click()
          await done
          n++
          if (n > 40) throw new Error('the word-links part did not end')
        }
        played[name] = n
      } else await skipPart(page)
    }
    for (const n of Object.values(played)) expect(n).toBeGreaterThanOrEqual(6)
    expect(Object.keys(played).sort()).toEqual(['Creative Thinking', 'Emotion Reading (text scenarios)', 'Fermi Estimation'])
    await throughClosing(page)
    await expect(page.locator('[data-section="save"]')).toBeVisible({ timeout: 30_000 })

    const of = (fn: string): Rpc[] => calls.filter((c) => c.fn === fn)
    expect(calls.filter((c) => c.status !== 200)).toEqual([])
    expect(JSON.stringify(calls.map((c) => c.reply))).not.toMatch(KEYISH)
    // what went out: a Fermi range with its unit, four ratings, a position, a typed word; and no confidence after the first two
    const sent = of('submit').map((c) => c.request)
    const fermi = sent.filter((r) => typeof r.p_response === 'object' && r.p_response !== null && !Array.isArray(r.p_response))
    expect(fermi.length).toBeGreaterThanOrEqual(6)
    for (const r of fermi) {
      expect(r.p_response).toEqual({ value: 3e6, unit: 'count', low: 1e6, high: 9e6 })
      expect(r.p_confidence).toBeNull()
    }
    for (const r of sent.filter((x) => Array.isArray(x.p_response))) expect(r.p_confidence).toBeNull()
    for (const r of sent.filter((x) => typeof x.p_response === 'string')) expect(r.p_confidence).not.toBeNull()
    const finish = of('finish')[0]!.reply as { session: { responses: unknown[][] } }
    expect(finish.session.responses.every((t) => t[3] === null)).toBe(true)
    const rescore = of('rescore').at(-1)!.reply as { eap: Record<string, { n: number }> }
    for (const k of ['FER', 'EMO', 'CRE']) expect(rescore.eap[k]?.n, k).toBeGreaterThanOrEqual(5)
    // no verdict; and no clinical term beyond the one resource line R-5.6.5 asks for when Emotion Reading is measured
    await expect(page.locator('body')).not.toContainText(/\bincorrect\b|wrong answer|adhd|alexithym/i)
  })
})
