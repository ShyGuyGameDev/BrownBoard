import { daysUntil, isDueThisWeek } from './cards'

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
