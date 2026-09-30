<script lang="ts">
  /**
   * Step 2: topics. Up to five chips per set of notes; each picked topic gets "I know this well" /
   * "Not sure" / "New to me". The floor rule note appears where a "New to me" is rendered as ask-first.
   */
  import { setTopic, toggleTopic, type BuilderState } from '../builder'
  import { NOTICE_TEXT } from '../build'
  import { PRESET_INFO } from '../contexts'
  import { COPY, SETTING_LABELS, STEPS } from '../copy'
  import { floorGatePassed, type GateFile } from '../gates'
  import { AREAS, MAX_TOPICS_PER_CONTEXT, TOPICS, canonicalTopics, topicById } from '../topics'
  import { TOPIC_SETTINGS, type TopicId } from '../types'
  import FitLog from './FitLog.svelte'

  interface Props {
    model: BuilderState
    gates: GateFile
    /** The current month, `YYYY-MM`, for the fit notes. */
    month: string
    /** Six random hex digits for a new fit note's id. */
    fitId: () => string
    /** Whether the settings are being kept on this device (fit notes are kept only then). */
    keep: boolean
    onchange: (next: BuilderState) => void
  }
  let { model, gates, month, fitId, keep, onchange }: Props = $props()

  const prefs = $derived(model.contexts[model.active])
  const picked = $derived(canonicalTopics(Object.keys(prefs?.topics ?? {})))
  const full = $derived(picked.length >= MAX_TOPICS_PER_CONTEXT)
  const suggested = $derived(prefs === undefined ? [] : PRESET_INFO[prefs.preset].suggested)
  const floorApplies = $derived(!floorGatePassed(gates))
  const showScience = $derived(picked.some((id) => topicById(id)?.domain === 'knowledge'))
  const chip = (id: TopicId): { label: string; on: boolean } => ({ label: topicById(id)?.label ?? id, on: prefs?.topics[id] !== undefined })
</script>

{#snippet chipButton(id: TopicId)}
  {@const c = chip(id)}
  <button type="button" class="chip" aria-pressed={c.on} disabled={full && !c.on} onclick={() => onchange(toggleTopic(model, id))}>
    <span aria-hidden="true">{c.on ? '✓' : '+'}</span>
    {c.label}
  </button>
{/snippet}

<section aria-labelledby="step-topics">
  <h2 id="step-topics">2. {STEPS.topics.heading}</h2>
  <p>{STEPS.topics.hint}</p>

  <div class="row chips" role="group" aria-label="Suggested topics for this use">
    {#each suggested as id (id)}
      {@render chipButton(id)}
    {/each}
  </div>
  {#if full}
    <p class="hint" role="status">You have picked five topics, the most a set of notes can list. Remove one to pick another.</p>
  {/if}

  <details>
    <summary>Show all topics</summary>
    {#each AREAS as area (area.id)}
      <h3>{area.label}</h3>
      {#if area.id === 'science'}<p class="hint">{COPY.science}</p>{/if}
      <div class="row chips" role="group" aria-label={area.label}>
        {#each TOPICS.filter((t) => t.area === area.id) as t (t.id)}
          {@render chipButton(t.id)}
        {/each}
      </div>
    {/each}
  </details>

  {#if picked.length > 0}
    <h3>How much do you know about each?</h3>
    {#each picked as id (id)}
      {@const t = topicById(id)}
      {@const setting = prefs?.topics[id]}
      <fieldset>
        <legend>{t?.label}</legend>
        {#each TOPIC_SETTINGS as s (s)}
          <label class="choice">
            <input type="radio" name={`setting-${id}`} value={s} checked={setting === s} onchange={() => onchange(setTopic(model, id, s))} />
            <span>
              {SETTING_LABELS[s].label}
              <span class="hint">{SETTING_LABELS[s].hint}</span>
            </span>
          </label>
        {/each}
        {#if t?.floor === true && setting === 'build' && floorApplies}
          <p class="note">{NOTICE_TEXT.floor}</p>
        {/if}
        <FitLog {model} topic={id} {month} {fitId} {onchange} />
      </fieldset>
    {/each}
    <p class="hint" data-testid="fit-note">{COPY.fitLog} {keep ? '' : COPY.fitNotKept}</p>
    {#if showScience}<p class="note">{COPY.science}</p>{/if}
  {/if}
</section>

<style>
  .chips {
    margin: 0.5rem 0;
  }
  .chip {
    display: inline-flex;
    gap: 0.4rem;
    align-items: center;
  }
  .chip[aria-pressed='true'] {
    border-width: 2px;
    font-weight: 600;
  }
</style>
