/**
 * Links between board cards: which cards the canvas connects, and the geometry of the arrows the
 * board draws for them on hover (see ../card-links.tsx).
 */

/** A canvas arrow between two task cards, in the direction it was drawn. Both are task ids. */
export interface CardLink {
  from: string
  to: string
}

interface CanvasItem {
  id: string
  type: string
  taskId?: string
  from?: string
  to?: string
}

/** Every distinct card-to-card link on the canvas. Arrows to notes, images etc. don't count. */
export const cardLinksOf = (items: CanvasItem[]): CardLink[] => {
  const taskOf = new Map<string, string>()
  for (const e of items) if (e.type === 'task' && e.taskId) taskOf.set(e.id, e.taskId)
  const out = new Map<string, CardLink>()
  for (const e of items) {
    if (e.type !== 'connector' || !e.from || !e.to) continue
    const from = taskOf.get(e.from)
    const to = taskOf.get(e.to)
    if (from && to && from !== to) out.set(`${from}>${to}`, { from, to })
  }
  return [...out.values()]
}

/** Task id → the cards it's linked to, whichever way the arrow points. */
export const linkedCards = (links: CardLink[]): Map<string, Set<string>> => {
  const out = new Map<string, Set<string>>()
  const add = (a: string, b: string) => {
    if (!out.has(a)) out.set(a, new Set())
    out.get(a)!.add(b)
  }
  for (const l of links) {
    add(l.from, l.to)
    add(l.to, l.from)
  }
  return out
}

export interface Box {
  left: number
  top: number
  right: number
  bottom: number
}

export const intersect = (a: Box, b: Box): Box => ({
  left: Math.max(a.left, b.left),
  top: Math.max(a.top, b.top),
  right: Math.min(a.right, b.right),
  bottom: Math.min(a.bottom, b.bottom),
})

/** Enough of a card showing to point at. */
const MIN_W = 32
const MIN_H = 14
export const isShowing = (b: Box) => b.right - b.left >= MIN_W && b.bottom - b.top >= MIN_H

export type Edge = 'up' | 'down' | 'left' | 'right'

const PILL_W = 168
const PILL_H = 24
const PILL_GAP = 4
const INSET = 8
const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(v, Math.max(lo, hi)))

/**
 * Where the label for a card scrolled out of sight goes: the board's side if its whole list is out
 * of view, otherwise the top or bottom of its list. `used` keeps labels sharing an edge apart.
 */
export const placePill = (
  card: Box,
  list: Box,
  board: Box,
  used: Box[],
): { box: Box; edge: Edge } => {
  const seen = intersect(list, board)
  let edge: Edge
  let left: number
  let top: number
  if (Math.min(card.right, board.right) - Math.max(card.left, board.left) < MIN_W) {
    edge = card.left < board.left ? 'left' : 'right'
    left = edge === 'left' ? board.left + INSET : board.right - INSET - PILL_W
    top = clamp((card.top + card.bottom - PILL_H) / 2, seen.top, seen.bottom - PILL_H)
  } else {
    edge = card.top < list.top ? 'up' : 'down'
    left = clamp(
      (card.left + card.right - PILL_W) / 2,
      board.left + INSET,
      board.right - INSET - PILL_W,
    )
    top = edge === 'up' ? seen.top + PILL_GAP : seen.bottom - PILL_GAP - PILL_H
  }
  // Stack away from the edge; side labels stack towards the middle of the board.
  const step =
    (PILL_H + PILL_GAP) *
    (edge === 'up' || (edge !== 'down' && top < (board.top + board.bottom) / 2) ? 1 : -1)
  const at = (): Box => ({ left, top, right: left + PILL_W, bottom: top + PILL_H })
  while (used.some((u) => isShowingAny(intersect(u, at())))) top += step
  return { box: at(), edge }
}
const isShowingAny = (b: Box) => b.right > b.left && b.bottom > b.top

/** Distance between the arrow tip and the card it points at. */
const TIP_GAP = 4

/**
 * Which sides an arrow leaves and enters by. Boxes side by side use their facing sides; boxes above
 * one another share a side, so the arrow loops around instead of crossing the cards between them.
 */
export const sidesFor = (from: Box, to: Box, board: Box): { start: 1 | -1; end: 1 | -1 } => {
  if (to.left >= from.right) return { start: 1, end: -1 }
  if (to.right <= from.left) return { start: -1, end: 1 }
  const side = Math.max(from.right, to.right) + 32 <= board.right ? 1 : -1
  return { start: side, end: side }
}

/** An SVG cubic path between two boxes, plus its tip. `y1`/`y2` are the heights it meets each at. */
export const arrowPath = (from: Box, to: Box, y1: number, y2: number, board: Box): string => {
  const { start, end } = sidesFor(from, to, board)
  const x1 = start === 1 ? from.right : from.left
  const x2 = (end === 1 ? to.right : to.left) + end * TIP_GAP
  let c1: number
  let c2: number
  if (start === end) {
    // Loop: both handles out to the same line, so it bulges past the wider box.
    const out = (start === 1 ? Math.max(x1, x2) : Math.min(x1, x2)) + start * 34
    c1 = out
    c2 = out
  } else {
    const reach = Math.max(28, Math.abs(x2 - x1) * 0.45)
    c1 = x1 + start * reach
    c2 = x2 + end * reach
  }
  const n = (v: number) => Math.round(v * 10) / 10
  return `M${n(x1)} ${n(y1)} C${n(c1)} ${n(y1)} ${n(c2)} ${n(y2)} ${n(x2)} ${n(y2)}`
}

/** Spreads `count` arrows evenly around the middle of a box's side. */
export const spread = (box: Box, i: number, count: number) => {
  const gap = Math.min(12, (box.bottom - box.top - 12) / Math.max(1, count))
  return (box.top + box.bottom) / 2 + (i - (count - 1) / 2) * Math.max(0, gap)
}
