<!--
  On-screen digit keypad (ROADMAP M1.13; DESIGN §13 keyboard + touch): one button per digit in the
  given fixed order, identical apart from the digit it shows, so no button can mark the answer.
  The renderer that owns it also takes the physical digit keys. `columns` fixes the number of
  columns (the coding block keeps all nine keys in one row so key, target and keypad fit one phone
  screen; below 30rem the keys then give up their 2.75rem width, never their 2.75rem height).
  `narrowColumns` (with `columns`) lets that row fold: a container query on the keypad itself, so it
  follows the width the keypad really has (a phone, a narrow window, larger text) and not the screen's.
  When the keys would be under about 2.5rem (40 px) wide the nine keys sit in rows of five and four,
  each wider than 2.75rem where five fit. Only the layout changes: the same buttons, in the same
  order, with the same handlers.
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
    /** With `columns`: the row length once the keypad is narrower than about 24.5rem (nine keys of 2.5rem and their gaps); 5 gives rows of five and four. */
    readonly narrowColumns?: number
  }

  let { digits, onpress, label, disabled = false, columns, narrowColumns }: Props = $props()
</script>

<div
  class="keypad"
  class:fixed={columns !== undefined}
  class:split={columns !== undefined && narrowColumns !== undefined}
  style:--cols={columns}
  style:--cols-narrow={columns !== undefined ? narrowColumns : undefined}
  role="group"
  aria-label={label}
>
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

  /*
    A keypad that may fold (`narrowColumns`): a wrapping row whose keys share the width, and a container
    of its own, so the rule below can ask how wide the keypad is. The gap is a little wider than the
    unfolded phone keypad's, since a key that is not alone in a row of nine is easier to miss.
  */
  .keypad.split {
    --gap: 0.375rem;
    display: flex;
    flex-wrap: wrap;
    justify-content: center;
    gap: var(--gap);
    container-type: inline-size;
  }

  @media (max-width: 29.99rem) {
    .keypad.fixed.split {
      --gap: 0.25rem;
    }
  }

  .keypad.split .key {
    flex: 1 1 0;
  }

  /*
    Nine keys under about 2.5rem (40 px) wide: the keys take one row's share of the width (less 1px, so
    that rounding never pushes the fifth key down) and the rest wrap, to the middle of the next row.
  */
  @container (max-width: 24.49rem) {
    .keypad.split .key {
      flex: 0 0 calc((100% - (var(--cols-narrow) - 1) * var(--gap)) / var(--cols-narrow) - 1px);
    }
  }
</style>
