import React, { useEffect, useId, useRef, useState } from 'react'
import { Check, LogOut, Search, UserRoundCog } from 'lucide-react'
import { Avatar } from './avatar'
import { colorFor } from './lib/room'
import type { RoomPerson } from './lib/rooms'
import { relative } from './lib/time'

const errorText = (e: unknown) =>
  e instanceof Error ? e.message : 'Something went wrong. Try again.'

export interface RoomSettingsActions {
  /** Returns the name as saved (trimmed / normalised by the server). */
  rename: (name: string) => Promise<string>
  setGuestAccess: (allow: boolean) => Promise<void>
  remove: () => Promise<void>
}

export interface LeaveRoomActions {
  /** The owner passes who takes over; members leave with no argument. */
  leave: (newOwnerId?: string) => Promise<void>
  /** Owner only: who they can hand the room to. */
  people: () => Promise<RoomPerson[]>
}

/**
 * Name for an unnamed room: that's what saves it and lets people in with its link.
 * Shown in the room's settings and before sharing it.
 */
export const SaveRoomForm: React.FC<{
  save: (name: string) => Promise<void>
  submitLabel?: string
}> = ({ save, submitLabel = 'Save name' }) => {
  const [name, setName] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const canSave = name.trim().length >= 2

  return (
    <form
      className="flex flex-col gap-2"
      onSubmit={async (e) => {
        e.preventDefault()
        if (!canSave) return
        setBusy(true)
        setError(null)
        try {
          await save(name)
        } catch (err) {
          setError(errorText(err))
          setBusy(false)
        }
      }}
    >
      <span className="dv-label">Name</span>
      <input
        className="dv-input"
        value={name}
        maxLength={48}
        autoFocus
        autoComplete="off"
        placeholder="e.g. Design sprint"
        onChange={(e) => setName(e.target.value)}
      />
      {error && (
        <p className="m-0 text-xs" role="alert" style={{ color: 'var(--dv-danger)' }}>
          {error}
        </p>
      )}
      <button className="dv-btn primary self-start" disabled={!canSave || busy}>
        {busy ? <span className="dv-spinner" /> : submitLabel}
      </button>
    </form>
  )
}

/**
 * Owner-only room settings: rename, guest access, delete. Used in the room header popover
 * and on the rooms page, which supply their own actions (each tells people in the room).
 */
export const RoomSettingsForm: React.FC<{
  roomName: string
  allowGuests: boolean
  actions: RoomSettingsActions
  /** Shown above Delete (see LeaveRoomSection). */
  leave?: React.ReactNode
}> = ({ roomName, allowGuests, actions, leave }) => {
  const [name, setName] = useState(roomName)
  const [confirmName, setConfirmName] = useState('')
  const [busy, setBusy] = useState<'name' | 'guests' | 'delete' | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [saved, setSaved] = useState<string | null>(null)

  const run = async (kind: 'name' | 'guests' | 'delete', fn: () => Promise<void>) => {
    setBusy(kind)
    setError(null)
    setSaved(null)
    try {
      await fn()
    } catch (e) {
      setError(errorText(e))
    } finally {
      setBusy(null)
    }
  }

  const nameChanged = name.trim() !== roomName && name.trim().length >= 2

  return (
    <div className="flex flex-col gap-4">
      <form
        className="flex flex-col gap-2"
        onSubmit={(e) => {
          e.preventDefault()
          if (!nameChanged) return
          run('name', async () => {
            setName(await actions.rename(name))
            setSaved('Room renamed.')
          })
        }}
      >
        <span className="dv-label">Name</span>
        <div className="flex gap-2">
          <input
            className="dv-input"
            value={name}
            maxLength={48}
            onChange={(e) => setName(e.target.value)}
          />
          <button className="dv-btn shrink-0" disabled={!nameChanged || busy !== null}>
            {busy === 'name' ? <span className="dv-spinner" /> : 'Save'}
          </button>
        </div>
      </form>

      <div
        className="flex flex-col gap-2 border-t pt-3"
        style={{ borderColor: 'var(--dv-border)' }}
      >
        <label className="flex items-center justify-between gap-3">
          <span className="dv-label">Guest access</span>
          <span className="dv-switch">
            <input
              type="checkbox"
              role="switch"
              checked={allowGuests}
              disabled={busy !== null}
              onChange={(e) => {
                const allow = e.target.checked
                run('guests', async () => {
                  await actions.setGuestAccess(allow)
                  setSaved(allow ? 'Guests can join again.' : 'Guest access turned off.')
                })
              }}
            />
            <span aria-hidden />
          </span>
        </label>
        <p className="m-0 text-[11px] leading-relaxed" style={{ color: 'var(--dv-muted)' }}>
          {allowGuests
            ? 'People without an account can join from the link, as an anonymous animal. Turning this off removes any guests in the room now.'
            : 'Only signed-in accounts can join. Guests who try get asked to sign in.'}
        </p>
      </div>

      {leave}

      <form
        className="flex flex-col gap-2 border-t pt-3"
        style={{ borderColor: 'var(--dv-border)' }}
        onSubmit={(e) => {
          e.preventDefault()
          if (confirmName.trim() === roomName) run('delete', actions.remove)
        }}
      >
        <span className="dv-label" style={{ color: 'var(--dv-danger)' }}>
          Delete room
        </span>
        <p className="text-[11px] leading-relaxed" style={{ color: 'var(--dv-muted)' }}>
          Permanently deletes the board, canvas and images for everyone. Type{' '}
          <strong>{roomName}</strong> to confirm.
        </p>
        <div className="flex gap-2">
          <input
            className="dv-input"
            value={confirmName}
            placeholder={roomName}
            autoComplete="off"
            onChange={(e) => setConfirmName(e.target.value)}
          />
          <button
            className="dv-btn danger shrink-0"
            disabled={confirmName.trim() !== roomName || busy !== null}
          >
            {busy === 'delete' ? <span className="dv-spinner" /> : 'Delete'}
          </button>
        </div>
      </form>

      {error && (
        <p className="m-0 text-xs" role="alert" style={{ color: 'var(--dv-danger)' }}>
          {error}
        </p>
      )}
      {saved && (
        <p className="m-0 text-xs" role="status" style={{ color: 'var(--dv-success)' }}>
          {saved}
        </p>
      )}
    </div>
  )
}

/**
 * Leaving a room. Members confirm inline. The owner first picks who takes over from everyone
 * (with an account) who has been in the room. Used in the room's settings and on the rooms page.
 */
export const LeaveRoomSection: React.FC<{
  roomName: string
  isOwner: boolean
  actions: LeaveRoomActions
  /** Opens straight to the confirm step / owner picker (from the rooms page's card menu). */
  startOpen?: boolean
  /** Rule above it, separating it from the settings before it. */
  divider?: boolean
  /** "Leave room" label; off where the surrounding title already says it. */
  heading?: boolean
}> = ({ roomName, isOwner, actions, startOpen = false, divider = true, heading = true }) => {
  const [open, setOpen] = useState(startOpen)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const leave = async (newOwnerId?: string) => {
    setBusy(true)
    setError(null)
    try {
      await actions.leave(newOwnerId)
    } catch (e) {
      setError(errorText(e))
      setBusy(false)
    }
  }

  return (
    <section
      className={`flex flex-col gap-2 ${divider ? 'border-t pt-3' : ''}`}
      style={{ borderColor: 'var(--dv-border)' }}
    >
      {heading && <span className="dv-label">Leave room</span>}
      <p className="m-0 text-[11px] leading-relaxed" style={{ color: 'var(--dv-muted)' }}>
        {isOwner
          ? 'You own this room, so choose someone to take it over first. They can then rename it, delete it and decide who can join.'
          : "It'll come off your rooms page. You can rejoin any time from its link."}
      </p>

      {!open ? (
        <button type="button" className="dv-btn self-start" onClick={() => setOpen(true)}>
          {isOwner ? <UserRoundCog size={14} /> : <LogOut size={14} />}
          {isOwner ? 'Choose new owner' : 'Leave room'}
        </button>
      ) : isOwner ? (
        <OwnerPicker
          roomName={roomName}
          load={actions.people}
          busy={busy}
          onCancel={() => {
            setOpen(false)
            setError(null)
          }}
          onConfirm={leave}
        />
      ) : (
        <div className="dv-confirm" role="group" aria-label="Confirm leaving">
          <span className="min-w-0 flex-1 truncate text-xs">
            Leave <strong>{roomName}</strong>?
          </span>
          <button
            type="button"
            className="dv-btn ghost"
            disabled={busy}
            onClick={() => setOpen(false)}
          >
            Cancel
          </button>
          <button
            type="button"
            className="dv-btn danger"
            autoFocus
            disabled={busy}
            onClick={() => leave()}
          >
            {busy ? <span className="dv-spinner" /> : 'Leave'}
          </button>
        </div>
      )}

      {error && (
        <p className="m-0 text-xs" role="alert" style={{ color: 'var(--dv-danger)' }}>
          {error}
        </p>
      )}
    </section>
  )
}

/** Searchable list of everyone who has been in the room; pick one, then hand over and leave. */
const OwnerPicker: React.FC<{
  roomName: string
  load: () => Promise<RoomPerson[]>
  busy: boolean
  onCancel: () => void
  onConfirm: (newOwnerId: string) => void
}> = ({ roomName, load, busy, onCancel, onConfirm }) => {
  const [people, setPeople] = useState<RoomPerson[] | null>(null)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [query, setQuery] = useState('')
  const [picked, setPicked] = useState<string | null>(null)
  const name = useId()
  // Loads once when the picker opens; callers rebuild `load` on every render.
  const loadRef = useRef(load)

  useEffect(() => {
    let live = true
    loadRef
      .current()
      .then((p) => live && setPeople(p))
      .catch((e) => live && setLoadError(errorText(e)))
    return () => {
      live = false
    }
  }, [])

  if (loadError)
    return (
      <p className="m-0 text-xs" role="alert" style={{ color: 'var(--dv-danger)' }}>
        {loadError}
      </p>
    )

  if (people?.length === 0)
    return (
      <div className="dv-people-empty">
        <p className="m-0">
          Nobody else with an account has been in this room yet, so there's no one to hand it to.
          Share it first, or delete it instead.
        </p>
        <button type="button" className="dv-btn self-start" onClick={onCancel}>
          OK
        </button>
      </div>
    )

  const q = query.trim().toLowerCase().replace(/^@/, '')
  const shown = people?.filter((p) => !q || p.username.toLowerCase().includes(q)) ?? null
  const chosen = people?.find((p) => p.userId === picked) ?? null

  return (
    <div className="flex flex-col gap-2">
      <label className="dv-search block">
        <Search size={14} aria-hidden />
        <input
          className="dv-input"
          placeholder="Search people"
          aria-label="Search people who've been in this room"
          autoFocus
          autoComplete="off"
          spellCheck={false}
          value={query}
          disabled={!people}
          onChange={(e) => setQuery(e.target.value)}
        />
      </label>

      <div
        className="dv-people dv-scroll"
        role="radiogroup"
        aria-label="New owner"
        aria-busy={!people}
      >
        {shown === null ? (
          [0, 1, 2].map((i) => (
            <div key={i} className="dv-person" aria-hidden>
              <span className="dv-skel-circle" />
              <span className="flex flex-1 flex-col gap-1.5">
                <span className="dv-skel-line" style={{ width: '45%' }} />
                <span className="dv-skel-line" style={{ width: '70%' }} />
              </span>
            </div>
          ))
        ) : shown.length === 0 ? (
          <p className="dv-people-none">No one matches “{query.trim()}”.</p>
        ) : (
          shown.map((p) => (
            <label key={p.userId} className="dv-person" data-selected={picked === p.userId}>
              <input
                type="radio"
                name={name}
                className="sr-only"
                checked={picked === p.userId}
                disabled={busy}
                onChange={() => setPicked(p.userId)}
              />
              <Avatar name={p.username} color={colorFor(p.userId)} src={p.avatarUrl} size={28} />
              <span className="flex min-w-0 flex-1 flex-col">
                <span className="truncate text-[13px] font-semibold">{p.username}</span>
                <span className="dv-person-meta">
                  {p.isMember ? (
                    <>
                      <span className="dv-dot" style={{ background: 'var(--dv-success)' }} />
                      In this room
                    </>
                  ) : (
                    `Left · here ${relative(p.lastSeenAt)}`
                  )}
                </span>
              </span>
              <span className="dv-person-check" aria-hidden>
                <Check size={12} strokeWidth={3} />
              </span>
            </label>
          ))
        )}
      </div>

      <p
        className="m-0 min-h-[17px] text-[11px] leading-relaxed"
        style={{ color: 'var(--dv-muted)' }}
      >
        {chosen ? (
          <>
            <strong style={{ color: 'var(--dv-text)' }}>{chosen.username}</strong> will own{' '}
            <strong style={{ color: 'var(--dv-text)' }}>{roomName}</strong>
            {chosen.isMember ? '.' : ' and be added back to it.'}
          </>
        ) : (
          'Choose who takes over.'
        )}
      </p>

      <div className="flex justify-end gap-2">
        <button type="button" className="dv-btn ghost" disabled={busy} onClick={onCancel}>
          Cancel
        </button>
        <button
          type="button"
          className="dv-btn danger"
          disabled={!picked || busy}
          onClick={() => picked && onConfirm(picked)}
        >
          {busy ? <span className="dv-spinner" /> : 'Hand over & leave'}
        </button>
      </div>
    </div>
  )
}
