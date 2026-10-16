/**
 * The remaining families in the session flow (ROADMAP M3.11; owner decisions 2026-10-13; DESIGN §3 rows 3, 11, 12,
 * 16 and 17, §10, §13, R-5.6.x, R-11.1): each part is planned when the server says it has questions for its skill
 * (`live_axes`), shows its "Up next" screen, draws its served questions with its own renderer, sends the answer the
 * renderer gives, and asks how sure the person is only after a tier-a answer (word links, logic games), not after a
 * Fermi range, a rating of responses or an emotion vignette. A logic game's setup stays on screen across its
 * questions, as a passage does. The server is a fake transport that serves made-up items by skill
 * (`render/served-demo.ts`); `scripts/db/families.db.test.ts` has the real database.
 */

import { flushSync, mount, unmount } from 'svelte'
import { afterEach, beforeAll, describe, expect, it } from 'vitest'
import { FakeTransport, fakeBackend } from '../backend/testing'
import { buttonByText, click, fakeDisplay, typeInto, type FakeDisplay } from '../render/common/testing'
import { settle } from '../render/dom-testing'
import { demoEmotionPayload, demoFermiPayload, demoLogicGamePayload, demoRatPayload, demoSjtPayload, type DemoServedPayload } from '../render/served-demo'
import { fakeEnv, type FakeEnv } from './dom-support'
import SessionApp from './SessionApp.svelte'
import { resultsLoader } from './results-loader'
import { runtimeLoader } from './runtime-loader'

beforeAll(async () => {
  await resultsLoader.load()
  // The session runtime is its own chunk too (UX-100, `runtime.ts`); loaded here once, as the welcome screen would.
  await runtimeLoader.load()
}, 90_000)

let app: ReturnType<typeof mount> | undefined
let host: HTMLElement

afterEach(() => {
  if (app) unmount(app)
  app = undefined
  document.body.innerHTML = ''
})

const h1 = (): string => document.querySelector('main h1')?.textContent?.trim() ?? ''
const tick = async (n = 8): Promise<void> => {
  for (let i = 0; i < n; i++) await new Promise((r) => setTimeout(r, 0))
  flushSync()
}
const box = (label: RegExp): HTMLInputElement => {
  const l = [...document.querySelectorAll('label')].find((x) => label.test(x.textContent ?? ''))
  const el = l?.control
  if (!(el instanceof HTMLInputElement)) throw new Error(`no input for ${String(label)}`)
  return el
}

interface Wire {
  readonly seq: number
  readonly item: Record<string, unknown>
  readonly set?: { readonly position: number; readonly of: number }
}

/** A fake server that reads `p_axes` as the real one does: the next item of the first skill asked for that has one. */
class PoolTransport extends FakeTransport {
  readonly pools = new Map<string, Wire[]>()
  #seq = 0
  #ids = 0
  #pending: Wire | null = null

  add(axis: string, ...items: { p: DemoServedPayload; set?: { position: number; of: number } }[]): void {
    this.pools.set(axis, [...(this.pools.get(axis) ?? []), ...items.map(({ p, set }) => ({ seq: 0, item: { item_id: `i:made:up${this.pools.size}:n${++this.#ids}`, item_type: p.itemType, time_limit_s: 180, stem: p.stem, media: p.media, ...(p.options === null ? {} : { options: p.options }) }, ...(set === undefined ? {} : { set }) }))])
  }

  override call(fn: string, args: Readonly<Record<string, unknown>>): Promise<unknown> {
    if (fn === 'next_item' || (fn === 'submit' && args.p_next !== false)) {
      this.calls.push({ fn, body: JSON.stringify(args) })
      if (fn === 'submit' && this.#pending !== null && this.#pending.item.item_id === args.p_item_id) this.#pending = null
      const next = this.#next((args.p_axes as string[] | undefined) ?? [])
      return Promise.resolve(fn === 'submit' ? { ack: true, seq: 1, next } : next)
    }
    if (fn === 'submit' && this.#pending !== null && this.#pending.item.item_id === args.p_item_id) this.#pending = null
    return super.call(fn, args)
  }

  #next(axes: readonly string[]): unknown {
    if (this.#pending !== null) return this.#pending
    for (const a of axes) {
      const w = this.pools.get(a)?.shift()
      if (w !== undefined) {
        this.#pending = { ...w, seq: ++this.#seq }
        return this.#pending
      }
    }
    return { done: true, reason: 'no_items' }
  }

  submitted(): { response: unknown; confidence: unknown; item: string }[] {
    return this.calls.filter((c) => c.fn === 'submit').map((c) => JSON.parse(c.body) as Record<string, unknown>).map((b) => ({ response: b.p_response, confidence: b.p_confidence, item: String(b.p_item_id) }))
  }
}

function setup(live: readonly string[]): { t: PoolTransport; fake: FakeEnv<FakeDisplay> } {
  const t = new PoolTransport()
  const fake = fakeEnv(fakeDisplay(), { backend: fakeBackend(t, live as never) })
  return { t, fake }
}

async function toReady(fake: FakeEnv<FakeDisplay>): Promise<void> {
  host = document.createElement('div')
  document.body.appendChild(host)
  app = mount(SessionApp, { target: host, props: { env: fake.env } })
  flushSync()
  await tick()
  click(buttonByText(host, 'Start'))
  click(box(/18 or older/))
  click(buttonByText(host, 'Continue'))
  click(box(/honour code/))
  click(buttonByText(host, 'Continue'))
  fake.display.advance(1200)
  await new Promise((resolve) => setTimeout(resolve, 0))
  flushSync()
  click(buttonByText(host, 'Continue'))
  expect(h1()).toBe('Ready when you are')
}

/** Skips every part until the "Up next" screen of `title` (a part with no questions ends at once when it is started). */
async function upTo(title: string): Promise<void> {
  for (let i = 0; i < 40; i++) {
    await tick()
    if (h1() === 'Time for a break?') {
      click(buttonByText(host, 'Keep going'))
      continue
    }
    if (h1() === `Up next: ${title}`) return
    if (h1().startsWith('Up next: ')) {
      const name = h1().slice('Up next: '.length)
      click(buttonByText(host, 'Skip this part'))
      click(buttonByText(host, `Skip ${name}`))
    }
  }
  throw new Error(`never reached "Up next: ${title}" (at "${h1()}")`)
}

async function begin(title: string): Promise<void> {
  click(buttonByText(host, 'Begin'))
  await upTo(title)
  click(buttonByText(host, 'Start'))
  await tick()
  await settle()
  flushSync()
}

/** Sets the optional confidence scale of the question on screen (owner decision 2026-10-13: on the question, before its one press). */
function setConfidence(point: number): void {
  const points = host.querySelectorAll<HTMLInputElement>('fieldset[data-confidence] input[type="radio"]')
  if (points.length === 0) throw new Error('no confidence scale')
  click(points[point]!)
  flushSync()
}

const noScale = (): boolean => host.querySelector('fieldset[data-confidence]') === null

async function next(): Promise<void> {
  await tick()
  await settle()
  flushSync()
}

describe('the remaining families, served', () => {
  it('Fermi Estimation: the estimate entry, the answer as {value, unit, low, high}, and no confidence slider (the range is the statement)', async () => {
    const { t, fake } = setup(['FER'])
    t.add('FER', { p: demoFermiPayload(1) }, { p: demoFermiPayload(2) })
    await toReady(fake)
    await begin('Fermi Estimation')
    expect(h1()).toBe('Fermi Estimation')
    const input = (label: string): HTMLInputElement => {
      const el = [...host.querySelectorAll('label')].find((l) => l.textContent?.trim() === label)!
      return host.querySelector(`#${CSS.escape(el.htmlFor)}`) as HTMLInputElement
    }
    const select = host.querySelector('select') as HTMLSelectElement | null
    const unit = select !== null ? select.options[1]!.value : ''
    if (select !== null) {
      select.value = unit
      select.dispatchEvent(new Event('change', { bubbles: true }))
    }
    typeInto(input('Your best guess'), '3000')
    typeInto(input('Low end of your 80% range'), '1000')
    typeInto(input('High end of your 80% range'), '9000')
    flushSync()
    expect(noScale()).toBe(true) // the range is the statement: no confidence scale
    click(buttonByText(host, 'Submit'))
    await next()
    expect(noScale()).toBe(true)
    const sent = t.submitted()
    expect(sent).toHaveLength(1)
    expect(sent[0]!.response).toMatchObject({ value: 3000, low: 1000, high: 9000 })
    expect(sent[0]!.confidence).toBeNull()
    // the next Fermi question is on screen
    expect(host.querySelector('label')?.textContent).toBeTruthy()
  })

  it('Creative Thinking (word links): the triad entry, the typed word, and the optional confidence scale with it (tier a)', async () => {
    const { t, fake } = setup(['CRE'])
    t.add('CRE', { p: demoRatPayload(1) }, { p: demoRatPayload(2) })
    await toReady(fake)
    await begin('Creative Thinking')
    expect(h1()).toBe('Creative Thinking')
    expect(host.querySelectorAll('.cues li')).toHaveLength(3)
    typeInto(host.querySelector<HTMLInputElement>('.rat input[type="text"], .rat input:not([type])')!, ' Word ')
    flushSync()
    setConfidence(3) // typed entry: 0, 25, 50, 75, 100
    click(buttonByText(host, 'Confirm'))
    await next()
    const sent = t.submitted()
    expect(sent[0]).toMatchObject({ response: 'Word', confidence: 75 })
  })

  it('Emotion Reading: a vignette and a situational judgment, each sent with no confidence rating; the skill tip says what the skill measures (R-5.6.2)', async () => {
    const { t, fake } = setup(['EMO'])
    t.add('EMO', { p: demoEmotionPayload(1) }, { p: demoSjtPayload(2) }, { p: demoEmotionPayload(3) })
    await toReady(fake)
    await begin('Emotion Reading (text scenarios)')
    // non-diagnostic (R-5.6.1): no clinical term; the R-5.6.2 tooltip's "Not a diagnostic or clinical measure" is the one allowed sentence
    expect(host.textContent).not.toMatch(/autis|adhd|alexithym|disorder|symptom/iu)
    const radios = [...host.querySelectorAll<HTMLInputElement>('input[type="radio"]')]
    expect(radios).toHaveLength(5)
    expect(noScale()).toBe(true) // not rated: no confidence scale
    click(radios[2]!)
    flushSync()
    click(buttonByText(host, 'Confirm'))
    await next()
    expect(noScale()).toBe(true)
    // the situational judgment: four responses, a rating each
    const groups = [...host.querySelectorAll('fieldset')].filter((f) => f.querySelectorAll('input[type="radio"]').length === 4)
    expect(groups.length).toBeGreaterThanOrEqual(4)
    groups.slice(-4).forEach((g, i) => click(g.querySelectorAll<HTMLInputElement>('input[type="radio"]')[i]!))
    flushSync()
    click(buttonByText(host, 'Confirm'))
    await next()
    const sent = t.submitted()
    expect(sent.map((s) => s.confidence)).toEqual([null, null])
    expect(sent[0]!.response).toBe(2)
    expect(sent[1]!.response).toEqual([1, 2, 3, 4])
  })

  it('Logic Games: the setup beside its questions as an opening and a list of rules, kept in place across the game, "Question 2 of 3 about this setup", and the optional confidence scale (tier a)', async () => {
    const { t, fake } = setup(['LG'])
    t.add('LG', ...[0, 1, 2].map((q) => ({ p: demoLogicGamePayload(0, q), set: { position: q + 1, of: 3 } })), ...[0, 1, 2, 3].map((q) => ({ p: demoLogicGamePayload(1, q), set: { position: q + 1, of: 4 } })))
    await toReady(fake)
    await begin('Logic Games')
    expect(h1()).toBe('Logic Games')
    const setup1 = host.querySelector<HTMLElement>('section.passage')!
    expect(setup1.querySelector('h2')?.textContent).toBe('Setup')
    expect(setup1.querySelectorAll('.rules li')).toHaveLength(3)
    expect(host.querySelector('[data-set-position]')?.textContent).toBe('Question 1 of 3 about this setup')
    const answer = async (): Promise<void> => {
      await settle()
      flushSync()
      click(host.querySelectorAll<HTMLInputElement>('.text-mc .options input[type="radio"]')[1]!)
      flushSync()
      setConfidence(4) // 100%
      click(buttonByText(host, 'Confirm'))
      flushSync()
      await next()
    }
    await answer()
    expect(host.querySelector('section.passage')).toBe(setup1)
    expect(host.querySelector('[data-set-position]')?.textContent).toBe('Question 2 of 3 about this setup')
    await answer()
    await answer()
    const setup2 = host.querySelector<HTMLElement>('section.passage')!
    expect(setup2).not.toBe(setup1)
    expect(host.querySelector('[data-set-position]')?.textContent).toBe('Question 1 of 4 about this setup')
    expect(t.submitted().map((s) => s.confidence)).toEqual([100, 100, 100])
  })

  it('plans no part the server has no questions for, and says the length of the parts it plans', async () => {
    const { fake } = setup([])
    await toReady(fake)
    expect(host.textContent).toContain('Six short parts, about 30 minutes.')
    const live = setup(['FER', 'CRE'])
    if (app) unmount(app)
    document.body.innerHTML = ''
    await toReady(live.fake)
    expect(host.textContent).toMatch(/Up to eight short parts, about \d+ minutes\./u)
  })
})
