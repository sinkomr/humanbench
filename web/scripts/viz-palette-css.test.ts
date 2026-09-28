/**
 * The blob palette's backgrounds are the page's (ROADMAP M1.16, DESIGN §9.8): its text contrast
 * is computed against `THEMES.<scheme>.bg`, so that must be `--bg` of app.css in both schemes.
 * (A Node test: vitest serves `.css?raw` as empty in the app's unit project.)
 */

import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { THEMES } from '../src/viz/palette'

describe('viz palette vs app.css (M1.16)', () => {
  it('uses the page backgrounds of app.css in light and dark', () => {
    const css = readFileSync(new URL('../src/app.css', import.meta.url), 'utf8')
    const bgs = [...css.matchAll(/--bg:\s*(#[0-9a-f]{6})/gi)].map((m) => m[1]!.toLowerCase())
    expect(bgs).toHaveLength(2)
    expect(THEMES.light.bg).toBe(bgs[0])
    expect(THEMES.dark.bg).toBe(bgs[1])
    expect(css.indexOf('prefers-color-scheme: dark')).toBeLessThan(css.lastIndexOf('--bg'))
  })
})
