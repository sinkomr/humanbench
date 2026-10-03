<!--
  On-screen digit keypad (ROADMAP M1.13; DESIGN §13 keyboard + touch): one button per digit in the
  given fixed order, identical apart from the digit it shows, so no button can mark the answer.
  The renderer that owns it also takes the physical digit keys.
-->
<script lang="ts">
  import './render.css'

  interface Props {
    readonly digits: readonly number[]
    readonly onpress: (digit: number, event: MouseEvent) => void
    /** Accessible name of the keypad group. */
    readonly label: string
    readonly disabled?: boolean
  }

  let { digits, onpress, label, disabled = false }: Props = $props()
</script>

<div class="keypad" role="group" aria-label={label}>
  {#each digits as d (d)}
    <button type="button" class="hb-btn key" {disabled} onclick={(e) => onpress(d, e)}>{d}</button>
  {/each}
</div>

<style>
  .keypad {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(2.75rem, 1fr));
    gap: 0.375rem;
    max-width: 32rem;
  }

  .key {
    padding: 0.5rem 0;
    font-size: 1.25rem;
    font-variant-numeric: tabular-nums;
  }
</style>
