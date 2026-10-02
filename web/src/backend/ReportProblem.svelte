<!--
  "Report a problem" (ROADMAP M2.7, AI.26; DESIGN §4.5, §13): six kinds in all. Five are about a
  question on screen and name it (the answer it expects looks wrong, it is ambiguous, a typo, it is
  offensive, it does not display); the sixth, "Someone asked me for my notes", is not about a question
  at all: it carries no question and no text, the server stores it as a flag of its own, and it never
  counts toward the quarantine of a question (the server's rule, `report_problem`). Outside a
  question (the results screen) only that one is offered.
  The panel is inline, not a modal: the item behind it keeps running, so it takes focus on its heading
  (WCAG 2.4.3) and gives it back to the button when closed. Nothing about the person is sent but the
  kind, the question's id and, if the person writes it, up to 500 characters of text.
-->
<script lang="ts">
  import { tick } from 'svelte'
  import { ITEM_PROBLEM_KINDS, MAX_PROBLEM_DETAIL, type ItemProblemKind, type ProblemReport } from './api'
  import {
    REPORT_BUTTON,
    REPORT_CANCEL,
    REPORT_DETAIL_LABEL,
    REPORT_DONE,
    REPORT_FAILED,
    REPORT_HEADING,
    REPORT_ITEM_NOTE,
    REPORT_KINDS,
    REPORT_LEGEND,
    REPORT_NOTES_NOTE,
    REPORT_SEND,
  } from './copy'

  type Kind = ItemProblemKind | 'notes_requested'

  interface Props {
    /** The question on screen, or null outside a question. */
    readonly itemId: string | null
    /** Sends the report. Rejects when the server cannot take it. */
    readonly report: (r: ProblemReport) => Promise<void>
  }

  let { itemId, report }: Props = $props()

  const uid = $props.id()
  const kinds = $derived<readonly Kind[]>(itemId === null ? ['notes_requested'] : [...ITEM_PROBLEM_KINDS, 'notes_requested'])

  let open = $state(false)
  let kind: Kind | null = $state(null)
  let detail = $state('')
  let busy = $state(false)
  let message = $state('')
  let failed = $state(false)
  let opener: HTMLButtonElement | undefined = $state()
  let heading: HTMLHeadingElement | undefined = $state()

  const chosen = $derived<Kind | null>(itemId === null ? 'notes_requested' : kind)
  const isItemKind = $derived(chosen !== null && chosen !== 'notes_requested')

  async function show(): Promise<void> {
    open = true
    message = ''
    failed = false
    await tick()
    heading?.focus()
  }

  async function close(): Promise<void> {
    open = false
    await tick()
    opener?.focus()
  }

  async function send(event: SubmitEvent): Promise<void> {
    event.preventDefault()
    if (chosen === null || busy) return
    busy = true
    failed = false
    try {
      if (chosen === 'notes_requested') await report({ kind: 'notes_requested' })
      else if (itemId !== null) await report({ kind: chosen, itemId, detail })
      message = REPORT_DONE
      open = false
      kind = null
      detail = ''
      await tick()
      opener?.focus()
    } catch {
      failed = true
      message = REPORT_FAILED
    } finally {
      busy = false
    }
  }
</script>

<div class="report" data-report>
  {#if !open}
    <button type="button" class="hb-btn" bind:this={opener} onclick={() => void show()}>{REPORT_BUTTON}</button>
  {:else}
    <section class="panel" aria-labelledby="{uid}-h">
      <h2 id="{uid}-h" tabindex="-1" bind:this={heading}>{REPORT_HEADING}</h2>
      <form onsubmit={send}>
        <fieldset>
          <legend>{REPORT_LEGEND}</legend>
          {#each kinds as k (k)}
            <div class="radio">
              <input id="{uid}-{k}" type="radio" name="{uid}-kind" value={k} checked={chosen === k} onchange={() => (kind = k)} />
              <label for="{uid}-{k}">{REPORT_KINDS[k]}</label>
            </div>
          {/each}
        </fieldset>
        {#if chosen === 'notes_requested'}
          <p class="note">{REPORT_NOTES_NOTE}</p>
        {:else if isItemKind}
          <label for="{uid}-detail">{REPORT_DETAIL_LABEL}</label>
          <textarea id="{uid}-detail" rows="3" maxlength={MAX_PROBLEM_DETAIL} bind:value={detail} spellcheck="true" autocomplete="off"></textarea>
          <p class="note">{REPORT_ITEM_NOTE}</p>
        {/if}
        {#if failed}
          <p class="error" role="alert">{REPORT_FAILED}</p>
        {/if}
        <div class="hb-actions">
          <button type="submit" class="hb-btn hb-primary" disabled={chosen === null || busy}>{REPORT_SEND}</button>
          <button type="button" class="hb-btn" onclick={() => void close()}>{REPORT_CANCEL}</button>
        </div>
      </form>
    </section>
  {/if}
  <p class="status" role="status">{open ? '' : message}</p>
</div>

<style>
  .report {
    margin: 1rem 0;
  }

  .panel {
    padding: 0.75rem 1rem;
    border: 2px solid var(--r-border);
    border-radius: 0.5rem;
    background: var(--r-surface);
  }

  h2 {
    margin: 0 0 0.5rem;
    font-size: 1.125rem;
  }

  h2:focus {
    outline: none;
  }

  .note {
    font-size: 0.9375rem;
    color: var(--r-muted);
  }

  .status {
    margin: 0.5rem 0 0;
    min-height: 1.5rem;
  }

  textarea {
    box-sizing: border-box;
    width: 100%;
    max-width: 38rem;
  }
</style>
