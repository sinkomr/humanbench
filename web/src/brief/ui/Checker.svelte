<script lang="ts">
  /**
   * The checker (AI.6; proposal §3.2, requirement R-17.11): paste any notes and see, in plain words,
   * what they tell the assistant and which lines are foreign, edited, out of date or switched off.
   * It reads every released `hb-brief/N` text form and the JSON, and runs on the device: what is
   * pasted is held in this component only, never stored, logged or sent, and it is echoed back with
   * hidden and look-alike characters made visible (`visibleText`). Below it, the in-app changelog
   * lists the line types that are switched off now (the notes never link here).
   */
  import { checkNotes, type CheckReport, type LineFinding } from '../check'
  import { DEFAULT_GATES, type GateFile } from '../gates'
  import { switchedOffLines } from '../returning'

  interface Props {
    gates?: GateFile
    /** Today, `YYYY-MM-DD`, so the checker can tell whether the notes' review-by month has passed. */
    today?: string
  }
  let { gates = DEFAULT_GATES, today }: Props = $props()

  let text = $state('')
  let report = $state<CheckReport | null>(null)

  const off = $derived(switchedOffLines(gates))

  function run(): void {
    report = checkNotes(text, { gates, ...(today === undefined ? {} : { today }) })
  }
  function clear(): void {
    text = ''
    report = null
  }

  const KIND_LABEL: Record<LineFinding['kind'], string> = {
    header: 'Header',
    standard: 'Standard line',
    own: 'Line of your own',
    foreign: 'Not from the builder',
    heading: 'Heading',
  }
  const badges = (f: LineFinding): string[] => {
    const out: string[] = [KIND_LABEL[f.kind]]
    if (f.status === 'blocked') out.push('Switched off')
    else if (f.status === 'experimental' && f.kind === 'standard') out.push('Still being checked')
    if (f.outdatedV !== undefined) out.push('Older wording')
    if (f.offForm === true) out.push('Written for the other length')
    if (f.editedFrom !== undefined) out.push(`Looks like an edit of ${f.editedFrom}`)
    return out
  }
  const where = (f: LineFinding): string => (f.line > 0 ? `Line ${f.line}` : f.text)
</script>

<section aria-labelledby="step-check">
  <h2 id="step-check">Check notes</h2>
  <p>
    Paste notes you were given or wrote yourself. The checker says in plain words what they tell an assistant, and points out anything that is not from
    the builder or breaks its rules. Nothing you paste here leaves your device or is saved.
  </p>
  <label for="check-input">Notes to check</label>
  <textarea id="check-input" bind:value={text} rows="8" autocomplete="off" autocapitalize="off" spellcheck="false" data-testid="check-input"></textarea>
  <div class="row actions">
    <button type="button" class="primary" onclick={run}>Check these notes</button>
    <button type="button" onclick={clear}>Clear</button>
  </div>

  <div data-testid="check-result">
    {#if report !== null}
      <p class="summary" role="status" aria-live="polite" data-testid="check-summary" data-verdict={report.verdict}>{report.summary}</p>

      {#if report.flags.length > 0}
        <div class="warn" data-testid="check-flags">
          <h3>Needs a look</h3>
          <ul>
            {#each report.flags as flag (flag.kind + flag.message)}
              <li>{flag.message}{#if flag.lines.length > 0} <span class="hint">(line {flag.lines.join(', ')})</span>{/if}</li>
            {/each}
          </ul>
        </div>
      {/if}

      {#if report.lines.length > 0}
        <h3>What the notes say</h3>
        <ol class="lines" data-testid="check-lines">
          {#each report.lines as f, i (i)}
            <li data-kind={f.kind}>
              <span class="where">{where(f)}</span>
              {#each badges(f) as b (b)}<span class="badge">{b}</span>{/each}
              {#if f.says !== null}
                <span class="says">{f.says}</span>
              {/if}
              {#if f.kind === 'foreign'}
                <code class="raw">{f.text}</code>
                <ul class="reasons">
                  {#each f.reasons as r (r)}<li>{r}</li>{/each}
                </ul>
              {/if}
            </li>
          {/each}
        </ol>
      {/if}

      {#if report.updated !== null}
        <h3>Older wording, and how it reads now</h3>
        <ul class="diff" data-testid="check-diff">
          {#each report.updated.diff.filter((o) => o.kind !== 'same') as op, i (i)}
            <li>
              {#if op.kind === 'changed'}
                <span class="hint">Line {op.old}, in your notes:</span> <code>{op.from}</code>
                <span class="hint">Now reads:</span> <code>{op.to}</code>
              {:else if op.kind === 'removed'}
                <span class="hint">Line {op.old}, no longer written:</span> <code>{op.text}</code>
              {:else if op.kind === 'added'}
                <span class="hint">Now also written:</span> <code>{op.text}</code>
              {/if}
            </li>
          {/each}
        </ul>
      {/if}
    {/if}
  </div>

  <details>
    <summary>Changes to the lines</summary>
    {#if off.length === 0}
      <p data-testid="changelog">No line types are switched off.</p>
    {:else}
      <p>These line types are switched off in this version, so the builder does not write them.</p>
      <ul data-testid="changelog">
        {#each off as o (o.id)}
          <li><span class="badge">{o.id}</span> {o.says}</li>
        {/each}
      </ul>
    {/if}
  </details>
</section>

<style>
  label[for='check-input'] {
    display: block;
    font-weight: 600;
    color: var(--text-strong);
    margin: 0.75rem 0 0.25rem;
  }
  .actions {
    margin: 0.75rem 0;
  }
  .summary {
    font-weight: 600;
    color: var(--text-strong);
  }
  .lines {
    padding-left: 1.4rem;
  }
  .lines > li {
    margin: 0.6rem 0;
  }
  .where {
    font-weight: 600;
    margin-right: 0.4rem;
  }
  .badge {
    margin-right: 0.3rem;
  }
  .says {
    display: block;
    margin-top: 0.2rem;
  }
  .raw,
  .diff code {
    display: block;
    white-space: pre-wrap;
    overflow-wrap: anywhere;
    background: var(--surface);
    border: 1px solid var(--border);
    border-radius: 0.375rem;
    padding: 0.3rem 0.5rem;
    margin: 0.2rem 0;
  }
  .reasons {
    margin: 0.2rem 0;
  }
</style>
