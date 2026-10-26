import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Crosshair, ImagePlus, Pencil, PenTool, Plus, Search, Trash2, X } from 'lucide-react'
import { supabase } from './lib/supabase'
import { useRoom } from './lib/room'
import { bus, getLinkCounts, isTyping, toast } from './lib/bus'
import { uploadTaskImage } from './lib/upload.ts'
import { LIMITS, cleanHexColor, cleanLine, cleanMultiline, isSafeImageSrc } from './lib/sanitize'
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
  category_id: string
  position: number | null
}

interface Task {
  id: string
  title: string
  description: string
  status: string
  urgency: string
  images: string[]
  categoryId: string
  position: number
}

interface Category {
  id: string
  name: string
  position: number
  tasks: Task[]
}

const mapTask = (t: DbTask): Task => ({
  id: t.id,
  title: t.title,
  description: t.description || '',
  status: t.status,
  urgency: t.urgency ?? 'medium',
  images: Array.isArray(t.images) ? (t.images as unknown[]).filter(isSafeImageSrc) : [],
  categoryId: t.category_id,
  position: t.position ?? 0,
})

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
    tasks: buckets.get(c.id) ?? [],
  }))
}

interface MenuState {
  kind: TaskOptionType
  taskId: string
  categoryId: string
  x: number
  y: number
}

export const KanbanBoard: React.FC<{ active?: boolean }> = ({ active = true }) => {
  const { roomId, send, on } = useRoom()

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
  const [menu, setMenu] = useState<MenuState | null>(null)
  const [optForm, setOptForm] = useState<{ label: string; color: string } | null>(null)

  const [dragId, setDragId] = useState<string | null>(null)
  const dragRef = useRef<{ taskId: string } | null>(null)
  const [dropAt, setDropAt] = useState<{ cat: string; index: number } | null>(null)
  const dropAtRef = useRef<{ cat: string; index: number } | null>(null)
  const [flashId, setFlashId] = useState<string | null>(null)
  const [links, setLinks] = useState<Map<string, number>>(getLinkCounts)
  const [lightbox, setLightbox] = useState<{ images: string[]; index: number } | null>(null)
  const [fileOverId, setFileOverId] = useState<string | null>(null)
  const [uploadingId, setUploadingId] = useState<string | null>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const uploadTarget = useRef<string | null>(null)

  const statusOptions = useMemo(() => [...DEFAULT_STATUS, ...customStatus], [customStatus])
  const urgencyOptions = useMemo(() => [...DEFAULT_URGENCY, ...customUrgency], [customUrgency])

  /** Tell everyone else (and the canvas in this window) that board data changed. */
  const sync = useCallback(() => send('board', {}, true), [send])

  const fail = useCallback((message: string) => {
    setError(message)
    toast(message)
  }, [])

  // ---------- loading ----------

  const loadBoard = useCallback(
    async (silent = false) => {
      if (!silent) setLoading(true)
      const [c, t, o] = await Promise.all([
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
      ])
      if (c.error || t.error) {
        setError(c.error?.message || t.error?.message || 'Unable to load the board')
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
      setLoading(false)
    },
    [roomId],
  )

  useEffect(() => {
    loadBoard()
  }, [loadBoard])

  // Live updates from teammates (debounced, and never mid-drag).
  useEffect(() => {
    let timer: number | undefined
    const off = on('board', (_payload, fromSelf) => {
      if (fromSelf) return
      window.clearTimeout(timer)
      timer = window.setTimeout(() => {
        if (!dragRef.current) loadBoard(true)
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

  useEffect(() => {
    if (!lightbox) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setLightbox(null)
      else if (e.key === 'ArrowRight')
        setLightbox((l) => l && { ...l, index: (l.index + 1) % l.images.length })
      else if (e.key === 'ArrowLeft')
        setLightbox((l) => l && { ...l, index: (l.index - 1 + l.images.length) % l.images.length })
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [lightbox])

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
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [active])

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
      })
      .select()
      .single()
    if (err) return fail(err.message)
    if (data) {
      const mapped = mapTask(data)
      setCategories((prev) =>
        prev.map((c) => (c.id === categoryId ? { ...c, tasks: [...c.tasks, mapped] } : c)),
      )
      sync()
    }
  }

  const patchTask = async (
    taskId: string,
    patch: Partial<Pick<Task, 'status' | 'urgency' | 'title' | 'description' | 'images'>>,
  ) => {
    setCategories((prev) =>
      prev.map((c) => ({
        ...c,
        tasks: c.tasks.map((t) => (t.id === taskId ? { ...t, ...patch } : t)),
      })),
    )
    const dbPatch: Record<string, unknown> = { ...patch }
    if ('title' in patch) dbPatch.title = cleanLine(patch.title ?? '', LIMITS.taskTitle)
    if ('description' in patch)
      dbPatch.description = cleanMultiline(patch.description ?? '', LIMITS.taskDescription) || null
    if ('images' in patch) dbPatch.images = (patch.images ?? []).filter(isSafeImageSrc)
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

  const addImages = async (taskId: string, files: File[]) => {
    const imgs = files.filter((f) => f.type.startsWith('image/'))
    if (!imgs.length) return
    setUploadingId(taskId)
    try {
      const urls = await Promise.all(imgs.map((f) => uploadTaskImage(f, roomId)))
      const current = findTask(taskId)
      if (current) await patchTask(taskId, { images: [...current.images, ...urls] })
    } catch (e: any) {
      fail(e?.message || 'Upload failed')
    } finally {
      setUploadingId(null)
    }
  }

  const removeImage = (taskId: string, url: string) => {
    const current = findTask(taskId)
    if (current) patchTask(taskId, { images: current.images.filter((u) => u !== url) })
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
    kind: TaskOptionType,
    taskId: string,
    categoryId: string,
  ) => {
    e.stopPropagation()
    const r = e.currentTarget.getBoundingClientRect()
    setOptForm(null)
    setMenu({
      kind,
      taskId,
      categoryId,
      x: Math.min(r.left, window.innerWidth - 232),
      y: Math.min(r.bottom + 4, window.innerHeight - 340),
    })
  }

  const pick = (value: string) => {
    if (!menu) return
    patchTask(menu.taskId, menu.kind === 'status' ? { status: value } : { urgency: value })
    setMenu(null)
    setOptForm(null)
  }

  const createOption = async () => {
    if (!menu || !optForm) return
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
      return { ...c, tasks: tasks.map((t, i) => ({ ...t, position: i })) }
    })
    setCategories(next)

    // Persist only what changed.
    const before = new Map(prev.flatMap((c) => c.tasks.map((t) => [t.id, t] as const)))
    const writes = next
      .filter((c) => c.id === fromCat.id || c.id === target.cat)
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

  // ---------- derived ----------

  const q = query.trim().toLowerCase()
  const matches = (t: Task) =>
    !q || t.title.toLowerCase().includes(q) || t.description.toLowerCase().includes(q)
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

  const menuOptions = menu ? (menu.kind === 'status' ? statusOptions : urgencyOptions) : []
  const menuTask = menu
    ? categories.flatMap((c) => c.tasks).find((t) => t.id === menu.taskId)
    : null
  const menuCurrent = menuTask
    ? menu!.kind === 'status'
      ? menuTask.status
      : menuTask.urgency
    : null

  return (
    <div
      className="flex h-full min-h-0 flex-col"
      onDrop={onDrop}
      onDragOver={(e) => e.preventDefault()}
    >
      {/* Toolbar */}
      <div className="flex shrink-0 items-center gap-3 px-6 pb-3 pt-4">
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
      <div className="dv-scroll flex min-h-0 flex-1 items-start gap-4 overflow-x-auto px-6 pb-6">
        {categories.map((cat) => {
          const visible = cat.tasks.filter(matches)
          const input = newTaskInputs[cat.id] || ''
          const isDropCol = dropAt?.cat === cat.id
          return (
            <section
              key={cat.id}
              className="dv-col"
              style={
                isDropCol
                  ? {
                      borderColor: 'var(--dv-accent-soft)',
                      background: 'color-mix(in srgb, var(--dv-accent) 6%, var(--dv-panel-2))',
                    }
                  : undefined
              }
              onDragOver={(e) => onColumnDragOver(e, cat)}
            >
              <header className="group flex items-center gap-2 px-3 pb-2 pt-3">
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
                    className="min-w-0 flex-1 cursor-text truncate text-[13.5px] font-semibold"
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
                          addImages(task.id, [...e.dataTransfer.files])
                        }
                      }}
                    >
                      {dropAt?.cat === cat.id && dropAt.index === index && (
                        <div className="dv-drop-line" />
                      )}
                      <article
                        draggable={!isEditing && !q}
                        data-dragging={dragId === task.id}
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
                              placeholder="Notes, links, context… (paste images here)"
                              onPaste={(e) => {
                                const files = [...e.clipboardData.files].filter((f) =>
                                  f.type.startsWith('image/'),
                                )
                                if (files.length) {
                                  e.preventDefault()
                                  addImages(task.id, files)
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
                              {task.images.map((src) => (
                                <div
                                  key={src}
                                  className="relative h-14 w-16 overflow-hidden rounded-md border"
                                  style={{ borderColor: 'var(--dv-border)' }}
                                >
                                  <img
                                    src={src}
                                    alt=""
                                    draggable={false}
                                    className="h-full w-full object-cover"
                                  />
                                  <button
                                    className="absolute right-0.5 top-0.5 flex h-4 w-4 items-center justify-center rounded-full bg-black/65 text-white"
                                    title="Remove image"
                                    onClick={() => removeImage(task.id, src)}
                                  >
                                    <X size={10} />
                                  </button>
                                </div>
                              ))}
                              <button
                                className="dv-btn !h-14 w-16 justify-center"
                                title="Attach image"
                                onClick={() => pickFiles(task.id)}
                              >
                                <ImagePlus size={16} />
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
                            {task.images.length > 0 && (
                              <div
                                className="mt-2 grid gap-1.5"
                                style={{
                                  gridTemplateColumns: `repeat(${Math.min(3, task.images.length)}, 1fr)`,
                                }}
                              >
                                {task.images.slice(0, 3).map((src, i) => (
                                  <button
                                    key={src}
                                    className="relative overflow-hidden rounded-md border"
                                    style={{
                                      borderColor: 'var(--dv-border)',
                                      aspectRatio: task.images.length === 1 ? '16 / 9' : '4 / 3',
                                    }}
                                    title="View image"
                                    onClick={() => setLightbox({ images: task.images, index: i })}
                                  >
                                    <img
                                      src={src}
                                      alt=""
                                      draggable={false}
                                      loading="lazy"
                                      className="h-full w-full object-cover"
                                    />
                                    {i === 2 && task.images.length > 3 && (
                                      <span className="absolute inset-0 flex items-center justify-center bg-black/55 text-xs font-semibold text-white">
                                        +{task.images.length - 3}
                                      </span>
                                    )}
                                  </button>
                                ))}
                              </div>
                            )}
                            {uploadingId === task.id && (
                              <p
                                className="mt-1.5 text-[11px]"
                                style={{ color: 'var(--dv-muted)' }}
                              >
                                Uploading…
                              </p>
                            )}
                            <div className="mt-2.5 flex items-center gap-1.5">
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
                              <div className="dv-actions ml-auto flex items-center">
                                <button
                                  className="dv-iconbtn !h-6 !w-6"
                                  title="Attach image"
                                  onClick={() => pickFiles(task.id)}
                                >
                                  <ImagePlus size={13} />
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
        accept="image/*"
        multiple
        className="hidden"
        onChange={(e) => {
          const id = uploadTarget.current
          if (id && e.target.files) addImages(id, [...e.target.files])
          e.target.value = ''
        }}
      />

      {lightbox && (
        <div
          className="fixed inset-0 z-[90] flex items-center justify-center bg-black/80"
          onClick={() => setLightbox(null)}
        >
          <img
            src={lightbox.images[lightbox.index]}
            alt=""
            className="max-h-[88vh] max-w-[88vw] rounded-lg shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          />
          {lightbox.images.length > 1 && (
            <span className="absolute bottom-6 left-1/2 -translate-x-1/2 rounded-md bg-black/60 px-2 py-1 text-xs text-white">
              {lightbox.index + 1} / {lightbox.images.length} · use arrow keys
            </span>
          )}
          <button
            className="absolute right-5 top-5 flex h-9 w-9 items-center justify-center rounded-full bg-black/60 text-white"
            onClick={() => setLightbox(null)}
            title="Close (Esc)"
          >
            <X size={18} />
          </button>
        </div>
      )}

      {/* Status / urgency menu (fixed so column scrolling can't clip it) */}
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
            <div
              className="px-2 pb-1 pt-1.5 text-xs font-semibold"
              style={{ color: 'var(--dv-muted)' }}
            >
              {menu.kind === 'status' ? 'Set status' : 'Set urgency'}
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
          </div>
        </>
      )}
    </div>
  )
}
