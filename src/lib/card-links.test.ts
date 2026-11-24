import { describe, expect, it } from 'vitest'
import { arrowPath, cardLinksOf, linkedCards, placePill, sidesFor } from './card-links'

const box = (left: number, top: number, w = 200, h = 80) => ({ left, top, right: left + w, bottom: top + h })
const board = box(0, 0, 1000, 600)

describe('cardLinksOf', () => {
  it('keeps card-to-card arrows only, once each, with their direction', () => {
    const c = (id: string, from: string, to: string) => ({ id, type: 'connector', from, to })
    const links = cardLinksOf([
      { id: 'a', type: 'task', taskId: 'A' },
      { id: 'b', type: 'task', taskId: 'B' },
      { id: 'b2', type: 'task', taskId: 'B' },
      { id: 'n', type: 'text' },
      c('1', 'a', 'b'),
      c('2', 'a', 'b2'),
      c('3', 'a', 'n'),
      c('4', 'b', 'b2'),
      c('5', 'gone', 'a'),
    ])
    expect(links).toEqual([{ from: 'A', to: 'B' }])
    expect([...linkedCards(links).get('B')!]).toEqual(['A'])
  })
})

describe('arrows', () => {
  it('uses facing sides, and loops round cards in the same list', () => {
    expect(sidesFor(box(0, 0), box(300, 0), board)).toEqual({ start: 1, end: -1 })
    expect(sidesFor(box(300, 0), box(0, 0), board)).toEqual({ start: -1, end: 1 })
    expect(sidesFor(box(300, 0), box(300, 200), board)).toEqual({ start: 1, end: 1 })
    expect(sidesFor(box(790, 0), box(790, 200), board)).toEqual({ start: -1, end: -1 })
  })
  it('stops just short of the card it points at', () => {
    expect(arrowPath(box(0, 0), box(300, 0), 40, 40, board)).toMatch(/^M200 40 .* 296 40$/)
  })
})

describe('placePill', () => {
  const list = box(300, 100, 200, 400)
  it('sits at the edge the card is past', () => {
    expect(placePill(box(300, 900), list, board, []).edge).toBe('down')
    expect(placePill(box(300, -200), list, board, []).edge).toBe('up')
    expect(placePill(box(1200, 200), box(1200, 100), board, []).edge).toBe('right')
    expect(placePill(box(-400, 200), box(-400, 100), board, []).edge).toBe('left')
  })
  it('stacks labels that share an edge', () => {
    const first = placePill(box(300, 900), list, board, [])
    const second = placePill(box(300, 1000), list, board, [first.box])
    expect(second.box.bottom).toBeLessThan(first.box.top)
  })
})
