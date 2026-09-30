<script lang="ts">
  /**
   * "Notes for your AI" (Phase AI, proposal v2 §3; ROADMAP AI.5), the builder page. A person picks
   * where they will use the notes, the topics that come up and how much they know of each, a few
   * closed-choice lines, and where to paste; the page writes short, plain notes on the device and
   * offers copy and download. It sends nothing, stores nothing and needs no test results: every
   * line comes from the person's own settings through the deterministic generator in this folder.
   *
   * The builder runs without storage until the 18+ gate (M1.15) and `brief_prefs` (AI.7) exist, so
   * the under-18 path trivially writes nothing. The state is the pure model of `builder.ts`; this
   * component only holds it in a rune and wires the buttons.
   */
  import { tick } from 'svelte'
  import { DISCLAIMER } from '../copy'
  import { copyText as defaultCopy, downloadText as defaultDownload } from './browser'
  import { activeExtras, activePrefs, initialState, otherContexts, resetAll, type BuilderState } from './builder'
  import { buildBrief } from './build'
  import { CLAIM, COPY, DATA_FREE_SNIPPET } from './copy'
  import { DEFAULT_GATES, type GateFile } from './gates'
  import { asFile, renderJson } from './render'
  import { destination, downloadName, resolveForm } from './surfaces'
  import About from './ui/About.svelte'
  import ExtrasPicker from './ui/ExtrasPicker.svelte'
  import Paste from './ui/Paste.svelte'
  import Preview from './ui/Preview.svelte'
  import TopicPicker from './ui/TopicPicker.svelte'
  import WherePicker from './ui/WherePicker.svelte'

  interface Props {
    /** Month the notes are written, `YYYY-MM` (the page passes the current month; tests pass a fixed one). */
    asOf: string
    /** Random part of download file names, so a file never collides with an earlier download. */
    token: string
    gates?: GateFile
    /** Injected in tests; the page uses the browser's clipboard and a Blob download. */
    copy?: (text: string) => Promise<boolean>
    download?: (text: string, name: string, mime: string) => string
  }
  let { asOf, token, gates = DEFAULT_GATES, copy = defaultCopy, download = defaultDownload }: Props = $props()

  let model = $state<BuilderState>(initialState())
  let status = $state('')
  let moreStatus = $state('')

  const prefs = $derived(activePrefs(model))
  const extras = $derived(activeExtras(model))
  const dest = $derived(destination(prefs.destination) ?? (destination('just_me') as NonNullable<ReturnType<typeof destination>>))
  const form = $derived(resolveForm(dest, prefs.form))
  // T2 (every topic) only takes effect once its warning has been acknowledged.
  const effective = $derived(prefs.tier === 'T2' && !model.t2Confirmed ? { ...prefs, tier: 'T1' as const } : prefs)
  const result = $derived(buildBrief({ prefs: effective, extras, form, asOf, gates, otherContexts: otherContexts(model) }))
  const shown = $derived(dest.output === 'json' ? renderJson(result.brief) : result.text)
  const fileName = $derived(downloadName(dest, form, asOf, token))
  const mime = $derived(dest.output === 'json' ? 'application/json' : form === 'short' ? 'text/plain' : 'text/markdown')

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

  async function onCopy(): Promise<void> {
    const ok = await copy(shown)
    if (!ok) selectNotes()
    await announce((m) => (status = m), ok ? COPY.copied : COPY.copyFailed)
  }
  function onDownload(): void {
    const name = download(asFile(shown), fileName, mime)
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
  function onRemove(): void {
    model = resetAll()
    status = ''
    void announce((m) => (moreStatus = m), COPY.removeDone)
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
    <p class="hint">{COPY.notSaved}</p>
  </header>

  <WherePicker {model} onchange={change} />
  <TopicPicker {model} {gates} onchange={change} />
  <ExtrasPicker {model} onchange={change} />
  <Preview {model} {result} {shown} {form} {dest} {gates} onchange={change} />
  <Paste
    {model}
    {dest}
    {form}
    lineIds={result.brief.lines.map((l) => l.id)}
    {fileName}
    {status}
    onchange={change}
    oncopy={() => void onCopy()}
    ondownload={onDownload}
    oncopycommands={(t) => void onCopyCommands(t)}
  />
  <About
    keywords={result.brief.keywords}
    status={moreStatus}
    oncopysnippet={() => void onCopySnippet()}
    ondownloadcard={onDownloadCard}
    ondownloadforai={onDownloadForAi}
    onremove={onRemove}
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
