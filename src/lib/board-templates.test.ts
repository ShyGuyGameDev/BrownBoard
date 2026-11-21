import { describe, expect, it, vi } from 'vitest'

vi.mock('./supabase', () => ({ supabase: {} }))

import { BUILT_IN_TEMPLATES, type BoardRows, snapshotBoard } from './board-templates'

const rows: BoardRows = {
  categories: [
    { id: 'c2', name: 'Doing', position: 1, wip_limit: 3 },
    { id: 'c1', name: 'To do', position: 0 },
    { id: 'c3', name: 'Old', position: 2, archived_at: '2026-01-01' },
  ],
  tasks: [
    {
      category_id: 'c1',
      title: 'Second',
      position: 1,
      label_ids: ['l1', 'gone'],
      custom_fields: { f1: 'big', missing: 'x' },
      checklists: [{ id: 'a', title: 'Steps', items: [{ id: 'i', text: 'one', done: true }] }],
      due_date: '2027-03-04',
      attachments: [{ url: 'data:image/png;base64,AAAA', name: 'a.png', type: 'image/png', size: 4 }],
      cover: { color: '#ef4444' },
    },
    { category_id: 'c1', title: 'First', position: 0, is_template: true, status: 'not_started' },
    { category_id: 'c2', title: 'Archived', archived_at: '2026-01-01' },
    { category_id: 'c3', title: 'In archived list' },
  ],
  labels: [{ id: 'l1', name: 'Bug', color: '#ef4444' }],
  options: [{ type: 'status', value: 'review', label: 'Review', color: '#123456' }],
  fields: [{ id: 'f1', name: 'Size', default_value: 'big' }],
  fieldOptions: [{ field_id: 'f1', value: 'big', label: 'Big', color: null }],
  names: [{ field_type: 'urgency', name: 'Severity', default_value: 'high', is_deleted: false }],
  settings: { crossoffs: [{ field: 'f1', value: 'big' }, { field: 'nope', value: 'x' }], color_field: 'f1' },
}

describe('snapshotBoard', () => {
  it('copies lists in order with their limits, skipping archived ones', () => {
    const t = snapshotBoard(rows, { cards: true })
    expect(t.lists.map((l) => [l.name, l.wip_limit])).toEqual([
      ['To do', null],
      ['Doing', 3],
    ])
    expect(t.lists[0].cards!.map((c) => c.title)).toEqual(['First', 'Second'])
    expect(t.lists[1].cards).toEqual([])
  })

  it('refers to labels and categories by name', () => {
    const card = snapshotBoard(rows, { cards: true }).lists[0].cards![1]
    expect(card.labels).toEqual(['Bug'])
    expect(card.fields).toEqual({ Size: 'big' })
    expect(card.checklists).toEqual([{ title: 'Steps', items: [{ text: 'one', done: true }] }])
  })

  it('keeps due dates, attachments and covers', () => {
    const [first, second] = snapshotBoard(rows, { cards: true }).lists[0].cards!
    expect(first).not.toHaveProperty('due_date')
    expect(first).not.toHaveProperty('attachments')
    expect(second.due_date).toBe('2027-03-04')
    expect(second.attachments).toEqual([
      { url: 'data:image/png;base64,AAAA', name: 'a.png', type: 'image/png', size: 4 },
    ])
    expect(second.cover).toEqual({ color: '#ef4444' })
  })

  it('keeps only card templates without cards', () => {
    const t = snapshotBoard(rows, { cards: false })
    expect(t.lists[0].cards!.map((c) => [c.title, c.template])).toEqual([['First', true]])
  })

  it('maps settings to category names and drops ones that no longer exist', () => {
    const t = snapshotBoard(rows, { cards: false })
    expect(t.settings).toEqual({ crossoffs: [{ field: 'Size', value: 'big' }], color_field: 'Size' })
    expect(t.categories).toEqual({ urgency: { name: 'Severity', hidden: false, default: 'high' } })
    expect(t.fields).toEqual([
      { name: 'Size', default: 'big', options: [{ value: 'big', label: 'Big' }] },
    ])
  })
})

describe('built-in templates', () => {
  it('have unique ids, names within limits and sensible WIP limits', () => {
    expect(new Set(BUILT_IN_TEMPLATES.map((t) => t.id)).size).toBe(BUILT_IN_TEMPLATES.length)
    for (const { template } of BUILT_IN_TEMPLATES) {
      expect(template.lists.length).toBeGreaterThan(0)
      for (const list of template.lists) {
        expect(list.name.length).toBeLessThanOrEqual(80)
        if (list.wip_limit != null) expect(list.wip_limit).toBeGreaterThanOrEqual(1)
        for (const card of list.cards ?? []) {
          for (const label of card.labels ?? [])
            expect(template.labels?.some((l) => l.name === label)).toBe(true)
          for (const name of Object.keys(card.fields ?? {}))
            expect(template.fields?.some((f) => f.name === name)).toBe(true)
        }
      }
    }
  })
})
