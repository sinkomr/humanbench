/**
 * Named example settings: the worked profiles of proposal §4.9 that need no results (A and B), a
 * reading and science profile made only of the person's own settings, and the grid of settings the
 * bank's behaviour harness reads through `npm run dump:briefs` (AI.12a). Used by tests and the dump.
 */

import { PRESET_INFO } from './contexts'
import { defaultPrefs, type ContextPrefs, type Extras } from './prefs'
import { TOPIC_SETTINGS, PRESETS, type ContextPreset, type Form, type Length, type Mode, type TopicSetting } from './types'

export interface Profile {
  readonly name: string
  readonly prefs: ContextPrefs
  readonly extras: Extras
  readonly form: Form
  readonly asOf: string
}

/** Profile A: coding and data work, a Claude Code skill; three sessions taken would change nothing. */
export const PROFILE_A: Profile = {
  name: 'A-coding-skill',
  prefs: {
    ...defaultPrefs('coding'),
    destination: 'claude_code_skill',
    topics: { 'other/programming': 'skip', 'other/statistics': 'skip', 'quant/probability_counting': 'ask_first' },
    lines_on: ['AC1'],
    lines_off: ['LANG', 'U3'],
  },
  extras: { interests: '', custom: [] },
  form: 'skill',
  asOf: '2026-11',
}

const PROFILE_B_PREFS: ContextPrefs = {
  ...defaultPrefs('learning'),
  destination: 'chatgpt_instructions',
  topics: { 'quant/probability_counting': 'build', 'quant/arith_fractions_percent': 'build' },
  lines_on: ['W3', 'VOICE'],
}
const PROFILE_B_EXTRAS: Extras = { interests: 'cooking, football', custom: [] }

/** Profile B: learning something new; short notes for account instructions. */
export const PROFILE_B_SHORT: Profile = { name: 'B-learning-short', prefs: PROFILE_B_PREFS, extras: PROFILE_B_EXTRAS, form: 'short', asOf: '2026-11' }
/** Profile B again as long notes for a study Project. */
export const PROFILE_B_LONG: Profile = { name: 'B-learning-long', prefs: { ...PROFILE_B_PREFS, destination: 'claude_project' }, extras: PROFILE_B_EXTRAS, form: 'long', asOf: '2026-11' }

/** Reading dense material: science and history set by the person (no measured lines exist in Part 1). */
export const PROFILE_C: Profile = {
  name: 'C-reading-own-settings',
  prefs: {
    ...defaultPrefs('reading'),
    destination: 'claude_project',
    topics: { 'kst/biology': 'skip', 'khu/history': 'skip', 'kst/chemistry': 'build', 'lr/notation': 'build', 'quant/powers_quadratics': 'ask_first' },
    lines_on: ['W1', 'FMT1'],
    phrasing: {},
  },
  extras: { interests: '', custom: [] },
  form: 'skill',
  asOf: '2027-11',
}

export const PROFILES: readonly Profile[] = [PROFILE_A, PROFILE_B_SHORT, PROFILE_B_LONG, PROFILE_C]

/** Patterns of the person's own settings, for the harness grid. */
const PATTERNS: readonly { name: string; settings: (i: number) => TopicSetting | null }[] = [
  { name: 'all-skip', settings: () => 'skip' },
  { name: 'all-ask', settings: () => 'ask_first' },
  { name: 'all-build', settings: () => 'build' },
  { name: 'mixed', settings: (i) => TOPIC_SETTINGS[i % TOPIC_SETTINGS.length] ?? null },
]

/**
 * The harness grid: each context x each setting pattern (three of the context's suggested topics)
 * x mode x length, written in the form of the context's default destination. Deterministic; the
 * bank runs the same settings through its personas (proposal §7.3).
 */
export function harnessGrid(asOf: string): Profile[] {
  const out: Profile[] = []
  for (const preset of PRESETS as readonly ContextPreset[]) {
    const info = PRESET_INFO[preset]
    for (const pattern of PATTERNS) {
      for (const mode of ['do', 'learn'] as Mode[]) {
        for (const length of ['short', 'standard'] as Length[]) {
          const topics: Record<string, TopicSetting> = {}
          info.suggested.slice(0, 3).forEach((id, i) => {
            const s = pattern.settings(i)
            if (s !== null) topics[id] = s
          })
          const form: Form = preset === 'coding' ? 'skill' : length === 'short' ? 'short' : 'long'
          out.push({
            name: `${preset}.${pattern.name}.${mode}.${length}`,
            prefs: { ...defaultPrefs(preset), mode, length, topics },
            extras: { interests: '', custom: [] },
            form,
            asOf,
          })
        }
      }
    }
  }
  return out
}
