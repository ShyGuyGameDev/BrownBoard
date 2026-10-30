import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  Archive,
  AlignLeft,
  CalendarDays,
  Check,
  CheckSquare,
  ChevronDown,
  CircleCheck,
  Eye,
  EyeOff,
  Image as ImageIcon,
  MessageSquare,
  Paperclip,
  Pencil,
  PenTool,
  Plus,
  Tag,
  Trash2,
  UserRound,
  X,
} from 'lucide-react'
import { supabase } from './lib/supabase'
import { colorFor, useRoom } from './lib/room'
import { toast, undoToast } from './lib/bus'
import { type Attachment, isImageFile } from './lib/files'
import { LIMITS, cleanLine, cleanMultiline } from './lib/sanitize'
import { type DoneRule, type TaskOption, badgeStyle, resolveOption } from './lib/options'
import { type TaskAssignee, formatDueDate } from './lib/tasks'
import { fullDate, relative } from './lib/time'
import {
  type Activity,
  type ActivityNames,
  COVER_COLORS,
  type Checklist,
  type Comment,
  type Cover,
  LABEL_COLORS,
  type Label,
  checklistProgress,
  describeActivity,
  dueLabel,
  dueState,
  dueTitle,
  newId,
  rowToActivity,
  rowToComment,
  splitMentions,
} from './lib/cards'
import { Avatar } from './avatar'
import { FileChip } from './file-viewer'

/** What the detail view needs of a board task. */
export interface CardTask {
  id: string
  title: string
  description: string
  status: string | null
  urgency: string | null
  customFields: Record<string, string>
  files: Attachment[]
  dueDate: string | null
  memberIds: string[]
  labelIds: string[]
  checklists: Checklist[]
  cover: Cover
}

export type CardPatch = Partial<
  Pick<
    CardTask,
    | 'title'
    | 'description'
    | 'status'
    | 'urgency'
    | 'customFields'
    | 'dueDate'
    | 'memberIds'
    | 'labelIds'
    | 'checklists'
    | 'cover'
  >
>

export interface CardField {
  /** 'status', 'urgency', or a custom category id */
  field: string
  name: string
  options: TaskOption[]
}

interface Props {
  task: CardTask
  listName: string
  done: boolean
  doneRule: DoneRule
  fields: CardField[]
  defaultValueOf: (field: string) => string | null
  labels: Label[]
  people: TaskAssignee[]
  /** This viewer's account id; null for guests (who can't be members or watch). */
  userId: string | null
  watching: boolean
  onToggleWatch: () => void
  onPatch: (patch: CardPatch) => void
  onArchive: () => void
  onPickFiles: () => void
  onPasteFiles: (files: File[]) => void
  onRemoveFile: (url: string) => void
  onOpenFile: (files: Attachment[], index: number) => void
  onSendToCanvas: () => void
  onCreateLabel: (name: string, color: string) => Promise<Label | null>
  onUpdateLabel: (label: Label) => void
  onDeleteLabel: (label: Label) => void
  onClose: () => void
}

type Pop =
  | { kind: 'field'; field: string }
  | { kind: 'add_field' }
  | { kind: 'labels' }
  | { kind: 'members' }
  | { kind: 'due' }
  | { kind: 'cover' }

const fieldValue = (task: CardTask, field: string) =>
  field === 'status'
    ? task.status
    : field === 'urgency'
      ? task.urgency
      : (task.customFields[field] ?? null)

const SHOW_DETAILS_KEY = 'brownboard:card-show-activity'

export const CardDetail: React.FC<Props> = (props) => {
  const { task, fields, labels, people, userId, onPatch, onClose } = props
  const { roomId, on, send } = useRoom()

  const [title, setTitle] = useState(task.title)
  const [description, setDescription] = useState(task.description)
  const [editingNotes, setEditingNotes] = useState(false)
  const [pop, setPop] = useState<(Pop & { x: number; y: number }) | null>(null)
  const dialogRef = useRef<HTMLElement>(null)

  // Follow teammates' changes unless you're mid-edit.
  const titleFocused = useRef(false)
  useEffect(() => {
    if (!titleFocused.current) setTitle(task.title)
  }, [task.title])
  useEffect(() => {
    if (!editingNotes) setDescription(task.description)
  }, [task.description, editingNotes])

  useEffect(() => {
    dialogRef.current?.focus()
  }, [])

  const openPop = (e: React.MouseEvent<HTMLElement>, p: Pop, width = 272) => {
    e.stopPropagation()
    const r = e.currentTarget.getBoundingClientRect()
    setPop({
      ...p,
      x: Math.max(8, Math.min(r.left, window.innerWidth - width - 8)),
      y: Math.min(r.bottom + 6, window.innerHeight - 380),
    })
  }

  const saveTitle = () => {
    titleFocused.current = false
    const clean = cleanLine(title, LIMITS.taskTitle)
    if (!clean) return setTitle(task.title)
    if (clean !== task.title) onPatch({ title: clean })
  }

  const saveNotes = () => {
    setEditingNotes(false)
    const clean = cleanMultiline(description, LIMITS.taskDescription)
    if (clean !== task.description) onPatch({ description: clean })
  }

  const setField = (field: string, value: string | null) => {
    if (field === 'status' || field === 'urgency') return onPatch({ [field]: value })
    const customFields = { ...task.customFields }
    if (value) customFields[field] = value
    else delete customFields[field]
    onPatch({ customFields })
  }

  // ---------- checklists ----------

  const setChecklists = (checklists: Checklist[]) => onPatch({ checklists })
  const addChecklist = () => {
    const list: Checklist = { id: newId(), title: 'Checklist', items: [] }
    setChecklists([...task.checklists, list])
    setFocusNewItem(list.id)
  }
  const [focusNewItem, setFocusNewItem] = useState<string | null>(null)

  const removeChecklist = (list: Checklist) => {
    const before = task.checklists
    setChecklists(before.filter((l) => l.id !== list.id))
    undoToast(`Deleted “${list.title}”`, () => setChecklists(before))
  }

  // ---------- comments & activity ----------

  const [comments, setComments] = useState<Comment[]>([])
  const [activity, setActivity] = useState<Activity[]>([])
  const [feedError, setFeedError] = useState(false)
  const [showDetails, setShowDetails] = useState(() => {
    try {
      return localStorage.getItem(SHOW_DETAILS_KEY) !== 'false'
    } catch {
      return true
    }
  })

  const loadFeed = useCallback(async () => {
    const [c, a] = await Promise.all([
      supabase
        .from('task_comments')
        .select('*')
        .eq('task_id', task.id)
        .order('created_at', { ascending: false }),
      supabase
        .from('task_activity')
        .select('*')
        .eq('task_id', task.id)
        .order('created_at', { ascending: false })
        .limit(100),
    ])
    setFeedError(!!(c.error || a.error))
    if (c.data) setComments(c.data.map(rowToComment))
    if (a.data) setActivity(a.data.map(rowToActivity))
  }, [task.id])

  useEffect(() => {
    loadFeed()
    let timer = 0
    const off = on('board', () => {
      window.clearTimeout(timer)
      timer = window.setTimeout(loadFeed, 250)
    })
    return () => {
      off()
      window.clearTimeout(timer)
    }
  }, [loadFeed, on])

  const names: ActivityNames = useMemo(
    () => ({
      fieldName: (field) => fields.find((f) => f.field === field)?.name ?? null,
      valueLabel: (field, value) => {
        const f = fields.find((x) => x.field === field)
        return f ? resolveOption(f.options, value, 'status').label : value
      },
    }),
    [fields],
  )

  const feed = useMemo(
    () =>
      [
        ...comments.map((c) => ({ type: 'comment' as const, at: c.createdAt, c })),
        ...(showDetails
          ? activity.map((a) => ({ type: 'activity' as const, at: a.createdAt, a }))
          : []),
      ].sort((x, y) => (x.at < y.at ? 1 : x.at > y.at ? -1 : 0)),
    [comments, activity, showDetails],
  )

  const postComment = async (body: string) => {
    const mentions = people.filter((p) => body.includes(`@${p.name}`)).map((p) => p.id)
    const { data, error } = await supabase
      .from('task_comments')
      .insert({ room_id: roomId, task_id: task.id, body, mentions })
      .select()
      .single()
    if (error) {
      toast(error.message)
      return false
    }
    setComments((list) => [rowToComment(data), ...list])
    send('board', {})
    return true
  }

  const editComment = async (comment: Comment, body: string) => {
    const mentions = people.filter((p) => body.includes(`@${p.name}`)).map((p) => p.id)
    const { data, error } = await supabase
      .from('task_comments')
      .update({ body, mentions })
      .eq('id', comment.id)
      .select()
      .single()
    if (error) return toast(error.message)
    setComments((list) => list.map((c) => (c.id === comment.id ? rowToComment(data) : c)))
    send('board', {})
  }

  const deleteComment = async (comment: Comment) => {
    setComments((list) => list.filter((c) => c.id !== comment.id))
    const { error } = await supabase.from('task_comments').delete().eq('id', comment.id)
    if (error) {
      toast(error.message)
      loadFeed()
    } else send('board', {})
  }

  // ---------- derived ----------

  const onCard = fields.filter((f) => fieldValue(task, f.field) !== null)
  const missing = fields.filter((f) => fieldValue(task, f.field) === null)
  const cardLabels = task.labelIds
    .map((id) => labels.find((l) => l.id === id))
    .filter((l): l is Label => !!l)
  const members = task.memberIds
    .map((id) => people.find((p) => p.id === id))
    .filter((p): p is TaskAssignee => !!p)
  const due = task.dueDate ? dueState(task.dueDate, props.done) : null
  const images = task.files.filter(isImageFile)
  const others = task.files.filter((f) => !isImageFile(f))
  const ordered = [...images, ...others]
  const isMember = !!userId && task.memberIds.includes(userId)

  return (
    <div
      className="dv-modal-backdrop dv-detail-backdrop"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose()
      }}
    >
      <section
        ref={dialogRef}
        tabIndex={-1}
        className="dv-floating dv-modal dv-detail"
        role="dialog"
        aria-modal="true"
        aria-labelledby="card-detail-title"
        onKeyDown={(e) => {
          if (e.key !== 'Escape' || e.defaultPrevented) return
          const el = e.target as HTMLElement
          if (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA') return el.blur()
          if (pop) return setPop(null)
          onClose()
        }}
        onPaste={(e) => {
          const files = [...e.clipboardData.files]
          if (files.length) {
            e.preventDefault()
            props.onPasteFiles(files)
          }
        }}
      >
        {task.cover && (
          <div
            className="dv-detail-cover"
            style={'color' in task.cover ? { background: task.cover.color } : undefined}
          >
            {'url' in task.cover && <img src={task.cover.url} alt="" draggable={false} />}
            <button
              className="dv-btn !h-7"
              onClick={(e) => openPop(e, { kind: 'cover' })}
              title="Change cover"
            >
              <ImageIcon size={13} />
              Cover
            </button>
          </div>
        )}

        {/* ---------- header ---------- */}
        <header className="dv-detail-head">
          <div className="min-w-0 flex-1">
            <textarea
              id="card-detail-title"
              className="dv-detail-title"
              aria-label="Card title"
              rows={1}
              maxLength={LIMITS.taskTitle}
              value={title}
              data-done={props.done}
              onFocus={() => (titleFocused.current = true)}
              onChange={(e) => setTitle(e.target.value.replace(/\n/g, ''))}
              onBlur={saveTitle}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault()
                  e.currentTarget.blur()
                }
                if (e.key === 'Escape') {
                  e.preventDefault()
                  setTitle(task.title)
                  titleFocused.current = false
                  e.currentTarget.blur()
                }
              }}
            />
            <p className="dv-detail-sub">
              in list <strong>{props.listName}</strong>
              {props.done && (
                <span className="dv-detail-done">
                  <CircleCheck size={12} /> Done
                </span>
              )}
            </p>
          </div>
          {userId && (
            <button
              className="dv-btn !h-8"
              data-active={props.watching}
              aria-pressed={props.watching}
              title={
                props.watching
                  ? 'You’ll be notified when this card changes. Click to stop.'
                  : 'Get notified when this card changes or gets a comment'
              }
              onClick={props.onToggleWatch}
            >
              {props.watching ? <Eye size={14} /> : <EyeOff size={14} />}
              {props.watching ? 'Watching' : 'Watch'}
            </button>
          )}
          <button
            className="dv-iconbtn"
            aria-label="Close card"
            title="Close (Esc)"
            onClick={onClose}
          >
            <X size={15} />
          </button>
        </header>

        {/* ---------- properties ---------- */}
        <div className="dv-detail-props">
          {onCard.map((f) => {
            const option = resolveOption(f.options, fieldValue(task, f.field), 'status')
            return (
              <div key={f.field} className="dv-prop-row">
                <span className="dv-prop-name" title={f.name}>
                  {f.name}
                </span>
                <div className="flex min-w-0 flex-1 items-center gap-1.5">
                  <button
                    className="dv-chip dv-prop-value"
                    style={badgeStyle(option.color)}
                    title={`Change ${f.name}`}
                    onClick={(e) => openPop(e, { kind: 'field', field: f.field })}
                  >
                    <span className="dv-dot" style={{ background: option.color }} />
                    <span className="truncate">{option.label}</span>
                    <ChevronDown size={11} aria-hidden />
                  </button>
                  {props.doneRule.field === f.field && (
                    <span
                      className="dv-prop-done"
                      title={`Setting ${f.name} to “${resolveOption(f.options, props.doneRule.value, 'status').label}” crosses this card off`}
                    >
                      <CircleCheck size={13} aria-hidden />
                    </span>
                  )}
                  <button
                    className="dv-iconbtn dv-prop-remove !h-6 !w-6"
                    title={`Remove ${f.name} from this card`}
                    aria-label={`Remove ${f.name} from this card`}
                    onClick={() => setField(f.field, null)}
                  >
                    <X size={12} />
                  </button>
                </div>
              </div>
            )
          })}

          <div className="dv-prop-row">
            <span className="dv-prop-name">Labels</span>
            <div className="flex min-w-0 flex-1 flex-wrap items-center gap-1.5">
              {cardLabels.map((l) => (
                <button
                  key={l.id}
                  className="dv-label"
                  style={{ '--label': l.color } as React.CSSProperties}
                  title="Change labels"
                  onClick={(e) => openPop(e, { kind: 'labels' })}
                >
                  {l.name || ' '}
                </button>
              ))}
              <button
                className="dv-prop-add !mt-0"
                aria-label="Add or remove labels"
                onClick={(e) => openPop(e, { kind: 'labels' })}
              >
                <Plus size={12} />
                {cardLabels.length ? '' : 'Add label'}
              </button>
            </div>
          </div>

          <div className="dv-prop-row">
            <span className="dv-prop-name">Members</span>
            <div className="flex min-w-0 flex-1 flex-wrap items-center gap-1.5">
              {members.map((p) => (
                <Avatar
                  key={p.id}
                  name={p.name}
                  color={colorFor(p.id)}
                  src={p.avatarUrl}
                  size={24}
                  data-tip={p.name}
                  aria-label={p.name}
                />
              ))}
              <button
                className="dv-prop-add !mt-0"
                aria-label="Add or remove members"
                onClick={(e) => openPop(e, { kind: 'members' })}
              >
                <Plus size={12} />
                {members.length ? '' : 'Add member'}
              </button>
              {userId && !isMember && people.some((p) => p.id === userId) && (
                <button
                  className="dv-link text-xs"
                  onClick={() => onPatch({ memberIds: [...task.memberIds, userId] })}
                >
                  Join
                </button>
              )}
            </div>
          </div>

          <div className="dv-prop-row">
            <span className="dv-prop-name">Due date</span>
            <button
              className="dv-chip dv-due"
              data-state={due ?? 'none'}
              title={task.dueDate && due ? dueTitle(task.dueDate, due) : 'Set a due date'}
              onClick={(e) => openPop(e, { kind: 'due' })}
            >
              <CalendarDays size={12} />
              {task.dueDate ? dueLabel(task.dueDate) : 'Set date'}
              {due === 'overdue' && <span className="dv-due-tag">Overdue</span>}
              {due === 'done' && <Check size={11} />}
            </button>
          </div>

          {(missing.length > 0 || !task.cover) && (
            <div className="flex flex-wrap gap-1.5 pl-1 pt-1">
              {missing.length > 0 && (
                <button
                  className="dv-prop-add !mt-0"
                  onClick={(e) => openPop(e, { kind: 'add_field' })}
                >
                  <Plus size={12} />
                  Add category
                </button>
              )}
              {!task.cover && (
                <button
                  className="dv-prop-add !mt-0"
                  onClick={(e) => openPop(e, { kind: 'cover' })}
                >
                  <ImageIcon size={12} />
                  Cover
                </button>
              )}
            </div>
          )}
        </div>

        {/* ---------- notes ---------- */}
        <section className="dv-detail-section">
          <h3 className="dv-detail-h">
            <AlignLeft size={15} />
            Notes
          </h3>
          {editingNotes ? (
            <div className="flex flex-col gap-2">
              <textarea
                autoFocus
                className="dv-input"
                rows={5}
                value={description}
                placeholder="Add more detail, links, context… (paste files to attach them)"
                onChange={(e) => setDescription(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) saveNotes()
                  if (e.key === 'Escape') {
                    e.preventDefault()
                    setDescription(task.description)
                    setEditingNotes(false)
                  }
                }}
              />
              <div className="flex items-center gap-2">
                <button
                  className="dv-btn primary"
                  onMouseDown={(e) => e.preventDefault()}
                  onClick={saveNotes}
                >
                  Save
                </button>
                <button
                  className="dv-btn"
                  onClick={() => {
                    setDescription(task.description)
                    setEditingNotes(false)
                  }}
                >
                  Cancel
                </button>
                <span className="ml-auto text-[11px]" style={{ color: 'var(--dv-muted)' }}>
                  ⌘/Ctrl + Enter to save
                </span>
              </div>
            </div>
          ) : (
            <button
              className="dv-detail-notes"
              data-empty={!task.description}
              onClick={() => setEditingNotes(true)}
            >
              {task.description || 'Add more detail…'}
            </button>
          )}
        </section>

        {/* ---------- checklists ---------- */}
        {task.checklists.map((list) => (
          <ChecklistBlock
            key={list.id}
            list={list}
            autoAdd={focusNewItem === list.id}
            onAutoAddDone={() => setFocusNewItem(null)}
            onChange={(next) =>
              setChecklists(task.checklists.map((l) => (l.id === list.id ? next : l)))
            }
            onDelete={() => removeChecklist(list)}
          />
        ))}

        {/* ---------- attachments ---------- */}
        {task.files.length > 0 && (
          <section className="dv-detail-section">
            <h3 className="dv-detail-h">
              <Paperclip size={15} />
              Attachments
            </h3>
            <div className="flex flex-wrap gap-2">
              {images.map((f) => (
                <div key={f.url} className="dv-detail-thumb">
                  <button
                    title="View"
                    onClick={() => props.onOpenFile(ordered, ordered.indexOf(f))}
                  >
                    <img src={f.url} alt="" draggable={false} />
                  </button>
                  <span className="truncate">{f.name}</span>
                  <div className="dv-detail-thumb-actions">
                    <button
                      title={
                        task.cover && 'url' in task.cover && task.cover.url === f.url
                          ? 'Remove cover'
                          : 'Make cover'
                      }
                      onClick={() =>
                        onPatch({
                          cover:
                            task.cover && 'url' in task.cover && task.cover.url === f.url
                              ? null
                              : { url: f.url },
                        })
                      }
                    >
                      <ImageIcon size={12} />
                    </button>
                    <button title="Remove file" onClick={() => props.onRemoveFile(f.url)}>
                      <X size={12} />
                    </button>
                  </div>
                </div>
              ))}
            </div>
            {others.length > 0 && (
              <div className="mt-2 flex flex-col gap-1">
                {others.map((f) => (
                  <div key={f.url} className="flex items-center gap-1">
                    <div className="min-w-0 flex-1">
                      <FileChip
                        file={f}
                        onClick={() => props.onOpenFile(ordered, ordered.indexOf(f))}
                      />
                    </div>
                    <button
                      className="dv-iconbtn !h-6 !w-6"
                      title="Remove file"
                      onClick={() => props.onRemoveFile(f.url)}
                    >
                      <X size={12} />
                    </button>
                  </div>
                ))}
              </div>
            )}
          </section>
        )}

        {/* ---------- add to card ---------- */}
        <div className="flex flex-wrap gap-2">
          <button className="dv-btn" onClick={addChecklist}>
            <CheckSquare size={14} />
            Checklist
          </button>
          <button className="dv-btn" onClick={props.onPickFiles}>
            <Paperclip size={14} />
            Attach files
          </button>
          <button className="dv-btn" onClick={props.onSendToCanvas}>
            <PenTool size={14} />
            Show on canvas
          </button>
          <button
            className="dv-btn ml-auto"
            title="Hide this card from the board. You can restore it from the archive."
            onClick={props.onArchive}
          >
            <Archive size={14} />
            Archive
          </button>
        </div>

        {/* ---------- comments & activity ---------- */}
        <section className="dv-detail-section">
          <div className="flex items-center justify-between gap-2">
            <h3 className="dv-detail-h !mb-0">
              <MessageSquare size={15} />
              Comments and activity
            </h3>
            <button
              className="dv-link text-xs"
              onClick={() => {
                setShowDetails((v) => {
                  try {
                    localStorage.setItem(SHOW_DETAILS_KEY, String(!v))
                  } catch {
                    /* not remembered */
                  }
                  return !v
                })
              }}
            >
              {showDetails ? 'Hide activity' : 'Show activity'}
            </button>
          </div>
          <CommentComposer people={people} onSubmit={postComment} />
          {feedError && (
            <p className="m-0 text-xs" style={{ color: 'var(--dv-muted)' }}>
              Comments aren’t available yet: the database needs its latest update.
            </p>
          )}
          <ol className="dv-feed">
            {feed.map((item) =>
              item.type === 'comment' ? (
                <CommentItem
                  key={`c${item.c.id}`}
                  comment={item.c}
                  people={people}
                  mine={!!userId && item.c.authorId === userId}
                  onEdit={(body) => editComment(item.c, body)}
                  onDelete={() => deleteComment(item.c)}
                />
              ) : (
                <li key={`a${item.a.id}`} className="dv-feed-activity">
                  <span className="dv-feed-dot" aria-hidden />
                  <span>
                    <strong>{item.a.actorName}</strong>{' '}
                    {describeActivity(item.a.kind, item.a.detail, names)}
                  </span>
                  <time dateTime={item.a.createdAt} title={fullDate(item.a.createdAt)}>
                    {relative(item.a.createdAt)}
                  </time>
                </li>
              ),
            )}
            {feed.length === 0 && !feedError && (
              <li className="text-xs" style={{ color: 'var(--dv-muted)' }}>
                No comments yet.
              </li>
            )}
          </ol>
        </section>
      </section>

      {/* ---------- popovers (above the dialog) ---------- */}
      {pop && (
        <>
          <div className="fixed inset-0 z-[94]" onMouseDown={() => setPop(null)} />
          <div
            className="dv-menu fixed z-[95] w-[272px]"
            style={{ left: pop.x, top: pop.y }}
            onMouseDown={(e) => e.stopPropagation()}
          >
            {pop.kind === 'field' &&
              (() => {
                const f = fields.find((x) => x.field === pop.field)
                if (!f) return null
                const current = fieldValue(task, f.field)
                return (
                  <>
                    <div className="dv-menu-head">{f.name}</div>
                    {f.options.map((o) => (
                      <button
                        key={o.value}
                        className="dv-menu-item"
                        data-selected={current === o.value}
                        onClick={() => {
                          setField(f.field, o.value)
                          setPop(null)
                        }}
                      >
                        <span className="dv-dot" style={{ background: o.color }} />
                        <span className="flex-1 truncate">{o.label}</span>
                        {current === o.value && <Check size={14} />}
                      </button>
                    ))}
                  </>
                )
              })()}

            {pop.kind === 'add_field' && (
              <>
                <div className="dv-menu-head">Add to this card</div>
                {missing.map((f) => {
                  const start = resolveOption(f.options, props.defaultValueOf(f.field), 'status')
                  return (
                    <button
                      key={f.field}
                      className="dv-menu-item"
                      onClick={() => {
                        setField(f.field, props.defaultValueOf(f.field))
                        setPop(null)
                      }}
                    >
                      <Plus size={14} />
                      <span className="flex-1 truncate">{f.name}</span>
                      <span
                        className="dv-chip !h-[18px] !cursor-inherit"
                        style={badgeStyle(start.color)}
                      >
                        {start.label}
                      </span>
                    </button>
                  )
                })}
              </>
            )}

            {pop.kind === 'labels' && (
              <LabelPicker
                labels={labels}
                selected={task.labelIds}
                onToggle={(id) =>
                  onPatch({
                    labelIds: task.labelIds.includes(id)
                      ? task.labelIds.filter((x) => x !== id)
                      : [...task.labelIds, id],
                  })
                }
                onCreate={async (name, color) => {
                  const label = await props.onCreateLabel(name, color)
                  if (label) onPatch({ labelIds: [...task.labelIds, label.id] })
                }}
                onUpdate={props.onUpdateLabel}
                onDelete={props.onDeleteLabel}
              />
            )}

            {pop.kind === 'members' && (
              <>
                <div className="dv-menu-head">Members</div>
                {people.map((p) => {
                  const on = task.memberIds.includes(p.id)
                  return (
                    <button
                      key={p.id}
                      className="dv-menu-item"
                      data-selected={on}
                      onClick={() =>
                        onPatch({
                          memberIds: on
                            ? task.memberIds.filter((x) => x !== p.id)
                            : [...task.memberIds, p.id],
                        })
                      }
                    >
                      <Avatar name={p.name} color={colorFor(p.id)} src={p.avatarUrl} size={20} />
                      <span className="flex-1 truncate">
                        {p.name}
                        {p.id === userId && ' (you)'}
                      </span>
                      {on && <Check size={14} />}
                    </button>
                  )
                })}
                {people.length === 0 && (
                  <p className="m-0 px-2 py-1.5 text-xs" style={{ color: 'var(--dv-muted)' }}>
                    <UserRound size={12} className="mr-1 inline" />
                    No one to add yet.
                  </p>
                )}
                <p
                  className="m-0 px-2 pb-1.5 pt-1 text-[11px]"
                  style={{ color: 'var(--dv-muted)' }}
                >
                  Signed-in people who have opened this room. Guests can’t be added.
                </p>
              </>
            )}

            {pop.kind === 'due' && (
              <DuePicker
                value={task.dueDate}
                onPick={(dueDate) => {
                  onPatch({ dueDate })
                  setPop(null)
                }}
              />
            )}

            {pop.kind === 'cover' && (
              <>
                <div className="dv-menu-head">Cover</div>
                <div className="dv-swatches px-2 pb-2">
                  {COVER_COLORS.map((c) => (
                    <button
                      key={c}
                      className="dv-swatch"
                      style={{ background: c }}
                      aria-label={`Colour ${c}`}
                      data-selected={
                        !!task.cover && 'color' in task.cover && task.cover.color === c
                      }
                      onClick={() => onPatch({ cover: { color: c } })}
                    />
                  ))}
                </div>
                {images.length > 0 && (
                  <>
                    <div className="dv-menu-head">From attachments</div>
                    <div className="grid grid-cols-3 gap-1.5 px-2 pb-2">
                      {images.map((f) => (
                        <button
                          key={f.url}
                          className="dv-cover-thumb"
                          data-selected={
                            !!task.cover && 'url' in task.cover && task.cover.url === f.url
                          }
                          onClick={() => onPatch({ cover: { url: f.url } })}
                          title={f.name}
                        >
                          <img src={f.url} alt="" draggable={false} />
                        </button>
                      ))}
                    </div>
                  </>
                )}
                {task.cover && (
                  <button
                    className="dv-menu-item"
                    onClick={() => {
                      onPatch({ cover: null })
                      setPop(null)
                    }}
                  >
                    <X size={14} />
                    Remove cover
                  </button>
                )}
              </>
            )}
          </div>
        </>
      )}
    </div>
  )
}

// ---------------------------------------------------------------------------------------------

const ChecklistBlock: React.FC<{
  list: Checklist
  autoAdd: boolean
  onAutoAddDone: () => void
  onChange: (list: Checklist) => void
  onDelete: () => void
}> = ({ list, autoAdd, onAutoAddDone, onChange, onDelete }) => {
  const [adding, setAdding] = useState(autoAdd)
  const [draft, setDraft] = useState('')
  const [editingTitle, setEditingTitle] = useState(false)
  const [titleDraft, setTitleDraft] = useState(list.title)
  const [editingItem, setEditingItem] = useState<{ id: string; text: string } | null>(null)
  const [hideDone, setHideDone] = useState(false)
  const { done, total } = checklistProgress([list])
  const pct = total ? Math.round((done / total) * 100) : 0

  useEffect(() => {
    if (autoAdd) onAutoAddDone()
  }, [autoAdd, onAutoAddDone])

  const addItem = () => {
    const text = cleanLine(draft, 200)
    if (!text) return
    onChange({ ...list, items: [...list.items, { id: newId(), text, done: false }] })
    setDraft('')
  }

  const saveItem = () => {
    if (!editingItem) return
    const text = cleanLine(editingItem.text, 200)
    onChange({
      ...list,
      items: text
        ? list.items.map((i) => (i.id === editingItem.id ? { ...i, text } : i))
        : list.items.filter((i) => i.id !== editingItem.id),
    })
    setEditingItem(null)
  }

  const visible = hideDone ? list.items.filter((i) => !i.done) : list.items

  return (
    <section className="dv-detail-section">
      <div className="flex items-center gap-2">
        <CheckSquare size={15} style={{ color: 'var(--dv-muted)', flexShrink: 0 }} />
        {editingTitle ? (
          <input
            autoFocus
            className="dv-input !h-8 min-w-0 flex-1"
            aria-label="Checklist title"
            value={titleDraft}
            maxLength={60}
            onChange={(e) => setTitleDraft(e.target.value)}
            onBlur={() => {
              const t = cleanLine(titleDraft, 60)
              if (t && t !== list.title) onChange({ ...list, title: t })
              else setTitleDraft(list.title)
              setEditingTitle(false)
            }}
            onKeyDown={(e) => {
              if (e.key === 'Enter') e.currentTarget.blur()
              if (e.key === 'Escape') {
                e.preventDefault()
                setTitleDraft(list.title)
                setEditingTitle(false)
              }
            }}
          />
        ) : (
          <h3
            className="dv-detail-h !mb-0 min-w-0 flex-1 cursor-text truncate"
            title="Click to rename"
            onClick={() => {
              setTitleDraft(list.title)
              setEditingTitle(true)
            }}
          >
            {list.title}
          </h3>
        )}
        {done > 0 && (
          <button className="dv-link text-xs" onClick={() => setHideDone((v) => !v)}>
            {hideDone ? `Show checked (${done})` : 'Hide checked'}
          </button>
        )}
        <button className="dv-iconbtn danger !h-7 !w-7" title="Delete checklist" onClick={onDelete}>
          <Trash2 size={13} />
        </button>
      </div>
      <div className="dv-progress" data-complete={total > 0 && done === total}>
        <span className="dv-progress-pct">{pct}%</span>
        <div className="dv-progress-track">
          <div className="dv-progress-bar" style={{ width: `${pct}%` }} />
        </div>
      </div>
      <ul className="dv-checklist">
        {visible.map((item) => (
          <li key={item.id} data-done={item.done}>
            <label className="dv-check">
              <input
                type="checkbox"
                checked={item.done}
                onChange={() =>
                  onChange({
                    ...list,
                    items: list.items.map((i) => (i.id === item.id ? { ...i, done: !i.done } : i)),
                  })
                }
              />
              <span aria-hidden>
                <Check size={11} strokeWidth={3} />
              </span>
            </label>
            {editingItem?.id === item.id ? (
              <input
                autoFocus
                className="dv-input !h-8 min-w-0 flex-1"
                aria-label="Item text"
                value={editingItem.text}
                onChange={(e) => setEditingItem({ ...editingItem, text: e.target.value })}
                onBlur={saveItem}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') e.currentTarget.blur()
                  if (e.key === 'Escape') {
                    e.preventDefault()
                    setEditingItem(null)
                  }
                }}
              />
            ) : (
              <span
                className="dv-checklist-text"
                title="Click to edit"
                onClick={() => setEditingItem({ id: item.id, text: item.text })}
              >
                {item.text}
              </span>
            )}
            <button
              className="dv-iconbtn dv-checklist-del !h-6 !w-6"
              title="Delete item"
              aria-label={`Delete “${item.text}”`}
              onClick={() =>
                onChange({ ...list, items: list.items.filter((i) => i.id !== item.id) })
              }
            >
              <X size={12} />
            </button>
          </li>
        ))}
        {hideDone && done === total && total > 0 && (
          <li className="text-xs" style={{ color: 'var(--dv-muted)' }}>
            Everything is checked off.
          </li>
        )}
      </ul>
      {adding ? (
        <div className="flex flex-col gap-2 pl-7">
          <input
            autoFocus
            className="dv-input"
            placeholder="Add an item"
            aria-label="New checklist item"
            value={draft}
            maxLength={200}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault()
                addItem()
              }
              if (e.key === 'Escape') {
                e.preventDefault()
                setDraft('')
                setAdding(false)
              }
            }}
          />
          <div className="flex items-center gap-2">
            <button className="dv-btn primary" disabled={!draft.trim()} onClick={addItem}>
              Add
            </button>
            <button
              className="dv-btn"
              onClick={() => {
                setDraft('')
                setAdding(false)
              }}
            >
              Done
            </button>
            <span className="ml-auto text-[11px]" style={{ color: 'var(--dv-muted)' }}>
              Enter adds another
            </span>
          </div>
        </div>
      ) : (
        <button className="dv-btn self-start sm:ml-7" onClick={() => setAdding(true)}>
          <Plus size={13} />
          Add an item
        </button>
      )}
    </section>
  )
}

// ---------------------------------------------------------------------------------------------

const LabelPicker: React.FC<{
  labels: Label[]
  selected: string[]
  onToggle: (id: string) => void
  onCreate: (name: string, color: string) => void
  onUpdate: (label: Label) => void
  onDelete: (label: Label) => void
}> = ({ labels, selected, onToggle, onCreate, onUpdate, onDelete }) => {
  const [query, setQuery] = useState('')
  const [form, setForm] = useState<{ id?: string; name: string; color: string } | null>(null)
  const q = query.trim().toLowerCase()
  const shown = labels.filter((l) => !q || l.name.toLowerCase().includes(q))

  if (form)
    return (
      <form
        className="flex flex-col gap-2 p-2"
        onSubmit={(e) => {
          e.preventDefault()
          const name = cleanLine(form.name, 40)
          if (form.id) onUpdate({ id: form.id, name, color: form.color })
          else onCreate(name, form.color)
          setForm(null)
          setQuery('')
        }}
      >
        <div className="dv-menu-head !px-0">{form.id ? 'Edit label' : 'Create a label'}</div>
        <div className="dv-label-preview">
          <span className="dv-label" style={{ '--label': form.color } as React.CSSProperties}>
            {form.name.trim() || ' '}
          </span>
        </div>
        <input
          autoFocus
          className="dv-input"
          placeholder="Name (optional)"
          aria-label="Label name"
          maxLength={40}
          value={form.name}
          onChange={(e) => setForm({ ...form, name: e.target.value })}
        />
        <div className="dv-swatches">
          {LABEL_COLORS.map((c) => (
            <button
              key={c}
              type="button"
              className="dv-swatch"
              style={{ background: c }}
              aria-label={`Colour ${c}`}
              data-selected={form.color === c}
              onClick={() => setForm({ ...form, color: c })}
            />
          ))}
        </div>
        <div className="flex items-center gap-2">
          <button className="dv-btn primary">{form.id ? 'Save' : 'Create'}</button>
          <button type="button" className="dv-btn" onClick={() => setForm(null)}>
            Back
          </button>
          {form.id && (
            <button
              type="button"
              className="dv-btn danger ml-auto"
              onClick={() => {
                const label = labels.find((l) => l.id === form.id)
                if (label) onDelete(label)
                setForm(null)
              }}
            >
              Delete
            </button>
          )}
        </div>
        {form.id && (
          <p className="m-0 text-[11px]" style={{ color: 'var(--dv-muted)' }}>
            Deleting a label removes it from every card.
          </p>
        )}
      </form>
    )

  return (
    <>
      <div className="dv-menu-head">Labels</div>
      {labels.length > 5 && (
        <div className="px-2 pb-1">
          <input
            autoFocus
            className="dv-input !h-8"
            placeholder="Search labels"
            aria-label="Search labels"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
        </div>
      )}
      <div className="max-h-64 overflow-y-auto">
        {shown.map((l) => {
          const on = selected.includes(l.id)
          return (
            <div key={l.id} className="flex items-center gap-1 px-1">
              <button
                className="dv-menu-item !px-1.5"
                role="menuitemcheckbox"
                aria-checked={on}
                onClick={() => onToggle(l.id)}
              >
                <span className="dv-check-box" data-on={on} aria-hidden>
                  {on && <Check size={11} strokeWidth={3} />}
                </span>
                <span
                  className="dv-label flex-1 !justify-start"
                  style={{ '--label': l.color } as React.CSSProperties}
                >
                  {l.name || ' '}
                </span>
              </button>
              <button
                className="dv-iconbtn !h-7 !w-7 shrink-0"
                title={`Edit ${l.name || 'label'}`}
                onClick={() => setForm({ id: l.id, name: l.name, color: l.color })}
              >
                <Pencil size={12} />
              </button>
            </div>
          )
        })}
        {labels.length === 0 && (
          <p className="m-0 px-2 py-1 text-xs" style={{ color: 'var(--dv-muted)' }}>
            <Tag size={12} className="mr-1 inline" />
            Labels are coloured tags you can add to any card, several at a time.
          </p>
        )}
      </div>
      <button
        className="dv-menu-item mt-1"
        onClick={() =>
          setForm({
            name: query,
            color: LABEL_COLORS[labels.length % LABEL_COLORS.length],
          })
        }
      >
        <Plus size={14} />
        {query.trim() ? `Create “${query.trim()}”` : 'Create a label'}
      </button>
    </>
  )
}

// ---------------------------------------------------------------------------------------------

const isoDay = (offset: number) => {
  const d = new Date()
  d.setDate(d.getDate() + offset)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

const DuePicker: React.FC<{ value: string | null; onPick: (v: string | null) => void }> = ({
  value,
  onPick,
}) => {
  const nextMonday = (8 - new Date().getDay()) % 7 || 7
  return (
    <div className="flex flex-col gap-1 p-1">
      <div className="dv-menu-head">Due date</div>
      <button className="dv-menu-item" onClick={() => onPick(isoDay(0))}>
        Today
      </button>
      <button className="dv-menu-item" onClick={() => onPick(isoDay(1))}>
        Tomorrow
      </button>
      <button className="dv-menu-item" onClick={() => onPick(isoDay(nextMonday))}>
        Next Monday
      </button>
      <div className="px-1 pt-1">
        <input
          type="date"
          className="dv-input"
          aria-label="Pick a date"
          value={value ?? ''}
          onClick={(e) => e.currentTarget.showPicker?.()}
          onChange={(e) => e.target.value && onPick(e.target.value)}
        />
      </div>
      {value && (
        <button className="dv-menu-item danger mt-1" onClick={() => onPick(null)}>
          <X size={14} />
          Remove due date ({formatDueDate(value)})
        </button>
      )}
    </div>
  )
}

// ---------------------------------------------------------------------------------------------

/** A comment box with @mention suggestions (signed-in people in the room). */
const CommentComposer: React.FC<{
  people: TaskAssignee[]
  initial?: string
  autoFocus?: boolean
  submitLabel?: string
  onSubmit: (body: string) => Promise<boolean | void> | void
  onCancel?: () => void
}> = ({ people, initial = '', autoFocus, submitLabel = 'Comment', onSubmit, onCancel }) => {
  const [text, setText] = useState(initial)
  const [focused, setFocused] = useState(!!autoFocus)
  const [busy, setBusy] = useState(false)
  const [mention, setMention] = useState<{ start: number; query: string; index: number } | null>(
    null,
  )
  const ref = useRef<HTMLTextAreaElement>(null)

  const matches = mention
    ? people.filter((p) => p.name.toLowerCase().startsWith(mention.query.toLowerCase())).slice(0, 6)
    : []

  const updateMention = (value: string, caret: number) => {
    const before = value.slice(0, caret)
    const m = before.match(/(^|\s)@([a-z0-9_]*)$/i)
    setMention(m ? { start: caret - m[2].length - 1, query: m[2], index: 0 } : null)
  }

  const insertMention = (name: string) => {
    if (!mention || !ref.current) return
    const caret = ref.current.selectionStart
    const next = `${text.slice(0, mention.start)}@${name} ${text.slice(caret)}`
    setText(next)
    setMention(null)
    const pos = mention.start + name.length + 2
    requestAnimationFrame(() => {
      ref.current?.focus()
      ref.current?.setSelectionRange(pos, pos)
    })
  }

  const submit = async () => {
    const body = cleanMultiline(text, 4000)
    if (!body || busy) return
    setBusy(true)
    const ok = await onSubmit(body)
    setBusy(false)
    if (ok !== false) {
      setText('')
      setFocused(false)
      ref.current?.blur()
    }
  }

  const open = focused || !!text
  return (
    <div className="dv-composer" data-open={open}>
      <div className="relative">
        <textarea
          ref={ref}
          autoFocus={autoFocus}
          className="dv-input"
          rows={open ? 3 : 1}
          placeholder="Write a comment… type @ to mention someone"
          aria-label="Write a comment"
          value={text}
          onFocus={() => setFocused(true)}
          onBlur={() => window.setTimeout(() => setMention(null), 120)}
          onChange={(e) => {
            setText(e.target.value)
            updateMention(e.target.value, e.target.selectionStart)
          }}
          onKeyDown={(e) => {
            if (mention && matches.length) {
              if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
                e.preventDefault()
                const step = e.key === 'ArrowDown' ? 1 : -1
                setMention({
                  ...mention,
                  index: (mention.index + step + matches.length) % matches.length,
                })
                return
              }
              if (e.key === 'Enter' || e.key === 'Tab') {
                e.preventDefault()
                insertMention(matches[mention.index].name)
                return
              }
            }
            if (e.key === 'Escape') {
              e.preventDefault()
              if (mention) return setMention(null)
              if (onCancel) return onCancel()
              e.currentTarget.blur()
            }
            if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
              e.preventDefault()
              submit()
            }
          }}
        />
        {mention && matches.length > 0 && (
          <div className="dv-menu dv-mention-menu" role="listbox" aria-label="Mention someone">
            {matches.map((p, i) => (
              <button
                key={p.id}
                role="option"
                aria-selected={i === mention.index}
                className="dv-menu-item"
                data-selected={i === mention.index}
                onMouseDown={(e) => {
                  e.preventDefault()
                  insertMention(p.name)
                }}
              >
                <Avatar name={p.name} color={colorFor(p.id)} src={p.avatarUrl} size={18} />
                {p.name}
              </button>
            ))}
          </div>
        )}
      </div>
      {open && (
        <div className="flex items-center gap-2">
          <button
            className="dv-btn primary"
            disabled={!text.trim() || busy}
            onMouseDown={(e) => e.preventDefault()}
            onClick={submit}
          >
            {submitLabel}
          </button>
          {(onCancel || text) && (
            <button
              className="dv-btn"
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => {
                if (onCancel) return onCancel()
                setText('')
                setFocused(false)
              }}
            >
              Cancel
            </button>
          )}
          <span className="ml-auto text-[11px]" style={{ color: 'var(--dv-muted)' }}>
            ⌘/Ctrl + Enter to send
          </span>
        </div>
      )}
    </div>
  )
}

const CommentItem: React.FC<{
  comment: Comment
  people: TaskAssignee[]
  mine: boolean
  onEdit: (body: string) => void
  onDelete: () => void
}> = ({ comment, people, mine, onEdit, onDelete }) => {
  const [editing, setEditing] = useState(false)
  const [confirming, setConfirming] = useState(false)
  const person = people.find((p) => p.id === comment.authorId)
  const parts = splitMentions(
    comment.body,
    people.map((p) => p.name),
  )
  return (
    <li className="dv-feed-comment">
      <Avatar
        name={comment.authorName}
        color={colorFor(comment.authorId)}
        src={person?.avatarUrl}
        size={26}
      />
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-baseline gap-x-2">
          <strong className="text-[13px]">{comment.authorName}</strong>
          <time
            className="text-[11px]"
            style={{ color: 'var(--dv-muted)' }}
            dateTime={comment.createdAt}
            title={fullDate(comment.createdAt)}
          >
            {relative(comment.createdAt)}
            {comment.editedAt && ' (edited)'}
          </time>
        </div>
        {editing ? (
          <CommentComposer
            people={people}
            initial={comment.body}
            autoFocus
            submitLabel="Save"
            onSubmit={(body) => {
              onEdit(body)
              setEditing(false)
            }}
            onCancel={() => setEditing(false)}
          />
        ) : (
          <p className="dv-comment-body">
            {parts.map((p, i) =>
              p.mention ? (
                <span key={i} className="dv-mention">
                  {p.text}
                </span>
              ) : (
                <React.Fragment key={i}>{p.text}</React.Fragment>
              ),
            )}
          </p>
        )}
        {mine && !editing && (
          <div className="dv-comment-actions">
            {confirming ? (
              <>
                <span>Delete this comment?</span>
                <button className="dv-link danger" onClick={onDelete}>
                  Delete
                </button>
                <button className="dv-link" onClick={() => setConfirming(false)}>
                  Cancel
                </button>
              </>
            ) : (
              <>
                <button className="dv-link" onClick={() => setEditing(true)}>
                  Edit
                </button>
                <button className="dv-link" onClick={() => setConfirming(true)}>
                  Delete
                </button>
              </>
            )}
          </div>
        )}
      </div>
    </li>
  )
}

/** Small icon + number badges on the card front (notes, files, checklist, comments). */
export const CardBadges: React.FC<{
  description: boolean
  files: number
  checklist: { done: number; total: number }
  comments: number
  watching: boolean
}> = ({ description, files, checklist, comments, watching }) => {
  if (!description && !files && !checklist.total && !comments && !watching) return null
  return (
    <div className="dv-badges">
      {watching && (
        <span title="You’re watching this card">
          <Eye size={12} />
        </span>
      )}
      {description && (
        <span title="This card has notes">
          <AlignLeft size={12} />
        </span>
      )}
      {comments > 0 && (
        <span title={`${comments} comment${comments === 1 ? '' : 's'}`}>
          <MessageSquare size={12} />
          {comments}
        </span>
      )}
      {files > 0 && (
        <span title={`${files} attachment${files === 1 ? '' : 's'}`}>
          <Paperclip size={12} />
          {files}
        </span>
      )}
      {checklist.total > 0 && (
        <span
          className="dv-badge-check"
          data-complete={checklist.done === checklist.total}
          title={`Checklist: ${checklist.done} of ${checklist.total} done`}
        >
          <CheckSquare size={12} />
          {checklist.done}/{checklist.total}
        </span>
      )}
    </div>
  )
}
