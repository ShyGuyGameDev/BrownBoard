import { describe, expect, it } from 'vitest'
import {
  addMonths,
  byDay,
  fromDay,
  periodTitle,
  startOfWeek,
  stepPeriod,
  toDay,
  visibleDays,
} from './calendar'

const d = (s: string) => fromDay(s)!

describe('days', () => {
  it('round-trips YYYY-MM-DD and rejects impossible dates', () => {
    expect(toDay(d('2026-02-28'))).toBe('2026-02-28')
    expect(fromDay('2026-02-30')).toBeNull()
    expect(fromDay('soon')).toBeNull()
  })

  it('starts weeks on Monday', () => {
    expect(toDay(startOfWeek(d('2026-11-22')))).toBe('2026-11-16') // a Sunday
    expect(toDay(startOfWeek(d('2026-11-16')))).toBe('2026-11-16') // a Monday
  })

  it('clamps month steps to the end of shorter months', () => {
    expect(toDay(addMonths(d('2026-01-31'), 1))).toBe('2026-02-28')
    expect(toDay(addMonths(d('2026-03-15'), -3))).toBe('2025-12-15')
  })
})

describe('visibleDays', () => {
  it('shows whole weeks around a month', () => {
    const days = visibleDays(d('2026-11-20'), 'month')
    expect(days.length % 7).toBe(0)
    expect(toDay(days[0])).toBe('2026-10-26')
    expect(toDay(days[days.length - 1])).toBe('2026-12-06')
  })

  it('shows Monday to Sunday for a week', () => {
    const days = visibleDays(d('2026-11-20'), 'week')
    expect(days.map(toDay)).toEqual([
      '2026-11-16',
      '2026-11-17',
      '2026-11-18',
      '2026-11-19',
      '2026-11-20',
      '2026-11-21',
      '2026-11-22',
    ])
  })

  it('crosses daylight-saving changes without skipping or repeating a day', () => {
    const days = visibleDays(d('2026-03-10'), 'month').map(toDay)
    expect(new Set(days).size).toBe(days.length)
  })

  it('steps by a week or a month', () => {
    expect(toDay(stepPeriod(d('2026-11-20'), 'week', 1))).toBe('2026-11-27')
    expect(toDay(stepPeriod(d('2026-11-20'), 'month', -1))).toBe('2026-10-20')
  })
})

describe('periodTitle', () => {
  it('names a week that spans two years', () => {
    expect(periodTitle(d('2026-12-30'), 'week', 'en-US')).toBe('Dec 28, 2026 – Jan 3, 2027')
    expect(periodTitle(d('2026-11-20'), 'month', 'en-US')).toBe('November 2026')
  })
})

describe('byDay', () => {
  it('groups by due date and skips cards without one', () => {
    const map = byDay([
      { id: 'a', dueDate: '2026-11-20' },
      { id: 'b', dueDate: null },
      { id: 'c', dueDate: '2026-11-20' },
      { id: 'd', dueDate: 'nope' },
    ])
    expect([...map.keys()]).toEqual(['2026-11-20'])
    expect(map.get('2026-11-20')!.map((x) => x.id)).toEqual(['a', 'c'])
  })
})
