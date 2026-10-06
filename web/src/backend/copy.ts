/**
 * Copy of the online version (ROADMAP M2.7; DESIGN §8, §13, §17.5 R-17.1, R-17.12; ROADMAP AI.26).
 * Plain, second-person and non-diagnostic (A13, R-5.6.x): it says what is sent, what stays, and
 * what the person can do about it, and never what a result means about them. The static version's
 * words (`session/copy.ts`) say that nothing is uploaded, which is false here, so the screens that
 * say it take their words from this file when the app has a server.
 *
 * The controller's name and contact, the retention period and the legal basis are the user's to
 * confirm before any data-collecting deploy (PROGRESS "Needs you"); the placeholders are marked
 * `TODO(user)` as in the static notice.
 */

import type { LoadProblem } from './errors'

// ------------------------------------------------------------------------- gate and ready

/** The three points of the consent gate when answers go to a server (replaces `GATE_POINTS`). */
export const SERVER_GATE_POINTS: readonly string[] = Object.freeze([
  'You must be 18 or older to take part.',
  'Your answers to the counted questions, your response times and coarse details of your device are sent to a server while you take part, so that your answers can be scored there and the questions can be improved. They are linked to a random identifier, not to your name, your email address or your network address. You can ask for them to be deleted at any time.',
  'This is for curiosity and self-reflection. It is not a basis for decisions about school, work or health.',
])

/** Replaces `READY_TEXT` when answers go to a server. */
export const SERVER_READY_TEXT =
  'Six short parts, about 30 minutes. Your progress is saved in this browser as you go, and your answers to the counted questions are sent to the server as you give them. After each answer to a question you will say how sure you are.'

// ----------------------------------------------------------------------------- opening

export const OPENING_HEADING = 'Getting your session ready'
export const OPENING_TEXT = 'Connecting to the server…'
export const OPENING_RETRY = 'Try again'
export const OPENING_LOCAL = 'Use this device only'
export const OPENING_LOCAL_NOTE = 'Then your answers stay in this browser and in your save file, and nothing is sent to the server.'
export const OPENING_BACK = 'Back'
export const OPENING_PROBLEM: Readonly<Record<LoadProblem, string>> = Object.freeze({
  offline: 'We could not reach the server. Check your connection and try again.',
  pace: 'The server asks for a little more time. Wait a few seconds and try again.',
  busy: 'The server has reached a limit for now. For example, several sessions may have been started today from this network. Please try again later.',
  ended: 'The server could not start a session.',
})

// ------------------------------------------------------------------------------ waiting

export const LOADING_TEXT = 'Getting your next question…'
export const LOADING_RETRY = 'Try again'
export const LOADING_PROBLEM: Readonly<Record<LoadProblem, string>> = Object.freeze({
  offline: 'We could not reach the server. Your answers so far are kept, and the clock is stopped. Check your connection and try again.',
  pace: 'The server asks for a little more time between answers. The clock is stopped. Wait a few seconds and try again.',
  busy: 'The server is busy. The clock is stopped. Wait a moment and try again.',
  ended: 'The server session has ended, so this part cannot go on. You can skip it, or finish with what you have.',
})

// ------------------------------------------------------------------------------ closing

export const CLOSING_HEADING = 'Saving your answers'
export const CLOSING_TEXT = 'Sending your last answers to the server and getting your scores…'
export const CLOSING_PROBLEM = 'We could not reach the server to finish your session.'
export const CLOSING_RETRY = 'Try again'
export const CLOSING_CONTINUE = 'Continue without the server'
export const CLOSING_CONTINUE_NOTE =
  'The parts the server scores will show as not measured. Your answers to them are in your save file, but the server cannot check them later.'

// ---------------------------------------------------------------------------- unverified

export const VERIFY_HEADING = 'What the server could check'
export const VERIFY_NOTE =
  'A session is checked when the server issued it and it has not been changed since. A session it could not check still counts in your own results, but the test never uses it. Changing your notes settings does not affect this.'
export const verifiedLine = (n: number): string => `${n} ${n === 1 ? 'session was' : 'sessions were'} checked by the server.`
export const unverifiedLine = (n: number): string => `${n} ${n === 1 ? 'session was' : 'sessions were'} not checked.`
export const VERIFY_REASON: Readonly<Record<'unsigned' | 'bad_signature' | 'unknown_key' | 'malformed', string>> = Object.freeze({
  unsigned: 'made on this device, without the server',
  bad_signature: 'changed since the server saved it, or saved under another identifier',
  unknown_key: 'saved with a key the server no longer uses',
  malformed: 'could not be read as a session',
})
export const VERIFY_LOCAL_ONLY = 'The timed tasks of this session stay on your device, so they are not checked.'
export const VERIFY_UNAVAILABLE = 'The server could not check these sessions just now.'

// --------------------------------------------------------------------- report a problem

export const REPORT_BUTTON = 'Report a problem'
export const REPORT_HEADING = 'Report a problem'
export const REPORT_LEGEND = 'What is wrong?'
export const REPORT_KINDS: Readonly<Record<'wrong_key' | 'ambiguous' | 'typo' | 'offensive' | 'broken' | 'notes_requested', string>> = Object.freeze({
  wrong_key: 'I think the answer this question expects is wrong',
  ambiguous: 'More than one answer could be right, or it is unclear what is asked',
  typo: 'There is a typo or something is missing',
  offensive: 'It is offensive or unfair',
  broken: 'It does not display or work properly',
  notes_requested: 'Someone asked me for my notes',
})
/** Shown when "Someone asked me for my notes" is chosen: it is not about a question, and nothing is kept with it. */
export const REPORT_NOTES_NOTE = 'This is not about a question. It tells us that someone asked you for your notes. We keep no details with it.'
export const REPORT_DETAIL_LABEL = 'Tell us more (optional, up to 500 characters). Please do not include personal details.'
export const REPORT_SEND = 'Send report'
export const REPORT_CANCEL = 'Cancel'
export const REPORT_DONE = 'Thank you. The report was sent.'
export const REPORT_FAILED = 'The report could not be sent. Please try again.'
export const REPORT_ITEM_NOTE = 'The report names this question and nothing else about you.'
export const REPORT_RESULTS_HEADING = 'Something else?'
export const REPORT_RESULTS_TEXT = 'If someone asked you for your notes, or for your save file, you can tell us here. You never have to share either.'

// --------------------------------------------------------------------------------- survey

export const SURVEY_HEADING = 'Two optional questions'
export const SURVEY_LEAD =
  'These help us check that the questions are fair to people of different backgrounds. They are optional, kept apart from your answers, and never shown with your results.'
export const SURVEY_AGE_LEGEND = 'Your age group'
export const SURVEY_ENGLISH_LEGEND = 'Is English your first language?'
export const SURVEY_NO_ANSWER = 'Prefer not to say'
export const SURVEY_YES = 'Yes'
export const SURVEY_NO = 'No'
export const SURVEY_SEND = 'Send'
export const SURVEY_SKIP = 'No thanks'
export const SURVEY_THANKS = 'Thank you.'
export const SURVEY_NOTHING = 'Nothing was chosen, so nothing was sent.'
export const SURVEY_FAILED = 'The answers could not be sent just now. You can skip this.'
export const SURVEY_SKIPPED = 'Skipped. Nothing was sent.'

// ----------------------------------------------------------------------------------- mirror

export const MIRROR_HEADING = 'Keep a backup on the server (optional)'
export const MIRROR_TEXT =
  'Store a copy of your save file on the server, so that you can get it back on another device. You get a recovery phrase of 12 words, shown once. There are no accounts and no email: the phrase and your save identifier are the only way back, and we cannot recover either for you.'
export const MIRROR_ID_LABEL = 'Your save identifier'
export const MIRROR_ID_NOTE = 'To get the backup back you need this identifier and the recovery phrase. The identifier is also in your save file, as anon_id. It does not work without the phrase.'
export const MIRROR_BUTTON = 'Keep a backup on the server'
export const MIRROR_UPDATE_BUTTON = 'Update my backup'
export const MIRROR_HAVE = 'I already have a backup'
export const MIRROR_PHRASE_LABEL = 'Recovery phrase of your backup'
export const MIRROR_WORKING = 'Sending your backup…'
export const MIRROR_PHRASE_HEADING = 'Your recovery phrase'
export const MIRROR_PHRASE_WARNING = 'Write it down or keep it in a password manager now. It is shown once and cannot be shown again.'
export const MIRROR_PHRASE_COPY = 'Copy phrase'
export const MIRROR_PHRASE_COPIED = 'Phrase copied.'
export const MIRROR_PHRASE_COPY_FAILED = 'The phrase could not be copied automatically. Select it above and copy it yourself.'
export const MIRROR_PHRASE_SAFE = 'I have kept the phrase somewhere safe.'
export const MIRROR_PHRASE_DONE = 'Done'
export const MIRROR_STORED = 'Your backup is on the server. Keep your recovery phrase.'
export const MIRROR_UPDATED = 'Your backup was updated.'
export const MIRROR_WRONG_PHRASE = 'That phrase does not match your backup.'
export const MIRROR_EXISTS = 'A backup already exists for this save. Enter its recovery phrase to update it.'
export const MIRROR_FAILED = 'The backup could not be stored just now. Your downloaded save file is not affected.'
export const MIRROR_FULL = 'The server is not taking new backups right now. Your downloaded save file is not affected.'
export const MIRROR_TOO_LARGE = 'Your save file is too large for the server backup. Keep your downloaded file.'

// ------------------------------------------------------------------------------- data page

export const DATA_HEADING = 'Your data on the server'
export const DATA_LINK = 'Your data on the server'
export const DATA_BACK = 'Back'
export const DATA_STATIC =
  'This version of HumanBench keeps nothing on a server. Your answers are in this browser and in the save files you downloaded. You can delete what this browser holds on the privacy page.'
export const DATA_INTRO =
  'Your sessions are stored on the server under a random identifier that starts with hb_. You can get a backup you made back, and you can delete everything stored for an identifier. There are no accounts: a recovery phrase or a save file the server issued is the proof.'
export const DATA_RESTORE_HEADING = 'Get my backup back'
export const DATA_ID_LABEL = 'Save identifier (starts with hb_)'
export const DATA_PHRASE_LABEL = 'Recovery phrase (12 words)'
export const DATA_RESTORE_BUTTON = 'Get my backup'
/** Names the screen that has the load control, as the results' spacing advice does (reveal SPACING_TEXT, UX-056). */
export const DATA_RESTORE_FOUND = 'Found your backup. Download it, then press Start and load it on the "Ready when you are" screen to add a new session to it.'
export const DATA_RESTORE_DOWNLOAD = 'Download the backup'
export const DATA_RESTORE_NONE = 'Nothing matched that identifier and phrase.'
export const DATA_DELETE_HEADING = 'Delete my data from the server'
export const DATA_DELETE_TEXT =
  'This deletes every session and the backup stored for an identifier. It cannot be undone. Save files you downloaded stay with you, and so does anything in this browser.'
export const DATA_DELETE_WITH_PHRASE = 'With my identifier and recovery phrase'
export const DATA_DELETE_WITH_FILE = 'With a save file'
export const DATA_FILE_LABEL = 'Save file'
export const DATA_CODE_LABEL = 'Or paste a save code'
export const DATA_DELETE_BUTTON = 'Delete my data'
export const DATA_DELETE_CONFIRM_HEADING = 'Delete for good?'
export const DATA_DELETE_CONFIRM_YES = 'Delete my data'
export const DATA_DELETE_CONFIRM_NO = 'Keep it'
export const DATA_DELETE_NEED = 'Enter your identifier and recovery phrase, or choose a save file.'
export const dataDeleted = (sessions: number, mirror: boolean): string =>
  `Deleted ${sessions} ${sessions === 1 ? 'session' : 'sessions'}${mirror ? ' and the backup' : ''}.`
export const DATA_DELETE_NONE = 'Nothing was deleted. The phrase or the file did not match anything stored.'
export const DATA_FAILED = 'The server could not be reached. Please try again.'
export const DATA_LIMITED = 'Too many tries from this network today. Please try again tomorrow.'

// ----------------------------------------------------------------------------- privacy

export interface PrivacySectionText {
  readonly heading: string
  readonly paragraphs: readonly string[]
}

/**
 * The privacy notice and terms of the online version (DESIGN §13 "GDPR/CCPA basics"). It replaces
 * the static notice's "What this version keeps / Where it stays / When there is an online version".
 * The controller, contact, retention and legal basis are the user's to confirm (`TODO(user)`) before
 * any deploy that collects data (PROGRESS "Needs you").
 */
export const SERVER_PRIVACY_SECTIONS: readonly PrivacySectionText[] = Object.freeze([
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
      'It also keeps a random identifier that starts with hb_. It is not linked to your name, your email address or your network address, and this site does not ask for any of them. The server’s hosting provider sees network addresses in its own logs, as every web host does; HumanBench does not store them with your answers. To limit abuse, the server keeps a scrambled (hashed) form of your network address, apart from your answers, for about two days.',
    ],
  },
  {
    heading: 'What is sent to the server',
    paragraphs: [
      'Your answers to the counted questions of the parts Matrix & Series, Spatial and Quantitative Reasoning are sent to the server as you give them, with your response times, how sure you said you were, and the device details above. The server scores them where the answers are kept, so your browser never learns whether a counted answer was right.',
      'The timed tasks of the parts Reaction Time, Working Memory and Processing & Reading Speed stay on your device. They are in your save file and are not sent unless you choose to keep a backup of that file on the server.',
      'If you report a problem, the report names the question and, if you write it, the text you add. Please do not include personal details. If you answer the two optional questions at the end, the answers are kept apart from your other data and are used only to check that the questions are fair.',
    ],
  },
  {
    heading: 'Your notes settings stay on your device',
    paragraphs: [
      'If you use “Notes for your AI”, your notes settings stay on your device. They are never sent to the server, they are left out of the server backup, and editing them never changes whether the server accepts your sessions. The server refuses a request that contains them.',
    ],
  },
  {
    heading: 'Your save file and the server backup',
    paragraphs: [
      'The server signs each session it records, so a save file can show that a session is as the server saved it. A session that is not signed, or was changed, still counts in your own results, but it is never used to improve the test.',
      'You can keep a backup of your save file on the server. You get a recovery phrase of 12 words, shown once. The server keeps only a one-way fingerprint of the phrase, so it cannot give the phrase back. There are no accounts and no email.',
      'Nobody should ask you for your save file or your notes, and they are not valid for decisions about hiring, admissions, grades or anything like them.',
    ],
  },
  {
    heading: 'How long it is kept, and your rights',
    paragraphs: [
      'Draft terms, to be confirmed: TODO(user): retention period (draft: 24 months), legal basis (draft: consent), and where the data is held (draft: a region the user chooses, in the EU or the US).',
      'You can ask for everything stored for your identifier to be deleted at any time, on the page “Your data on the server”, with your recovery phrase or a save file the server issued. Deleting from the server does not touch the save files you downloaded or what this browser holds.',
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
