<!--
  The reveal (DESIGN §10 "Reveal flow"; ROADMAP M1.R), from the save's practice-adjusted results:
  1. the blob builds up skill by skill (`RevealProfile`), with "practice-adjusted" on it;
  2. your most distinctive peaks (credible ones only, A12);
  3. the cluster drill-down (inside the profile view, below the peaks);
  4. the save file: prominent, and required before leaving. A `beforeunload` warning guards the
     tab until it is downloaded or shared, and leaving through "Back to the start" asks first. The
     20-minute focus session also leaves the results, so its form waits for the save too. The
     panel is a screen or two down, so while it is not saved one line at the top of the results
     says so and leads to it (UX-029), and "Stay and save" takes focus to its download button;
  5. once saved: the share card (`ShareCard.svelte`, M1.18: hide any skill, PNG / SVG, never an
     emotion low), "Notes for your AI" and the results-talk helper;
  then three worked examples, what another session would buy (with 20-minute focus sessions and the
  7-day advice), rough external norms and the separate Pace note, and the results footer with the
  R-5.6.5 resource line (the allow-listed constant, here and nowhere else; never on a share card).
  The top of the page is compact and the page is one column (UX-REVIEW D16, `RevealProfile`, `reveal.css`): the h1,
  the lines under it and every panel share one left edge. The save panel keeps its place in this order.
  The §13 disclaimer is in the page footer of every screen (`App.svelte`).
  Nothing here shows a total, an average or a single score for the person (CLAUDE.md blob rule).
-->
<script lang="ts">
  import { onMount, tick, type ComponentProps, type Snippet } from 'svelte'
  import type { AxisCode } from '../engine/axes'
  import type { RendererTiming } from '../render/common/props'
  import type { ShareOutcome } from '../save/io'
  import type { SaveFileV1 } from '../save/types'
  import ConfirmPanel from '../session/ConfirmPanel.svelte'
  import { FINISHED_AGAIN } from '../session/copy'
  import type { AutosaveStatus } from '../session/persist'
  import { RESOURCE_LINE } from '../copy'
  import { axisEstimates } from '../viz/profile'
  import AfterSave from './AfterSave.svelte'
  import { LEAVE_HEADING, LEAVE_NO, LEAVE_TEXT, LEAVE_YES, SAVE_PENDING, SAVE_POINTER, SAVE_POINTER_LINK } from './copy'
  import { installUnloadGuard } from './guard'
  import NumbersSection from './NumbersSection.svelte'
  import { typicalSessions } from './next'
  import { normFacts, paceByAxis } from './norms'
  import PeaksSection from './PeaksSection.svelte'
  import { distinctivePeaks } from './peaks'
  import RetestSection from './RetestSection.svelte'
  import RevealProfile from './RevealProfile.svelte'
  import { scoredSessions, type ResultsModel } from './results'
  import SavePanel from './SavePanel.svelte'
  import ShareCard from './ShareCard.svelte'
  import { SAVE_HEADING_ID } from './slots'
  import WorkedSection from './WorkedSection.svelte'
  import { pickWorkedItems } from './worked'
  import './reveal.css'

  interface Props {
    readonly results: ResultsModel
    /** The save at the end of the session (the norms, the pace and the worked examples read it). */
    readonly save: SaveFileV1
    readonly sessionId: string
    /** The CURRENT save to hand over: it includes the families of the worked examples. */
    readonly makeSave: () => SaveFileV1
    readonly autosave: AutosaveStatus
    /** rAF + clock of the build-up (the flow's own, so `?fast=1` speeds it up). */
    readonly timing?: RendererTiming
    readonly motion?: 'auto' | 'reduce' | 'full'
    /** The worked examples' families: they are left out of later sessions (§7.7). */
    readonly onseen: (familyIds: string[]) => void
    /** Start a 20-minute focus session on these skills. */
    readonly onfocus?: (axes: AxisCode[]) => void
    readonly onrestart: () => void
    /** The notes builder page (default `slots.ts` NOTES_BUILDER_HREF). */
    readonly notesHref?: string
    readonly takerComparison?: boolean
    readonly download?: (save: SaveFileV1) => string
    readonly copyCode?: (save: SaveFileV1) => Promise<{ code: string; copied: boolean }>
    readonly share?: (save: SaveFileV1) => Promise<ShareOutcome>
    readonly canShare?: boolean
    readonly copyText?: (text: string) => Promise<boolean>
    /** What an online session adds under the save (ROADMAP M2.7): the server's check, the backup, the survey. Absent without a server. */
    readonly online?: Snippet
    /** Injectable for tests: how the share card makes and hands over its images (`ShareCard.svelte`). */
    readonly card?: Pick<ComponentProps<typeof ShareCard>, 'makePng' | 'download' | 'shareFile' | 'canShare' | 'prepareMs' | 'today'>
  }

  let {
    results,
    save,
    sessionId,
    makeSave,
    autosave,
    timing,
    motion = 'auto',
    onseen,
    onfocus,
    onrestart,
    notesHref,
    takerComparison,
    download,
    copyCode,
    share,
    canShare,
    copyText,
    online,
    card,
  }: Props = $props()

  let built = $state(false)
  let saved = $state(false)
  let leaving = $state(false)
  let restartButton: HTMLButtonElement | undefined = $state()
  let savePanel: SavePanel | undefined = $state()

  const estimates = $derived(axisEstimates(results.input))
  const measured = $derived(estimates.filter((e) => e.measured).map((e) => e.code))
  const peaks = $derived(distinctivePeaks(results.rescore, measured))
  const facts = $derived(normFacts(save))
  const pace = $derived(paceByAxis(save))
  const worked = $derived(pickWorkedItems(sessionId, save.seen_families))
  // The shrinkage line speaks for the profile: a focus session on one part is not one more session for the rest.
  const sessions = $derived(Math.max(1, typicalSessions(results.rescore.next_ordinals, measured)))

  // The tab is guarded until the save is downloaded or shared (§10).
  $effect(() => {
    if (saved) return
    return installUnloadGuard()
  })

  // The examples shown must not come up as counted questions in a later session (§7.7).
  onMount(() => {
    if (worked.length > 0) onseen(worked.flatMap((w) => w.families))
  })

  function leave(): void {
    if (saved) onrestart()
    else leaving = true
  }

  // "Stay and save": the person stays to save, so focus (and the view) goes to the download button, not back to the
  // button at the bottom that opened the question (WCAG 2.4.3). Without a panel (still building) it goes back there.
  async function stay(): Promise<void> {
    leaving = false
    await tick()
    if (savePanel?.focusDownload()) return
    restartButton?.focus()
  }

  // The pointer's link: focus the save panel's heading, which scrolls it into view. Without the panel the anchor works as a plain link.
  function goToSave(event: MouseEvent): void {
    if (savePanel?.focusHeading()) event.preventDefault()
  }
</script>

<div class="hb-reveal" data-saved={saved} data-built={built}>
  {#if !saved}
    <!-- Not a status: the first status of the reveal is "Your profile is ready." (the drivers read it). Hidden, but
         taking its room, until the build-up ends, so the chart does not jump when it appears. -->
    <div class="hb-reveal-panel save-pointer" data-save-pointer data-ready={built}>
      <p>{SAVE_POINTER}</p>
      {#if built}
        <a href="#{SAVE_HEADING_ID}" onclick={goToSave}>{SAVE_POINTER_LINK}</a>
      {:else}
        <!-- No link yet (there is nothing to follow while the line is hidden), but the room it will take: the chart under it
             must not move when the build-up ends (D16). -->
        <span class="link-room" aria-hidden="true">{SAVE_POINTER_LINK}</span>
      {/if}
    </div>
  {/if}
  <RevealProfile
    input={results.input}
    facetObservations={results.facetObservations}
    facetPrecomputed={results.servedFacets}
    practiceAdjusted={results.practiceAdjusted}
    frames={timing?.frames}
    {motion}
    onbuilt={() => (built = true)}
  >
    {#snippet between()}
      {#if built}
        <PeaksSection {peaks} measured={measured.length} />
      {/if}
    {/snippet}
  </RevealProfile>

  {#if built}
    <SavePanel bind:this={savePanel} {makeSave} {autosave} {saved} onsaved={() => (saved = true)} {download} {copyCode} {share} {canShare} />
    {#if online}
      {@render online()}
    {/if}
    {#if saved}
      <AfterSave {notesHref} {copyText}>
        {#snippet shareCard()}
          <ShareCard {estimates} score={results.rescore} sessions={scoredSessions(results)} {...card} />
        {/snippet}
      </AfterSave>
    {:else}
      <div class="hb-reveal-panel"><p class="note" data-pending>{SAVE_PENDING}</p></div>
    {/if}
    <WorkedSection items={worked} />
    <RetestSection {estimates} {sessions} {onfocus} focusLocked={!saved} />
    <NumbersSection {facts} {pace} {takerComparison} />
  {/if}

  <div class="hb-reveal-panel leave">
    {#if leaving && !saved}
      <!-- The safe answer, "Stay and save", comes first and in the primary style; Escape means it too (§10, UX-005b).
           A save made while the question is open answers it: it goes, and "Back to the start" then leaves at once. -->
      <ConfirmPanel heading={LEAVE_HEADING} text={LEAVE_TEXT} yes={LEAVE_YES} no={LEAVE_NO} primary="no" onyes={onrestart} onno={() => void stay()} />
    {:else}
      <div class="hb-actions">
        <button type="button" class="hb-btn" bind:this={restartButton} onclick={leave}>{FINISHED_AGAIN}</button>
      </div>
    {/if}
  </div>

  <footer class="hb-reveal-panel results-footer" data-section="results-footer">
    <p class="note">{RESOURCE_LINE}</p>
  </footer>
</div>

<style>
  .hb-reveal {
    display: flex;
    flex-direction: column;
    min-width: 0;
  }
  .results-footer {
    border-top: 1px solid var(--r-border);
    margin-top: 2rem;
    padding-top: 1rem;
  }
  .save-pointer {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 0 1rem;
    margin: 0 auto 0.75rem;
    padding: 0.25rem 0.75rem;
    border-left: 4px solid var(--r-accent);
    border-radius: 0.5rem;
    background: var(--r-surface);
  }
  .save-pointer[data-ready='false'] {
    visibility: hidden;
  }
  .save-pointer p {
    margin: 0;
    padding: 0.5rem 0;
  }
  .save-pointer a,
  .save-pointer .link-room {
    display: inline-flex;
    align-items: center;
    min-height: 2.75rem;
    color: var(--r-accent);
    font-weight: 600;
  }
</style>
