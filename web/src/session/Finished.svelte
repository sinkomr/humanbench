<!--
  The end of a session (ROADMAP M1.15, M1.R; DESIGN §10 "Reveal flow"): why it ended, what it
  covered, and the reveal (`reveal/Reveal.svelte`): the profile builds up skill by skill, the
  distinctive peaks, the drill-down, the required save file with its leave-guard, and then the
  share card (M1.18), the notes cards, three worked examples, the retest advice and the results footer.
  The results are the practice-adjusted re-score of the WHOLE save (`reveal/results.ts`, M1.Q), so a
  returning person sees all their sessions together. A save with nothing scored shows no profile,
  and still offers the file.
-->
<script lang="ts">
  import type { ComponentProps } from 'svelte'
  import { servedSessionIds, type ServedOutcome } from '../backend/flow'
  import ServedPanels from '../backend/ServedPanels.svelte'
  import type { AxisCode } from '../engine/axes'
  import type { RendererTiming } from '../render/common/props'
  import type { ShareOutcome } from '../save/io'
  import type { SaveFileV1 } from '../save/types'
  import Reveal from '../reveal/Reveal.svelte'
  import SavePanel from '../reveal/SavePanel.svelte'
  import { buildResults } from '../reveal/results'
  import Screen from './Screen.svelte'
  import { FINISHED_AGAIN, FINISHED_EMPTY, FINISHED_HEADING, FINISHED_REASON, summaryLine } from './copy'
  import type { AutosaveStatus } from './persist'
  import type { RunResult } from './run'

  interface Props {
    readonly result: RunResult
    /** The server session the run had (ROADMAP M2.7), or null/absent in the static fallback. */
    readonly outcome?: ServedOutcome | null
    /** The session's id (the worked examples are drawn from it, so a reload shows the same ones). */
    readonly sessionId?: string
    /** The save file to hand over (base ∪ this session), made when asked so it is current. */
    readonly makeSave: () => SaveFileV1
    readonly autosave: AutosaveStatus
    readonly onrestart: () => void
    /** Start a 20-minute focus session on these skills (the flow). */
    readonly onfocus?: (axes: AxisCode[]) => void
    /** The worked examples' families, to be left out of later sessions (§7.7). */
    readonly onseen?: (familyIds: string[]) => void
    /** The flow's rAF and clock (`?fast=1` speeds the build-up up). */
    readonly timing?: RendererTiming
    readonly motion?: 'auto' | 'reduce' | 'full'
    readonly notesHref?: string
    /** Injectable for tests. */
    readonly download?: (save: SaveFileV1) => string
    readonly copyCode?: (save: SaveFileV1) => Promise<{ code: string; copied: boolean }>
    readonly share?: (save: SaveFileV1) => Promise<ShareOutcome>
    readonly canShare?: boolean
    readonly copyText?: (text: string) => Promise<boolean>
    /** Injectable for tests: how the share card makes and hands over its images. */
    readonly card?: ComponentProps<typeof Reveal>['card']
  }

  let {
    result,
    outcome = null,
    sessionId = 's_unknown',
    makeSave,
    autosave,
    onrestart,
    onfocus,
    onseen = () => undefined,
    timing,
    motion,
    notesHref,
    download,
    copyCode,
    share,
    canShare,
    copyText,
    card,
  }: Props = $props()

  // Made once, when the results appear: the save is complete now.
  const save = $derived(makeSave())
  // The sessions the server scores are scored there, not here (R-11.1); the page shows what it returned.
  const results = $derived(buildResults(save, outcome === null ? undefined : { sessionIds: servedSessionIds(save, outcome.server.sessionId), estimates: outcome.estimates }))

  const items = $derived(Object.values(result.itemsByAxis).reduce<number>((n, c) => n + (c ?? 0), 0))
  const minutes = $derived(Math.max(1, Math.round(result.durationS / 60)))
  let saved = $state(false)
</script>

<Screen title={FINISHED_HEADING} wide>
  <p class="lead">{result.reason === null ? '' : FINISHED_REASON[result.reason]}</p>
  <p>{summaryLine(items, result.blocks.length, minutes)}</p>

  {#if results === null}
    <p>{FINISHED_EMPTY}</p>
    <SavePanel {makeSave} {autosave} {saved} onsaved={() => (saved = true)} {download} {copyCode} {share} {canShare} />
    {#if outcome !== null}
      <ServedPanels {outcome} {makeSave} {copyText} />
    {/if}
    <div class="hb-actions">
      <button type="button" class="hb-btn" onclick={onrestart}>{FINISHED_AGAIN}</button>
    </div>
  {:else}
    <Reveal
      {results}
      {save}
      {sessionId}
      {makeSave}
      {autosave}
      {timing}
      {motion}
      {onseen}
      {onfocus}
      {onrestart}
      {notesHref}
      {download}
      {copyCode}
      {share}
      {canShare}
      {copyText}
      {card}
      online={outcome === null ? undefined : online}
    />
  {/if}
</Screen>

{#snippet online()}
  {#if outcome !== null}
    <ServedPanels {outcome} {makeSave} {copyText} />
  {/if}
{/snippet}
