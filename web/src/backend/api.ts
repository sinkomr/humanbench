/**
 * The RPCs of the server, typed (ROADMAP M2.7; DESIGN §11.2; supabase/migrations 20261001000600 to
 * 20261003000100). One method per whitelisted RPC, with the argument names of the SQL functions
 * (`p_token`, `p_item_id`, ...), the replies checked by `replies.ts`, and three rules:
 *
 * - **What leaves the device.** Saves go through {@link toUploadPayload} (`brief_prefs` removed,
 *   AI.26) and, where the call only needs the sessions the server issued, through
 *   {@link signedSessionsOnly} (data minimisation). The transport is {@link guarded} too.
 * - **Retries.** A call that can be repeated without harm is repeated after a network failure or a
 *   5xx (twice, after 0.5 s and 1.5 s): `next_item` (a pending item is served again), `submit` (an
 *   answered item is acknowledged and changes nothing, so a lost reply is safe to retry),
 *   `finish`, `report_problem`, `submit_survey`, `verify_save`, `rescore`, `mirror_get`.
 *   Never repeated: `start_session` (each call counts against the 5 a day), `mirror_put` (the first
 *   reply carries the recovery phrase, which the server shows once), `delete_my_data`.
 * - **No token in a URL or a log.** The session token is an argument of the call, in the request
 *   body, and is never stored by this module.
 */

import type { AxisCode } from '../engine/axes'
import type { JsonValue } from '../engine/types'
import type { DeviceInfo, SaveFileV1, SessionFlags } from '../save/types'
import { BackendError } from './errors'
import {
  parseDelete,
  parseFinish,
  parseMirrorGet,
  parseMirrorPut,
  parseNext,
  parseRecorded,
  parseRescore,
  parseStarted,
  parseSubmit,
  parseVerify,
  type DeleteReply,
  type FinishReply,
  type MirrorGetReply,
  type MirrorPutReply,
  type NextReply,
  type RescoreReply,
  type StartedSession,
  type SubmitReply,
  type VerifyReply,
} from './replies'
import { guarded, type RpcTransport } from './transport'
import { signedSessionsOnly, toUploadPayload } from './upload'

// ------------------------------------------------------------------------------ inputs

/** The six kinds of report (DESIGN §4.5; AI.26): five about an item, one about a request for the person's notes. */
export const ITEM_PROBLEM_KINDS = ['wrong_key', 'ambiguous', 'typo', 'offensive', 'broken'] as const
export type ItemProblemKind = (typeof ITEM_PROBLEM_KINDS)[number]
export type ProblemKind = ItemProblemKind | 'notes_requested'

/** What `report_problem` takes. An item report names the item and may carry up to 500 characters; the notes report carries neither. */
export type ProblemReport = { readonly kind: ItemProblemKind; readonly itemId: string; readonly detail?: string | undefined } | { readonly kind: 'notes_requested' }

export const MAX_PROBLEM_DETAIL = 500

export type AgeBand = '18-24' | '25-34' | '35-44' | '45-54' | '55-64' | '65+'
export const AGE_BANDS: readonly AgeBand[] = ['18-24', '25-34', '35-44', '45-54', '55-64', '65+']

/** The optional two-question survey (DESIGN §13): both answers are voluntary and either may be left out. */
export interface Survey {
  readonly ageBand: AgeBand | null
  readonly englishFirst: boolean | null
}

export interface SubmitArgs {
  readonly itemId: string
  /** The answer as the renderer gave it (an option position or typed text), or null for an item that ran out of time or was left. */
  readonly response: JsonValue | null
  /** Milliseconds from the item's first frame to the answer. */
  readonly rtMs: number
  /** How sure the person said they were, 0 to 100, or null if not asked. */
  readonly confidence: number | null
  /** Per-answer integrity reports (`paste`, `visibility_hidden`, ...): snake_case names, number, boolean or null values. */
  readonly clientFlags?: Readonly<Record<string, number | boolean | null>> | undefined
  /** Ask for the next item in the same round trip (a pending item stays pending; use only when the segment goes on). */
  readonly next: boolean
  readonly axes?: readonly AxisCode[] | undefined
}

export type DeleteProof = { readonly phrase: string; readonly save?: SaveFileV1 | undefined } | { readonly phrase?: undefined; readonly save: SaveFileV1 }

// -------------------------------------------------------------------------------- api

export interface BackendApi {
  /** Opens a session. `save` (if given) lets the server continue its anon_id when the save proves it. What it keeps away from the session is what the server itself served to the ids the save proves (a merged file proves each) and the procedural families the save lists (the worked examples, an offline session); it ignores a save's finite-bank items. */
  startSession(device: DeviceInfo, save?: SaveFileV1 | null): Promise<StartedSession>
  /** The pending item, or a new one. Which one follows from the answers so far: the accepted adaptive leak (ROADMAP A24-sec). */
  nextItem(token: string, axes?: readonly AxisCode[]): Promise<NextReply>
  /** Hands over an answer; the reply carries no verdict, but its `next` item depends on it (the accepted adaptive leak, ROADMAP A24-sec). */
  submit(token: string, args: SubmitArgs): Promise<SubmitReply>
  finish(token: string, flags?: SessionFlags): Promise<FinishReply>
  reportProblem(token: string, report: ProblemReport): Promise<void>
  /** True if the server stored something (two skipped questions store nothing). */
  submitSurvey(token: string, survey: Survey): Promise<boolean>
  verifySave(save: SaveFileV1): Promise<VerifyReply>
  /** The server's own-axis scores for the signed sessions of `save`. Differencing by a caller who knows four answers is an accepted risk (ROADMAP A24-sec). */
  rescore(save: SaveFileV1): Promise<RescoreReply>
  mirrorPut(token: string, save: SaveFileV1, phrase?: string): Promise<MirrorPutReply>
  mirrorGet(anonId: string, phrase: string): Promise<MirrorGetReply>
  deleteMyData(anonId: string, proof: DeleteProof): Promise<DeleteReply>
}

export interface ApiOptions {
  /** Waits `ms` (default `setTimeout`); tests pass an instant one. */
  readonly sleep?: (ms: number) => Promise<void>
  /** Delays before the retries of a repeatable call. Default 500 ms, 1500 ms. */
  readonly retryDelaysMs?: readonly number[]
}

const defaultSleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms))

/**
 * A recovery phrase as the server compares it: case, spaces and line breaks do not matter (DESIGN §8).
 * The server trims only spaces before it collapses runs of white space, so a phrase pasted with a line
 * break at its end would not match; it is tidied here instead of relying on that.
 */
export function normalisePhrase(phrase: string): string {
  return phrase.trim().toLowerCase().replace(/\s+/gu, ' ')
}

function cleanFlags(flags: SessionFlags | undefined): Record<string, number | boolean | null> | undefined {
  if (flags === undefined) return undefined
  const out: Record<string, number | boolean | null> = {}
  for (const [k, v] of Object.entries(flags)) if (/^[a-z][a-z0-9_]{0,63}$/u.test(k) && (typeof v === 'boolean' || v === null || (typeof v === 'number' && Number.isFinite(v)))) out[k] = v
  return out
}

/** The API over `transport`. */
export function createBackendApi(rawTransport: RpcTransport, options: ApiOptions = {}): BackendApi {
  const transport = guarded(rawTransport)
  const sleep = options.sleep ?? defaultSleep
  const delays = options.retryDelaysMs ?? [500, 1500]

  async function once(fn: string, args: Record<string, unknown>): Promise<unknown> {
    return transport.call(fn, args)
  }

  async function repeatable(fn: string, args: Record<string, unknown>): Promise<unknown> {
    for (let attempt = 0; ; attempt++) {
      try {
        return await transport.call(fn, args)
      } catch (e) {
        const wait = delays[attempt]
        if (!(e instanceof BackendError) || !e.retryable || wait === undefined) throw e
        await sleep(wait)
      }
    }
  }

  return {
    async startSession(device, save) {
      const args: Record<string, unknown> = { p_device: device }
      if (save !== undefined && save !== null) args.p_save = signedSessionsOnly(save)
      return parseStarted(await once('start_session', args))
    },

    async nextItem(token, axes) {
      const args: Record<string, unknown> = { p_token: token }
      if (axes !== undefined) args.p_axes = [...axes]
      return parseNext(await repeatable('next_item', args))
    },

    async submit(token, a) {
      const args: Record<string, unknown> = {
        p_token: token,
        p_item_id: a.itemId,
        p_response: a.response,
        p_rt_ms: Math.max(0, Math.round(a.rtMs)),
        p_confidence: a.confidence === null ? null : Math.round(a.confidence),
        p_next: a.next,
      }
      if (a.clientFlags !== undefined && Object.keys(a.clientFlags).length > 0) args.p_client_flags = a.clientFlags
      if (a.axes !== undefined) args.p_axes = [...a.axes]
      return parseSubmit(await repeatable('submit', args))
    },

    async finish(token, flags) {
      const f = cleanFlags(flags)
      return parseFinish(await repeatable('finish', f === undefined ? { p_token: token } : { p_token: token, p_flags: f }))
    },

    async reportProblem(token, report) {
      const args: Record<string, unknown> = { p_token: token, p_kind: report.kind }
      if (report.kind !== 'notes_requested') {
        args.p_item_id = report.itemId
        const detail = report.detail?.trim() ?? ''
        if (detail.length > MAX_PROBLEM_DETAIL) throw new BackendError('local', 'detail_too_long', { detail: `at most ${MAX_PROBLEM_DETAIL} characters` })
        if (detail !== '') args.p_detail = detail
      }
      parseRecorded(await repeatable('report_problem', args), 'report_problem')
    },

    async submitSurvey(token, survey) {
      const args: Record<string, unknown> = { p_token: token }
      if (survey.ageBand !== null) args.p_age_band = survey.ageBand
      if (survey.englishFirst !== null) args.p_english_first = survey.englishFirst
      return parseRecorded(await repeatable('submit_survey', args), 'submit_survey')
    },

    async verifySave(save) {
      return parseVerify(await repeatable('verify_save', { p_save: signedSessionsOnly(save) }))
    },

    async rescore(save) {
      return parseRescore(await repeatable('rescore', { p_save: signedSessionsOnly(save) }))
    },

    async mirrorPut(token, save, phrase) {
      const args: Record<string, unknown> = { p_token: token, p_save: toUploadPayload(save) }
      if (phrase !== undefined) args.p_phrase = normalisePhrase(phrase)
      return parseMirrorPut(await once('mirror_put', args))
    },

    async mirrorGet(anonId, phrase) {
      return parseMirrorGet(await repeatable('mirror_get', { p_anon_id: anonId.trim(), p_phrase: normalisePhrase(phrase) }))
    },

    async deleteMyData(anonId, proof) {
      const args: Record<string, unknown> = { p_anon_id: anonId.trim() }
      if (proof.phrase !== undefined) args.p_phrase = normalisePhrase(proof.phrase)
      if (proof.save !== undefined) args.p_save = signedSessionsOnly(proof.save)
      return parseDelete(await once('delete_my_data', args))
    },
  }
}
