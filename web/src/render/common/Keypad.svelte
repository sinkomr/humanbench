<!--
  On-screen digit keypad (ROADMAP M1.13; DESIGN §13 keyboard + touch): one button per digit in the
  given fixed order, identical apart from the digit it shows, so no button can mark the answer.
  The renderer that owns it also takes the physical digit keys. `columns` fixes the number of
  columns (the coding block keeps all nine keys in one row so key, target and keypad fit one phone
  screen; below 30rem the keys then give up their 2.75rem width, never their 2.75rem height).
-->
<script lang="ts">
  import './render.css'

  interface Props {
    readonly digits: readonly number[]
    readonly onpress: (digit: number, event: MouseEvent) => void
    /** Accessible name of the keypad group. */
    readonly label: string
    readonly disabled?: boolean
    /** A fixed number of columns; omitted = as many 2.75rem keys as fit. */
    readonly columns?: number
  }

  let { digits, onpress, label, disabled = false, columns }: Props = $props()
</script>

<div class="keypad" class:fixed={columns !== undefined} style:--cols={columns} role="group" aria-label={label}>
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
    touch-action: manipulation;
  }

  .keypad.fixed {
    grid-template-columns: repeat(var(--cols), minmax(0, 1fr));
  }

  .key {
    padding: 0.5rem 0;
    font-size: 1.25rem;
    font-variant-numeric: tabular-nums;
  }

  @media (max-width: 29.99rem) {
    .keypad.fixed {
      gap: 0.125rem;
    }

    .keypad.fixed .key {
      min-width: 0;
    }
  }
</style>
