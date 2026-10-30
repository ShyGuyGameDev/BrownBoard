import type { CSSProperties } from 'react'

export type TaskOptionType = 'status' | 'urgency'

export interface TaskOption {
  id?: string
  value: string
  label: string
  color: string
  type: TaskOptionType
  isCustom?: boolean
}

export const DEFAULT_STATUS: TaskOption[] = [
  { value: 'not_started', label: 'Not started', color: '#71717a', type: 'status' },
  { value: 'in_progress', label: 'In progress', color: '#f59e0b', type: 'status' },
  { value: 'completed', label: 'Completed', color: '#10b981', type: 'status' },
  { value: 'tabled', label: 'Tabled', color: '#3b82f6', type: 'status' },
]

export const DEFAULT_URGENCY: TaskOption[] = [
  { value: 'critical', label: 'Critical', color: '#ef4444', type: 'urgency' },
  { value: 'high', label: 'High', color: '#f97316', type: 'urgency' },
  { value: 'medium', label: 'Medium', color: '#eab308', type: 'urgency' },
  { value: 'low', label: 'Low', color: '#22c55e', type: 'urgency' },
  { value: 'tabled', label: 'Tabled', color: '#3b82f6', type: 'urgency' },
]

export const toTitleCase = (value: string) =>
  value
    .replace(/[_-]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/\b\w/g, (c) => c.toUpperCase())

export const slugify = (value: string) => {
  const base = value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
  return base || `custom_${Date.now()}`
}

export const hexToRgba = (hex: string, alpha: number) => {
  let clean = hex.replace('#', '')
  if (clean.length === 3)
    clean = clean
      .split('')
      .map((c) => c + c)
      .join('')
  if (clean.length !== 6) return `rgba(113, 113, 122, ${alpha})`
  const n = parseInt(clean, 16)
  return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${alpha})`
}

/** Badge colours that stay readable in both themes. */
export const badgeStyle = (color: string): CSSProperties => ({
  backgroundColor: hexToRgba(color, 0.16),
  color: `color-mix(in srgb, ${color} 70%, var(--dv-text))`,
})

export const resolveOption = (
  options: TaskOption[],
  value: string | null | undefined,
  type: TaskOptionType,
): TaskOption => {
  const found = options.find((o) => o.value === value)
  if (found) return found
  return {
    value: value ?? '',
    label: value ? toTitleCase(value) : 'Unknown',
    color: '#71717a',
    type,
    isCustom: true,
  }
}

export const rowToOption = (row: any): TaskOption => ({
  id: row.id,
  value: row.value,
  label: row.label,
  color: row.color || '#71717a',
  type: row.type as TaskOptionType,
  isCustom: true,
})

/**
 * A room's status / urgency options, from its task_options rows (rooms get the built-ins as rows
 * when created). Built-ins keep their usual order, followed by the room's own in the order given.
 */
export const splitCustom = (rows: any[]) => {
  const pick = (defaults: TaskOption[], type: TaskOptionType) => {
    const typeRows = rows.filter((row) => row.type === type)
    // Only a database that hasn't had the built-ins added as rows yet.
    if (!typeRows.length) return defaults
    const rank = (value: string) => {
      const i = defaults.findIndex((option) => option.value === value)
      return i < 0 ? defaults.length : i
    }
    return typeRows
      .map(rowToOption)
      .map((option, i) => ({ option, i }))
      .sort((a, b) => rank(a.option.value) - rank(b.option.value) || a.i - b.i)
      .map(({ option }) => option)
  }
  return {
    status: pick(DEFAULT_STATUS, 'status'),
    urgency: pick(DEFAULT_URGENCY, 'urgency'),
  }
}

/**
 * A Crossoff: a category + status that marks a task done (greyed out, crossed off, sunk to the
 * bottom). `field` is 'status', 'urgency', or a custom category's id. A room can have one per
 * category; a task is done when any of them matches.
 */
export interface DoneRule {
  field: string
  value: string
}

export const DEFAULT_CROSSOFFS: DoneRule[] = [{ field: 'status', value: 'completed' }]

/** Urgency coloured the card stripe before it was a setting. */
export const DEFAULT_COLOR_FIELD = 'urgency'

export interface BoardSettings {
  crossoffs: DoneRule[]
  /** The category whose colour is the stripe on each card; null = no colour. */
  colorField: string | null
}

export const DEFAULT_BOARD_SETTINGS: BoardSettings = {
  crossoffs: DEFAULT_CROSSOFFS,
  colorField: DEFAULT_COLOR_FIELD,
}

/** A task_board_settings row (or none, or a database from before these columns) as settings. */
export const readBoardSettings = (
  row: {
    crossoffs?: unknown
    color_field?: unknown
    done_field?: unknown
    done_value?: unknown
  } | null,
): BoardSettings => {
  if (!row) return DEFAULT_BOARD_SETTINGS
  let crossoffs = DEFAULT_CROSSOFFS
  if (Array.isArray(row.crossoffs)) {
    const seen = new Set<string>()
    crossoffs = row.crossoffs.flatMap((r): DoneRule[] => {
      if (!r || typeof r.field !== 'string' || typeof r.value !== 'string' || seen.has(r.field))
        return []
      seen.add(r.field)
      return [{ field: r.field, value: r.value }]
    })
  } else if (typeof row.done_field === 'string' && typeof row.done_value === 'string') {
    crossoffs = [{ field: row.done_field, value: row.done_value }]
  }
  const colorField =
    'color_field' in row
      ? typeof row.color_field === 'string'
        ? row.color_field
        : null
      : DEFAULT_COLOR_FIELD
  return { crossoffs, colorField }
}

/** The fields a task carries for its categories; null / missing = that category isn't on it. */
export interface TaskCategoryValues {
  status: string | null
  urgency: string | null
  customFields: Record<string, string>
}

export const categoryValue = (task: TaskCategoryValues, field: string): string | null =>
  field === 'status'
    ? task.status
    : field === 'urgency'
      ? task.urgency
      : (task.customFields[field] ?? null)

export const isTaskDone = (crossoffs: DoneRule[], task: TaskCategoryValues) =>
  crossoffs.some((rule) => categoryValue(task, rule.field) === rule.value)

/** Custom category values from a task row's custom_fields JSON (strings only). */
export const readCustomFields = (raw: unknown): Record<string, string> =>
  Object.fromEntries(
    Object.entries(raw && typeof raw === 'object' ? raw : {}).filter(
      (entry): entry is [string, string] => typeof entry[1] === 'string',
    ),
  )
