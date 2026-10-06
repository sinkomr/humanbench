<!--
  Test-only stand-in for the results screen (`Finished.svelte`), for the flow tests that need the person to ask
  for a focus session without sitting through the real screen's save step. Never imported by the app.
-->
<script lang="ts">
  import type { AxisCode } from '../engine/axes'

  interface Props {
    readonly onfocus?: (axes: AxisCode[]) => void
    readonly onrestart?: () => void
  }

  let { onfocus, onrestart }: Props = $props()
</script>

<main>
  <h1>Your results</h1>
  <button type="button" onclick={() => onfocus?.(['RT'])}>Focus on reaction time</button>
  <button type="button" onclick={() => onrestart?.()}>Back to the start</button>
</main>
