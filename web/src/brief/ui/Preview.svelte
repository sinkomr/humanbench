<script lang="ts">
  /**
   * Step 4, the core screen (proposal §3.3): the notes exactly as they will be pasted, a live
   * character count for the chosen destination, and every line with a tick box, a "Why this line?"
   * drawer (only the person sees it), a choice of wording where the grammar has one, and a badge
   * for lines that have not been through the checks. Lines that do not fit are named, never cut.
   */
  import { applyTick, confirmT2, setPhrasing, setTier, type BuilderState } from '../builder'
  import type { BuildResult, ComposedLine } from '../build'
  import { STEPS } from '../copy'
  import type { GateFile } from '../gates'
  import { headerBody, template } from '../grammar'
  import { lineText } from '../render'
  import type { Destination } from '../surfaces'
  import { drawerRows } from '../why'
  import type { Form } from '../types'

  interface Props {
    model: BuilderState
    result: BuildResult
    /** What will be pasted: the text, or the JSON for a destination that takes JSON. */
    shown: string
    form: Form
    dest: Destination
    gates: GateFile
    onchange: (next: BuilderState) => void
  }
  let { model, result, shown, form, dest, gates, onchange }: Props = $props()

  const prefs = $derived(model.contexts[model.active])
  const fmt = new Intl.NumberFormat('en-US')
  const droppedKeys = $derived(new Set(result.dropped.map((d) => d.key)))
  const FORM_NAME: Record<Form, string> = { short: 'short', long: 'long', skill: 'skill' }

  /** The written text of a row; the header row shows its dated body. */
  function rowText(c: ComposedLine): string {
    if (c.line.id === 'H') return headerBody(result.brief.as_of, result.brief.revisit, true)
    return lineText(c.line, form) ?? ''
  }
  const excerpt = (c: ComposedLine): string => {
    const t = rowText(c)
    return t.length > 70 ? `${t.slice(0, 70)}...` : t
  }
  const wordingOf = (c: ComposedLine, id: string): string => lineText({ ...c.line, id }, form) ?? id
  const showNotice = (kind: string): boolean => kind !== 'interests' && kind !== 'custom' && kind !== 'floor'
</script>

<section aria-labelledby="step-preview">
  <h2 id="step-preview">4. {STEPS.preview.heading}</h2>
  <p>{STEPS.preview.hint}</p>

  <fieldset>
    <legend>Which topics to include</legend>
    <label class="choice">
      <input type="radio" name="tier" value="T1" checked={prefs?.tier !== 'T2'} onchange={() => onchange(setTier(model, 'T1'))} />
      <span>
        Only the topics I picked for this use
        <span class="hint">Recommended: the assistant sees only the lines that matter for this use.</span>
      </span>
    </label>
    <label class="choice">
      <input type="radio" name="tier" value="T2" checked={prefs?.tier === 'T2'} onchange={() => onchange(setTier(model, 'T2'))} />
      <span>
        Every topic I have set in all of my sets of notes
        <span class="hint">Longer notes that say more about you.</span>
      </span>
    </label>
    {#if prefs?.tier === 'T2'}
      <div class="warn">
        <p>This puts every topic you have set into one set of notes, including topics from your other sets. Only do this if you are happy for the assistant to see all of them.</p>
        <label class="choice">
          <input type="checkbox" checked={model.t2Confirmed} onchange={(e) => onchange(confirmT2(model, e.currentTarget.checked))} />
          <span>I understand, include every topic</span>
        </label>
      </div>
    {/if}
  </fieldset>

  {#each result.notices.filter((n) => showNotice(n.kind)) as n (n.message)}
    <p class="note">{n.message}</p>
  {/each}

  <p class="counter" data-testid="counter">
    <strong>{fmt.format(result.chars)}</strong> of {fmt.format(result.limit)} characters for {dest.label}
    <span class="hint">({FORM_NAME[form]} form)</span>
  </p>
  {#if result.dropped.length > 0}
    <div class="warn" role="status">
      <p><strong>Some lines do not fit.</strong> These notes are limited to {fmt.format(result.limit)} characters, so these lines are left out. Nothing is cut in the middle of a line.</p>
      <ul>
        {#each result.dropped as d (d.key)}
          <li>{excerpt(d)}</li>
        {/each}
      </ul>
      <p>Untick other lines to make room{dest.forms.length > 1 ? ', or choose the longer notes below' : ''}.</p>
    </div>
  {/if}

  <div role="group" aria-labelledby="notes-label">
    <p id="notes-label" class="hint">Your notes, exactly as they will be pasted:</p>
    <pre id="notes-text" data-testid="notes-text">{shown}</pre>
  </div>

  <h3>Line by line</h3>
  <ul class="lines">
    {#each result.lines as c (c.key)}
      {@const text = rowText(c)}
      <li class:off={!c.on}>
        <label class="choice">
          <input
            type="checkbox"
            checked={c.on}
            disabled={c.locked}
            onchange={(e) => onchange(applyTick(model, c.tick, e.currentTarget.checked))}
          />
          <span>
            {text}
            {#if c.locked}<span class="badge">Always included</span>{/if}
            {#if c.line.status === 'experimental'}<span class="badge">Experimental</span>{/if}
            {#if c.line.custom}<span class="badge">Your own line</span>{/if}
            {#if droppedKeys.has(c.key)}<span class="badge">Does not fit</span>{/if}
            {#if !c.on}<span class="badge">Not included</span>{/if}
          </span>
        </label>
        <div class="tools">
          {#if c.phrasings.length > 1}
            <details class="wording">
              <summary>Other wording</summary>
              <fieldset>
                <legend>Wording for this line</legend>
                {#each c.phrasings as id (id)}
                  <label class="choice">
                    <input type="radio" name={`wording-${c.key}`} value={id} checked={c.line.id === id} onchange={() => onchange(setPhrasing(model, template(c.line.id).base, id))} />
                    <span>{wordingOf(c, id)}</span>
                  </label>
                {/each}
              </fieldset>
            </details>
          {/if}
          <details>
            <summary>Why this line?</summary>
            <dl>
              {#each drawerRows(c.sources.length > 0 ? c.sources : [c.line.id], gates, dest) as r (r.label)}
                <dt>{r.label}</dt>
                <dd>{r.text}</dd>
              {/each}
            </dl>
          </details>
        </div>
      </li>
    {/each}
  </ul>
</section>

<style>
  .counter {
    margin: 1rem 0 0.5rem;
  }
  .lines {
    list-style: none;
    margin: 0;
    padding: 0;
  }
  li {
    border-top: 1px solid var(--border);
    padding: 0.4rem 0;
  }
  li.off .choice > span {
    color: var(--muted);
  }
  .tools {
    display: flex;
    flex-wrap: wrap;
    gap: 0.5rem 1.5rem;
    align-items: flex-start;
    padding-left: 1.85rem;
  }
  .wording {
    flex: 1 1 100%;
    min-width: 0;
  }
  dt {
    font-weight: 600;
    color: var(--text-strong);
    margin-top: 0.5rem;
  }
  dd {
    margin: 0;
  }
</style>
