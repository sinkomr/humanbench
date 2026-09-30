/**
 * Copy of the results and reveal flow (ROADMAP M1.R; DESIGN §10, §7.3, §7.6, §7.8, §9.5, §13,
 * R-5.6.x; Phase AI proposal v2 §3.3). Plain, second-person and non-diagnostic (A13): it says what
 * a number is and how sure it is, never what it means about the person, and never one overall
 * score, a total or a rank (CLAUDE.md blob rule). The language lint scans this file.
 *
 * The §13 disclaimer and the R-5.6.5 resource line are not spelled out here: they are the two
 * allow-listed constants of `src/copy.ts` (A13) and the results import them from there.
 */

// ------------------------------------------------------------------------------- profile

export const REVEAL_PROFILE_LABEL = 'Your profile'
/** Announced once when the build-up starts. */
export const REVEAL_BUILDING = 'Building your profile, one skill at a time.'
export const REVEAL_READY = 'Your profile is ready.'
export const REVEAL_SKIP = 'Skip animation'
export const REVEAL_REPLAY = 'Replay animation'
/** The visible caption while a skill is being drawn (not announced: the table has the data). */
export const revealNow = (name: string, index: number, count: number): string => `Now showing: ${name} (${index} of ${count})`

/** DESIGN §7.8: "show 'practice-adjusted' in the UI". */
export const PRACTICE_ADJUSTED_LABEL = 'Practice-adjusted'
export const PRACTICE_ADJUSTED_FIRST =
  'This profile is practice-adjusted. With one session there is nothing to adjust yet; when you add sessions, later ones are credited for the practice you gained from earlier ones.'
export const PRACTICE_ADJUSTED_LATER =
  'This profile is practice-adjusted: each later session is credited for the practice you gained from the earlier ones, so the estimates describe you and not how many times you have tried.'

// --------------------------------------------------------------------------------- peaks

export const PEAKS_HEADING = 'Your most distinctive peaks'
export const PEAKS_INTRO =
  'A peak is a skill that stands out from your own other skills, with a range that stays clearly above them. It is not a comparison with other people.'
export const PEAKS_NONE =
  'No skill stands out clearly from your others yet. That is common after one session. Ranges that overlap are not real differences.'
export const PEAKS_TOO_FEW = 'Too few skills were measured to compare them with each other.'
export const PEAKS_NOTE =
  'Peaks compare each skill with your own other skills, so they can differ from the hollow grey and filled blue marks in the chart, which compare with 0 SD.'
/** "stands out by about 0.9 SD from your other skills (90% range +0.4 to +1.4 SD)" */
export const peakDetail = (contrast: string, lo: string, hi: string): string =>
  `stands out by about ${contrast} SD from your other skills (90% range ${lo} to ${hi} SD)`

// ---------------------------------------------------------------------------------- save

export const SAVE_PANEL_HEADING = 'Save your results'
export const SAVE_PANEL_REQUIRED =
  'Download your save file before you leave this page. It holds your answers, so it is your copy of the results. This browser keeps a temporary copy too, but clearing its data removes it.'
export const SAVE_SHARE = 'Share or save to an app'
export const SAVE_SHARED = 'Save file shared.'
export const SAVE_SHARE_CANCELLED = 'Sharing was cancelled. Nothing was saved yet.'
export const SAVE_DONE = 'Your save file is downloaded. You can leave this page safely.'
export const SAVE_COPIED_NOT_SAVED = 'Save code copied. Downloading the file is still the safest way to keep your results.'
export const SAVE_PENDING = 'Save your file first to see the next steps.'
export const LEAVE_HEADING = 'Leave without saving?'
export const LEAVE_TEXT = 'You have not downloaded your save file. Your answers are kept in this browser for now, but clearing its data removes them.'
export const LEAVE_YES = 'Leave anyway'
export const LEAVE_NO = 'Stay and save'

// ---------------------------------------------------------------------------- after saving

export const AFTER_HEADING = 'After you save'

/** The share card slot (M1.18 fills it): the card is made on this device and nothing is uploaded. */
export const SHARE_HEADING = 'Share card'
export const SHARE_PLACEHOLDER = 'A picture of your profile to share, where you can hide any skill, is not available in this version yet. Nothing is shared unless you choose to.'

/** Phase AI, AI.5 builder card (slot until the route exists). */
export const NOTES_HEADING = 'Notes for your AI'
export const NOTES_TEXT =
  'Make short notes about how you like explanations, to paste into your own AI assistant. They come from your own choices, never from your results, and they stay on your device.'
export const NOTES_LINK = 'Build your notes'
export const NOTES_SOON = 'The notes builder is not available in this version yet.'

/** Phase AI, AI.6b results-talk helper (proposal §3.3). */
export const TALK_HEADING = 'Talking about your results with an AI'
export const TALK_TEXT =
  'Talking about your results with an AI? Paste this first. Never paste your save file: it holds your raw answers, and assistants may keep or learn from what you paste.'
export const TALK_PREAMBLE =
  "These are rough, uncertain self-reflection results from a free online test. Ranges that overlap are not real differences. Don't turn them into an intelligence number, a rank against other people or one overall figure. Don't guess at health or medical explanations for them. Help me think about what I might practise or explore, if anything."
export const TALK_COPY = 'Copy this preamble'
export const TALK_COPIED = 'Preamble copied.'
export const TALK_COPY_FAILED = 'The preamble could not be copied automatically. Select the text above and copy it yourself.'

// ----------------------------------------------------------------------------- worked items

export const WORKED_HEADING = 'Three worked examples'
export const WORKED_INTRO =
  'New questions of the kinds you met, each with a worked solution. They are not counted, and these question types are left out of your later sessions.'
export const WORKED_SHOW = 'Show the worked solution'
export const WORKED_ANSWER = 'Answer'
export const WORKED_TRY_FIRST = 'Try it before you open the solution.'
export const WORKED_NONE = 'No new examples are available this time.'
export const workedTitle = (n: number, kind: string): string => `Example ${n}: ${kind}`
export const WORKED_SERIES_PROMPT = 'What is the next term of this series?'
export const WORKED_MATRIX_OPTIONS = 'Options'
export const workedMatrixOption = (letter: string): string => `Option ${letter}`

// ------------------------------------------------------------------------------- retest

export const RETEST_HEADING = 'Coming back for more'
export const RETEST_INTRO = 'A second look tightens the picture. Here is what to expect, and where another session helps most.'
/** "Another session would typically tighten the ranges in your profile by about 25%." */
export const shrinkageLine = (sessions: number, pct: number): string =>
  `${sessions === 1 ? 'A second session' : 'Another session'} would typically tighten the ranges in your profile by about ${pct}%.`
export const SHRINKAGE_BASIS =
  'This is a typical figure for question-based skills, from about six scored questions per skill per session. Speed and memory tasks gain differently.'
export const FUZZIEST_HEADING = 'Where your ranges are widest'
export const FUZZIEST_NONE = 'No skill has been measured yet.'
export const FUZZIEST_NOTE = 'A wide range means the estimate is still uncertain, not that the skill is weak.'
export const FOCUS_HEADING = 'A 20-minute focus session'
export const FOCUS_TEXT = 'Pick the parts you want to sharpen. A focus session takes about 20 minutes and only covers the parts you choose.'
export const FOCUS_LEGEND = 'Parts to include'
export const FOCUS_START = 'Start a 20-minute focus session'
export const FOCUS_NONE_SELECTED = 'Pick at least one part.'
export const FOCUS_SUGGESTED = 'wide range'
export const SPACING_HEADING = 'When to come back'
export const SPACING_TEXT =
  'Leave at least 7 days between sessions. A gap keeps practice effects small, and the practice adjustment then has less to correct. To add a session later, load your save file on the start screen.'

// ----------------------------------------------------------------------------- the numbers

export const NUMBERS_HEADING = 'About these numbers'
export const NUMBERS_INTRO = 'Rough comparisons and a note on pace. None of this changes your profile.'

/** DESIGN §7.3: external norms, worded as rough context (Brysbaert 2019; digit span; web-relative RT). */
export const readingNorm = (wpm: number): string =>
  `You read a passage at about ${wpm} words per minute. A review of 190 studies found that silent reading averages about 238 words per minute for non-fiction and 260 for fiction, and the studies differed widely (SD 51). One passage is a rough guide.`
export const spanNorm = (forward: number | null, backward: number | null): string => {
  const parts: string[] = []
  if (forward !== null) parts.push(`${forward} digits forwards`)
  if (backward !== null) parts.push(`${backward} digits backwards`)
  return `You repeated up to ${parts.join(' and ')}. Typical adults manage about 6 to 7 digits forwards and 4 to 5 backwards.`
}
export const rtNorm = (ms: number, webMedianMs: number): string =>
  `Your typical simple reaction time was about ${ms} ms. Times on the web run tens of milliseconds slower than in a lab, because of screens and input devices, so compare them with web-based times only. Our provisional web reference is about ${webMedianMs} ms until enough people have taken part.`
export const NORMS_NONE = 'There are no published comparisons for the parts you did this time.'

/** DESIGN §7.3: shown only when A12 allows percentiles (after M4 linking, N ≥ 500). Hidden in M1. */
export const TAKER_COMPARISON_TEXT = 'vs other HumanBench takers (a self-selected, likely above-average group)'

/** DESIGN §7.1 (3): the separate "Pace" tooltip. Pace never enters a skill estimate. */
export const PACE_HEADING = 'Pace'
export const PACE_TEXT =
  'Pace is how long you took on each question compared with the typical time for questions like it. It is separate from your skill estimates, which do not reward speed on these questions.'
export const PACE_TOGGLE = 'What is pace?'
export const PACE_LABEL: Readonly<Record<'quicker' | 'typical' | 'slower', string>> = Object.freeze({
  quicker: 'quicker than typical',
  typical: 'close to typical',
  slower: 'slower than typical',
})
export const paceLine = (name: string, seconds: number, label: string): string => `${name}: about ${seconds} s per question, ${label}`
export const PACE_NONE = 'Pace needs at least three answered questions on a skill.'
export const PACE_BASIS = 'Typical times are provisional estimates.'
