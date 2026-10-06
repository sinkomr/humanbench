/**
 * The tab title of a screen (ROADMAP M1.21; WCAG 2.4.2): the welcome screen is just "HumanBench", every
 * other screen names itself first ("Honour code · HumanBench"), so a tab or a history list tells where
 * the person is. `Screen.svelte` sets it when a screen appears; the app shell sets it again when the
 * privacy notice is closed and the flow, which stayed mounted, is shown again.
 */

import { HEADING } from '../copy'

export function pageTitle(screenTitle: string): string {
  const t = screenTitle.trim()
  return t === '' || t === HEADING ? HEADING : `${t} · ${HEADING}`
}
