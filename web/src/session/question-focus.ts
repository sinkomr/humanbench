/**
 * Where focus goes when a screen of the running session appears (UX-REVIEW D21, a provisional default,
 * option B; DESIGN §13; WCAG 2.4.3 focus order, 4.1.3 status messages).
 *
 * Every new question used to re-focus the same heading, the name of the part: a screen-reader user heard
 * "Matrix & Series, heading level 1" about sixty times in a session and had to infer from what followed that
 * it was a new question. Now the heading takes focus on the first question of a part, and on every screen
 * that is not a question (an "Up next" screen, a block, the break, the end), as before; on a later question of
 * the same part focus goes to the question's own labelled region ("Question 3"), which is a script target
 * (`tabindex="-1"`) and not a stop of its own, so the first Tab from it still reaches the answer field.
 *
 * `SessionScreen.svelte` asks {@link QuestionFocus.enter} once per screen key; the answer says where the
 * new `Screen` puts focus, and which number the question's region carries. The number counts the questions
 * shown in the part so far, and says nothing about how many there will be (progress is time, §10).
 */

import type { RunPhase } from './run'

/** `heading`: the screen's h1; `item`: the labelled region of the question; `none`: neither (the question is only being fetched). */
export type FocusTarget = 'heading' | 'item' | 'none'

/** What the plan needs to know about the screen that is about to be shown. */
export interface ScreenFacts {
  readonly phase: RunPhase
  readonly segmentIndex: number
  /** The wait for a served question has failed (the screen says so and offers "Try again"). */
  readonly problem: boolean
}

export interface FocusPlan {
  readonly target: FocusTarget
  /** For a question: its place among the questions shown in this part (1 for the first). Otherwise 0. */
  readonly number: number
}

const HEADING: FocusPlan = Object.freeze({ target: 'heading', number: 0 })
const WAITING: FocusPlan = Object.freeze({ target: 'none', number: 0 })

/** The accessible name of a question's region. No total: the part has no fixed number of questions. */
export function itemRegionName(number: number): string {
  return `Question ${number}`
}

/** One per session screen component: remembers which part the last question belonged to. */
export class QuestionFocus {
  #key: string | null = null
  #plan: FocusPlan = HEADING
  /** The part of the last question shown, or -1 when a screen that is not part of the question flow has come since. */
  #part = -1
  #count = 0

  /**
   * The plan for the screen with this key. Asking again for the same key returns the same plan (the confidence
   * slider is the same screen as the question it rates), so it is safe to call from a derived value.
   */
  enter(key: string, screen: ScreenFacts): FocusPlan {
    if (key === this.#key) return this.#plan
    this.#key = key
    this.#plan = this.#decide(screen)
    return this.#plan
  }

  #decide(screen: ScreenFacts): FocusPlan {
    if (screen.phase === 'item' || screen.phase === 'confidence') {
      const later = screen.segmentIndex === this.#part
      this.#part = screen.segmentIndex
      this.#count = later ? this.#count + 1 : 1
      return { target: later ? 'item' : 'heading', number: this.#count }
    }
    // Waiting for the next served question of the part that is under way: not a screen of its own to arrive at.
    // The question that follows takes focus; a wait that failed is a screen to be told about, so it takes the heading.
    if (screen.phase === 'loading') return !screen.problem && screen.segmentIndex === this.#part ? WAITING : HEADING
    this.#part = -1
    return HEADING
  }
}
