/**
 * Date maths for the board's calendar view. Due dates are plain "YYYY-MM-DD" days (no time or
 * zone), so everything here works on local calendar days and never on instants.
 */

export type CalendarMode = 'month' | 'week'

/** "YYYY-MM-DD" for a local date. */
export const toDay = (d: Date) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`

/** The local date for "YYYY-MM-DD", or null when it isn't one. */
export const fromDay = (value: string): Date | null => {
  const m = value.match(/^(\d{4})-(\d{2})-(\d{2})$/)
  if (!m) return null
  const d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]))
  return d.getMonth() === Number(m[2]) - 1 ? d : null
}

export const addDays = (d: Date, n: number) => new Date(d.getFullYear(), d.getMonth(), d.getDate() + n)

/** Same day of the month, n months on (clamped: Jan 31 + 1 month = Feb 28/29). */
export const addMonths = (d: Date, n: number) => {
  const first = new Date(d.getFullYear(), d.getMonth() + n, 1)
  const last = new Date(first.getFullYear(), first.getMonth() + 1, 0).getDate()
  return new Date(first.getFullYear(), first.getMonth(), Math.min(d.getDate(), last))
}

/** Monday on or before `d` (weeks start on Monday, as the "Due this week" filter does). */
export const startOfWeek = (d: Date) => addDays(d, -((d.getDay() + 6) % 7))

/**
 * The days shown for the period containing `anchor`: a whole week, or every week that touches the
 * month (so 4–6 rows of 7).
 */
export const visibleDays = (anchor: Date, mode: CalendarMode): Date[] => {
  if (mode === 'week') {
    const start = startOfWeek(anchor)
    return Array.from({ length: 7 }, (_, i) => addDays(start, i))
  }
  const first = new Date(anchor.getFullYear(), anchor.getMonth(), 1)
  const last = new Date(anchor.getFullYear(), anchor.getMonth() + 1, 0)
  const start = startOfWeek(first)
  const end = addDays(startOfWeek(last), 6)
  const days: Date[] = []
  for (let d = start; d <= end; d = addDays(d, 1)) days.push(d)
  return days
}

/** The period one step before or after `anchor`. */
export const stepPeriod = (anchor: Date, mode: CalendarMode, by: number) =>
  mode === 'week' ? addDays(anchor, 7 * by) : addMonths(anchor, by)

/** "November 2026", or "Nov 16 – 22, 2026" for a week. */
export const periodTitle = (anchor: Date, mode: CalendarMode, locale?: string) => {
  if (mode === 'month')
    return new Intl.DateTimeFormat(locale, { month: 'long', year: 'numeric' }).format(anchor)
  const start = startOfWeek(anchor)
  const end = addDays(start, 6)
  const day = new Intl.DateTimeFormat(locale, { month: 'short', day: 'numeric' })
  const sameYear = start.getFullYear() === end.getFullYear()
  return `${day.format(start)}${sameYear ? '' : `, ${start.getFullYear()}`} – ${day.format(end)}, ${end.getFullYear()}`
}

/** Monday-first short weekday names. */
export const weekdayNames = (locale?: string, style: 'short' | 'narrow' = 'short') => {
  const fmt = new Intl.DateTimeFormat(locale, { weekday: style })
  // 2024-01-01 was a Monday.
  return Array.from({ length: 7 }, (_, i) => fmt.format(new Date(2024, 0, 1 + i)))
}

/** Groups items by their due day; items without a valid one are left out. */
export const byDay = <T extends { dueDate: string | null }>(items: T[]) => {
  const map = new Map<string, T[]>()
  for (const item of items) {
    if (!item.dueDate || !fromDay(item.dueDate)) continue
    const list = map.get(item.dueDate)
    if (list) list.push(item)
    else map.set(item.dueDate, [item])
  }
  return map
}
