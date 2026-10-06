/**
 * Copy of the session flow (ROADMAP M1.15; DESIGN §10, §13). Plain, second-person and
 * non-diagnostic (A13, R-5.6.x): it says what will happen and what is kept, never what a result
 * means about the person, and no counted item is ever commented on as right or wrong (§10).
 * The §13 disclaimer (`src/copy.ts` DISCLAIMER) is in the page footer of every screen.
 */

import { HEADING } from '../copy'

// ---------------------------------------------------------------------------- welcome

export const WELCOME_HEADING = HEADING
/**
 * The tagline and the intro say what the session is, in plain words (provisional default, UX-REVIEW D26):
 * what you do, how long it takes, what you get and what you keep. They never describe the person and
 * claim no benefit (A13, R-5.6.x; web/HOUSE-STYLE.md). index.html's static shell is filled with both at
 * build time (UX-100), so they stay plain text: no markup and no "&" or "<".
 */
export const WELCOME_TAGLINE = 'Short tasks of reasoning, memory and speed. Your results are shown as a profile with ranges, not as a single score.'
export const WELCOME_INTRO =
  'The session has six parts and takes about 30 minutes. You can skip any part and finish early at any time. Nothing is scored as pass or fail. At the end you can download a save file of your answers to keep.'
export const WELCOME_START = 'Start'
export const PRIVACY_LINK = 'Privacy and terms'
/**
 * The row for a browser that already holds HumanBench data (provisional default, UX-REVIEW D22): its name for
 * assistive technology, and the notes link. The door to earlier results is the ready screen's own wording
 * (READY_SHOW_RESULTS), so the same words lead to the same screen from either place.
 */
export const WELCOME_RETURNING_LABEL = 'Earlier results and notes on this device'
export const WELCOME_NOTES = 'Notes for your AI'
/** After a link that opens a new tab, shown as the notes page and the results show it (UX-011). */
export const NEW_TAB = ' (opens in a new tab)'

// ------------------------------------------------------------------------------- gate

export const GATE_HEADING = 'Before you start'
export const GATE_POINTS: readonly string[] = Object.freeze([
  'You must be 18 or older to take part.',
  'Your answers, your response times and coarse details of your device stay in this browser, and in a save file that you download. Nothing is uploaded in this version.',
  'This is for curiosity and self-reflection. It is not a basis for decisions about school, work or health.',
])
export const GATE_LINK = 'Read the full privacy notice and terms'
export const GATE_AGREE = 'I am 18 or older, and I agree to these terms and the privacy notice.'
export const GATE_CONTINUE = 'Continue'
export const GATE_UNDER_18 = 'I am under 18'
export const GATE_UNCHECKED = 'Tick the box to confirm that you are 18 or older and agree to the terms.'
export const BLOCKED_HEADING = 'HumanBench is for adults'
export const BLOCKED_TEXT = 'You must be 18 or older to take part. Nothing has been stored on this device. You can close this page.'
/** A quiet way back from a mis-tap on "I am under 18": the gate again, with its box unticked (provisional default, UX-REVIEW D24). */
export const BLOCKED_MISTAKE = 'I chose this by mistake'

// ----------------------------------------------------------------------------- honour

export const HONOUR_HEADING = 'Honour code'
/** DESIGN §13 "Honour code (checkbox at start)", word for word. */
export const HONOUR_TEXT = "No AI tools, search, calculators (except where provided), or help. Your blob is only meaningful if it's yours."
export const HONOUR_AGREE = 'I agree to the honour code.'
export const HONOUR_CONTINUE = 'Continue'
export const HONOUR_UNCHECKED = 'Tick the box to agree to the honour code.'

// ------------------------------------------------------------------------------ device

export const DEVICE_HEADING = 'Check your device'
export const DEVICE_INTRO =
  'We look at your screen and how you will respond, so that response times can be compared fairly. This takes a few seconds. Sit somewhere quiet and keep this browser window open and in front of other windows.'
/**
 * Before the honour sentence: says what "your blob" is, three screens before any blob is drawn
 * (provisional default, UX-REVIEW D26). HONOUR_TEXT itself stays word for word.
 */
export const HONOUR_LEAD = 'At the end of the session, your results are drawn as a shape we call your blob. Before you start, please agree to the following.'
/**
 * Under the honour sentence (owner decision 2026-10-05, UX-REVIEW D10): paper and pencil are fine;
 * calculators and AI chatbots are not. Screen readers and other accessibility settings are named as
 * fine, so that "no AI tools" is never read as "no screen reader".
 */
export const HONOUR_TOOLS =
  'You may want scratch paper and a pencil ready: writing things down is allowed. Please do not use a calculator or an AI chatbot. Screen readers, zoom and other accessibility settings are fine to use.'
export const DEVICE_MEASURING = 'Checking your screen…'
export const DEVICE_INPUT_LEGEND = 'How will you respond in the reaction tasks?'
export const DEVICE_INPUT_KEYBOARD = 'Keyboard'
export const DEVICE_INPUT_TOUCH = 'Tap or click'
export const DEVICE_CONTINUE = 'Continue'

/** Labels of the device facts, in order. */
export const DEVICE_FACTS = Object.freeze({
  class: 'Device',
  system: 'System and browser',
  screen: 'Window size',
  refresh: 'Screen refresh rate',
  timer: 'Timer precision',
})

// ------------------------------------------------------------------------------- ready

export const READY_HEADING = 'Ready when you are'
export const READY_TEXT =
  'Six short parts, about 30 minutes. Your progress is saved in this browser as you go. After each answer to a question you will say how sure you are.'
export const READY_PRACTICE = 'Try practice questions first'
export const READY_PRACTICE_NOTE = 'Practice questions show whether you were right and are never counted.'
export const READY_BEGIN = 'Begin'
export const READY_FOCUS_SUMMARY = 'Or a 20-minute focus session'
export const READY_RESTORE_HEADING = 'Earlier saves on this device'
export const READY_LOAD_HEADING = 'Continue from a save file'
export const READY_LOAD_HELP = 'Choose a save file, or paste a save code. This adds your new session to your earlier ones.'
export const READY_LOAD_FILE = 'Save file'
export const READY_LOAD_CODE = 'Or paste a save code'
export const READY_LOAD_BUTTON = 'Load'
/** Ready, with earlier sessions loaded: see the profile without starting a new session (UX-010). */
export const READY_SHOW_RESULTS = 'See my results'
/** Under the choice of earlier saves: when the newest one was written and what it holds (UX-012a). */
export const savedAtLine = (when: string, questions: number): string =>
  questions === 0 ? `Last saved ${when}.` : `Last saved ${when}, ${questions} ${questions === 1 ? 'question' : 'questions'} answered.`
/** Beside Begin once earlier sessions are loaded. */
export const addedToLine = (n: number): string => `Your new session will be added to ${n} earlier ${n === 1 ? 'session' : 'sessions'}.`
/** Begin pressed with a file chosen or a code pasted that is not loaded (UX-012a). */
export const READY_NOT_LOADED =
  'You chose a save file or pasted a code, but it is not loaded yet. Press Load to add your new session to it, or clear it to begin without it.'
/** Shown after a loaded file's notes settings differ from the ones saved on this device (ROADMAP owner decisions 2026-10-01). */
export const READY_LOAD_PREFS_NOTICE = 'The notes settings in this file will be used in place of the different ones saved on this device.'

// ---------------------------------------------------------------------------- practice

export const PRACTICE_HEADING = 'Practice'
export const PRACTICE_INTRO = 'These questions are for practice. They are not counted, and you will see whether you were right.'
export const PRACTICE_CORRECT = 'That was correct.'
export const PRACTICE_INCORRECT = 'That was not correct.'
export const PRACTICE_ANSWER = 'The answer was'
/**
 * What a screen reader is told when the feedback appears (a hidden status line; the visible feedback is the
 * two sentences above, which take focus). Worded differently on purpose, so a page search for the visible
 * sentences finds one element.
 */
export const practiceVerdict = (correct: boolean, answer: string): string => `Your answer was ${correct ? 'correct' : 'not correct'}. The right answer is ${answer}.`
export const PRACTICE_NEXT = 'Next practice question'
export const PRACTICE_DONE = 'Finish practice'
export const PRACTICE_DONE_HEADING = 'Practice complete'
export const PRACTICE_DONE_TEXT = 'The real session is the same, except that it does not tell you whether an answer was right.'
/** On a practice question: leave practice at once (the ready screen). */
export const PRACTICE_STOP = 'Stop practice'
/** On "Practice complete": on to the ready screen. */
export const PRACTICE_DONE_CONTINUE = 'Continue'
export const PRACTICE_UNAVAILABLE = 'This practice question cannot be shown in your browser.'
export const PRACTICE_SKIP_ONE = 'Skip this practice question'

// ------------------------------------------------------------------------- interstitial

export const INTERSTITIAL_START = 'Start'
export const INTERSTITIAL_SKIP = 'Skip this part'

/** "Up next: Spatial." */
export const upNext = (title: string): string => `Up next: ${title}`
/** "About 6 minutes." */
export const aboutMinutes = (n: number): string => `About ${n} ${n === 1 ? 'minute' : 'minutes'}.`

// -------------------------------------------------------------------------- confidence

export const CONFIDENCE_LEGEND = 'How sure are you that your answer is right?'
export const CONFIDENCE_CONTINUE = 'Continue'
/** Under the slider: what its ends mean. */
export const confidenceHint = (floorPct: number, optionsCount: number | null): string =>
  optionsCount === null
    ? '0% means you have no idea. 100% means you are certain.'
    : `With ${optionsCount} options, guessing would be right about ${floorPct}% of the time. 100% means you are certain.`
export const confidenceValue = (pct: number): string => `${pct}% sure`

// ---------------------------------------------------------------------------- controls

/**
 * The header buttons keep their full names ("Finish early", "Skip Spatial") and, on a narrow screen, show
 * only the first word: the rest is visually hidden but still in the name (WCAG 2.5.3, UX-003).
 */
export const FINISH_EARLY_HEAD = 'Finish'
export const FINISH_EARLY_TAIL = ' early'
export const FINISH_EARLY = FINISH_EARLY_HEAD + FINISH_EARLY_TAIL
export const SKIP_HEAD = 'Skip'
export const skipButton = (name: string): string => `${SKIP_HEAD} ${name}`
export const SKIP_CONFIRM_HEADING = (name: string): string => `Skip ${name}?`
export const SKIP_CONFIRM_TEXT = 'It will show as not measured on your profile. Answers you already gave for it stay in your save.'
export const SKIP_CONFIRM_YES = (name: string): string => `Skip ${name}`
export const SKIP_CONFIRM_NO = 'Keep going'
export const FINISH_CONFIRM_HEADING = 'Finish now?'
export const FINISH_CONFIRM_TEXT = 'You will see a partial profile. Parts you have not done show as not measured.'
export const FINISH_CONFIRM_YES = 'Finish now'
export const FINISH_CONFIRM_NO = 'Keep going'

// ------------------------------------------------------------------------------ notices

export const NOTICE_TIMEOUT = 'That question ran out of time. It counts as not answered correctly.'
/**
 * The same, for a question the server holds (ROADMAP M2.7): an answer that is no answer at all is
 * not scored there, neither right nor wrong (`rescore` counts it under `skipped.invalid`, R-11.1), so
 * the notice does not say it counts as wrong.
 */
export const NOTICE_TIMEOUT_SERVED = 'That question ran out of time, so it is left out of your results.'
export const NOTICE_MALFORMED = 'That answer could not be read. Please check it and try again.'
export const noticeSkipped = (name: string): string => `${name} skipped. It will show as not measured.`
/** A served question of a kind this page cannot draw yet (ROADMAP M2.7): not the browser's fault, so it does not blame it. */
export const noticeUnsupported = (name: string): string =>
  `This kind of question cannot be shown in this version of the page yet. You can skip ${name}; it will show as not measured.`
export const noticeUnavailable = (name: string): string =>
  `This question cannot be shown in your browser (for example, 3D graphics may be switched off). You can skip ${name}; it will show as not measured.`

// ---------------------------------------------------------------------------- progress

export const PROGRESS_LABEL = 'Session time'
export const CHECKLIST_LABEL = 'Session checklist'
export const CHECKLIST_LATER_LABEL = 'Not in this version'
/** In a focus session (M1.R) the other parts are left out by choice. */
export const CHECKLIST_FOCUS_LATER_LABEL = 'Not in this session'
/** The Estimation cluster has no part of its own: it is measured by the confidence slider after each answer (A15). */
export const CHECKLIST_EMBEDDED_STATUS = 'With each answer'
export const CHECKLIST_STATUS: Readonly<Record<'done' | 'current' | 'upcoming' | 'later' | 'partial' | 'skipped' | 'not_reached', string>> = Object.freeze({
  done: 'Done',
  current: 'Now',
  upcoming: 'Up next',
  later: 'Later',
  partial: 'Partly done',
  skipped: 'Skipped',
  not_reached: 'Not reached',
})
/** "12 of about 30 min" */
export const progressText = (elapsedMin: number, targetMin: number): string => `${elapsedMin} of about ${targetMin} min`
export const OVER_TARGET = 'Almost there'
/** Over the target time with parts still to do (UX-008): "Almost there" is for the last part only. */
export const OVER_PLANNED = 'Over the planned time'

// ------------------------------------------------------------------------------- break

export const BREAK_OFFER_HEADING = 'Time for a break?'
export const BREAK_OFFER_TEXT = 'You have been working for about 30 minutes. You can take a short break now. The clock pauses while you rest.'
export const BREAK_TAKE = 'Take a break'
export const BREAK_DECLINE = 'Keep going'
export const BREAK_HEADING = 'Break'
export const BREAK_TEXT = 'Your session is paused. Come back when you are ready.'
export const BREAK_RESUME = 'Resume'

// ----------------------------------------------------------------------------- finished

export const FINISHED_HEADING = 'Session complete'
export const FINISHED_REASON: Readonly<Record<'complete' | 'finish_early' | 'hard_stop', string>> = Object.freeze({
  complete: 'You finished every part.',
  finish_early: 'You finished early, so some parts are not measured.',
  hard_stop: 'The session reached its time limit, so it stopped here.',
})
/** The heading when nothing was measured: the session ended, but nothing is "complete" (UX-009b). */
export const FINISHED_EMPTY_HEADING = 'Session ended'
export const FINISHED_EMPTY = 'Nothing was measured in this session, so there is no profile to show.'
/** The summary of the save a closed disclosure holds when nothing was measured (UX-009a). */
export const FINISHED_EMPTY_SAVE = 'Keep a file of this visit anyway'
/** The heading of the results opened from the ready screen without a new session (UX-010). */
export const FINISHED_VIEW_HEADING = 'Your results'
export const viewLine = (k: number): string => `Your profile from ${k} earlier ${k === 1 ? 'session' : 'sessions'}.`
/** Reached the end, with parts skipped on the way (UX-009a). */
export const reachedEndLine = (names: readonly string[]): string => {
  const list = names.length <= 1 ? (names[0] ?? '') : `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`
  return `You reached the end of the session. You skipped ${names.length} ${names.length === 1 ? 'part' : 'parts'}: ${list}.`
}
export const FINISHED_ALL_SKIPPED = 'You skipped every part, so nothing was measured this time.'
export const combinesLine = (k: number): string => `This profile combines ${k} sessions.`
export const noNewAnswersLine = (k: number): string => `This visit added no new answers. Your profile below comes from ${k} earlier ${k === 1 ? 'session' : 'sessions'}.`
export const FINISHED_SAVE_HEADING = 'Your save file'
export const FINISHED_SAVE_TEXT = 'Download your save file and keep it. It holds your answers, so you can add later sessions to it. It is stored only on your device.'
export const FINISHED_DOWNLOAD = 'Download save file'
export const FINISHED_COPY = 'Copy save code'
export const FINISHED_COPIED = 'Save code copied.'
export const FINISHED_COPY_FAILED = 'The code could not be copied automatically. Select it below and copy it yourself.'
export const FINISHED_DOWNLOADED = 'Save file downloaded.'
export const FINISHED_AUTOSAVE_UNAVAILABLE = 'This browser did not allow saving as you went, so download your save file now.'
export const FINISHED_AGAIN = 'Back to the start'
export const summaryLine = (items: number, blocks: number, minutes: number): string =>
  `You answered ${items} ${items === 1 ? 'question' : 'questions'} and completed ${blocks} timed ${blocks === 1 ? 'task' : 'tasks'} in about ${minutes} ${minutes === 1 ? 'minute' : 'minutes'}.`

// ----------------------------------------------------------------------------- privacy

export const PRIVACY_HEADING = 'Privacy and terms'
export const PRIVACY_BACK = 'Back'
export const PRIVACY_FORGET = 'Delete the data this site keeps in this browser'
export const PRIVACY_FORGET_DONE = 'Deleted. This browser no longer holds any HumanBench data.'
export const PRIVACY_FORGET_NONE = 'This browser holds no HumanBench data.'

export interface PrivacySection {
  readonly heading: string
  readonly paragraphs: readonly string[]
}

/**
 * The M1 privacy notice and terms (DESIGN §13). It says plainly that no personally identifiable
 * information is collected and that all responses are anonymous (owner decision 2026-10-05, UX-REVIEW
 * D1); by the owner's choice it names no controller and no contact. In this static version nothing
 * leaves the device unless the person shares their own save file, and the text says exactly that.
 * A change of substance here bumps `TERMS_VERSION` (`constants.ts`), so consent is asked again.
 */
export const PRIVACY_SECTIONS: readonly PrivacySection[] = Object.freeze([
  {
    heading: 'In short',
    paragraphs: [
      'HumanBench collects no personally identifiable information, and all responses are anonymous. It never asks for your name, your email address or anything else that identifies you, and there are no accounts.',
      'In this version your answers stay on your device. They leave it only if you share them yourself, for example by sending someone your save file.',
    ],
  },
  {
    heading: 'What this version keeps',
    paragraphs: [
      'While you take part, HumanBench keeps your answers, how long each took, how sure you said you were, and coarse details of your device: its class (desktop, tablet or phone), the type of input you used, the family of your system and browser (with no version numbers), your window size, your screen refresh rate and your timer precision.',
      'It also keeps a random identifier that starts with hb_. It is not linked to your name, your email address or your network address, and this site does not ask for any of them.',
    ],
  },
  {
    heading: 'Where it stays',
    paragraphs: [
      "In this version everything stays in your browser. It is saved in your browser's local storage as you go, so a crash does not lose your answers, and you can download it as a save file. Nothing is sent to a server.",
      "If you clear your browser's site data, the saved copy is gone. Your downloaded save file is yours to keep or delete.",
    ],
  },
  {
    heading: 'When there is an online version',
    paragraphs: [
      'An online version may send your answers to a server to improve the questions. Before it does, this notice will be updated and you will be asked for your consent again.',
      'The plan for that version is the same: no name and no email address, answers stored only under a random identifier, and answers kept for at most 24 months.',
    ],
  },
  {
    heading: 'Your choices',
    paragraphs: [
      'You can skip any part, finish at any time, and delete what this site keeps in your browser with the button below. You can also delete your save file from your device.',
      'You must be 18 or older to take part. Nobody under 18 can start a session, and nothing is stored for them.',
    ],
  },
  {
    heading: 'Terms of use',
    paragraphs: [
      'HumanBench is a hobby project, provided as it is, without any promise about its accuracy. Your profile compares parts of your own performance and is provisional. It is not a basis for decisions about education, employment or health.',
      'The honour code applies: no AI tools, search, calculators (except where provided), or help, so that your profile is yours.',
    ],
  },
])
      'The web host that serves these pages sees your network address when your browser loads them, as every web host does. It never receives your answers.',
