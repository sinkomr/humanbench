/**
 * No key in the DOM (ROADMAP M1.13 acceptance; DESIGN §4.2, §12: "no key appears in the payload
 * beyond the geometry"; A18 option display order). For many generated instances of each visual
 * family, the renderer is mounted with the item's spec and its serialised DOM is scanned:
 *
 * - nothing item-level that is not in the spec appears: not the key's JSON, the item or family id,
 *   the seed, the sibling group, the structural params or the difficulty prior;
 * - no data-* attributes, no tabindex (focus order = DOM order = display order), no attribute name,
 *   id, class, name or value that speaks of keys, answers or correctness;
 * - the options are in `spec.options` order, none is pre-chosen, and each option's markup is the
 *   same for every option once its position (value, letter) and its content (its name and its
 *   figure, a pure function of that option's spec entry) are factored out, so no attribute can
 *   single out the key (no per-option marker whose value differs between the key and the
 *   distractors);
 * - the DOM is a function of the spec alone (a re-render of a copy is identical).
 */

import { afterEach, describe, expect, it, vi } from 'vitest'
import type { Component } from 'svelte'
import type { ItemInstance } from '../tasks/family'
import { matrices } from '../tasks/matrices'
import type { MatrixCell } from '../tasks/matrices/grammar'
import { rotation } from '../tasks/rotation'
import { optionLetter } from './choice/keys'
import { mountInto, stableHtml, type Mounted } from './dom-testing'
import { matrixOptionName } from './matrices/copy'
import MatrixCellSvg from './matrices/MatrixCellSvg.svelte'
import { optionAlt } from './rotation/copy'
import { visualRenderers } from './visual'

vi.mock('./rotation/three-view', () => ({
  acquirePainter: () => ({ paint: () => true, onRestored: () => {}, release: () => {} }),
}))

const N = 150

/** Words no renderer-made attribute may use. */
const HINT_WORDS = /key|correct|answer|solution|index|score|right_|wrong/i

const mounts: Mounted[] = []
/** Unmount everything mounted so far (per item, so the jsdom document stays small and fast). */
function cleanup(): void {
  for (const m of mounts.splice(0)) m.destroy()
}
afterEach(cleanup)

function mountSpec(component: Component<any>, spec: object): HTMLElement {
  const m = mountInto(component, { spec, onrespond: () => {} })
  mounts.push(m)
  return m.target
}

/** Item-level strings that are not render payload and must never reach the DOM. */
function secrets(item: ItemInstance<object, object>): string[] {
  return [
    JSON.stringify(item.key),
    item.item_id,
    item.family_id,
    item.sibling_group,
    item.seed,
    JSON.stringify(item.structural_params),
    String(item.difficulty.b_prior),
  ]
}

/** Every attribute value and text node under root, unescaped. */
function rawText(root: Element): string {
  const parts: string[] = [root.textContent ?? '']
  for (const el of root.querySelectorAll('*')) for (const a of el.attributes) parts.push(`${a.name}=${a.value}`)
  return parts.join('\n')
}

function scanCommon(item: ItemInstance<object, object>, root: HTMLElement): string[] {
  const out: string[] = []
  const html = root.innerHTML
  const raw = rawText(root)
  for (const s of secrets(item)) if (html.includes(s) || raw.includes(s)) out.push(`item-level value in the DOM: ${s}`)
  for (const el of root.querySelectorAll('*')) {
    for (const a of el.attributes) {
      if (a.name.startsWith('data-')) out.push(`data attribute ${a.name} on <${el.localName}>`)
      if (a.name === 'tabindex') out.push(`tabindex on <${el.localName}>`)
      if (HINT_WORDS.test(a.name)) out.push(`attribute name ${a.name}`)
      if (['id', 'class', 'name', 'value', 'for', 'role', 'style'].includes(a.name) && HINT_WORDS.test(a.value)) out.push(`${a.name}="${a.value}" on <${el.localName}>`)
    }
  }
  return out
}

/** Markup without Svelte's empty comment anchors (they depend on where a component is mounted). */
const stripAnchors = (html: string): string => html.replace(/<!---->/g, '')

interface OptionView {
  readonly name: string
  readonly letter: string
  readonly figure: string
  /** The label's markup with position and content replaced by placeholders. */
  readonly fingerprint: string
}

function optionViews(root: HTMLElement): OptionView[] {
  return [...root.querySelectorAll('label')].map((label) => {
    const clone = label.cloneNode(true) as HTMLElement
    const input = clone.querySelector('input')
    const letter = clone.querySelector('.letter')
    const figure = clone.querySelector('.figure')
    if (!input || !letter || !figure) throw new Error('option markup changed: update the leak test')
    const view = { name: input.getAttribute('aria-label') ?? '', letter: letter.textContent ?? '', figure: figure.innerHTML, value: input.getAttribute('value') }
    input.setAttribute('aria-label', '(name)')
    input.setAttribute('value', '(position)')
    input.setAttribute('name', '(group)')
    letter.textContent = '(letter)'
    figure.innerHTML = '(figure)'
    return { name: view.name, letter: view.letter, figure: view.figure, fingerprint: `${view.value}|${clone.outerHTML}` }
  })
}

/** Checks the options against the spec; `expected(i)` is option i's name and figure markup. */
function scanOptions(root: HTMLElement, count: number, expected: (i: number) => { name: string; figure: string }): string[] {
  const out: string[] = []
  const views = optionViews(root)
  if (views.length !== count) return [`${views.length} options rendered, spec has ${count}`]
  const inputs = [...root.querySelectorAll('input')]
  if (inputs.some((x) => x.checked || x.hasAttribute('checked'))) out.push('an option is pre-chosen')
  const shapes = new Set<string>()
  views.forEach((v, i) => {
    const want = expected(i)
    if (v.name !== want.name) out.push(`option ${i} is named ${JSON.stringify(v.name)}, expected ${JSON.stringify(want.name)} (display order)`)
    if (v.letter !== optionLetter(i)) out.push(`option ${i} shows letter ${v.letter}`)
    if (stripAnchors(v.figure) !== stripAnchors(want.figure)) out.push(`option ${i}'s figure is not a pure function of spec.options[${i}]`)
    const [value, markup] = v.fingerprint.split('|')
    if (value !== String(i)) out.push(`option ${i} has value ${String(value)}`)
    shapes.add(markup as string)
  })
  if (shapes.size !== 1) out.push(`options differ in markup beyond position and content:\n${[...shapes].join('\n')}`)
  return out
}

/** Standalone markup of a decorative matrix cell (what an option's figure must be). */
function cellMarkup(cell: MatrixCell): string {
  const m = mountInto(MatrixCellSvg, { cell })
  const html = m.target.innerHTML
  m.destroy()
  return html
}

describe('no key or correctness hint in the renderers’ DOM (M1.13)', () => {
  it(`rotation: ${N} generated items`, () => {
    const problems: string[] = []
    for (let s = 0; s < N; s++) {
      const item = rotation.generate(`leak-rotation-${s}`)
      const root = mountSpec(visualRenderers.rotation, item.spec)
      const n = item.spec.target.cubes.length
      problems.push(...scanCommon(item, root).map((p) => `${item.item_id}: ${p}`))
      const figures = [...root.querySelectorAll('label .figure')].map((f) => f.innerHTML)
      problems.push(
        ...scanOptions(root, item.spec.options.length, (i) => ({
          name: optionAlt(optionLetter(i), n),
          // A canvas whose fallback text is the option's name: identical up to the letter.
          figure: (figures[0] ?? '').replace(optionAlt('A', n), optionAlt(optionLetter(i), n)),
        })).map((p) => `${item.item_id}: ${p}`),
      )
      const again = mountSpec(visualRenderers.rotation, structuredClone(item.spec))
      if (stableHtml(again) !== stableHtml(root)) problems.push(`${item.item_id}: DOM is not a function of the spec`)
      cleanup()
    }
    expect(problems).toEqual([])
  })

  it(`matrices: ${N} generated items`, () => {
    const problems: string[] = []
    for (let s = 0; s < N; s++) {
      const item = matrices.generate(`leak-matrices-${s}`)
      const root = mountSpec(visualRenderers.matrices, item.spec)
      problems.push(...scanCommon(item, root).map((p) => `${item.item_id}: ${p}`))
      problems.push(
        ...scanOptions(root, item.spec.options.length, (i) => {
          const cell = item.spec.options[i] as MatrixCell
          return { name: matrixOptionName(optionLetter(i), cell), figure: cellMarkup(cell) }
        }).map((p) => `${item.item_id}: ${p}`),
      )
      const again = mountSpec(visualRenderers.matrices, structuredClone(item.spec))
      if (stableHtml(again) !== stableHtml(root)) problems.push(`${item.item_id}: DOM is not a function of the spec`)
      cleanup()
    }
    expect(problems).toEqual([])
  })

  it('the scan catches planted leaks (so a pass is not vacuous)', () => {
    const item = matrices.generate('leak-plant-1')
    const root = mountSpec(visualRenderers.matrices, item.spec)
    const k = item.key.index
    const labels = [...root.querySelectorAll('label')]
    expect(scanCommon(item, root)).toEqual([])
    // A per-option marker on the key only.
    labels[k]?.querySelector('input')?.setAttribute('aria-describedby', 'x')
    expect(scanOptions(root, 6, (i) => ({ name: matrixOptionName(optionLetter(i), item.spec.options[i] as MatrixCell), figure: cellMarkup(item.spec.options[i] as MatrixCell) })).join('\n')).toMatch(
      /differ in markup/,
    )
    labels[k]?.querySelector('input')?.removeAttribute('aria-describedby')
    // A data attribute, a telling class, and the key's JSON.
    labels[k]?.setAttribute('data-k', '1')
    labels[0]?.classList.add('is-correct')
    root.append(document.createTextNode(JSON.stringify(item.key)))
    const found = scanCommon(item, root).join('\n')
    expect(found).toMatch(/data attribute data-k/)
    expect(found).toMatch(/is-correct/)
    expect(found).toMatch(/item-level value/)
  })
})
