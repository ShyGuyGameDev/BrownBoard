import React, { useState } from 'react'

const errorText = (e: unknown) =>
  e instanceof Error ? e.message : 'Something went wrong. Try again.'

export interface RoomSettingsActions {
  /** Returns the name as saved (trimmed / normalised by the server). */
  rename: (name: string) => Promise<string>
  changePassword: (password: string) => Promise<void>
  setGuestAccess: (allow: boolean) => Promise<void>
  remove: () => Promise<void>
}

/**
 * Owner-only room settings: rename, change password, delete. Used in the room header popover
 * and on the rooms page, which supply their own actions (each tells people in the room).
 */
export const RoomSettingsForm: React.FC<{
  roomName: string
  allowGuests: boolean
  actions: RoomSettingsActions
}> = ({ roomName, allowGuests, actions }) => {
  const [name, setName] = useState(roomName)
  const [password, setPassword] = useState('')
  const [confirmName, setConfirmName] = useState('')
  const [busy, setBusy] = useState<'name' | 'password' | 'guests' | 'delete' | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [saved, setSaved] = useState<string | null>(null)

  const run = async (kind: 'name' | 'password' | 'guests' | 'delete', fn: () => Promise<void>) => {
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

      <form
        className="flex flex-col gap-2 border-t pt-3"
        style={{ borderColor: 'var(--dv-border)' }}
        onSubmit={(e) => {
          e.preventDefault()
          if (password.length < 4) return
          run('password', async () => {
            await actions.changePassword(password)
            setPassword('')
            setSaved('Room password changed.')
          })
        }}
      >
        <span className="dv-label">New password</span>
        <div className="flex gap-2">
          <input
            className="dv-input"
            type="password"
            autoComplete="new-password"
            placeholder="At least 4 characters"
            maxLength={72}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />
          <button className="dv-btn shrink-0" disabled={password.length < 4 || busy !== null}>
            {busy === 'password' ? <span className="dv-spinner" /> : 'Change'}
          </button>
        </div>
        <p className="text-[11px]" style={{ color: 'var(--dv-muted)' }}>
          Only affects people joining from now on. Everyone already in the room stays in.
        </p>
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
            ? 'People without an account can join with the room password, as an anonymous animal. Turning this off removes any guests in the room now.'
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
