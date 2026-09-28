<!--
  One G7 review instance (DESIGN §4.4; ROADMAP M1.G7): the item as the taker sees it (its renderer,
  or the spec as JSON when the family has none yet), what the renderer sent and how score() read it,
  and what the reviewer checks it against: key, verify() checks, difficulty features, b prior,
  stratum, sibling group. The reviewer marks pass / fail / unsure with a note. Dev only.
-->
<script lang="ts">
  import type { AnyFamily } from '../tasks/family'
  import { reviewJson } from './format'
  import type { AnyRenderer, ReviewInstance } from './instances'
  import { NOTE_MAX, VERDICTS, type Verdict, type VerdictRecord } from './verdicts'

  interface Props {
    readonly family: AnyFamily
    readonly instance: ReviewInstance
    readonly renderer: { readonly component: AnyRenderer; readonly source: 'entry' | 'visual' } | null
    readonly record: VerdictRecord | undefined
    readonly onverdict: (verdict: Verdict | null, note: string) => void
  }

  let { family, instance, renderer, record, onverdict }: Props = $props()

  const uid = $props.id()
  // svelte-ignore state_referenced_locally
  let note = $state(record?.note ?? '')
  let lastResponse: string | null = $state(null)
  let lastScore: string | null = $state(null)
  let run = $state(0)

  const Renderer = $derived(renderer?.component)
  const json = (v: unknown): string => reviewJson(v)

  function respond(response: unknown): void {
    if (!instance.ok) return
    lastResponse = json(response)
    try {
      lastScore = json(family.score(instance.item as never, response as never))
    } catch (e) {
      lastScore = `score() threw ${e instanceof Error ? `${e.name}: ${e.message}` : String(e)}`
    }
  }

  function setVerdict(v: Verdict | null): void {
    onverdict(v, note.slice(0, NOTE_MAX))
  }
</script>

<article class="card" aria-labelledby="{uid}-h" class:failed={record?.verdict === 'fail'}>
  <h3 id="{uid}-h">
    #{instance.index}
    <code>{instance.ok ? instance.item.item_id : instance.seed}</code>
    {#if record}<span class="badge {record.verdict}">{record.verdict}</span>{/if}
  </h3>
  {#if !instance.ok}
    <p class="error" role="alert">Generating this instance failed: {instance.error}</p>
  {:else}
    <div class="cols">
      <section class="shown" aria-labelledby="{uid}-shown">
        <h4 id="{uid}-shown">As the taker sees it {renderer ? `(${renderer.source} renderer)` : '(no renderer yet: spec as JSON)'}</h4>
        {#if Renderer}
          {#key run}
            <div class="render-host">
              <Renderer spec={instance.item.spec} onrespond={respond} />
            </div>
          {/key}
          <button type="button" class="btn" onclick={() => ((run += 1), (lastResponse = null), (lastScore = null))}>Reset renderer</button>
        {:else}
          <pre class="json">{json(instance.item.spec)}</pre>
        {/if}
        {#if lastResponse !== null}
          <h5>Response sent</h5>
          <pre class="json small">{lastResponse}</pre>
          <h5>score()</h5>
          <pre class="json small">{lastScore}</pre>
        {/if}
      </section>
      <section class="facts" aria-labelledby="{uid}-facts">
        <h4 id="{uid}-facts">Check against</h4>
        <dl>
          <dt>Key</dt>
          <dd><pre class="json small">{json(instance.item.key)}</pre></dd>
          <dt>verify()</dt>
          <dd>
            <span class="badge {instance.verify.ok ? 'pass' : 'fail'}">{instance.verify.ok ? 'ok' : 'failed'}</span>
            {instance.verify.reason}
            <details>
              <summary>Checks ({Object.keys(instance.verify.checks).length})</summary>
              <table>
                <tbody>
                  {#each Object.entries(instance.verify.checks) as [name, value] (name)}
                    <tr><th scope="row">{name}</th><td>{typeof value === 'object' ? JSON.stringify(value) : String(value)}</td></tr>
                  {/each}
                </tbody>
              </table>
            </details>
          </dd>
          <dt>Difficulty</dt>
          <dd>
            b prior {instance.item.difficulty.b_prior.toFixed(3)} (sd {instance.item.difficulty.sd_prior}), stratum {instance.item.stratum}
            <details>
              <summary>Features ({Object.keys(instance.item.difficulty.features).length})</summary>
              <table>
                <tbody>
                  {#each Object.entries(instance.item.difficulty.features) as [name, value] (name)}
                    <tr><th scope="row">{name}</th><td>{String(value)}</td></tr>
                  {/each}
                </tbody>
              </table>
              <p class="small-text">{instance.item.difficulty.provenance}</p>
            </details>
          </dd>
          <dt>Groups</dt>
          <dd>facet {instance.item.facet}; family_id <code>{instance.item.family_id}</code>; sibling_group <code>{instance.item.sibling_group}</code></dd>
          <dt>Time</dt>
          <dd>
            E[T] {instance.item.expected_time_s.toFixed(1)} s{instance.item.time_limit_s === undefined ? '' : `, limit ${instance.item.time_limit_s} s`}
          </dd>
          <dt>Params</dt>
          <dd><code>{JSON.stringify(instance.item.params)}</code></dd>
        </dl>
        <details>
          <summary>Spec JSON</summary>
          <pre class="json small">{json(instance.item.spec)}</pre>
        </details>
      </section>
    </div>
  {/if}
  <fieldset class="verdict">
    <legend>Verdict for #{instance.index}</legend>
    <div class="choices">
      {#each VERDICTS as v (v)}
        <label><input type="radio" name="{uid}-verdict" value={v} checked={record?.verdict === v} onchange={() => setVerdict(v)} /> {v}</label>
      {/each}
      <button type="button" class="btn" disabled={!record} onclick={() => setVerdict(null)}>Clear</button>
    </div>
    <label class="note-label" for="{uid}-note">Note (what is wrong, or why unsure)</label>
    <textarea id="{uid}-note" rows="2" maxlength={NOTE_MAX} bind:value={note} onchange={() => record && setVerdict(record.verdict)}></textarea>
    {#if record}<p class="small-text">Saved {record.reviewed_utc}</p>{/if}
  </fieldset>
</article>

<style>
  .card {
    border: 1px solid var(--border);
    border-radius: 0.75rem;
    padding: 1rem;
    margin: 0 0 1.5rem;
    min-width: 0;
  }

  .card.failed {
    border-color: #b42318;
    border-width: 2px;
  }

  h3 {
    margin: 0 0 0.75rem;
    font-size: 1.125rem;
    color: var(--text-strong);
    overflow-wrap: anywhere;
  }

  h4 {
    margin: 0 0 0.5rem;
    font-size: 1rem;
  }

  h5 {
    margin: 0.75rem 0 0.25rem;
    font-size: 0.9375rem;
  }

  .cols {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(min(100%, 22rem), 1fr));
    gap: 1rem;
  }

  .render-host {
    border: 1px dashed var(--border);
    border-radius: 0.5rem;
    padding: 0.5rem;
    margin-bottom: 0.5rem;
    min-width: 0;
  }

  /* Wrapped, never scrolled: a scrolling <pre> would need its own tab stop (axe scrollable-region-focusable). */
  .json {
    margin: 0;
    padding: 0.5rem;
    border: 1px solid var(--border);
    border-radius: 0.375rem;
    font-size: 0.875rem;
    white-space: pre-wrap;
    overflow-wrap: anywhere;
  }

  .json.small {
    font-size: 0.8125rem;
  }

  dl {
    margin: 0;
  }

  dt {
    font-weight: 600;
    margin-top: 0.5rem;
  }

  dd {
    margin: 0.125rem 0 0;
    overflow-wrap: anywhere;
  }

  table {
    border-collapse: collapse;
    font-size: 0.875rem;
  }

  th,
  td {
    text-align: left;
    padding: 0.125rem 0.5rem 0.125rem 0;
    vertical-align: top;
    overflow-wrap: anywhere;
  }

  th {
    font-weight: 500;
  }

  .badge {
    display: inline-block;
    padding: 0 0.5rem;
    border-radius: 999px;
    font-size: 0.8125rem;
    font-weight: 600;
    border: 1px solid currentColor;
  }

  .badge.pass {
    color: #0a6b2f;
  }

  .badge.fail {
    color: #b42318;
  }

  .badge.unsure {
    color: #8a4b00;
  }

  @media (prefers-color-scheme: dark) {
    .badge.pass {
      color: #6ee7a0;
    }

    .badge.fail {
      color: #ff9b91;
    }

    .badge.unsure {
      color: #fbbf24;
    }
  }

  .error {
    color: #b42318;
  }

  .verdict {
    margin: 1rem 0 0;
    border: 1px solid var(--border);
    border-radius: 0.5rem;
  }

  .choices {
    display: flex;
    flex-wrap: wrap;
    gap: 1rem;
    align-items: center;
  }

  .choices label {
    display: inline-flex;
    align-items: center;
    gap: 0.375rem;
    min-height: 2.75rem;
  }

  .note-label {
    display: block;
    margin-top: 0.5rem;
  }

  textarea {
    width: 100%;
    font: inherit;
    color: var(--text-strong);
    background: var(--bg);
    border: 1px solid var(--border);
    border-radius: 0.375rem;
  }

  .btn {
    min-height: 2.75rem;
    padding: 0.375rem 0.875rem;
    font: inherit;
    color: var(--text-strong);
    background: var(--bg);
    border: 1px solid var(--text);
    border-radius: 0.375rem;
    cursor: pointer;
  }

  .small-text {
    font-size: 0.8125rem;
    margin: 0.25rem 0 0;
  }
</style>
