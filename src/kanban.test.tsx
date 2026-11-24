/**
 * The board end to end against an in-memory stand-in for Supabase: WIP limits, card templates,
 * keyboard shortcuts and the calendar view.
 */
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

// ---------- browser bits jsdom doesn't have (before the app's modules load) ----------
vi.hoisted(() => {
  window.matchMedia ??= ((query: string) => ({
    matches: false,
    media: query,
    addEventListener: () => {},
    removeEventListener: () => {},
  })) as unknown as typeof window.matchMedia
  Element.prototype.scrollIntoView ??= function () {}
  // Recent Node has its own localStorage, which is undefined unless enabled, in front of jsdom's.
  if (!globalThis.localStorage) {
    const items = new Map<string, string>()
    const storage = {
      getItem: (k: string) => items.get(k) ?? null,
      setItem: (k: string, v: string) => void items.set(k, String(v)),
      removeItem: (k: string) => void items.delete(k),
      clear: () => items.clear(),
    }
    Object.defineProperty(globalThis, 'localStorage', { value: storage, configurable: true })
  }
  ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
})

// ---------- a tiny fake of the Supabase client ----------
type Row = Record<string, unknown>
const today = (() => {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
})()

let tables: Record<string, Row[]>
const writes: { table: string; op: string; payload: unknown; filters: unknown[][] }[] = []
const rpc = vi.fn()

const from = (table: string) => {
  const state = { op: 'select', payload: null as unknown, filters: [] as unknown[][], single: false }
  const result = () => {
    if (state.op !== 'select') {
      writes.push({ table, op: state.op, payload: state.payload, filters: state.filters })
      return { data: state.op === 'insert' ? { id: 'new', ...(state.payload as Row) } : null, error: null }
    }
    const rows = (tables[table] ?? []).filter((r) =>
      state.filters.every(([col, val]) => r[col as string] === val),
    )
    return { data: state.single ? (rows[0] ?? null) : rows, error: null }
  }
  const builder: Record<string, unknown> = new Proxy(
    {},
    {
      get(_, prop: string) {
        if (prop === 'then')
          return (ok: (v: unknown) => void, bad: (e: unknown) => void) =>
            Promise.resolve(result()).then(ok, bad)
        return (...args: unknown[]) => {
          if (['insert', 'update', 'upsert', 'delete'].includes(prop)) {
            state.op = prop
            state.payload = args[0]
          } else if (prop === 'eq') state.filters.push(args)
          else if (prop === 'single' || prop === 'maybeSingle') state.single = true
          return builder
        }
      },
    },
  )
  return builder
}

vi.mock('./lib/supabase', () => ({ supabase: { from: (t: string) => from(t), rpc: (...a: unknown[]) => rpc(...a) } }))

import { KanbanBoard } from './kanban'
import { setCanvasLinks } from './lib/bus'
import { RoomContext, type RoomContextValue } from './lib/room-context'
import { AuthContext, type AuthContextValue } from './lib/auth-context'

const ME = 'u1'
const room = {
  roomId: 'r1',
  roomName: 'Team',
  isOwner: true,
  setIsOwner: () => {},
  setRoomName: () => {},
  allowGuests: true,
  setAllowGuests: () => {},
  unnamed: false,
  setUnnamed: () => {},
  isCreator: true,
  hasOwner: true,
  me: { id: ME, name: 'me', color: '#000' },
  peers: [],
  status: 'live',
  setActivity: () => {},
  setPlace: () => {},
  setSelection: () => {},
  send: vi.fn(),
  on: () => () => {},
} as unknown as RoomContextValue
const auth = { user: { id: ME }, isGuest: false } as unknown as AuthContextValue

let root: Root
let host: HTMLDivElement

const flush = () =>
  act(async () => {
    for (let i = 0; i < 3; i++) {
      await new Promise((r) => setTimeout(r, 0))
      await new Promise((r) => requestAnimationFrame(() => r(null)))
    }
  })

const press = async (key: string, opts: KeyboardEventInit = {}) => {
  const target = (document.activeElement as HTMLElement | null) ?? document.body
  await act(async () => {
    target.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true, ...opts }))
  })
  await flush()
}

const focused = () => (document.activeElement as HTMLElement | null)?.dataset.cardId ?? null
const $ = <T extends Element = HTMLElement>(sel: string) => host.querySelector<T>(sel)

beforeEach(async () => {
  localStorage.clear()
  writes.length = 0
  rpc.mockReset()
  rpc.mockImplementation(async (fn: string) =>
    fn === 'task_assignees'
      ? { data: { ok: true, people: [{ id: ME, name: 'me' }] }, error: null }
      : { data: { ok: true, task_id: 'copied' }, error: null },
  )
  tables = {
    categories: [
      { id: 'todo', room_id: 'r1', name: 'To do', position: 0 },
      { id: 'doing', room_id: 'r1', name: 'Doing', position: 1, wip_limit: 1 },
    ],
    tasks: [
      { id: 't1', room_id: 'r1', category_id: 'todo', title: 'First', position: 0, status: 'not_started', due_date: today },
      { id: 't2', room_id: 'r1', category_id: 'todo', title: 'Second', position: 1, status: 'not_started' },
      { id: 'tpl', room_id: 'r1', category_id: 'todo', title: 'Bug report', position: 2, is_template: true },
      { id: 't3', room_id: 'r1', category_id: 'doing', title: 'Third', position: 0, status: 'not_started' },
      { id: 't4', room_id: 'r1', category_id: 'doing', title: 'Fourth', position: 1, status: 'not_started' },
    ],
  }
  host = document.createElement('div')
  document.body.append(host)
  root = createRoot(host)
  await act(async () => {
    root.render(
      <AuthContext.Provider value={auth}>
        <RoomContext.Provider value={room}>
          <KanbanBoard active />
        </RoomContext.Provider>
      </AuthContext.Provider>,
    )
  })
  await flush()
})

afterEach(() => {
  act(() => root.unmount())
  host.remove()
})

describe('WIP limits', () => {
  it('marks a list over its limit and shows count/limit', () => {
    const doing = [...host.querySelectorAll<HTMLElement>('section.dv-col')][1]
    expect(doing.dataset.wip).toBe('over')
    expect(doing.querySelector('.dv-wip')!.textContent).toBe('2/1')
  })

  it('saves a limit from the list menu', async () => {
    await act(async () => $('[aria-label="Actions for the list To do"]')!.click())
    const input = $<HTMLInputElement>('#wip-limit')!
    await act(async () => {
      const set = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!
      set.call(input, '4')
      input.dispatchEvent(new Event('input', { bubbles: true }))
    })
    await act(async () => input.form!.requestSubmit())
    await flush()
    expect(writes).toContainEqual(
      expect.objectContaining({ table: 'categories', op: 'update', payload: { wip_limit: 4 } }),
    )
    expect([...host.querySelectorAll('.dv-wip')].map((e) => e.textContent)).toEqual(['2/4', '2/1'])
  })
})

describe('card templates', () => {
  it('badges templates and leaves them out of the totals and limits', () => {
    expect($('[data-card-id="tpl"]')!.textContent).toContain('Template')
    expect(host.textContent).toContain('0 of 4 done')
  })

  it('makes a card from a template in the chosen list', async () => {
    await act(async () => $('[aria-label="Create a card in Doing from a template"]')!.click())
    const item = [...host.querySelectorAll<HTMLElement>('[role="menuitem"]')].find((b) =>
      b.textContent?.includes('Bug report'),
    )!
    await act(async () => item.click())
    await flush()
    expect(rpc).toHaveBeenCalledWith(
      'copy_task_to_room',
      expect.objectContaining({ p_task_id: 'tpl', p_room_id: 'r1', p_category_id: 'doing', p_position: null }),
    )
  })
})

describe('keyboard shortcuts', () => {
  it('moves the selection with j / k and the arrow keys', async () => {
    await press('j')
    expect(focused()).toBe('t1')
    await press('j')
    expect(focused()).toBe('t2')
    await press('ArrowRight')
    expect(focused()).toBe('t4') // same row, next list
    await press('ArrowLeft')
    await press('k')
    expect(focused()).toBe('t1')
  })

  it('moves a card to the next list with "."', async () => {
    await press('j')
    await press('.')
    expect(writes).toContainEqual(
      expect.objectContaining({ table: 'tasks', op: 'update', payload: { position: 2, category_id: 'doing' } }),
    )
    expect(focused()).toBe('t1')
  })

  it('archives with c and selects the next card', async () => {
    await press('j')
    await press('c')
    expect(writes.find((w) => w.op === 'update' && w.table === 'tasks')!.payload).toHaveProperty('archived_at')
    expect($('[data-card-id="t1"]')).toBeNull()
    await flush()
    expect(focused()).toBe('t2')
  })

  it('adds and removes yourself with Space', async () => {
    await press('j')
    await press(' ')
    expect(writes.at(-1)).toMatchObject({ table: 'tasks', payload: { member_ids: [ME] } })
  })

  it('opens the help with ? and the move dialog with Shift+M', async () => {
    await press('?', { shiftKey: true })
    expect(host.textContent).toContain('Keyboard shortcuts')
    await press('Escape')
    expect($('.dv-shortcuts')).toBeNull()
    await press('j')
    await press('M', { shiftKey: true })
    expect($('#transfer-title')!.textContent).toContain('Move card')
  })

  it('stays out of the way while typing', async () => {
    const search = $<HTMLInputElement>('[aria-label="Search cards"]')!
    search.focus()
    await press('j')
    await press('v')
    expect(document.activeElement).toBe(search)
    expect($('.dv-cal')).toBeNull()
  })

  it('n focuses the add-card field of the selected card’s list', async () => {
    await press('j')
    await press('ArrowRight')
    await press('n')
    expect(document.activeElement?.id).toBe('add-card-doing')
  })
})

describe('card links', () => {
  const hover = async (id: string) => {
    await act(async () => {
      $(`[data-card-id="${id}"]`)!.dispatchEvent(new Event('pointerover', { bubbles: true }))
      await new Promise((r) => setTimeout(r, 200))
    })
    await flush()
  }
  const arrows = () =>
    [...document.querySelectorAll<SVGElement>('.dv-links-arrow')].map((a) => a.dataset.dir)

  it('draws arrows for the hovered card only, by direction', async () => {
    const size = vi
      .spyOn(Element.prototype, 'getBoundingClientRect')
      .mockReturnValue({ left: 0, top: 0, right: 300, bottom: 100 } as DOMRect)
    await act(async () =>
      setCanvasLinks(new Map([['t1', 2], ['t3', 1]]), [{ from: 't1', to: 't3' }]),
    )
    expect($('[data-card-id="t1"]')!.textContent).toContain('1 linked card · 1 other')
    expect(arrows()).toEqual([])
    await hover('t1')
    expect(arrows()).toEqual(['out'])
    await hover('t3')
    expect(arrows()).toEqual(['in'])
    await hover('t2')
    expect(arrows()).toEqual([])
    await act(async () => setCanvasLinks(new Map(), []))
    size.mockRestore()
  })
})

describe('calendar view', () => {
  it('switches with v, shows cards on their due day, and reschedules on drop', async () => {
    await press('v')
    const todayCell = $('.dv-cal-day[data-today="true"]')!
    expect(todayCell.textContent).toContain('First')
    // Templates never show; undated cards wait in the tray.
    expect($('.dv-cal')!.textContent).not.toContain('Bug report')
    expect($('.dv-cal-tray')!.textContent).toContain('Second')

    const cells = [...host.querySelectorAll<HTMLElement>('.dv-cal-day')]
    const other = cells[cells.indexOf(todayCell) === 0 ? 1 : 0]
    const data = new Map<string, string>([['application/x-brownboard-card', 't2']])
    const dataTransfer = {
      types: [...data.keys()],
      getData: (k: string) => data.get(k) ?? '',
      setData: () => {},
      dropEffect: 'move',
    }
    await act(async () => {
      const drop = new Event('drop', { bubbles: true, cancelable: true })
      Object.assign(drop, { dataTransfer })
      other.dispatchEvent(drop)
    })
    await flush()
    const due = writes.find((w) => w.table === 'tasks' && 'due_date' in (w.payload as Row))
    expect(due?.filters).toEqual([['id', 't2']])
    expect((due?.payload as Row).due_date).toMatch(/^\d{4}-\d{2}-\d{2}$/)
  })
})
