<script lang="ts">
  /**
   * "Notes for your AI" (Phase AI, proposal v2 §3; ROADMAP AI.5, AI.6, AI.7), the builder page. A
   * person picks where they will use the notes, the topics that come up and how much they know of
   * each, a few closed-choice lines, and where to paste; the page writes short, plain notes on the
   * device and offers copy and download. It sends nothing and needs no test results: every line comes
   * from the person's own settings through the deterministic generator in this folder.
   *
   * Nothing is stored until the person says they are 18 or older and asks the page to keep their
   * settings (the under-18 path writes nothing). Then only the settings are kept, through the
   * injected `store` (enums, ids, versions and months; never the interests or lines typed, never the
   * notes; `stored.ts`), and they come back on the next visit with a notice when a line they copied
   * has since been withdrawn or has new wording. The state is the pure model of `builder.ts`; this
   * component only holds it in a rune and wires the buttons.
   */
  import { tick, untrack } from 'svelte'
  import { DISCLAIMER } from '../copy'
  import { copyText as defaultCopy, downloadText as defaultDownload, hexToken } from './browser'
  import { activeExtras, activePrefs, contextLabel, initialState, otherContexts, persistedOf, recordCopied, resetAll, stateFromStored, type BuilderState } from './builder'
  import { buildBrief } from './build'
  import { CLAIM, COPY, DATA_FREE_SNIPPET } from './copy'
  import { DEFAULT_GATES, type GateFile } from './gates'
  import { asFile, renderJson } from './render'
  import { copiedRecordOf, returningNotices, type CopiedSet } from './returning'
  import { fromStored, toStored } from './stored'
  import type { NotesStore, StoreStatus } from './store-types'
  import { destination, downloadName, resolveForm } from './surfaces'
  import About from './ui/About.svelte'
  import Checker from './ui/Checker.svelte'
  import ExtrasPicker from './ui/ExtrasPicker.svelte'
  import Paste from './ui/Paste.svelte'
  import Preview from './ui/Preview.svelte'
  import Returning from './ui/Returning.svelte'
  import SaveSettings from './ui/SaveSettings.svelte'
  import TopicPicker from './ui/TopicPicker.svelte'
  import WherePicker from './ui/WherePicker.svelte'

  interface Props {
    /** Month the notes are written, `YYYY-MM` (the page passes the current month; tests pass a fixed one). */
    asOf: string
    /** Random part of download file names, so a file never collides with an earlier download. */
    token: string
    /** Today, `YYYY-MM-DD`, for the out-of-date warning on the install steps (default: the first day of `asOf`). */
    today?: string
    gates?: GateFile
    /** The settings read back from storage on load (`stateFromStored`); the page passes them with `keepInitial`. */
    initial?: BuilderState
    /** Where settings are kept (`brief-store/persist.ts`); `null` when the page has no place to keep them. */
    store?: NotesStore | null
    /** The settings came from storage, so they are being kept and the 18+ question was answered before. */
    keepInitial?: boolean
    /** The person already confirmed they are 18 or older elsewhere (the session's consent gate), so the question is not asked again. */
    adultKnown?: boolean
    /** Six random hex digits for a fit note's id (default: the browser's crypto). */
    fitId?: () => string
    /** Injected in tests; the page uses the browser's clipboard and a Blob download. */
    copy?: (text: string) => Promise<boolean>
    download?: (text: string, name: string, mime: string) => string
  }
  let {
    asOf,
    token,
    today = `${asOf}-01`,
    gates = DEFAULT_GATES,
    initial,
    store = null,
    keepInitial = false,
    adultKnown = false,
    fitId = () => hexToken(6),
    copy = defaultCopy,
    download = defaultDownload,
  }: Props = $props()

  let model = $state<BuilderState>(untrack(() => initial ?? initialState()))
  let keep = $state(untrack(() => keepInitial && store !== null))
  let storeStatus = $state<StoreStatus>('ok')
  let status = $state('')
  let moreStatus = $state('')
  let keepMessage = $state('')
  let loadMessage = $state('')
  /** After "Remove my notes settings": the device still holds a save, so a fresh download of it is offered (proposal §3.3 "Removing"). */
  let freshSave = $state(false)

  const prefs = $derived(activePrefs(model))
  const extras = $derived(activeExtras(model))
  const dest = $derived(destination(prefs.destination) ?? (destination('just_me') as NonNullable<ReturnType<typeof destination>>))
  const form = $derived(resolveForm(dest, prefs.form))
  // T2 (every topic) only takes effect once its warning has been acknowledged.
  const effective = $derived(prefs.tier === 'T2' && !model.t2Confirmed ? { ...prefs, tier: 'T1' as const } : prefs)
  const result = $derived(buildBrief({ prefs: effective, extras, form, asOf, gates, otherContexts: otherContexts(model) }))
  const shown = $derived(dest.output === 'json' ? renderJson(result.brief) : result.text)
  const fileName = $derived(downloadName(dest, form, asOf, token))
  const sets = $derived<CopiedSet[]>(model.contexts.flatMap((c, i) => (model.copied[i] ? [{ label: contextLabel(c), copied: model.copied[i] as NonNullable<(typeof model.copied)[number]> }] : [])))
  const notices = $derived(returningNotices(sets, gates, today))
  const mime = $derived(dest.output === 'json' ? 'application/json' : form === 'short' ? 'text/plain' : 'text/markdown')

  /** The settings as they are kept, without the month (which moves on by itself) so an unchanged page writes nothing. */
  const stored = $derived(toStored(persistedOf(model), asOf))
  const fingerprint = (p: ReturnType<typeof toStored>): string => JSON.stringify({ ...p, notes_as_of: '' })
  let lastWritten = untrack(() => (keep ? fingerprint(stored) : ''))
  $effect(() => {
    if (!keep || store === null) return
    const now = fingerprint(stored)
    if (now === lastWritten) return
    lastWritten = now
    untrack(() => store.write(stored))
  })
  // Writes land a moment after `write`; the store says how they went.
  $effect(() => store?.onStatus((s) => (storeStatus = s)))

  /** Announce politely; the message is cleared first so the same text is announced again. */
  async function announce(set: (m: string) => void, message: string): Promise<void> {
    set('')
    await tick()
    set(message)
  }

  function selectNotes(): void {
    const el = document.getElementById('notes-text')
    const sel = window.getSelection()
    if (!el || !sel) return
    const range = document.createRange()
    range.selectNodeContents(el)
    sel.removeAllRanges()
    sel.addRange(range)
  }

  /** What was written for this set, remembered with its settings so a later visit can say if a line was withdrawn. */
  function noteCopied(): void {
    model = recordCopied(model, copiedRecordOf(result.brief.lines, asOf))
  }

  async function onCopy(): Promise<void> {
    const ok = await copy(shown)
    if (!ok) selectNotes()
    else noteCopied()
    await announce((m) => (status = m), ok ? COPY.copied : COPY.copyFailed)
  }
  function onDownload(): void {
    const name = download(asFile(shown), fileName, mime)
    noteCopied()
    void announce((m) => (status = m), COPY.downloaded(name))
  }
  async function onCopyCommands(text: string): Promise<void> {
    const ok = await copy(text)
    await announce((m) => (status = m), ok ? COPY.copied : COPY.copyFailed)
  }
  async function onCopySnippet(): Promise<void> {
    const ok = await copy(DATA_FREE_SNIPPET)
    await announce((m) => (moreStatus = m), ok ? COPY.copied : COPY.copyFailed)
  }
  function onDownloadCard(svg: string): void {
    const name = download(`${svg}\n`, 'hb-control-words.svg', 'image/svg+xml')
    void announce((m) => (moreStatus = m), COPY.downloaded(name))
  }
  function onDownloadForAi(text: string): void {
    const name = download(`${text}\n`, 'for-ai.md', 'text/markdown')
    void announce((m) => (moreStatus = m), COPY.downloaded(name))
  }

  /** The 18+ answer was given: from now on the settings are kept, and written straight away. */
  function onKeep(): void {
    if (store === null) return
    keep = true
    freshSave = false
    lastWritten = ''
    void announce((m) => (keepMessage = m), COPY.keepNow)
  }
  function onDownloadSettings(): void {
    if (store === null) return
    const name = store.download(stored)
    void announce((m) => (keepMessage = m), COPY.downloaded(name))
  }
  async function onLoad(input: Blob | string): Promise<void> {
    if (store === null) {
      void announce((m) => (loadMessage = m), COPY.keepNowhere)
      return
    }
    const r = await store.importSave(input, stored)
    if (!r.ok) {
      void announce((m) => (loadMessage = m), r.none === true ? COPY.loadNone : r.message)
      return
    }
    if (r.unchanged === true) {
      void announce((m) => (loadMessage = m), COPY.loadSame)
      return
    }
    const read = fromStored(r.prefs)
    if (read === null) {
      void announce((m) => (loadMessage = m), COPY.loadNone)
      return
    }
    model = stateFromStored(read, model)
    void announce((m) => (loadMessage = m), COPY.loadDone)
  }
  function onRemove(): void {
    freshSave = store?.remove() === true
    keep = false
    lastWritten = ''
    model = resetAll()
    status = ''
    keepMessage = ''
    void announce((m) => (moreStatus = m), COPY.removeDone)
  }
  /** A save of what the device still holds, without the notes settings (they were just removed). */
  function onDownloadFresh(): void {
    if (store === null) return
    try {
      const name = store.download(null)
      void announce((m) => (moreStatus = m), COPY.downloaded(name))
    } catch {
      freshSave = false
      void announce((m) => (moreStatus = m), COPY.removeNoSave)
    }
  }
  const change = (next: BuilderState): void => {
    model = next
  }
</script>

<main>
  <header>
    <h1>{COPY.title}</h1>
    <p class="lead">{COPY.lead}</p>
    <p class="note" data-testid="trust">{COPY.trust}</p>
    <p data-testid="claim">{CLAIM}</p>
    <p>{COPY.instructionsNotTraits} {COPY.noResultsYet}</p>
    <p class="hint" data-testid="not-saved">{COPY.notSaved}</p>
  </header>

  <Returning {notices} />

  <WherePicker {model} onchange={change} />
  <TopicPicker {model} {gates} month={asOf} {fitId} {keep} onchange={change} />
  <ExtrasPicker {model} onchange={change} />
  <Preview {model} {result} {shown} {form} {dest} {gates} onchange={change} />
  <Paste
    {model}
    {dest}
    {form}
    lineIds={result.brief.lines.map((l) => l.id)}
    {fileName}
    {today}
    {status}
    onchange={change}
    oncopy={() => void onCopy()}
    ondownload={onDownload}
    oncopycommands={(t) => void onCopyCommands(t)}
  />
  <SaveSettings
    {keep}
    available={store !== null && store.available}
    canDownload={store !== null}
    status={storeStatus}
    {adultKnown}
    message={keepMessage}
    {loadMessage}
    onkeep={onKeep}
    ondownload={onDownloadSettings}
    onload={(i) => void onLoad(i)}
  />
  <Checker {gates} {today} />
  <About
    keywords={result.brief.keywords}
    stored={store !== null}
    {freshSave}
    status={moreStatus}
    oncopysnippet={() => void onCopySnippet()}
    ondownloadcard={onDownloadCard}
    ondownloadforai={onDownloadForAi}
    onremove={onRemove}
    ondownloadfresh={onDownloadFresh}
  />
</main>

<footer>
  <p class="disclaimer">{DISCLAIMER}</p>
</footer>

<style>
  main {
    box-sizing: border-box;
    width: 100%;
    max-width: 46rem;
    margin: 0 auto;
    padding: 1.5rem 1rem 2rem;
    flex: 1;
  }
  header h1 {
    margin: 0 0 0.5rem;
    font-size: clamp(1.75rem, 6vw, 2.5rem);
    color: var(--text-strong);
  }
  .lead {
    font-size: 1.1rem;
  }
  main :global(section) {
    margin: 2.5rem 0;
  }
  main :global(h2) {
    font-size: 1.4rem;
    color: var(--text-strong);
    margin: 0 0 0.5rem;
  }
  main :global(h3) {
    font-size: 1.1rem;
    color: var(--text-strong);
    margin: 1.5rem 0 0.5rem;
  }
  footer {
    border-top: 1px solid var(--border);
    padding: 1rem;
    text-align: center;
  }
  .disclaimer {
    margin: 0 auto;
    max-width: 40rem;
    font-size: 0.875rem;
  }
</style>
