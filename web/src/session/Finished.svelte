<!--
  The end of a session (ROADMAP M1.15, M1.R; DESIGN §10 "Reveal flow"): why it ended, what it
  covered, and the reveal (`reveal/Reveal.svelte`): the profile builds up skill by skill, the
  distinctive peaks, the drill-down, the required save file with its leave-guard, and then the
  share card (M1.18), the notes cards, three worked examples, the retest advice and the results footer.
  The results are the practice-adjusted re-score of the WHOLE save (`reveal/results.ts`, M1.Q), so a
  returning person sees all their sessions together. A save with nothing scored shows no profile and is
  headed "Session ended" (UX-009b); it still offers the file, behind a closed disclosure so that the way
  back is the one obvious action (UX-009a). The lines above the profile say what the profile rests on: the parts skipped on the way,
  and how many sessions it combines. Opened from the ready screen with no new session (`result` null, UX-010)
  it is the same results page under the heading "Your results".
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
  import {
    FINISHED_AGAIN,
    FINISHED_ALL_SKIPPED,
    FINISHED_EMPTY,
    FINISHED_EMPTY_HEADING,
    FINISHED_EMPTY_SAVE,
    FINISHED_HEADING,
    FINISHED_REASON,
    FINISHED_VIEW_HEADING,
    combinesLine,
    noNewAnswersLine,
    reachedEndLine,
    summaryLine,
    viewLine,
  } from './copy'
  import type { AutosaveStatus } from './persist'
  import type { RunResult } from './run'
  import { SEGMENT_INFO, skipTargetName } from './segments'

  interface Props {
    /** What the session did, or null when the results are shown without a new session (from the ready screen). */
    readonly result: RunResult | null
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

  const items = $derived(result === null ? 0 : Object.values(result.itemsByAxis).reduce<number>((n, c) => n + (c ?? 0), 0))
  const minutes = $derived(result === null ? 1 : Math.max(1, Math.round(result.durationS / 60)))
  /** This run put answers into the save (a question or a timed task). */
  const added = $derived(result !== null && (items > 0 || result.blocks.length > 0))
  /** Earlier sessions with answers in them: the profile rests on these as well (not this run's own, nor the one it has on the server). */
  const earlier = $derived(save.sessions.filter((s) => (result === null || s.session_id !== sessionId) && s.session_id !== outcome?.server.sessionId && s.responses.length > 0).length)
  /** The parts the person skipped, by name, in the order of the session. */
  const skippedParts = $derived.by((): string[] => {
    if (result === null) return []
    const gone = result.skipped
    return Object.values(SEGMENT_INFO)
      .filter((segment) => segment.axes.every((a) => gone.includes(a)))
      .map((segment) => skipTargetName(segment.axes[0]!))
  })
  /** The lead line: why the run ended, said truthfully about the parts that were skipped. */
  const reason = $derived.by((): string => {
    if (result === null || result.reason === null) return ''
    if (result.reason === 'complete' && skippedParts.length > 0) return added ? reachedEndLine(skippedParts) : FINISHED_ALL_SKIPPED
    return FINISHED_REASON[result.reason]
  })
  /** A visit that added nothing to a profile built from earlier sessions says so instead of "you answered 0 questions". */
  const nothingNew = $derived(results !== null && result !== null && !added && earlier > 0)
  let saved = $state(false)
</script>

<Screen title={result === null ? FINISHED_VIEW_HEADING : results === null ? FINISHED_EMPTY_HEADING : FINISHED_HEADING} wide={results !== null}>
  {#if result === null}
    <p class="lead">{viewLine(earlier)}</p>
  {:else if nothingNew}
    <p class="lead">{noNewAnswersLine(earlier)}</p>
  {:else}
    <p class="lead">{reason}</p>
    <p>{summaryLine(items, result.blocks.length, minutes)}{earlier > 0 ? ` ${combinesLine(earlier + (added ? 1 : 0))}` : ''}</p>
  {/if}

  {#if results === null}
    <p>{FINISHED_EMPTY}</p>
    <div class="hb-actions">
      <button type="button" class="hb-btn hb-primary" onclick={onrestart}>{FINISHED_AGAIN}</button>
    </div>
    <details class="focus">
      <summary>{FINISHED_EMPTY_SAVE}</summary>
      <SavePanel {makeSave} {autosave} {saved} onsaved={() => (saved = true)} {download} {copyCode} {share} {canShare} />
    </details>
    {#if outcome !== null}
      <ServedPanels {outcome} {makeSave} {copyText} />
    {/if}
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
