/**
 * Context presets (proposal §3.1): where the person will use the notes. Each preset picks the
 * style lines that start ticked (T0), the default mode and answer length, a suggested set of
 * topics and a default destination. "Results input" is none for every preset in Part 1 (R-17.4);
 * for Writing it stays none, ever.
 *
 * `defaults` lists tick keys (a template's `base`). The person can switch any default off, except
 * the locked clauses (H, F1-F4, and CC in the coding context), which no preset lists as optional.
 */

import { SUGGESTED_TOPICS } from './topics'
import type { ContextPreset, DestinationId, Length, LineId, Mode } from './types'

export interface PresetInfo {
  readonly id: ContextPreset
  /** Short name of the choice. */
  readonly label: string
  /** One line under the label. */
  readonly blurb: string
  readonly mode: Mode
  readonly length: Length
  /** Tick keys that start on. */
  readonly defaults: readonly string[]
  /** Which wording of a phrasing family this context starts with (coding: code first, "a test or a command"). */
  readonly variants: Readonly<Record<string, LineId>>
  readonly destination: DestinationId
  readonly suggested: readonly string[]
  /** Reading contexts head the style block "Reading and summarising". */
  readonly readingHeading: boolean
  /** The locked coding clause CC applies. */
  readonly coding: boolean
  /** What HumanBench results add here (proposal §3.1 last column), for the page. */
  readonly resultsNote: string
}

const MODE_KEYS = ['K1', 'K1L', 'K1D', 'K1C', 'K1F', 'K2'] as const

export const PRESET_INFO: Readonly<Record<ContextPreset, PresetInfo>> = {
  coding: {
    id: 'coding',
    label: 'Coding and data',
    blurb: 'A coding assistant or agent: answers lead with code, and you can ask it to check with you before big changes.',
    mode: 'do',
    length: 'short',
    defaults: ['LANG', 'U1', 'U4', 'U6', ...MODE_KEYS],
    variants: { U1: 'U1c', U6: 'U6c' },
    destination: 'claude_code_skill',
    suggested: SUGGESTED_TOPICS.coding,
    readingHeading: false,
    coding: true,
    resultsNote: 'These notes use your own settings only.',
  },
  learning: {
    id: 'learning',
    label: 'Learning something new',
    blurb: 'A study Project or Gem: the answer first, plain words, a few new ideas at a time, and a way to check.',
    mode: 'learn',
    length: 'standard',
    defaults: ['LANG', 'U1', 'U2', 'U3', 'U4', 'U5', 'U6', ...MODE_KEYS],
    variants: {},
    destination: 'claude_project',
    suggested: SUGGESTED_TOPICS.learning,
    readingHeading: false,
    coding: false,
    resultsNote: 'These notes use your own settings only.',
  },
  reading: {
    id: 'reading',
    label: 'Reading dense material',
    blurb: 'Summaries and long documents: the answer first, every caveat and number kept, and what the document does not claim.',
    mode: 'do',
    length: 'standard',
    defaults: ['LANG', 'U1', 'U4', 'U6', 'U7', ...MODE_KEYS],
    variants: {},
    destination: 'claude_preferences',
    suggested: SUGGESTED_TOPICS.reading,
    readingHeading: true,
    coding: false,
    resultsNote: 'These notes use your own settings only.',
  },
  numbers: {
    id: 'numbers',
    label: 'Everyday numbers',
    blurb: 'Money, chances and measurements: chances as counts as well as percentages, and a way to check.',
    mode: 'do',
    length: 'short',
    defaults: ['LANG', 'U1', 'U4', 'U5', 'U6', ...MODE_KEYS],
    variants: {},
    destination: 'chatgpt_instructions',
    suggested: SUGGESTED_TOPICS.numbers,
    readingHeading: false,
    coding: false,
    resultsNote: 'These notes use your own settings only.',
  },
  writing: {
    id: 'writing',
    label: 'Writing',
    blurb: 'Editing and feedback: keep your voice and your word choices, and point out unclear sentences.',
    mode: 'do',
    length: 'standard',
    defaults: ['LANG', 'U8', ...MODE_KEYS],
    variants: {},
    destination: 'claude_preferences',
    suggested: SUGGESTED_TOPICS.writing,
    readingHeading: false,
    coding: false,
    resultsNote: 'HumanBench adds little here, so these notes never use results.',
  },
  general: {
    id: 'general',
    label: 'General',
    blurb: 'Everything else: the everyday defaults for explanations.',
    mode: 'do',
    length: 'standard',
    defaults: ['LANG', 'U1', 'U2', 'U3', 'U4', 'U5', 'U6', ...MODE_KEYS],
    variants: {},
    destination: 'chatgpt_instructions',
    suggested: SUGGESTED_TOPICS.general,
    readingHeading: false,
    coding: false,
    resultsNote: 'These notes use your own settings only.',
  },
}

export const presetInfo = (id: ContextPreset): PresetInfo => PRESET_INFO[id]
