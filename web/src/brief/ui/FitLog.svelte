<script lang="ts">
  /**
   * The fit log for one topic (AI.7; proposal §3.6 item 1; requirement R-17.12): three buttons, "too
   * basic", "about right" and "too much", and, when the last few notes point one way, a suggestion to
   * move the topic one setting (never applied without the person's say, never changing any result).
   * The notes are kept (with the other settings, once the person keeps them) as a topic, a verdict and a
   * month.
   */
  import { recordFit, setTopic, type BuilderState } from '../builder'
  import { COPY, SETTING_LABELS } from '../copy'
  import { FIT_VERDICTS, fitSuggestion, type FitVerdict } from '../fit'
  import { topicById } from '../topics'
  import type { TopicId } from '../types'

  interface Props {
    model: BuilderState
    topic: TopicId
    /** The current month, `YYYY-MM`. */
    month: string
    /** Six random hex digits for a new note's id. */
    fitId: () => string
    onchange: (next: BuilderState) => void
  }
  let { model, topic, month, fitId, onchange }: Props = $props()

  const VERDICT_LABEL: Record<FitVerdict, string> = { too_basic: 'Too basic', about_right: 'About right', too_much: 'Too much' }
  const label = $derived(topicById(topic)?.label ?? topic)
  const own = $derived(model.contexts[model.active]?.topics[topic])
  const suggestion = $derived(fitSuggestion(model.fitLog, topic, own, month))
  let message = $state('')
  // After a suggestion is used, it stays hidden until a new note on the topic arrives: the same notes
  // and the setting they led to are remembered (so a set of notes where the topic has another setting still shows it).
  let usedFor = $state('')
  const evidence = $derived(suggestion === null ? '' : `${suggestion.used.map((f) => f.id).join()}|${suggestion.from}`)
  const shown = $derived(suggestion !== null && usedFor !== evidence)

  async function note(v: FitVerdict): Promise<void> {
    onchange(recordFit(model, topic, v, month, fitId()))
    message = ''
    await Promise.resolve()
    message = COPY.fitNoted(label, VERDICT_LABEL[v].toLowerCase())
  }
  function apply(): void {
    if (suggestion === null) return
    // once applied, the topic's setting is `to`: hide the suggestion the same notes would make from there
    usedFor = `${suggestion.used.map((f) => f.id).join()}|${suggestion.to}`
    onchange(setTopic(model, topic, suggestion.to))
  }
</script>

<!-- Inside the topic's fieldset, so the legend names the topic for every button and note here. -->
<div class="fit" data-topic={topic}>
  <span class="ask">{COPY.fitAsk}</span>
  <div class="row">
    {#each FIT_VERDICTS as v (v)}
      <button type="button" data-testid="fit-{v}" onclick={() => void note(v)}>{VERDICT_LABEL[v]}</button>
    {/each}
  </div>
  {#if shown && suggestion !== null}
    <p class="note" data-testid="fit-suggestion">
      {COPY.fitSuggest(SETTING_LABELS[suggestion.to].label)}
      <button type="button" data-testid="fit-apply" onclick={apply}>{COPY.fitApply(SETTING_LABELS[suggestion.to].label)}</button>
    </p>
  {/if}
  <p class="status" role="status" aria-live="polite">{message}</p>
</div>

<style>
  .fit {
    margin: 0.75rem 0 0;
  }
  .ask {
    display: block;
    font-weight: 600;
    color: var(--text-strong);
    margin-bottom: 0.3rem;
  }
  .status {
    min-height: 1.25rem;
    margin: 0.25rem 0 0;
    font-size: 0.9rem;
  }
</style>
