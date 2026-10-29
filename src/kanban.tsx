import React, { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import {
  CalendarDays,
  Crosshair,
  GripVertical,
  Paperclip,
  Pencil,
  PenTool,
  Plus,
  Search,
  Settings2,
  Trash2,
  UserRound,
  X,
} from 'lucide-react'
import { supabase } from './lib/supabase'
import { colorFor, useRoom } from './lib/room'
import { bus, getLinkCounts, isTyping, toast } from './lib/bus'
import { type Attachment, cleanAttachment, isImageFile, taskFiles, uploadRoomFile } from './lib/files'
import { Avatar } from './avatar'
import {
  formatDueDate,
  loadRoomTaskAssignees,
  type TaskAssignee,
} from './lib/tasks'
import { LIMITS, cleanHexColor, cleanLine, cleanMultiline } from './lib/sanitize'
import { FileChip, FileIcon, FileViewer } from './file-viewer'
import {
  DEFAULT_STATUS,
  DEFAULT_URGENCY,
  type TaskOption,
  type TaskOptionType,
  badgeStyle,
  resolveOption,
  rowToOption,
  slugify,
  splitCustom,
} from './lib/options'

type DbCategory = { id: string; name: string; position: number | null }
type DbTask = {
  id: string
  title: string
  description: string | null
  status: string
  urgency?: string | null
  images?: unknown
  attachments?: unknown
  category_id: string
  position: number | null
  due_date?: string | null
  assignee_id?: string | null
  custom_fields?: Record<string, unknown> | null
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
  status: string
  urgency: string
  files: Attachment[]
  categoryId: string
  position: number
  dueDate: string | null
  assigneeId: string | null
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
  status: t.status,
  urgency: t.urgency ?? 'medium',
  files: taskFiles(t),
  categoryId: t.category_id,
  position: t.position ?? 0,
  dueDate: t.due_date ?? null,
  assigneeId: t.assignee_id ?? null,
  customFields: Object.fromEntries(
    Object.entries(t.custom_fields ?? {}).filter(
      (entry): entry is [string, string] => typeof entry[1] === 'string',
    ),
  ),
})

/** Completed tasks sink to the bottom of their list; order is otherwise kept. */
const sinkDone = (tasks: Task[]): Task[] => [
  ...tasks.filter((t) => t.status !== 'completed'),
  ...tasks.filter((t) => t.status === 'completed'),
]

const buildBoard = (categories: DbCategory[], tasks: DbTask[]): Category[] => {
  const cats = [...categories].sort((a, b) => (a.position ?? 0) - (b.position ?? 0))
  const buckets = new Map<string, Task[]>(cats.map((c) => [c.id, []]))
  tasks
    .map(mapTask)
    .sort((a, b) => a.position - b.position)
    .forEach((t) => buckets.get(t.categoryId)?.push(t))
  return cats.map((c) => ({
    id: c.id,
    name: c.name,
    position: c.position ?? 0,
    tasks: sinkDone(buckets.get(c.id) ?? []),
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
  const { roomId, send, on, peers } = useRoom()

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
  const [editingTask, setEditingTask] = useState<{
    id: string
    title: string
    description: string
  } | null>(null)

  const [customStatus, setCustomStatus] = useState<TaskOption[]>([])
  const [customUrgency, setCustomUrgency] = useState<TaskOption[]>([])
  const [customFields, setCustomFields] = useState<CustomTaskField[]>([])
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [fieldToRemove, setFieldToRemove] = useState<CustomTaskField | null>(null)
  const [newFieldName, setNewFieldName] = useState('')
  const [newFieldOption, setNewFieldOption] = useState<{
    fieldId: string
    label: string
    color: string
  } | null>(null)
  const [assignees, setAssignees] = useState<TaskAssignee[]>([])
  const [menu, setMenu] = useState<MenuState | null>(null)
  const [optForm, setOptForm] = useState<{ label: string; color: string } | null>(null)

  const [dragId, setDragId] = useState<string | null>(null)
  const dragRef = useRef<{ taskId: string } | null>(null)
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

  const statusOptions = useMemo(() => [...DEFAULT_STATUS, ...customStatus], [customStatus])
  const urgencyOptions = useMemo(() => [...DEFAULT_URGENCY, ...customUrgency], [customUrgency])
  const assigneesById = useMemo(() => new Map(assignees.map((person) => [person.id, person])), [assignees])
  const peerIds = peers.map((peer) => peer.id).join(',')

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
      const [c, t, o, f, fo] = await Promise.all([
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
      ])
      if (c.error || t.error || o.error || f.error || fo.error) {
        setError(
          c.error?.message ||
            t.error?.message ||
            o.error?.message ||
            f.error?.message ||
            fo.error?.message ||
            'Unable to load the board',
        )
        setLoading(false)
        return
      }
      setError(null)
      setCategories(buildBoard(c.data || [], t.data || []))
      if (o.data) {
        const split = splitCustom(o.data)
        setCustomStatus(split.status)
        setCustomUrgency(split.urgency)
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
        setOptForm(null)
        if (fieldToRemove) setFieldToRemove(null)
        else setSettingsOpen(false)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [active, fieldToRemove])

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

  const deleteCategory = async (cat: Category) => {
    if (
      cat.tasks.length > 0 &&
      !window.confirm(`Delete "${cat.name}" and its ${cat.tasks.length} task(s)?`)
    )
      return
    setCategories((prev) => prev.filter((c) => c.id !== cat.id))
    const r1 = await supabase.from('tasks').delete().eq('category_id', cat.id)
    if (r1.error) {
      fail(r1.error.message)
      loadBoard(true)
      return
    }
    const r2 = await supabase.from('categories').delete().eq('id', cat.id)
    if (r2.error) {
      fail(r2.error.message)
      loadBoard(true)
    } else sync()
  }

  // ---------- tasks ----------

  const addTask = async (categoryId: string) => {
    const title = cleanLine(newTaskInputs[categoryId] ?? '', LIMITS.taskTitle)
    if (!title) return
    const cat = categories.find((c) => c.id === categoryId)
    const position = cat ? cat.tasks.length : 0
    const customValues = Object.fromEntries(
      customFields.flatMap((field) =>
        field.defaultValue ? [[field.id, field.defaultValue]] : [],
      ),
    )
    setNewTaskInputs((prev) => ({ ...prev, [categoryId]: '' }))
    const { data, error: err } = await supabase
      .from('tasks')
      .insert({
        title,
        status: 'not_started',
        urgency: 'medium',
        category_id: categoryId,
        position,
        room_id: roomId,
        custom_fields: customValues,
      })
      .select()
      .single()
    if (err) return fail(err.message)
    if (data) {
      const mapped = mapTask(data)
      setCategories((prev) =>
        prev.map((c) =>
          c.id === categoryId ? { ...c, tasks: sinkDone([...c.tasks, mapped]) } : c,
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
        | 'assigneeId'
        | 'customFields'
      >
    >,
  ) => {
    const prev = categoriesRef.current
    const next = prev.map((c) => {
      if (!c.tasks.some((t) => t.id === taskId)) return c
      const tasks = c.tasks.map((t) => (t.id === taskId ? { ...t, ...patch } : t))
      if (!('status' in patch)) return { ...c, tasks }
      return { ...c, tasks: sinkDone(tasks).map((t, i) => ({ ...t, position: i })) }
    })
    setCategories(next)
    if ('status' in patch) savePositions(prev, next)
    const { files, dueDate, assigneeId, customFields: fields, ...rest } = patch
    const dbPatch: Record<string, unknown> = { ...rest }
    if ('dueDate' in patch) dbPatch.due_date = dueDate
    if ('assigneeId' in patch) dbPatch.assignee_id = assigneeId
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

  const saveEdit = () => {
    if (!editingTask) return
    const title = cleanLine(editingTask.title, LIMITS.taskTitle)
    const description = cleanMultiline(editingTask.description, LIMITS.taskDescription)
    if (title) patchTask(editingTask.id, { title, description })
    setEditingTask(null)
  }

  const deleteTask = async (taskId: string) => {
    setCategories((prev) =>
      prev.map((c) => ({ ...c, tasks: c.tasks.filter((t) => t.id !== taskId) })),
    )
    const { error: err } = await supabase.from('tasks').delete().eq('id', taskId)
    if (err) {
      fail(err.message)
      loadBoard(true)
    } else sync()
  }

  const findTask = (taskId: string) =>
    categoriesRef.current.flatMap((c) => c.tasks).find((t) => t.id === taskId)

  const addFiles = async (taskId: string, files: File[]) => {
    if (!files.length) return
    setUploadingId(taskId)
    // Keep whatever uploaded even if one file fails.
    const results = await Promise.allSettled(files.map((f) => uploadRoomFile(f, roomId, 'tasks')))
    const added = results.flatMap((r) => (r.status === 'fulfilled' ? [r.value] : []))
    const failed = results.find((r): r is PromiseRejectedResult => r.status === 'rejected')
    const current = findTask(taskId)
    if (current && added.length) await patchTask(taskId, { files: [...current.files, ...added] })
    if (failed) fail(failed.reason?.message || 'Upload failed')
    setUploadingId(null)
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
    setOptForm(null)
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
    else if (menu.kind === 'assignee') patchTask(menu.taskId, { assigneeId: value || null })
    else if (menu.kind === 'custom' && menu.fieldId && menuTask) {
      const customFields = { ...menuTask.customFields }
      if (value) customFields[menu.fieldId] = value
      else delete customFields[menu.fieldId]
      patchTask(menu.taskId, {
        customFields,
      })
    }
    setMenu(null)
    setOptForm(null)
  }

  const pickDueDate = (value: string) => {
    if (!menu || menu.kind !== 'due_date') return
    patchTask(menu.taskId, { dueDate: value || null })
    setMenu(null)
  }

  const createOption = async () => {
    if (!menu || !optForm || (menu.kind !== 'status' && menu.kind !== 'urgency')) return
    const label = cleanLine(optForm.label, LIMITS.optionLabel)
    if (!label) return
    const pool = menu.kind === 'status' ? statusOptions : urgencyOptions
    const value = slugify(label)
    const existing = pool.find((o) => o.value === value)
    if (existing) return pick(existing.value)
    const { data, error: err } = await supabase
      .from('task_options')
      .insert({
        type: menu.kind,
        value,
        label,
        color: cleanHexColor(optForm.color, '#71717a'),
        room_id: roomId,
      })
      .select()
      .single()
    if (err) return fail(err.message)
    const opt = rowToOption(data)
    if (menu.kind === 'status') setCustomStatus((p) => [...p, opt])
    else setCustomUrgency((p) => [...p, opt])
    pick(opt.value)
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

  const removeCustomField = async (field: CustomTaskField) => {
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
      fields.map((item) =>
        item.id === field.id ? { ...item, defaultValue: value } : item,
      ),
    )
    sync()
  }

  // ---------- drag and drop (move happens on drop, so the dragged node never remounts mid-drag) ----------

  const setDrop = (v: { cat: string; index: number } | null) => {
    dropAtRef.current = v
    setDropAt(v)
  }

  const onCardDragOver = (e: React.DragEvent<HTMLElement>, catId: string, index: number) => {
    if (!dragRef.current) return
    e.preventDefault()
    e.stopPropagation()
    e.dataTransfer.dropEffect = 'move'
    const r = e.currentTarget.getBoundingClientRect()
    const idx = index + (e.clientY > r.top + r.height / 2 ? 1 : 0)
    const cur = dropAtRef.current
    if (!cur || cur.cat !== catId || cur.index !== idx) setDrop({ cat: catId, index: idx })
  }

  const onColumnDragOver = (e: React.DragEvent<HTMLElement>, cat: Category) => {
    if (!dragRef.current) return
    e.preventDefault()
    e.dataTransfer.dropEffect = 'move'
    const cur = dropAtRef.current
    if (!cur || cur.cat !== cat.id || cur.index !== cat.tasks.length)
      setDrop({ cat: cat.id, index: cat.tasks.length })
  }

  const endDrag = () => {
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
      return { ...c, tasks: sinkDone(tasks).map((t, i) => ({ ...t, position: i })) }
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
  const matches = (t: Task) =>
    !q ||
    t.title.toLowerCase().includes(q) ||
    t.description.toLowerCase().includes(q) ||
    customFields.some((field) => {
      const value = t.customFields[field.id] ?? field.defaultValue
      const option = field.options.find((item) => item.value === value)
      return option?.label.toLowerCase().includes(q) ?? false
    })
  const totals = useMemo(() => {
    const all = categories.flatMap((c) => c.tasks)
    return { all: all.length, done: all.filter((t) => t.status === 'completed').length }
  }, [categories])

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
          ? customFields.find((field) => field.id === menu.fieldId)?.options ?? []
          : []
    : []
  const menuTask = menu
    ? categories.flatMap((c) => c.tasks).find((t) => t.id === menu.taskId)
    : null
  const menuCurrent = menuTask
    ? menu!.kind === 'status'
      ? menuTask.status
      : menu!.kind === 'urgency'
        ? menuTask.urgency
        : menu!.kind === 'due_date'
          ? menuTask.dueDate
          : menu!.kind === 'custom'
            ? menuTask.customFields[menu!.fieldId ?? ''] ??
              customFields.find((field) => field.id === menu!.fieldId)?.defaultValue
            : menuTask.assigneeId
    : null

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
            placeholder="Filter tasks"
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
        <span className="text-xs" style={{ color: 'var(--dv-muted)' }}>
          {totals.done} of {totals.all} done
        </span>
        {error && (
          <button
            className="ml-auto flex items-center gap-1.5 rounded-md px-2 py-1 text-xs"
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
                  {q ? `${visible.length}/${cat.tasks.length}` : cat.tasks.length}
                </span>
                <button
                  className="dv-iconbtn danger !h-6 !w-6 opacity-0 group-hover:opacity-100"
                  onClick={() => deleteCategory(cat)}
                  title="Delete list"
                >
                  <Trash2 size={13} />
                </button>
              </header>

              <div className="dv-scroll min-h-[44px] flex-1 overflow-y-auto px-2">
                {visible.map((task, index) => {
                  const status = resolveOption(statusOptions, task.status, 'status')
                  const urgency = resolveOption(urgencyOptions, task.urgency, 'urgency')
                  const assignee = task.assigneeId ? assigneesById.get(task.assigneeId) : null
                  const isEditing = editingTask?.id === task.id
                  const done = task.status === 'completed'
                  return (
                    <div
                      key={task.id}
                      id={`task-${task.id}`}
                      className="pb-2"
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
                      <article
                        draggable={!isEditing && !q}
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
                          setDragId(task.id)
                        }}
                        onDragEnd={endDrag}
                        onDoubleClick={() =>
                          !isEditing &&
                          setEditingTask({
                            id: task.id,
                            title: task.title,
                            description: task.description,
                          })
                        }
                      >
                        <span
                          className="dv-card-bar"
                          style={{ background: urgency.color }}
                          title={`Urgency: ${urgency.label}`}
                        />
                        {isEditing ? (
                          <div className="flex flex-col gap-2">
                            <input
                              autoFocus
                              className="dv-input"
                              value={editingTask.title}
                              placeholder="Task title"
                              onChange={(e) =>
                                setEditingTask({ ...editingTask, title: e.target.value })
                              }
                              onKeyDown={(e) => {
                                if (e.key === 'Enter') saveEdit()
                                if (e.key === 'Escape') setEditingTask(null)
                              }}
                            />
                            <textarea
                              className="dv-input"
                              rows={3}
                              value={editingTask.description}
                              placeholder="Notes, links, context… (paste or drop files here)"
                              onPaste={(e) => {
                                const files = [...e.clipboardData.files]
                                if (files.length) {
                                  e.preventDefault()
                                  addFiles(task.id, files)
                                }
                              }}
                              onChange={(e) =>
                                setEditingTask({ ...editingTask, description: e.target.value })
                              }
                              onKeyDown={(e) => {
                                if (e.key === 'Escape') setEditingTask(null)
                                if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) saveEdit()
                              }}
                            />
                            <div className="flex flex-wrap gap-1.5">
                              {task.files.map((f) => (
                                <div
                                  key={f.url}
                                  className="relative h-14 w-16 overflow-hidden rounded-md border"
                                  style={{ borderColor: 'var(--dv-border)' }}
                                  title={f.name}
                                >
                                  {isImage(f) ? (
                                    <img
                                      src={f.url}
                                      alt=""
                                      draggable={false}
                                      className="h-full w-full object-contain"
                                      style={{ background: 'var(--dv-panel-2)' }}
                                    />
                                  ) : (
                                    <div
                                      className="flex h-full w-full flex-col items-center justify-center gap-1 px-1"
                                      style={{ background: 'var(--dv-panel-2)', color: 'var(--dv-muted)' }}
                                    >
                                      <FileIcon file={f} size={16} />
                                      <span className="w-full truncate text-center text-[9px]">
                                        {f.name}
                                      </span>
                                    </div>
                                  )}
                                  <button
                                    className="absolute right-0.5 top-0.5 flex h-4 w-4 items-center justify-center rounded-full bg-black/65 text-white"
                                    title="Remove file"
                                    onClick={() => removeFile(task.id, f.url)}
                                  >
                                    <X size={10} />
                                  </button>
                                </div>
                              ))}
                              <button
                                className="dv-btn !h-14 w-16 justify-center"
                                title="Attach files"
                                onClick={() => pickFiles(task.id)}
                              >
                                <Paperclip size={16} />
                              </button>
                            </div>
                            <div className="flex justify-end gap-2">
                              <button className="dv-btn" onClick={() => setEditingTask(null)}>
                                Cancel
                              </button>
                              <button className="dv-btn primary" onClick={saveEdit}>
                                Save
                              </button>
                            </div>
                          </div>
                        ) : (
                          <>
                            <h3
                              className="text-[13.5px] font-medium leading-snug"
                              style={{
                                color: done ? 'var(--dv-muted)' : undefined,
                                textDecoration: done ? 'line-through' : undefined,
                              }}
                            >
                              {task.title}
                            </h3>
                            {task.description && (
                              <p
                                className="mt-1 line-clamp-3 whitespace-pre-wrap text-xs leading-relaxed"
                                style={{ color: 'var(--dv-muted)' }}
                              >
                                {task.description}
                              </p>
                            )}
                            {(() => {
                              // Images as thumbnails, everything else as chips; one viewer for all, in this order.
                              const images = task.files.filter(isImage)
                              const others = task.files.filter((f) => !isImage(f))
                              const ordered = [...images, ...others]
                              const open = (f: Attachment) =>
                                setViewer({ files: ordered, index: ordered.indexOf(f) })
                              return (
                                <>
                                  {images.length > 0 && (
                                    // Whole images at their own proportions; very tall ones are scaled down, not cropped.
                                    <div className="mt-2 flex flex-col gap-1.5">
                                      {images.slice(0, 3).map((f) => (
                                        <button
                                          key={f.url}
                                          className="flex justify-center overflow-hidden rounded-md border"
                                          style={{
                                            borderColor: 'var(--dv-border)',
                                            background: 'var(--dv-panel-2)',
                                          }}
                                          title="View image"
                                          onClick={() => open(f)}
                                        >
                                          <img
                                            src={f.url}
                                            alt=""
                                            draggable={false}
                                            loading="lazy"
                                            className="block h-auto max-h-80 w-auto max-w-full object-contain"
                                          />
                                        </button>
                                      ))}
                                      {images.length > 3 && (
                                        <button
                                          className="self-start text-[11px]"
                                          style={{ color: 'var(--dv-muted)' }}
                                          onClick={() => open(images[3])}
                                        >
                                          +{images.length - 3} more image{images.length - 3 === 1 ? '' : 's'}
                                        </button>
                                      )}
                                    </div>
                                  )}
                                  {others.length > 0 && (
                                    <div className="mt-2 flex flex-col gap-1">
                                      {others.map((f) => (
                                        <FileChip key={f.url} file={f} onClick={() => open(f)} />
                                      ))}
                                    </div>
                                  )}
                                </>
                              )
                            })()}
                            {uploadingId === task.id && (
                              <p
                                className="mt-1.5 text-[11px]"
                                style={{ color: 'var(--dv-muted)' }}
                              >
                                Uploading…
                              </p>
                            )}
                            <div className="mt-2.5 flex flex-wrap items-center gap-1.5">
                              <button
                                className="dv-chip"
                                style={badgeStyle(status.color)}
                                title="Change status"
                                onClick={(e) => openMenu(e, 'status', task.id, cat.id)}
                              >
                                <span className="dv-dot" style={{ background: status.color }} />
                                {status.label}
                              </button>
                              <button
                                className="dv-chip"
                                style={badgeStyle(urgency.color)}
                                title="Change urgency"
                                onClick={(e) => openMenu(e, 'urgency', task.id, cat.id)}
                              >
                                {urgency.label}
                              </button>
                              {customFields.filter((field) => field.defaultValue).map((field) => {
                                const selected = field.options.find(
                                  (option) =>
                                    option.value ===
                                    (task.customFields[field.id] ?? field.defaultValue),
                                )
                                return (
                                  <button
                                    key={field.id}
                                    className="dv-chip"
                                    style={
                                      selected
                                        ? badgeStyle(selected.color)
                                        : {
                                            background: 'var(--dv-panel-2)',
                                            color: 'var(--dv-muted)',
                                          }
                                    }
                                    title={`Change ${field.name}`}
                                    onClick={(e) =>
                                      openMenu(e, 'custom', task.id, cat.id, field.id)
                                    }
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
                                )
                              })}
                              <button
                                className="dv-chip"
                                style={{
                                  background: 'var(--dv-panel-2)',
                                  color: 'var(--dv-text)',
                                }}
                                title={task.dueDate ? `Due ${formatDueDate(task.dueDate)}` : 'Set due date'}
                                onClick={(e) => openMenu(e, 'due_date', task.id, cat.id)}
                              >
                                <CalendarDays size={12} />
                                {task.dueDate ? formatDueDate(task.dueDate) : 'Due date'}
                              </button>
                              <button
                                className="dv-chip"
                                style={{
                                  background: 'var(--dv-panel-2)',
                                  color: 'var(--dv-text)',
                                }}
                                title={assignee ? `Assigned to ${assignee.name}` : 'Assign task'}
                                onClick={(e) => openMenu(e, 'assignee', task.id, cat.id)}
                              >
                                {assignee ? (
                                  <Avatar
                                    name={assignee.name}
                                    color={colorFor(assignee.id)}
                                    src={assignee.avatarUrl}
                                    size={14}
                                    className="-ml-1"
                                  />
                                ) : (
                                  <UserRound size={12} />
                                )}
                                {assignee?.name ?? 'Assign'}
                              </button>
                              <div className="dv-actions ml-auto flex items-center">
                                <button
                                  className="dv-iconbtn !h-6 !w-6"
                                  title="Attach files"
                                  onClick={() => pickFiles(task.id)}
                                >
                                  <Paperclip size={13} />
                                </button>
                                <button
                                  className="dv-iconbtn !h-6 !w-6"
                                  title={links.has(task.id) ? 'Focus on canvas' : 'Send to canvas'}
                                  onClick={() =>
                                    links.has(task.id)
                                      ? focusOnCanvas(task.id)
                                      : sendToCanvas(task.id)
                                  }
                                >
                                  {links.has(task.id) ? (
                                    <Crosshair size={13} />
                                  ) : (
                                    <PenTool size={13} />
                                  )}
                                </button>
                                <button
                                  className="dv-iconbtn !h-6 !w-6"
                                  title="Edit"
                                  onClick={() =>
                                    setEditingTask({
                                      id: task.id,
                                      title: task.title,
                                      description: task.description,
                                    })
                                  }
                                >
                                  <Pencil size={13} />
                                </button>
                                <button
                                  className="dv-iconbtn danger !h-6 !w-6"
                                  title="Delete"
                                  onClick={() => deleteTask(task.id)}
                                >
                                  <Trash2 size={13} />
                                </button>
                              </div>
                            </div>
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
                          </>
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
                    {q ? 'No matching tasks' : 'Nothing here yet'}
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
                  Add custom task categories, their statuses, and a default status for each.
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
              {customFields.map((field) => (
                <div
                  key={field.id}
                  className="rounded-xl border p-3"
                  style={{ borderColor: 'var(--dv-border)', background: 'var(--dv-panel-2)' }}
                >
                  <div className="flex items-center justify-between gap-2">
                    <h3 className="m-0 text-sm font-semibold">{field.name}</h3>
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
                    {field.options.map((option) => (
                      <span key={option.id} className="dv-chip" style={badgeStyle(option.color)}>
                        <span className="dv-dot" style={{ background: option.color }} />
                        {option.label}
                        {(field.defaultValue ?? field.options[0]?.value) === option.value &&
                          <span className="ml-1 text-[10px]">Default</span>}
                      </span>
                    ))}
                    {field.options.length === 0 && (
                      <span className="text-xs" style={{ color: 'var(--dv-muted)' }}>
                        Add a status before assigning this category to tasks.
                      </span>
                    )}
                  </div>
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
                      <label className="flex items-center gap-1 text-xs" style={{ color: 'var(--dv-muted)' }}>
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
                      <button
                        className="dv-btn primary"
                        disabled={!newFieldOption.label.trim()}
                      >
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
              <button
                className="dv-btn danger"
                onClick={() => removeCustomField(fieldToRemove)}
              >
                Remove category
              </button>
            </div>
          </section>
        </div>
      )}

      {/* Task fields menu (fixed so column scrolling can't clip it) */}
      {menu && (
        <>
          <div
            className="fixed inset-0 z-40"
            onPointerDown={() => {
              setMenu(null)
              setOptForm(null)
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
                  Assign to
                </div>
                <button
                  className="dv-menu-item"
                  data-selected={!menuTask?.assigneeId}
                  onClick={() => pick('')}
                >
                  <UserRound size={15} />
                  <span className="flex-1">Unassigned</span>
                  {!menuTask?.assigneeId && (
                    <span className="text-[11px]" style={{ color: 'var(--dv-muted)' }}>
                      Current
                    </span>
                  )}
                </button>
                {assignees.map((person) => (
                  <button
                    key={person.id}
                    className="dv-menu-item"
                    data-selected={menuTask?.assigneeId === person.id}
                    onClick={() => pick(person.id)}
                  >
                    <Avatar
                      name={person.name}
                      color={colorFor(person.id)}
                      src={person.avatarUrl}
                      size={20}
                    />
                    <span className="flex-1 truncate">{person.name}</span>
                    {menuTask?.assigneeId === person.id && (
                      <span className="text-[11px]" style={{ color: 'var(--dv-muted)' }}>
                        Current
                      </span>
                    )}
                  </button>
                ))}
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
                    ? 'Set status'
                    : menu.kind === 'urgency'
                      ? 'Set urgency'
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
                {menu.kind !== 'custom' && (
                  <>
                    <div className="my-1 h-px" style={{ background: 'var(--dv-border)' }} />
                    {optForm ? (
                      <div className="flex flex-col gap-2 p-2">
                        <input
                          autoFocus
                          className="dv-input"
                          placeholder={menu.kind === 'status' ? 'Status name' : 'Urgency name'}
                          value={optForm.label}
                          onChange={(e) => setOptForm({ ...optForm, label: e.target.value })}
                          onKeyDown={(e) => e.key === 'Enter' && createOption()}
                        />
                        <label
                          className="flex items-center justify-between text-xs"
                          style={{ color: 'var(--dv-muted)' }}
                        >
                          Color
                          <input
                            type="color"
                            value={optForm.color}
                            onChange={(e) => setOptForm({ ...optForm, color: e.target.value })}
                            className="h-7 w-12 cursor-pointer rounded border-0 bg-transparent"
                          />
                        </label>
                        <div className="flex justify-end gap-2">
                          <button className="dv-btn" onClick={() => setOptForm(null)}>
                            Back
                          </button>
                          <button
                            className="dv-btn primary"
                            disabled={!optForm.label.trim()}
                            onClick={createOption}
                          >
                            Create
                          </button>
                        </div>
                      </div>
                    ) : (
                      <button
                        className="dv-menu-item"
                        style={{ color: 'var(--dv-accent)' }}
                        onClick={() => setOptForm({ label: '', color: '#3b82f6' })}
                      >
                        <Plus size={13} />
                        New {menu.kind}
                      </button>
                    )}
                  </>
                )}
              </>
            )}
          </div>
        </>
      )}
    </div>
  )
}
