/**
 * Test-only helpers of the reveal (ROADMAP M1.R): finished bot sessions as save files, alone or
 * one after another, so results, norms, pace and the screens are tested on real session output
 * (the real families, selector, scorer and save library). Never imported by the app.
 */

import { AXIS_INDEX, N_AXES, type AxisCode } from '../engine/axes'
import { saveWithSession } from '../save/create'
import type { SaveFileV1 } from '../save/types'
import { Bot, type BotOptions } from '../session/bot'
import { SAVE_CTX } from '../session/constants'
import type { RunConfig, RunResult } from '../session/run'

export const T0_MS = 1_790_000_000_000
export const DAY_MS = 86_400_000

export interface BotSave {
  readonly save: SaveFileV1
  readonly result: RunResult
  readonly bot: Bot
}

export interface BotSaveOptions extends BotOptions {
  /** True θ of the taker on every axis (default 0.4), or per axis. */
  readonly level?: number | Partial<Record<AxisCode, number>>
  /** The save the session is added to (its seen families are excluded from the session). */
  readonly base?: SaveFileV1 | null
  /** Session start, epoch ms (default T0_MS). */
  readonly startedMs?: number
  readonly skipped?: readonly AxisCode[]
  /** Called with the bot before it runs, e.g. to skip an axis mid-way. */
  readonly drive?: (bot: Bot) => void
  readonly cfg?: Partial<RunConfig>
}

/** Run a simulated session to its end and return it with its save (added to `base`, R-8.1). */
export function botSave(sessionId: string, opts: BotSaveOptions = {}): BotSave {
  const level = opts.level ?? 0.4
  const theta = Array.from({ length: N_AXES }, () => (typeof level === 'number' ? level : 0))
  if (typeof level !== 'number') for (const [k, v] of Object.entries(level)) theta[AXIS_INDEX[k as AxisCode]] = v
  const bot = new Bot(
    {
      sessionId,
      startedMs: opts.startedMs ?? T0_MS,
      seenFamilies: opts.base?.seen_families ?? [],
      ...(opts.skipped === undefined ? {} : { skipped: opts.skipped }),
      ...opts.cfg,
    },
    { theta, ...opts },
  )
  opts.drive?.(bot)
  const run = bot.finish()
  const save = saveWithSession(opts.base ?? null, run.sessionState(), { ctx: SAVE_CTX, createdMs: (opts.startedMs ?? T0_MS) + 60_000, anonId: 'hb_' + 'a'.repeat(17) })
  return { save, result: run.result(), bot }
}
