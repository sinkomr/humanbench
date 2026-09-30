<!--
  The session flow (ROADMAP M1.15; DESIGN §7.4, §10, §13): welcome → consent and 18+ gate → honour code →
  device check and RT input mode → ready (practice, earlier saves) → the session → results and save.
  Screens keep their state in memory until the person passes the gate: the under-18 path never touches
  storage, and the consent, the autosaver and the restore of earlier saves all come after it.
-->
<script lang="ts">
  import { pruneAutosaves, restoreAutosaves, type RestoreResult } from '../save/autosave'
  import { newSessionId } from '../save/ids'
  import type { DeviceInfo, SaveFileV1 } from '../save/types'
  import type { RtInputMode } from '../render/rt/keys'
  import ConsentGate from './ConsentGate.svelte'
  import DeviceCheck from './DeviceCheck.svelte'
  import Finished from './Finished.svelte'
  import Honour from './Honour.svelte'
  import PracticeScreen from './PracticeScreen.svelte'
  import Ready from './Ready.svelte'
  import SessionScreen from './SessionScreen.svelte'
  import Welcome from './Welcome.svelte'
  import { SAVE_CTX } from './constants'
  import { browserSessionEnv, type SessionEnv } from './env'
  import { FAST_BANNER } from './fast'
  import { readConsent, recordConsent } from './gate'
  import { SessionPersister, type AutosaveStatus } from './persist'
  import { PracticeRun } from './practice'
  import { baseOf, defaultReadyState, type ReadyState } from './ready-state'
  import { SessionRun, type ChangeKind, type RunResult } from './run'

  interface Props {
    /** The browser services; tests inject fakes. Default: the real browser (with the dev fast flag). */
    readonly env?: SessionEnv
  }

  let { env = browserSessionEnv() }: Props = $props()

  type Phase = 'welcome' | 'gate' | 'blocked' | 'honour' | 'device' | 'ready' | 'practice' | 'run' | 'finished'

  // The dev banner exists in the bundle only where the fast flag can be on (`fast.ts`).
  const banner = $derived(__HB_DEV_ROUTES__ && env.scale > 1 ? FAST_BANNER : '')

  let phase: Phase = $state('welcome')
  let device: DeviceInfo | null = $state.raw(null)
  let rtInput: RtInputMode = $state('keyboard')
  let restored: RestoreResult | null = $state.raw(null)
  let readyState: ReadyState = $state.raw(defaultReadyState(null))
  const base: SaveFileV1 | null = $derived(baseOf(restored, readyState))
  let practice: PracticeRun | null = $state.raw(null)
  let practiceFamilies: string[] = []
  let run: SessionRun | null = $state.raw(null)
  let result: RunResult | null = $state.raw(null)
  let persister: SessionPersister | null = $state.raw(null)
  let autosave: AutosaveStatus = $state('ok')

  function start(): void {
    // Reading is allowed; nothing is written before the gate is passed.
    phase = readConsent(env.storage()) !== null ? 'honour' : 'gate'
  }

  function agree(): void {
    recordConsent(env.storage())
    phase = 'honour'
  }

  function under18(): void {
    // The under-18 path keeps nothing: no consent record, no autosave, no flag.
    phase = 'blocked'
  }

  function deviceDone(info: DeviceInfo, input: RtInputMode): void {
    device = info
    rtInput = input
    restored = restoreAutosaves(SAVE_CTX, env.storage())
    readyState = defaultReadyState(restored)
    phase = 'ready'
  }

  function startPractice(): void {
    practice = new PracticeRun(newSessionId(env.wallClockMs()))
    practiceFamilies = practice.familyIds()
    phase = 'practice'
  }

  function begin(): void {
    if (device === null) return
    const startedMs = env.wallClockMs()
    const sessionId = newSessionId(startedMs)
    const r = new SessionRun({
      sessionId,
      startedMs,
      now: env.now,
      device,
      rtInput,
      sessionNumber: (base?.sessions.length ?? 0) + 1,
      seenFamilies: [...(base?.seen_families ?? []), ...practiceFamilies],
      onChange: (kind: ChangeKind) => onChange(kind),
    })
    run = r
    result = null
    autosave = 'ok'
    persister = new SessionPersister(r, { base, storage: env.storage(), wallClockMs: env.wallClockMs, onStatus: (s) => (autosave = s) })
    persister.schedule()
    if (r.view().ended !== null) {
      // Nothing to run (every part was skipped from the start): straight to the results.
      finishRun(r)
      return
    }
    phase = 'run'
  }

  /** The run ended: its save is written, the autosaves it makes redundant are dropped, and the results come up. */
  function finishRun(r: SessionRun): void {
    persister?.flush()
    if (persister !== null && persister.status === 'ok') pruneAutosaves(persister.currentSave(), env.storage(), persister.key)
    result = r.result()
    phase = 'finished'
  }

  function onChange(kind: ChangeKind): void {
    if (kind === 'phase') return
    persister?.schedule()
    if (kind === 'finish' && run !== null) finishRun(run)
  }

  function restart(): void {
    persister?.dispose()
    persister = null
    run = null
    result = null
    practice = null
    practiceFamilies = []
    restored = null
    readyState = defaultReadyState(null)
    phase = 'welcome'
  }
</script>

{#if phase === 'welcome'}
  <Welcome onstart={start} />
{:else if phase === 'gate' || phase === 'blocked'}
  <ConsentGate blocked={phase === 'blocked'} onagree={agree} onunder18={under18} />
{:else if phase === 'honour'}
  <Honour onagree={() => (phase = 'device')} />
{:else if phase === 'device'}
  <DeviceCheck {env} ondone={deviceDone} />
{:else if phase === 'ready'}
  <Ready {restored} choices={readyState} onchoices={(c) => (readyState = c)} onpractice={startPractice} onbegin={begin} />
{:else if phase === 'practice' && practice !== null}
  <PracticeScreen {env} {practice} ondone={() => (phase = 'ready')} />
{:else if phase === 'run' && run !== null}
  <SessionScreen {env} {run} {autosave} {banner} />
{:else if phase === 'finished' && result !== null && persister !== null}
  <Finished {result} makeSave={() => persister!.currentSave()} {autosave} onrestart={restart} />
{/if}
