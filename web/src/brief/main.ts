/**
 * Entry of the notes builder page, `<base>notes.html` (Phase AI, ROADMAP AI.5). The page passes the
 * current month (the only clock reading, through the one module allowed to read the wall clock) and
 * a random file-name token; everything else is the deterministic generator. It has no network use
 * and no storage.
 */
import { mount } from 'svelte'
import '../app.css'
import { utcSeconds, wallClockMs } from '../save/clock'
import { fileToken } from './browser'
import NotesBuilder from './NotesBuilder.svelte'
import './notes.css'

const target = document.getElementById('app')
if (!target) throw new Error('HumanBench: #app mount point missing')

const now = wallClockMs()
const asOf = utcSeconds(now).slice(0, 7)
// A browser without crypto still gets a name that is unlikely to repeat.
let token: string
try {
  token = fileToken()
} catch {
  token = now.toString(36).slice(-4)
}
const app = mount(NotesBuilder, { target, props: { asOf, token } })

export default app
