/**
 * Copy of the session flow (ROADMAP M1.15; DESIGN §10, §13). Plain, second-person and
 * non-diagnostic (A13, R-5.6.x): it says what will happen and what is kept, never what a result
 * means about the person, and no counted item is ever commented on as right or wrong (§10).
 * The §13 disclaimer (`src/copy.ts` DISCLAIMER) is in the page footer of every screen.
 */

import { HEADING } from '../copy'

// ---------------------------------------------------------------------------- welcome

export const WELCOME_HEADING = HEADING
export const WELCOME_TAGLINE = 'A jagged profile of how you think: short tasks, one honest picture.'
export const WELCOME_INTRO =
  'The session takes about 30 minutes and has six short parts. You can skip any part you cannot do, and finish early at any time. Nothing is scored as pass or fail.'
export const WELCOME_START = 'Start'
export const PRIVACY_LINK = 'Privacy and terms'

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
  'We look at your screen and how you will respond, so that response times can be compared fairly. This takes a few seconds. Sit somewhere quiet and keep this window in front.'
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
export const READY_RESTORE_HEADING = 'Earlier saves on this device'
export const READY_LOAD_HEADING = 'Continue from a save file'
export const READY_LOAD_HELP = 'Choose a save file, or paste a save code. This adds your new session to your earlier ones.'
export const READY_LOAD_FILE = 'Save file'
export const READY_LOAD_CODE = 'Or paste a save code'
export const READY_LOAD_BUTTON = 'Load'

// ---------------------------------------------------------------------------- practice

export const PRACTICE_HEADING = 'Practice'
export const PRACTICE_INTRO = 'These questions are for practice. They are not counted, and you will see whether you were right.'
export const PRACTICE_CORRECT = 'That was correct.'
export const PRACTICE_INCORRECT = 'That was not correct.'
export const PRACTICE_ANSWER = 'The answer was'
export const PRACTICE_NEXT = 'Next practice question'
export const PRACTICE_DONE = 'Finish practice'
export const PRACTICE_DONE_HEADING = 'Practice complete'
export const PRACTICE_DONE_TEXT = 'The real session is the same, except that it does not tell you whether an answer was right.'
export const PRACTICE_BACK = 'Back'
export const PRACTICE_UNAVAILABLE = 'This practice question cannot be shown in your browser.'
export const PRACTICE_SKIP_ONE = 'Skip this practice question'

// ------------------------------------------------------------------------- interstitial

export const INTERSTITIAL_START = 'Start'
export const INTERSTITIAL_SKIP = 'Skip this part'

/** "Up next: Spatial." */
export const upNext = (title: string): string => `Up next: ${title}`
/** "About 6 min." */
export const aboutMinutes = (n: number): string => `About ${n} min.`

// -------------------------------------------------------------------------- confidence

export const CONFIDENCE_LEGEND = 'How sure are you that your answer is right?'
export const CONFIDENCE_CONTINUE = 'Continue'
/** Under the slider: what its ends mean. */
export const confidenceHint = (floorPct: number, optionsCount: number | null): string =>
  optionsCount === null
    ? '0% means you have no idea. 100% means you are certain.'
    : `${floorPct}% is what pure guessing would give among ${optionsCount} options. 100% means you are certain.`
export const confidenceValue = (pct: number): string => `${pct}% sure`

// ---------------------------------------------------------------------------- controls

export const FINISH_EARLY = 'Finish early'
export const skipButton = (name: string): string => `Skip ${name}`
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
export const NOTICE_MALFORMED = 'That answer could not be read. Please check it and try again.'
export const noticeSkipped = (name: string): string => `${name} skipped. It will show as not measured.`
export const noticeUnavailable = (name: string): string =>
  `This question cannot be shown in your browser (for example, 3D graphics may be switched off). You can skip ${name}; it will show as not measured.`

// ---------------------------------------------------------------------------- progress

export const PROGRESS_LABEL = 'Session time'
export const CHECKLIST_LABEL = 'Session checklist'
export const CHECKLIST_LATER_LABEL = 'Not in this version'
export const CHECKLIST_STATUS: Readonly<Record<'done' | 'current' | 'upcoming' | 'partial' | 'skipped' | 'not_reached', string>> = Object.freeze({
  done: 'Done',
  current: 'Now',
  upcoming: 'Up next',
  partial: 'Partly done',
  skipped: 'Skipped',
  not_reached: 'Not reached',
})
/** "12 of about 28 min" */
export const progressText = (elapsedMin: number, targetMin: number): string => `${elapsedMin} of about ${targetMin} min`
export const OVER_TARGET = 'Almost there'

// ------------------------------------------------------------------------------- break

export const BREAK_OFFER_HEADING = 'Time for a break?'
export const BREAK_OFFER_TEXT = 'You have been working for about 30 minutes. A short break can help you stay sharp. The clock pauses while you rest.'
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
export const FINISHED_EMPTY = 'Nothing was measured in this session, so there is no profile to show.'
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
  `You answered ${items} ${items === 1 ? 'question' : 'questions'} and completed ${blocks} timed ${blocks === 1 ? 'task' : 'tasks'} in about ${minutes} min.`

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
 * The M1 privacy notice and terms (DESIGN §13). The controller's name and contact are the user's
 * to fill in (`TODO(user)`, ROADMAP M1.15), and so is the sign-off on retention and the legal
 * basis before any online, data-collecting version. In this static version nothing leaves the
 * device, and the text says exactly that.
 */
export const PRIVACY_SECTIONS: readonly PrivacySection[] = Object.freeze([
  {
    heading: 'Who runs this site',
    paragraphs: [
      'Controller: TODO(user): name of the person or organisation responsible for this site.',
      'Contact: TODO(user): an email address for questions and requests about your data.',
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
      'In this version everything stays in your browser. It is saved in your browser’s local storage as you go, so a crash does not lose your answers, and you can download it as a save file. Nothing is sent to a server.',
      'If you clear your browser’s site data, the saved copy is gone. Your downloaded save file is yours to keep or delete.',
    ],
  },
  {
    heading: 'When there is an online version',
    paragraphs: [
      'An online version may send your answers to a server to improve the questions. It would ask for your consent again and this notice would be updated first.',
      'Draft terms for that version, to be confirmed: TODO(user): retention period (draft: 24 months), legal basis (draft: consent), and where the data is held.',
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
