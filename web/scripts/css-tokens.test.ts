/**
 * The CSS reader behind the contrast test (`css-tokens.ts`, `contrast.test.ts`; ROADMAP M1.21) on small
 * sheets of its own: what it reads as a colour, and that the ways a low-contrast colour could slip past the
 * contrast test (a name, `rgb()`, a token in a rule nobody listed, a colour set inline) are all seen.
 */

import { describe, expect, it } from 'vitest'
import { colourTokenDecls, colourToHex, colourWords, customPropertyDecls, inlineColours, literalColoursIn, parseBlocks, resolveColour } from './css-tokens'

const sheet = (css: string, file = 'src/x.css') => customPropertyDecls(file, parseBlocks(css))

describe('colourToHex: hex, opaque rgb() and hsl()', () => {
  it('reads each way of writing the same colour', () => {
    expect(colourToHex('#ABC')).toBe('#aabbcc')
    expect(colourToHex('rgb(204, 204, 204)')).toBe('#cccccc')
    expect(colourToHex('rgba(204,204,204,1)')).toBe('#cccccc')
    expect(colourToHex('rgb(204 204 204 / 100%)')).toBe('#cccccc')
    expect(colourToHex('rgb(80% 80% 80%)')).toBe('#cccccc')
    expect(colourToHex('hsl(0, 0%, 80%)')).toBe('#cccccc')
    expect(colourToHex('hsl(210deg 100% 50%)')).toBe('#0080ff')
    expect(colourToHex('hsl(120, 100%, 25%)')).toBe('#008000')
  })

  it('does not read a translucent colour, a name or another colour function', () => {
    for (const v of ['rgba(0,0,0,0.5)', 'rgb(0 0 0 / 50%)', 'lightgray', 'oklch(0.8 0 0)', 'color-mix(in srgb, #000, #fff)', 'rgb(1, 2)', 'transparent']) expect(colourToHex(v), v).toBeNull()
  })

  it('follows var() through an environment, and its fallback', () => {
    const env = { '--a': 'var(--b)', '--b': 'rgb(0, 0, 0)' }
    expect(resolveColour('var(--a)', env)).toBe('#000000')
    expect(resolveColour('var(--missing, #fff)', env)).toBe('#ffffff')
    expect(resolveColour('var(--missing)', env)).toBeNull()
    expect(resolveColour('1px solid', env)).toBeNull()
  })
})

describe('colourWords: the colours a declaration value writes', () => {
  it('finds hex, functions and names, and skips what is behind var(), url() and strings', () => {
    expect(colourWords('2px solid #767676', true)).toEqual(['#767676'])
    expect(colourWords('rgb(204, 204, 204)', true)).toEqual(['#cccccc'])
    expect(colourWords('rgba(0, 0, 0, 0.4)', true)).toEqual(['rgba(0, 0, 0, 0.4)'])
    expect(colourWords('oklch(0.8 0.1 200)', true)).toEqual(['oklch(0.8 0.1 200)'])
    expect(colourWords('linear-gradient(red, #00f)', true)).toEqual(['#0000ff', 'red'])
    expect(colourWords('0 0 0 3px lightgray', true)).toEqual(['lightgray'])
    expect(colourWords('var(--text, #3d3a44)', true)).toEqual([])
    expect(colourWords('var(--a, var(--b, red))', true)).toEqual([])
    expect(colourWords('url(#red) "blue"', true)).toEqual([])
    expect(colourWords('transparent currentColor inherit none', true)).toEqual([])
  })

  it('reads a name only where the property takes a colour (tan and peru are words too)', () => {
    expect(colourWords('tan', false)).toEqual([])
    expect(colourWords('1px solid ease-out 120ms', true)).toEqual([])
  })
})

describe('literalColoursIn: colours written into a declaration', () => {
  const lits = (css: string) => literalColoursIn(parseBlocks(css)).map((l) => `${l.prop} ${l.value}`)

  it('sees hex, rgb(), hsl() and names in colour properties, in dark blocks too', () => {
    expect(lits('.a { color: #EEEEEE; background: rgb(204,204,204); border: 1px solid lightgray }')).toEqual(['color #eeeeee', 'background #cccccc', 'border lightgray'])
    expect(lits('@media (prefers-color-scheme: dark) { .a { fill: hsl(0, 0%, 80%) } }')).toEqual(['fill #cccccc'])
  })

  it('does not count a custom property definition, a var() fallback, or a name in a property that takes none', () => {
    expect(lits(':root { --x: #eee } .a { color: var(--x, #eee); font-family: tan; list-style: none }')).toEqual([])
  })
})

describe('colourTokenDecls: the custom properties that hold a colour', () => {
  const colours = (css: string) => colourTokenDecls(sheet(css)).map((d) => `${d.selector} ${d.name}`)

  it('finds a token written as hex, rgb(), a name or oklch(), in any rule and any at-rule', () => {
    expect(colours('.mut { --s-faint: #eee; --gap: 1rem } :root { --r-new: rgb(204,204,204) } .b { --c: lightgray } .c { --d: oklch(0.9 0 0) }')).toEqual(['.mut --s-faint', ':root --r-new', '.b --c', '.c --d'])
    expect(colours('@media (prefers-color-scheme: dark) { .x { --y: #111 } } @media (min-width: 40rem) { .z { --w: #222 } }')).toEqual(['.x --y', '.z --w'])
  })

  it('follows a token that is another colour token through var()', () => {
    expect(colours(':root { --faint: #eee } .a { --s-faint: var(--faint) } .b { --pad: var(--gap) } .c { --d: var(--s-faint, #000) }')).toEqual([':root --faint', '.a --s-faint', '.c --d'])
  })

  it('skips keyframes and font faces, which declare no tokens', () => {
    expect(colours('@keyframes k { from { --x: #eee } } @font-face { font-family: a }')).toEqual([])
  })
})

describe('inlineColours: colours set outside the stylesheets', () => {
  it('finds a style attribute, a style: directive and a literal paint attribute in a template', () => {
    const svelte = `<script lang="ts">let c = 'red'</script>
<p class="lead" style="color: #eeeeee; margin: 0">Hello</p>
<div style:background-color="rgb(204, 204, 204)" style:left={pct(1)}></div>
<svg><rect fill="red" stroke="none" /><circle fill={PAPER} /><path stroke="currentColor" fill="url(#h)" /></svg>
<style>.a { color: red }</style>`
    expect(inlineColours(svelte, true)).toEqual(['style attribute: color #eeeeee', 'style directive: background-color #cccccc', 'attribute: fill red'])
  })

  it('finds an assignment to element.style in script', () => {
    const ts = `el.style.display = 'none'
el.style.backgroundColor = '#eee'
box.style.cssText = 'position:fixed;color:lightgray;opacity:0'
el.style.setProperty('border-color', "rgb(0, 0, 0)")`
    expect(inlineColours(ts, false)).toEqual(['element style: background-color #eeeeee', 'cssText: color lightgray', 'setProperty: border-color #000000'])
  })

  it('leaves custom properties, layout and tokens alone', () => {
    const svelte = `<div style:--narrow={String(1)} style="color: var(--text, #333); --x: 1"></div><span style:left="50%"></span>`
    expect(inlineColours(svelte, true)).toEqual([])
  })
})
