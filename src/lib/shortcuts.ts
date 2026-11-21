/**
 * The board's keyboard shortcuts, as shown in the "?" help. They follow Trello's where there's an
 * equivalent (j/k, c, d, l, m, n, f, q, x, Space, "," and "."), so they're familiar.
 *
 * Card shortcuts act on the selected card: the one with keyboard focus, else the one under the
 * pointer. None of them fire while typing in a field.
 */
export interface Shortcut {
  keys: string[]
  /** Alternative key sets, shown as "or". */
  alt?: string[]
  label: string
}

export interface ShortcutGroup {
  title: string
  items: Shortcut[]
}

export const SHORTCUT_GROUPS: ShortcutGroup[] = [
  {
    title: 'Moving around',
    items: [
      { keys: ['↓'], alt: ['j'], label: 'Next card' },
      { keys: ['↑'], alt: ['k'], label: 'Previous card' },
      { keys: ['←'], alt: ['→'], label: 'Card in the list to the left or right' },
      { keys: ['Enter'], alt: ['e'], label: 'Open the selected card' },
      { keys: ['Esc'], label: 'Close the card, menu or dialog' },
      { keys: ['1'], alt: ['2'], label: 'Board or canvas' },
      { keys: ['v'], label: 'Switch between board and calendar' },
    ],
  },
  {
    title: 'Selected card',
    items: [
      { keys: ['c'], label: 'Archive' },
      { keys: ['d'], label: 'Due date' },
      { keys: ['l'], label: 'Labels' },
      { keys: ['m'], label: 'Members' },
      { keys: ['Space'], label: 'Add or remove yourself' },
      { keys: [','], alt: ['.'], label: 'Move to the bottom of the list to the left or right' },
      { keys: ['<'], alt: ['>'], label: 'Move to the top of the list to the left or right' },
      { keys: ['Shift', 'M'], label: 'Move or copy to another list or room' },
    ],
  },
  {
    title: 'Board',
    items: [
      { keys: ['n'], label: 'Add a card to the selected card’s list' },
      { keys: ['/'], label: 'Search cards' },
      { keys: ['f'], label: 'Filter' },
      { keys: ['q'], label: 'Only cards you’re on' },
      { keys: ['x'], label: 'Clear search and filters' },
      { keys: ['?'], label: 'Show these shortcuts' },
    ],
  },
  {
    title: 'Calendar',
    items: [
      { keys: ['←'], alt: ['→'], label: 'Previous or next month (or week)' },
      { keys: ['t'], label: 'Back to today' },
    ],
  },
]

/** Plain keypress (no Ctrl / Cmd / Alt). Shift is allowed, since "?", "<" and ">" need it. */
export const isPlainKey = (e: KeyboardEvent) => !e.metaKey && !e.ctrlKey && !e.altKey

/** The next index when stepping through `length` items from `from` (−1 = none yet), clamped. */
export const stepIndex = (from: number, by: number, length: number) =>
  length === 0 ? -1 : from < 0 ? (by > 0 ? 0 : length - 1) : Math.max(0, Math.min(length - 1, from + by))
