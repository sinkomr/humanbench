<!--
  The consent for the optional outside scoring service (ROADMAP M6.4; DESIGN §5.4, §8). The service is OFF
  (`OCSAI_ENABLED` is the constant false, `tasks/aut/ocsai.ts`), so the component draws one short notice and nothing else:
  no checkbox, no button, no disabled control. The opt-in flow, which says exactly what would be sent (the object and the
  ideas, as plain text, which would leave this site) and has one checkbox that starts unticked, exists behind the `enabled`
  prop (its default is the flag). No page passes it, so no build can reach the flow; `ocsai.dom.test.ts` renders it with the
  prop set. The component never sends anything: it only reports the person's choice (`onconsent`); the request code does
  not exist (`requestOcsaiScores` rejects).
-->
<script lang="ts">
  import '../common/render.css'
  import { OCSAI_COPY } from '../../tasks/aut/copy'
  import { OCSAI_CONSENT_DEFAULT, OCSAI_ENABLED, type OcsaiConsent } from '../../tasks/aut/ocsai'

  interface Props {
    /** Whether the opt-in flow is shown. Defaults to the flag, which is false: only the notice shows. */
    readonly enabled?: boolean
    /** The person's choice; 'off' until they tick the box. */
    consent?: OcsaiConsent
    /** The object that would be sent. */
    readonly object?: string
    /** The ideas that would be sent. */
    readonly responses?: readonly string[]
    readonly onconsent?: (consent: OcsaiConsent) => void
  }

  let { enabled = OCSAI_ENABLED, consent = $bindable(OCSAI_CONSENT_DEFAULT), object = '', responses = [], onconsent }: Props = $props()

  const uid = $props.id()

  function change(event: Event & { currentTarget: HTMLInputElement }): void {
    consent = event.currentTarget.checked ? 'on' : 'off'
    onconsent?.(consent)
  }
</script>

{#if !enabled}
  <p class="hb-render ocsai-note" data-testid="ocsai-note">{OCSAI_COPY.off}</p>
{:else}
  <div class="hb-render ocsai" role="group" aria-labelledby="{uid}-title" data-testid="ocsai-consent">
    <p class="title" id="{uid}-title">{OCSAI_COPY.heading}</p>
    <p class="sent">{OCSAI_COPY.sent}</p>
    <ul class="payload" role="list" aria-label={OCSAI_COPY.payloadLabel}>
      {#if object !== ''}
        <li class="item">{object}</li>
      {/if}
      {#each responses as idea, i (i)}
        <li class="item">{idea}</li>
      {/each}
    </ul>
    <label class="check">
      <input type="checkbox" checked={consent === 'on'} onchange={change} />
      <span>{OCSAI_COPY.checkbox}</span>
    </label>
    <p class="hb-status">{OCSAI_COPY.none}</p>
  </div>
{/if}

<style>
  .ocsai-note {
    margin: 0.5rem 0 0;
    color: var(--r-muted);
    overflow-wrap: anywhere;
  }

  .ocsai {
    margin: 0.75rem 0 0;
    padding: 0.75rem 1rem;
    border: 2px solid var(--r-border);
    border-radius: 0.5rem;
    background: var(--r-surface);
  }

  .title {
    margin: 0 0 0.5rem;
    font-weight: 600;
  }

  .sent {
    margin: 0 0 0.5rem;
    overflow-wrap: anywhere;
  }

  .payload {
    display: grid;
    gap: 0.25rem;
    margin: 0 0 0.75rem;
    padding: 0;
    list-style: none;
  }

  .item {
    padding: 0.125rem 0.5rem;
    border: 1px solid var(--r-border);
    border-radius: 0.375rem;
    background: var(--r-bg);
    overflow-wrap: anywhere;
  }

  .check {
    display: flex;
    align-items: center;
    gap: 0.625rem;
    min-height: 2.75rem;
    cursor: pointer;
  }

  .check input {
    width: 1.25rem;
    height: 1.25rem;
    margin: 0;
    flex: none;
    accent-color: var(--r-accent);
  }
</style>
