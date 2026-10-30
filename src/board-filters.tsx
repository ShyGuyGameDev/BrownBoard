import React from 'react'
import { CalendarClock, Check, CircleCheck, Tag, UserRound, X } from 'lucide-react'
import { colorFor } from './lib/room'
import { type TaskOption } from './lib/options'
import { type TaskAssignee } from './lib/tasks'
import { type Label, daysUntil, isDueThisWeek } from './lib/cards'
import { Avatar } from './avatar'

export type DueFilter = 'overdue' | 'week' | 'none'

/**
 * Board filters. Within a section any match counts (label A or B); sections combine (labels and
 * members). Kept per room in this browser: it's a personal view, not a change to the board.
 */
export interface BoardFilters {
  labels: string[]
  /** person ids, plus 'none' for cards with no members */
  members: string[]
  due: DueFilter[]
  /** category ('status', 'urgency' or a custom id) → the values to show */
  fields: Record<string, string[]>
  hideDone: boolean
}

export const EMPTY_FILTERS: BoardFilters = {
  labels: [],
  members: [],
  due: [],
  fields: {},
  hideDone: false,
}

const key = (roomId: string) => `brownboard:filters:${roomId}`

export const readFilters = (roomId: string): BoardFilters => {
  try {
    const raw = JSON.parse(localStorage.getItem(key(roomId)) ?? 'null')
    if (!raw || typeof raw !== 'object') return EMPTY_FILTERS
    const strings = (v: unknown) =>
      Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : []
    return {
      labels: strings(raw.labels),
      members: strings(raw.members),
      due: strings(raw.due).filter((d): d is DueFilter => ['overdue', 'week', 'none'].includes(d)),
      fields: Object.fromEntries(Object.entries(raw.fields ?? {}).map(([k, v]) => [k, strings(v)])),
      hideDone: raw.hideDone === true,
    }
  } catch {
    return EMPTY_FILTERS
  }
}

export const saveFilters = (roomId: string, filters: BoardFilters) => {
  try {
    localStorage.setItem(key(roomId), JSON.stringify(filters))
  } catch {
    /* not remembered */
  }
}

export const activeFilterCount = (f: BoardFilters) =>
  f.labels.length +
  f.members.length +
  f.due.length +
  Object.values(f.fields).reduce((n, v) => n + v.length, 0) +
  (f.hideDone ? 1 : 0)

export interface FilterableTask {
  labelIds: string[]
  memberIds: string[]
  dueDate: string | null
}

export const matchesFilters = (
  f: BoardFilters,
  t: FilterableTask,
  done: boolean,
  valueOf: (field: string) => string | null,
) => {
  if (f.hideDone && done) return false
  if (f.labels.length && !f.labels.some((id) => t.labelIds.includes(id))) return false
  if (
    f.members.length &&
    !f.members.some((id) => (id === 'none' ? t.memberIds.length === 0 : t.memberIds.includes(id)))
  )
    return false
  if (f.due.length) {
    const ok = f.due.some((d) => {
      if (d === 'none') return !t.dueDate
      if (!t.dueDate) return false
      if (d === 'overdue') return !done && (daysUntil(t.dueDate) ?? 0) < 0
      return isDueThisWeek(t.dueDate)
    })
    if (!ok) return false
  }
  for (const [field, values] of Object.entries(f.fields)) {
    if (!values.length) continue
    const v = valueOf(field)
    if (!values.some((x) => (x === '' ? v === null : x === v))) return false
  }
  return true
}

const toggle = <T,>(list: T[], v: T) =>
  list.includes(v) ? list.filter((x) => x !== v) : [...list, v]

const Row: React.FC<{
  on: boolean
  onClick: () => void
  children: React.ReactNode
}> = ({ on, onClick, children }) => (
  <button
    className="dv-menu-item"
    role="menuitemcheckbox"
    aria-checked={on}
    data-selected={on}
    onClick={onClick}
  >
    <span className="dv-check-box" data-on={on} aria-hidden>
      {on && <Check size={11} strokeWidth={3} />}
    </span>
    {children}
  </button>
)

export const FilterMenu: React.FC<{
  filters: BoardFilters
  onChange: (f: BoardFilters) => void
  labels: Label[]
  people: TaskAssignee[]
  userId: string | null
  fields: { field: string; name: string; options: TaskOption[] }[]
  doneLabel: string
}> = ({ filters, onChange, labels, people, userId, fields, doneLabel }) => {
  const set = (patch: Partial<BoardFilters>) => onChange({ ...filters, ...patch })
  const count = activeFilterCount(filters)
  // You first, then everyone else.
  const sortedPeople = [...people].sort((a, b) =>
    a.id === userId ? -1 : b.id === userId ? 1 : a.name.localeCompare(b.name),
  )
  return (
    <div className="dv-filter-menu">
      <div className="flex items-center justify-between px-2 pb-1 pt-1.5">
        <span className="text-xs font-semibold" style={{ color: 'var(--dv-muted)' }}>
          Filter cards
        </span>
        {count > 0 && (
          <button className="dv-link text-xs" onClick={() => onChange(EMPTY_FILTERS)}>
            Clear all ({count})
          </button>
        )}
      </div>

      <div className="dv-filter-section">
        <div className="dv-menu-head">
          <CircleCheck size={12} /> Progress
        </div>
        <Row on={filters.hideDone} onClick={() => set({ hideDone: !filters.hideDone })}>
          <span className="flex-1">Hide done cards</span>
          <span className="text-[11px]" style={{ color: 'var(--dv-muted)' }}>
            {doneLabel}
          </span>
        </Row>
      </div>

      <div className="dv-filter-section">
        <div className="dv-menu-head">
          <CalendarClock size={12} /> Due date
        </div>
        <Row
          on={filters.due.includes('overdue')}
          onClick={() => set({ due: toggle(filters.due, 'overdue') })}
        >
          <span className="dv-dot" style={{ background: 'var(--dv-danger)' }} />
          Overdue
        </Row>
        <Row
          on={filters.due.includes('week')}
          onClick={() => set({ due: toggle(filters.due, 'week') })}
        >
          <span className="dv-dot" style={{ background: '#f59e0b' }} />
          Due this week
        </Row>
        <Row
          on={filters.due.includes('none')}
          onClick={() => set({ due: toggle(filters.due, 'none') })}
        >
          <span className="dv-dot" style={{ background: 'var(--dv-border)' }} />
          No due date
        </Row>
      </div>

      <div className="dv-filter-section">
        <div className="dv-menu-head">
          <UserRound size={12} /> Members
        </div>
        <Row
          on={filters.members.includes('none')}
          onClick={() => set({ members: toggle(filters.members, 'none') })}
        >
          <span className="dv-filter-empty-avatar" aria-hidden>
            <UserRound size={11} />
          </span>
          No members
        </Row>
        {sortedPeople.map((p) => (
          <Row
            key={p.id}
            on={filters.members.includes(p.id)}
            onClick={() => set({ members: toggle(filters.members, p.id) })}
          >
            <Avatar name={p.name} color={colorFor(p.id)} src={p.avatarUrl} size={18} />
            <span className="flex-1 truncate">
              {p.id === userId ? 'Cards assigned to me' : p.name}
            </span>
          </Row>
        ))}
      </div>

      <div className="dv-filter-section">
        <div className="dv-menu-head">
          <Tag size={12} /> Labels
        </div>
        {labels.map((l) => (
          <Row
            key={l.id}
            on={filters.labels.includes(l.id)}
            onClick={() => set({ labels: toggle(filters.labels, l.id) })}
          >
            <span
              className="dv-label flex-1 !justify-start"
              style={{ '--label': l.color } as React.CSSProperties}
            >
              {l.name || ' '}
            </span>
          </Row>
        ))}
        {labels.length === 0 && (
          <p className="m-0 px-2 pb-1 text-xs" style={{ color: 'var(--dv-muted)' }}>
            No labels yet. Add them from a card.
          </p>
        )}
      </div>

      {fields.map((f) => {
        const chosen = filters.fields[f.field] ?? []
        const setChosen = (values: string[]) =>
          set({ fields: { ...filters.fields, [f.field]: values } })
        return (
          <div key={f.field} className="dv-filter-section">
            <div className="dv-menu-head">{f.name}</div>
            {f.options.map((o) => (
              <Row
                key={o.value}
                on={chosen.includes(o.value)}
                onClick={() => setChosen(toggle(chosen, o.value))}
              >
                <span className="dv-dot" style={{ background: o.color }} />
                {o.label}
              </Row>
            ))}
            <Row on={chosen.includes('')} onClick={() => setChosen(toggle(chosen, ''))}>
              <span className="dv-dot" style={{ background: 'var(--dv-border)' }} />
              <span style={{ color: 'var(--dv-muted)' }}>Not on the card</span>
            </Row>
          </div>
        )
      })}
    </div>
  )
}

/** The chips under the toolbar that say what's filtered, each removable on its own. */
export const ActiveFilters: React.FC<{
  filters: BoardFilters
  onChange: (f: BoardFilters) => void
  labels: Label[]
  people: TaskAssignee[]
  userId: string | null
  fields: { field: string; name: string; options: TaskOption[] }[]
  shown: number
  total: number
}> = ({ filters, onChange, labels, people, userId, fields, shown, total }) => {
  if (!activeFilterCount(filters)) return null
  const chips: { key: string; text: string; color?: string; remove: () => void }[] = []
  if (filters.hideDone)
    chips.push({
      key: 'done',
      text: 'Hiding done',
      remove: () => onChange({ ...filters, hideDone: false }),
    })
  for (const d of filters.due)
    chips.push({
      key: `due-${d}`,
      text: d === 'overdue' ? 'Overdue' : d === 'week' ? 'Due this week' : 'No due date',
      remove: () => onChange({ ...filters, due: filters.due.filter((x) => x !== d) }),
    })
  for (const id of filters.members) {
    const p = people.find((x) => x.id === id)
    chips.push({
      key: `m-${id}`,
      text:
        id === 'none' ? 'No members' : id === userId ? 'Assigned to me' : (p?.name ?? 'Someone'),
      remove: () => onChange({ ...filters, members: filters.members.filter((x) => x !== id) }),
    })
  }
  for (const id of filters.labels) {
    const l = labels.find((x) => x.id === id)
    if (!l) continue
    chips.push({
      key: `l-${id}`,
      text: l.name || 'Label',
      color: l.color,
      remove: () => onChange({ ...filters, labels: filters.labels.filter((x) => x !== id) }),
    })
  }
  for (const [field, values] of Object.entries(filters.fields)) {
    const f = fields.find((x) => x.field === field)
    if (!f) continue
    for (const v of values) {
      const o = f.options.find((x) => x.value === v)
      chips.push({
        key: `f-${field}-${v}`,
        text: `${f.name}: ${v === '' ? 'not on card' : (o?.label ?? v)}`,
        color: o?.color,
        remove: () =>
          onChange({
            ...filters,
            fields: { ...filters.fields, [field]: values.filter((x) => x !== v) },
          }),
      })
    }
  }
  return (
    <div className="dv-active-filters" role="region" aria-label="Active filters">
      <span className="text-xs" style={{ color: 'var(--dv-muted)' }}>
        Showing {shown} of {total}
      </span>
      {chips.map((c) => (
        <span key={c.key} className="dv-filter-chip">
          {c.color && <span className="dv-dot" style={{ background: c.color }} />}
          {c.text}
          <button aria-label={`Remove filter: ${c.text}`} onClick={c.remove}>
            <X size={11} />
          </button>
        </span>
      ))}
      <button className="dv-link text-xs" onClick={() => onChange(EMPTY_FILTERS)}>
        Clear filters
      </button>
    </div>
  )
}
