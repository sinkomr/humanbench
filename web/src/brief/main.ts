/**
 * Entry of the notes builder page, `<base>notes.html` (Phase AI, ROADMAP AI.5). The page passes the
 * current day (the only clock reading, through the one module allowed to read the wall clock; the
 * month dates the notes, the day tells whether the install steps are out of date) and a random
 * file-name token; everything else is the deterministic generator. It has no network use. It reads
 * the settings kept on this device (if the person kept any on an earlier visit) and hands the page
 * the store that keeps them; nothing is written until the person says they are 18 or older (or has
 * already passed the session's gate, M1.15) and asks to keep their settings (AI.7,
 * `brief-store/persist.ts`).
 */
import { mount } from 'svelte'
import '../app.css'
import { createPrefsStore } from '../brief-store/persist'
import { utcSeconds, wallClockMs } from '../save/clock'
import { readAdultConsent } from '../session/gate'
import { fileToken } from './browser'
import { stateFromStored } from './builder'
import NotesBuilder from './NotesBuilder.svelte'
import { fromStored } from './stored'
import './notes.css'

const target = document.getElementById('app')
if (!target) throw new Error('HumanBench: #app mount point missing')

const now = wallClockMs()
const today = utcSeconds(now).slice(0, 10)
const asOf = today.slice(0, 7)
// A browser without crypto still gets a name that is unlikely to repeat. Digits only, like the letters-never-touch rule of
// fileToken: a base-36 clock could spell a word the language lint bans (A13).
let token: string
try {
  token = fileToken()
} catch {
  token = String(now).slice(-4)
}
// What the device holds: reading storage is not writing it.
const store = createPrefsStore({ wallClockMs })
const read = fromStored(store.load().prefs)
// A person who passed the session's 18+ and terms gate (M1.15, `hb:consent:v1`) is not asked again (AI.5). Reading the record writes nothing,
// and the under-18 path never stores one, so that person is still asked here before anything is kept.
const adultKnown = readAdultConsent() !== null // read from the same place the store reads
const app = mount(NotesBuilder, { target, props: { asOf, token, today, store, adultKnown, ...(read === null ? {} : { initial: stateFromStored(read), keepInitial: true }) } })

export default app
