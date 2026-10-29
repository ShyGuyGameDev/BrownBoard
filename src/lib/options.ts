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

/** Combines room-specific option rows with the built-in options they override. */
export const splitCustom = (rows: any[]) => {
  const merge = (defaults: TaskOption[], type: TaskOptionType) => {
    const typeRows = rows.filter((row) => row.type === type)
    const options = defaults.map((option) => {
      const override = typeRows.find((row) => row.value === option.value)
      return override
        ? { ...option, id: override.id, label: override.label, color: override.color }
        : option
    })
    const builtInValues = new Set(defaults.map((option) => option.value))
    return [
      ...options,
      ...typeRows.filter((row) => !builtInValues.has(row.value)).map(rowToOption),
    ]
  }
  return {
    status: merge(DEFAULT_STATUS, 'status'),
    urgency: merge(DEFAULT_URGENCY, 'urgency'),
  }
}
