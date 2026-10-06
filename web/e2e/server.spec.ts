/// <reference lib="dom" />
/**
 * The online version in real browsers (ROADMAP M2.7, AI.26; DESIGN §8, §11.2, §13): the app of the
 * Playwright build pointed at a fake project (`?hb_backend=`, `fake-server.ts`) goes through the whole
 * flow with supabase-js: consent that says what is sent, opening the session, the served part with a
 * report on a question, closing it, the results with what the server could check, the backup with its
 * once-shown phrase, the survey, the report about notes, the page for data on the server; and the
 * failures on the way (the server down at the start, a connection lost). It also shows the rules of
 * AI.26 in a browser: editing the notes settings of a file never changes what the server says of its
 * sessions, and no request ever carries them. And the static fallback, which is the default build:
 * without the override nothing in the page names a server and nothing is requested from one.
 * WebKit and iPhone 13 run the same specs (download events are desktop-only). Axe (0 serious or
 * critical, WCAG 2.2 AA) and reflow at 320 px are checked on the new screens.
 */

import { readFileSync } from 'node:fs'
import { expect, test, type Page } from '@playwright/test'
import { expectNoSeriousAxe } from './axe'
import { FakeServer, PHRASE, SERVER_QUERY, ANON_ID, prefs, seriesWire, signedSave } from './fake-server'
import { agreeGate, answerItem, button, h1, languageClean, loadSave, overflow, scheme } from './flow'

/** From the page to the ready screen, with the gate (once: the consent is kept for the visit), the honour code and the device check. */
async function toReadyOnline(page: Page, query = SERVER_QUERY): Promise<void> {
  await page.goto(`./${query}`)
  await button(page, 'Start').click()
  if (await page.getByRole('checkbox', { name: /18 or older/ }).isVisible()) await agreeGate(page)
  await page.getByRole('checkbox', { name: /honour code/ }).check()
  await button(page, 'Continue').click()
  await expect(button(page, 'Continue')).toBeEnabled({ timeout: 20_000 })
  await button(page, 'Continue').click()
  await expect(h1(page)).toHaveText('Ready when you are')
}

/** From the ready screen to the first served item (the reaction-time part skipped). */
async function toFirstServedItem(page: Page): Promise<void> {
  await button(page, 'Begin').click()
  await expect(h1(page)).toHaveText('Up next: Reaction Time')
  await button(page, 'Skip this part').click()
  await page.locator('section.confirm').getByRole('button', { name: /^Skip / }).click()
  await expect(h1(page)).toHaveText('Up next: Matrix & Series')
  await button(page, 'Start').click()
  await expect(page.locator('form.entry')).toBeVisible()
}

async function finishNow(page: Page): Promise<void> {
  await button(page, 'Finish early').click()
  await button(page, 'Finish now').click()
}

const online = (page: Page) => page.locator('[data-section="online"]')

/** No motion: the profile is complete at once and the save is there. */
async function still(page: Page): Promise<void> {
  await page.emulateMedia({ reducedMotion: 'reduce' })
}

test.describe('the flow with a server', () => {
  test('goes from the gate to the results: what is sent, the served part, a report, the close, and the results with the server’s check', async ({ page }) => {
    const server = new FakeServer({ items: [seriesWire(1), seriesWire(2, [3, 6, 9, 12, 15])] })
    await server.attach(page)
    await still(page)

    // The gate says what is sent (and not that nothing is).
    await page.goto(`./${SERVER_QUERY}`)
    await button(page, 'Start').click()
    await expect(h1(page)).toHaveText('Before you start')
    await expect(page.locator('ul.points')).toContainText('sent to a server')
    await expect(page.locator('ul.points')).not.toContainText('Nothing is uploaded')
    await expectNoSeriousAxe(page)
    await agreeGate(page)
    await page.getByRole('checkbox', { name: /honour code/ }).check()
    await button(page, 'Continue').click()
    await expect(button(page, 'Continue')).toBeEnabled({ timeout: 20_000 })
    await button(page, 'Continue').click()
    await expect(h1(page)).toHaveText('Ready when you are')
    await expect(page.getByText('sent to the server as you give them')).toBeVisible()

    await toFirstServedItem(page)
    expect(server.of('start_session')).toHaveLength(1)
    expect(Object.keys(server.of('start_session')[0]!.body)).toEqual(['p_device'])
    expect(server.of('next_item')[0]!.body).toMatchObject({ p_axes: ['MAT'] })

    // Report a problem on the question: the kind and the question, nothing else.
    await button(page, 'Report a problem').click()
    await expect(page.locator('.report fieldset label')).toHaveCount(6)
    await expectNoSeriousAxe(page, { include: ['.report'] })
    await page.getByRole('radio', { name: /typo/ }).check()
    await page.locator('.report textarea').fill('A term looks wrong')
    await page.locator('.report').getByRole('button', { name: 'Send report' }).click()
    await expect(page.locator('.report [role="status"]')).toContainText('Thank you')
    expect(server.of('report_problem')[0]!.body).toMatchObject({ p_kind: 'typo', p_item_id: 'i:series:1.0.0:e2e1', p_detail: 'A term looks wrong' })

    // Two answers, each sent as it is given; no word about right or wrong anywhere.
    await answerItem(page)
    await expect(page.locator('form.entry')).toBeVisible()
    expect(server.of('submit')).toHaveLength(1)
    expect(server.of('submit')[0]!.body).toMatchObject({ p_item_id: 'i:series:1.0.0:e2e1', p_next: false })
    await expect(page.locator('body')).not.toContainText(/correct|incorrect|wrong answer/i)
    await answerItem(page)
    await expect(h1(page)).toHaveText('Up next: Spatial') // the server said the axis is done
    await finishNow(page)
    await expect(h1(page)).toHaveText('Session complete', { timeout: 20_000 })

    // The close: the last answer, the flags, the signed session, the scores.
    expect(server.of('submit')).toHaveLength(2)
    expect(server.of('finish')[0]!.body).toMatchObject({ p_flags: { skipped_rt: true, finished_early: true, paste_events: 0, visibility_hidden_s: 0 } })
    const asked = server.of('rescore')[0]!.body.p_save as { sessions: { session_id: string }[] }
    expect(asked.sessions.map((s) => s.session_id)).toEqual(['s_E2EFAKESERV0001'])

    // The results: the server's axis, the check, the save with the anti-coercion line, the panels of an online session.
    await expect(page.locator('[data-section="save"]')).toBeVisible()
    await expect(page.locator('[data-anti-coercion]')).toContainText('No employer, school or app should ask you for it')
    await expect(online(page).locator('[data-section="save-check"]')).toContainText('1 session was checked by the server.')
    await expect(online(page).locator('[data-mirror-note]')).toContainText("doesn't include your notes settings")
    await expect(page.getByRole('heading', { name: 'Two optional questions' })).toBeVisible()
    await expect(page.locator('svg.hb-blob').first()).toBeVisible()

    // The survey sends only what was chosen.
    await page.getByRole('radio', { name: '25-34' }).check()
    await page.getByRole('radio', { name: 'Yes' }).check()
    await online(page).locator('[data-section="survey"]').getByRole('button', { name: 'Send' }).click()
    await expect(online(page).locator('[data-section="survey"]')).toContainText('Thank you.')
    expect(server.of('submit_survey')[0]!.body).toEqual({ p_token: 'hbt_E2EFAKETOKEN0123456789', p_age_band: '25-34', p_english_first: true })

    // The backup: a phrase, once, and the notes settings are not in what was sent.
    await button(page, 'Keep a backup on the server').click()
    await expect(page.locator('[data-recovery-phrase]')).toHaveText(PHRASE)
    await expect(page.locator('[data-phrase] [data-anon-id]')).toHaveText(ANON_ID) // the way back takes it with the phrase
    await expect(button(page, 'Done')).toBeDisabled()
    await page.getByRole('checkbox', { name: /kept the phrase/ }).check()
    await button(page, 'Done').click()
    await expect(page.locator('[data-recovery-phrase]')).toHaveCount(0)
    await expect(online(page).locator('[data-anon-id]')).toHaveText(ANON_ID) // and it stays when the phrase is gone
    expect(server.of('mirror_put')).toHaveLength(1)
    expect((server.of('mirror_put')[0]!.body.p_save as { anon_id: string }).anon_id).toBe(ANON_ID)

    // The report about notes: no question, no text.
    const report = page.locator('[data-section="report"]')
    await report.getByRole('button', { name: 'Report a problem' }).click()
    await expect(report.locator('fieldset label')).toHaveCount(1)
    await report.getByRole('button', { name: 'Send report' }).click()
    await expect(report.locator('[role="status"]')).toContainText('Thank you')
    expect(server.of('report_problem').at(-1)!.body).toEqual({ p_token: 'hbt_E2EFAKETOKEN0123456789', p_kind: 'notes_requested' })

    // Nothing the app sent held the notes settings; the page keeps no token in the browser's storage.
    expect(server.allBodies()).not.toContain('brief_prefs')
    const stored = await page.evaluate(() => JSON.stringify({ ...localStorage, ...sessionStorage }))
    expect(stored).not.toContain('hbt_')
    expect(stored).not.toContain(PHRASE)
    await languageClean(page)
  })

  test('the downloaded save holds the signed session the server made and nothing of the notes', async ({ page, isMobile }) => {
    test.skip(isMobile, 'a download event cannot be observed on the iOS emulation (M1.22 covers the WebKit save)')
    const server = new FakeServer({ items: [seriesWire(1)] })
    await server.attach(page)
    await still(page)
    await toReadyOnline(page)
    await toFirstServedItem(page)
    await answerItem(page)
    await finishNow(page)
    await expect(h1(page)).toHaveText('Session complete', { timeout: 20_000 })
    await expect(page.locator('[data-section="save"]')).toBeVisible()
    const download = page.waitForEvent('download')
    await button(page, 'Download save file').click()
    const saved = JSON.parse(readFileSync((await (await download).path())!, 'utf8')) as { anon_id: string; sessions: { session_id: string; sig?: { mac: string }; responses: unknown[][] }[] }
    expect(saved.anon_id).toBe(ANON_ID)
    const served = saved.sessions.find((s) => s.session_id === 's_E2EFAKESERV0001')!
    expect(served.sig?.mac).toBeTruthy()
    expect(served.responses[0]![3]).toBeNull() // no verdict, ever
  })

  test('a connection lost while a question is awaited stops the clock and offers to try again', async ({ page }) => {
    const server = new FakeServer({ items: [seriesWire(1)], failures: { next_item: { status: 0, times: 3 } } })
    await server.attach(page)
    await toReadyOnline(page)
    await button(page, 'Begin').click()
    await button(page, 'Skip this part').click()
    await page.locator('section.confirm').getByRole('button', { name: /^Skip / }).click()
    await button(page, 'Start').click()
    await expect(page.locator('[data-loading-problem="offline"]')).toBeVisible({ timeout: 30_000 })
    await expect(page.locator('[data-loading-problem]')).toContainText('the clock is stopped')
    await expectNoSeriousAxe(page)
    await button(page, 'Try again').click()
    await expect(page.locator('form.entry')).toBeVisible()
  })

  test('a server that is down at the start can be left: the person goes on with this device only, and nothing more is sent', async ({ page }) => {
    const server = new FakeServer({ failures: { start_session: { status: 503, times: 5 } } })
    await server.attach(page)
    await toReadyOnline(page)
    await button(page, 'Begin').click()
    await expect(h1(page)).toHaveText('Getting your session ready')
    await expect(page.getByRole('alert')).toContainText('could not reach the server', { timeout: 30_000 })
    await expectNoSeriousAxe(page)
    await overflow(page, 'the opening screen')
    await button(page, 'Use this device only').click()
    await expect(h1(page)).toHaveText('Up next: Reaction Time')
    await button(page, 'Skip this part').click()
    await page.locator('section.confirm').getByRole('button', { name: /^Skip / }).click()
    await button(page, 'Start').click()
    await expect(page.locator('form.entry, form.choice').first()).toBeVisible() // an item made on this device
    await finishNow(page)
    await expect(h1(page)).toHaveText('Session ended') // nothing answered, nothing measured (UX-009b)
    expect(server.of('next_item')).toHaveLength(0)
    expect(server.of('finish')).toHaveLength(0)
    await expect(online(page)).toHaveCount(0)
  })

  test('a server that cannot be reached at the end: try again, and the session closes', async ({ page }) => {
    const server = new FakeServer({ items: [seriesWire(1)], failures: { finish: { status: 0, times: 3 } } })
    await server.attach(page)
    await toReadyOnline(page)
    await toFirstServedItem(page)
    await answerItem(page)
    await finishNow(page)
    await expect(h1(page)).toHaveText('Saving your answers')
    await expect(page.getByRole('alert')).toContainText('could not reach the server', { timeout: 30_000 })
    await expectNoSeriousAxe(page)
    await button(page, 'Try again').click()
    await expect(h1(page)).toHaveText('Session complete', { timeout: 20_000 })
  })
})

test.describe('the notes settings never leave the device (AI.26)', () => {
  test('editing them never changes what the server says of a session, and no request carries them', async ({ page }) => {
    const server = new FakeServer()
    await server.attach(page)
    await toReadyOnline(page)
    await loadSave(page, signedSave(prefs('2026-10')))
    await expect(page.locator('[data-section="save-check"]')).toContainText('1 session was checked by the server.')
    expect(server.of('verify_save')).toHaveLength(1)
    // other settings in the same file: the same verdict, and the same request body
    await toReadyOnline(page)
    await loadSave(page, signedSave(prefs('2026-11')))
    await expect(page.locator('[data-section="save-check"]')).toContainText('1 session was checked by the server.')
    const bodies = server.of('verify_save').map((c) => JSON.stringify(c.body))
    expect(bodies).toHaveLength(2)
    expect(bodies[0]).toBe(bodies[1])
    expect(server.allBodies()).not.toContain('brief_prefs')
    // an edited session is not checked, with the reason in words
    await toReadyOnline(page)
    await loadSave(page, signedSave(prefs(), { duration: 1 }))
    await expect(page.locator('[data-section="save-check"]')).toContainText('1 session was not checked.')
    await expect(page.locator('[data-section="save-check"]')).toContainText('changed since the server saved it')
    await expectNoSeriousAxe(page, { include: ['[data-section="save-check"]'] })
  })

  test('a file made without the server is unverified, and the server is not asked about it', async ({ page }) => {
    const server = new FakeServer()
    await server.attach(page)
    await toReadyOnline(page)
    const save = signedSave()
    delete (save.sessions as { sig?: unknown }[])[0]!.sig
    await loadSave(page, save)
    await expect(page.locator('[data-section="save-check"]')).toContainText('1 session was not checked.')
    await expect(page.locator('[data-section="save-check"]')).toContainText('made on this device, without the server')
    expect(server.of('verify_save')).toHaveLength(0)
  })
})

test.describe('the page for data on the server', () => {
  test('gets a backup back and deletes everything stored for an identifier, with a confirmation', async ({ page, isMobile }) => {
    const server = new FakeServer({ backups: { [ANON_ID]: PHRASE } })
    server.mirror.get(ANON_ID)!.save = signedSave()
    await server.attach(page)
    await page.goto(`./${SERVER_QUERY}#/data`)
    await expect(h1(page)).toHaveText('Your data on the server')
    await expectNoSeriousAxe(page)
    await overflow(page, 'the data page')

    const restore = page.locator('form').first()
    await restore.getByLabel('Save identifier (starts with hb_)').fill(ANON_ID)
    await restore.getByLabel('Recovery phrase (12 words)').fill(PHRASE.toUpperCase())
    await restore.getByRole('button', { name: 'Get my backup' }).click()
    await expect(page.getByText('Found your backup')).toBeVisible()
    expect(server.of('mirror_get')[0]!.body).toEqual({ p_anon_id: ANON_ID, p_phrase: PHRASE })
    if (!isMobile) {
      const download = page.waitForEvent('download')
      await button(page, 'Download the backup').click()
      const got = JSON.parse(readFileSync((await (await download).path())!, 'utf8')) as { anon_id: string }
      expect(got.anon_id).toBe(ANON_ID)
    }

    const erase = page.locator('form').nth(1)
    await erase.getByLabel('Save identifier (starts with hb_)').fill(ANON_ID)
    await erase.getByLabel('Recovery phrase (12 words)').fill('acorn acorn acorn acorn acorn acorn acorn acorn acorn acorn acorn acorn')
    await erase.getByRole('button', { name: 'Delete my data' }).click()
    await expect(page.locator('section.confirm')).toContainText('Save files you downloaded stay with you')
    await expectNoSeriousAxe(page)
    await page.locator('section.confirm').getByRole('button', { name: 'Delete my data' }).click()
    await expect(page.getByText('Nothing was deleted.')).toBeVisible() // a wrong phrase: one answer for every reason
    await erase.getByLabel('Recovery phrase (12 words)').fill(PHRASE)
    await erase.getByRole('button', { name: 'Delete my data' }).click()
    await page.locator('section.confirm').getByRole('button', { name: 'Delete my data' }).click()
    await expect(page.getByText('Deleted 1 session and the backup.')).toBeVisible()
    expect(server.deleted).toEqual([ANON_ID])
    expect(server.mirror.has(ANON_ID)).toBe(false)
    await languageClean(page)
  })

  test('deletes with a save file the server issued', async ({ page }) => {
    const server = new FakeServer()
    await server.attach(page)
    await page.goto(`./${SERVER_QUERY}#/data`)
    const erase = page.locator('form').nth(1)
    await erase.getByRole('radio', { name: 'With a save file' }).check()
    await page.getByLabel('Save file', { exact: true }).setInputFiles({ name: 'humanbench-save.txt', mimeType: 'text/plain', buffer: Buffer.from(JSON.stringify(signedSave(prefs()))) })
    await erase.getByRole('button', { name: 'Delete my data' }).click()
    await page.locator('section.confirm').getByRole('button', { name: 'Delete my data' }).click()
    await expect(page.getByText('Deleted 1 session.')).toBeVisible()
    const sent = server.of('delete_my_data')[0]!.body as { p_anon_id: string; p_save: { sessions: unknown[] } }
    expect(sent.p_anon_id).toBe(ANON_ID)
    expect(sent.p_save.sessions).toHaveLength(1)
    expect(server.allBodies()).not.toContain('brief_prefs')
  })

  test('reflows at 320 px and in dark mode', async ({ page }) => {
    const server = new FakeServer()
    await server.attach(page)
    await page.setViewportSize({ width: 320, height: 800 })
    await page.goto(`./${SERVER_QUERY}#/data`)
    await expect(h1(page)).toHaveText('Your data on the server')
    await overflow(page, 'the data page at 320 px')
    await scheme(page, 'dark')
    await expectNoSeriousAxe(page)
  })
})

test.describe('the privacy notice and the footer with a server', () => {
  test('describe what is sent and say that the notes settings stay on the device', async ({ page }) => {
    await page.goto(`./${SERVER_QUERY}#/privacy`)
    await expect(h1(page)).toHaveText('Privacy and terms')
    await expect(page.getByRole('heading', { name: 'What is sent to the server' })).toBeVisible()
    await expect(page.getByRole('heading', { name: 'Your notes settings stay on your device' })).toBeVisible()
    await expect(page.locator('.flow + main')).toContainText('They are never sent to the server')
    await expectNoSeriousAxe(page)
    await overflow(page, 'the privacy notice')
    await languageClean(page)
    await expect(page.locator('footer').getByRole('link', { name: 'Your data on the server' })).toBeVisible()
  })
})

test.describe('the static fallback (the default build) is untouched', () => {
  test('without the override nothing names a server, nothing is requested from one, and the notice is the static one', async ({ page }) => {
    const server = new FakeServer()
    await server.attach(page)
    const requested: string[] = []
    page.on('request', (r) => {
      if (/supabase|rest\/v1/.test(r.url())) requested.push(r.url())
    })
    await page.goto('./')
    await button(page, 'Start').click()
    await expect(page.locator('ul.points')).toContainText('Nothing is uploaded in this version')
    await agreeGate(page)
    await page.getByRole('checkbox', { name: /honour code/ }).check()
    await button(page, 'Continue').click()
    await expect(button(page, 'Continue')).toBeEnabled({ timeout: 20_000 })
    await button(page, 'Continue').click()
    await expect(h1(page)).toHaveText('Ready when you are')
    await expect(page.getByText('Get a backup from the server')).toHaveCount(0)
    await button(page, 'Begin').click()
    await expect(h1(page)).toHaveText('Up next: Reaction Time')
    await finishNow(page)
    await expect(h1(page)).toHaveText('Session ended') // nothing answered, nothing measured (UX-009b)
    await expect(online(page)).toHaveCount(0)
    // The privacy notice is linked from every page (UX-011); the data page only with a server.
    await expect(page.locator('footer a[href="#/data"]')).toHaveCount(0)
    expect(server.calls).toEqual([])
    expect(requested).toEqual([])
    // the data page only explains
    await page.goto('./#/data')
    await expect(page.locator('.flow + main')).toContainText('keeps nothing on a server')
  })

  // This build names no server, so "off" can only be shown to change nothing; that it beats a server named by the build is `selectBackend`'s unit test (config.test.ts).
  test('?hb_backend=off gives the static fallback: nothing is sent, and the gate says so', async ({ page }) => {
    const server = new FakeServer()
    await server.attach(page)
    await page.goto('./?hb_backend=off')
    await button(page, 'Start').click()
    await expect(page.locator('ul.points')).toContainText('Nothing is uploaded in this version')
    expect(server.calls).toEqual([])
  })
})
