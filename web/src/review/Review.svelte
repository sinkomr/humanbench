<!--
  G7 procedural review page and renderer gallery (DESIGN §4.4; ROADMAP M1.G7, M1.13). DEV ONLY:
  served by `npm run review` (vite dev) at review.html and never part of a production build
  (`scripts/review-build.test.ts`). For every registered family it lists 30 instances (seeds
  `review-<family>-<i>`), each rendered with the family's renderer, with its key and checks; the
  reviewer's verdicts persist in localStorage and export as `hb.g7_review.v1` JSON (`verdicts.ts`).
  URL: `?family=<name>&page=<n>&per=<1|5|10|30>`.
-->
<script lang="ts">
  import type { AnyFamily } from '../tasks/family'
  import InstanceCard from './InstanceCard.svelte'
  import { plannedFamilies, rendererFor, reviewFamilies, reviewInstances } from './instances'
  import {
    REVIEW_PER_FAMILY,
    REVIEW_STORAGE_KEY,
    buildExport,
    emptyStore,
    isReviewer,
    mergeStores,
    nowUtc,
    parseStore,
    storeFromExport,
    summarize,
    withVerdict,
    type ReviewStore,
    type Verdict,
  } from './verdicts'

  const PER_OPTIONS = [1, 5, 10, 30] as const
  /** Visible verdict marks on the instance chips (§13: never colour alone). */
  const VERDICT_MARKS: Readonly<Record<Verdict, string>> = { pass: '✓', fail: '✗', unsure: '?' }
  /** Visual renderers may hold a WebGL context each (rotation); browsers keep about 16 alive. */
  const MAX_VISUAL_PER = 10

  const families = reviewFamilies()
  const planned = plannedFamilies()

  function readStore(): ReviewStore {
    try {
      return parseStore(localStorage.getItem(REVIEW_STORAGE_KEY))
    } catch {
      return emptyStore()
    }
  }

  function param(name: string): string | null {
    try {
      return new URLSearchParams(location.search).get(name)
    } catch {
      return null
    }
  }

  const initialFamily = families.find((f) => f.name === param('family')) ?? families[0]
  const initialPer = PER_OPTIONS.find((p) => String(p) === param('per')) ?? 5

  let store: ReviewStore = $state(readStore())
  let familyName: string = $state(initialFamily?.name ?? '')
  let per: number = $state(initialPer)
  let page: number = $state(Math.max(1, Math.floor(Number(param('page') ?? '1')) || 1))
  let status = $state('')
  let fileInput: HTMLInputElement | undefined = $state()

  const family: AnyFamily | undefined = $derived(families.find((f) => f.name === familyName))
  const instances = $derived(family ? reviewInstances(family) : [])
  const renderer = $derived(rendererFor(familyName))
  const perPage = $derived(renderer?.source === 'visual' ? Math.min(per, MAX_VISUAL_PER) : per)
  const pages = $derived(Math.max(1, Math.ceil(REVIEW_PER_FAMILY / perPage)))
  const current = $derived(Math.min(Math.max(page, 1), pages))
  const shown = $derived(instances.slice((current - 1) * perPage, current * perPage))
  const summaries = $derived(summarize(store, planned))
  // Every verdict records who gave it (§12 human_audit.by), so none is taken before a name is entered.
  const hasReviewer = $derived(isReviewer(store.reviewer))

  $effect(() => {
    const q = new URLSearchParams({ family: familyName, page: String(current), per: String(per) })
    try {
      history.replaceState(null, '', `${location.pathname}?${q.toString()}`)
    } catch {
      // Not in a browser context (tests): the URL is a convenience only.
    }
  })

  function persist(next: ReviewStore, message: string): void {
    store = next
    try {
      localStorage.setItem(REVIEW_STORAGE_KEY, JSON.stringify(next))
      status = message
    } catch (e) {
      status = `Could not save to this browser's storage (${e instanceof Error ? e.message : String(e)}). Export to keep your verdicts.`
    }
  }

  function setVerdict(index: number, verdict: Verdict | null, note: string): void {
    const inst = instances[index - 1]
    if (!family || !inst || !inst.ok) return
    if (verdict !== null && !hasReviewer) {
      status = 'Enter your name as the reviewer first: each verdict records who gave it.'
      return
    }
    const item = inst.item
    persist(
      withVerdict(
        store,
        item.item_id,
        verdict === null
          ? null
          : {
              item_id: item.item_id,
              family: item.family,
              generator_version: item.generator_version,
              seed: item.seed,
              family_id: item.family_id,
              sibling_group: item.sibling_group,
              verdict,
              note,
              reviewer: store.reviewer,
              reviewed_utc: nowUtc(),
            },
      ),
      verdict === null ? `Cleared #${index}.` : `Saved #${index}: ${verdict}.`,
    )
  }

  function verdictOf(itemId: string | undefined) {
    return itemId === undefined ? undefined : store.verdicts[itemId]
  }

  function exportJson(): void {
    if (!hasReviewer) {
      status = 'Enter your name as the reviewer before exporting.'
      return
    }
    const stamp = nowUtc()
    const doc = buildExport(store, planned, stamp)
    const blob = new Blob([`${JSON.stringify(doc, null, 2)}\n`], { type: 'application/json' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `hb-g7-review-${stamp.replace(/[-:]/g, '').replace('T', '-').replace('Z', '')}.json`
    document.body.appendChild(a)
    a.click()
    a.remove()
    setTimeout(() => URL.revokeObjectURL(url), 1000)
    status = `Exported ${doc.verdicts.length} verdicts.`
  }

  async function importJson(event: Event): Promise<void> {
    const file = (event.currentTarget as HTMLInputElement).files?.[0]
    if (!file) return
    try {
      const incoming = storeFromExport(await file.text())
      persist(mergeStores(store, incoming), `Imported ${Object.keys(incoming.verdicts).length} verdicts.`)
    } catch (e) {
      status = `Import failed: ${e instanceof Error ? e.message : String(e)}`
    }
    if (fileInput) fileInput.value = ''
  }

  function clearAll(): void {
    if (!confirm('Remove every stored verdict from this browser? Export first to keep them.')) return
    persist({ ...emptyStore(), reviewer: store.reviewer }, 'All verdicts removed.')
  }

  function setReviewer(event: Event): void {
    persist({ ...store, reviewer: (event.currentTarget as HTMLInputElement).value.trim() }, 'Reviewer saved.')
  }

  function chooseFamily(name: string, event: MouseEvent): void {
    event.preventDefault()
    familyName = name
    page = 1
  }

  function goTo(index: number, event: MouseEvent): void {
    event.preventDefault()
    page = Math.ceil(index / perPage)
    requestAnimationFrame(() => document.getElementById(`inst-${index}`)?.scrollIntoView())
  }
</script>

<header class="top">
  <h1>Procedural item review (G7)</h1>
  <p class="lede">
    Development page, not part of the site. DESIGN §4.4: audit {REVIEW_PER_FAMILY} instances per family per generator version (seeds
    review-&lt;family&gt;-1 to {REVIEW_PER_FAMILY}). Check each item as shown against its key and checks, then mark it pass, fail or
    unsure. Verdicts stay in this browser until you export them.
  </p>
  <div class="toolbar">
    <label>Reviewer <input type="text" value={store.reviewer} onchange={setReviewer} autocomplete="off" /></label>
    {#if !hasReviewer}<span class="need">Enter your name to record verdicts.</span>{/if}
    <button type="button" class="btn" onclick={exportJson}>Export JSON</button>
    <label class="btn file">Import JSON <input bind:this={fileInput} type="file" accept="application/json,.json" onchange={(e) => void importJson(e)} /></label>
    <button type="button" class="btn" onclick={clearAll}>Clear all</button>
  </div>
  <p class="status" role="status">{status}</p>
</header>

<nav aria-label="Families">
  <ul class="families">
    {#each summaries as s (s.family)}
      {@const fam = families.find((f) => f.name === s.family)}
      <li>
        <a href="?family={s.family}&page=1&per={per}" aria-current={s.family === familyName ? 'page' : undefined} onclick={(e) => chooseFamily(s.family, e)}>
          {s.family}
        </a>
        <span class="count">{s.reviewed}/{s.planned}{s.fail > 0 ? `, ${s.fail} fail` : ''}{s.unsure > 0 ? `, ${s.unsure} unsure` : ''}</span>
        <span class="kind">{fam?.kind} · v{s.generator_version}{rendererFor(s.family) ? '' : ' · JSON view'}</span>
      </li>
    {/each}
  </ul>
</nav>

<main>
  {#if family}
    <h2>{family.name} <span class="sub">{family.kind}, axis {family.axis}, generator {family.generatorVersion}</span></h2>
    <nav aria-label="Instances of {family.name}">
      <ol class="index">
        {#each instances as inst (inst.index)}
          {@const v = verdictOf(inst.ok ? inst.item.item_id : undefined)}
          <li>
            <a href="#inst-{inst.index}" class="chip {v?.verdict ?? 'open'}" onclick={(e) => goTo(inst.index, e)}>
              {inst.index}{#if v}<span class="mark" aria-hidden="true">{VERDICT_MARKS[v.verdict]}</span>{/if}<span class="hb-sr-only"
                >: {v?.verdict ?? (inst.ok ? 'not reviewed' : 'failed to generate')}</span
              >
            </a>
          </li>
        {/each}
      </ol>
    </nav>
    <div class="pager">
      <label>Per page
        <select bind:value={per} onchange={() => (page = 1)}>
          {#each PER_OPTIONS as p (p)}<option value={p}>{p}</option>{/each}
        </select>
      </label>
      <button type="button" class="btn" disabled={current <= 1} onclick={() => (page = current - 1)}>Previous</button>
      <span>Page {current} of {pages}</span>
      {#if perPage < per}<span>(at most {MAX_VISUAL_PER} per page for this renderer)</span>{/if}
      <button type="button" class="btn" disabled={current >= pages} onclick={() => (page = current + 1)}>Next</button>
    </div>
    {#key `${familyName}:${current}:${perPage}`}
      {#each shown as inst (inst.index)}
        <div id="inst-{inst.index}" class="anchor">
          <InstanceCard
            {family}
            instance={inst}
            {renderer}
            record={verdictOf(inst.ok ? inst.item.item_id : undefined)}
            canMark={hasReviewer}
            onverdict={(v, note) => setVerdict(inst.index, v, note)}
          />
        </div>
      {/each}
    {/key}
  {:else}
    <p>No families are registered.</p>
  {/if}
</main>

<style>
  :global(body) {
    color: var(--text);
  }

  .top,
  main,
  nav {
    padding: 0 1rem;
    max-width: 90rem;
    margin: 0 auto;
    width: 100%;
    box-sizing: border-box;
  }

  h1 {
    margin: 1rem 0 0.5rem;
    color: var(--text-strong);
    font-size: 1.5rem;
  }

  h2 {
    color: var(--text-strong);
    font-size: 1.25rem;
    margin: 1rem 0 0.5rem;
  }

  .sub {
    font-size: 0.9375rem;
    font-weight: 400;
  }

  .lede {
    max-width: 50rem;
    margin: 0 0 0.75rem;
  }

  .toolbar,
  .pager {
    display: flex;
    flex-wrap: wrap;
    gap: 0.5rem 1rem;
    align-items: center;
  }

  .toolbar input[type='text'] {
    font: inherit;
    min-height: 2.25rem;
    color: var(--text-strong);
    background: var(--bg);
    border: 1px solid var(--text);
    border-radius: 0.375rem;
    padding: 0 0.5rem;
  }

  .btn {
    display: inline-flex;
    align-items: center;
    min-height: 2.75rem;
    padding: 0.375rem 0.875rem;
    font: inherit;
    color: var(--text-strong);
    background: var(--bg);
    border: 1px solid var(--text);
    border-radius: 0.375rem;
    cursor: pointer;
    box-sizing: border-box;
  }

  .btn:disabled {
    opacity: 0.6;
    cursor: not-allowed;
  }

  .file input {
    position: absolute;
    width: 1px;
    height: 1px;
    opacity: 0;
  }

  .file:focus-within {
    outline: 3px solid #b45309;
    outline-offset: 2px;
  }

  .status {
    min-height: 1.5em;
    margin: 0.5rem 0;
  }

  .families {
    display: flex;
    flex-wrap: wrap;
    gap: 0.5rem;
    list-style: none;
    padding: 0;
    margin: 0.5rem 0;
  }

  .families li {
    display: grid;
    padding: 0.375rem 0.75rem;
    border: 1px solid var(--border);
    border-radius: 0.5rem;
  }

  .families a {
    font-weight: 600;
    color: var(--text-strong);
  }

  .families a[aria-current='page'] {
    text-decoration-thickness: 3px;
  }

  .count,
  .kind {
    font-size: 0.8125rem;
  }

  .index {
    display: flex;
    flex-wrap: wrap;
    gap: 0.25rem;
    list-style: none;
    padding: 0;
    margin: 0.5rem 0;
  }

  .chip {
    display: inline-grid;
    grid-auto-flow: column;
    gap: 0.125rem;
    place-items: center;
    min-width: 2.75rem;
    min-height: 2.75rem;
    border-radius: 0.375rem;
    border: 2px solid var(--border);
    color: var(--text-strong);
    text-decoration: none;
    font-variant-numeric: tabular-nums;
    box-sizing: border-box;
  }

  .mark {
    font-weight: 700;
  }

  .need {
    font-weight: 600;
  }

  .chip.pass {
    border-color: #0a6b2f;
    border-style: solid;
    background: #d9f2e2;
    color: #06381a;
  }

  .chip.fail {
    border-color: #b42318;
    background: #fde2df;
    color: #5c1109;
  }

  .chip.unsure {
    border-color: #8a4b00;
    border-style: dashed;
    background: #fdf0d5;
    color: #452600;
  }

  .anchor {
    scroll-margin-top: 1rem;
  }

  .hb-sr-only {
    position: absolute;
    width: 1px;
    height: 1px;
    overflow: hidden;
    clip: rect(0, 0, 0, 0);
    white-space: nowrap;
  }

  :global(:focus-visible) {
    outline: 3px solid #b45309;
    outline-offset: 2px;
  }
</style>
