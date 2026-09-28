/**
 * The G7 review page (DESIGN §4.4; ROADMAP M1.G7) in jsdom: every registered family with 30
 * instances from the review seeds, each with key, verify() checks, difficulty and groups, a
 * renderer or the JSON fallback, verdicts saved to localStorage and read back; and the renderer
 * lookup across the entry map and a visual map.
 */

import { flushSync, mount, unmount } from 'svelte'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { ENTRY_RENDERERS } from '../render/entry'
import { FAMILY_NAMES, getFamily } from '../tasks/registry'
import { plannedFamilies, rendererFor, rendererMapsOf, reviewFamilies, reviewInstance, reviewInstances } from './instances'
import Review from './Review.svelte'
import { REVIEW_PER_FAMILY, REVIEW_STORAGE_KEY, parseStore, reviewSeed } from './verdicts'

describe('review instances', () => {
  it('covers every registered family with its current generator version', () => {
    expect(reviewFamilies().map((f) => f.name)).toEqual([...FAMILY_NAMES])
    expect(plannedFamilies().map((p) => p.generator_version)).toEqual(FAMILY_NAMES.map((n) => getFamily(n)?.generatorVersion))
  })

  it('gives 30 instances per family from the review seeds, all generated and verified', () => {
    for (const family of reviewFamilies()) {
      const list = reviewInstances(family)
      expect(list).toHaveLength(REVIEW_PER_FAMILY)
      list.forEach((inst, k) => {
        expect(inst.index).toBe(k + 1)
        expect(inst.seed).toBe(reviewSeed(family.name, k + 1))
        expect(inst.ok, `${family.name} #${k + 1}`).toBe(true)
        if (inst.ok) {
          expect(inst.item.item_id).toBe(`i:${family.name}:${family.generatorVersion}:${inst.seed}`)
          expect(inst.verify.ok, `${inst.item.item_id}: ${inst.verify.reason}`).toBe(true)
        }
      })
    }
  })

  it('reports a generator that throws instead of raising', () => {
    const broken = { ...reviewFamilies()[0], name: 'broken', generate: () => { throw new RangeError('boom') } } as unknown as Parameters<typeof reviewInstance>[0]
    expect(reviewInstance(broken, 1)).toEqual({ index: 1, seed: 'review-broken-1', ok: false, error: 'RangeError: boom' })
  })

  it('finds renderers in the entry map first, then in visual maps, else none', () => {
    expect(rendererFor('series')).toEqual({ component: ENTRY_RENDERERS.series, source: 'entry' })
    const fake = (() => null) as unknown as never
    expect(rendererMapsOf([{ VISUAL_RENDERERS: { rotation: fake, nope: fake }, other: 3 }])).toEqual({ rotation: fake })
    expect(rendererMapsOf([{ visualRenderers: { matrices: fake } }])).toEqual({ matrices: fake })
    expect(rendererMapsOf([{ x: 1 }, {}])).toEqual({})
  })
})

describe('Review page', () => {
  let app: ReturnType<typeof mount> | undefined
  beforeEach(() => {
    localStorage.clear()
    history.replaceState(null, '', '/humanbench/review.html?family=quant&per=5')
  })
  afterEach(() => {
    if (app) void unmount(app)
    app = undefined
    document.body.innerHTML = ''
  })

  it('lists the families, 30 instance links and 5 cards with key, checks and difficulty', () => {
    app = mount(Review, { target: document.body })
    flushSync()
    const famLinks = [...document.querySelectorAll('nav[aria-label="Families"] a')].map((a) => a.textContent?.trim())
    expect(famLinks).toEqual([...FAMILY_NAMES])
    expect(document.querySelector('nav[aria-label="Families"] a[aria-current="page"]')?.textContent?.trim()).toBe('quant')
    expect(document.querySelectorAll('nav[aria-label="Instances of quant"] a')).toHaveLength(30)
    const cards = document.querySelectorAll('article')
    expect(cards).toHaveLength(5)
    const first = cards[0] as HTMLElement
    expect(first.querySelector('h3')?.textContent).toContain('i:quant:')
    expect(first.textContent).toMatch(/Key/)
    expect(first.textContent).toMatch(/verify\(\)/)
    expect(first.textContent).toMatch(/b prior/)
    expect(first.textContent).toMatch(/sibling_group/)
    expect(first.querySelector('.hb-render')).not.toBeNull()
    expect(location.search).toContain('family=quant')
  })

  it('saves a verdict with its note to localStorage and shows it after a remount', () => {
    app = mount(Review, { target: document.body })
    flushSync()
    const card = document.querySelector('article') as HTMLElement
    const note = card.querySelector('textarea') as HTMLTextAreaElement
    note.value = 'hint wording'
    note.dispatchEvent(new Event('input', { bubbles: true }))
    flushSync()
    ;(card.querySelector('input[type="radio"][value="unsure"]') as HTMLInputElement).click()
    flushSync()
    const stored = parseStore(localStorage.getItem(REVIEW_STORAGE_KEY))
    const rows = Object.values(stored.verdicts)
    expect(rows).toHaveLength(1)
    expect(rows[0]).toMatchObject({ family: 'quant', seed: 'review-quant-1', verdict: 'unsure', note: 'hint wording' })
    expect(document.querySelector('[role="status"]')?.textContent).toContain('Saved #1: unsure')
    void unmount(app)
    document.body.innerHTML = ''
    app = mount(Review, { target: document.body })
    flushSync()
    const again = document.querySelector('article') as HTMLElement
    expect((again.querySelector('input[type="radio"][value="unsure"]') as HTMLInputElement).checked).toBe(true)
    expect((again.querySelector('textarea') as HTMLTextAreaElement).value).toBe('hint wording')
    expect(document.querySelector('nav[aria-label="Instances of quant"] a.unsure')).not.toBeNull()
  })

  it('shows families without a renderer as JSON', () => {
    const noRenderer = FAMILY_NAMES.find((n) => rendererFor(n) === null)
    if (noRenderer === undefined) return // every family has a renderer in this build
    history.replaceState(null, '', `/humanbench/review.html?family=${noRenderer}&per=1`)
    app = mount(Review, { target: document.body })
    flushSync()
    expect(document.querySelector('article pre.json')).not.toBeNull()
    expect(document.querySelector('article h4')?.textContent).toMatch(/spec as JSON/)
  })
})
