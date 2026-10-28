import React, { useState } from 'react'

const errorText = (e: unknown) =>
  e instanceof Error ? e.message : 'Something went wrong. Try again.'

export interface RoomSettingsActions {
  /** Returns the name as saved (trimmed / normalised by the server). */
  rename: (name: string) => Promise<string>
  setGuestAccess: (allow: boolean) => Promise<void>
  remove: () => Promise<void>
}

/**
 * Name for an unnamed room: that's what saves it and lets people in with its link.
 * Shown in the room's settings and before sharing it.
 */
export const SaveRoomForm: React.FC<{
  save: (name: string) => Promise<void>
  submitLabel?: string
  /** Guests can save a room but can't manage it afterwards. */
  guest?: boolean
}> = ({ save, submitLabel = 'Save room', guest }) => {
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
      {guest && (
        <p className="m-0 text-[11px] leading-relaxed" style={{ color: 'var(--dv-muted)' }}>
          As a guest, you won't be able to rename or delete the room later.
        </p>
      )}
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
}> = ({ roomName, allowGuests, actions }) => {
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
