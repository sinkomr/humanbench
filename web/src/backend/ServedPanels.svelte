<!--
  What an online session adds to the results screen (ROADMAP M2.7, AI.26; DESIGN §8, §13): what the
  server could check about the sessions in the save, the optional server backup (with its recovery
  phrase), the optional two-question survey, a way to report that someone asked for the person's notes,
  and a link to the page where their data on the server can be fetched or deleted. Every part needs the
  server session the run just had; if the person went on without the server only the report and the link
  are offered, since the rest would fail. None of it is shown in the static fallback.
-->
<script lang="ts">
  import { standingFromRescore, type SessionStanding } from './standing'
  import type { ServedOutcome } from './flow'
  import MirrorPanel from './MirrorPanel.svelte'
  import ReportProblem from './ReportProblem.svelte'
  import SaveCheck from './SaveCheck.svelte'
  import Survey from './Survey.svelte'
  import { DATA_LINK, REPORT_RESULTS_HEADING, REPORT_RESULTS_TEXT } from './copy'
  import type { SaveFileV1 } from '../save/types'
  import '../reveal/reveal.css'

  interface Props {
    readonly outcome: ServedOutcome
    /** The save as it stands (the sessions listed in the check, the file the backup stores). */
    readonly makeSave: () => SaveFileV1
    /** Injectable for tests: put text on the clipboard. */
    readonly copyText?: (text: string) => Promise<boolean>
  }

  let { outcome, makeSave, copyText }: Props = $props()

  const uid = $props.id()
  const standings: SessionStanding[] = $derived(standingFromRescore(makeSave(), outcome.estimates))
</script>

<div class="served" data-section="online">
  <SaveCheck sessions={standings} localTasks />
  {#if outcome.closed}
    <MirrorPanel put={(phrase) => outcome.server.mirrorPut(makeSave(), phrase)} anonId={outcome.server.anonId} {copyText} />
    <Survey send={(s) => outcome.server.submitSurvey(s)} />
  {/if}
  <section class="hb-reveal-panel report-notes" aria-labelledby="{uid}-h" data-section="report">
    <h2 id="{uid}-h">{REPORT_RESULTS_HEADING}</h2>
    <p>{REPORT_RESULTS_TEXT}</p>
    <ReportProblem itemId={null} report={(r) => outcome.server.reportProblem(r)} />
    <p><a class="hb-standalone-link" href="#/data">{DATA_LINK}</a></p>
  </section>
</div>
