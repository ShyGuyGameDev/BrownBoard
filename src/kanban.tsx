import React, { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import {
  Archive,
  CalendarDays,
  Check,
  ChevronDown,
  CircleCheck,
  Crosshair,
  ListFilter,
  Palette,
  GripVertical,
  Pencil,
  PenTool,
  Plus,
  Search,
  Settings2,
  Trash2,
  X,
} from 'lucide-react'
import { supabase } from './lib/supabase'
import { colorFor, useRoom, type Peer } from './lib/room'
import { bus, getLinkCounts, isTyping, toast, undoToast, withUploadFeedback } from './lib/bus'
import { useAuth } from './lib/auth'
import {
  type Attachment,
  cleanAttachment,
  isImageFile,
  taskFiles,
  uploadRoomFile,
} from './lib/files'
import { Avatar } from './avatar'
import { loadRoomTaskAssignees, type TaskAssignee } from './lib/tasks'
import { LIMITS, cleanHexColor, cleanLine, cleanMultiline } from './lib/sanitize'
import { FileViewer } from './file-viewer'
import {
  type Checklist,
  type Cover,
  type Label,
  checklistProgress,
  dueLabel,
  dueState,
  dueTitle,
  readChecklists,
  readCover,
  readIds,
} from './lib/cards'
import { CardBadges, CardDetail } from './card-detail'
import {
  ActiveFilters,
  type BoardFilters,
  FilterMenu,
  activeFilterCount,
  matchesFilters,
  readFilters,
  saveFilters,
} from './board-filters'
import { ArchivePanel } from './archive-panel'
import { takePendingCard } from './notifications'
import {
  type BoardSettings,
  DEFAULT_BOARD_SETTINGS,
  DEFAULT_STATUS,
  DEFAULT_URGENCY,
  type DoneRule,
  type TaskOption,
  type TaskOptionType,
  badgeStyle,
  categoryValue,
  isTaskDone,
  readCustomFields,
  resolveOption,
  readBoardSettings,
  rowToOption,
  slugify,
  splitCustom,
} from './lib/options'

type DbCategory = {
  id: string
  name: string
  position: number | null
  archived_at?: string | null
}
type DbTask = {
  id: string
  title: string
  description: string | null
  status: string | null
  urgency?: string | null
  images?: unknown
  attachments?: unknown
  category_id: string
  position: number | null
  due_date?: string | null
  assignee_id?: string | null
  custom_fields?: Record<string, unknown> | null
  member_ids?: unknown
  label_ids?: unknown
  checklists?: unknown
  cover?: unknown
  archived_at?: string | null
}

interface CustomFieldOption {
  id: string
  value: string
  label: string
  color: string
}

interface CustomTaskField {
  id: string
  name: string
  defaultValue: string | null
  options: CustomFieldOption[]
}

interface Task {
  id: string
  title: string
  description: string
  /** null = this category isn't on the card (same for a custom category missing from customFields) */
  status: string | null
  urgency: string | null
  files: Attachment[]
  categoryId: string
  position: number
  dueDate: string | null
  /** Signed-in people on the card (the first is mirrored to the old single assignee). */
  memberIds: string[]
  labelIds: string[]
  checklists: Checklist[]
  cover: Cover
  customFields: Record<string, string>
}

interface Category {
  id: string
  name: string
  position: number
  tasks: Task[]
}

/** List widths in px. The default matches .dv-col in devboard.css. */
const COL_WIDTH = { min: 220, max: 720, default: 304, step: 16 }
const colWidthsKey = (roomId: string) => `brownboard:col-widths:${roomId}`

/** Widths this viewer gave the room's lists. Kept in this browser only: resizing is a personal layout choice. */
const readColWidths = (roomId: string): Record<string, number> => {
  try {
    const raw = JSON.parse(localStorage.getItem(colWidthsKey(roomId)) ?? '{}')
    return Object.fromEntries(
      Object.entries(raw ?? {}).filter(
        (e): e is [string, number] =>
          typeof e[1] === 'number' && e[1] >= COL_WIDTH.min && e[1] <= COL_WIDTH.max,
      ),
    )
  } catch {
    return {}
  }
}

const clampColWidth = (w: number) => Math.round(Math.min(COL_WIDTH.max, Math.max(COL_WIDTH.min, w)))

const isImage = isImageFile

const mapTask = (t: DbTask): Task => ({
  id: t.id,
  title: t.title,
  description: t.description || '',
  status: t.status ?? null,
  urgency: t.urgency ?? null,
  files: taskFiles(t),
  categoryId: t.category_id,
  position: t.position ?? 0,
  dueDate: t.due_date ?? null,
  // Before the members migration, the single assignee.
  memberIds:
    t.member_ids !== undefined ? readIds(t.member_ids) : t.assignee_id ? [t.assignee_id] : [],
  labelIds: readIds(t.label_ids),
  checklists: readChecklists(t.checklists),
  cover: readCover(t.cover),
  customFields: readCustomFields(t.custom_fields),
})

/** Done tasks sink to the bottom of their list; order is otherwise kept. */
const sinkDone = (tasks: Task[], crossoffs: DoneRule[]): Task[] => [
  ...tasks.filter((t) => !isTaskDone(crossoffs, t)),
  ...tasks.filter((t) => isTaskDone(crossoffs, t)),
]

const buildBoard = (
  categories: DbCategory[],
  tasks: DbTask[],
  crossoffs: DoneRule[],
): Category[] => {
  const cats = categories
    .filter((c) => !c.archived_at)
    .sort((a, b) => (a.position ?? 0) - (b.position ?? 0))
  const buckets = new Map<string, Task[]>(cats.map((c) => [c.id, []]))
  tasks
    .filter((t) => !t.archived_at)
    .map(mapTask)
    .sort((a, b) => a.position - b.position)
    .forEach((t) => buckets.get(t.categoryId)?.push(t))
  return cats.map((c) => ({
    id: c.id,
    name: c.name,
    position: c.position ?? 0,
    tasks: sinkDone(buckets.get(c.id) ?? [], crossoffs),
  }))
}

/** A list being dragged by its header. Positions are in the scroll container's content space. */
interface ColDrag {
  id: string
  pointerId: number
  startX: number
  startY: number
  startScroll: number
  /** Latest pointer x (the frame loop reads it, so scrolling alone also moves the list). */
  x: number
  started: boolean
  order: string[]
  from: number
  lefts: number[]
  widths: number[]
  /** How far a neighbour slides to make room: the dragged list's width plus the gap. */
  step: number
  target: number
  dx: number
  shifts: number[]
  raf: number
  /** Escape cancels; kept here so the same listener is removed. */
  onKey: (e: KeyboardEvent) => void
}

const SETTLE = 'transform 260ms var(--dv-ease)'

interface MenuState {
  kind: TaskOptionType | 'due_date' | 'assignee' | 'custom'
  taskId: string
  categoryId: string
  fieldId?: string
  x: number
  y: number
}

export const KanbanBoard: React.FC<{ active?: boolean }> = ({ active = true }) => {
  const { roomId, send, on, peers, setActivity, setPlace, setSelection } = useRoom()

  const [categories, setCategories] = useState<Category[]>([])
  const categoriesRef = useRef<Category[]>([])
  categoriesRef.current = categories

  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [query, setQuery] = useState('')
  const searchRef = useRef<HTMLInputElement>(null)

  const [addingList, setAddingList] = useState(false)
  const [newListName, setNewListName] = useState('')
  const [renamingCat, setRenamingCat] = useState<{ id: string; name: string } | null>(null)
  const [newTaskInputs, setNewTaskInputs] = useState<Record<string, string>>({})
  /** The card open in the detail view. */
  const [openCardId, setOpenCardId] = useState<string | null>(null)
  const [labels, setLabels] = useState<Label[]>([])
  const labelsById = useMemo(() => new Map(labels.map((l) => [l.id, l])), [labels])
  const [commentCounts, setCommentCounts] = useState<Map<string, number>>(new Map())
  /** Cards this viewer watches. */
  const [watched, setWatched] = useState<Set<string>>(new Set())
  const [archived, setArchived] = useState<{ lists: DbCategory[]; tasks: DbTask[] }>({
    lists: [],
    tasks: [],
  })
  const [archiveOpen, setArchiveOpen] = useState(false)
  const [filters, setFilters] = useState<BoardFilters>(() => readFilters(roomId))
  const [filterMenu, setFilterMenu] = useState<{ x: number; y: number } | null>(null)
  const { user, isGuest } = useAuth()
  const userId = user && !isGuest ? user.id : null
  const userIdRef = useRef(userId)
  userIdRef.current = userId
  useEffect(() => saveFilters(roomId, filters), [roomId, filters])
  const [boardSettings, setBoardSettings] = useState<BoardSettings>(DEFAULT_BOARD_SETTINGS)
  const crossoffs = boardSettings.crossoffs
  const crossoffsRef = useRef(crossoffs)
  crossoffsRef.current = crossoffs
  /** The Crossoff status picker in settings, for one category. */
  const [doneMenu, setDoneMenu] = useState<{ field: string; x: number; y: number } | null>(null)
  /** The "Color" picker in settings: which category colours the card stripe. */
  const [colorMenu, setColorMenu] = useState<{ x: number; y: number } | null>(null)

  const [customStatus, setCustomStatus] = useState<TaskOption[]>(DEFAULT_STATUS)
  const [customUrgency, setCustomUrgency] = useState<TaskOption[]>(DEFAULT_URGENCY)
  const [defaultFieldConfig, setDefaultFieldConfig] = useState<
    Record<TaskOptionType, { name: string; defaultValue: string; deleted: boolean }>
  >({
    status: { name: 'Status', defaultValue: 'not_started', deleted: false },
    urgency: { name: 'Urgency', defaultValue: 'medium', deleted: false },
  })
  const [customFields, setCustomFields] = useState<CustomTaskField[]>([])
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [fieldToRemove, setFieldToRemove] = useState<CustomTaskField | null>(null)
  const [defaultFieldToRemove, setDefaultFieldToRemove] = useState<TaskOptionType | null>(null)
  const [newFieldName, setNewFieldName] = useState('')
  const [newFieldOption, setNewFieldOption] = useState<{
    fieldId: string
    type?: TaskOptionType
    label: string
    color: string
  } | null>(null)
  const [editingFieldName, setEditingFieldName] = useState<{ id: string; name: string } | null>(
    null,
  )
  const [editingOptionLabel, setEditingOptionLabel] = useState<{
    fieldId: string
    optionId: string
    label: string
    color: string
    type?: TaskOptionType
  } | null>(null)
  const [editingDefaultOption, setEditingDefaultOption] = useState<{
    type: TaskOptionType
    value: string
    label: string
    color: string
  } | null>(null)
  const [editingDefaultFieldName, setEditingDefaultFieldName] = useState<{
    type: TaskOptionType
    name: string
  } | null>(null)
  const [assignees, setAssignees] = useState<TaskAssignee[]>([])
  const [menu, setMenu] = useState<MenuState | null>(null)

  const [dragId, setDragId] = useState<string | null>(null)
  const dragRef = useRef<{ taskId: string } | null>(null)
  const cardDragRef = useRef<{
    x: number
    y: number
    categoryId: string
    raf: number
  } | null>(null)
  const colsRef = useRef<HTMLDivElement>(null)
  const colEls = useRef(new Map<string, HTMLElement>())
  const colDragRef = useRef<ColDrag | null>(null)
  const [colDragId, setColDragId] = useState<string | null>(null)
  const [colWidths, setColWidths] = useState(() => readColWidths(roomId))
  const colResize = useRef<{ id: string; startX: number; startW: number } | null>(null)
  const [resizingId, setResizingId] = useState<string | null>(null)
  /** Where each list was drawn just before a reorder, so it can glide from there to its new slot. */
  const flipFrom = useRef<Map<string, number> | null>(null)
  const [dropAt, setDropAt] = useState<{ cat: string; index: number } | null>(null)
  const dropAtRef = useRef<{ cat: string; index: number } | null>(null)
  const [flashId, setFlashId] = useState<string | null>(null)
  const [links, setLinks] = useState<Map<string, number>>(getLinkCounts)
  const [viewer, setViewer] = useState<{ files: Attachment[]; index: number } | null>(null)
  const [fileOverId, setFileOverId] = useState<string | null>(null)
  const [uploadingId, setUploadingId] = useState<string | null>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const uploadTarget = useRef<string | null>(null)

  const activity = settingsOpen
    ? 'Editing board settings'
    : openCardId
      ? 'Viewing a board card'
      : renamingCat
        ? 'Renaming a board list'
        : addingList
          ? 'Adding a board list'
          : Object.values(newTaskInputs).some(Boolean)
            ? 'Adding a board task'
            : 'On the board'
  useEffect(() => {
    setActivity('kanban', active ? activity : null, settingsOpen ? 3 : 2)
  }, [active, activity, settingsOpen, setActivity])

  const statusOptions = useMemo(() => customStatus, [customStatus])
  const urgencyOptions = useMemo(() => customUrgency, [customUrgency])
  const assigneesById = useMemo(
    () => new Map(assignees.map((person) => [person.id, person])),
    [assignees],
  )
  const peerIds = peers.map((peer) => peer.id).join(',')

  // Share the task you're editing, opening a menu on, or dragging; show everyone else's.
  const mySelection = active ? [openCardId, menu?.taskId, dragId] : []
  const mySelectionKey = [...new Set(mySelection.filter(Boolean))].join(',')
  useEffect(() => {
    setSelection('board', mySelectionKey ? mySelectionKey.split(',') : [])
  }, [mySelectionKey, setSelection])
  useEffect(() => () => setSelection('board', []), [setSelection])
  const peersByTask = useMemo(() => {
    const m = new Map<string, Peer[]>()
    for (const p of peers)
      for (const id of p.selection?.board ?? []) m.set(id, [...(m.get(id) ?? []), p])
    return m
  }, [peers])

  /** Tell everyone else (and the canvas in this window) that board data changed. */
  const sync = useCallback(() => send('board', {}, true), [send])

  useEffect(() => {
    try {
      localStorage.setItem(colWidthsKey(roomId), JSON.stringify(colWidths))
    } catch {
      /* private window or storage blocked: widths just aren't remembered */
    }
  }, [roomId, colWidths])

  const setColWidth = (id: string, width: number | null) =>
    setColWidths((prev) => {
      const next = { ...prev }
      if (width === null) delete next[id]
      else next[id] = clampColWidth(width)
      return next
    })

  const fail = useCallback((message: string) => {
    setError(message)
    toast(message)
  }, [])

  // ---------- loading ----------

  const loadBoard = useCallback(
    async (silent = false) => {
      if (!silent) setLoading(true)
      const [c, t, o, f, fo, fn, bs] = await Promise.all([
        supabase
          .from('categories')
          .select('*')
          .eq('room_id', roomId)
          .order('position', { ascending: true }),
        supabase
          .from('tasks')
          .select('*')
          .eq('room_id', roomId)
          .order('position', { ascending: true }),
        supabase
          .from('task_options')
          .select('*')
          .eq('room_id', roomId)
          .order('created_at', { ascending: true }),
        supabase
          .from('task_custom_fields')
          .select('*')
          .eq('room_id', roomId)
          .order('created_at', { ascending: true }),
        supabase
          .from('task_custom_field_options')
          .select('*')
          .order('created_at', { ascending: true }),
        supabase
          .from('task_field_category_names')
          .select('field_type, name, default_value, is_deleted')
          .eq('room_id', roomId),
        supabase.from('task_board_settings').select('*').eq('room_id', roomId).maybeSingle(),
      ])
      // Card extras (20261031_cards_labels_comments.sql); a board without them just goes without.
      const [lb, cm, wt] = await Promise.all([
        supabase.from('task_labels').select('*').eq('room_id', roomId).order('created_at'),
        supabase.from('task_comments').select('task_id').eq('room_id', roomId),
        userIdRef.current
          ? supabase
              .from('task_watchers')
              .select('task_id')
              .eq('room_id', roomId)
              .eq('user_id', userIdRef.current)
          : Promise.resolve({ data: [] as { task_id: string }[], error: null }),
      ])
      setLabels((lb.data ?? []).map((l) => ({ id: l.id, name: l.name ?? '', color: l.color })))
      const counts = new Map<string, number>()
      for (const row of cm.data ?? []) counts.set(row.task_id, (counts.get(row.task_id) ?? 0) + 1)
      setCommentCounts(counts)
      setWatched(new Set((wt.data ?? []).map((row) => row.task_id)))
      if (c.error || t.error || o.error || f.error || fo.error || fn.error) {
        setError(
          c.error?.message ||
            t.error?.message ||
            o.error?.message ||
            f.error?.message ||
            fo.error?.message ||
            fn.error?.message ||
            'Unable to load the board',
        )
        setLoading(false)
        return
      }
      setError(null)
      // Missing table (migration not run yet) or no row yet: Status / Completed.
      const settings = bs.error ? DEFAULT_BOARD_SETTINGS : readBoardSettings(bs.data)
      setBoardSettings(settings)
      setCategories(buildBoard(c.data || [], t.data || [], settings.crossoffs))
      setArchived({
        lists: (c.data || []).filter((x) => x.archived_at),
        tasks: (t.data || []).filter((x) => x.archived_at),
      })
      if (o.data) {
        const split = splitCustom(o.data)
        setCustomStatus(split.status)
        setCustomUrgency(split.urgency)
      }
      if (fn.data) {
        setDefaultFieldConfig({
          status: {
            name: fn.data.find((row) => row.field_type === 'status')?.name ?? 'Status',
            defaultValue:
              fn.data.find((row) => row.field_type === 'status')?.default_value ?? 'not_started',
            deleted: fn.data.find((row) => row.field_type === 'status')?.is_deleted ?? false,
          },
          urgency: {
            name: fn.data.find((row) => row.field_type === 'urgency')?.name ?? 'Urgency',
            defaultValue:
              fn.data.find((row) => row.field_type === 'urgency')?.default_value ?? 'medium',
            deleted: fn.data.find((row) => row.field_type === 'urgency')?.is_deleted ?? false,
          },
        })
      }
      if (f.data && fo.data) {
        setCustomFields(
          f.data.map((field) => ({
            id: field.id,
            name: field.name,
            options: fo.data
              .filter((option) => option.field_id === field.id)
              .map((option) => ({
                id: option.id,
                value: option.value,
                label: option.label,
                color: option.color,
              })),
            defaultValue:
              field.default_value ??
              fo.data.find((option) => option.field_id === field.id)?.value ??
              null,
          })),
        )
      }
      setLoading(false)
    },
    [roomId],
  )

  useEffect(() => {
    loadBoard()
  }, [loadBoard])

  useEffect(() => {
    let cancelled = false
    loadRoomTaskAssignees(roomId)
      .then((people) => {
        if (!cancelled) setAssignees(people)
      })
      .catch((error: unknown) => {
        if (!cancelled) fail(error instanceof Error ? error.message : 'Could not load assignees')
      })
    return () => {
      cancelled = true
    }
  }, [roomId, peerIds, fail])

  // Live updates from teammates (debounced, and never mid-drag).
  useEffect(() => {
    let timer: number | undefined
    const off = on('board', (_payload, fromSelf) => {
      if (fromSelf) return
      window.clearTimeout(timer)
      timer = window.setTimeout(() => {
        if (!dragRef.current && !colDragRef.current) loadBoard(true)
      }, 150)
    })
    return () => {
      off()
      window.clearTimeout(timer)
    }
  }, [on, loadBoard])

  // Open a card from the bell (in this room, or after following a notification to it).
  useEffect(() => {
    return bus.on('board:open-card', ({ taskId }: { taskId: string }) => setOpenCardId(taskId))
  }, [])

  // So clicking your avatar takes others to the card you're looking at.
  useEffect(() => setPlace({ card: openCardId }), [openCardId, setPlace])

  useEffect(() => {
    if (loading) return
    const pending = takePendingCard(roomId)
    if (pending) setOpenCardId(pending)
  }, [loading, roomId])

  // Jump here from a task card on the canvas.
  useEffect(() => {
    return bus.on('board:focus-task', ({ taskId }: { taskId: string }) => {
      setQuery('')
      setFlashId(taskId)
      window.setTimeout(() => {
        document
          .getElementById(`task-${taskId}`)
          ?.scrollIntoView({ block: 'center', inline: 'center', behavior: 'smooth' })
      }, 60)
      window.setTimeout(() => setFlashId(null), 2200)
    })
  }, [])

  // Canvas link counts, so cards can show "3 linked" and jump into focus mode.
  useEffect(() => bus.on('canvas:links', (m: Map<string, number>) => setLinks(new Map(m))), [])

  // "/" focuses search.
  useEffect(() => {
    if (!active) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === '/' && !e.metaKey && !e.ctrlKey && !isTyping(e)) {
        e.preventDefault()
        searchRef.current?.focus()
      } else if (e.key === 'Escape') {
        setMenu(null)
        setFilterMenu(null)
        if (fieldToRemove) setFieldToRemove(null)
        else if (defaultFieldToRemove) setDefaultFieldToRemove(null)
        else setSettingsOpen(false)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [active, defaultFieldToRemove, fieldToRemove])

  // ---------- categories ----------

  const addCategory = async () => {
    const name = cleanLine(newListName, LIMITS.categoryName)
    if (!name) return
    const position = Math.max(0, ...categories.map((c) => c.position)) + 1
    const { data, error: err } = await supabase
      .from('categories')
      .insert({ name, position, room_id: roomId })
      .select()
      .single()
    if (err) return fail(err.message)
    if (data) {
      setCategories((prev) => [
        ...prev,
        { id: data.id, name: data.name, position: data.position ?? position, tasks: [] },
      ])
      setNewListName('')
      setAddingList(false)
      sync()
    }
  }

  const renameCategory = async () => {
    if (!renamingCat) return
    const name = cleanLine(renamingCat.name, LIMITS.categoryName)
    const id = renamingCat.id
    setRenamingCat(null)
    if (!name) return
    setCategories((prev) => prev.map((c) => (c.id === id ? { ...c, name } : c)))
    const { error: err } = await supabase.from('categories').update({ name }).eq('id', id)
    if (err) {
      fail(err.message)
      loadBoard(true)
    } else sync()
  }

  // ---------- task categories ----------

  const isCustomField = (field: string) => field !== 'status' && field !== 'urgency'

  /** Categories a card can carry: Status / Urgency unless removed from the board, plus custom ones with statuses. */
  const boardFields = (): { field: string; name: string; options: TaskOption[] }[] => [
    ...(['status', 'urgency'] as const)
      .filter((type) => !defaultFieldConfig[type].deleted)
      .map((type) => ({
        field: type,
        name: defaultFieldConfig[type].name,
        options: type === 'status' ? statusOptions : urgencyOptions,
      })),
    ...customFields
      .filter((f) => f.options.length > 0)
      .map((f) => ({
        field: f.id,
        name: f.name,
        options: f.options.map((o) => ({ ...o, type: 'status' as const })),
      })),
  ]

  const defaultValueOf = (field: string): string | null => {
    if (field === 'status' || field === 'urgency') {
      const config = defaultFieldConfig[field]
      const options = field === 'status' ? statusOptions : urgencyOptions
      if (config.deleted) return null
      return options.some((o) => o.value === config.defaultValue)
        ? config.defaultValue
        : (options[0]?.value ?? null)
    }
    const f = customFields.find((item) => item.id === field)
    return f?.defaultValue ?? f?.options[0]?.value ?? null
  }

  /**
   * Sets (or with null, turns off) one category's Crossoff status and re-sorts every list to
   * match. Each category has at most one; a card is crossed off when any of them matches.
   */
  const saveCrossoff = async (field: string, value: string | null) => {
    setDoneMenu(null)
    const current = crossoffs.find((r) => r.field === field)?.value ?? null
    if (current === value) return
    const next = [
      ...crossoffs.filter((r) => r.field !== field),
      ...(value ? [{ field, value }] : []),
    ]
    const prevSettings = boardSettings
    setBoardSettings({ ...boardSettings, crossoffs: next })
    crossoffsRef.current = next
    const prev = categoriesRef.current
    const sorted = prev.map((c) => ({
      ...c,
      tasks: sinkDone(c.tasks, next).map((t, i) => ({ ...t, position: i })),
    }))
    setCategories(sorted)
    const { error: err } = await supabase
      .from('task_board_settings')
      .upsert({ room_id: roomId, crossoffs: next })
    if (err) {
      setBoardSettings(prevSettings)
      crossoffsRef.current = prevSettings.crossoffs
      setCategories(prev)
      return fail(err.message)
    }
    savePositions(prev, sorted)
    sync()
  }

  /** Which category colours the stripe on the left of each card (null = none). */
  const saveColorField = async (field: string | null) => {
    setColorMenu(null)
    if (field === boardSettings.colorField) return
    const prevSettings = boardSettings
    setBoardSettings({ ...boardSettings, colorField: field })
    const { error: err } = await supabase
      .from('task_board_settings')
      .upsert({ room_id: roomId, color_field: field })
    if (err) {
      setBoardSettings(prevSettings)
      return fail(err.message)
    }
    sync()
  }

  /** The stripe colour for a card, from the chosen category; null when it isn't on the card. */
  const barColorOf = (task: Task): string | null => {
    const field = boardSettings.colorField
    if (!field) return null
    const value = categoryValue(task, field)
    if (value === null) return null
    const f = boardFields().find((x) => x.field === field)
    return f ? resolveOption(f.options, value, 'status').color : null
  }

  // ---------- tasks ----------

  const addTask = async (categoryId: string) => {
    const title = cleanLine(newTaskInputs[categoryId] ?? '', LIMITS.taskTitle)
    if (!title) return
    const cat = categories.find((c) => c.id === categoryId)
    const position = cat ? cat.tasks.length : 0
    // New cards start with just the Crossoff categories, each at its default.
    const start = (field: string) =>
      crossoffs.some((r) => r.field === field) ? defaultValueOf(field) : null
    const customValues: Record<string, string> = Object.fromEntries(
      crossoffs
        .filter((r) => isCustomField(r.field))
        .flatMap((r) => {
          const v = defaultValueOf(r.field)
          return v ? [[r.field, v]] : []
        }),
    )
    setNewTaskInputs((prev) => ({ ...prev, [categoryId]: '' }))
    const row = {
      title,
      status: start('status'),
      urgency: start('urgency'),
      category_id: categoryId,
      position,
      room_id: roomId,
      custom_fields: customValues,
    }
    let { data, error: err } = await supabase.from('tasks').insert(row).select().single()
    // 23502 = not-null violation: a database without 20261030_optional_task_categories.sql
    // still requires Status and Urgency, so fill them in.
    if (err?.code === '23502')
      ({ data, error: err } = await supabase
        .from('tasks')
        .insert({
          ...row,
          status: row.status ?? defaultFieldConfig.status.defaultValue,
          urgency: row.urgency ?? defaultFieldConfig.urgency.defaultValue,
        })
        .select()
        .single())
    if (err) return fail(err.message)
    if (data) {
      const mapped = mapTask(data)
      setCategories((prev) =>
        prev.map((c) =>
          c.id === categoryId ? { ...c, tasks: sinkDone([...c.tasks, mapped], crossoffs) } : c,
        ),
      )
      sync()
    }
  }

  const patchTask = async (
    taskId: string,
    patch: Partial<
      Pick<
        Task,
        | 'status'
        | 'urgency'
        | 'title'
        | 'description'
        | 'files'
        | 'dueDate'
        | 'memberIds'
        | 'labelIds'
        | 'checklists'
        | 'cover'
        | 'customFields'
      >
    >,
  ) => {
    const prev = categoriesRef.current
    // Any category can be the one that marks a card done, so changing one may re-sort the list.
    const resort = 'status' in patch || 'urgency' in patch || 'customFields' in patch
    const next = prev.map((c) => {
      if (!c.tasks.some((t) => t.id === taskId)) return c
      const tasks = c.tasks.map((t) => (t.id === taskId ? { ...t, ...patch } : t))
      if (!resort) return { ...c, tasks }
      return {
        ...c,
        tasks: sinkDone(tasks, crossoffsRef.current).map((t, i) => ({ ...t, position: i })),
      }
    })
    setCategories(next)
    if (resort) savePositions(prev, next)
    const { files, dueDate, memberIds, labelIds, checklists, customFields: fields, ...rest } = patch
    const dbPatch: Record<string, unknown> = { ...rest }
    if ('dueDate' in patch) dbPatch.due_date = dueDate
    if ('memberIds' in patch) dbPatch.member_ids = memberIds
    if ('labelIds' in patch) dbPatch.label_ids = labelIds
    if ('checklists' in patch) dbPatch.checklists = checklists
    if ('customFields' in patch) dbPatch.custom_fields = fields
    if ('title' in patch) dbPatch.title = cleanLine(patch.title ?? '', LIMITS.taskTitle)
    if ('description' in patch)
      dbPatch.description = cleanMultiline(patch.description ?? '', LIMITS.taskDescription) || null
    if (files) {
      // Writing attachments also retires the old images column for this task.
      dbPatch.attachments = files.map(cleanAttachment).filter(Boolean)
      dbPatch.images = []
    }
    const { error: err } = await supabase.from('tasks').update(dbPatch).eq('id', taskId)
    if (err) {
      fail(err.message)
      loadBoard(true)
    } else sync()
  }

  // ---------- archive ----------

  /** Hides a card from the board (restorable from the archive), with Undo in the toast. */
  const archiveTask = async (taskId: string) => {
    const task = findTask(taskId)
    if (!task) return
    if (openCardId === taskId) setOpenCardId(null)
    setCategories((prev) =>
      prev.map((c) => ({ ...c, tasks: c.tasks.filter((t) => t.id !== taskId) })),
    )
    const { error: err } = await supabase
      .from('tasks')
      .update({ archived_at: new Date().toISOString() })
      .eq('id', taskId)
    if (err) {
      fail(err.message)
      return loadBoard(true)
    }
    sync()
    undoToast(`Archived “${task.title}”`, () => restoreTask(taskId))
  }

  const restoreTask = async (taskId: string) => {
    const row = archived.tasks.find((t) => t.id === taskId)
    // A card can't come back into a list that's still archived, so that list comes back too.
    if (row && archived.lists.some((l) => l.id === row.category_id))
      await supabase.from('categories').update({ archived_at: null }).eq('id', row.category_id)
    const { error: err } = await supabase
      .from('tasks')
      .update({ archived_at: null })
      .eq('id', taskId)
    if (err) return fail(err.message)
    await loadBoard(true)
    sync()
  }

  const deleteTaskForever = async (taskId: string) => {
    const { error: err } = await supabase.from('tasks').delete().eq('id', taskId)
    if (err) return fail(err.message)
    await loadBoard(true)
    sync()
  }

  const archiveCategory = async (cat: Category) => {
    setCategories((prev) => prev.filter((c) => c.id !== cat.id))
    const { error: err } = await supabase
      .from('categories')
      .update({ archived_at: new Date().toISOString() })
      .eq('id', cat.id)
    if (err) {
      fail(err.message)
      return loadBoard(true)
    }
    sync()
    undoToast(`Archived the list “${cat.name}”`, () => restoreCategory(cat.id))
  }

  const restoreCategory = async (id: string) => {
    const { error: err } = await supabase
      .from('categories')
      .update({ archived_at: null })
      .eq('id', id)
    if (err) return fail(err.message)
    await loadBoard(true)
    sync()
  }

  const deleteCategoryForever = async (id: string) => {
    const r1 = await supabase.from('tasks').delete().eq('category_id', id)
    if (r1.error) return fail(r1.error.message)
    const r2 = await supabase.from('categories').delete().eq('id', id)
    if (r2.error) return fail(r2.error.message)
    await loadBoard(true)
    sync()
  }

  // ---------- labels & watching ----------

  const createLabel = async (name: string, color: string): Promise<Label | null> => {
    const { data, error: err } = await supabase
      .from('task_labels')
      .insert({ room_id: roomId, name, color })
      .select()
      .single()
    if (err) {
      fail(err.message)
      return null
    }
    const label = { id: data.id, name: data.name, color: data.color }
    setLabels((prev) => [...prev, label])
    sync()
    return label
  }

  const updateLabel = async (label: Label) => {
    setLabels((prev) => prev.map((l) => (l.id === label.id ? label : l)))
    const { error: err } = await supabase
      .from('task_labels')
      .update({ name: label.name, color: label.color })
      .eq('id', label.id)
    if (err) {
      fail(err.message)
      loadBoard(true)
    } else sync()
  }

  const deleteLabel = async (label: Label) => {
    setLabels((prev) => prev.filter((l) => l.id !== label.id))
    setCategories((prev) =>
      prev.map((c) => ({
        ...c,
        tasks: c.tasks.map((t) => ({ ...t, labelIds: t.labelIds.filter((id) => id !== label.id) })),
      })),
    )
    const { error: err } = await supabase.from('task_labels').delete().eq('id', label.id)
    if (err) {
      fail(err.message)
      loadBoard(true)
    } else sync()
  }

  const setOpenCardCommentCount = useCallback(
    (count: number) => {
      if (!openCardId) return
      setCommentCounts((prev) => {
        if ((prev.get(openCardId) ?? 0) === count) return prev
        const next = new Map(prev)
        next.set(openCardId, count)
        return next
      })
    },
    [openCardId],
  )

  const toggleWatch = async (taskId: string) => {
    if (!userId) return
    const on = watched.has(taskId)
    setWatched((prev) => {
      const next = new Set(prev)
      if (on) next.delete(taskId)
      else next.add(taskId)
      return next
    })
    const { error: err } = on
      ? await supabase.from('task_watchers').delete().eq('task_id', taskId).eq('user_id', userId)
      : await supabase.from('task_watchers').insert({ task_id: taskId, room_id: roomId })
    if (err) {
      fail(err.message)
      loadBoard(true)
    }
  }

  const findTask = (taskId: string) =>
    categoriesRef.current.flatMap((c) => c.tasks).find((t) => t.id === taskId)

  const addFiles = async (taskId: string, files: File[]) => {
    if (!files.length) return
    setUploadingId(taskId)
    try {
      await withUploadFeedback(
        `Uploading ${files.length === 1 ? 'file' : `${files.length} files`} to card…`,
        async () => {
          // Keep whatever uploaded even if one file fails.
          const results = await Promise.allSettled(
            files.map((f) => uploadRoomFile(f, roomId, 'tasks')),
          )
          const added = results.flatMap((r) => (r.status === 'fulfilled' ? [r.value] : []))
          const failed = results.find((r): r is PromiseRejectedResult => r.status === 'rejected')
          const current = findTask(taskId)
          if (current && added.length)
            await patchTask(taskId, { files: [...current.files, ...added] })
          if (failed) fail(failed.reason?.message || 'Upload failed')
        },
      )
    } finally {
      setUploadingId(null)
    }
  }

  const removeFile = (taskId: string, url: string) => {
    const current = findTask(taskId)
    if (current) patchTask(taskId, { files: current.files.filter((f) => f.url !== url) })
  }

  const pickFiles = (taskId: string) => {
    uploadTarget.current = taskId
    fileInputRef.current?.click()
  }

  const focusOnCanvas = (taskId: string) => {
    bus.emit('nav', 'canvas')
    window.setTimeout(() => bus.emit('canvas:focus-task', { taskId }), 60)
  }

  const sendToCanvas = (taskId: string) => {
    bus.emit('nav', 'canvas')
    // Give the canvas a frame to become active before it places the card.
    window.setTimeout(() => bus.emit('canvas:add-task', { taskId }), 30)
  }

  // ---------- status / urgency menu ----------

  const openMenu = (
    e: React.MouseEvent<HTMLElement>,
    kind: MenuState['kind'],
    taskId: string,
    categoryId: string,
    fieldId?: string,
  ) => {
    e.stopPropagation()
    const r = e.currentTarget.getBoundingClientRect()
    setMenu({
      kind,
      taskId,
      categoryId,
      fieldId,
      x: Math.min(r.left, window.innerWidth - 232),
      y: Math.min(r.bottom + 4, window.innerHeight - 340),
    })
  }

  const pick = (value: string) => {
    if (!menu) return
    if (menu.kind === 'status') patchTask(menu.taskId, { status: value })
    else if (menu.kind === 'urgency') patchTask(menu.taskId, { urgency: value })
    else if (menu.kind === 'assignee' && menuTask) {
      // Members: toggles, and the menu stays open so several people can be picked.
      const ids = menuTask.memberIds
      patchTask(menu.taskId, {
        memberIds: ids.includes(value) ? ids.filter((id) => id !== value) : [...ids, value],
      })
      return
    } else if (menu.kind === 'custom' && menu.fieldId && menuTask) {
      const customFields = { ...menuTask.customFields }
      if (value) customFields[menu.fieldId] = value
      else delete customFields[menu.fieldId]
      patchTask(menu.taskId, {
        customFields,
      })
    }
    setMenu(null)
  }

  const pickDueDate = (value: string) => {
    if (!menu || menu.kind !== 'due_date') return
    patchTask(menu.taskId, { dueDate: value || null })
    setMenu(null)
  }

  const addCustomField = async () => {
    const name = cleanLine(newFieldName, LIMITS.optionLabel)
    if (!name) return
    const { data, error: err } = await supabase
      .from('task_custom_fields')
      .insert({ name, room_id: roomId })
      .select()
      .single()
    if (err) return fail(err.message)
    setCustomFields((fields) => [
      ...fields,
      { id: data.id, name: data.name, defaultValue: data.default_value ?? null, options: [] },
    ])
    setNewFieldName('')
    sync()
  }

  /** A category with a Crossoff can't go: cards would stay crossed off with nothing showing why. */
  const blockIfDoneField = (field: string, name: string) => {
    if (!crossoffs.some((r) => r.field === field)) return false
    toast(`“${name}” has a Crossoff. Turn its Crossoff off first.`)
    return true
  }

  const removeCustomField = async (field: CustomTaskField) => {
    if (blockIfDoneField(field.id, field.name)) return setFieldToRemove(null)
    const { data: tasks, error: taskError } = await supabase
      .from('tasks')
      .select('id, custom_fields')
      .eq('room_id', roomId)
    if (taskError) return fail(taskError.message)

    const updates = await Promise.all(
      (tasks ?? [])
        .filter((task) => task.custom_fields && field.id in task.custom_fields)
        .map((task) => {
          const values = { ...task.custom_fields }
          delete values[field.id]
          return supabase.from('tasks').update({ custom_fields: values }).eq('id', task.id)
        }),
    )
    const failedUpdate = updates.find((result) => result.error)
    if (failedUpdate?.error) return fail(failedUpdate.error.message)

    const { error: deleteError } = await supabase
      .from('task_custom_fields')
      .delete()
      .eq('id', field.id)
      .eq('room_id', roomId)
    if (deleteError) return fail(deleteError.message)

    setCustomFields((fields) => fields.filter((item) => item.id !== field.id))
    if (newFieldOption?.fieldId === field.id) setNewFieldOption(null)
    setFieldToRemove(null)
    sync()
  }

  const addCustomFieldOption = async () => {
    if (!newFieldOption) return
    const label = cleanLine(newFieldOption.label, LIMITS.optionLabel)
    if (!label) return
    if (newFieldOption.type) {
      const type = newFieldOption.type
      const options = type === 'status' ? statusOptions : urgencyOptions
      const value = slugify(label)
      if (options.some((option) => option.value === value)) {
        return fail('A status with that name already exists')
      }
      const { data, error: err } = await supabase
        .from('task_options')
        .insert({
          type,
          value,
          label,
          color: cleanHexColor(newFieldOption.color, '#71717a'),
          room_id: roomId,
        })
        .select()
        .single()
      if (err) return fail(err.message)
      const newOption = rowToOption(data)
      if (type === 'status') setCustomStatus((items) => [...items, newOption])
      else setCustomUrgency((items) => [...items, newOption])
      const fieldConfig = defaultFieldConfig[type]
      if (
        !fieldConfig.defaultValue ||
        !options.some((option) => option.value === fieldConfig.defaultValue)
      ) {
        const { error: defaultError } = await supabase.from('task_field_category_names').upsert(
          {
            room_id: roomId,
            field_type: type,
            name: fieldConfig.name,
            default_value: value,
            is_deleted: fieldConfig.deleted,
          },
          { onConflict: 'room_id,field_type' },
        )
        if (defaultError) {
          fail(defaultError.message)
          loadBoard(true)
          return
        }
        setDefaultFieldConfig((previous) => ({
          ...previous,
          [type]: { ...previous[type], defaultValue: value },
        }))
      }
      setNewFieldOption(null)
      sync()
      return
    }
    const field = customFields.find((item) => item.id === newFieldOption.fieldId)
    if (!field) return
    const value = slugify(label)
    if (field.options.some((option) => option.value === value)) {
      setNewFieldOption(null)
      return
    }
    const { data, error: err } = await supabase
      .from('task_custom_field_options')
      .insert({
        field_id: field.id,
        value,
        label,
        color: cleanHexColor(newFieldOption.color, '#71717a'),
      })
      .select()
      .single()
    if (err) return fail(err.message)
    let defaultValue = field.defaultValue
    if (!defaultValue) {
      const { error: defaultError } = await supabase
        .from('task_custom_fields')
        .update({ default_value: data.value })
        .eq('id', field.id)
        .eq('room_id', roomId)
      if (defaultError) {
        fail(defaultError.message)
        loadBoard(true)
        return
      }
      defaultValue = data.value
    }
    setCustomFields((fields) =>
      fields.map((item) =>
        item.id === field.id
          ? {
              ...item,
              defaultValue,
              options: [
                ...item.options,
                { id: data.id, value: data.value, label: data.label, color: data.color },
              ],
            }
          : item,
      ),
    )
    setNewFieldOption(null)
    sync()
  }

  const setCustomFieldDefault = async (field: CustomTaskField, value: string) => {
    if (!field.options.some((option) => option.value === value)) return
    const { error: err } = await supabase
      .from('task_custom_fields')
      .update({ default_value: value })
      .eq('id', field.id)
      .eq('room_id', roomId)
    if (err) return fail(err.message)
    setCustomFields((fields) =>
      fields.map((item) => (item.id === field.id ? { ...item, defaultValue: value } : item)),
    )
    sync()
  }

  const setDefaultFieldValue = async (type: TaskOptionType, value: string) => {
    const options = type === 'status' ? statusOptions : urgencyOptions
    if (!options.some((option) => option.value === value)) return
    const config = defaultFieldConfig[type]
    const { error: err } = await supabase.from('task_field_category_names').upsert(
      {
        room_id: roomId,
        field_type: type,
        name: config.name,
        default_value: value,
        is_deleted: config.deleted,
      },
      { onConflict: 'room_id,field_type' },
    )
    if (err) return fail(err.message)
    setDefaultFieldConfig((previous) => ({
      ...previous,
      [type]: { ...previous[type], defaultValue: value },
    }))
    sync()
  }

  const removeDefaultField = async (type: TaskOptionType) => {
    const config = defaultFieldConfig[type]
    if (blockIfDoneField(type, config.name)) return setDefaultFieldToRemove(null)
    const { error: err } = await supabase.from('task_field_category_names').upsert(
      {
        room_id: roomId,
        field_type: type,
        name: config.name,
        default_value: config.defaultValue,
        is_deleted: true,
      },
      { onConflict: 'room_id,field_type' },
    )
    if (err) return fail(err.message)
    setDefaultFieldConfig((previous) => ({
      ...previous,
      [type]: { ...previous[type], deleted: true },
    }))
    setDefaultFieldToRemove(null)
    sync()
  }

  const restoreDefaultField = async (type: TaskOptionType) => {
    const config = defaultFieldConfig[type]
    const { error: err } = await supabase.from('task_field_category_names').upsert(
      {
        room_id: roomId,
        field_type: type,
        name: config.name,
        default_value: config.defaultValue,
        is_deleted: false,
      },
      { onConflict: 'room_id,field_type' },
    )
    if (err) return fail(err.message)
    setDefaultFieldConfig((previous) => ({
      ...previous,
      [type]: { ...previous[type], deleted: false },
    }))
    sync()
  }

  const saveCustomFieldName = async () => {
    if (!editingFieldName) return
    const name = cleanLine(editingFieldName.name, LIMITS.optionLabel)
    if (!name) return
    const { error: err } = await supabase
      .from('task_custom_fields')
      .update({ name })
      .eq('id', editingFieldName.id)
      .eq('room_id', roomId)
    if (err) return fail(err.message)
    setCustomFields((fields) =>
      fields.map((field) => (field.id === editingFieldName.id ? { ...field, name } : field)),
    )
    setEditingFieldName(null)
    sync()
  }

  const saveCustomOptionLabel = async () => {
    if (!editingOptionLabel) return
    const label = cleanLine(editingOptionLabel.label, LIMITS.optionLabel)
    if (!label) return
    const color = cleanHexColor(editingOptionLabel.color, '#71717a')
    if (editingOptionLabel.type) {
      const { error: err } = await supabase
        .from('task_options')
        .update({ label, color })
        .eq('id', editingOptionLabel.optionId)
        .eq('room_id', roomId)
      if (err) return fail(err.message)
      const update = (options: TaskOption[]) =>
        options.map((option) =>
          option.id === editingOptionLabel.optionId ? { ...option, label, color } : option,
        )
      if (editingOptionLabel.type === 'status') setCustomStatus(update)
      else setCustomUrgency(update)
      setEditingOptionLabel(null)
      sync()
      return
    }
    const field = customFields.find((item) => item.id === editingOptionLabel.fieldId)
    if (!field) return
    if (
      field.options.some(
        (option) =>
          option.id !== editingOptionLabel.optionId &&
          option.label.toLocaleLowerCase() === label.toLocaleLowerCase(),
      )
    ) {
      return fail('A status with that name already exists')
    }
    const { error: err } = await supabase
      .from('task_custom_field_options')
      .update({ label, color })
      .eq('id', editingOptionLabel.optionId)
      .eq('field_id', editingOptionLabel.fieldId)
    if (err) return fail(err.message)
    setCustomFields((fields) =>
      fields.map((item) =>
        item.id === editingOptionLabel.fieldId
          ? {
              ...item,
              options: item.options.map((option) =>
                option.id === editingOptionLabel.optionId ? { ...option, label, color } : option,
              ),
            }
          : item,
      ),
    )
    setEditingOptionLabel(null)
    sync()
  }

  /** How many tasks on the board use a status. */
  const tasksUsing = (category: TaskOptionType | CustomTaskField, value: string) =>
    categories
      .flatMap((c) => c.tasks)
      .filter((t) =>
        category === 'status'
          ? t.status === value
          : category === 'urgency'
            ? t.urgency === value
            : t.customFields[category.id] === value,
      ).length

  /**
   * Deletes a status from a category. Refused while a task uses it (checked here for a quick
   * answer, and by the database in case the board is behind) or while it's the default.
   */
  const deleteOption = async (category: TaskOptionType | CustomTaskField, option: TaskOption) => {
    const used = tasksUsing(category, option.value)
    if (used) {
      const tasks = used === 1 ? '1 task. Move it' : `${used} tasks. Move them`
      return toast(`“${option.label}” is used by ${tasks} to another status first.`)
    }
    const isDefaultField = typeof category === 'string'
    const defaultValue = isDefaultField
      ? defaultFieldConfig[category].defaultValue
      : (category.defaultValue ?? category.options[0]?.value)
    if (defaultValue === option.value) {
      return toast(`“${option.label}” is the default status. Choose another default first.`)
    }
    if (
      crossoffs.some(
        (r) => r.field === (isDefaultField ? category : category.id) && r.value === option.value,
      )
    ) {
      return toast(
        `“${option.label}” is a Crossoff status. Pick another or turn the Crossoff off first.`,
      )
    }

    if (isDefaultField && (category === 'status' ? statusOptions : urgencyOptions).length <= 1) {
      return toast('A category needs at least one status.')
    }
    if (!option.id) return toast('This status can’t be deleted yet. Try reloading the board.')

    const result = isDefaultField
      ? await supabase.from('task_options').delete().eq('id', option.id).eq('room_id', roomId)
      : await supabase
          .from('task_custom_field_options')
          .delete()
          .eq('id', option.id)
          .eq('field_id', category.id)
    if (result.error) {
      toast(result.error.message)
      return loadBoard(true)
    }

    if (isDefaultField) {
      const remove = (items: TaskOption[]) => items.filter((o) => o.value !== option.value)
      if (category === 'status') setCustomStatus(remove)
      else setCustomUrgency(remove)
      if (editingDefaultOption?.value === option.value) setEditingDefaultOption(null)
    } else {
      setCustomFields((fields) =>
        fields.map((f) =>
          f.id === category.id ? { ...f, options: f.options.filter((o) => o.id !== option.id) } : f,
        ),
      )
      if (editingOptionLabel?.optionId === option.id) setEditingOptionLabel(null)
    }
    sync()
  }

  const saveDefaultOption = async () => {
    if (!editingDefaultOption) return
    const label = cleanLine(editingDefaultOption.label, LIMITS.optionLabel)
    if (!label) return
    const color = cleanHexColor(editingDefaultOption.color, '#71717a')
    const currentOptions = editingDefaultOption.type === 'status' ? statusOptions : urgencyOptions
    const current = currentOptions.find((option) => option.value === editingDefaultOption.value)
    const write = current?.id
      ? supabase
          .from('task_options')
          .update({ label, color })
          .eq('id', current.id)
          .eq('room_id', roomId)
      : supabase
          .from('task_options')
          .insert({
            type: editingDefaultOption.type,
            value: editingDefaultOption.value,
            label,
            color,
            room_id: roomId,
          })
          .select()
          .single()
    const result = await write
    if (result.error) return fail(result.error.message)
    const row = 'data' in result ? result.data : null
    const updateOption = (options: TaskOption[]) =>
      options.map((option) =>
        option.value === editingDefaultOption.value
          ? {
              ...option,
              ...(row ? { id: row.id } : {}),
              label,
              color,
            }
          : option,
      )
    if (editingDefaultOption.type === 'status') setCustomStatus(updateOption)
    else setCustomUrgency(updateOption)
    setEditingDefaultOption(null)
    sync()
  }

  const saveDefaultFieldName = async () => {
    if (!editingDefaultFieldName) return
    const name = cleanLine(editingDefaultFieldName.name, LIMITS.optionLabel)
    if (!name) return
    const type = editingDefaultFieldName.type
    const { error: err } = await supabase.from('task_field_category_names').upsert(
      {
        room_id: roomId,
        field_type: type,
        name,
        default_value: defaultFieldConfig[type].defaultValue,
        is_deleted: defaultFieldConfig[type].deleted,
      },
      { onConflict: 'room_id,field_type' },
    )
    if (err) return fail(err.message)
    setDefaultFieldConfig((previous) => ({
      ...previous,
      [type]: { ...previous[type], name },
    }))
    setEditingDefaultFieldName(null)
    sync()
  }

  // ---------- drag and drop (move happens on drop, so the dragged node never remounts mid-drag) ----------

  const setDrop = (v: { cat: string; index: number } | null) => {
    dropAtRef.current = v
    setDropAt(v)
  }

  const cardDragFrame = () => {
    const drag = cardDragRef.current
    const board = colsRef.current
    if (!drag || !board) return

    const boardRect = board.getBoundingClientRect()
    const edge = 72
    if (drag.x < boardRect.left + edge) {
      board.scrollLeft -= Math.min(24, Math.ceil(((boardRect.left + edge - drag.x) / edge) * 24))
    } else if (drag.x > boardRect.right - edge) {
      board.scrollLeft += Math.min(24, Math.ceil(((drag.x - (boardRect.right - edge)) / edge) * 24))
    }

    const column = colEls.current.get(drag.categoryId)
    const taskList = column?.querySelector<HTMLElement>('.dv-card-list')
    if (taskList) {
      const listRect = taskList.getBoundingClientRect()
      const verticalEdge = 56
      if (drag.y < listRect.top + verticalEdge) {
        taskList.scrollTop -= Math.min(
          20,
          Math.ceil(((listRect.top + verticalEdge - drag.y) / verticalEdge) * 20),
        )
      } else if (drag.y > listRect.bottom - verticalEdge) {
        taskList.scrollTop += Math.min(
          20,
          Math.ceil(((drag.y - (listRect.bottom - verticalEdge)) / verticalEdge) * 20),
        )
      }
    }

    drag.raf = requestAnimationFrame(cardDragFrame)
  }

  const trackCardDrag = (e: React.DragEvent<HTMLElement>, categoryId: string) => {
    const drag = cardDragRef.current
    if (!drag) return
    drag.x = e.clientX
    drag.y = e.clientY
    drag.categoryId = categoryId
  }

  const onCardDragOver = (e: React.DragEvent<HTMLElement>, catId: string, index: number) => {
    if (!dragRef.current) return
    e.preventDefault()
    e.stopPropagation()
    trackCardDrag(e, catId)
    e.dataTransfer.dropEffect = 'move'
    const r = e.currentTarget.getBoundingClientRect()
    const idx = index + (e.clientY > r.top + r.height / 2 ? 1 : 0)
    const cur = dropAtRef.current
    if (!cur || cur.cat !== catId || cur.index !== idx) setDrop({ cat: catId, index: idx })
  }

  const onColumnDragOver = (e: React.DragEvent<HTMLElement>, cat: Category) => {
    if (!dragRef.current) return
    e.preventDefault()
    trackCardDrag(e, cat.id)
    e.dataTransfer.dropEffect = 'move'
    const cur = dropAtRef.current
    if (!cur || cur.cat !== cat.id || cur.index !== cat.tasks.length)
      setDrop({ cat: cat.id, index: cat.tasks.length })
  }

  const endDrag = () => {
    if (cardDragRef.current) cancelAnimationFrame(cardDragRef.current.raf)
    cardDragRef.current = null
    dragRef.current = null
    setDragId(null)
    setDrop(null)
  }

  const onDrop = (e: React.DragEvent<HTMLElement>) => {
    e.preventDefault()
    const drag = dragRef.current
    const target = dropAtRef.current
    endDrag()
    if (!drag || !target) return

    const prev = categoriesRef.current
    const fromCat = prev.find((c) => c.tasks.some((t) => t.id === drag.taskId))
    const task = fromCat?.tasks.find((t) => t.id === drag.taskId)
    if (!fromCat || !task) return

    let index = target.index
    if (fromCat.id === target.cat) {
      const fromIdx = fromCat.tasks.findIndex((t) => t.id === drag.taskId)
      if (fromIdx < index) index -= 1
      if (index === fromIdx) return
    }

    const next = prev.map((c) => {
      const tasks = c.tasks.filter((t) => t.id !== drag.taskId)
      if (c.id === target.cat) tasks.splice(index, 0, { ...task, categoryId: target.cat })
      return {
        ...c,
        tasks: sinkDone(tasks, crossoffsRef.current).map((t, i) => ({ ...t, position: i })),
      }
    })
    setCategories(next)
    savePositions(prev, next)
  }

  /** Persists only the task positions / lists that changed between two board states. */
  function savePositions(prev: Category[], next: Category[]) {
    const before = new Map(prev.flatMap((c) => c.tasks.map((t) => [t.id, t] as const)))
    const writes = next
      .flatMap((c) => c.tasks)
      .filter((t) => {
        const o = before.get(t.id)
        return !o || o.position !== t.position || o.categoryId !== t.categoryId
      })
      .map((t) =>
        supabase
          .from('tasks')
          .update({ position: t.position, category_id: t.categoryId })
          .eq('id', t.id),
      )

    Promise.all(writes).then((results) => {
      const failed = results.find((r) => r.error)
      if (failed?.error) {
        fail(failed.error.message)
        loadBoard(true)
      } else sync()
    })
  }

  // ---------- reordering lists ----------
  // Pointer-driven rather than HTML drag and drop, so the list follows the cursor exactly and the
  // others can slide aside. Nothing re-renders mid-drag: transforms are set on the elements, and
  // the new order is committed on drop.

  const saveColumnOrder = (prev: Category[], next: Category[]) => {
    const before = new Map(prev.map((c) => [c.id, c.position]))
    const writes = next
      .filter((c) => before.get(c.id) !== c.position)
      .map((c) => supabase.from('categories').update({ position: c.position }).eq('id', c.id))
    Promise.all(writes).then((results) => {
      const failed = results.find((r) => r.error)
      if (failed?.error) {
        fail(failed.error.message)
        loadBoard(true)
      } else sync()
    })
  }

  /** Puts list `id` at `index`, remembering where everything was drawn so it animates there. */
  const commitColumnMove = (id: string, index: number, drawnAt: Map<string, number>) => {
    flipFrom.current = drawnAt
    const prev = categoriesRef.current
    const from = prev.findIndex((c) => c.id === id)
    if (from < 0 || from === index) {
      // Nothing moved, but still re-render so the lifted list settles back.
      setCategories((c) => [...c])
      return
    }
    const next = [...prev]
    const [moved] = next.splice(from, 1)
    next.splice(index, 0, moved)
    const positioned = next.map((c, i) => ({ ...c, position: i }))
    setCategories(positioned)
    saveColumnOrder(prev, positioned)
  }

  // FLIP: each list starts where it was drawn and glides to its new layout position.
  useLayoutEffect(() => {
    const flip = flipFrom.current
    if (!flip) return
    flipFrom.current = null
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
      for (const el of colEls.current.values()) el.style.transform = ''
      return
    }
    const moving: HTMLElement[] = []
    for (const [id, x] of flip) {
      const el = colEls.current.get(id)
      if (!el) continue
      const delta = x - el.offsetLeft
      el.style.transition = 'none'
      if (delta) {
        el.style.transform = `translate3d(${delta}px,0,0)`
        moving.push(el)
      } else {
        el.style.transform = ''
      }
    }
    void colsRef.current?.offsetWidth // apply the start positions before animating
    for (const el of colEls.current.values()) el.style.transition = ''
    for (const el of moving) {
      el.style.transition = SETTLE
      el.style.transform = ''
      el.addEventListener('transitionend', () => (el.style.transition = ''), { once: true })
    }
  }, [categories])

  const colFrame = () => {
    const d = colDragRef.current
    const box = colsRef.current
    if (!d || !box) return

    // Auto-scroll near the edges, faster the closer the pointer gets.
    const rect = box.getBoundingClientRect()
    const edge = 80
    if (d.x < rect.left + edge) box.scrollLeft -= Math.ceil(((rect.left + edge - d.x) / edge) * 20)
    else if (d.x > rect.right - edge)
      box.scrollLeft += Math.ceil(((d.x - (rect.right - edge)) / edge) * 20)

    const first = d.lefts[0]
    const last = d.lefts[d.lefts.length - 1]
    const raw = d.x - d.startX + box.scrollLeft - d.startScroll
    // Stays within the row of lists.
    d.dx = Math.max(first - d.lefts[d.from], Math.min(last - d.lefts[d.from], raw))
    colEls.current.get(d.id)!.style.transform = `translate3d(${d.dx}px,0,0)`

    // Its slot: how many other lists have their middle left of the dragged list's middle.
    const mid = d.lefts[d.from] + d.dx + d.widths[d.from] / 2
    let target = 0
    d.order.forEach((_, i) => {
      if (i !== d.from && d.lefts[i] + d.widths[i] / 2 < mid) target++
    })
    if (target !== d.target) {
      d.target = target
      d.order.forEach((oid, i) => {
        if (i === d.from) return
        const j = i < d.from ? i : i - 1
        const shift = ((j < target ? j : j + 1) - i) * d.step
        d.shifts[i] = shift
        colEls.current.get(oid)!.style.transform = shift ? `translate3d(${shift}px,0,0)` : ''
      })
    }
    d.raf = requestAnimationFrame(colFrame)
  }

  const endColumnDrag = (commit: boolean) => {
    const d = colDragRef.current
    if (!d) return
    colDragRef.current = null
    if (!d.started) return
    cancelAnimationFrame(d.raf)
    document.body.classList.remove('dv-grabbing')
    window.removeEventListener('keydown', d.onKey, true)
    setColDragId(null)
    const drawnAt = new Map(
      d.order.map((id, i) => [id, d.lefts[i] + (i === d.from ? d.dx : d.shifts[i])]),
    )
    commitColumnMove(d.id, commit ? d.target : d.from, drawnAt)
  }

  const onColumnPointerDown = (e: React.PointerEvent<HTMLElement>, catId: string) => {
    // A press that never became a drag (released elsewhere) is simply replaced.
    if (e.button !== 0 || colDragRef.current?.started) return
    const target = e.target as HTMLElement
    // The header's own controls keep working; the grip is the exception, it's for dragging.
    if (target.closest('input, textarea, button:not([data-grip])')) return
    const box = colsRef.current
    if (!box) return
    const order = categoriesRef.current.map((c) => c.id)
    const els = order.map((id) => colEls.current.get(id)!)
    const from = order.indexOf(catId)
    if (from < 0 || els.some((el) => !el)) return
    const gap = parseFloat(getComputedStyle(box).columnGap) || 16
    colDragRef.current = {
      id: catId,
      pointerId: e.pointerId,
      startX: e.clientX,
      startY: e.clientY,
      startScroll: box.scrollLeft,
      x: e.clientX,
      started: false,
      order,
      from,
      lefts: els.map((el) => el.offsetLeft),
      widths: els.map((el) => el.offsetWidth),
      step: els[from].offsetWidth + gap,
      target: from,
      dx: 0,
      shifts: order.map(() => 0),
      raf: 0,
      // Escape puts the list back where it was.
      onKey: (k) => {
        if (k.key !== 'Escape') return
        k.preventDefault()
        k.stopPropagation()
        endColumnDrag(false)
      },
    }
  }

  const onColumnPointerMove = (e: React.PointerEvent<HTMLElement>) => {
    const d = colDragRef.current
    if (!d || d.pointerId !== e.pointerId) return
    d.x = e.clientX
    if (d.started) return
    // A small threshold, so clicks and double-click-to-rename still work.
    if (Math.hypot(e.clientX - d.startX, e.clientY - d.startY) < 5) return
    d.started = true
    e.currentTarget.setPointerCapture(e.pointerId)
    window.getSelection()?.removeAllRanges()
    document.body.classList.add('dv-grabbing')
    window.addEventListener('keydown', d.onKey, true)
    setColDragId(d.id)
    d.raf = requestAnimationFrame(colFrame)
  }

  const onColumnPointerUp = (e: React.PointerEvent<HTMLElement>) => {
    if (colDragRef.current?.pointerId === e.pointerId) endColumnDrag(true)
  }

  // Keyboard: arrow keys on a list's grip move it one place.
  const moveColumnBy = (catId: string, by: -1 | 1) => {
    const order = categoriesRef.current.map((c) => c.id)
    const from = order.indexOf(catId)
    const to = from + by
    if (from < 0 || to < 0 || to >= order.length) return
    const drawnAt = new Map(order.map((id) => [id, colEls.current.get(id)?.offsetLeft ?? 0]))
    commitColumnMove(catId, to, drawnAt)
    // React may re-insert the moved list's node, which drops focus; keep it on the grip.
    requestAnimationFrame(() => {
      const el = colEls.current.get(catId)
      el?.querySelector<HTMLElement>('[data-grip]')?.focus({ preventScroll: true })
      el?.scrollIntoView({ inline: 'nearest', block: 'nearest', behavior: 'smooth' })
    })
  }

  // ---------- derived ----------

  const q = query.trim().toLowerCase()
  const filterCount = activeFilterCount(filters)
  const filtering = !!q || filterCount > 0
  const matchesQuery = (t: Task) =>
    !q ||
    t.title.toLowerCase().includes(q) ||
    t.description.toLowerCase().includes(q) ||
    t.labelIds.some((id) => labelsById.get(id)?.name.toLowerCase().includes(q)) ||
    customFields.some((field) => {
      const value = t.customFields[field.id]
      const option = field.options.find((item) => item.value === value)
      return option?.label.toLowerCase().includes(q) ?? false
    })
  const matches = (t: Task) =>
    matchesQuery(t) &&
    matchesFilters(filters, t, isTaskDone(crossoffs, t), (field) => categoryValue(t, field))
  const totals = useMemo(() => {
    const all = categories.flatMap((c) => c.tasks)
    return { all: all.length, done: all.filter((t) => isTaskDone(crossoffs, t)).length }
  }, [categories, crossoffs])

  // ---------- render ----------

  if (loading) {
    return (
      <div className="flex h-full items-center justify-center">
        <p className="text-sm" style={{ color: 'var(--dv-muted)' }}>
          Loading board…
        </p>
      </div>
    )
  }

  const menuOptions = menu
    ? menu.kind === 'status'
      ? statusOptions
      : menu.kind === 'urgency'
        ? urgencyOptions
        : menu.kind === 'custom'
          ? (customFields.find((field) => field.id === menu.fieldId)?.options ?? [])
          : []
    : []
  const menuTask = menu
    ? categories.flatMap((c) => c.tasks).find((t) => t.id === menu.taskId)
    : null
  const openCard = (() => {
    if (!openCardId) return null
    for (const c of categories) {
      const task = c.tasks.find((t) => t.id === openCardId)
      if (task) return { task, list: c.name }
    }
    return null
  })()
  const menuCurrent = menuTask
    ? menu!.kind === 'status'
      ? menuTask.status
      : menu!.kind === 'urgency'
        ? menuTask.urgency
        : menu!.kind === 'due_date'
          ? menuTask.dueDate
          : menu!.kind === 'custom'
            ? (menuTask.customFields[menu!.fieldId ?? ''] ?? null)
            : null
    : null

  /** "Crossoff": opens the list of this category's statuses; the one picked crosses cards off. */
  const renderDoneButton = (field: string, name: string, options: { value: string }[]) => {
    const active = crossoffs.some((r) => r.field === field)
    return (
      <button
        type="button"
        className="dv-btn dv-done-btn !h-7"
        data-active={active}
        disabled={options.length === 0}
        aria-haspopup="menu"
        aria-pressed={active}
        title={
          active
            ? `${name} has a Crossoff. Click to change or turn it off.`
            : `Cross off cards when ${name} is set to a status you pick`
        }
        onClick={(e) => {
          const r = e.currentTarget.getBoundingClientRect()
          setDoneMenu({
            field,
            x: Math.min(r.left, window.innerWidth - 240),
            y: Math.min(r.bottom + 4, window.innerHeight - 320),
          })
        }}
      >
        <CircleCheck size={13} />
        Crossoff
        <ChevronDown size={12} aria-hidden />
      </button>
    )
  }

  /** Under a category with a Crossoff: which of its statuses greys out and crosses off a card. */
  const renderDoneNote = (field: string, options: TaskOption[]) => {
    const rule = crossoffs.find((r) => r.field === field)
    if (!rule) return null
    const option = options.find((o) => o.value === rule.value)
    return (
      <p className="dv-done-note">
        Cards are crossed off when set to
        {option ? (
          <span className="dv-chip !cursor-default" style={badgeStyle(option.color)}>
            <span className="dv-dot" style={{ background: option.color }} />
            {option.label}
          </span>
        ) : (
          <span style={{ color: 'var(--dv-danger)' }}>a status that no longer exists</span>
        )}
      </p>
    )
  }

  const renderDefaultOptions = (type: TaskOptionType, options: TaskOption[]) => (
    <div
      className="rounded-xl border p-3"
      style={{ borderColor: 'var(--dv-border)', background: 'var(--dv-panel-2)' }}
    >
      <div className="flex min-h-8 items-center justify-between gap-2">
        {editingDefaultFieldName?.type === type ? (
          <form
            className="flex min-w-0 flex-1 items-center gap-1.5"
            onSubmit={(e) => {
              e.preventDefault()
              saveDefaultFieldName()
            }}
          >
            <input
              autoFocus
              className="dv-input !h-8 min-w-0 flex-1"
              aria-label={`Edit ${type} category name`}
              maxLength={LIMITS.optionLabel}
              value={editingDefaultFieldName.name}
              onChange={(e) =>
                setEditingDefaultFieldName({ ...editingDefaultFieldName, name: e.target.value })
              }
            />
            <button className="dv-btn primary !h-8" disabled={!editingDefaultFieldName.name.trim()}>
              Save
            </button>
            <button
              type="button"
              className="dv-btn !h-8"
              onClick={() => setEditingDefaultFieldName(null)}
            >
              Cancel
            </button>
          </form>
        ) : (
          <button
            type="button"
            className="group flex min-w-0 items-center gap-1.5 text-left"
            title={`Edit ${defaultFieldConfig[type].name} category`}
            onClick={() =>
              setEditingDefaultFieldName({ type, name: defaultFieldConfig[type].name })
            }
          >
            <h3 className="m-0 truncate text-sm font-semibold">{defaultFieldConfig[type].name}</h3>
            <Pencil size={12} className="shrink-0 opacity-50 group-hover:opacity-100" aria-hidden />
          </button>
        )}
        <div className="flex items-center gap-1">
          <button
            className="dv-btn !h-7"
            onClick={() => setNewFieldOption({ fieldId: '', type, label: '', color: '#3b82f6' })}
          >
            <Plus size={13} />
            Add status
          </button>
          {renderDoneButton(type, defaultFieldConfig[type].name, options)}
          <button
            type="button"
            className="dv-iconbtn danger !h-7 !w-7"
            title={`Delete ${defaultFieldConfig[type].name}`}
            aria-label={`Delete ${defaultFieldConfig[type].name}`}
            onClick={() => setDefaultFieldToRemove(type)}
          >
            <Trash2 size={13} />
          </button>
        </div>
      </div>
      <div className="mt-2 flex flex-wrap gap-1.5">
        {options.map((option) =>
          editingDefaultOption?.type === type && editingDefaultOption.value === option.value ? (
            <form
              key={option.value}
              className="flex items-center gap-1"
              onSubmit={(e) => {
                e.preventDefault()
                saveDefaultOption()
              }}
            >
              <input
                autoFocus
                className="dv-input !h-7 w-32"
                aria-label={`Edit ${option.label} ${type} name`}
                maxLength={LIMITS.optionLabel}
                value={editingDefaultOption.label}
                onChange={(e) =>
                  setEditingDefaultOption({ ...editingDefaultOption, label: e.target.value })
                }
              />
              <input
                type="color"
                aria-label={`${option.label} ${type} color`}
                value={editingDefaultOption.color}
                onChange={(e) =>
                  setEditingDefaultOption({ ...editingDefaultOption, color: e.target.value })
                }
                className="h-7 w-9 cursor-pointer rounded border-0 bg-transparent"
              />
              <button className="dv-btn primary !h-7" disabled={!editingDefaultOption.label.trim()}>
                Save
              </button>
              <button
                type="button"
                className="dv-btn !h-7"
                onClick={() => setEditingDefaultOption(null)}
              >
                Cancel
              </button>
            </form>
          ) : (
            <span key={option.value} className="dv-chip" style={badgeStyle(option.color)}>
              <span className="dv-dot" style={{ background: option.color }} />
              {option.label}
              {defaultFieldConfig[type].defaultValue === option.value && (
                <span className="ml-1 text-[10px]">Default</span>
              )}
              <button
                type="button"
                className="ml-1 opacity-60 hover:opacity-100"
                title={`Edit ${option.label}`}
                aria-label={`Edit ${option.label} ${type}`}
                onClick={() =>
                  setEditingDefaultOption({
                    type,
                    value: option.value,
                    label: option.label,
                    color: option.color,
                  })
                }
              >
                <Pencil size={10} />
              </button>
              <button
                type="button"
                className="opacity-60 hover:opacity-100"
                title={`Delete ${option.label}`}
                aria-label={`Delete ${option.label} ${type}`}
                onClick={() => deleteOption(type, option)}
              >
                <X size={11} />
              </button>
            </span>
          ),
        )}
      </div>
      {renderDoneNote(type, options)}
      <label
        className="mt-3 flex items-center gap-2 text-xs font-medium"
        style={{ color: 'var(--dv-muted)' }}
      >
        Default status
        <select
          className="dv-input min-w-0 flex-1"
          aria-label={`${defaultFieldConfig[type].name} default status`}
          value={defaultFieldConfig[type].defaultValue}
          onChange={(e) => setDefaultFieldValue(type, e.target.value)}
        >
          {options.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>
      </label>
      {newFieldOption?.type === type && (
        <form
          className="mt-3 flex flex-wrap items-center gap-2"
          onSubmit={(e) => {
            e.preventDefault()
            addCustomFieldOption()
          }}
        >
          <input
            autoFocus
            className="dv-input min-w-0 flex-1"
            aria-label={`${defaultFieldConfig[type].name} status name`}
            placeholder="Status name"
            maxLength={LIMITS.optionLabel}
            value={newFieldOption.label}
            onChange={(e) => setNewFieldOption({ ...newFieldOption, label: e.target.value })}
          />
          <label className="flex items-center gap-1 text-xs" style={{ color: 'var(--dv-muted)' }}>
            Color
            <input
              type="color"
              aria-label={`${defaultFieldConfig[type].name} status color`}
              value={newFieldOption.color}
              onChange={(e) => setNewFieldOption({ ...newFieldOption, color: e.target.value })}
              className="h-7 w-9 cursor-pointer rounded border-0 bg-transparent"
            />
          </label>
          <button className="dv-btn primary" disabled={!newFieldOption.label.trim()}>
            Create
          </button>
          <button type="button" className="dv-btn" onClick={() => setNewFieldOption(null)}>
            Cancel
          </button>
        </form>
      )}
    </div>
  )

  return (
    <div
      className="flex h-full min-h-0 flex-col"
      onDrop={onDrop}
      onDragOver={(e) => e.preventDefault()}
    >
      {/* Toolbar */}
      <div className="flex shrink-0 items-center gap-3 px-6 pb-3 pt-4">
        <button
          className="dv-iconbtn shrink-0"
          title="Kanban settings"
          aria-label="Kanban settings"
          onClick={() => setSettingsOpen(true)}
        >
          <Settings2 size={15} />
        </button>
        <div className="relative w-72">
          <Search
            size={14}
            className="pointer-events-none absolute left-2.5 top-2.5"
            style={{ color: 'var(--dv-muted)' }}
          />
          <input
            ref={searchRef}
            className="dv-input"
            style={{ paddingLeft: 30, paddingRight: 30 }}
            placeholder="Search cards"
            aria-label="Search cards"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Escape') {
                setQuery('')
                e.currentTarget.blur()
              }
            }}
          />
          {query ? (
            <button
              className="absolute right-1.5 top-1.5 dv-iconbtn !h-6 !w-6"
              onClick={() => setQuery('')}
              title="Clear filter"
            >
              <X size={13} />
            </button>
          ) : (
            <span className="dv-kbd absolute right-2 top-[6px]">/</span>
          )}
        </div>
        <button
          className="dv-btn shrink-0"
          data-active={filterCount > 0}
          aria-haspopup="menu"
          aria-expanded={!!filterMenu}
          onClick={(e) => {
            const r = e.currentTarget.getBoundingClientRect()
            setFilterMenu(
              filterMenu ? null : { x: Math.min(r.left, window.innerWidth - 300), y: r.bottom + 6 },
            )
          }}
        >
          <ListFilter size={14} />
          Filter
          {filterCount > 0 && <span className="dv-count">{filterCount}</span>}
        </button>
        <span className="text-xs" style={{ color: 'var(--dv-muted)' }}>
          {totals.done} of {totals.all} done
        </span>
        <button
          className="dv-btn !h-8 ml-auto shrink-0"
          title="Archived cards and lists"
          onClick={() => setArchiveOpen(true)}
        >
          <Archive size={14} />
          Archive
          {archived.tasks.length + archived.lists.length > 0 && (
            <span className="dv-count muted">{archived.tasks.length + archived.lists.length}</span>
          )}
        </button>
        {error && (
          <button
            className="flex items-center gap-1.5 rounded-md px-2 py-1 text-xs"
            style={{
              background: 'color-mix(in srgb, var(--dv-danger) 14%, transparent)',
              color: 'var(--dv-danger)',
            }}
            onClick={() => setError(null)}
            title="Dismiss"
          >
            {error}
            <X size={12} />
          </button>
        )}
      </div>
      <ActiveFilters
        filters={filters}
        onChange={setFilters}
        labels={labels}
        people={assignees}
        userId={userId}
        fields={boardFields()}
        shown={categories.reduce((n, c) => n + c.tasks.filter(matches).length, 0)}
        total={totals.all}
      />

      {/* Columns */}
      <div
        ref={colsRef}
        className="dv-scroll dv-cols relative flex min-h-0 flex-1 items-start gap-4 overflow-x-auto px-6 pb-6"
        data-col-drag={colDragId !== null}
      >
        {categories.map((cat, catIndex) => {
          const visible = cat.tasks.filter(matches)
          const input = newTaskInputs[cat.id] || ''
          const isDropCol = dropAt?.cat === cat.id
          return (
            <section
              key={cat.id}
              ref={(el) => {
                if (el) colEls.current.set(cat.id, el)
                else colEls.current.delete(cat.id)
              }}
              className="dv-col"
              data-lifted={colDragId === cat.id}
              style={{
                width: colWidths[cat.id],
                ...(isDropCol && {
                  borderColor: 'var(--dv-accent-soft)',
                  background: 'color-mix(in srgb, var(--dv-accent) 6%, var(--dv-panel-2))',
                }),
              }}
              onDragOver={(e) => onColumnDragOver(e, cat)}
            >
              <div
                className="dv-col-resize"
                role="separator"
                aria-orientation="vertical"
                aria-label={`Resize ${cat.name}`}
                aria-valuemin={COL_WIDTH.min}
                aria-valuemax={COL_WIDTH.max}
                aria-valuenow={colWidths[cat.id] ?? COL_WIDTH.default}
                tabIndex={0}
                title="Drag to resize · double-click to reset"
                data-active={resizingId === cat.id}
                onPointerDown={(e) => {
                  if (e.button !== 0) return
                  e.preventDefault()
                  e.stopPropagation()
                  e.currentTarget.setPointerCapture(e.pointerId)
                  colResize.current = {
                    id: cat.id,
                    startX: e.clientX,
                    startW: colEls.current.get(cat.id)?.offsetWidth ?? COL_WIDTH.default,
                  }
                  setResizingId(cat.id)
                }}
                onPointerMove={(e) => {
                  const r = colResize.current
                  if (r) setColWidth(r.id, r.startW + e.clientX - r.startX)
                }}
                onLostPointerCapture={() => {
                  colResize.current = null
                  setResizingId(null)
                }}
                onDoubleClick={() => setColWidth(cat.id, null)}
                onKeyDown={(e) => {
                  const cur = colWidths[cat.id] ?? COL_WIDTH.default
                  if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
                    e.preventDefault()
                    setColWidth(cat.id, cur + (e.key === 'ArrowRight' ? 1 : -1) * COL_WIDTH.step)
                  }
                }}
              />
              <header
                className="dv-col-head group flex items-center gap-2 pb-2 pl-1.5 pr-3 pt-3"
                onPointerDown={(e) => onColumnPointerDown(e, cat.id)}
                onPointerMove={onColumnPointerMove}
                onPointerUp={onColumnPointerUp}
                onPointerCancel={() => endColumnDrag(false)}
                onLostPointerCapture={() => endColumnDrag(true)}
              >
                <button
                  type="button"
                  data-grip
                  className="dv-col-grip"
                  aria-label={`Move list ${cat.name}. Use the left and right arrow keys.`}
                  title="Drag to reorder (or focus and use ← →)"
                  disabled={categories.length < 2}
                  onKeyDown={(e) => {
                    if (e.key === 'ArrowLeft' && catIndex > 0) {
                      e.preventDefault()
                      moveColumnBy(cat.id, -1)
                    } else if (e.key === 'ArrowRight' && catIndex < categories.length - 1) {
                      e.preventDefault()
                      moveColumnBy(cat.id, 1)
                    }
                  }}
                >
                  <GripVertical size={14} aria-hidden />
                </button>
                {renamingCat?.id === cat.id ? (
                  <input
                    autoFocus
                    className="dv-input !h-7 font-semibold"
                    value={renamingCat.name}
                    onChange={(e) => setRenamingCat({ id: cat.id, name: e.target.value })}
                    onBlur={renameCategory}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') renameCategory()
                      if (e.key === 'Escape') setRenamingCat(null)
                    }}
                  />
                ) : (
                  <h2
                    className="min-w-0 flex-1 truncate text-[13.5px] font-semibold"
                    title="Double-click to rename"
                    onDoubleClick={() => setRenamingCat({ id: cat.id, name: cat.name })}
                  >
                    {cat.name}
                  </h2>
                )}
                <span className="text-xs tabular-nums" style={{ color: 'var(--dv-muted)' }}>
                  {filtering ? `${visible.length}/${cat.tasks.length}` : cat.tasks.length}
                </span>
                <button
                  className="dv-iconbtn !h-6 !w-6 opacity-0 group-hover:opacity-100 focus-visible:opacity-100"
                  onClick={() => archiveCategory(cat)}
                  title="Archive list"
                  aria-label={`Archive the list ${cat.name}`}
                >
                  <Archive size={13} />
                </button>
              </header>

              <div className="dv-scroll dv-card-list min-h-[44px] flex-1 overflow-y-auto px-2">
                {visible.map((task, index) => {
                  const status =
                    task.status && !defaultFieldConfig.status.deleted
                      ? resolveOption(statusOptions, task.status, 'status')
                      : null
                  const urgency =
                    task.urgency && !defaultFieldConfig.urgency.deleted
                      ? resolveOption(urgencyOptions, task.urgency, 'urgency')
                      : null
                  const done = isTaskDone(crossoffs, task)
                  const barColor = barColorOf(task)
                  const due = task.dueDate ? dueState(task.dueDate, done) : null
                  const cardLabels = task.labelIds
                    .map((id) => labelsById.get(id))
                    .filter((l): l is Label => !!l)
                  const cardMembers = task.memberIds
                    .map((id) => assigneesById.get(id))
                    .filter((p): p is TaskAssignee => !!p)
                  const shownCustom = customFields
                    .filter((field) => field.id in task.customFields)
                    .map((field) => ({
                      field,
                      selected: field.options.find((o) => o.value === task.customFields[field.id]),
                    }))
                  const progress = checklistProgress(task.checklists)
                  const comments = commentCounts.get(task.id) ?? 0
                  const hasBadges =
                    !!task.description ||
                    task.files.length > 0 ||
                    progress.total > 0 ||
                    comments > 0 ||
                    watched.has(task.id)
                  const editors = peersByTask.get(task.id)
                  return (
                    <div
                      key={task.id}
                      id={`task-${task.id}`}
                      className="relative pb-2"
                      onDragOver={(e) => {
                        if (e.dataTransfer.types.includes('Files')) {
                          e.preventDefault()
                          e.stopPropagation()
                          e.dataTransfer.dropEffect = 'copy'
                          setFileOverId(task.id)
                          return
                        }
                        onCardDragOver(e, cat.id, index)
                      }}
                      onDragLeave={() => setFileOverId((prev) => (prev === task.id ? null : prev))}
                      onDrop={(e) => {
                        if (e.dataTransfer.files.length) {
                          e.preventDefault()
                          e.stopPropagation()
                          setFileOverId(null)
                          addFiles(task.id, [...e.dataTransfer.files])
                        }
                      }}
                    >
                      {dropAt?.cat === cat.id && dropAt.index === index && (
                        <div className="dv-drop-line" />
                      )}
                      {editors && (
                        <div
                          className="dv-peer-edit"
                          style={{ '--peer': editors[0].color } as React.CSSProperties}
                        >
                          {editors.map((p) => (
                            <span key={p.id} style={{ background: p.color }}>
                              {p.name}
                            </span>
                          ))}
                        </div>
                      )}
                      <article
                        // Reordering a filtered list would put cards between hidden ones.
                        draggable={!filtering}
                        tabIndex={0}
                        aria-label={`${task.title}. Open card`}
                        data-dragging={dragId === task.id}
                        data-done={done}
                        className={`dv-card ${flashId === task.id ? 'dv-flash' : ''}`}
                        style={
                          fileOverId === task.id
                            ? {
                                borderColor: 'var(--dv-accent)',
                                boxShadow: '0 0 0 3px var(--dv-accent-soft)',
                              }
                            : undefined
                        }
                        onDragStart={(e) => {
                          e.dataTransfer.effectAllowed = 'move'
                          e.dataTransfer.setData('text/plain', task.id)
                          dragRef.current = { taskId: task.id }
                          const rect = e.currentTarget.getBoundingClientRect()
                          const previewScale = 0.88
                          const preview = e.currentTarget.cloneNode(true) as HTMLElement
                          preview.removeAttribute('id')
                          preview.removeAttribute('data-done')
                          preview.setAttribute('data-dragging', 'false')
                          Object.assign(preview.style, {
                            position: 'fixed',
                            top: '0',
                            left: '-10000px',
                            width: `${rect.width}px`,
                            pointerEvents: 'none',
                            transform: `scale(${previewScale})`,
                            transformOrigin: 'top left',
                            boxShadow: 'var(--dv-shadow-card)',
                          })
                          document.body.append(preview)
                          e.dataTransfer.setDragImage(
                            preview,
                            Math.round((e.clientX - rect.left) * previewScale),
                            Math.round((e.clientY - rect.top) * previewScale),
                          )
                          window.setTimeout(() => preview.remove(), 0)
                          cardDragRef.current = {
                            x: e.clientX,
                            y: e.clientY,
                            categoryId: cat.id,
                            raf: requestAnimationFrame(cardDragFrame),
                          }
                          setDragId(task.id)
                        }}
                        onDragEnd={endDrag}
                        onClick={(e) => {
                          // Chips and buttons on the card do their own thing.
                          if ((e.target as HTMLElement).closest('button, a, input')) return
                          setOpenCardId(task.id)
                        }}
                        onKeyDown={(e) => {
                          if (e.target === e.currentTarget && e.key === 'Enter')
                            setOpenCardId(task.id)
                        }}
                      >
                        <span
                          className="dv-card-bar"
                          style={{ background: barColor ?? 'var(--dv-border)' }}
                        />
                        <div className="dv-actions dv-card-float">
                          <button
                            className="dv-iconbtn !h-6 !w-6"
                            title={links.has(task.id) ? 'Focus on canvas' : 'Send to canvas'}
                            onClick={() =>
                              links.has(task.id) ? focusOnCanvas(task.id) : sendToCanvas(task.id)
                            }
                          >
                            {links.has(task.id) ? <Crosshair size={13} /> : <PenTool size={13} />}
                          </button>
                          <button
                            className="dv-iconbtn !h-6 !w-6"
                            title="Open card"
                            onClick={() => setOpenCardId(task.id)}
                          >
                            <Pencil size={13} />
                          </button>
                          <button
                            className="dv-iconbtn !h-6 !w-6"
                            title="Archive"
                            onClick={() => archiveTask(task.id)}
                          >
                            <Archive size={13} />
                          </button>
                        </div>
                        {task.cover && (
                          <div
                            className="dv-card-cover"
                            data-kind={'url' in task.cover ? 'image' : 'color'}
                            style={
                              'color' in task.cover ? { background: task.cover.color } : undefined
                            }
                          >
                            {'url' in task.cover && (
                              <img src={task.cover.url} alt="" draggable={false} loading="lazy" />
                            )}
                          </div>
                        )}
                        {cardLabels.length > 0 && (
                          <div className="dv-card-labels">
                            {cardLabels.map((l) => (
                              <span
                                key={l.id}
                                className="dv-label sm"
                                style={{ '--label': l.color } as React.CSSProperties}
                                title={l.name || 'Label'}
                              >
                                {l.name}
                              </span>
                            ))}
                          </div>
                        )}
                        <h3
                          className="text-[13.5px] font-medium leading-snug"
                          style={{
                            color: done ? 'var(--dv-muted)' : undefined,
                            textDecoration: done ? 'line-through' : undefined,
                          }}
                        >
                          {task.title}
                        </h3>
                        {(() => {
                          // Images as thumbnails (not the one already used as the cover), other files as chips.
                          const coverUrl = task.cover && 'url' in task.cover ? task.cover.url : null
                          const images = task.files.filter((f) => isImage(f) && f.url !== coverUrl)
                          const ordered = [
                            ...task.files.filter(isImage),
                            ...task.files.filter((f) => !isImage(f)),
                          ]
                          if (!images.length) return null
                          return (
                            <div className="mt-2 flex flex-col gap-1.5">
                              {images.slice(0, 2).map((f) => (
                                <button
                                  key={f.url}
                                  className="flex justify-center overflow-hidden rounded-md border"
                                  style={{
                                    borderColor: 'var(--dv-border)',
                                    background: 'var(--dv-panel-2)',
                                  }}
                                  title="View image"
                                  onClick={() =>
                                    setViewer({ files: ordered, index: ordered.indexOf(f) })
                                  }
                                >
                                  <img
                                    src={f.url}
                                    alt=""
                                    draggable={false}
                                    loading="lazy"
                                    className="block h-auto max-h-60 w-auto max-w-full object-contain"
                                  />
                                </button>
                              ))}
                            </div>
                          )
                        })()}
                        {uploadingId === task.id && (
                          <p className="mt-1.5 text-[11px]" style={{ color: 'var(--dv-muted)' }}>
                            Uploading…
                          </p>
                        )}
                        {(status || urgency || shownCustom.length > 0 || task.dueDate) && (
                          <div className="mt-2.5 flex flex-wrap items-center gap-1.5">
                            {status && (
                              <button
                                className="dv-chip"
                                style={badgeStyle(status.color)}
                                title={`Change ${defaultFieldConfig.status.name}`}
                                onClick={(e) => openMenu(e, 'status', task.id, cat.id)}
                              >
                                <span className="dv-dot" style={{ background: status.color }} />
                                {status.label}
                              </button>
                            )}
                            {urgency && (
                              <button
                                className="dv-chip"
                                style={badgeStyle(urgency.color)}
                                title={`Change ${defaultFieldConfig.urgency.name}`}
                                onClick={(e) => openMenu(e, 'urgency', task.id, cat.id)}
                              >
                                {urgency.label}
                              </button>
                            )}
                            {shownCustom.map(({ field, selected }) => (
                              <button
                                key={field.id}
                                className="dv-chip"
                                style={
                                  selected
                                    ? badgeStyle(selected.color)
                                    : { background: 'var(--dv-panel-2)', color: 'var(--dv-muted)' }
                                }
                                title={`Change ${field.name}`}
                                onClick={(e) => openMenu(e, 'custom', task.id, cat.id, field.id)}
                              >
                                {selected ? (
                                  <>
                                    <span
                                      className="dv-dot"
                                      style={{ background: selected.color }}
                                    />
                                    {selected.label}
                                  </>
                                ) : (
                                  field.name
                                )}
                              </button>
                            ))}
                            {task.dueDate && due && (
                              <button
                                className="dv-chip dv-due"
                                data-state={due}
                                title={dueTitle(task.dueDate, due)}
                                onClick={(e) => openMenu(e, 'due_date', task.id, cat.id)}
                              >
                                <CalendarDays size={12} />
                                {dueLabel(task.dueDate)}
                              </button>
                            )}
                          </div>
                        )}
                        {(hasBadges || cardMembers.length > 0) && (
                          <div className="dv-card-foot">
                            <CardBadges
                              description={!!task.description}
                              files={task.files.length}
                              checklist={progress}
                              comments={comments}
                              watching={watched.has(task.id)}
                            />
                            {cardMembers.length > 0 && (
                              <button
                                className="dv-card-members"
                                title={`Members: ${cardMembers.map((p) => p.name).join(', ')}`}
                                onClick={(e) => openMenu(e, 'assignee', task.id, cat.id)}
                              >
                                {cardMembers.slice(0, 3).map((p) => (
                                  <Avatar
                                    key={p.id}
                                    name={p.name}
                                    color={colorFor(p.id)}
                                    src={p.avatarUrl}
                                    size={22}
                                  />
                                ))}
                                {cardMembers.length > 3 && (
                                  <span className="dv-card-members-more">
                                    +{cardMembers.length - 3}
                                  </span>
                                )}
                              </button>
                            )}
                          </div>
                        )}
                        {links.has(task.id) && (
                          <button
                            className="mt-2 flex w-full items-center gap-1.5 rounded-md px-2 py-1 text-[11.5px] font-medium"
                            style={{
                              background: 'var(--dv-accent-soft)',
                              color: 'var(--dv-accent)',
                            }}
                            title="Zoom the canvas to this task and everything linked to it"
                            onClick={() => focusOnCanvas(task.id)}
                          >
                            <PenTool size={12} />
                            On canvas · {links.get(task.id)} linked
                            <span className="ml-auto">Focus →</span>
                          </button>
                        )}
                      </article>
                    </div>
                  )
                })}
                {dropAt?.cat === cat.id && dropAt.index >= visible.length && (
                  <div className="dv-drop-line" />
                )}
                {visible.length === 0 && (
                  <p className="px-1 py-4 text-center text-xs" style={{ color: 'var(--dv-muted)' }}>
                    {filtering ? 'No matching cards' : 'Nothing here yet'}
                  </p>
                )}
              </div>

              <div className="p-2">
                <div className="flex gap-1.5">
                  <input
                    className="dv-input"
                    placeholder="Add a task"
                    value={input}
                    onChange={(e) => setNewTaskInputs((p) => ({ ...p, [cat.id]: e.target.value }))}
                    onKeyDown={(e) => e.key === 'Enter' && addTask(cat.id)}
                  />
                  <button
                    className="dv-iconbtn shrink-0"
                    style={{ background: 'var(--dv-panel)', border: '1px solid var(--dv-border)' }}
                    disabled={!input.trim()}
                    onClick={() => addTask(cat.id)}
                    title="Add task"
                  >
                    <Plus size={15} />
                  </button>
                </div>
              </div>
            </section>
          )
        })}

        {/* Add list */}
        <div className="w-[304px] shrink-0">
          {addingList ? (
            <div className="dv-col !max-h-none gap-2 p-2">
              <input
                autoFocus
                className="dv-input"
                placeholder="List name"
                value={newListName}
                onChange={(e) => setNewListName(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') addCategory()
                  if (e.key === 'Escape') {
                    setAddingList(false)
                    setNewListName('')
                  }
                }}
              />
              <div className="flex gap-2">
                <button
                  className="dv-btn primary"
                  disabled={!newListName.trim()}
                  onClick={addCategory}
                >
                  Add list
                </button>
                <button
                  className="dv-btn"
                  onClick={() => {
                    setAddingList(false)
                    setNewListName('')
                  }}
                >
                  Cancel
                </button>
              </div>
            </div>
          ) : (
            <button
              className="flex h-11 w-full items-center gap-2 rounded-[14px] border border-dashed px-4 text-[13px] font-medium"
              style={{
                borderColor: 'var(--dv-border)',
                color: 'var(--dv-muted)',
                background: 'transparent',
              }}
              onClick={() => setAddingList(true)}
            >
              <Plus size={15} />
              Add list
            </button>
          )}
        </div>
      </div>

      <input
        ref={fileInputRef}
        type="file"
        multiple
        className="hidden"
        onChange={(e) => {
          const id = uploadTarget.current
          if (id && e.target.files) addFiles(id, [...e.target.files])
          e.target.value = ''
        }}
      />

      {viewer && (
        <FileViewer
          files={viewer.files}
          index={viewer.index}
          onIndex={(index) => setViewer((v) => v && { ...v, index })}
          onClose={() => setViewer(null)}
        />
      )}

      {settingsOpen && (
        <div
          className="dv-modal-backdrop z-[70]"
          onMouseDown={(e) => {
            if (e.target === e.currentTarget) setSettingsOpen(false)
          }}
        >
          <section
            className="dv-floating dv-modal"
            role="dialog"
            aria-modal="true"
            aria-labelledby="kanban-settings-title"
          >
            <div className="flex items-start justify-between gap-4">
              <div>
                <h2 id="kanban-settings-title" className="m-0 text-lg font-semibold">
                  Kanban settings
                </h2>
                <p className="mt-1 text-xs" style={{ color: 'var(--dv-muted)' }}>
                  Manage categories and edit their statuses, colors, and defaults.
                </p>
              </div>
              <button
                className="dv-iconbtn !h-7 !w-7"
                aria-label="Close kanban settings"
                onClick={() => setSettingsOpen(false)}
              >
                <X size={14} />
              </button>
            </div>

            <div className="dv-settings-row">
              <div className="min-w-0 flex-1">
                <div className="text-sm font-medium">Card color</div>
                <div className="text-xs" style={{ color: 'var(--dv-muted)' }}>
                  The stripe on the left of each card takes the color of this category’s status.
                </div>
              </div>
              <button
                type="button"
                className="dv-btn shrink-0"
                aria-haspopup="menu"
                aria-expanded={!!colorMenu}
                onClick={(e) => {
                  const r = e.currentTarget.getBoundingClientRect()
                  setColorMenu({
                    x: Math.min(r.right - 248, window.innerWidth - 256),
                    y: Math.min(r.bottom + 4, window.innerHeight - 320),
                  })
                }}
              >
                <Palette size={14} />
                Color
                <span className="dv-color-current">
                  {boardFields().find((f) => f.field === boardSettings.colorField)?.name ?? 'None'}
                </span>
                <ChevronDown size={12} aria-hidden />
              </button>
            </div>

            <form
              className="flex gap-2"
              onSubmit={(e) => {
                e.preventDefault()
                addCustomField()
              }}
            >
              <input
                className="dv-input"
                aria-label="Category name"
                placeholder="Category (e.g. Difficulty)"
                maxLength={LIMITS.optionLabel}
                value={newFieldName}
                onChange={(e) => setNewFieldName(e.target.value)}
              />
              <button className="dv-btn primary shrink-0" disabled={!newFieldName.trim()}>
                <Plus size={14} />
                Add
              </button>
            </form>

            <div className="dv-scroll flex max-h-[45vh] flex-col gap-3 overflow-y-auto">
              {(['status', 'urgency'] as const).map((type) =>
                defaultFieldConfig[type].deleted ? (
                  <button
                    key={type}
                    className="dv-btn self-start"
                    onClick={() => restoreDefaultField(type)}
                  >
                    <Plus size={13} />
                    Restore {defaultFieldConfig[type].name}
                  </button>
                ) : (
                  <div key={type}>
                    {renderDefaultOptions(type, type === 'status' ? statusOptions : urgencyOptions)}
                  </div>
                ),
              )}
              {customFields.map((field) => (
                <div
                  key={field.id}
                  className="rounded-xl border p-3"
                  style={{ borderColor: 'var(--dv-border)', background: 'var(--dv-panel-2)' }}
                >
                  <div className="flex items-center justify-between gap-2">
                    {editingFieldName?.id === field.id ? (
                      <form
                        className="flex min-w-0 flex-1 items-center gap-1.5"
                        onSubmit={(e) => {
                          e.preventDefault()
                          saveCustomFieldName()
                        }}
                      >
                        <input
                          autoFocus
                          className="dv-input !h-8"
                          aria-label="Edit category name"
                          maxLength={LIMITS.optionLabel}
                          value={editingFieldName.name}
                          onChange={(e) =>
                            setEditingFieldName({ ...editingFieldName, name: e.target.value })
                          }
                        />
                        <button
                          className="dv-btn primary !h-8"
                          disabled={!editingFieldName.name.trim()}
                        >
                          Save
                        </button>
                        <button
                          type="button"
                          className="dv-btn !h-8"
                          onClick={() => setEditingFieldName(null)}
                        >
                          Cancel
                        </button>
                      </form>
                    ) : (
                      <button
                        type="button"
                        className="group flex min-w-0 items-center gap-1.5 text-left"
                        title={`Edit ${field.name}`}
                        onClick={() => setEditingFieldName({ id: field.id, name: field.name })}
                      >
                        <h3 className="m-0 truncate text-sm font-semibold">{field.name}</h3>
                        <Pencil
                          size={12}
                          className="shrink-0 opacity-50 group-hover:opacity-100"
                          aria-hidden
                        />
                      </button>
                    )}
                    <div className="flex items-center gap-1">
                      <button
                        className="dv-btn !h-7"
                        onClick={() =>
                          setNewFieldOption({ fieldId: field.id, label: '', color: '#3b82f6' })
                        }
                      >
                        <Plus size={13} />
                        Add status
                      </button>
                      {renderDoneButton(field.id, field.name, field.options)}
                      <button
                        className="dv-iconbtn danger !h-7 !w-7"
                        title={`Remove ${field.name}`}
                        aria-label={`Remove ${field.name}`}
                        onClick={() => setFieldToRemove(field)}
                      >
                        <Trash2 size={13} />
                      </button>
                    </div>
                  </div>
                  <div className="mt-2 flex flex-wrap gap-1.5">
                    {field.options.map((option) =>
                      editingOptionLabel?.optionId === option.id ? (
                        <form
                          key={option.id}
                          className="flex items-center gap-1"
                          onSubmit={(e) => {
                            e.preventDefault()
                            saveCustomOptionLabel()
                          }}
                        >
                          <input
                            autoFocus
                            className="dv-input !h-7 w-32"
                            aria-label="Edit status name"
                            maxLength={LIMITS.optionLabel}
                            value={editingOptionLabel.label}
                            onChange={(e) =>
                              setEditingOptionLabel({
                                ...editingOptionLabel,
                                label: e.target.value,
                              })
                            }
                          />
                          <input
                            type="color"
                            aria-label={`${option.label} status color`}
                            value={editingOptionLabel.color}
                            onChange={(e) =>
                              setEditingOptionLabel({
                                ...editingOptionLabel,
                                color: e.target.value,
                              })
                            }
                            className="h-7 w-9 cursor-pointer rounded border-0 bg-transparent"
                          />
                          <button
                            className="dv-btn primary !h-7"
                            disabled={!editingOptionLabel.label.trim()}
                          >
                            Save
                          </button>
                          <button
                            type="button"
                            className="dv-btn !h-7"
                            onClick={() => setEditingOptionLabel(null)}
                          >
                            Cancel
                          </button>
                        </form>
                      ) : (
                        <span key={option.id} className="dv-chip" style={badgeStyle(option.color)}>
                          <span className="dv-dot" style={{ background: option.color }} />
                          {option.label}
                          {(field.defaultValue ?? field.options[0]?.value) === option.value && (
                            <span className="ml-1 text-[10px]">Default</span>
                          )}
                          <button
                            type="button"
                            className="ml-1 opacity-60 hover:opacity-100"
                            title={`Edit ${option.label}`}
                            aria-label={`Edit ${option.label} status`}
                            onClick={() =>
                              setEditingOptionLabel({
                                fieldId: field.id,
                                optionId: option.id,
                                label: option.label,
                                color: option.color,
                              })
                            }
                          >
                            <Pencil size={10} />
                          </button>
                          <button
                            type="button"
                            className="opacity-60 hover:opacity-100"
                            title={`Delete ${option.label}`}
                            aria-label={`Delete ${option.label} status`}
                            onClick={() => deleteOption(field, { ...option, type: 'status' })}
                          >
                            <X size={11} />
                          </button>
                        </span>
                      ),
                    )}
                    {field.options.length === 0 && (
                      <span className="text-xs" style={{ color: 'var(--dv-muted)' }}>
                        Add a status before assigning this category to tasks.
                      </span>
                    )}
                  </div>
                  {renderDoneNote(
                    field.id,
                    field.options.map((o) => ({ ...o, type: 'status' as const })),
                  )}
                  <label
                    className="mt-3 flex items-center gap-2 text-xs font-medium"
                    style={{ color: 'var(--dv-muted)' }}
                  >
                    Default status
                    <select
                      className="dv-input min-w-0 flex-1"
                      aria-label={`${field.name} default status`}
                      value={field.defaultValue ?? field.options[0]?.value ?? ''}
                      disabled={field.options.length === 0}
                      onChange={(e) => setCustomFieldDefault(field, e.target.value)}
                    >
                      {field.options.length === 0 ? (
                        <option value="">Add a status first</option>
                      ) : (
                        field.options.map((option) => (
                          <option key={option.id} value={option.value}>
                            {option.label}
                          </option>
                        ))
                      )}
                    </select>
                  </label>
                  {newFieldOption?.fieldId === field.id && (
                    <form
                      className="mt-3 flex flex-wrap items-center gap-2"
                      onSubmit={(e) => {
                        e.preventDefault()
                        addCustomFieldOption()
                      }}
                    >
                      <input
                        autoFocus
                        className="dv-input min-w-0 flex-1"
                        aria-label={`${field.name} status name`}
                        placeholder="Status name"
                        maxLength={LIMITS.optionLabel}
                        value={newFieldOption.label}
                        onChange={(e) =>
                          setNewFieldOption({ ...newFieldOption, label: e.target.value })
                        }
                      />
                      <label
                        className="flex items-center gap-1 text-xs"
                        style={{ color: 'var(--dv-muted)' }}
                      >
                        Color
                        <input
                          type="color"
                          aria-label={`${field.name} status color`}
                          value={newFieldOption.color}
                          onChange={(e) =>
                            setNewFieldOption({ ...newFieldOption, color: e.target.value })
                          }
                          className="h-7 w-9 cursor-pointer rounded border-0 bg-transparent"
                        />
                      </label>
                      <button className="dv-btn primary" disabled={!newFieldOption.label.trim()}>
                        Create
                      </button>
                      <button
                        type="button"
                        className="dv-btn"
                        onClick={() => setNewFieldOption(null)}
                      >
                        Cancel
                      </button>
                    </form>
                  )}
                </div>
              ))}
              {customFields.length === 0 && (
                <p className="m-0 py-4 text-center text-sm" style={{ color: 'var(--dv-muted)' }}>
                  No custom categories yet.
                </p>
              )}
            </div>
          </section>
        </div>
      )}

      {fieldToRemove && (
        <div
          className="dv-modal-backdrop z-[80]"
          onPointerDown={(e) => {
            if (e.target === e.currentTarget) setFieldToRemove(null)
          }}
        >
          <section
            className="dv-floating dv-modal"
            role="alertdialog"
            aria-modal="true"
            aria-labelledby="remove-custom-field-title"
            aria-describedby="remove-custom-field-description"
          >
            <div>
              <h2 id="remove-custom-field-title" className="m-0 text-lg font-semibold">
                Remove category?
              </h2>
              <p
                id="remove-custom-field-description"
                className="mt-2 text-sm"
                style={{ color: 'var(--dv-muted)' }}
              >
                Remove “{fieldToRemove.name}”? Its statuses and values on all tasks will be deleted.
              </p>
            </div>
            <div className="flex justify-end gap-2">
              <button className="dv-btn" onClick={() => setFieldToRemove(null)}>
                Cancel
              </button>
              <button className="dv-btn danger" onClick={() => removeCustomField(fieldToRemove)}>
                Remove category
              </button>
            </div>
          </section>
        </div>
      )}

      {defaultFieldToRemove && (
        <div
          className="dv-modal-backdrop z-[80]"
          onPointerDown={(e) => {
            if (e.target === e.currentTarget) setDefaultFieldToRemove(null)
          }}
        >
          <section
            className="dv-floating dv-modal"
            role="alertdialog"
            aria-modal="true"
            aria-labelledby="remove-default-category-title"
          >
            <div>
              <h2 id="remove-default-category-title" className="m-0 text-lg font-semibold">
                Remove category?
              </h2>
              <p className="mt-2 text-sm" style={{ color: 'var(--dv-muted)' }}>
                Remove “{defaultFieldConfig[defaultFieldToRemove].name}” from task cards? Its task
                values will be kept if you restore the category later.
              </p>
            </div>
            <div className="flex justify-end gap-2">
              <button className="dv-btn" onClick={() => setDefaultFieldToRemove(null)}>
                Cancel
              </button>
              <button
                className="dv-btn danger"
                onClick={() => removeDefaultField(defaultFieldToRemove)}
              >
                Remove category
              </button>
            </div>
          </section>
        </div>
      )}

      {/* Card detail */}
      {openCard && (
        <CardDetail
          key={openCard.task.id}
          task={openCard.task}
          listName={openCard.list}
          done={isTaskDone(crossoffs, openCard.task)}
          crossoffs={crossoffs}
          fields={boardFields()}
          defaultValueOf={defaultValueOf}
          labels={labels}
          people={assignees}
          userId={userId}
          authorId={user?.id ?? null}
          watching={watched.has(openCard.task.id)}
          onToggleWatch={() => toggleWatch(openCard.task.id)}
          onPatch={(patch) => patchTask(openCard.task.id, patch)}
          onArchive={() => archiveTask(openCard.task.id)}
          onPickFiles={() => pickFiles(openCard.task.id)}
          onPasteFiles={(files) => addFiles(openCard.task.id, files)}
          onRemoveFile={(url) => removeFile(openCard.task.id, url)}
          onOpenFile={(files, index) => setViewer({ files, index })}
          onSendToCanvas={() => {
            const id = openCard.task.id
            setOpenCardId(null)
            if (links.has(id)) focusOnCanvas(id)
            else sendToCanvas(id)
          }}
          onCreateLabel={createLabel}
          onUpdateLabel={updateLabel}
          onDeleteLabel={deleteLabel}
          onCommentCount={setOpenCardCommentCount}
          onClose={() => setOpenCardId(null)}
        />
      )}

      {archiveOpen && (
        <ArchivePanel
          cards={archived.tasks.map((t) => {
            const list =
              categories.find((c) => c.id === t.category_id) ??
              archived.lists.find((l) => l.id === t.category_id)
            return {
              id: t.id,
              title: t.title,
              listName: list?.name ?? 'a deleted list',
              listArchived: archived.lists.some((l) => l.id === t.category_id),
              archivedAt: t.archived_at ?? '',
            }
          })}
          lists={archived.lists.map((l) => ({
            id: l.id,
            name: l.name,
            cards: archived.tasks.filter((t) => t.category_id === l.id).length,
            archivedAt: l.archived_at ?? '',
          }))}
          onRestoreCard={restoreTask}
          onDeleteCard={deleteTaskForever}
          onRestoreList={restoreCategory}
          onDeleteList={deleteCategoryForever}
          onClose={() => setArchiveOpen(false)}
        />
      )}

      {filterMenu && (
        <>
          <div className="fixed inset-0 z-40" onPointerDown={() => setFilterMenu(null)} />
          <div
            className="dv-menu fixed z-50 w-[288px]"
            role="menu"
            aria-label="Filter cards"
            style={{ left: filterMenu.x, top: filterMenu.y }}
          >
            <FilterMenu
              filters={filters}
              onChange={setFilters}
              labels={labels}
              people={assignees}
              userId={userId}
              fields={boardFields()}
              doneLabel={crossoffs
                .map((r) => {
                  const f = boardFields().find((x) => x.field === r.field)
                  const o = f?.options.find((x) => x.value === r.value)
                  return f && o ? o.label : ''
                })
                .filter(Boolean)
                .join(', ')}
            />
          </div>
        </>
      )}

      {/* "Color" picker: which category colours the card stripe (above the settings dialog) */}
      {colorMenu && (
        <>
          <div className="fixed inset-0 z-[90]" onPointerDown={() => setColorMenu(null)} />
          <div
            className="dv-menu fixed z-[91]"
            role="menu"
            aria-label="Card color"
            style={{ left: colorMenu.x, top: colorMenu.y, width: 248 }}
          >
            <div className="dv-menu-head">Color each card’s stripe by…</div>
            {boardFields().map((f) => {
              const current = boardSettings.colorField === f.field
              return (
                <button
                  key={f.field}
                  role="menuitemradio"
                  aria-checked={current}
                  className="dv-menu-item"
                  data-selected={current}
                  onClick={() => saveColorField(f.field)}
                >
                  <span className="dv-color-preview" aria-hidden>
                    {f.options.slice(0, 5).map((o) => (
                      <span key={o.value} style={{ background: o.color }} />
                    ))}
                  </span>
                  <span className="flex-1 truncate">{f.name}</span>
                  {current && <Check size={14} />}
                </button>
              )
            })}
            <div className="dv-menu-sep" />
            <button
              role="menuitemradio"
              aria-checked={boardSettings.colorField === null}
              className="dv-menu-item"
              data-selected={boardSettings.colorField === null}
              onClick={() => saveColorField(null)}
            >
              <span className="dv-color-preview" aria-hidden>
                <span style={{ background: 'var(--dv-border)' }} />
              </span>
              <span className="flex-1">None</span>
              {boardSettings.colorField === null && <Check size={14} />}
            </button>
            <p className="m-0 px-2 pb-1.5 pt-1 text-[11px]" style={{ color: 'var(--dv-muted)' }}>
              Cards without that category get a plain stripe.
            </p>
          </div>
        </>
      )}

      {/* "Crossoff" status picker (above the settings dialog) */}
      {doneMenu &&
        (() => {
          const field = boardFields().find((f) => f.field === doneMenu.field)
          if (!field) return null
          return (
            <>
              <div className="fixed inset-0 z-[90]" onPointerDown={() => setDoneMenu(null)} />
              <div
                className="dv-menu fixed z-[91] w-60"
                role="menu"
                style={{ left: doneMenu.x, top: doneMenu.y }}
              >
                <div
                  className="px-2 pb-1 pt-1.5 text-xs font-semibold"
                  style={{ color: 'var(--dv-muted)' }}
                >
                  Cross off cards when {field.name} is…
                </div>
                {(() => {
                  const currentValue = crossoffs.find((r) => r.field === field.field)?.value ?? null
                  return (
                    <>
                      {field.options.map((o) => {
                        const current = currentValue === o.value
                        return (
                          <button
                            key={o.value}
                            role="menuitemradio"
                            aria-checked={current}
                            className="dv-menu-item"
                            data-selected={current}
                            onClick={() => saveCrossoff(field.field, o.value)}
                          >
                            <span className="dv-dot" style={{ background: o.color }} />
                            <span className="flex-1 truncate">{o.label}</span>
                            {current && (
                              <CircleCheck size={14} style={{ color: 'var(--dv-accent)' }} />
                            )}
                          </button>
                        )
                      })}
                      {currentValue !== null && (
                        <>
                          <div className="dv-menu-sep" />
                          <button
                            className="dv-menu-item"
                            role="menuitemradio"
                            aria-checked={false}
                            onClick={() => saveCrossoff(field.field, null)}
                          >
                            <X size={14} />
                            No Crossoff for {field.name}
                          </button>
                        </>
                      )}
                    </>
                  )
                })()}
                <p
                  className="m-0 px-2 pb-1.5 pt-1 text-[11px]"
                  style={{ color: 'var(--dv-muted)' }}
                >
                  Each category can have its own Crossoff. A card is crossed off when any of them
                  matches.
                </p>
              </div>
            </>
          )
        })()}

      {/* Task fields menu (fixed so column scrolling can't clip it) */}
      {menu && (
        <>
          <div
            className="fixed inset-0 z-40"
            onPointerDown={() => {
              setMenu(null)
            }}
          />
          <div className="dv-menu fixed z-50 w-56" style={{ left: menu.x, top: menu.y }}>
            {menu.kind === 'due_date' ? (
              <div className="flex flex-col gap-2 p-2">
                <span className="px-1 text-xs font-semibold" style={{ color: 'var(--dv-muted)' }}>
                  Set due date
                </span>
                <input
                  autoFocus
                  type="date"
                  className="dv-input"
                  aria-label="Due date"
                  value={menuTask?.dueDate ?? ''}
                  onClick={(e) => e.currentTarget.showPicker?.()}
                  onChange={(e) => pickDueDate(e.target.value)}
                />
                {menuTask?.dueDate && (
                  <button className="dv-menu-item" onClick={() => pickDueDate('')}>
                    <X size={13} />
                    Clear due date
                  </button>
                )}
              </div>
            ) : menu.kind === 'assignee' ? (
              <div className="max-h-72 overflow-y-auto py-1">
                <div
                  className="px-2 pb-1 pt-1.5 text-xs font-semibold"
                  style={{ color: 'var(--dv-muted)' }}
                >
                  Members
                </div>
                {assignees.map((person) => {
                  const on = !!menuTask?.memberIds.includes(person.id)
                  return (
                    <button
                      key={person.id}
                      className="dv-menu-item"
                      role="menuitemcheckbox"
                      aria-checked={on}
                      data-selected={on}
                      onClick={() => pick(person.id)}
                    >
                      <Avatar
                        name={person.name}
                        color={colorFor(person.id)}
                        src={person.avatarUrl}
                        size={20}
                      />
                      <span className="flex-1 truncate">
                        {person.name}
                        {person.id === userId && ' (you)'}
                      </span>
                      {on && <Check size={14} />}
                    </button>
                  )
                })}
                {assignees.length === 0 && (
                  <p className="m-0 px-3 py-2 text-xs" style={{ color: 'var(--dv-muted)' }}>
                    No signed-in people have been on this board yet.
                  </p>
                )}
              </div>
            ) : (
              <>
                <div
                  className="px-2 pb-1 pt-1.5 text-xs font-semibold"
                  style={{ color: 'var(--dv-muted)' }}
                >
                  {menu.kind === 'status'
                    ? `Set ${defaultFieldConfig.status.name.toLowerCase()}`
                    : menu.kind === 'urgency'
                      ? `Set ${defaultFieldConfig.urgency.name.toLowerCase()}`
                      : customFields.find((field) => field.id === menu.fieldId)?.name}
                </div>
                {menuOptions.map((o) => (
                  <button
                    key={o.value}
                    className="dv-menu-item"
                    data-selected={menuCurrent === o.value}
                    onClick={() => pick(o.value)}
                  >
                    <span className="dv-dot" style={{ background: o.color }} />
                    <span className="flex-1">{o.label}</span>
                    {menuCurrent === o.value && (
                      <span className="text-[11px]" style={{ color: 'var(--dv-muted)' }}>
                        Current
                      </span>
                    )}
                  </button>
                ))}
              </>
            )}
          </div>
        </>
      )}
    </div>
  )
}
