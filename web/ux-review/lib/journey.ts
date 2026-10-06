/**
 * One person's way through a session, photographed: the start screens, optionally the practice
 * questions, then every screen of a `?fast=1` session (the block clocks run 20 times faster, so a whole
 * session is 2 to 3 minutes of real time) driven the way a taker does it (`SessionDriver`), down to the results.
 *
 * Screenshots take real time and the session's clock does not wait for them: a screen is photographed only
 * when it is new within its part (or at every step with `everyStep`), and a slow machine can run out of the
 * session's own limit (about 170 s of real time under `?fast=1`), which the result says plainly.
 */

import { expect, type Page } from '@playwright/test'
import { FINISHED_REASON } from '../../src/session/copy'
import { button, h1 } from '../../e2e/flow'
import { SessionDriver } from '../../e2e/session-driver'
import { Shots, slug } from './shots'

export interface JourneyOptions {
  readonly runId: string
  /** A finger on a phone (taps and the on-screen keypads) instead of a mouse and the keyboard. */
  readonly touch: boolean
  /** Where the session starts (default './?fast=1', relative to the project's baseURL). */
  readonly url?: string
  /** Play the practice questions from the ready screen first. */
  readonly practice?: boolean
  /** Where evidence goes (default: new Shots(page, runId, 'journey')). */
  readonly shots?: Shots
  /** Photograph every step, not only screens that are new within their part. */
  readonly everyStep?: boolean
  /** Stop after this many steps and finish early (the results then hold what was played). */
  readonly maxSteps?: number
  /** Real-time budget (default 8 minutes). */
  readonly limitMs?: number
  /** Titles of parts to skip from their interstitial (e.g. 'Reaction Time'). */
  readonly skipParts?: readonly string[]
}

export interface JourneyStep {
  /** Real milliseconds since the journey began. */
  readonly t: number
  /** h1 | screen kind | renderer class: what makes a screen "new". */
  readonly signature: string
  readonly h1: string
  readonly screen: string
  /** PNG path relative to the repo root; '' when this step was not photographed. */
  readonly shot: string
}

export interface JourneyResult {
  readonly completed: boolean
  readonly error?: string
  /** Titles of the parts seen, in order (skipped ones too). */
  readonly segments: string[]
  readonly skipped: string[]
  /** Part title to the kinds of screen played in it. */
  readonly played: Record<string, string[]>
  readonly answered: number
  readonly steps: JourneyStep[]
  readonly realMs: number
  /** True when `maxSteps` ended the session early. */
  readonly finishedEarly: boolean
}

const message = (error: unknown): string => (error instanceof Error ? error.message : String(error)).trim()

/** The practice questions: answer each, read the feedback, finish, and back to the ready screen. */
async function playPractice(page: Page, driver: SessionDriver, shots: Shots): Promise<void> {
  await driver.press(button(page, 'Try practice questions first'))
  await expect(h1(page)).toHaveText('Practice')
  const choice = page.locator('form.choice')
  const entry = page.locator('form.entry')
  const slider = page.getByRole('slider')
  for (let n = 1; n <= 12; n++) {
    await expect(choice.or(entry)).toBeVisible()
    if (n === 1) await shots.all('practice-question')
    if ((await choice.count()) > 0) {
      await driver.tick(choice.getByRole('radio').first())
      await driver.press(button(page, 'Confirm'))
    } else {
      const box = entry.locator('input[type=text]')
      await box.fill((await box.evaluate((el) => el.classList.contains('letter'))) ? 'A' : '1')
      await driver.press(entry.getByRole('button', { name: 'Submit', exact: true }))
    }
    await expect(slider).toBeVisible()
    if (n === 1) await shots.all('practice-confidence')
    await driver.press(button(page, 'Continue'))
    await expect(page.getByText(/That was (not )?correct\./)).toBeVisible()
    if (n === 1) await shots.all('practice-feedback')
    const last = button(page, 'Finish practice')
    if (await last.isVisible()) {
      await driver.press(last)
      break
    }
    await driver.press(button(page, 'Next practice question'))
  }
  await expect(h1(page)).toHaveText('Practice complete')
  await shots.all('practice-complete')
  await driver.press(button(page, 'Continue'))
  await expect(h1(page)).toHaveText('Ready when you are')
}

/**
 * Play a session and photograph it. Never throws: any failure is photographed and returned as `completed: false` with
 * the message. The result is also saved as `<runId>/<sub>/journey.json`.
 */
export async function playJourney(page: Page, opts: JourneyOptions): Promise<JourneyResult> {
  const t0 = performance.now()
  const limitMs = opts.limitMs ?? 8 * 60_000
  const driver = new SessionDriver(page, { touch: opts.touch })
  const shots = opts.shots ?? new Shots(page, opts.runId, 'journey')
  const skipParts = opts.skipParts ?? []
  const steps: JourneyStep[] = []
  const segments: string[] = []
  const skipped: string[] = []
  const seen = new Map<string, Set<string>>()
  let part = 'start'
  let performed = 0
  let finishedEarly = false
  let error: string | undefined

  try {
    await driver.toReady(opts.url ?? './?fast=1')
    await shots.all('ready')
    if (opts.practice === true) await playPractice(page, driver, shots)
    await driver.begin()
    for (let guard = 0; ; guard++) {
      if (guard >= 3000) throw new Error('the session did not finish in 3000 steps')
      if (performance.now() - t0 > limitMs) throw new Error(`the journey took longer than ${Math.round(limitMs / 1000)} s of real time`)
      const screen = await driver.screen()
      if (screen === 'finished') break
      if (opts.maxSteps !== undefined && performed >= opts.maxSteps) {
        await driver.finishEarly()
        finishedEarly = true
        break
      }
      const heading = ((await page.locator('h1').first().textContent({ timeout: 2000 }).catch(() => null)) ?? '').trim()
      if (screen === 'interstitial') {
        part = heading.replace(/^Up next:\s*/, '').trim()
        segments.push(part)
      }
      const renderer = await page.evaluate<string>(`(document.querySelector('section.hb-render') || {}).className || ''`)
      const signature = `${heading} | ${screen} | ${renderer}`
      const known = seen.get(part) ?? new Set<string>()
      seen.set(part, known)
      let shot = ''
      if (opts.everyStep === true || !known.has(signature)) {
        known.add(signature)
        shot = (await shots.all(`${slug(part)}-${screen}`)).png
      }
      steps.push({ t: Math.round(performance.now() - t0), signature, h1: heading, screen, shot })
      if (screen === 'interstitial' && skipParts.includes(part)) {
        await driver.skipPart()
        skipped.push(part)
      } else {
        await driver.step()
      }
      performed++
    }
    await driver.resultsReady()
    await shots.all('results')
  } catch (cause) {
    error = message(cause).split('\n').slice(0, 8).join('\n')
    // The same hint the driver gives when a slow machine used up the session's own limit.
    const stopped = await page.getByText(FINISHED_REASON.hard_stop).count().catch(() => 0)
    if (stopped > 0) error = `The session reached its time limit before the journey ended (${Math.round((performance.now() - t0) / 1000)} s of real time; about 170 s under ?fast=1): the machine is too slow, or the screenshots took too long. ${error}`
    await shots.all('error')
  }

  const result: JourneyResult = {
    completed: error === undefined,
    ...(error === undefined ? {} : { error }),
    segments,
    skipped,
    played: Object.fromEntries([...driver.played].map(([title, kinds]) => [title, [...kinds]])),
    answered: driver.answered,
    steps,
    realMs: Math.round(performance.now() - t0),
    finishedEarly,
  }
  shots.json('journey', result, { counter: false })
  console.log(`[journey ${opts.runId}] ${result.completed ? 'completed' : `FAILED: ${(error ?? '').split('\n')[0]}`} in ${(result.realMs / 1000).toFixed(1)} s, ${steps.length} steps, ${result.answered} answered, parts: ${segments.join(', ')}`)
  return result
}
