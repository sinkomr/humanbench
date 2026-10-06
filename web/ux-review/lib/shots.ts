/**
 * Evidence files of a UX review run: screenshots, page text, accessibility trees and JSON, written
 * under web/test-results/ux-review/<runId>/<sub>/ (gitignored). Every method returns the path relative to
 * the repo root (what a finding lists under `screenshots`) and never throws: a page that closed mid-run
 * is logged and answered with ''.
 */

import { mkdirSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import type { Locator, Page } from '@playwright/test'

/** The web/ directory. */
export const WEB_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..')
/** The repo root (the parent of web/): the paths the harness hands out are relative to it. */
export const REPO_ROOT = path.resolve(WEB_ROOT, '..')
/** Where every run writes: web/test-results/ux-review. */
export const UX_ROOT = path.join(WEB_ROOT, 'test-results', 'ux-review')

/** A file name part: lower-case letters, digits and single hyphens (never empty). */
export function slug(name: string): string {
  const s = name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60)
    .replace(/-+$/g, '')
  return s === '' ? 'shot' : s
}

/** Path of an absolute file relative to the repo root, with forward slashes. */
export function repoRel(abs: string): string {
  return path.relative(REPO_ROOT, abs).split(path.sep).join('/')
}

export interface ShotOptions {
  /** Whole page (default) or just the viewport. */
  readonly fullPage?: boolean
  /** Only this element. */
  readonly locator?: Locator
}

/** Write a PNG to `abs`; a page too tall for a full-page capture falls back to the viewport. Never throws; '' on failure. */
export async function savePng(page: Page, abs: string, opts: ShotOptions = {}): Promise<string> {
  try {
    mkdirSync(path.dirname(abs), { recursive: true })
    if (opts.locator !== undefined) {
      await opts.locator.screenshot({ path: abs, timeout: 20_000 })
    } else {
      try {
        await page.screenshot({ path: abs, fullPage: opts.fullPage ?? true, timeout: 20_000 })
      } catch (error) {
        if (opts.fullPage === false || page.isClosed()) throw error
        await page.screenshot({ path: abs, fullPage: false, timeout: 20_000 })
        console.log(`[shots] full-page capture of ${repoRel(abs)} failed (${message(error)}); saved the viewport instead`)
      }
    }
    return repoRel(abs)
  } catch (error) {
    console.log(`[shots] could not write ${repoRel(abs)}: ${message(error)}`)
    return ''
  }
}

/** Write text to `abs`. Never throws; '' on failure. */
export function saveText(abs: string, text: string): string {
  try {
    mkdirSync(path.dirname(abs), { recursive: true })
    writeFileSync(abs, text.endsWith('\n') ? text : `${text}\n`)
    return repoRel(abs)
  } catch (error) {
    console.log(`[shots] could not write ${repoRel(abs)}: ${message(error)}`)
    return ''
  }
}

function message(error: unknown): string {
  return (error instanceof Error ? error.message : String(error)).split('\n')[0]?.slice(0, 200) ?? ''
}

export interface AllShots {
  readonly png: string
  readonly txt: string
  readonly aria: string
}

export class Shots {
  /** The directory this instance writes to (absolute). */
  readonly dir: string
  #n = 0

  /**
   * One instance per `<runId>/<sub>` directory (the counter starts at 1, so a second instance on the same
   * directory overwrites the first one's files). `sub` defaults to 'shots'.
   */
  constructor(
    readonly page: Page,
    readonly runId: string,
    readonly sub = 'shots',
  ) {
    this.dir = path.join(UX_ROOT, runId, sub)
  }

  /** The counter prefix of the next file ('001'). */
  #next(): string {
    this.#n += 1
    return String(this.#n).padStart(3, '0')
  }

  #file(prefix: string, name: string, ext: string): string {
    return path.join(this.dir, `${prefix}-${slug(name)}${ext}`)
  }

  /** `<NNN>-<name>.png`: the whole page unless `fullPage: false`, or one element with `locator`. */
  async shot(name: string, opts: ShotOptions = {}): Promise<string> {
    return savePng(this.page, this.#file(this.#next(), name, '.png'), opts)
  }

  /** `<NNN>-<name>.txt`: the page's rendered text (body innerText). */
  async text(name: string): Promise<string> {
    return this.#text(this.#next(), name)
  }

  /** `<NNN>-<name>.aria.yml`: the accessibility tree of the body, as a screen reader gets it. */
  async aria(name: string): Promise<string> {
    return this.#aria(this.#next(), name)
  }

  /** `<NNN>-<name>.json` (or `<name>.json` with `counter: false`). */
  json(name: string, data: unknown, opts: { readonly counter?: boolean } = {}): string {
    const prefix = opts.counter === false ? '' : `${this.#next()}-`
    const file = path.join(this.dir, `${prefix}${slug(name)}.json`)
    try {
      return saveText(file, JSON.stringify(data, null, 2))
    } catch (error) {
      console.log(`[shots] could not serialise ${repoRel(file)}: ${message(error)}`)
      return ''
    }
  }

  /** The three of them under one counter number: png, txt and aria. */
  async all(name: string): Promise<AllShots> {
    const prefix = this.#next()
    const png = await savePng(this.page, this.#file(prefix, name, '.png'))
    const txt = await this.#text(prefix, name)
    const aria = await this.#aria(prefix, name)
    return { png, txt, aria }
  }

  async #text(prefix: string, name: string): Promise<string> {
    try {
      return saveText(this.#file(prefix, name, '.txt'), await this.page.locator('body').innerText({ timeout: 10_000 }))
    } catch (error) {
      console.log(`[shots] could not read the text of "${name}": ${message(error)}`)
      return ''
    }
  }

  async #aria(prefix: string, name: string): Promise<string> {
    try {
      return saveText(this.#file(prefix, name, '.aria.yml'), await this.page.locator('body').ariaSnapshot({ timeout: 10_000 }))
    } catch (error) {
      console.log(`[shots] could not read the accessibility tree of "${name}": ${message(error)}`)
      return ''
    }
  }
}
