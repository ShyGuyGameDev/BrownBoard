import React, { useCallback, useEffect, useRef, useState } from 'react'
import {
  ArrowLeft,
  Check,
  Copy,
  Kanban,
  LogOut,
  Moon,
  PenTool,
  Settings,
  Share2,
  Sun,
} from 'lucide-react'
import { Whiteboard } from './whiteboard'
import { KanbanBoard } from './kanban'
import {
  RoomProvider,
  buildShareLink,
  getRoomIdFromLocation,
  goHome,
  useRoom,
} from './lib/room.tsx'
import { bus, isTyping, toast } from './lib/bus.ts'
import { AuthProvider, isElectron, useAuth } from './lib/auth.tsx'
import {
  type RoomSession,
  changeRoomPassword,
  deleteRoom,
  enterRoom,
  renameRoom,
  roomInviteInfo,
  setFlash,
} from './lib/rooms.ts'
import { useTheme } from './lib/theme.ts'
import { JoinRoomScreen, NewPasswordScreen, Onboarding, RoomsHome } from './onboarding.tsx'

type Page = 'board' | 'canvas'

const isMac = /Mac/i.test(navigator.platform)

const initials = (name: string) => name.trim().slice(0, 2).toUpperCase() || '?'

/* ------------------------------------------------------------------ */
/* Share popover                                                       */
/* ------------------------------------------------------------------ */

const SharePopover: React.FC<{ onClose: () => void }> = ({ onClose }) => {
  const { roomId, roomName, me } = useRoom()
  const [copied, setCopied] = useState(false)
  const link = buildShareLink(roomId)

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(link)
      setCopied(true)
      setTimeout(() => setCopied(false), 1600)
    } catch {
      toast('Could not copy. Select the link and copy it manually.')
    }
  }

  return (
    <>
      <div className="fixed inset-0 z-40" onPointerDown={onClose} />
      <div className="dv-floating dv-no-drag absolute right-0 top-full z-50 mt-2 flex w-[340px] flex-col gap-4 p-4">
        <div className="flex flex-col gap-2">
          <span className="text-[13px] font-semibold">Invite your team</span>
          <p className="text-xs leading-relaxed" style={{ color: 'var(--dv-muted)' }}>
            Send this link along with the room password. Or they can enter the room name,{' '}
            <strong style={{ color: 'var(--dv-text)' }}>{roomName}</strong>, and the password from
            the start screen.
          </p>
          <div className="flex gap-2">
            <input
              readOnly
              value={link}
              className="dv-input"
              onFocus={(e) => e.currentTarget.select()}
            />
            <button className="dv-btn primary shrink-0" onClick={copy}>
              {copied ? <Check size={14} /> : <Copy size={14} />}
              {copied ? 'Copied' : 'Copy'}
            </button>
          </div>
          {link.startsWith('devboard://') && (
            <p className="text-[11px]" style={{ color: 'var(--dv-muted)' }}>
              This opens the desktop app. Set <code>VITE_SHARE_BASE_URL</code> to also share a web
              link.
            </p>
          )}
        </div>

        <div
          className="flex flex-col gap-1 border-t pt-3 text-xs"
          style={{ borderColor: 'var(--dv-border)', color: 'var(--dv-muted)' }}
        >
          <span>
            You appear as <strong style={{ color: 'var(--dv-text)' }}>{me.name}</strong>.
          </span>
        </div>
      </div>
    </>
  )
}

/* ------------------------------------------------------------------ */
/* Room settings (owner only)                                          */
/* ------------------------------------------------------------------ */

const errorText = (e: unknown) =>
  e instanceof Error ? e.message : 'Something went wrong. Try again.'

const RoomSettingsPopover: React.FC<{ onClose: () => void }> = ({ onClose }) => {
  const { roomId, roomName, setRoomName, send } = useRoom()
  const [name, setName] = useState(roomName)
  const [password, setPassword] = useState('')
  const [confirmName, setConfirmName] = useState('')
  const [busy, setBusy] = useState<'name' | 'password' | 'delete' | null>(null)
  const [error, setError] = useState<string | null>(null)

  const run = async (kind: 'name' | 'password' | 'delete', fn: () => Promise<void>) => {
    setBusy(kind)
    setError(null)
    try {
      await fn()
    } catch (e) {
      setError(errorText(e))
    } finally {
      setBusy(null)
    }
  }

  const saveName = () =>
    run('name', async () => {
      const saved = await renameRoom(roomId, name)
      setRoomName(saved)
      setName(saved)
      send('room:renamed', { name: saved })
      toast('Room renamed.')
    })

  const savePassword = () =>
    run('password', async () => {
      await changeRoomPassword(roomId, password)
      setPassword('')
      toast('Room password changed.')
    })

  const remove = () =>
    run('delete', async () => {
      await deleteRoom(roomId)
      send('room:deleted', {})
      setFlash(`“${roomName}” was deleted.`)
      goHome()
    })

  const nameChanged = name.trim() !== roomName && name.trim().length >= 2

  return (
    <>
      <div className="fixed inset-0 z-40" onPointerDown={onClose} />
      <div className="dv-floating dv-no-drag absolute right-0 top-full z-50 mt-2 flex w-[340px] flex-col gap-4 p-4">
        <div className="flex flex-col gap-1">
          <span className="text-[13px] font-semibold">Room settings</span>
          <p className="text-xs" style={{ color: 'var(--dv-muted)' }}>
            Only you can change these, because you created this room.
          </p>
        </div>

        <form
          className="flex flex-col gap-2"
          onSubmit={(e) => {
            e.preventDefault()
            if (nameChanged) saveName()
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
            if (password.length >= 4) savePassword()
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

        <form
          className="flex flex-col gap-2 border-t pt-3"
          style={{ borderColor: 'var(--dv-border)' }}
          onSubmit={(e) => {
            e.preventDefault()
            if (confirmName.trim() === roomName) remove()
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
          <p className="text-xs" role="alert" style={{ color: 'var(--dv-danger)' }}>
            {error}
          </p>
        )}
      </div>
    </>
  )
}

/* ------------------------------------------------------------------ */
/* Shell                                                               */
/* ------------------------------------------------------------------ */

const Shell: React.FC = () => {
  const { roomId, roomName, isOwner, setRoomName, peers, status, me, on } = useRoom()
  const { isGuest, signOut } = useAuth()
  const [page, setPage] = useState<Page>(
    () => (localStorage.getItem('devboard.page') as Page) || 'board',
  )
  const { theme, toggle: toggleTheme } = useTheme()
  const [shareOpen, setShareOpen] = useState(false)
  const [settingsOpen, setSettingsOpen] = useState(false)

  // The owner's changes, as seen by everyone else in the room.
  useEffect(() => {
    const offRename = on('room:renamed', ({ name }: { name: string }) => setRoomName(name))
    const offDelete = on('room:deleted', () => {
      setFlash(`“${roomName}” was deleted by its owner.`)
      goHome()
    })
    return () => {
      offRename()
      offDelete()
    }
  }, [on, setRoomName, roomName])
  const [toastMsg, setToastMsg] = useState<string | null>(null)
  const toastTimer = useRef<number | null>(null)

  const go = useCallback((p: Page) => {
    setPage(p)
    localStorage.setItem('devboard.page', p)
  }, [])

  // Navigation: 1 / 2 (when not typing), Ctrl/Cmd+1 / 2 anywhere, plus bus + Electron menu events.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const mod = e.metaKey || e.ctrlKey
      if (!mod && (e.altKey || e.shiftKey || isTyping(e))) return
      if (e.key === '1') {
        e.preventDefault()
        go('board')
      } else if (e.key === '2') {
        e.preventDefault()
        go('canvas')
      }
    }
    const onNavigate = (e: Event) => {
      const target = (e as CustomEvent).detail
      if (target === 'board' || target === 'canvas') go(target)
    }
    const onShare = () => setShareOpen(true)
    window.addEventListener('keydown', onKey)
    window.addEventListener('devboard:navigate', onNavigate)
    window.addEventListener('devboard:share', onShare)
    const offNav = bus.on('nav', (p: Page) => go(p))
    const offToast = bus.on('toast', (msg: string) => {
      setToastMsg(msg)
      if (toastTimer.current) window.clearTimeout(toastTimer.current)
      toastTimer.current = window.setTimeout(() => setToastMsg(null), 3200)
    })
    // Electron's Edit menu: undo/redo either go to the focused text field or to the canvas.
    const onHistory = (e: Event) => {
      const dir = (e as CustomEvent).detail as 'undo' | 'redo'
      const el = document.activeElement as HTMLElement | null
      const typing =
        el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.isContentEditable)
      if (typing) document.execCommand(dir)
      else bus.emit('history', dir)
    }
    window.addEventListener('devboard:history', onHistory)
    return () => {
      window.removeEventListener('keydown', onKey)
      window.removeEventListener('devboard:navigate', onNavigate)
      window.removeEventListener('devboard:share', onShare)
      window.removeEventListener('devboard:history', onHistory)
      offNav()
      offToast()
    }
  }, [go])

  const statusLabel =
    status === 'live' ? 'Live' : status === 'connecting' ? 'Connecting' : 'Offline'
  const statusColor =
    status === 'live' ? '#22c55e' : status === 'connecting' ? '#f59e0b' : '#ef4444'
  const shown = peers.slice(0, 4)

  return (
    <div className="flex h-full flex-col" style={{ background: 'var(--dv-bg)' }}>
      <header
        className="dv-drag relative z-30 flex h-12 shrink-0 items-center gap-4 border-b px-4"
        style={{
          borderColor: 'var(--dv-border)',
          background: 'var(--dv-panel)',
          paddingLeft: isElectron && isMac ? 84 : undefined,
        }}
      >
        <div className="flex min-w-0 items-center gap-2">
          {isGuest ? (
            <button
              className="dv-btn ghost dv-no-drag"
              title="Leave this room"
              onClick={() => signOut().then(goHome)}
            >
              <LogOut size={14} />
              Leave
            </button>
          ) : (
            <button className="dv-iconbtn dv-no-drag" title="All rooms" onClick={goHome}>
              <ArrowLeft size={16} />
            </button>
          )}
          <div
            className="flex h-6 w-6 shrink-0 items-center justify-center rounded-md text-[13px] font-bold"
            style={{ background: 'var(--dv-accent)', color: 'var(--dv-accent-fg)' }}
          >
            d
          </div>
          <span
            className="max-w-[220px] truncate text-[14px] font-semibold tracking-tight"
            title={`Room id: ${roomId}`}
          >
            {roomName}
          </span>
        </div>

        <div className="dv-seg dv-no-drag ml-2" role="tablist">
          <button
            role="tab"
            aria-selected={page === 'board'}
            data-active={page === 'board'}
            onClick={() => go('board')}
          >
            <Kanban size={15} />
            Board
            <span className="dv-kbd">1</span>
          </button>
          <button
            role="tab"
            aria-selected={page === 'canvas'}
            data-active={page === 'canvas'}
            onClick={() => go('canvas')}
          >
            <PenTool size={15} />
            Canvas
            <span className="dv-kbd">2</span>
          </button>
        </div>

        <div className="flex-1" />

        <div className="dv-no-drag flex items-center gap-3">
          <div
            className="flex items-center gap-1.5 text-xs"
            style={{ color: 'var(--dv-muted)' }}
            title={statusLabel}
          >
            <span className="dv-dot" style={{ background: statusColor }} />
            {statusLabel}
          </div>

          <div className="flex items-center">
            <div
              className="-ml-1.5 flex h-7 w-7 items-center justify-center rounded-full border-2 text-[10px] font-bold text-white first:ml-0"
              style={{ background: me.color, borderColor: 'var(--dv-panel)' }}
              title={`${me.name} (you)`}
            >
              {initials(me.name)}
            </div>
            {shown.map((p) => (
              <div
                key={p.id}
                className="-ml-1.5 flex h-7 w-7 items-center justify-center rounded-full border-2 text-[10px] font-bold text-white"
                style={{ background: p.color, borderColor: 'var(--dv-panel)' }}
                title={p.name}
              >
                {initials(p.name)}
              </div>
            ))}
            {peers.length > shown.length && (
              <div
                className="-ml-1.5 flex h-7 w-7 items-center justify-center rounded-full border-2 text-[10px] font-semibold"
                style={{
                  background: 'var(--dv-panel-2)',
                  borderColor: 'var(--dv-panel)',
                  color: 'var(--dv-muted)',
                }}
              >
                +{peers.length - shown.length}
              </div>
            )}
          </div>

          {isOwner && (
            <div className="relative">
              <button
                className="dv-iconbtn"
                title="Room settings"
                onClick={() => setSettingsOpen((v) => !v)}
              >
                <Settings size={16} />
              </button>
              {settingsOpen && <RoomSettingsPopover onClose={() => setSettingsOpen(false)} />}
            </div>
          )}

          <div className="relative">
            <button className="dv-btn primary" onClick={() => setShareOpen((v) => !v)}>
              <Share2 size={14} />
              Share
            </button>
            {shareOpen && <SharePopover onClose={() => setShareOpen(false)} />}
          </div>

          <button
            className="dv-iconbtn"
            title={theme === 'dark' ? 'Switch to light theme' : 'Switch to dark theme'}
            onClick={toggleTheme}
          >
            {theme === 'dark' ? <Sun size={16} /> : <Moon size={16} />}
          </button>
        </div>
      </header>

      {/* Both views stay mounted so switching is instant and nothing loses its state or connection. */}
      <main className="relative min-h-0 flex-1">
        <div className="dv-page absolute inset-0" data-active={page === 'board'}>
          <KanbanBoard active={page === 'board'} />
        </div>
        <div className="dv-page absolute inset-0" data-active={page === 'canvas'}>
          <Whiteboard active={page === 'canvas'} theme={theme} />
        </div>
      </main>

      {toastMsg && (
        <div className="pointer-events-none fixed bottom-6 left-1/2 z-[100] -translate-x-1/2">
          <div className="dv-toast">{toastMsg}</div>
        </div>
      )}
    </div>
  )
}

/* ------------------------------------------------------------------ */
/* Routing                                                             */
/* ------------------------------------------------------------------ */

const Splash: React.FC = () => (
  <div className="dv-auth">
    <span className="dv-spinner" style={{ color: 'var(--dv-muted)' }} />
  </div>
)

type Gate =
  | { state: 'checking' }
  | { state: 'in'; room: RoomSession }
  | { state: 'join'; name: string | null; deleted: boolean }

/** Lets you into `roomId` if you're a member, otherwise asks for its password. */
const RoomGate: React.FC<{ roomId: string; userId: string }> = ({ roomId, userId }) => {
  const [gate, setGate] = useState<Gate>({ state: 'checking' })
  const [attempt, setAttempt] = useState(0)

  useEffect(() => {
    let cancelled = false
    enterRoom(roomId)
      .then((room) => !cancelled && setGate({ state: 'in', room }))
      .catch(async () => {
        const info = await roomInviteInfo(roomId)
        if (!cancelled) setGate({ state: 'join', ...info })
      })
    return () => {
      cancelled = true
    }
  }, [roomId, attempt])

  if (gate.state === 'checking') return <Splash />
  if (gate.state === 'join')
    return (
      <JoinRoomScreen
        roomId={roomId}
        roomName={gate.name}
        deleted={gate.deleted}
        onJoined={() => setAttempt((n) => n + 1)}
      />
    )
  return (
    // key => switching rooms remounts both views with fresh data and a fresh channel.
    <RoomProvider
      key={roomId}
      roomId={roomId}
      roomName={gate.room.roomName}
      displayName={gate.room.displayName}
      userId={userId}
      isOwner={gate.room.isOwner}
    >
      <Shell />
    </RoomProvider>
  )
}

const InviteOnboarding: React.FC<{ roomId: string }> = ({ roomId }) => {
  const [info, setInfo] = useState<{ name: string | null; deleted: boolean }>({
    name: null,
    deleted: false,
  })
  useEffect(() => {
    roomInviteInfo(roomId).then(setInfo)
  }, [roomId])
  return <Onboarding inviteName={info.name} inviteDeleted={info.deleted} />
}

const Router: React.FC = () => {
  const { ready, session, isGuest, recovering } = useAuth()
  const [roomId, setRoomId] = useState(getRoomIdFromLocation)

  useEffect(() => {
    const onHash = () => setRoomId(getRoomIdFromLocation())
    window.addEventListener('hashchange', onHash)
    return () => window.removeEventListener('hashchange', onHash)
  }, [])

  if (!ready) return <Splash />
  if (recovering) return <NewPasswordScreen />
  if (roomId) {
    if (!session) return <InviteOnboarding roomId={roomId} />
    return (
      <RoomGate key={`${roomId}:${session.user.id}`} roomId={roomId} userId={session.user.id} />
    )
  }
  // Guests don't have a rooms list; they go back to the start screen.
  if (session && !isGuest) return <RoomsHome />
  return <Onboarding />
}

function App() {
  return (
    <AuthProvider>
      <Router />
    </AuthProvider>
  )
}

export default App
