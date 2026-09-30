/**
 * Page copy of the notes builder (proposal §3.3, §3.7, §6 "Copy drafts"; requirements R-17.8,
 * R-17.10). All of it is scanned by the A13 language lint like any other source. The copy-claim
 * rule (A22) applies: until F18/F19 pass in pre-registered studies, no screen says or implies that
 * the notes help; every notes screen carries {@link CLAIM}.
 */

/** A22: shown on every notes screen until the effectiveness checks pass. */
export const CLAIM = 'Designed from research on explanations; not yet shown to help HumanBench users.'

export const COPY = {
  title: 'Notes for your AI',
  lead: 'Make short, plain notes here and paste them into your own AI assistant, so it explains things the way you want, topic by topic.',
  instructionsNotTraits: 'The notes are instructions about wording, depth and checking. They never describe you, and they carry no numbers, levels or labels.',
  trust: "Nothing on this page leaves your device. HumanBench doesn't send, store or log your notes. Copying them into an assistant is your choice.",
  notSaved: 'This page keeps nothing on your device either. If you reload it, your settings are gone.',
  providerWarning:
    "Before you paste: anything in an AI assistant's settings goes to that company with every chat. Depending on your settings it may be kept for years, used to train future models, read by reviewers, or used to personalise ads. On work or school accounts, administrators may be able to read it. Check your assistant's data settings, prefer a personal account, and only include lines you'd be fine with anyone reading. (Checked 2026-09.)",
  antiCoercion:
    "This is yours. No employer, school or app should ask you for it, and you can always say no. HumanBench results aren't valid for decisions about hiring, admissions, grades, or anything like them.",
  placement:
    'Put these in your personal settings, a personal Project, or your own rules folder. Never put them in a file inside a shared repository. Prefer instructions over memory: memory features rewrite what you give them.',
  science: 'Measured science lines need many more people to take HumanBench first. Until then, set these topics yourself.',
  interests: "Hobbies or subjects you like. Don't add health details or anything personal. This is never saved.",
  customHint: 'One line of your own, in plain words. It is checked before it is used, and never saved.',
  remove: 'Remove my notes settings. This deletes your notes preferences from this device. Your results stay. Download a fresh save afterwards if you keep one elsewhere.',
  removeDone: 'Your notes settings were removed from this page.',
  fitLog: 'Your fit notes change only these suggestions. They never change your results.',
  copied: 'Copied to the clipboard.',
  copyFailed: 'Copying was blocked. The notes are selected above; copy them yourself.',
  downloaded: (name: string): string => `Downloaded ${name}.`,
  troubleshooting: 'Your assistant may not be reading your notes. Check that they are in your personal instructions, not in a chat message, and start a new chat.',
  fileHint: "If your browser saved it under a different name, for example with (1) added, use that name.",
  memoryNote: 'If you ever pasted the notes into a chat message, also review that assistant\'s memory and delete anything that describes you.',
  noResultsYet: 'For now these notes use your own settings only. Lines based on your answers are not available yet, because they need checks that only real results can provide.',
} as const

export const STEPS = {
  where: { heading: 'Where will you use these notes?', hint: 'Pick one. You can keep up to five sets of notes, each for a different use.' },
  topics: {
    heading: 'Which topics come up there?',
    hint: 'Pick up to five. For each one, say how much you already know, and your notes tell the assistant how to pitch its explanations.',
  },
  extras: { heading: 'Anything else?', hint: 'All optional. Each choice becomes one plain line.' },
  preview: { heading: 'Your notes', hint: 'This is exactly what will be pasted. Untick a line to leave it out.' },
  paste: { heading: 'Where to paste', hint: 'Pick where the notes will live. The steps below are for that place.' },
} as const

/** Labels for a topic setting: what the person says about themselves is their own words here, not in the notes. */
export const SETTING_LABELS: Readonly<Record<'skip' | 'ask_first' | 'build', { label: string; hint: string }>> = {
  skip: { label: 'I know this well', hint: 'Skip the basics.' },
  ask_first: { label: 'Not sure', hint: 'Ask me one quick question first.' },
  build: { label: 'New to me', hint: 'Start from an example and show every step.' },
}

export const DATA_FREE_SNIPPET = [
  '## Explanations',
  'People on this project may keep personal explanation preferences in their own user-level instructions. Follow them when explaining in chat; they change wording and depth only, never accuracy, and never apply to code, comments or documents in this repository. Never copy them into this repository.',
].join('\n')
