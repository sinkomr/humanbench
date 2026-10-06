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

/** Announced once when the build-up starts. */
export const REVEAL_BUILDING = 'Building your profile, one skill at a time.'
export const REVEAL_READY = 'Your profile is ready.'
export const REVEAL_SKIP = 'Skip animation'
export const REVEAL_REPLAY = 'Replay animation'
/** The visible caption while a skill is being drawn (not announced: the table has the data). */
export const revealNow = (name: string, index: number, count: number): string => `Now showing: ${name} (${index} of ${count})`

/** DESIGN §7.8: "show 'practice-adjusted' in the UI". */
export const PRACTICE_ADJUSTED_LABEL = 'Practice-adjusted'
/**
 * The practice note is one line (D16): the label "Practice-adjusted", then one short sentence about this profile. What
 * the adjustment does for a second session is said where the person decides on one, in the advice on when to come
 * back (`SPACING_TEXT`).
 */
export const PRACTICE_ADJUSTED_FIRST = 'Nothing to adjust yet.'
export const PRACTICE_ADJUSTED_LATER = 'Each later session is credited for the typical gain from practice (a provisional figure).'

// --------------------------------------------------------------------------------- peaks

export const PEAKS_HEADING = 'Your most distinctive peaks'
export const PEAKS_INTRO =
  'A peak is a skill that stands out from your profile as a whole, with a range that stays clearly above it. It is not a comparison with other people.'
export const PEAKS_NONE =
  'No skill stands out clearly from your others yet. That is common after one session: the ranges are still wide.'
export const PEAKS_TOO_FEW = 'Too few skills were measured to compare them with each other.'
export const PEAKS_NOTE =
  'Peaks compare each skill with your profile as a whole. The hollow and filled markers in the chart compare each skill with 0 SD instead, so the two can differ.'
/** "stands out by about 0.9 SD from your profile as a whole (90% range +0.4 to +1.4 SD)" */
export const peakDetail = (contrast: string, lo: string, hi: string): string =>
  `stands out by about ${contrast} SD from your profile as a whole (90% range ${lo} to ${hi} SD)`

// ---------------------------------------------------------------------------------- save

export const SAVE_PANEL_HEADING = 'Save your results'
/** UX-029: the line at the top of the results while the file is not saved, and the link to the panel. */
export const SAVE_POINTER = 'Your results are not saved yet. Download your save file to keep them.'
export const SAVE_POINTER_LINK = 'Go to the save file'
export const SAVE_PANEL_REQUIRED =
  'Download your save file before you leave this page. It holds your answers, so it is your copy of the results: load it before your next session to add to it or to see these results again. This browser keeps a temporary copy too, but clearing its data removes it.'
export const SAVE_SHARE = 'Share or save to an app'
export const SAVE_SHARED = 'Save file shared.'
export const SAVE_SHARE_CANCELLED = 'Sharing was cancelled. Nothing was saved yet.'
/**
 * Said under the save panel after a download or a share whose file holds the notes settings kept on this
 * device (UX-REVIEW D17 A, a provisional default; R-17.12: choices only, never typed text). It tells the
 * person what else is in the file they may hand on.
 */
export const SAVE_HOLDS_NOTES = 'The file also holds the notes settings kept on this device: your choices, never text you typed.'
export const SAVE_DONE = 'Your results are saved in your file. You can leave this page safely. Your share card and notes for your AI are just below.'
/** The file name returned by the download, and where to look for it (the status line stays "Save file downloaded."). */
export const savedAs = (name: string): string => `Saved as ${name}. Look in your Downloads folder (on an iPhone, the Files app) and keep it.`
/** The code is for a note to yourself; the "Ready when you are" screen is where it is pasted (session copy READY_HEADING, READY_LOAD_CODE). */
export const SAVE_COPIED_NOT_SAVED =
  'Save code copied. Keep it in a note to yourself and paste it under "Or paste a save code" on the "Ready when you are" screen. Downloading the file is still the safest way to keep your results.'
export const SAVE_PENDING = 'Save your file first to see the next steps.'
export const LEAVE_HEADING = 'Leave without saving?'
export const LEAVE_TEXT = 'You have not downloaded your save file. Your answers are kept in this browser for now, but clearing its data removes them.'
export const LEAVE_YES = 'Leave anyway'
export const LEAVE_NO = 'Stay and save'

// ---------------------------------------------------------------------------- after saving

export const AFTER_HEADING = 'After you save'

/**
 * The share card slot (M1.18, `ShareCard.svelte`): the card is made on this device and nothing is
 * uploaded. The words ON the card are in `viz/card-copy.ts`. `SHARE_PLACEHOLDER` is what the slot
 * says when a caller gives it no card (a standalone `AfterSave`); the reveal always does.
 */
export const SHARE_HEADING = 'Share card'
export const SHARE_PLACEHOLDER = 'A picture of your profile to share, where you can hide any skill, is not available here. Nothing is shared unless you choose to.'
export const SHARE_INTRO =
  'A picture of your profile that you can post or send. It is made on this device and nothing is uploaded. It shows the skills you leave ticked and your most distinctive peaks. It also says how many sessions it is based on. It never shows a total or a single score.'
export const SHARE_SKILLS_LEGEND = 'Skills on the card'
export const SHARE_SKILLS_HELP =
  'Untick any skill to leave it off the card. Skills that were not measured are not on the card. The peaks on the card compare only the skills left on it, so they can differ from the peaks above.'
export const SHARE_SHOW_ALL = 'Show all'
export const SHARE_HIDE_ALL = 'Hide all'
/**
 * R-5.6.4: said about Emotion Reading whenever it was measured, whatever its estimate: a card carries
 * it only at or above the 0 SD ring (so the note does not say where it is).
 */
export const SHARE_EMO_RULE = 'Only put on a card when it is at or above the 0 SD ring. Scores here depend a lot on vocabulary, culture and familiarity with tests.'
export const SHARE_COLOURS_LEGEND = 'Card colours'
export const SHARE_LIGHT = 'Light'
export const SHARE_DARK = 'Dark'
/**
 * The count line is built from parts so that the panel can put the changing number in its own
 * `translate="no"` element (a page translator replaces text nodes, and a number written into a replaced
 * node never shows): `[number, rest of the sentence]`.
 */
export const shareCountParts = (n: number): readonly [number, string] => [n, ` ${n === 1 ? 'skill is' : 'skills are'} on the card.`]
export const shareCount = (n: number): string => shareCountParts(n).join('')
/** `[text before the number, number, text after it]` */
export const shareTooFewParts = (n: number, min: number): readonly [string, number, string] => [`Tick at least ${min} skills to make a card (`, n, ' ticked).']
export const shareTooFew = (n: number, min: number): string => shareTooFewParts(n, min).join('')
/** Fewer than the minimum of skills were measured (UX-032): nothing to tick, so say what would unlock a card. */
export const shareNeedsMore = (min: number, n: number): string =>
  `A card needs at least ${min} measured skills, and your profile has ${n}. Play more parts or add another session, then come back to make a card.`
export const SHARE_PNG = 'Download image (PNG)'
export const SHARE_SVG = 'Download vector image (SVG)'
export const SHARE_SHARE = 'Share image'
/**
 * The label of the downloads (PNG and SVG) when "Share image" is the primary button, that is where the browser
 * can hand image files to its share sheet (UX-REVIEW D15 C, a provisional default). Where it cannot, the
 * downloads stay the first buttons and carry no group label.
 */
export const SHARE_SAVE_COPY = 'Save a copy'
export const SHARE_PREPARING = 'Preparing the PNG…'
export const SHARE_SIZES = 'The PNG is 2400 × 1260 pixels (twice the card size, for sharp screens). The SVG is 1200 × 630 pixels and stays sharp at any size.'
/** A link to the card itself (the SVG) at full size: the preview is too small to read on a phone. */
export const SHARE_FULLSIZE = 'View the card full size (opens in a new tab)'
export const sharePngDone = (w: number, h: number): string => `Image saved: ${w} × ${h} pixels.`
export const SHARE_SVG_DONE = 'Vector image saved.'
export const SHARE_SHARED = 'Image shared.'
export const SHARE_SHARE_CANCELLED = 'Sharing was cancelled.'
export const SHARE_SHARE_FAILED = 'The image could not be shared. Download it instead.'
export const SHARE_PNG_FAILED = 'This browser could not make the PNG. The vector image (SVG) still works.'
/** The results-talk helper, linked from the share card (proposal amendment to M1.18; R-17.13). */
export const SHARE_TALK_LEAD = 'Thinking of asking an AI about your results?'
export const SHARE_TALK_LINK = 'Read this first'

// The "Working with AI" card and the results-talk helper take their text from the notes module
// (`brief/results-talk.ts`: REVEAL_CARD, RESULTS_TALK, PREAMBLE), its one home (AI.6b, A22).

// ----------------------------------------------------------------------------- worked items

const COUNT_WORDS: readonly string[] = ['No', 'One', 'Two', 'Three']
/** The heading says how many examples there are: a kind can be left out when every question of it has been met. */
export const workedHeading = (n: number): string => (n <= 0 ? 'Worked examples' : `${COUNT_WORDS[n] ?? String(n)} worked ${n === 1 ? 'example' : 'examples'}`)
export const WORKED_INTRO =
  'New questions like the ones you met, each with a worked solution. They are not counted, and questions built the same way as these are left out of your later sessions.'
export const WORKED_SHOW = 'Show the worked solution'
export const WORKED_ANSWER = 'Answer'
export const WORKED_TRY_FIRST = 'Try it before you open the solution.'
export const WORKED_NONE = 'No new examples are available this time.'
export const workedTitle = (n: number, kind: string): string => `Example ${n}: ${kind}`
export const WORKED_SERIES_PROMPT = 'What comes next in this sequence?'
export const WORKED_MATRIX_OPTIONS = 'Options'
export const workedMatrixOption = (letter: string): string => `Option ${letter}`

// ------------------------------------------------------------------------------- retest

export const RETEST_HEADING = 'Coming back for more'
export const RETEST_INTRO = 'A second look tightens the picture. Here is what to expect, and where another session would narrow your ranges most.'
/** "Another session would typically tighten the ranges in your profile by about 25%." */
export const shrinkageLine = (sessions: number, pct: number): string =>
  `${sessions === 1 ? 'A second session' : 'Another session'} would typically tighten the ranges in your profile by about ${pct}%.`
export const SHRINKAGE_BASIS =
  'This is a typical figure for question-based skills, from about six scored questions per skill per session. Speed and memory tasks gain differently.'
export const FUZZIEST_HEADING = 'Where your ranges are widest'
export const FUZZIEST_NONE = 'No skill has been measured yet.'
export const FUZZIEST_NOTE = 'A wide range means the estimate is still uncertain, not that the skill is weak.'
export const FOCUS_HEADING = 'A 20-minute focus session'
export const FOCUS_TEXT = 'Pick the parts you want measured more precisely. A focus session takes about 20 minutes and covers only the parts you choose.'
export const FOCUS_LEGEND = 'Parts to include'
export const FOCUS_START = 'Start a 20-minute focus session'
export const FOCUS_NONE_SELECTED = 'Pick at least one part.'
/** Shown in place of the form until the save file is safe (DESIGN §10: the save is required before leaving). */
export const FOCUS_SAVE_FIRST = 'Save your file above first. Then you can start a focus session.'
export const FOCUS_SUGGESTED = 'wide range'
export const SPACING_HEADING = 'When to come back'
export const SPACING_TEXT =
  'Leave at least 7 days between sessions. A gap keeps practice effects small, and the practice adjustment then has less to correct. Each later session is credited for the typical gain from practice (a provisional figure). To add a session later, press Start and load your save file on the "Ready when you are" screen.'

// ----------------------------------------------------------------------------- the numbers

export const NUMBERS_HEADING = 'About these numbers'
export const NUMBERS_INTRO = 'Rough comparisons and a note on pace. None of this changes your profile.'
/** Which attempt the comparisons come from (`normFacts`: the latest valid result of each task in the save). */
export const NORMS_LATEST = 'From your most recent attempt at each task:'

/** DESIGN §7.3: external norms, worded as rough context (Brysbaert 2019; digit span; web-relative RT). */
export const readingNorm = (wpm: number): string =>
  `You read a passage at about ${wpm} words per minute. A review of 190 studies found that silent reading averages about 238 words per minute for non-fiction and 260 for fiction, and the studies differed widely (SD 51). One passage is a rough guide. The comparison figures are for people reading in their first language.`
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
export const PACE_LABEL: Readonly<Record<'quicker' | 'typical' | 'slower', string>> = Object.freeze({
  quicker: 'quicker than typical',
  typical: 'close to typical',
  slower: 'slower than typical',
})
export const paceLine = (name: string, seconds: number, label: string): string => `${name}: about ${seconds} ${seconds === 1 ? 'second' : 'seconds'} per question, ${label}`
export const PACE_NONE = 'Pace needs at least three answered questions on a skill.'
export const PACE_BASIS = 'Typical times are provisional estimates.'
