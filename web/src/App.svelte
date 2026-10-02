<script lang="ts">
  import { onMount } from 'svelte'
  import DataPage from './backend/DataPage.svelte'
  import { DATA_LINK, SERVER_PRIVACY_SECTIONS } from './backend/copy'
  import { DISCLAIMER } from './copy'
  import { PRIVACY_LINK } from './session/copy'
  import Privacy from './session/Privacy.svelte'
  import SessionApp from './session/SessionApp.svelte'
  import { browserSessionEnv, type SessionEnv } from './session/env'

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

  onMount(() => {
    const on = (): void => {
      privacy = isPrivacy(location.hash)
      data = isData(location.hash)
    }
    window.addEventListener('hashchange', on)
    return () => window.removeEventListener('hashchange', on)
  })
</script>

<!-- The session flow stays mounted (hidden) while the privacy notice is open, so a person who reads it
     mid-way through the start screens comes back to where they were. -->
<div class="flow" hidden={privacy || data}>
  <SessionApp {env} />
</div>
{#if privacy}
  <Privacy sections={backend === null ? undefined : SERVER_PRIVACY_SECTIONS} dataLink={backend !== null} />
{:else if data}
  <DataPage api={backend?.api ?? null} />
{/if}

<footer>
  <p class="disclaimer">{DISCLAIMER}</p>
  {#if backend !== null}
    <p class="links">
      <a class="hb-standalone-link" href="#/privacy">{PRIVACY_LINK}</a>
      <a class="hb-standalone-link" href="#/data">{DATA_LINK}</a>
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
</style>
