/** The leak-scan helpers catch what they are meant to (ROADMAP M1.13; `leak.ts`). */

import { describe, expect, it } from 'vitest'
import { attributeProblems, containsWhole, normalizeIds, optionSignature, tokensOf } from './leak'

function dom(html: string): HTMLElement {
  const d = document.createElement('div')
  d.innerHTML = html
  return d
}

describe('leak helpers', () => {
  it('attributeProblems flags data-* attributes and attributes naming an answer', () => {
    expect(attributeProblems(dom('<p class="stem" aria-label="Block 1">x</p><button class="keypad key">1</button>'))).toEqual([])
    for (const bad of ['<li data-i="2">', '<li class="option is-correct">', '<li aria-label="the answer">', '<b id="keyIndex">', '<i class="rightOption">', '<i title="Expected: 4">', '<i correct="1">']) {
      expect(attributeProblems(dom(`${bad}x</${bad.slice(1, 3).trim()}>`)).length, bad).toBeGreaterThan(0)
    }
  })

  it('normalizeIds replaces generated ids everywhere they are referenced', () => {
    const a = dom('<label for="c12-in">x</label><input id="c12-in" aria-describedby="c12-hint c12-note"><p id="c12-hint"></p>')
    const b = dom('<label for="c7-in">x</label><input id="c7-in" aria-describedby="c7-hint c7-note"><p id="c7-hint"></p>')
    expect(normalizeIds(a)).toBe(normalizeIds(b))
    expect(normalizeIds(a)).not.toMatch(/c12/)
  })

  it('tokens and whole-form matching', () => {
    expect(tokensOf('−48, 3/8 and K!')).toEqual(['48', '3', '8', 'and', 'K'])
    expect(containsWhole('the value 3/8 here', '3/8')).toBe(true)
    expect(containsWhole('13/8', '3/8')).toBe(false)
    expect(containsWhole('4.5', '4')).toBe(false)
    expect(containsWhole('costs 4.', '4')).toBe(true)
  })

  it('optionSignature erases the position and text only', () => {
    const a = dom('<label class="option"><input type="radio" value="0"> Alpha</label>').firstElementChild as Element
    const b = dom('<label class="option"><input type="radio" value="1"> Beta</label>').firstElementChild as Element
    const c = dom('<label class="option picked"><input type="radio" value="2"> Gamma</label>').firstElementChild as Element
    expect(optionSignature(a, 0)).toBe(optionSignature(b, 1))
    expect(optionSignature(c, 2)).not.toBe(optionSignature(a, 0))
  })
})
