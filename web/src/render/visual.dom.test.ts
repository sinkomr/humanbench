/**
 * The visual renderer map and its contract with the families (ROADMAP M1.13, A18 contract v2):
 * every renderer takes the family's spec type and nothing item-level, and emits exactly the
 * response type the family's `score()` accepts. Checked at the type level (svelte-check compiles
 * this file: a mismatch makes the `true` literals below type errors) and at run time (every
 * option position, emitted by the real component, is a response `score()` accepts and scores
 * against the key).
 */

import type { Component, ComponentProps } from 'svelte'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { ItemInstance } from '../tasks/family'
import { FAMILY_NAMES, getFamily } from '../tasks/registry'
import { matrices } from '../tasks/matrices'
import { rotation } from '../tasks/rotation'
import { CONFIRM_LABEL } from './choice/keys'
import { click, mountInto, optionInputs, type Mounted } from './dom-testing'
import MatrixRenderer from './matrices/MatrixRenderer.svelte'
import RotationRenderer from './rotation/RotationRenderer.svelte'
import { VISUAL_RENDERERS, visualRenderers, type ItemRendererProps } from './visual'

vi.mock('./rotation/three-view', () => ({
  acquirePainter: () => ({ paint: () => true, onRestored: () => {}, release: () => {} }),
}))

// --- type-level contract ------------------------------------------------------------------------

type Equal<A, B> = (<T>() => T extends A ? 1 : 2) extends <T>() => T extends B ? 1 : 2 ? true : false
type ResponseOf<C> = C extends Component<infer P> ? (P extends { onrespond: (response: infer R) => void } ? R : never) : never
type SpecOf<C> = C extends Component<infer P> ? (P extends { spec: infer S } ? S : never) : never
type ScoreResponse<F> = F extends { score(item: never, response: infer R): unknown } ? R : never
type FamilySpec<F> = F extends { generate(seed: string): ItemInstance<infer S, object> } ? S : never

// The response each renderer emits is exactly what the family's score() takes…
const rotationResponse: Equal<ResponseOf<typeof RotationRenderer>, ScoreResponse<typeof rotation>> = true
const matricesResponse: Equal<ResponseOf<typeof MatrixRenderer>, ScoreResponse<typeof matrices>> = true
// …it takes exactly the family's spec type…
const rotationSpec: Equal<SpecOf<typeof RotationRenderer>, FamilySpec<typeof rotation>> = true
const matricesSpec: Equal<SpecOf<typeof MatrixRenderer>, FamilySpec<typeof matrices>> = true
// …and its props are the shared renderer props: no key, item, params or difficulty prop.
type PropNames = 'spec' | 'onrespond' | 'onshown' | 'disabled'
const rotationProps: Equal<keyof ComponentProps<typeof RotationRenderer>, PropNames> = true
const matricesProps: Equal<keyof ComponentProps<typeof MatrixRenderer>, PropNames> = true
const sharedProps: Equal<keyof ItemRendererProps<unknown, unknown>, PropNames> = true
const rotationFits: ComponentProps<typeof RotationRenderer> extends ItemRendererProps<FamilySpec<typeof rotation>, ScoreResponse<typeof rotation>> ? true : false = true
const matricesFits: ComponentProps<typeof MatrixRenderer> extends ItemRendererProps<FamilySpec<typeof matrices>, ScoreResponse<typeof matrices>> ? true : false = true

// --- run time -----------------------------------------------------------------------------------

let mounted: Mounted | undefined
afterEach(() => {
  mounted?.destroy()
  mounted = undefined
})

/** Mount, pick option `i` by pointer, confirm; returns what onrespond received. */
function respondWith(component: Component<any>, spec: object, i: number): unknown[] {
  const onrespond = vi.fn()
  mounted = mountInto(component, { spec, onrespond })
  click(optionInputs(mounted.target)[i] as HTMLInputElement)
  const confirm = [...mounted.target.querySelectorAll('button')].find((b) => b.textContent?.trim() === CONFIRM_LABEL) as HTMLButtonElement
  click(confirm)
  mounted.destroy()
  mounted = undefined
  return onrespond.mock.calls.map((c) => c[0])
}

describe('visual renderer map (M1.13)', () => {
  it('holds the rotation and matrices renderers under their registered family names', () => {
    expect([rotationResponse, matricesResponse, rotationSpec, matricesSpec, rotationProps, matricesProps, sharedProps, rotationFits, matricesFits]).not.toContain(false)
    expect(Object.keys(VISUAL_RENDERERS).sort()).toEqual(['matrices', 'rotation'])
    for (const name of Object.keys(VISUAL_RENDERERS)) {
      expect(FAMILY_NAMES as readonly string[]).toContain(name)
      expect(getFamily(name)?.kind).toBe('item')
    }
    expect(VISUAL_RENDERERS.rotation).toBe(RotationRenderer)
    expect(VISUAL_RENDERERS.matrices).toBe(MatrixRenderer)
    expect(Object.isFrozen(visualRenderers)).toBe(true)
  })

  for (const name of ['rotation', 'matrices'] as const) {
    it(`${name}: every option position it emits is a response score() accepts, correct exactly at the key`, () => {
      const family = name === 'rotation' ? rotation : matrices
      for (let s = 0; s < 8; s++) {
        const item = family.generate(`contract-${name}-${s}`) as ItemInstance<object, { index: number }>
        const k = item.options_count as number
        for (let i = 0; i < k; i++) {
          const responses = respondWith(visualRenderers[name], item.spec, i)
          expect(responses).toEqual([i])
          const score = (family.score as (it: typeof item, r: unknown) => { correct: 0 | 1 | null })(item, responses[0])
          expect(score.correct).toBe(i === item.key.index ? 1 : 0)
        }
      }
    })
  }
})
