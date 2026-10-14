<!--
  A passage and the question about it, on one screen (ROADMAP M3.11 phase 2; DESIGN §3 row 4, §10, §13;
  owner decision 2026-10-12: the passage stays visible while its questions are answered).

  The passage is a region of its own with a heading, before the question in the document, so a screen
  reader meets it first and can come back to it by its name; the question (whatever the caller renders:
  the text question, its confidence slider, the short wait for the next question) follows.

  - **Wide** (the layout itself is at least 50rem across, a container query): passage and question side by
    side; the passage keeps to the top of the window and scrolls inside its own frame when it is taller.
  - **Narrow** (a phone, a zoomed window): the passage is above the question. On a screen tall enough it
    is held to a part of the window's height and stays at the top while the page scrolls, so the question
    and its options are reached without losing the passage, and the passage scrolls inside its frame; a
    button lifts the limit ("Show the whole passage") and puts it back. On a short window (a phone on its
    side, a window zoomed to 200%) nothing is held: the passage is simply above the question.
  The frame that scrolls can take keyboard focus (WCAG 2.1.1), and what receives focus under a held
  passage is scrolled clear of it (WCAG 2.4.11).

  **Every string is written as text** (Svelte text interpolation, never `{@html}`): the passage, its title
  and its source line are data from the server, and a source line that holds an address is the characters
  it is, not a link. The component is mounted once per passage and kept across its questions, so the
  place the person scrolled to is kept too. No animation. No import of the shared stylesheet here (see
  TextChoiceRenderer.svelte; scripts/dev-routes.test.ts).
-->
<script lang="ts">
  import type { Snippet } from 'svelte'
  import { PASSAGE_COPY, SETUP_COPY } from './copy'
  import type { PassageText } from './passage'

  interface Props {
    readonly passage: PassageText
    /** The id of the passage's region, for a caller that moves focus to it when a new passage appears. */
    readonly regionId?: string
    /** The question about the passage. */
    readonly children: Snippet
  }

  let { passage, regionId, children }: Props = $props()

  const uid = $props.id()
  /** The height limit of the narrow layout is lifted. */
  let expanded = $state(false)
  /** A logic game's setup (its opening and its rules) is shown in the passage's place, under its own name. */
  const copy = $derived(passage.kind === 'setup' ? SETUP_COPY : PASSAGE_COPY)
</script>

<div class="passage-layout" class:expanded>
  <div class="cols">
    <!-- A frame that scrolls must be reachable by keyboard to be scrolled by it (WCAG 2.1.1), and a new passage takes focus here. -->
    <!-- svelte-ignore a11y_no_noninteractive_tabindex -->
    <section class="passage" id={regionId ?? `${uid}-passage`} aria-labelledby="{uid}-h" tabindex="0" data-passage={passage.passageKey}>
      <div class="head">
        <h2 id="{uid}-h">{copy.heading}</h2>
        <button type="button" class="hb-btn toggle" aria-expanded={expanded} aria-controls="{uid}-text" onclick={() => (expanded = !expanded)}>
          {expanded ? copy.showLess : copy.showAll}
        </button>
      </div>
      <div class="text" id="{uid}-text">
        {#if passage.title !== null}
          <p class="title">{passage.title}</p>
        {/if}
        {#each passage.passage as paragraph, i (i)}
          <p>{paragraph}</p>
        {/each}
        {#if passage.rules !== undefined && passage.rules.length > 0}
          <ul class="rules" aria-label={SETUP_COPY.rulesLabel}>
            {#each passage.rules as rule, i (i)}
              <li>{rule}</li>
            {/each}
          </ul>
        {/if}
      </div>
      {#if passage.attribution !== null}
        <p class="attribution"><span class="hb-sr-only">{PASSAGE_COPY.sourcePrefix}</span>{passage.attribution}</p>
      {/if}
    </section>
    <div class="question">
      {@render children()}
    </div>
  </div>
</div>

<style>
  .passage-layout {
    container-type: inline-size;
    width: 100%;
    min-width: 0;
  }

  /* Narrow: one column, as plain blocks, so the passage can stay in view over the whole of the question (a grid
     would hold it inside its own row). */
  .cols {
    display: block;
  }

  .passage {
    box-sizing: border-box;
    min-width: 0;
    padding: 0 1rem 0.75rem;
    border: 2px solid var(--r-border);
    border-radius: 0.5rem;
    background: var(--r-surface);
    overflow-wrap: anywhere;
    margin: 0 0 1rem;
  }

  .passage:focus-visible {
    outline: 3px solid var(--r-focus);
    outline-offset: 2px;
  }

  /* The heading and the button stay at the top of the frame while the text scrolls under them. */
  .head {
    position: sticky;
    top: 0;
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    justify-content: space-between;
    gap: 0.25rem 0.75rem;
    padding: 0.5rem 0;
    background: var(--r-surface);
  }

  .passage h2 {
    margin: 0;
    font-size: 1rem;
    line-height: 1.5;
  }

  .toggle {
    min-height: 2.75rem;
    font-size: 0.875rem;
  }

  /* Text from the server: a line break inside a paragraph is kept, and nothing can run past the frame. */
  .text p {
    margin: 0;
    max-width: 38rem;
    white-space: pre-line;
    font-size: 1.0625rem;
    line-height: 1.6;
  }

  .text p + p {
    margin-top: 0.75rem;
  }

  .text .title {
    font-weight: 700;
  }

  /* A logic game's rules: one to a line, so each can be checked against an arrangement. */
  .rules {
    margin: 0.75rem 0 0;
    padding-left: 1.25rem;
    max-width: 38rem;
    font-size: 1.0625rem;
    line-height: 1.6;
  }

  .rules li + li {
    margin-top: 0.25rem;
  }

  .attribution {
    margin: 0.75rem 0 0;
    max-width: 38rem;
    font-size: 0.8125rem;
    line-height: 1.5;
    color: var(--r-muted);
  }

  .question {
    min-width: 0;
  }

  /* Narrow, on a screen tall enough: the passage is held to a part of the window and stays in view. */
  @media (min-height: 34rem) {
    .passage-layout:not(.expanded) .passage {
      position: sticky;
      top: 0;
      z-index: 2;
      max-height: 42vh;
      max-height: 42dvh;
      overflow-y: auto;
      overscroll-behavior: contain;
    }

    /* What takes focus under the held passage is scrolled clear of it. */
    .passage-layout:not(.expanded) .question :global(:is(input, button, select, textarea, a, [tabindex])) {
      scroll-margin-top: calc(42vh + 1rem);
      scroll-margin-top: calc(42dvh + 1rem);
    }
  }

  /* A short window: nothing is held, so there is no limit to lift. */
  @media not (min-height: 34rem) {
    .toggle {
      display: none;
    }
  }

  /* Wide: side by side; the passage keeps to the top of the window and scrolls in its own frame. */
  @container (min-width: 50rem) {
    .cols {
      display: grid;
      grid-template-columns: minmax(0, 1fr) minmax(0, 1fr);
      gap: 1.5rem;
      align-items: start;
    }

    /* Tall enough to read in, and short enough to be whole in the window under the page's heading before anything is scrolled. */
    .passage-layout:not(.expanded) .passage,
    .passage-layout.expanded .passage {
      position: sticky;
      top: 1rem;
      z-index: auto;
      margin: 0;
      max-height: max(18rem, calc(100vh - 14rem));
      max-height: max(18rem, calc(100dvh - 14rem));
      overflow-y: auto;
      overscroll-behavior: auto;
    }

    .passage-layout:not(.expanded) .question :global(:is(input, button, select, textarea, a, [tabindex])),
    .passage-layout.expanded .question :global(:is(input, button, select, textarea, a, [tabindex])) {
      scroll-margin-top: 1rem;
    }

    .toggle {
      display: none;
    }
  }
</style>
