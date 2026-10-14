/**
 * A place for the session's controls inside a renderer's answer form (owner decision 2026-10-13; DESIGN §3
 * row 12, §13): the optional confidence scale sits just above the question's own submit button, so one press
 * of that button sends the answer and, if it was set, the confidence. No extra step and no second button.
 *
 * The session screen (and the practice screen) put a snippet in the component context with
 * {@link setAnswerSlot}; the renderers that submit a counted answer (`choice/OptionGroup.svelte`,
 * `common/NumericEntry.svelte`, `text/TextChoiceRenderer.svelte`) render it with {@link getAnswerSlot} right
 * before their submit button, inside their form. Outside a session (the dev galleries, the review page)
 * there is no slot and the renderers draw as before. The slot carries no item data: the renderer contract
 * (`visual.ts`, `props.ts`: the spec and never the key) is unchanged.
 *
 * A control in the slot is inside the renderer's form, so it must keep the renderer's own keys to itself
 * (an option key typed in it must not choose an answer) and may submit the form with Enter
 * ({@link submitClosestForm}).
 */

import { getContext, setContext, type Snippet } from 'svelte'

const KEY = Symbol('hb-answer-slot')

/** What a renderer draws before its submit button; `get` reads it when drawn, so it may change with the screen. */
export interface AnswerSlot {
  readonly snippet: Snippet | null
}

/** Called by a screen during its initialisation: its descendants' renderers draw `slot.snippet`. */
export function setAnswerSlot(slot: AnswerSlot): void {
  setContext(KEY, slot)
}

/** Called by a renderer during its initialisation: the slot of the screen around it, or null. */
export function getAnswerSlot(): AnswerSlot | null {
  return getContext<AnswerSlot | undefined>(KEY) ?? null
}

/** Submits the form around `el` as its submit button would (its submit handler runs); false when there is none. */
export function submitClosestForm(el: Element): boolean {
  const form = el.closest('form')
  if (form === null) return false
  if (typeof form.requestSubmit === 'function') form.requestSubmit()
  else form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }))
  return true
}
