/// <reference lib="dom" />
/**
 * Keyboard-only helpers (ROADMAP M1.21; WCAG 2.1.1 keyboard, 2.1.2 no keyboard trap, 2.4.3 focus order,
 * 2.4.7 focus visible). Nothing here touches the mouse: a control is reached by pressing Tab until it has
 * focus, then operated with Enter or Space, as a person without a pointer would. The e2e tsconfig has no
 * DOM lib, so the page code is passed as strings.
 *
 * Safari's default is not to Tab to buttons and radios (Option+Tab does); Playwright's macOS WebKit
 * follows that, its Linux build is not known to. {@link chordFor} tries Tab on a probe page and uses
 * Option+Tab only where Tab skips buttons, so each engine and OS gets the chord that reaches every control.
 */

import { expect, type Locator, type Page } from '@playwright/test'

/** What has focus: a short description, whether anything shows it, and where on the page it is. */
export interface FocusInfo {
  /** Stable id of the focused element on this page (shared with {@link focusableControls}), or '' when nothing has focus. */
  readonly id: string
  /** `tag[role] "name"` of the focused element. */
  readonly what: string
  /** True iff the element, or the box drawn for it (a radio's card, a checkbox's label), has a focus outline. */
  readonly indicator: boolean
  /** True iff the element is inside the viewport horizontally and at least partly vertically (it was scrolled to). */
  readonly inView: boolean
  /** The element is the page body or document (nothing has focus). */
  readonly none: boolean
}

const chords = new WeakMap<Page, string>()

/** Give keyboard focus back to the document, as at a fresh page load (nothing focused, selection at the start). */
async function focusDocument(page: Page): Promise<void> {
  // WebKit stops answering Tab once the focused control has been removed from the page (e.g. a button clicked to open a
  // panel) until focus is given to the document again.
  await page.evaluate(`(() => {
    if (document.activeElement && document.activeElement !== document.body) document.activeElement.blur()
    document.body.setAttribute('tabindex', '-1')
    document.body.focus()
    document.body.removeAttribute('tabindex')
    window.scrollTo(0, 0)
    const range = document.createRange()
    range.setStart(document.body, 0)
    range.collapse(true)
    const selection = getSelection()
    selection.removeAllRanges()
    selection.addRange(range)
  })()`)
}

/** Does plain Tab move focus from one button to the next in this browser? (Safari's default: no.) */
async function tabReachesButtons(page: Page): Promise<boolean> {
  await page.evaluate(`(() => {
    for (const id of ['hb-probe-b', 'hb-probe-a']) {
      const b = document.createElement('button')
      b.id = id
      b.textContent = id
      b.style.cssText = 'position:fixed;left:0;top:0;width:1px;height:1px;opacity:0'
      document.body.prepend(b)
    }
    document.getElementById('hb-probe-a').focus()
  })()`)
  await page.keyboard.press('Tab')
  const reached = await page.evaluate<boolean>(`!!document.activeElement && document.activeElement.id === 'hb-probe-b'`)
  await page.evaluate(`for (const id of ['hb-probe-a', 'hb-probe-b']) document.getElementById(id)?.remove()`)
  await focusDocument(page)
  return reached
}

/** The key chord that moves focus to the next control in this browser on this OS: Tab, or Option+Tab where Tab skips buttons. */
export async function chordFor(page: Page, browserName: string): Promise<string> {
  const known = chords.get(page)
  if (known !== undefined) return known
  const chord = browserName === 'webkit' && !(await tabReachesButtons(page)) ? 'Alt+Tab' : 'Tab'
  chords.set(page, chord)
  return chord
}

/** Describe the focused element. */
export async function focusInfo(page: Page): Promise<FocusInfo> {
  return page.evaluate<FocusInfo>(`(() => {
    const el = document.activeElement
    if (!el || el === document.body || el === document.documentElement) return { id: '', what: 'nothing', indicator: false, inView: false, none: true }
    if (!el.__hbTabId) el.__hbTabId = 'tab-' + Math.random().toString(36).slice(2)
    const label = el.getAttribute('aria-label') || (el.labels && el.labels[0] ? el.labels[0].textContent : '') || el.textContent || el.getAttribute('title') || ''
    const what = el.tagName.toLowerCase() + (el.getAttribute('role') ? '[' + el.getAttribute('role') + ']' : '') + (el.getAttribute('type') ? '[' + el.getAttribute('type') + ']' : '') + ' "' + label.replace(/\\s+/g, ' ').trim().slice(0, 40) + '"'
    const drawn = (e) => {
      if (!e) return false
      const cs = getComputedStyle(e)
      return cs.outlineStyle !== 'none' && cs.outlineStyle !== 'hidden' && (cs.outlineStyle === 'auto' || parseFloat(cs.outlineWidth) >= 2)
    }
    // A radio laid over its card, or a checkbox inside a label, shows focus on the neighbour that is drawn.
    const indicator = [el, el.nextElementSibling, el.closest('label'), el.closest('summary')].some(drawn)
    const r = el.getBoundingClientRect()
    const inView = r.right > 0 && r.left < window.innerWidth && r.bottom > 0 && r.top < window.innerHeight
    return { id: el.__hbTabId, what, indicator, inView, none: false }
  })()`)
}

/** Press Tab until `target` has focus; returns how many presses it took. Throws, naming the stops, if it never does. */
export async function tabTo(page: Page, target: Locator, browserName: string, max = 80): Promise<number> {
  // A target that is not on the page must not stall the run until the test times out: a short wait, then keep pressing Tab.
  const has = (): Promise<boolean> => target.evaluate((el) => el === document.activeElement, undefined, { timeout: 1500 }).catch(() => false)
  // The control may be a moment from appearing (the screen just changed); if it never is, say so rather than press Tab for nothing.
  await target.first().waitFor({ state: 'attached', timeout: 3000 }).catch(() => {
    throw new Error(`${String(target)} is not on the page, so Tab cannot reach it`)
  })
  if (await has()) return 0
  const stops: string[] = []
  for (let i = 1; i <= max; i++) {
    await page.keyboard.press(await chordFor(page, browserName))
    if (await has()) return i
    stops.push((await focusInfo(page)).what)
  }
  throw new Error(`Tab never reached ${String(target)} in ${max} presses; it visited: ${[...new Set(stops)].join(', ')}`)
}

/** Reach `target` with Tab and press `key` on it (Enter for buttons and links, Space also for checkboxes and radios). */
export async function press(page: Page, target: Locator, browserName: string, key: 'Enter' | 'Space' = 'Enter'): Promise<void> {
  await tabTo(page, target, browserName)
  await page.keyboard.press(key)
}

/**
 * Tab once round the whole page from its top, and return the stops in the order they came. The round ends at the
 * first stop seen twice, or when focus has left the page twice after visiting something (to the browser's own
 * controls, or to the document). A keyboard trap (WCAG 2.1.2) shows as a round that does not end within `max`; a
 * control Tab cannot reach is found by comparing the stops with {@link focusableControls}.
 */
export async function tabAround(page: Page, browserName: string, max = 150): Promise<FocusInfo[]> {
  // Begin where a person who has just opened the page begins: nothing focused, the start of the document.
  await chordFor(page, browserName)
  await focusDocument(page)
  const stops: FocusInfo[] = []
  const seen = new Set<string>()
  let left = 0
  for (let i = 0; i < max; i++) {
    await page.keyboard.press(await chordFor(page, browserName))
    // WebKit scrolls the focused control into view a little later than the key press; give it a moment before judging.
    let info = await focusInfo(page)
    for (let wait = 0; wait < 10 && !info.none && !info.inView; wait++) {
      await page.waitForTimeout(50)
      info = await focusInfo(page)
    }
    if (info.none) {
      // Focus left the page. The round is over once it has done so twice after visiting something; some engines
      // spend a press or two on the browser's own controls before the first stop, so a page with no stop yet gets more.
      left++
      if (stops.length > 0 ? left >= 2 : left >= 6) return stops
      continue
    }
    if (seen.has(info.id)) return stops
    seen.add(info.id)
    stops.push(info)
  }
  throw new Error(`Tab did not come round in ${max} presses (a keyboard trap?); last stops: ${stops.slice(-5).map((s) => s.what).join(', ')}`)
}

/**
 * A control that Tab can reach, with a short description. `ids` are the ids ({@link FocusInfo.id}) of the elements
 * that stand for it: itself, or for a radio group any of its radios (Tab stops at the chosen one, else the first).
 */
export interface Control {
  readonly ids: readonly string[]
  readonly what: string
}

/**
 * The controls on the page that Tab can reach: visible, enabled, not tabindex -1, not in a closed disclosure, and
 * one per radio group (a group is a single tab stop).
 */
export async function focusableControls(page: Page): Promise<Control[]> {
  return page.evaluate<Control[]>(`(() => {
    const sel = 'a[href], button, input, select, textarea, summary, [tabindex]'
    const visible = (el) => {
      const cs = getComputedStyle(el)
      if (cs.display === 'none' || cs.visibility === 'hidden') return false
      // an input laid over its card with opacity 0 is still a real, focusable control
      const r = el.getBoundingClientRect()
      return r.width > 0 && r.height > 0
    }
    const inClosedDetails = (el) => { const d = el.closest('details'); return d && !d.open && !(el.tagName === 'SUMMARY' && el.parentElement === d) }
    const radioGroupsSeen = new Set()
    const idOf = (el) => (el.__hbTabId = el.__hbTabId || 'tab-' + Math.random().toString(36).slice(2))
    const out = []
    for (const el of document.querySelectorAll(sel)) {
      if (el.matches(':disabled') || el.tabIndex < 0 || el.closest('[hidden], [inert]') || !visible(el) || inClosedDetails(el)) continue
      const label = el.getAttribute('aria-label') || (el.labels && el.labels[0] ? el.labels[0].textContent : '') || el.textContent || el.getAttribute('title') || ''
      const what = el.tagName.toLowerCase() + (el.getAttribute('type') ? '[' + el.getAttribute('type') + ']' : '') + ' "' + label.replace(/\\s+/g, ' ').trim().slice(0, 40) + '"'
      // a radio group is one tab stop
      if (el.tagName === 'INPUT' && el.type === 'radio' && el.name) {
        const key = (el.form ? 'f' : 'd') + ':' + el.name
        if (radioGroupsSeen.has(key)) continue
        radioGroupsSeen.add(key)
        const group = [...document.querySelectorAll('input[type=radio]')].filter((r) => r.name === el.name && r.form === el.form && !r.matches(':disabled'))
        out.push({ ids: group.map(idOf), what })
        continue
      }
      out.push({ ids: [idOf(el)], what })
    }
    return out
  })()`)
}

/** Fails if nothing has focus, or the focused thing shows no focus indicator or is off screen. */
export async function expectFocusVisible(page: Page, where: string): Promise<FocusInfo> {
  const info = await focusInfo(page)
  expect(info.none, `${where}: nothing has focus`).toBe(false)
  expect(info.indicator, `${where}: ${info.what} shows no focus indicator`).toBe(true)
  expect(info.inView, `${where}: ${info.what} has focus but is off screen`).toBe(true)
  return info
}
