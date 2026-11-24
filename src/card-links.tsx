import { type RefObject, useEffect, useMemo, useState } from 'react'
import { createPortal } from 'react-dom'
import {
  type Box,
  type CardLink,
  type Edge,
  arrowPath,
  intersect,
  isShowing,
  placePill,
  sidesFor,
  spread,
} from './lib/card-links'

/** Resting on a card, not just passing over it. */
const HOVER_DELAY = 140

const ARROW: Record<Edge, string> = { up: '↑', down: '↓', left: '←', right: '→' }

interface Scene {
  board: Box
  arrows: { key: string; line: string; head: string; out: boolean }[]
  rings: { id: string; box: Box }[]
  pills: { id: string; box: Box; edge: Edge }[]
}

const boxOf = (el: Element): Box => {
  const r = el.getBoundingClientRect()
  return { left: r.left, top: r.top, right: r.right, bottom: r.bottom }
}

const cardEl = (id: string) =>
  document.getElementById(`task-${id}`)?.querySelector<HTMLElement>('[data-card-id]') ?? null

/** Measures the cards and lays out everything to draw for `id`, in viewport coordinates. */
function buildScene(id: string, links: CardLink[], boardEl: HTMLElement): Scene | null {
  const source = cardEl(id)
  if (!source) return null
  const board = boxOf(boardEl)
  const listOf = (el: HTMLElement) => boxOf(el.closest('.dv-card-list') ?? boardEl)
  const from = intersect(intersect(boxOf(source), listOf(source)), board)
  if (!isShowing(from)) return null

  const ends = new Map<string, Box>()
  const rings: Scene['rings'] = []
  const pills: Scene['pills'] = []
  for (const l of links) {
    const other = l.from === id ? l.to : l.from
    if (ends.has(other)) continue
    const el = cardEl(other)
    if (!el) continue // filtered out of the board, or archived
    const card = boxOf(el)
    const list = listOf(el)
    const seen = intersect(intersect(card, list), board)
    if (isShowing(seen)) {
      ends.set(other, seen)
      rings.push({ id: other, box: seen })
    } else {
      const pill = placePill(card, list, board, [from, ...pills.map((p) => p.box)])
      ends.set(other, pill.box)
      pills.push({ id: other, ...pill })
    }
  }

  // Fan arrows out along each side of the card, ordered by height so they don't cross.
  const drawn = links
    .flatMap((l) => {
      const out = l.from === id
      const to = ends.get(out ? l.to : l.from)
      return to ? [{ out, to, other: out ? l.to : l.from, side: sidesFor(from, to, board).start }] : []
    })
    .sort((a, b) => a.to.top - b.to.top || a.to.left - b.to.left)
  const arrows = [1, -1].flatMap((side) => {
    const group = drawn.filter((a) => a.side === side)
    return group.map((a, i) => {
      const y = spread(from, i, group.length)
      // Two cards linked both ways get two arrows; keep their far ends apart too.
      const y2 = (a.to.top + a.to.bottom) / 2 + (drawn.some((b) => b !== a && b.other === a.other) ? (a.out ? -5 : 5) : 0)
      return {
        key: `${a.other}${a.out ? '>' : '<'}`,
        out: a.out,
        ...(a.out ? arrowPath(from, a.to, y, y2, board) : arrowPath(a.to, from, y2, y, board)),
      }
    })
  })
  return arrows.length ? { board, arrows, rings, pills } : null
}

/** The arrows for one card. Follows the cards as lists scroll or other people move things. */
function Arrows({
  id,
  links,
  boardRef,
  titleOf,
}: {
  id: string
  links: CardLink[]
  boardRef: RefObject<HTMLElement | null>
  titleOf: (id: string) => string
}) {
  const [scene, setScene] = useState<Scene | null>(null)
  useEffect(() => {
    let raf = 0
    let last = ''
    const tick = () => {
      const next = boardRef.current && buildScene(id, links, boardRef.current)
      const sig = JSON.stringify(next)
      if (sig !== last) {
        last = sig
        setScene(next)
      }
      raf = requestAnimationFrame(tick)
    }
    raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
  }, [id, links, boardRef])

  if (!scene) return null
  const { board } = scene
  return createPortal(
    <div
      className="dv-links"
      aria-hidden
      style={{
        left: board.left,
        top: board.top,
        width: board.right - board.left,
        height: board.bottom - board.top,
      }}
    >
      <svg
        width="100%"
        height="100%"
        viewBox={`${board.left} ${board.top} ${board.right - board.left} ${board.bottom - board.top}`}
      >
        {scene.rings.map(({ id, box }) => (
          <rect
            key={id}
            className="dv-links-ring"
            x={box.left + 0.75}
            y={box.top + 0.75}
            width={box.right - box.left - 1.5}
            height={box.bottom - box.top - 1.5}
            rx="9"
          />
        ))}
        {scene.arrows.map((a) => (
          <g key={a.key} className="dv-links-arrow" data-dir={a.out ? 'out' : 'in'}>
            <path className="dv-links-line" d={a.line} />
            <path className="dv-links-head" d={a.head} />
          </g>
        ))}
      </svg>
      {scene.pills.map(({ id, box, edge }) => (
        <div
          key={id}
          className="dv-links-pill"
          style={{
            left: box.left - board.left,
            top: box.top - board.top,
            width: box.right - box.left,
            height: box.bottom - box.top,
          }}
        >
          <span>{ARROW[edge]}</span>
          <span className="truncate">{titleOf(id)}</span>
        </div>
      ))}
    </div>,
    document.body,
  )
}

/**
 * Hovering (or keyboard-selecting) a card points faint arrows at the cards it's linked to on the
 * canvas. Listens on the board itself, so moving the mouse never re-renders the board.
 */
export function CardLinks({
  links,
  boardRef,
  enabled,
  titleOf,
}: {
  links: CardLink[]
  boardRef: RefObject<HTMLElement | null>
  /** Off while something else has the stage: dragging, menus, dialogs. */
  enabled: boolean
  titleOf: (id: string) => string
}) {
  const [hovered, setHovered] = useState<string | null>(null)
  const [focused, setFocused] = useState<string | null>(null)

  useEffect(() => {
    const board = boardRef.current
    if (!board || !enabled) return
    let timer = 0
    let current: string | null = null
    const idAt = (t: EventTarget | null) =>
      t instanceof Element ? (t.closest<HTMLElement>('[data-card-id]')?.dataset.cardId ?? null) : null
    const hover = (id: string | null) => {
      if (id === current) return
      current = id
      window.clearTimeout(timer)
      setHovered(null)
      if (id) timer = window.setTimeout(() => setHovered(id), HOVER_DELAY)
    }
    const onOver = (e: PointerEvent) => {
      if (e.pointerType !== 'touch') hover(idAt(e.target))
    }
    const onLeave = () => hover(null)
    const onFocus = (e: FocusEvent) =>
      setFocused((e.target as HTMLElement).matches(':focus-visible') ? idAt(e.target) : null)
    const onBlur = () => setFocused(null)
    board.addEventListener('pointerover', onOver)
    board.addEventListener('pointerleave', onLeave)
    board.addEventListener('focusin', onFocus)
    board.addEventListener('focusout', onBlur)
    return () => {
      window.clearTimeout(timer)
      setHovered(null)
      setFocused(null)
      board.removeEventListener('pointerover', onOver)
      board.removeEventListener('pointerleave', onLeave)
      board.removeEventListener('focusin', onFocus)
      board.removeEventListener('focusout', onBlur)
    }
  }, [boardRef, enabled])

  const id = hovered ?? focused
  const mine = useMemo(() => links.filter((l) => l.from === id || l.to === id), [links, id])
  if (!enabled || !id || !mine.length) return null
  return <Arrows key={id} id={id} links={mine} boardRef={boardRef} titleOf={titleOf} />
}
