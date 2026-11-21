import React, { useEffect, useState } from 'react'
import { Copy, MoveRight, X } from 'lucide-react'
import { myRooms } from './lib/rooms'
import { type CopyKeep, KEEP_ALL, countCards, loadLists, type TransferTarget } from './lib/card-transfer'
import { LIMITS } from './lib/sanitize'

export type TransferMode = 'move' | 'copy'

interface ListOption {
  id: string
  name: string
}

interface Props {
  mode: TransferMode
  card: { id: string; title: string; isTemplate: boolean }
  room: { id: string; name: string }
  /** The card's list, and this board's lists with their card counts (no need to fetch those). */
  listId: string
  lists: (ListOption & { count: number })[]
  /** Signed-in people can send cards to their other rooms; guests only within this one. */
  userId: string | null
  onSubmit: (
    target: TransferTarget & { roomName: string; listName: string },
    copy: { title: string; keep: CopyKeep; template: boolean } | null,
  ) => Promise<void>
  onClose: () => void
}

const KEEP_LABELS: [keyof CopyKeep, string][] = [
  ['checklists', 'Checklists'],
  ['labels', 'Labels'],
  ['members', 'Members'],
  ['attachments', 'Attachments'],
  ['dates', 'Due date'],
]

/** "Move card" / "Copy card": pick a room, a list and a position (as in Trello). */
export const CardTransferDialog: React.FC<Props> = (props) => {
  const { mode, card, room, userId, onClose } = props
  const [rooms, setRooms] = useState<{ id: string; name: string }[]>([room])
  const [roomId, setRoomId] = useState(room.id)
  const [lists, setLists] = useState<ListOption[]>(props.lists)
  const [listId, setListId] = useState(props.listId)
  const [count, setCount] = useState(props.lists.find((l) => l.id === props.listId)?.count ?? 0)
  const [position, setPosition] = useState<number | null>(null)
  const [title, setTitle] = useState(card.title)
  const [keep, setKeep] = useState<CopyKeep>(KEEP_ALL)
  const [template, setTemplate] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [loadingLists, setLoadingLists] = useState(false)
  const otherRoom = roomId !== room.id
  const roomName = rooms.find((r) => r.id === roomId)?.name ?? room.name

  useEffect(() => {
    if (!userId) return
    let cancelled = false
    myRooms(userId)
      .then((all) => {
        if (cancelled) return
        const others = all
          .filter((r) => r.roomId !== room.id)
          .map((r) => ({ id: r.roomId, name: r.unnamed ? `${r.roomName} (unsaved)` : r.roomName }))
        setRooms([room, ...others])
      })
      .catch(() => {
        /* only this room, then */
      })
    return () => {
      cancelled = true
    }
  }, [userId, room])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return
      e.preventDefault()
      e.stopPropagation()
      onClose()
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [onClose])

  const pickRoom = async (id: string) => {
    setRoomId(id)
    setError(null)
    setPosition(null)
    if (id === room.id) {
      setLists(props.lists)
      setListId(props.listId)
      setCount(props.lists.find((l) => l.id === props.listId)?.count ?? 0)
      return
    }
    setLoadingLists(true)
    try {
      const next = await loadLists(id)
      setLists(next)
      setListId(next[0]?.id ?? '')
      setCount(next[0] ? await countCards(next[0].id) : 0)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not load that room’s lists')
      setLists([])
      setListId('')
    } finally {
      setLoadingLists(false)
    }
  }

  const pickList = async (id: string) => {
    setListId(id)
    setPosition(null)
    const local = props.lists.find((l) => l.id === id)
    if (!otherRoom && local) return setCount(local.count)
    try {
      setCount(await countCards(id))
    } catch {
      setCount(0)
    }
  }

  // Moving within its own list: it isn't one of the slots it can go to.
  const sameList = mode === 'move' && !otherRoom && listId === props.listId
  const slots = Math.max(1, count + (sameList ? 0 : 1))

  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!listId) return
    setBusy(true)
    setError(null)
    try {
      await props.onSubmit(
        {
          roomId,
          listId,
          position,
          roomName,
          listName: lists.find((l) => l.id === listId)?.name ?? 'a list',
        },
        mode === 'copy' ? { title, keep, template } : null,
      )
    } catch (err) {
      setError(err instanceof Error ? err.message : 'That didn’t work. Try again.')
      setBusy(false)
    }
  }

  const Icon = mode === 'move' ? MoveRight : Copy
  return (
    <div
      className="dv-modal-backdrop z-[96]"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget && !busy) onClose()
      }}
    >
      <form
        className="dv-floating dv-modal dv-transfer"
        role="dialog"
        aria-modal="true"
        aria-labelledby="transfer-title"
        onSubmit={submit}
      >
        <div className="flex items-start justify-between gap-4">
          <h2 id="transfer-title" className="m-0 flex items-center gap-2 text-lg font-semibold">
            <Icon size={18} aria-hidden />
            {mode === 'move' ? 'Move card' : 'Copy card'}
          </h2>
          <button type="button" className="dv-iconbtn !h-7 !w-7" aria-label="Close" onClick={onClose}>
            <X size={14} />
          </button>
        </div>

        {mode === 'copy' && (
          <label className="dv-field">
            <span>Title</span>
            <textarea
              className="dv-input dv-transfer-title"
              rows={2}
              maxLength={LIMITS.taskTitle}
              value={title}
              onChange={(e) => setTitle(e.target.value.replace(/\n/g, ''))}
            />
          </label>
        )}

        <div className="dv-transfer-grid">
          <label className="dv-field dv-transfer-room">
            <span>Room</span>
            <select
              className="dv-input"
              value={roomId}
              disabled={busy}
              onChange={(e) => pickRoom(e.target.value)}
            >
              {rooms.map((r) => (
                <option key={r.id} value={r.id}>
                  {r.name}
                  {r.id === room.id ? ' (this room)' : ''}
                </option>
              ))}
            </select>
          </label>
          <label className="dv-field">
            <span>List</span>
            <select
              className="dv-input"
              value={listId}
              disabled={busy || loadingLists || lists.length === 0}
              onChange={(e) => pickList(e.target.value)}
            >
              {lists.length === 0 && <option value="">{loadingLists ? 'Loading…' : 'No lists'}</option>}
              {lists.map((l) => (
                <option key={l.id} value={l.id}>
                  {l.name}
                  {mode === 'move' && !otherRoom && l.id === props.listId ? ' (current)' : ''}
                </option>
              ))}
            </select>
          </label>
          <label className="dv-field">
            <span>Position</span>
            <select
              className="dv-input"
              value={position ?? 'end'}
              disabled={busy || !listId}
              onChange={(e) => setPosition(e.target.value === 'end' ? null : Number(e.target.value))}
            >
              {Array.from({ length: slots }, (_, i) =>
                i === slots - 1 ? (
                  <option key="end" value="end">
                    {slots === 1 ? '1' : `${slots} (bottom)`}
                  </option>
                ) : (
                  <option key={i} value={i}>
                    {i === 0 ? '1 (top)' : i + 1}
                  </option>
                ),
              )}
            </select>
          </label>
        </div>
        {!userId && (
          <p className="m-0 text-xs" style={{ color: 'var(--dv-muted)' }}>
            Sign in to send cards to your other rooms.
          </p>
        )}

        {mode === 'copy' && (
          <fieldset className="dv-transfer-keep">
            <legend className="dv-label">Keep</legend>
            {KEEP_LABELS.map(([key, label]) => (
              <label key={key} className="dv-tick">
                <input
                  type="checkbox"
                  checked={keep[key]}
                  onChange={(e) => setKeep({ ...keep, [key]: e.target.checked })}
                />
                {label}
              </label>
            ))}
            {card.isTemplate && (
              <label className="dv-tick">
                <input type="checkbox" checked={template} onChange={(e) => setTemplate(e.target.checked)} />
                Keep it a template
              </label>
            )}
          </fieldset>
        )}

        {otherRoom && (
          <p className="dv-transfer-note">
            In <strong>{roomName}</strong>, labels are matched by name (missing ones are added),
            and statuses and categories it doesn’t have are left off. People who have never been in
            that room come off the card.
            {mode === 'move' && ' Comments and activity go with it.'}
            {mode === 'copy' && ' Comments aren’t copied.'}
          </p>
        )}

        {error && (
          <p className="m-0 text-xs" role="alert" style={{ color: 'var(--dv-danger)' }}>
            {error}
          </p>
        )}

        <div className="flex justify-end gap-2">
          <button type="button" className="dv-btn" disabled={busy} onClick={onClose}>
            Cancel
          </button>
          <button
            className="dv-btn primary"
            disabled={busy || !listId || (mode === 'copy' && !title.trim())}
          >
            {busy && <span className="dv-spinner" />}
            {mode === 'move' ? 'Move' : 'Copy'}
          </button>
        </div>
      </form>
    </div>
  )
}
