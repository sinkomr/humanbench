<script lang="ts">
  import { onMount, tick } from 'svelte'
  import DataPage from './backend/DataPage.svelte'
  import { DATA_LINK, SERVER_PRIVACY_SECTIONS } from './backend/copy'
  import { DISCLAIMER } from './copy'
  import { NEW_TAB, PRIVACY_LINK } from './session/copy'
  import type { FlowPhase } from './session/phase'
  import Privacy from './session/Privacy.svelte'
  import SessionApp from './session/SessionApp.svelte'
  import { browserSessionEnv, type SessionEnv } from './session/env'
  import { pageTitle } from './session/title'

  interface Props {
    /** Browser services for the session flow; tests inject fakes. */
    readonly env?: SessionEnv
  }

  let { env = browserSessionEnv() }: Props = $props()

  /** `#/privacy` shows the privacy notice and terms; `#/data` the page about data on the server (M2.7); every other hash is the session flow. */
  const isPrivacy = (hash: string): boolean => hash === '#/privacy'
  const isData = (hash: string): boolean => hash === '#/data'
  let privacy = $state(isPrivacy(location.hash))
  let data = $state(isData(location.hash))
  const backend = $derived(env.backend ?? null)
  /** The notice (or the data page) was opened by a link inside the app, so "Back" goes back by the history (UX-011). */
  let openedInApp = false
  /** Which screen of the flow is up: while a run is under way the notice opens in a new tab and never hides the clock (UX-011). */
  let flowPhase: FlowPhase = $state('welcome')
  /** The welcome screen has its own "Privacy and terms" link under Start (UX-016), so the footer does not offer a second one there (VER-02). */
  const welcomeHasLink = $derived(flowPhase === 'welcome' && !privacy && !data)

  onMount(() => {
    const on = (): void => {
      const before = privacy || data
      privacy = isPrivacy(location.hash)
      data = isData(location.hash)
      const after = privacy || data
      if (after && !before) openedInApp = true
      if (before && !after) {
        openedInApp = false
        // The flow stayed mounted under the notice: its tab title and its heading's focus are put back (WCAG 2.4.2, 2.4.3).
        void tick().then(() => {
          const heading = document.querySelector<HTMLElement>('.flow:not([hidden]) h1')
          if (heading === null) return
          document.title = pageTitle(heading.textContent ?? '')
          heading.focus()
        })
      }
    }
    window.addEventListener('hashchange', on)
    return () => window.removeEventListener('hashchange', on)
  })

  /** "Back" on the notice: by the history when the notice was opened from a link here, else to the start. */
  function leaveNotice(): void {
    if (openedInApp) history.back()
    else location.hash = '#/'
  }
</script>

<!-- The session flow stays mounted (hidden) while the privacy notice is open, so a person who reads it
     mid-way through the start screens comes back to where they were. -->
<div class="flow" hidden={privacy || data}>
  <SessionApp {env} onphase={(p) => (flowPhase = p)} />
</div>
{#if privacy}
  <Privacy sections={backend === null ? undefined : SERVER_PRIVACY_SECTIONS} dataLink={backend !== null} onback={leaveNotice} />
{:else if data}
  <DataPage api={backend?.api ?? null} />
{/if}

<footer>
  <p class="disclaimer">{DISCLAIMER}</p>
  {#if !welcomeHasLink || backend !== null}
    <p class="links">
      {#if !welcomeHasLink}
        {#if flowPhase === 'run'}
          <a class="hb-standalone-link" href="#/privacy" target="_blank" rel="noopener">{PRIVACY_LINK}{NEW_TAB}</a>
        {:else}
          <a class="hb-standalone-link" href="#/privacy">{PRIVACY_LINK}</a>
        {/if}
      {/if}
      {#if backend !== null}
        <a class="hb-standalone-link" href="#/data">{DATA_LINK}</a>
      {/if}
    </p>
  {/if}
</footer>

<style>
  .flow {
    flex: 1;
    display: flex;
    flex-direction: column;
    min-width: 0;
  }

  .flow[hidden] {
    display: none;
  }

  footer {
    border-top: 1px solid var(--border);
    padding: 1rem;
    text-align: center;
  }

  .disclaimer {
    margin: 0 auto;
    max-width: 40rem;
    font-size: 0.875rem;
  }

  .links {
    display: flex;
    flex-wrap: wrap;
    justify-content: center;
    gap: 0.5rem 1.5rem;
    margin: 0.5rem auto 0;
    font-size: 0.875rem;
  }

  /* A phone: each link is a target of 44 px (10 px above and below its 24 px line), with the same small text (VER-02). */
  @media (max-width: 40rem) {
    .links a {
      padding: 0.625rem 0;
    }
  }
</style>
