<script lang="ts">
  /**
   * Step 3: optional closed-choice lines (answer length, default mode, words, sentences, format,
   * voice, language, coding collaboration), typed interests, and the person's own lines. Interests
   * and own lines are checked as they are typed and are never stored (R-17.12).
   */
  import { removeCustom, setCustomText, setInterests, setLength, setLine, setMode, setWordChoice, wordChoice, type BuilderState, type WordChoice } from '../builder'
  import { PRESET_INFO } from '../contexts'
  import { COPY, STEPS } from '../copy'
  import { MAX_CUSTOM_LINES, sanitizeCustomLine, sanitizeInterests } from '../sanitize'
  import { template } from '../grammar'
  import { LENGTHS, MODES, type Length, type Mode } from '../types'

  interface Props {
    model: BuilderState
    onchange: (next: BuilderState) => void
  }
  let { model, onchange }: Props = $props()

  const prefs = $derived(model.contexts[model.active])
  const extras = $derived(model.extras[model.active])
  const coding = $derived(prefs === undefined ? false : PRESET_INFO[prefs.preset].coding)
  const words = $derived<WordChoice>(prefs === undefined ? 'plain' : wordChoice(prefs))
  const on = (key: string): boolean => prefs !== undefined && prefs.lines_on.includes(key) && !prefs.lines_off.includes(key)
  const interestProblems = $derived(sanitizeInterests(extras?.interests ?? '').problems)

  const LENGTH_LABEL: Record<Length, string> = { short: 'Short answers, with more detail offered', standard: 'No preference', detailed: 'Detailed answers' }
  const MODE_LABEL: Record<Mode, { label: string; hint: string }> = {
    do: { label: 'Just do it', hint: 'Give me the result and one quick way to check it.' },
    learn: { label: 'Teach me', hint: 'Ask what I would try first and give hints before answers.' },
  }
  const WORD_LABEL: Record<WordChoice, { label: string; hint: string }> = {
    plain: { label: 'Plain words', hint: 'Technical terms stay when they are the right ones, and are defined briefly.' },
    w1: { label: 'General and academic vocabulary is fine', hint: 'Define only terms specific to a field.' },
    w2: { label: 'Explain less common words', hint: 'A few words the first time, keeping the full technical depth.' },
  }
  const CHECKS: { key: string; label: string }[] = [
    { key: 'FMT1', label: 'Plain text: no tables, no Markdown symbols, no emoji' },
    { key: 'FMT2', label: 'Describe diagrams and charts in words' },
    { key: 'FMT3', label: 'Short paragraphs, each step on its own line' },
  ]

  const customCount = $derived(extras?.custom.length ?? 0)
  const customNote = (i: number): string[] => sanitizeCustomLine(extras?.custom[i]?.text ?? '').problems
</script>

<section aria-labelledby="step-extras">
  <h2 id="step-extras">3. {STEPS.extras.heading}</h2>
  <p>{STEPS.extras.hint}</p>

  <fieldset>
    <legend>Answer length</legend>
    {#each LENGTHS as l (l)}
      <label class="choice">
        <input type="radio" name="length" value={l} checked={prefs?.length === l} onchange={() => onchange(setLength(model, l))} />
        <span>{LENGTH_LABEL[l]}</span>
      </label>
    {/each}
  </fieldset>

  <fieldset>
    <legend>By default</legend>
    {#each MODES as m (m)}
      <label class="choice">
        <input type="radio" name="mode" value={m} checked={prefs?.mode === m} onchange={() => onchange(setMode(model, m))} />
        <span>
          {MODE_LABEL[m].label}
          <span class="hint">{MODE_LABEL[m].hint}</span>
        </span>
      </label>
    {/each}
    <p class="hint">Either way, saying "teach me", "just do it" or "challenge me" in a chat switches it for that request.</p>
  </fieldset>

  <fieldset>
    <legend>Words and sentences</legend>
    {#each ['plain', 'w1', 'w2'] as const as w (w)}
      <label class="choice">
        <input type="radio" name="words" value={w} checked={words === w} onchange={() => onchange(setWordChoice(model, w))} />
        <span>
          {WORD_LABEL[w].label}
          <span class="hint">{WORD_LABEL[w].hint}</span>
        </span>
      </label>
    {/each}
    <label class="choice">
      <input type="checkbox" checked={on('W3')} onchange={(e) => onchange(setLine(model, 'W3', e.currentTarget.checked))} />
      <span>Short sentences, one idea each</span>
    </label>
  </fieldset>

  <fieldset>
    <legend>Format</legend>
    {#each CHECKS as c (c.key)}
      <label class="choice">
        <input type="checkbox" checked={on(c.key)} onchange={(e) => onchange(setLine(model, c.key, e.currentTarget.checked))} />
        <span>{c.label}</span>
      </label>
    {/each}
    <label class="choice">
      <input type="checkbox" checked={on('VOICE')} onchange={(e) => onchange(setLine(model, 'VOICE', e.currentTarget.checked))} />
      <span>
        I sometimes talk to my assistant by voice
        <span class="hint">{template('VOICE').long}</span>
      </span>
    </label>
    <label class="choice">
      <input type="checkbox" checked={prefs !== undefined && !prefs.lines_off.includes('LANG')} onchange={(e) => onchange(setLine(model, 'LANG', e.currentTarget.checked))} />
      <span>These notes apply in whatever language I chat in</span>
    </label>
  </fieldset>

  {#if coding}
    <fieldset>
      <legend>Working with a coding agent</legend>
      <label class="choice">
        <input type="checkbox" checked={on('AC1')} onchange={(e) => onchange(setLine(model, 'AC1', e.currentTarget.checked))} />
        <span>Tell me the plan before a large change and wait for my go-ahead</span>
      </label>
      <label class="choice">
        <input type="checkbox" checked={on('AC2')} onchange={(e) => onchange(setLine(model, 'AC2', e.currentTarget.checked))} />
        <span>Explain each change briefly after making it</span>
      </label>
    </fieldset>
  {/if}

  <fieldset>
    <legend>Examples you like</legend>
    <label for="interests">Hobbies or subjects, separated by commas (at most three)</label>
    <input id="interests" type="text" autocomplete="off" spellcheck="false" aria-describedby="interests-hint" value={extras?.interests ?? ''} oninput={(e) => onchange(setInterests(model, e.currentTarget.value))} />
    <p id="interests-hint" class="hint">{COPY.interests}</p>
    {#each interestProblems as problem (problem)}
      <p class="warn">{problem}</p>
    {/each}
  </fieldset>

  <fieldset>
    <legend>Your own lines</legend>
    <p class="hint">{COPY.customHint}</p>
    {#each { length: Math.min(customCount + 1, MAX_CUSTOM_LINES) } as _n, i (i)}
      <div class="custom">
        <label for={`custom-${i}`}>Your line {i + 1}</label>
        <div class="row">
          <input id={`custom-${i}`} type="text" autocomplete="off" maxlength="220" value={extras?.custom[i]?.text ?? ''} oninput={(e) => onchange(setCustomText(model, i, e.currentTarget.value))} />
          {#if i < customCount}
            <button type="button" onclick={() => onchange(removeCustom(model, i))} aria-label={`Remove your line ${i + 1}`}>Remove</button>
          {/if}
        </div>
        {#each customNote(i) as problem (problem)}
          <p class="warn">{problem}</p>
        {/each}
      </div>
    {/each}
  </fieldset>
</section>

<style>
  label:not(.choice) {
    display: block;
    margin-bottom: 0.25rem;
  }
  .custom {
    margin-bottom: 0.75rem;
  }
  .custom .row input {
    flex: 1 1 12rem;
    width: auto;
  }
</style>
