<!--
  The result of a scored round (ROADMAP M6.4; DESIGN §5.4, §10, R-5.6.x): three plain measures with their labels, the note that
  the task is experimental, and what was done with each idea. Nothing here is a total, a percentile, a grade or a verdict:
  "Ideas counted", "Distance score (experimental)" and "Idea groups" are shown as they are, each with one line saying what it
  is, and an idea that was not counted says why in words about counting ("the same idea as an earlier one"), never about
  right or wrong. It takes the score (`tasks/aut/scoring.ts`) and draws it; the page decides when there is one. The heading
  of the section is the page's.
-->
<script lang="ts">
  import '../common/render.css'
  import { EXPERIMENTAL_NOTE, RESULT_COPY, RESULT_LABELS, STATUS_LABELS } from '../../tasks/aut/copy'
  import type { AutScore } from '../../tasks/aut/scoring'

  interface Props {
    readonly score: AutScore
    /** Which scorer made it (`Embedder.modelId`), named under the numbers. */
    readonly modelId: string
  }

  let { score, modelId }: Props = $props()

  const uid = $props.id()

  const distance = $derived(score.originality === null ? RESULT_COPY.none : score.originality.toFixed(2))
</script>

<div class="hb-render aut-results">
  <dl class="measures">
    <div class="measure">
      <dt>{RESULT_LABELS.count}</dt>
      <dd class="value" data-testid="aut-count">{score.fluency}</dd>
    </div>
    <div class="measure">
      <dt>{RESULT_LABELS.distance}</dt>
      <dd class="value" data-testid="aut-distance">{distance}</dd>
      <dd class="hint">{RESULT_COPY.distanceHint}</dd>
    </div>
    <div class="measure">
      <dt>{RESULT_LABELS.groups}</dt>
      <dd class="value" data-testid="aut-groups">{score.flexibility}</dd>
      <dd class="hint">{RESULT_COPY.groupsHint}</dd>
    </div>
  </dl>

  <p class="hb-note" data-testid="aut-experimental">{EXPERIMENTAL_NOTE}</p>
  {#if score.flags.includes('fewer_than_top_k')}
    <p class="hb-note">{RESULT_COPY.fewIdeas}</p>
  {/if}
  {#if score.flags.includes('personal_info')}
    <p class="hb-note">{RESULT_COPY.personalInfo}</p>
  {/if}

  {#if score.perResponse.length > 0}
    <p class="ideas-title" id="{uid}-ideas">{RESULT_COPY.ideasHeading}</p>
    <ul class="ideas" role="list" aria-labelledby="{uid}-ideas">
      {#each score.perResponse as r, i (i)}
        <li class="idea" data-status={r.status}>
          <span class="idea-text">{r.text}</span>
          <span class="idea-status">{STATUS_LABELS[r.status]}</span>
        </li>
      {/each}
    </ul>
  {/if}

  <p class="scorer-line">{RESULT_COPY.scorerLine(modelId, score.version)}</p>
</div>

<style>
  .measures {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(min(11rem, 100%), 1fr));
    gap: 0.75rem;
    margin: 0 0 1rem;
  }

  .measure {
    min-width: 0;
    padding: 0.75rem 1rem;
    border: 2px solid var(--r-border);
    border-radius: 0.5rem;
    background: var(--r-surface);
  }

  dt {
    font-weight: 600;
    overflow-wrap: anywhere;
  }

  dd {
    margin: 0;
  }

  .value {
    font-size: 1.75rem;
    font-weight: 600;
    font-variant-numeric: tabular-nums;
    overflow-wrap: anywhere;
  }

  .hint {
    color: var(--r-muted);
    font-size: 0.9375rem;
    overflow-wrap: anywhere;
  }

  .hb-note {
    overflow-wrap: anywhere;
  }

  .ideas-title {
    margin: 1rem 0 0.5rem;
    font-weight: 600;
  }

  .ideas {
    display: grid;
    gap: 0.5rem;
    margin: 0;
    padding: 0;
    list-style: none;
  }

  .idea {
    display: flex;
    flex-wrap: wrap;
    justify-content: space-between;
    gap: 0.125rem 0.75rem;
    min-width: 0;
    padding: 0.375rem 0.75rem;
    border: 1px solid var(--r-border);
    border-radius: 0.5rem;
    background: var(--r-surface);
  }

  .idea-text {
    flex: 1 1 8rem;
    min-width: 0;
    overflow-wrap: anywhere;
  }

  .idea-status {
    color: var(--r-muted);
    overflow-wrap: anywhere;
  }

  .scorer-line {
    margin: 1rem 0 0;
    color: var(--r-muted);
    font-size: 0.9375rem;
    overflow-wrap: anywhere;
  }
</style>
