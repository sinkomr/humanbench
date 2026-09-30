/**
 * The "Notes for your AI" builder at `<base>notes.html` (Phase AI, ROADMAP AI.5; proposal §3.3,
 * §7.5; requirements R-17.1, R-17.10, R-17.12, R-17.14). In Chromium, WebKit and an emulated
 * iPhone 13:
 * - axe: 0 serious or critical issues in light and dark mode, on load and after a full flow;
 * - the rendered page passes the language lint (A13);
 * - copy puts exactly the previewed notes on the clipboard and announces it (aria-live), and
 *   download gives a uniquely named file with the same bytes (WebKit and iOS included);
 * - zero network requests after load, however much is done on the page;
 * - nothing is written to localStorage, sessionStorage, IndexedDB, cookies or caches, however much
 *   is typed (the builder is storageless until the 18+ gate and `brief_prefs` exist, so the
 *   under-18 path writes nothing from it);
 * - keyboard-only use of the whole flow, 320 px reflow, 200% zoom, reduced motion.
 * The e2e tsconfig has no DOM lib, so page code is passed as strings.
 */

import { expect, test, type Page } from '@playwright/test'
import { lintText } from '../scripts/language-lint'
import { COPY } from '../src/brief/copy'
import { expectNoSeriousAxe } from './axe'

const PAGE = './notes.html'

async function open(page: Page): Promise<void> {
  await page.goto(PAGE)
  await expect(page.getByRole('heading', { level: 1, name: 'Notes for your AI' })).toBeVisible()
  await expect(page.locator('#notes-text')).toContainText('How I like explanations')
}

/** A representative pass over the page: coding context, topics, choices, typed text, a drawer. */
async function useEverything(page: Page): Promise<void> {
  await page.getByRole('radio', { name: /Coding and data/ }).check()
  await page.getByRole('button', { name: /Programming/ }).first().click()
  await page.getByRole('button', { name: /Statistics/ }).first().click()
  await page.getByRole('group', { name: 'Programming' }).getByLabel('I know this well').check()
  await page.getByRole('group', { name: 'Statistics' }).getByLabel(/New to me/).check()
  await page.getByLabel('Tell me the plan before a large change').check()
  await page.getByLabel(/Hobbies or subjects/).fill('chess, cooking')
  await page.locator('#custom-0').fill('Use metric units')
  await page.getByText('Why this line?').first().click()
  await page.getByText('Show all topics').click()
}

const notesText = (page: Page): Promise<string> => page.locator('#notes-text').innerText()

test.describe('load', () => {
  test('loads under /humanbench/ with every asset and no errors, and titles the page', async ({ page }) => {
    const problems: string[] = []
    page.on('response', (r) => {
      if (r.status() >= 400) problems.push(`${r.status()} ${r.url()}`)
    })
    page.on('requestfailed', (r) => problems.push(`failed ${r.url()}: ${r.failure()?.errorText ?? ''}`))
    page.on('pageerror', (e) => problems.push(`page error: ${e.message}`))
    page.on('console', (m) => {
      if (m.type() === 'error') problems.push(`console error: ${m.text()}`)
    })
    const response = await page.goto(PAGE, { waitUntil: 'networkidle' })
    expect(response?.status()).toBe(200)
    expect(new URL(page.url()).pathname).toBe('/humanbench/notes.html')
    await expect(page).toHaveTitle(/^Notes for your AI/)
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('Notes for your AI')
    await expect(page.getByTestId('claim')).toHaveText('Designed from research on explanations; not yet shown to help HumanBench users.')
    await expect(page.getByTestId('trust')).toHaveText(COPY.trust)
    expect(problems).toEqual([])
  })

  test('shows the provider warning, anti-coercion, placement and what to look for before the copy button', async ({ page }) => {
    await open(page)
    for (const id of ['provider-warning', 'anti-coercion', 'placement', 'look-for']) await expect(page.getByTestId(id)).toBeVisible()
    const order = await page.evaluate(`(() => {
      const pos = (sel) => document.querySelector(sel).getBoundingClientRect().top
      const copy = [...document.querySelectorAll('button')].find((b) => b.textContent.trim() === 'Copy the notes')
      return [pos('[data-testid=provider-warning]'), pos('[data-testid=anti-coercion]'), pos('[data-testid=placement]'), pos('[data-testid=look-for]'), copy.getBoundingClientRect().top]
    })()`)
    const [a, b, c, d, e] = order as number[]
    expect(a! < b! && b! < c! && c! < d! && d! < e!).toBe(true)
  })

  test('the rendered page passes the language lint (A13)', async ({ page }) => {
    await open(page)
    await useEverything(page)
    const html = (await page.content()).replace(/\/assets\/[^"'\s)]+/g, '/assets/')
    expect(html).toContain('/humanbench/assets/')
    expect(lintText(html, 'rendered.html')).toEqual([])
  })
})

test.describe('accessibility (M1.A, M1.21, R-17.14)', () => {
  for (const colorScheme of ['light', 'dark'] as const) {
    test(`has no serious or critical axe violations on load and after a full flow (${colorScheme})`, async ({ page }) => {
      await page.emulateMedia({ colorScheme })
      await open(page)
      await expectNoSeriousAxe(page)
      await useEverything(page)
      await expectNoSeriousAxe(page)
      await page.getByRole('radio', { name: /Claude Code skill/ }).check()
      await page.getByText('How to remove these notes later').click()
      await expectNoSeriousAxe(page)
    })
  }

  test('reflows at 320 px and at 200% zoom with no horizontal scroll, including open drawers and long text', async ({ page }) => {
    for (const [width, height] of [
      [320, 640],
      [640, 480], // 200% zoom of a 1280 px window
    ] as const) {
      await page.setViewportSize({ width, height })
      await open(page)
      await useEverything(page)
      await page.getByRole('radio', { name: /Claude Code skill/ }).check()
      await page.getByRole('radio', { name: /Your own app/ }).check()
      const overflow = await page.evaluate(`document.documentElement.scrollWidth - document.documentElement.clientWidth`)
      expect(overflow, `${width}px`).toBeLessThanOrEqual(0)
      await expectNoSeriousAxe(page)
    }
  })

  test('has no running animation or transition with reduced motion', async ({ page }) => {
    await page.emulateMedia({ reducedMotion: 'reduce' })
    await open(page)
    await useEverything(page)
    expect(await page.evaluate(`document.getAnimations().length`)).toBe(0)
  })

  test('switches motion off under prefers-reduced-motion even where a style would add it', async ({ page }) => {
    // The page has no motion of its own, so the override is tested against a probe style that adds a
    // transition and smooth scrolling: it must show up without the preference (the control) and not with it.
    const probe = `(() => {
      if (!document.getElementById('motion-probe')) {
        const s = document.createElement('style')
        s.id = 'motion-probe'
        s.textContent = '* { transition: opacity 5s; scroll-behavior: smooth; }'
        document.head.append(s)
      }
      return [getComputedStyle(document.querySelector('main')).transitionDuration, getComputedStyle(document.documentElement).scrollBehavior]
    })()`
    await page.emulateMedia({ reducedMotion: 'no-preference' })
    await open(page)
    expect(await page.evaluate(probe)).toEqual(['5s', 'smooth'])
    await page.emulateMedia({ reducedMotion: 'reduce' })
    expect(await page.evaluate(probe)).toEqual(['0s', 'auto'])
  })

  test('can be operated with the keyboard alone: arrow keys move within a group, Space and Enter act', async ({ page, isMobile }) => {
    test.skip(isMobile === true, 'keyboard use is for desktop browsers')
    await open(page)
    // Focus is placed directly: which controls Tab reaches differs by engine (Safari's default skips buttons and radios).
    await page.locator('input[name=preset][value=general]').focus()
    for (let i = 0; i < 5; i++) await page.keyboard.press('ArrowUp')
    await expect(page.getByRole('radio', { name: /Coding and data/ })).toBeChecked()
    await expect(page.locator('#notes-text')).toContainText('name: working-with-me')
    await page.getByRole('button', { name: /Programming/ }).first().focus()
    await page.keyboard.press('Enter')
    await expect(page.getByRole('group', { name: 'Programming' })).toBeVisible()
    await page.getByRole('group', { name: 'Programming' }).getByLabel(/Not sure/).focus()
    await page.keyboard.press('ArrowUp')
    await expect(page.getByRole('group', { name: 'Programming' }).getByLabel('I know this well')).toBeChecked()
    await expect(page.locator('#notes-text')).toContainText('Programming: skip the basics')
    await page.getByRole('checkbox', { name: /Plain text: no tables/ }).focus()
    await page.keyboard.press('Space')
    await expect(page.locator('#notes-text')).toContainText('Use plain text: no tables')
    await page.getByRole('button', { name: 'Copy the notes' }).focus()
    await page.keyboard.press('Enter')
    await expect(page.getByTestId('status')).toHaveText(COPY.copied)
  })

  test('is reachable step by step with Tab (Chromium)', async ({ page, isMobile, browserName }) => {
    test.skip(isMobile === true || browserName !== 'chromium', 'Tab reaches every control in Chromium; Safari needs Option+Tab by default')
    await open(page)
    const focused = (): Promise<string> =>
      page.evaluate(`(() => { const e = document.activeElement; if (!e) return ''; const l = e.labels && e.labels[0] ? e.labels[0].textContent : ''; return (e.tagName + ' ' + (e.textContent || l || e.getAttribute('aria-label') || '')).replace(/\\s+/g, ' ').trim() })()`) as Promise<string>
    const tabTo = async (match: RegExp, max = 250): Promise<void> => {
      for (let i = 0; i < max; i++) {
        await page.keyboard.press('Tab')
        if (match.test(await focused())) return
      }
      throw new Error(`never focused ${match}; last: ${await focused()}`)
    }
    // A radio group is one tab stop, at its checked radio; arrow keys move within it.
    await tabTo(/^INPUT General/)
    await tabTo(/BUTTON\s+\+?\s*(?:Arithmetic|Programming|Physics|History)/)
    await tabTo(/^INPUT (?:Short answers|No preference)/)
    await tabTo(/Copy the notes/)
    await page.keyboard.press('Enter')
    await expect(page.getByTestId('status')).toHaveText(COPY.copied)
  })
})

test.describe('copy and download (M1.22-style, WebKit and iOS included)', () => {
  test('copies exactly the previewed notes and announces it politely', async ({ page, context, browserName }) => {
    if (browserName === 'chromium') await context.grantPermissions(['clipboard-read', 'clipboard-write'])
    await open(page)
    const status = page.getByTestId('status')
    await expect(status).toHaveAttribute('role', 'status')
    await expect(status).toHaveAttribute('aria-live', 'polite')
    await page.getByRole('button', { name: 'Copy the notes' }).click()
    await expect(status).toHaveText(COPY.copied)
    if (browserName === 'chromium') {
      const clip = (await page.evaluate(`navigator.clipboard.readText()`)) as string
      expect(clip).toBe(await notesText(page))
    }
  })

  test('downloads a uniquely named file with the previewed bytes', async ({ page }) => {
    await open(page)
    const [download] = await Promise.all([page.waitForEvent('download'), page.getByRole('button', { name: /^Download hb-notes-/ }).click()])
    expect(download.suggestedFilename()).toMatch(/^hb-notes-\d{4}-\d{2}-[a-z0-9]{4}\.txt$/)
    const stream = await download.createReadStream()
    const chunks: Buffer[] = []
    for await (const c of stream) chunks.push(c as Buffer)
    const body = Buffer.concat(chunks).toString('utf8')
    expect(body).toBe(`${await notesText(page)}\n`)
    await expect(page.getByTestId('status')).toHaveText(`Downloaded ${download.suggestedFilename()}.`)
  })

  test('gives a coding agent a Skill file and commands that refuse to overwrite, with no "#" in any block', async ({ page }) => {
    await open(page)
    await page.getByRole('radio', { name: /Coding and data/ }).check()
    const name = (await page.getByTestId('file-name').innerText()).trim()
    expect(name).toMatch(/^hb-skill-\d{4}-\d{2}-[a-z0-9]{4}\.md$/)
    const posix = await page.getByTestId('install-commands').innerText()
    expect(posix).toContain(`[ -e ~/.claude/skills/working-with-me/SKILL.md ] && echo "A file with that name already exists; nothing was changed." || mv ~/Downloads/${name} ~/.claude/skills/working-with-me/SKILL.md`)
    expect(posix).not.toContain('#')
    await page.getByLabel('Windows (PowerShell)').check()
    const win = await page.getByTestId('install-commands').innerText()
    expect(win).toContain('Move-Item')
    expect(win).not.toContain('#')
    const [download] = await Promise.all([page.waitForEvent('download'), page.getByRole('button', { name: new RegExp(`^Download ${name}`) }).click()])
    expect(download.suggestedFilename()).toBe(name)
  })

  test('downloads the control-word card and for-ai.md', async ({ page }) => {
    await open(page)
    const [card] = await Promise.all([page.waitForEvent('download'), page.getByRole('button', { name: 'Download the card (SVG)' }).click()])
    expect(card.suggestedFilename()).toBe('hb-control-words.svg')
    const [doc] = await Promise.all([page.waitForEvent('download'), page.getByRole('button', { name: 'Download for-ai.md' }).click()])
    expect(doc.suggestedFilename()).toBe('for-ai.md')
  })
})

test.describe('local only (R-17.1, R-17.12)', () => {
  test('makes no network request after load, however much is done on the page', async ({ page }) => {
    const requests: string[] = []
    await page.goto(PAGE, { waitUntil: 'networkidle' })
    page.on('request', (r) => requests.push(`${r.method()} ${r.url()}`))
    await useEverything(page)
    await page.getByRole('button', { name: 'Copy the notes' }).click()
    await page.getByRole('button', { name: 'Add another set of notes' }).click()
    await page.getByRole('radio', { name: /Reading dense material/ }).check()
    const [download] = await Promise.all([page.waitForEvent('download'), page.getByRole('button', { name: /^Download hb-/ }).click()])
    await download.path()
    await page.getByRole('button', { name: 'Remove my notes settings' }).click()
    await page.waitForTimeout(300)
    expect(requests.filter((r) => !r.includes('blob:'))).toEqual([])
  })

  test('sends nothing to any other origin while loading', async ({ page }) => {
    const origins = new Set<string>()
    page.on('request', (r) => origins.add(new URL(r.url()).origin))
    await page.goto(PAGE, { waitUntil: 'networkidle' })
    expect([...origins].filter((o) => !o.startsWith('http://127.0.0.1') && o !== 'null')).toEqual([])
  })

  test('writes nothing to storage, cookies or caches, however much is typed or changed (the builder is storageless; the under-18 path writes nothing)', async ({ page }) => {
    await open(page)
    await useEverything(page)
    await page.getByRole('button', { name: 'Copy the notes' }).click()
    const snapshot = await page.evaluate(`(async () => ({
      local: localStorage.length,
      session: sessionStorage.length,
      cookie: document.cookie,
      databases: indexedDB.databases ? (await indexedDB.databases()).length : 0,
      caches: typeof caches === 'undefined' ? 0 : (await caches.keys()).length,
      workers: navigator.serviceWorker ? (await navigator.serviceWorker.getRegistrations()).length : 0,
    }))()`)
    expect(snapshot).toEqual({ local: 0, session: 0, cookie: '', databases: 0, caches: 0, workers: 0 })
    // and typed text is not in the page's storage-like places: the URL and the title
    expect(page.url()).not.toMatch(/chess|cooking|metric/)
    expect(await page.title()).not.toMatch(/chess|cooking|metric/)
  })
})

test.describe('the notes themselves', () => {
  test('write the person\'s settings as plain ASCII lines within the limit, with the fixed clauses first', async ({ page }) => {
    await open(page)
    await useEverything(page)
    const text = await notesText(page)
    expect(/^[\x20-\x7E\n]*$/.test(text)).toBe(true)
    expect(text.length).toBeLessThanOrEqual(5000)
    expect(text).toContain('- Programming: skip the basics and go straight to the method.')
    expect(text).toContain('- Statistics: start from a small concrete example')
    expect(text).toContain('- When you need an example, use chess or cooking.')
    expect(text).toContain('- Use metric units.')
    expect(text).not.toMatch(/https?:|www\./)
    const digits = text.match(/[0-9]+/g) ?? []
    expect(digits.every((d) => d.length === 4 || d.length === 2)).toBe(true)
  })
})
