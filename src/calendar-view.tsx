import React, { useEffect, useMemo, useRef, useState } from 'react'
import { CalendarX2, ChevronLeft, ChevronRight, PanelRightClose, PanelRightOpen } from 'lucide-react'
import { isTyping } from './lib/bus'
import { dueState } from './lib/cards'
import {
  type CalendarMode,
  byDay,
  fromDay,
  periodTitle,
  stepPeriod,
  toDay,
  visibleDays,
  weekdayNames,
} from './lib/calendar'
import { isPlainKey } from './lib/shortcuts'
import { useIsMobile } from './lib/viewport'

export interface CalendarCard {
  id: string
  title: string
  dueDate: string | null
  listName: string
  done: boolean
  /** The card stripe's colour, if the board colours cards. */
  color: string | null
  labels: { id: string; name: string; color: string }[]
}

interface Props {
  roomId: string
  cards: CalendarCard[]
  /** Board tab showing and nothing open on top: arrow keys page through periods. */
  active: boolean
  onOpen: (id: string) => void
  /** null clears the due date. */
  onSetDue: (id: string, day: string | null) => void
}

const DRAG_TYPE = 'application/x-brownboard-card'
/** Day cells show this many cards in month view before "+N more". */
const MONTH_LIMIT = 3

const prefsKey = (roomId: string) => `brownboard:calendar:${roomId}`
const readPrefs = (roomId: string): { mode?: CalendarMode; tray?: boolean } => {
  try {
    return JSON.parse(localStorage.getItem(prefsKey(roomId)) ?? '{}') ?? {}
  } catch {
    return {}
  }
}

/**
 * Cards by due date, a month or a week at a time. Drag a card to another day to change its due
 * date, onto "No due date" to clear it, or hold it over the arrows to reach another month.
 */
export const CalendarView: React.FC<Props> = ({ roomId, cards, active, onOpen, onSetDue }) => {
  const isMobile = useIsMobile()
  const [anchor, setAnchor] = useState(() => new Date())
  const [mode, setMode] = useState<CalendarMode>(() => readPrefs(roomId).mode ?? (isMobile ? 'week' : 'month'))
  const [trayOpen, setTrayOpen] = useState(() => readPrefs(roomId).tray ?? !isMobile)
  const [dragId, setDragId] = useState<string | null>(null)
  const [overDay, setOverDay] = useState<string | null>(null)
  const [expanded, setExpanded] = useState<string | null>(null)
  const flipTimer = useRef<number | undefined>(undefined)

  useEffect(() => {
    try {
      localStorage.setItem(prefsKey(roomId), JSON.stringify({ mode, tray: trayOpen }))
    } catch {
      /* not remembered */
    }
  }, [roomId, mode, trayOpen])

  const days = useMemo(() => visibleDays(anchor, mode), [anchor, mode])
  const due = useMemo(() => byDay(cards), [cards])
  const unscheduled = cards.filter((c) => !c.dueDate || !fromDay(c.dueDate))
  const today = toDay(new Date())
  const month = anchor.getMonth()
  const names = weekdayNames(undefined, isMobile && mode === 'month' ? 'narrow' : 'short')

  const step = (by: number) => {
    setExpanded(null)
    setAnchor((a) => stepPeriod(a, mode, by))
  }

  useEffect(() => {
    if (!active) return
    const onKey = (e: KeyboardEvent) => {
      if (!isPlainKey(e) || e.shiftKey || isTyping(e) || e.defaultPrevented) return
      if (document.querySelector('.dv-modal-backdrop')) return
      if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
        e.preventDefault()
        setExpanded(null)
        setAnchor((a) => stepPeriod(a, mode, e.key === 'ArrowLeft' ? -1 : 1))
      } else if (e.key === 't') {
        e.preventDefault()
        setAnchor(new Date())
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [active, mode])

  const endDrag = () => {
    setDragId(null)
    setOverDay(null)
    window.clearTimeout(flipTimer.current)
  }

  const dropProps = (day: string | null) => ({
    onDragOver: (e: React.DragEvent) => {
      if (!e.dataTransfer.types.includes(DRAG_TYPE)) return
      e.preventDefault()
      e.dataTransfer.dropEffect = 'move'
      const key = day ?? 'none'
      if (overDay !== key) setOverDay(key)
    },
    onDragLeave: (e: React.DragEvent) => {
      if (!e.currentTarget.contains(e.relatedTarget as Node)) setOverDay(null)
    },
    onDrop: (e: React.DragEvent) => {
      const id = e.dataTransfer.getData(DRAG_TYPE)
      e.preventDefault()
      endDrag()
      const card = cards.find((c) => c.id === id)
      if (card && card.dueDate !== day) onSetDue(id, day)
    },
  })

  /** Holding a dragged card over an arrow flips to the next period, so cards can cross months. */
  const flipProps = (by: number) => ({
    onDragOver: (e: React.DragEvent) => {
      if (!e.dataTransfer.types.includes(DRAG_TYPE)) return
      e.preventDefault()
      if (flipTimer.current) return
      flipTimer.current = window.setTimeout(() => {
        flipTimer.current = undefined
        step(by)
      }, 550)
    },
    onDragLeave: () => {
      window.clearTimeout(flipTimer.current)
      flipTimer.current = undefined
    },
  })

  const chip = (c: CalendarCard) => {
    const state = c.dueDate ? dueState(c.dueDate, c.done) : null
    return (
      <button
        key={c.id}
        type="button"
        draggable
        className="dv-cal-card"
        data-done={c.done}
        data-state={state ?? undefined}
        data-dragging={dragId === c.id}
        title={`${c.title} · ${c.listName}`}
        style={{ '--bar': c.color ?? 'var(--dv-border)' } as React.CSSProperties}
        onClick={() => onOpen(c.id)}
        onDragStart={(e) => {
          e.dataTransfer.setData(DRAG_TYPE, c.id)
          e.dataTransfer.effectAllowed = 'move'
          setDragId(c.id)
        }}
        onDragEnd={endDrag}
      >
        {c.labels.length > 0 && (
          <span className="dv-cal-labels" aria-hidden>
            {c.labels.slice(0, 4).map((l) => (
              <span key={l.id} style={{ background: l.color }} />
            ))}
          </span>
        )}
        <span className="dv-cal-title">{c.title}</span>
        {mode === 'week' && <span className="dv-cal-list">{c.listName}</span>}
      </button>
    )
  }

  return (
    <div className="dv-cal" data-mode={mode}>
      <div className="dv-cal-bar">
        <div className="flex items-center gap-1">
          <button className="dv-iconbtn" aria-label={`Previous ${mode}`} title={`Previous ${mode} (←)`} onClick={() => step(-1)} {...flipProps(-1)}>
            <ChevronLeft size={16} />
          </button>
          <button className="dv-iconbtn" aria-label={`Next ${mode}`} title={`Next ${mode} (→)`} onClick={() => step(1)} {...flipProps(1)}>
            <ChevronRight size={16} />
          </button>
          <button className="dv-btn !h-8" title="Today (t)" onClick={() => setAnchor(new Date())}>
            Today
          </button>
        </div>
        <h2 className="dv-cal-period" aria-live="polite">
          {periodTitle(anchor, mode)}
        </h2>
        <div className="ml-auto flex items-center gap-2">
          <div className="dv-seg" role="radiogroup" aria-label="Calendar range">
            {(['month', 'week'] as const).map((m) => (
              <button
                key={m}
                role="radio"
                aria-checked={mode === m}
                data-active={mode === m}
                onClick={() => {
                  setExpanded(null)
                  setMode(m)
                }}
              >
                {m === 'month' ? 'Month' : 'Week'}
              </button>
            ))}
          </div>
          <button
            className="dv-btn !h-8"
            data-active={trayOpen}
            aria-pressed={trayOpen}
            title={trayOpen ? 'Hide cards without a due date' : 'Show cards without a due date'}
            onClick={() => setTrayOpen((v) => !v)}
          >
            {trayOpen ? <PanelRightClose size={14} /> : <PanelRightOpen size={14} />}
            <span className="dv-hide-mobile">No date</span>
            <span className="dv-count muted">{unscheduled.length}</span>
          </button>
        </div>
      </div>

      <div className="dv-cal-body">
        <div className="dv-cal-main">
          <div className="dv-cal-weekdays" aria-hidden>
            {names.map((n) => (
              <span key={n}>{n}</span>
            ))}
          </div>
          <div className="dv-cal-grid dv-scroll" role="grid" aria-label={periodTitle(anchor, mode)}>
            {days.map((d) => {
              const key = toDay(d)
              const list = due.get(key) ?? []
              const open = expanded === key || mode === 'week'
              const shown = open ? list : list.slice(0, MONTH_LIMIT)
              return (
                <div
                  key={key}
                  role="gridcell"
                  className="dv-cal-day"
                  data-today={key === today}
                  data-outside={mode === 'month' && d.getMonth() !== month}
                  data-over={overDay === key}
                  data-expanded={expanded === key}
                  aria-label={new Intl.DateTimeFormat(undefined, { dateStyle: 'full' }).format(d)}
                  {...dropProps(key)}
                >
                  <span className="dv-cal-date">
                    {mode === 'week' && (
                      <span className="dv-cal-dow">{names[(d.getDay() + 6) % 7]}</span>
                    )}
                    {d.getDate() === 1 && mode === 'month'
                      ? new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric' }).format(d)
                      : d.getDate()}
                  </span>
                  <div className="dv-cal-cards">
                    {shown.map(chip)}
                    {!open && list.length > MONTH_LIMIT && (
                      <button className="dv-cal-more" onClick={() => setExpanded(key)}>
                        +{list.length - MONTH_LIMIT} more
                      </button>
                    )}
                    {expanded === key && mode === 'month' && (
                      <button className="dv-cal-more" onClick={() => setExpanded(null)}>
                        Show less
                      </button>
                    )}
                  </div>
                </div>
              )
            })}
          </div>
        </div>

        {trayOpen && (
          <aside
            className="dv-cal-tray"
            data-over={overDay === 'none'}
            aria-label="Cards without a due date"
            {...dropProps(null)}
          >
            <h3 className="dv-label m-0 flex items-center gap-1.5">
              <CalendarX2 size={13} aria-hidden />
              No due date
            </h3>
            <p className="m-0 text-[11.5px]" style={{ color: 'var(--dv-muted)' }}>
              Drag a card onto a day to schedule it, or here to clear its date.
            </p>
            <div className="dv-cal-cards dv-scroll">
              {unscheduled.map(chip)}
              {unscheduled.length === 0 && (
                <p className="m-0 py-3 text-center text-xs" style={{ color: 'var(--dv-muted)' }}>
                  Every card has a date.
                </p>
              )}
            </div>
          </aside>
        )}
      </div>
    </div>
  )
}
