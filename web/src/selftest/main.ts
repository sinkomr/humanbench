/**
 * Entry of the RT timing self-test page, `<base>rt-selftest.html` (ROADMAP M1.23; DESIGN §11.6).
 * `?quick=1` runs small samples (the e2e smoke test); the report says so.
 */
import { mount } from 'svelte'
import '../app.css'
import RtSelfTest from './RtSelfTest.svelte'

const target = document.getElementById('app')
if (!target) throw new Error('HumanBench: #app mount point missing')

const quick = new URLSearchParams(window.location.search).get('quick') === '1'

const app = mount(RtSelfTest, { target, props: { quick } })

export default app
