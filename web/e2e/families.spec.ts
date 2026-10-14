/**
 * The remaining families in the online version (ROADMAP M3.11; owner decisions 2026-10-13; DESIGN §3 rows 3, 11, 12,
 * 16 and 17, §10, §13, R-5.6.x, R-11.1), in Chromium, WebKit and an emulated iPhone, against the fake server
 * (`fake-server.ts`), which lists the skills its pools hold (`live_axes`), as the real one lists the skills it has
 * questions for. Every item is made up (`src/render/served-demo.ts`): practice items of the dev demos and invented
 * logic-game setups, with no key anywhere.
 *
 * - Logic Games: the setup is a region of its own beside (or above) the question, an opening and a list of rules, the
 *   same element across the questions of a game; the questions are rated for confidence.
 * - Fermi Estimation, Emotion Reading and Creative Thinking take one turn of the rotation together: the estimate goes
 *   out as {value, unit, low, high} and the ratings as four numbers, with no confidence scale on either; the word
 *   links are rated for confidence.
 * Each screen passes axe and fits a 320 px window without sideways scrolling.
 */

import { expect, test, type Page } from '@playwright/test'
import { demoEmotionPayload, demoFermiPayload, demoLogicGamePayload, demoRatPayload, demoSjtPayload, type DemoServedPayload } from '../src/render/served-demo'
import { expectNoSeriousAxe } from './axe'
import { FakeServer, SERVER_QUERY, type Wire } from './fake-server'
import { agreeGate, button, h1 } from './flow'
import { expectNoSidewaysScroll, REFLOW_VIEWPORT } from './layout'

const wire = (id: string, p: DemoServedPayload, set?: { position: number; of: number }): Wire => ({
  seq: 1,
  item: { item_id: id, item_type: p.itemType, time_limit_s: 180, stem: p.stem, media: { ...p.media }, ...(p.options === null ? {} : { options: [...p.options] }) },
  ...(set === undefined ? {} : { set }),
})

async function toReadyOnline(page: Page): Promise<void> {
  await page.goto(`./${SERVER_QUERY}`)
  await button(page, 'Start').click()
  await agreeGate(page)
  await page.getByRole('checkbox', { name: /honour code/ }).check()
  await button(page, 'Continue').click()
  await expect(button(page, 'Continue')).toBeEnabled({ timeout: 20_000 })
  await button(page, 'Continue').click()
  await expect(h1(page)).toHaveText('Ready when you are')
}

/** Skips every part up to the "Up next" screen of `title`. */
async function upTo(page: Page, title: string): Promise<void> {
  for (let i = 0; i < 20; i++) {
    await expect(h1(page)).toHaveText(/^(Up next: |Time for a break\?|Session )/, { timeout: 20_000 })
    const now = (await h1(page).textContent())!.trim()
    if (now === `Up next: ${title}`) return
    if (now === 'Time for a break?') {
      await button(page, 'Keep going').click()
      continue
    }
    if (!now.startsWith('Up next: ')) throw new Error(`never reached "Up next: ${title}" (at "${now}")`)
    await button(page, 'Skip this part').click()
    await page.locator('section.confirm').getByRole('button', { name: /^Skip / }).click()
  }
  throw new Error(`never reached "Up next: ${title}"`)
}

test.describe('Logic Games, served', () => {
  test('the setup stays in place beside its questions, as an opening and a list of rules; each question is rated for confidence', async ({ page }) => {
    const pool = [...[0, 1, 2].map((q) => wire(`i:tst:lg:e2e-g1-q${q + 1}`, demoLogicGamePayload(0, q), { position: q + 1, of: 3 })), ...[0, 1, 2, 3].map((q) => wire(`i:tst:lg:e2e-g2-q${q + 1}`, demoLogicGamePayload(1, q), { position: q + 1, of: 4 }))]
    const server = new FakeServer({ pools: { LG: pool }, eap: { LG: { mean: 0.1, sd: 0.6, n: 7 } } })
    await server.attach(page)
    await page.emulateMedia({ reducedMotion: 'reduce' })
    await toReadyOnline(page)
    await expect(page.locator('main')).toContainText('Up to seven short parts, about 35 minutes.')
    await button(page, 'Begin').click()
    await upTo(page, 'Logic Games')
    await expect(page.locator('main')).toContainText('The rules stay on screen while you answer.')
    await expectNoSeriousAxe(page)
    await button(page, 'Start').click()

    const setup = page.locator('section.passage')
    await expect(h1(page)).toHaveText('Logic Games')
    await expect(setup.getByRole('heading', { level: 2 })).toHaveText('Setup')
    await expect(setup.locator('.rules li')).toHaveCount(3)
    await expect(setup.getByRole('list', { name: 'Rules' })).toBeVisible()
    await expect(page.locator('[data-set-position]')).toHaveText('Question 1 of 3 about this setup')
    await expectNoSeriousAxe(page)
    await setup.evaluate((el) => {
      ;(el as unknown as { mark: string }).mark = 'kept'
    })
    for (let q = 0; q < 3; q++) {
      const radios = page.locator('div.hb-render.text-mc .options input[type="radio"]')
      await expect(radios.first()).toBeEnabled()
      await radios.nth(q).check()
      // the optional confidence scale is on the question (owner decision 2026-10-13); one press sends both
      const points = page.locator('div.hb-render.text-mc fieldset[data-confidence] input[type="radio"]')
      const name = (await points.first().getAttribute('name')) ?? ''
      await points.nth(3).check()
      await page.locator('div.hb-render.text-mc').getByRole('button', { name: 'Confirm', exact: true }).click()
      await expect(page.locator(`input[name="${name}"]`)).toHaveCount(0)
      if (q < 2) {
        await expect(page.locator('[data-set-position]')).toHaveText(`Question ${q + 2} of 3 about this setup`)
        expect(await page.locator('section.passage').evaluate((el) => (el as unknown as { mark?: string }).mark)).toBe('kept')
      }
    }
    // the second game: a new setup
    await expect(page.locator('[data-set-position]')).toHaveText('Question 1 of 4 about this setup')
    expect(await page.locator('section.passage').evaluate((el) => (el as unknown as { mark?: string }).mark)).toBeUndefined()
    expect(server.of('submit').map((c) => c.body.p_response)).toEqual([0, 1, 2])
    expect(server.of('submit').every((c) => typeof c.body.p_confidence === 'number')).toBe(true)
  })

  test('fits a phone’s width: the setup above the question, nothing scrolls sideways', async ({ page }) => {
    const server = new FakeServer({ pools: { LG: [0, 1, 2].map((q) => wire(`i:tst:lg:e2e-n-q${q + 1}`, demoLogicGamePayload(2, q), { position: q + 1, of: 3 })) } })
    await server.attach(page)
    await page.setViewportSize(REFLOW_VIEWPORT)
    await toReadyOnline(page)
    await button(page, 'Begin').click()
    await upTo(page, 'Logic Games')
    await button(page, 'Start').click()
    await expect(page.locator('section.passage .rules li')).toHaveCount(3)
    await expectNoSidewaysScroll(page, 'a logic-game question at 320 px')
    await expectNoSeriousAxe(page)
  })
})

test.describe('Fermi Estimation, Emotion Reading and Creative Thinking, served (one turn of the rotation)', () => {
  test('each on its own screen; the range and the ratings go out with no confidence rating, the word with one; nothing says right or wrong', async ({ page }) => {
    const server = new FakeServer({
      pools: {
        FER: [1, 2, 3, 4, 5, 6].map((n) => wire(`i:tst:fer:e2e${n}`, demoFermiPayload(n))),
        EMO: [1, 2, 3, 4, 5, 6].map((n) => wire(`i:tst:emo:e2e${n}`, n % 2 === 0 ? demoSjtPayload(n) : demoEmotionPayload(n))),
        CRE: [1, 2, 3, 4, 5, 6].map((n) => wire(`i:tst:cre:e2e${n}`, demoRatPayload(n))),
      },
      eap: { FER: { mean: 0, sd: 0.6, n: 6 }, EMO: { mean: 0, sd: 0.7, n: 6 }, CRE: { mean: 0, sd: 0.6, n: 6 } },
    })
    await server.attach(page)
    await page.emulateMedia({ reducedMotion: 'reduce' })
    await toReadyOnline(page)
    await expect(page.locator('main')).toContainText('Most questions also have a small optional scale for how sure you are of your answer.')
    await button(page, 'Begin').click()

    // Emotion Reading comes after Working Memory: a vignette, then a situational judgment, in turn
    await upTo(page, 'Emotion Reading (text scenarios)')
    await expectNoSeriousAxe(page)
    await button(page, 'Start').click()
    for (let n = 1; n <= 6; n++) {
      if (n % 2 === 0) {
        const sjt = page.locator('section.sjt')
        await expect(sjt).toBeVisible()
        if (n === 2) await expectNoSeriousAxe(page)
        for (let r = 0; r < 4; r++) await sjt.locator(`input[type="radio"][name$="-r${r}"]`).nth(3 - r).check()
        await sjt.getByRole('button', { name: 'Confirm', exact: true }).click()
      } else {
        const emo = page.locator('section.emotion')
        await expect(emo).toBeVisible()
        if (n === 1) {
          await expectNoSeriousAxe(page)
          await expect(page.locator('body')).not.toContainText(/autis|adhd|alexithym|disorder/i)
        }
        await expect(emo.locator('input[type="radio"]').first()).toBeEnabled()
        await emo.locator('input[type="radio"]').nth(1).check()
        await emo.getByRole('button', { name: 'Confirm', exact: true }).click()
      }
      await expect(page.locator('fieldset[data-confidence]')).toHaveCount(0) // not rated: no scale
    }

    // Creative Thinking (word links): a typed word, and the optional confidence scale with it
    await upTo(page, 'Creative Thinking')
    await button(page, 'Start').click()
    for (let n = 1; n <= 6; n++) {
      const rat = page.locator('section.rat')
      await expect(rat.locator('.cues li')).toHaveCount(3)
      await rat.locator('input[type="text"]').fill('made-up word')
      const points = rat.locator('fieldset[data-confidence] input[type="radio"]')
      const name = (await points.first().getAttribute('name')) ?? ''
      await points.nth(3).check()
      if (n === 1) await expectNoSeriousAxe(page)
      await rat.getByRole('button', { name: 'Confirm', exact: true }).click()
      await expect(page.locator(`input[name="${name}"]`)).toHaveCount(0)
    }

    // Fermi Estimation, at the end: three numbers and a unit
    await upTo(page, 'Fermi Estimation')
    await button(page, 'Start').click()
    for (let n = 1; n <= 6; n++) {
      const fermi = page.locator('section.fermi')
      await expect(fermi).toBeVisible()
      const unit = fermi.locator('select')
      if ((await unit.count()) > 0) await unit.selectOption({ index: 1 })
      await fermi.getByLabel('Your best guess', { exact: true }).fill('3e4')
      await fermi.getByLabel('Low end of your 80% range', { exact: true }).fill('1e4')
      await fermi.getByLabel('High end of your 80% range', { exact: true }).fill('9e4')
      if (n === 1) {
        await expectNoSeriousAxe(page)
        await expectNoSidewaysScroll(page, 'a Fermi question')
      }
      await expect(page.locator('fieldset[data-confidence]')).toHaveCount(0) // the range is the statement: no scale
      await fermi.getByRole('button', { name: 'Submit', exact: true }).click()
    }
    await expect(h1(page)).toHaveText(/^Session /, { timeout: 20_000 })
    // ("correct" alone is a word of the results' practice note: "less to correct")
    await expect(page.locator('body')).not.toContainText(/\bincorrect\b|\byou were (right|wrong)\b|wrong answer/i)
    // the three skills are measured, and Creative Thinking is the word links alone
    await expect(page.locator('main')).toContainText('Fermi Estimation')

    const sent = server.of('submit').map((c) => c.body)
    expect(sent).toHaveLength(18)
    const fermi = sent.filter((b) => String(b.p_item_id).startsWith('i:tst:fer:'))
    for (const b of fermi) {
      expect(b.p_response).toMatchObject({ value: 3e4, low: 1e4, high: 9e4 })
      expect(b.p_confidence).toBeNull()
    }
    for (const b of sent.filter((x) => String(x.p_item_id).startsWith('i:tst:emo:'))) expect(b.p_confidence).toBeNull()
    expect(sent.filter((x) => Array.isArray(x.p_response)).map((x) => x.p_response)).toEqual([[4, 3, 2, 1], [4, 3, 2, 1], [4, 3, 2, 1]])
    for (const b of sent.filter((x) => String(x.p_item_id).startsWith('i:tst:cre:'))) {
      expect(b.p_response).toBe('made-up word')
      expect(typeof b.p_confidence).toBe('number')
    }
    await expectNoSeriousAxe(page)
  })
})
