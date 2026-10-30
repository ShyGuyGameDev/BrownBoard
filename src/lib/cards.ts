/**
 * Card extras shared by the board, the card detail view and the bell: labels, checklists, covers,
 * due-date states, comments and the activity log (see 20261031_cards_labels_comments.sql).
 */
import { formatDueDate } from './tasks'

export interface Label {
  id: string
  /** May be empty: a label can be just a colour. */
  name: string
  color: string
}

/** Label colours, in picker order (Trello's set, tuned to sit with the status colours). */
export const LABEL_COLORS = [
  '#22c55e',
  '#eab308',
  '#f97316',
  '#ef4444',
  '#a855f7',
  '#3b82f6',
  '#06b6d4',
  '#ec4899',
  '#84cc16',
  '#64748b',
]

/** Cover colours: the label set, which already reads well in both themes. */
export const COVER_COLORS = LABEL_COLORS

export interface ChecklistItem {
  id: string
  text: string
  done: boolean
}

export interface Checklist {
  id: string
  title: string
  items: ChecklistItem[]
}

export type Cover = { color: string } | { url: string } | null

export const newId = () => crypto.randomUUID()

export const readChecklists = (raw: unknown): Checklist[] =>
  Array.isArray(raw)
    ? raw.flatMap((c): Checklist[] => {
        if (!c || typeof c !== 'object') return []
        const list = c as Record<string, unknown>
        return [
          {
            id: typeof list.id === 'string' ? list.id : newId(),
            title: typeof list.title === 'string' ? list.title : 'Checklist',
            items: Array.isArray(list.items)
              ? list.items.flatMap((i): ChecklistItem[] => {
                  if (!i || typeof i !== 'object') return []
                  const item = i as Record<string, unknown>
                  if (typeof item.text !== 'string') return []
                  return [
                    {
                      id: typeof item.id === 'string' ? item.id : newId(),
                      text: item.text,
                      done: item.done === true,
                    },
                  ]
                })
              : [],
          },
        ]
      })
    : []

export const readCover = (raw: unknown): Cover => {
  if (!raw || typeof raw !== 'object') return null
  const c = raw as Record<string, unknown>
  if (typeof c.color === 'string' && /^#[0-9a-f]{6}$/i.test(c.color)) return { color: c.color }
  if (typeof c.url === 'string' && c.url) return { url: c.url }
  return null
}

export const readIds = (raw: unknown): string[] =>
  Array.isArray(raw) ? raw.filter((v): v is string => typeof v === 'string') : []

/** Ticked / total over every checklist on a card. */
export const checklistProgress = (lists: Checklist[]) => {
  const items = lists.flatMap((l) => l.items)
  return { done: items.filter((i) => i.done).length, total: items.length }
}

// ---------- due dates ----------

export type DueState = 'done' | 'overdue' | 'today' | 'soon' | 'later'

const today = () => {
  const d = new Date()
  return new Date(d.getFullYear(), d.getMonth(), d.getDate())
}
const parseDue = (value: string) => {
  const m = value.match(/^(\d{4})-(\d{2})-(\d{2})$/)
  return m ? new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3])) : null
}

/** Whole days from today to the due date (negative = overdue). */
export const daysUntil = (value: string) => {
  const due = parseDue(value)
  return due ? Math.round((due.getTime() - today().getTime()) / 86400000) : null
}

export const dueState = (value: string, done: boolean): DueState => {
  if (done) return 'done'
  const days = daysUntil(value)
  if (days === null) return 'later'
  if (days < 0) return 'overdue'
  if (days === 0) return 'today'
  if (days <= 2) return 'soon'
  return 'later'
}

/** Short, human due text: "Today", "Tomorrow", "2 days late", or the date. */
export const dueLabel = (value: string) => {
  const days = daysUntil(value)
  if (days === 0) return 'Today'
  if (days === 1) return 'Tomorrow'
  if (days === -1) return 'Yesterday'
  return formatDueDate(value)
}

export const dueTitle = (value: string, state: DueState) =>
  ({
    done: `Due ${formatDueDate(value)} · done`,
    overdue: `Overdue · was due ${formatDueDate(value)}`,
    today: 'Due today',
    soon: `Due soon · ${formatDueDate(value)}`,
    later: `Due ${formatDueDate(value)}`,
  })[state]

/** Monday-start week containing today, as [start, end] day offsets from today. */
export const isDueThisWeek = (value: string) => {
  const days = daysUntil(value)
  if (days === null) return false
  const dow = (today().getDay() + 6) % 7 // 0 = Monday
  return days >= -dow && days <= 6 - dow
}

// ---------- comments & activity ----------

export interface Comment {
  id: string
  taskId: string
  authorId: string
  authorName: string
  body: string
  mentions: string[]
  createdAt: string
  editedAt: string | null
}

export const rowToComment = (r: Record<string, unknown>): Comment => ({
  id: String(r.id),
  taskId: String(r.task_id),
  authorId: String(r.author_id),
  authorName: typeof r.author_name === 'string' && r.author_name ? r.author_name : 'Someone',
  body: typeof r.body === 'string' ? r.body : '',
  mentions: readIds(r.mentions),
  createdAt: String(r.created_at),
  editedAt: typeof r.edited_at === 'string' ? r.edited_at : null,
})

export interface Activity {
  id: string
  taskId: string
  actorName: string
  kind: string
  detail: Record<string, unknown>
  createdAt: string
}

export const rowToActivity = (r: Record<string, unknown>): Activity => ({
  id: String(r.id),
  taskId: String(r.task_id),
  actorName: typeof r.actor_name === 'string' && r.actor_name ? r.actor_name : 'Someone',
  kind: String(r.kind),
  detail: r.detail && typeof r.detail === 'object' ? (r.detail as Record<string, unknown>) : {},
  createdAt: String(r.created_at),
})

/** Names for the values an activity entry refers to (category names and their statuses). */
export interface ActivityNames {
  fieldName: (field: string) => string | null
  valueLabel: (field: string, value: string) => string
}

const str = (v: unknown) => (typeof v === 'string' ? v : '')
const list = (v: unknown) => (Array.isArray(v) ? v.filter((x) => typeof x === 'string') : [])
const joinNames = (names: string[]) =>
  names.length <= 2
    ? names.join(' and ')
    : `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`

/** "moved this from To do to Doing" — what an activity entry did, without the actor. */
export const describeActivity = (
  kind: string,
  detail: Record<string, unknown>,
  names: ActivityNames,
): string => {
  switch (kind) {
    case 'created':
      return detail.list ? `added this card to ${str(detail.list)}` : 'added this card'
    case 'moved':
      return `moved this from ${str(detail.from) || 'a list'} to ${str(detail.to) || 'a list'}`
    case 'archived':
      return 'archived this card'
    case 'restored':
      return 'restored this card'
    case 'due':
      return detail.due
        ? `set the due date to ${formatDueDate(str(detail.due))}`
        : 'removed the due date'
    case 'members': {
      const added = list(detail.added)
      const removed = list(detail.removed)
      if (added.length && removed.length)
        return `added ${joinNames(added)} and removed ${joinNames(removed)}`
      if (added.length) return `added ${joinNames(added)} to this card`
      if (removed.length) return `removed ${joinNames(removed)} from this card`
      return 'changed the members'
    }
    case 'field': {
      const field = str(detail.field)
      const name = names.fieldName(field)
      if (!name) return 'changed a category that was since removed'
      const value = str(detail.value)
      return value
        ? `set ${name} to ${names.valueLabel(field, value)}`
        : `removed ${name} from this card`
    }
    default:
      return 'changed this card'
  }
}

/** A watched-card notification: every change in one save, as one sentence. */
export const describeChanges = (detail: Record<string, unknown> | null, names: ActivityNames) => {
  const changes = Array.isArray(detail?.changes)
    ? (detail!.changes as Record<string, unknown>[])
    : []
  const parts = changes.map((c) =>
    describeActivity(
      str(c.kind),
      c.detail && typeof c.detail === 'object' ? (c.detail as Record<string, unknown>) : {},
      names,
    ),
  )
  return parts.length ? joinNames(parts) : 'changed a card you watch'
}

/** Splits comment text into plain runs and @mentions, so mentions can be highlighted. */
export const splitMentions = (body: string, usernames: string[]) => {
  if (!usernames.length) return [{ text: body, mention: false }]
  const escaped = usernames
    .slice()
    .sort((a, b) => b.length - a.length)
    .map((u) => u.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))
  const re = new RegExp(`@(${escaped.join('|')})\\b`, 'g')
  const out: { text: string; mention: boolean }[] = []
  let last = 0
  for (const m of body.matchAll(re)) {
    if (m.index! > last) out.push({ text: body.slice(last, m.index), mention: false })
    out.push({ text: m[0], mention: true })
    last = m.index! + m[0].length
  }
  if (last < body.length) out.push({ text: body.slice(last), mention: false })
  return out
}
