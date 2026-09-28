<!--
  Dev-only gallery of the visual renderers (ROADMAP M1.13): shows generated items of one family
  through its renderer, for the e2e suite (axe, keyboard, layout, drawing) and for eyeballing.
  Query: `family` (rotation | matrices, default rotation), `seed` (default gallery-1), `count`
  (items shown at once, 1–4, default 1). Only each item's `spec` reaches a renderer; the gallery
  shows the emitted response, never the key, and each item's state: Drawing, Shown (`onshown`) or
  Unavailable (`onunavailable`, e.g. no WebGL). The "Remove items" button unmounts the renderers
  (the e2e suite checks that this frees the shared WebGL context).
-->
<script lang="ts">
  import type { Component } from 'svelte'
  import { getFamily } from '../../tasks/registry'
  import { VISUAL_RENDERERS, type FamilyName } from '../visual'

  const params = new URLSearchParams(window.location.search)
  const names = Object.keys(VISUAL_RENDERERS) as FamilyName[]
  const requested = params.get('family') ?? 'rotation'
  const family: FamilyName = (names as string[]).includes(requested) ? (requested as FamilyName) : 'rotation'
  const seed = params.get('seed') ?? 'gallery-1'
  const count = Math.min(4, Math.max(1, Number.parseInt(params.get('count') ?? '1', 10) || 1))

  // The map holds components of different prop types (see visual.ts); items match by family.
  const Renderer = VISUAL_RENDERERS[family] as Component<any>
  const items = Array.from({ length: count }, (_, i) => {
    const f = getFamily(family)
    if (!f) throw new Error(`no family ${family}`)
    return f.generate(count === 1 ? seed : `${seed}-${i + 1}`)
  })

  const responses: (number | null)[] = $state(items.map(() => null))
  const states: ('Drawing' | 'Shown' | 'Unavailable')[] = $state(items.map(() => 'Drawing'))
  let present = $state(true)

  const link = (f: string, s: string): string => `?family=${encodeURIComponent(f)}&seed=${encodeURIComponent(s)}${count > 1 ? `&count=${count}` : ''}`
  const nextSeed = /-(\d+)$/.test(seed) ? seed.replace(/-(\d+)$/, (_, n: string) => `-${Number(n) + 1}`) : `${seed}-2`
</script>

<main>
  <h1>Visual renderer gallery</h1>
  <p class="note">Development only. Items are generated in the browser; only their render payload reaches the renderer.</p>
  <nav aria-label="Families">
    <ul>
      {#each names as name (name)}
        <li><a href={link(name, seed)} aria-current={name === family ? 'page' : undefined}>{name}</a></li>
      {/each}
      <li><a href={link(family, nextSeed)}>Next seed</a></li>
    </ul>
  </nav>
  {#if present}
    {#each items as item, i (item.item_id)}
      <section aria-labelledby="item-{i}">
        <h2 id="item-{i}">{family}, seed {item.seed}</h2>
        <Renderer
          spec={item.spec}
          onrespond={(r: number) => (responses[i] = r)}
          onshown={() => (states[i] = 'Shown')}
          onunavailable={() => (states[i] = 'Unavailable')}
        />
        <p class="status">
          <span id="shown-{i}">{states[i]}</span>.
          Response: <output id="response-{i}">{responses[i] === null ? 'none yet' : String(responses[i])}</output>
        </p>
      </section>
    {/each}
    <button type="button" onclick={() => (present = false)}>Remove items</button>
  {:else}
    <p id="removed">Items removed.</p>
  {/if}
</main>

<style>
  main {
    box-sizing: border-box;
    width: 100%;
    max-width: 60rem;
    margin: 0 auto;
    padding: 1rem;
    display: flex;
    flex-direction: column;
    gap: 1rem;
  }

  h1,
  h2 {
    margin: 0;
    color: var(--text-strong);
  }

  .note,
  .status {
    margin: 0;
  }

  nav ul {
    display: flex;
    flex-wrap: wrap;
    gap: 0.5rem 1rem;
    margin: 0;
    padding: 0;
    list-style: none;
  }

  a {
    color: var(--text-strong);
  }

  section {
    display: flex;
    flex-direction: column;
    gap: 0.75rem;
    padding-top: 1rem;
    border-top: 1px solid var(--border);
  }

  button {
    align-self: flex-start;
    min-height: 2.75rem;
    padding: 0.5rem 1rem;
    font: inherit;
  }
</style>
