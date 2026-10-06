/**
 * The leave-without-saving guard (DESIGN §10: the save file is "required before leaving; a
 * `beforeunload` warning is shown"; ROADMAP M1.R). While the person has not saved their results,
 * closing or reloading the tab asks the browser to confirm. Browsers show their own generic text
 * (a page cannot set it), and only after the page has had a user interaction, which the download
 * button itself provides.
 *
 * {@link installUnloadGuard} returns a function that removes the guard; it is idempotent. Nothing
 * else about the page changes, and the guard writes nothing (the under-18 path never reaches the
 * results anyway).
 */

/** The window surface the guard needs (the real `window`, or a test double). */
export interface UnloadTarget {
  addEventListener(type: 'beforeunload', listener: (event: BeforeUnloadEvent) => void): void
  removeEventListener(type: 'beforeunload', listener: (event: BeforeUnloadEvent) => void): void
}

/** The `beforeunload` handler: cancel the event and set the legacy return value, as browsers require. */
export function unloadHandler(event: BeforeUnloadEvent): void {
  event.preventDefault()
  event.returnValue = ''
}

/**
 * Ask the browser to confirm leaving until the returned function is called. Every call installs its own
 * listener: the session's run guard (`SessionApp.svelte`) and the results' guard (`Reveal.svelte`) overlap
 * for a moment when a run ends, and one shared listener would be added once (`addEventListener` ignores a
 * second add of the same function) and then removed by whichever guard is lifted first, leaving the other
 * guard standing in the page and doing nothing.
 */
export function installUnloadGuard(target: UnloadTarget = window): () => void {
  let on = true
  const listener = (event: BeforeUnloadEvent): void => unloadHandler(event)
  target.addEventListener('beforeunload', listener)
  return () => {
    if (!on) return
    on = false
    target.removeEventListener('beforeunload', listener)
  }
}
