<script lang="ts">
  import { DISCLAIMER, HEADING, TAGLINE } from './copy'
</script>

<main>
  <h1>{HEADING}</h1>
  <p class="tagline">{TAGLINE}</p>
</main>

<footer>
  <p class="disclaimer">{DISCLAIMER}</p>
</footer>

<style>
  main {
    flex: 1;
    display: flex;
    flex-direction: column;
    justify-content: center;
    align-items: center;
    gap: 0.75rem;
    padding: 3rem 1rem;
    text-align: center;
  }

  h1 {
    margin: 0;
    font-size: clamp(2.25rem, 8vw, 3.5rem);
    font-weight: 600;
    letter-spacing: -0.02em;
    color: var(--text-strong);
  }

  .tagline {
    margin: 0;
    font-size: 1.125rem;
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
