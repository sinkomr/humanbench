/**
 * The optional outside scoring service of the unusual-uses task (ROADMAP M6.4; DESIGN §5.4: "optionally call the free
 * Ocsai API at openscoring.du.edu with user consent (text leaves the site)"). It is a STUB and it is OFF.
 *
 * - {@link OCSAI_ENABLED} is the constant `false`. Nothing builds or ships with it on: turning it on is a separate, owner-led
 *   change (a privacy review of what leaves the device, the page's privacy notice, and the request code), not a flag to flip.
 * - {@link requestOcsaiScores} rejects with an {@link OcsaiDisabledError}. This file has no network API at all (no `fetch`,
 *   no XHR, no beacon, no socket): `ocsai.test.ts` scans every source under `tasks/aut` and `render/aut` for them, so the day
 *   a request is written the test fails and the change is seen.
 * - The consent state ({@link OcsaiConsent}) starts and stays 'off' until a person turns it on, in an opt-in flow
 *   (`render/aut/OcsaiConsent.svelte`) that exists behind the flag and is never reachable while the flag is false.
 *
 * Privacy (DESIGN §8): the default scorer runs on the device (`minilm.ts`); only this service would send text out.
 */

/** Whether the outside service can be offered at all. A literal `false`: no build turns it on. */
export const OCSAI_ENABLED = false as const

/** Whether a person agreed to send their ideas to the outside service: 'off' until they do. */
export type OcsaiConsent = 'off' | 'on'

/** The consent every round starts with. */
export const OCSAI_CONSENT_DEFAULT: OcsaiConsent = 'off'

/** Thrown by {@link requestOcsaiScores} while the service is not offered. */
export class OcsaiDisabledError extends Error {
  constructor(message = 'The outside scoring service is not offered.') {
    super(message)
    this.name = 'OcsaiDisabledError'
  }
}

/** True iff ideas may be sent out now: the service is offered and the person said yes. Always false while the flag is. */
export function mayUseOcsai(consent: OcsaiConsent, enabled: boolean = OCSAI_ENABLED): boolean {
  return enabled && consent === 'on'
}

/** Would ask the outside service for scores. It does nothing and always rejects with an {@link OcsaiDisabledError}. */
export function requestOcsaiScores(): Promise<never> {
  return Promise.reject(new OcsaiDisabledError())
}
