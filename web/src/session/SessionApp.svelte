<!--
  The session flow (ROADMAP M1.15; DESIGN §7.4, §10, §13): welcome → consent and 18+ gate → honour code →
  device check and RT input mode → ready (practice, earlier saves) → the session → results and save.
  With a server (`env.backend`, ROADMAP M2.7) two screens join the flow: opening the server session between
  "Begin" and the first part (it can fail, and the person may go on with this device only), and closing it
  after the last (the answers are sent, the server signs the session, the scores of the served parts are
  fetched). Without one (the default build) neither exists and the flow is exactly that of M1.
  Screens keep their state in memory until the person passes the gate: the under-18 path never touches
  storage, and the consent, the autosaver and the restore of earlier saves all come after it.
-->
<script lang="ts">
  import { closeServedRun, type ServedOutcome } from '../backend/flow'
  import { problemOf, type LoadProblem } from '../backend/errors'
  import Closing from '../backend/Closing.svelte'
  import Opening from '../backend/Opening.svelte'
  import { SERVER_GATE_POINTS, SERVER_READY_TEXT } from '../backend/copy'
  import type { ServerSession } from '../backend/session'
  import type { AxisCode } from '../engine/axes'
  import { FOCUS_TARGET_S } from '../reveal/next'
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
  import { SAVE_CTX, TERMS_VERSION, TERMS_VERSION_SERVER } from './constants'
  import { browserSessionEnv, type SessionEnv } from './env'
  import { FAST_BANNER } from './fast'
  import { readConsent, recordConsent } from './gate'
  import { priorItemCounts } from './coverage'
  import { SessionPersister, type AutosaveStatus } from './persist'
  import { PracticeRun } from './practice'
  import { baseOf, defaultReadyState, type ReadyState } from './ready-state'
  import { SessionRun, type ChangeKind, type RunResult } from './run'

  interface Props {
    /** The browser services; tests inject fakes. Default: the real browser (with the dev fast flag). */
    readonly env?: SessionEnv
  }

  let { env = browserSessionEnv() }: Props = $props()

  type Phase = 'welcome' | 'gate' | 'blocked' | 'honour' | 'device' | 'ready' | 'practice' | 'opening' | 'run' | 'closing' | 'finished'

  /** The server of this page, or null: the static fallback, which is the default build. */
  const backend = $derived(env.backend ?? null)
  /** The terms the consent covers: the online version's notice says answers are sent to a server. */
  const terms = $derived(backend === null ? TERMS_VERSION : TERMS_VERSION_SERVER)

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
  // The server session of the run that is under way or just finished (M2.7), and how opening and closing it stand.
  let server: ServerSession | null = $state.raw(null)
  let outcome: ServedOutcome | null = $state.raw(null)
  let openProblem: LoadProblem | null = $state(null)
  let openFocus: readonly AxisCode[] | undefined = undefined
  let closeFailed = $state(false)

  function start(): void {
    // Reading is allowed; nothing is written before the gate is passed.
    phase = readConsent(env.storage(), terms) !== null ? 'honour' : 'gate'
  }

  function agree(): void {
    recordConsent(env.storage(), terms)
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
    // Every practice round keeps its families out of the counted session, not only the last one.
    practiceFamilies = [...new Set([...practiceFamilies, ...practice.familyIds()])]
    phase = 'practice'
  }

  function begin(): void {
    startRun()
  }

  /**
   * Start the session; a focus session (M1.R) runs only the parts of `focus` and lasts 20 minutes. With a
   * server the session is opened there first (M2.7).
   */
  function startRun(focus?: readonly AxisCode[]): void {
    if (device === null) return
    if (backend === null) {
      launch(focus, null)
      return
    }
    void open(focus)
  }

  /** Ask the server for a session; on failure the person chooses (try again, this device only, back). */
  async function open(focus: readonly AxisCode[] | undefined): Promise<void> {
    if (device === null || backend === null) return
    openFocus = focus
    openProblem = null
    phase = 'opening'
    try {
      const s = await backend.open(device, base)
      if (phase === 'opening') launch(focus, s)
    } catch (e) {
      if (phase === 'opening') openProblem = problemOf(e)
    }
  }

  function launch(focus: readonly AxisCode[] | undefined, s: ServerSession | null): void {
    if (device === null) return
    server = s
    outcome = null
    closeFailed = false
    const startedMs = env.wallClockMs()
    const sessionId = newSessionId(startedMs)
    const r = new SessionRun({
      sessionId,
      startedMs,
      now: env.now,
      device,
      rtInput,
      // The ≥ 3-item floor follows the axes the earlier sessions covered, not their number (coverage.ts).
      priorItemCounts: priorItemCounts(base),
      seenFamilies: [...(base?.seen_families ?? []), ...practiceFamilies],
      ...(focus === undefined ? {} : { focus, targetS: FOCUS_TARGET_S }),
      ...(s === null ? {} : { cat: s }),
      onChange: (kind: ChangeKind) => onChange(kind),
    })
    run = r
    result = null
    autosave = 'ok'
    persister = new SessionPersister(r, { base, storage: env.storage(), wallClockMs: env.wallClockMs, onStatus: (st) => (autosave = st), ...(s === null ? {} : { anonId: s.anonId }) })
    persister.schedule()
    if (r.view().ended !== null) {
      // Nothing to run (every part was skipped from the start): straight to the results.
      finishRun(r)
      return
    }
    phase = 'run'
  }

  /**
   * The run ended. With a server it is closed there first (M2.7); then its save is written, the autosaves
   * it makes redundant are dropped, and the results come up.
   */
  function finishRun(r: SessionRun): void {
    persister?.flush()
    if (server === null) {
      showResults(r)
      return
    }
    phase = 'closing'
    closeFailed = false
    void close(r)
  }

  async function close(r: SessionRun): Promise<void> {
    if (server === null || persister === null || backend === null) return
    closeFailed = false
    try {
      outcome = await closeServedRun(r, server, persister, backend.api)
    } catch {
      if (phase === 'closing') closeFailed = true
      return
    }
    if (phase === 'closing') showResults(r)
  }

  /** The person goes on without the server: what it scores shows as not measured, and the save keeps the answers. */
  function continueWithoutServer(r: SessionRun): void {
    if (server !== null) outcome = { server, estimates: null, closed: false }
    showResults(r)
  }

  function showResults(r: SessionRun): void {
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

  /**
   * A 20-minute focus session on the chosen skills (DESIGN §10, ROADMAP M1.R): the session just
   * finished, with everything it holds, is the base of the new one, so the results afterwards are
   * the practice-adjusted re-score of both (R-8.1, §7.8). The gate, the honour code and the device
   * check were done in this visit, so it goes straight to the first part.
   */
  function startFocus(axes: AxisCode[]): void {
    if (persister === null || device === null) return
    const finished = persister.currentSave()
    persister.dispose()
    restored = null
    readyState = { includeFound: false, loaded: finished }
    startRun(axes)
  }

  function restart(): void {
    persister?.dispose()
    persister = null
    run = null
    result = null
    server = null
    outcome = null
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
  <ConsentGate blocked={phase === 'blocked'} onagree={agree} onunder18={under18} points={backend === null ? undefined : SERVER_GATE_POINTS} />
{:else if phase === 'honour'}
  <Honour onagree={() => (phase = 'device')} />
{:else if phase === 'device'}
  <DeviceCheck {env} ondone={deviceDone} />
{:else if phase === 'ready'}
  <Ready
    {restored}
    choices={readyState}
    onchoices={(c) => (readyState = c)}
    onpractice={startPractice}
    onbegin={begin}
    onfocus={(axes) => startRun(axes)}
    text={backend === null ? undefined : SERVER_READY_TEXT}
    verify={backend === null ? undefined : (save) => backend.api.verifySave(save)}
    restore={backend === null ? undefined : (id, phrase) => backend.api.mirrorGet(id, phrase)}
  />
{:else if phase === 'practice' && practice !== null}
  <PracticeScreen {env} {practice} ondone={() => (phase = 'ready')} />
{:else if phase === 'opening'}
  <Opening problem={openProblem} onretry={() => void open(openFocus)} onlocal={() => launch(openFocus, null)} onback={() => (phase = 'ready')} />
{:else if phase === 'run' && run !== null}
  <SessionScreen {env} {run} {autosave} {banner} report={server === null ? undefined : (r) => server!.reportProblem(r)} />
{:else if phase === 'closing' && run !== null}
  <Closing failed={closeFailed} onretry={() => void close(run!)} oncontinue={() => continueWithoutServer(run!)} />
{:else if phase === 'finished' && result !== null && persister !== null}
  <Finished
    {result}
    {outcome}
    sessionId={run?.sessionId}
    makeSave={() => persister!.currentSave()}
    {autosave}
    timing={env.timing}
    onseen={(ids) => persister?.addSeenFamilies(ids)}
    onfocus={startFocus}
    onrestart={restart}
  />
{/if}
