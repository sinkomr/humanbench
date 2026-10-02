/**
 * The two notes strings of the M2 save screens (ROADMAP AI.26, M2.7; DESIGN §17.7 rows `anti-coercion`
 * and `mirror`), word for word, so the save dialog and the server backup panel can carry them without
 * pulling the builder's copy (`copy.ts`) or the grammar into the main app. Pinned to the DESIGN table
 * and to the builder's own copy by `save-copy.test.ts`. They pass the A13 language lint like any source.
 */

/** The save dialog carries this (R-17.10): the save file, like the notes, is the person's to keep. */
export const ANTI_COERCION =
  "This is yours. No employer, school or app should ask you for it, and you can always say no. HumanBench results aren't valid for decisions about hiring, admissions, grades, or anything like them."

/** The server backup panel says this (R-17.1, R-17.12): the notes settings are not in the backup. */
export const MIRROR_NOTE = "Your server backup doesn't include your notes settings. Keep your downloaded save if you want them on another device."
