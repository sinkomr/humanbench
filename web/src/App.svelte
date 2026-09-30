<script lang="ts">
  import { onMount } from 'svelte'
  import { DISCLAIMER } from './copy'
  import Privacy from './session/Privacy.svelte'
  import SessionApp from './session/SessionApp.svelte'
  import { browserSessionEnv, type SessionEnv } from './session/env'

  interface Props {
    /** Browser services for the session flow; tests inject fakes. */
    readonly env?: SessionEnv
  }

  let { env = browserSessionEnv() }: Props = $props()

  /** `#/privacy` shows the privacy notice and terms; every other hash is the session flow. */
  const isPrivacy = (hash: string): boolean => hash === '#/privacy'
  let privacy = $state(isPrivacy(location.hash))

  onMount(() => {
    const on = (): void => {
      privacy = isPrivacy(location.hash)
    }
    window.addEventListener('hashchange', on)
    return () => window.removeEventListener('hashchange', on)
  })
</script>

<!-- The session flow stays mounted (hidden) while the privacy notice is open, so a person who reads it
     mid-way through the start screens comes back to where they were. -->
<div class="flow" hidden={privacy}>
  <SessionApp {env} />
</div>
{#if privacy}
  <Privacy />
{/if}

<footer>
  <p class="disclaimer">{DISCLAIMER}</p>
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
</style>
