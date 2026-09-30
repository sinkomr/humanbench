<script lang="ts">
  /**
   * Notices about notes the person copied on an earlier visit (AI.6; proposal §3.3 "Returning
   * later"): a line withdrawn since, a line with new wording, a review-by month that has passed.
   * The notices come from `returningNotices` (pure); this component only shows them. It shows
   * nothing at all when there is nothing to say, and no notice ever leaves the device.
   */
  import type { ReturningNotice } from '../returning'

  interface Props {
    notices: readonly ReturningNotice[]
  }
  let { notices }: Props = $props()
</script>

{#if notices.length > 0}
  <section class="returning" aria-labelledby="returning-heading" data-testid="returning">
    <h2 id="returning-heading">About notes you made earlier</h2>
    <ul>
      {#each notices as n, i (i)}
        <li class="warn" data-kind={n.kind}>
          {#if n.label !== undefined}<strong>{n.label}.</strong>{/if}
          <span data-testid="returning-message">{n.message}</span>
        </li>
      {/each}
    </ul>
  </section>
{/if}

<style>
  ul {
    list-style: none;
    padding: 0;
    margin: 0;
  }
  li {
    margin: 0.5rem 0;
  }
</style>
