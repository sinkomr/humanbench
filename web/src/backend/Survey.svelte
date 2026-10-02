<!--
  The optional two-question survey (ROADMAP M2.7; DESIGN §13 "Fairness/DIF without demographics"):
  an age group and whether English is the first language. Both are voluntary, either may be left
  out, and "No thanks" sends nothing. The answers are kept apart from the session by the server
  (`submit_survey`) and are used only to check that the questions are fair across groups; they are
  never shown with the results. Nothing is asked of a person who has not finished a session.
-->
<script lang="ts">
  import { AGE_BANDS, type AgeBand, type Survey } from './api'
  import { SURVEY_AGE_LEGEND, SURVEY_ENGLISH_LEGEND, SURVEY_FAILED, SURVEY_HEADING, SURVEY_LEAD, SURVEY_NO, SURVEY_NOTHING, SURVEY_NO_ANSWER, SURVEY_SEND, SURVEY_SKIP, SURVEY_SKIPPED, SURVEY_THANKS, SURVEY_YES } from './copy'
  import '../reveal/reveal.css'

  interface Props {
    /** Sends the answers; resolves true when the server stored something. */
    readonly send: (s: Survey) => Promise<boolean>
  }

  let { send }: Props = $props()

  const uid = $props.id()
  type Yn = 'yes' | 'no' | ''
  let age: AgeBand | '' = $state('')
  let english: Yn = $state('')
  let busy = $state(false)
  let done = $state(false)
  let message = $state('')
  let failed = $state(false)

  async function submit(event: SubmitEvent): Promise<void> {
    event.preventDefault()
    if (busy) return
    if (age === '' && english === '') {
      message = SURVEY_NOTHING
      done = true
      return
    }
    busy = true
    failed = false
    try {
      await send({ ageBand: age === '' ? null : age, englishFirst: english === '' ? null : english === 'yes' })
      message = SURVEY_THANKS
      done = true
    } catch {
      failed = true
      message = SURVEY_FAILED
    } finally {
      busy = false
    }
  }

  function skip(): void {
    message = SURVEY_SKIPPED
    done = true
  }
</script>

<section class="hb-reveal-panel survey" aria-labelledby="{uid}-h" data-section="survey">
  <h2 id="{uid}-h">{SURVEY_HEADING}</h2>
  {#if done}
    <p class="hb-status" role="status">{message}</p>
  {:else}
    <p>{SURVEY_LEAD}</p>
    <form onsubmit={submit}>
      <fieldset>
        <legend>{SURVEY_AGE_LEGEND}</legend>
        {#each AGE_BANDS as band (band)}
          <div class="radio">
            <input id="{uid}-age-{band}" type="radio" name="{uid}-age" value={band} bind:group={age} />
            <label for="{uid}-age-{band}">{band}</label>
          </div>
        {/each}
        <div class="radio">
          <input id="{uid}-age-none" type="radio" name="{uid}-age" value="" bind:group={age} />
          <label for="{uid}-age-none">{SURVEY_NO_ANSWER}</label>
        </div>
      </fieldset>
      <fieldset>
        <legend>{SURVEY_ENGLISH_LEGEND}</legend>
        <div class="radio">
          <input id="{uid}-en-yes" type="radio" name="{uid}-en" value="yes" bind:group={english} />
          <label for="{uid}-en-yes">{SURVEY_YES}</label>
        </div>
        <div class="radio">
          <input id="{uid}-en-no" type="radio" name="{uid}-en" value="no" bind:group={english} />
          <label for="{uid}-en-no">{SURVEY_NO}</label>
        </div>
        <div class="radio">
          <input id="{uid}-en-none" type="radio" name="{uid}-en" value="" bind:group={english} />
          <label for="{uid}-en-none">{SURVEY_NO_ANSWER}</label>
        </div>
      </fieldset>
      {#if failed}
        <p class="error" role="alert">{message}</p>
      {/if}
      <div class="hb-actions">
        <button type="submit" class="hb-btn hb-primary" disabled={busy}>{SURVEY_SEND}</button>
        <button type="button" class="hb-btn" onclick={skip}>{SURVEY_SKIP}</button>
      </div>
    </form>
  {/if}
</section>

<style>
  fieldset {
    margin: 0 0 1rem;
    padding: 0.5rem 1rem;
    border: 2px solid var(--r-border);
    border-radius: 0.5rem;
    min-width: 0;
  }

  legend {
    padding: 0 0.25rem;
    font-weight: 600;
  }

  .radio {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    min-height: 2.75rem;
  }

  .radio input {
    width: 1.25rem;
    height: 1.25rem;
    margin: 0;
  }
</style>
