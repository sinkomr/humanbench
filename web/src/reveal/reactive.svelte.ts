/**
 * Test-only (ROADMAP M1.R): props a test can change after mounting, so a component's reaction to a
 * changed prop is tested (Svelte 5 needs a rune for that, which only a `.svelte.ts` module may use).
 * Never imported by the app.
 */

export function reactiveProps<T extends object>(initial: T): T {
  const props = $state(initial)
  return props
}
