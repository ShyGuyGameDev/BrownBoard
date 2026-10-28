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
  goToRoom,
  initials,
  takeReturnRoom,
  useRoom,
} from './lib/room.tsx'
import { bus, isTyping, toast } from './lib/bus.ts'
import { AuthProvider, isElectron, useAuth } from './lib/auth.tsx'
import {
  type RoomSession,
  deleteRoom,
  discardRoom,
  enterRoom,
  joinRoom,
  renameRoom,
  roomInviteInfo,
  saveRoom,
  setFlash,
  setGuestAccess,
} from './lib/rooms.ts'
import { useTheme } from './lib/theme.ts'
import {
  InviteScreen,
  JoinRoomScreen,
  NewPasswordScreen,
  Onboarding,
  RoomsHome,
} from './onboarding.tsx'
import { type RoomSettingsActions, RoomSettingsForm, SaveRoomForm } from './room-settings.tsx'

type Page = 'board' | 'canvas'

const isMac = /Mac/i.test(navigator.platform)

const UNSAVED_WARNING = "This room has no name, so it won't be saved."

/** Names an unnamed room. Its creator is the only one in it, so no broadcast. */
const useSaveRoom = () => {
  const { roomId, setRoomName, setUnnamed } = useRoom()
  return async (name: string) => {
    setRoomName(await saveRoom(roomId, name))
    setUnnamed(false)
  }
}

/* ------------------------------------------------------------------ */
/* Share popover                                                       */
/* ------------------------------------------------------------------ */

const SharePopover: React.FC<{ onClose: () => void }> = ({ onClose }) => {
  const { roomId, roomName, me, unnamed, isOwner } = useRoom()
  const save = useSaveRoom()
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

  // Nobody can join an unnamed room, so it gets a name before its link.
  if (unnamed)
    return (
      <>
        <div className="fixed inset-0 z-40" onPointerDown={onClose} />
        <div className="dv-floating dv-no-drag absolute right-0 top-full z-50 mt-2 flex w-[340px] flex-col gap-4 p-4">
          <div className="flex flex-col gap-1">
            <span className="text-[13px] font-semibold">Name this room to invite people</span>
            <p className="m-0 text-xs leading-relaxed" style={{ color: 'var(--dv-muted)' }}>
              Give it a name first. {UNSAVED_WARNING}
            </p>
          </div>
          <SaveRoomForm save={save} submitLabel="Save and get link" guest={!isOwner} />
        </div>
      </>
    )

  return (
    <>
      <div className="fixed inset-0 z-40" onPointerDown={onClose} />
      <div className="dv-floating dv-no-drag absolute right-0 top-full z-50 mt-2 flex w-[340px] flex-col gap-4 p-4">
        <div className="flex flex-col gap-2">
          <span className="text-[13px] font-semibold">Invite your team</span>
          <p className="text-xs leading-relaxed" style={{ color: 'var(--dv-muted)' }}>
            Anyone with this link can join{' '}
            <strong style={{ color: 'var(--dv-text)' }}>{roomName}</strong>. It's the only way in.
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

const RoomSettingsPopover: React.FC<{ onClose: () => void }> = ({ onClose }) => {
  const { roomId, roomName, setRoomName, allowGuests, setAllowGuests, send, unnamed, isOwner } =
    useRoom()
  const save = useSaveRoom()

  // Inside the room we already have its live channel, so just broadcast on it.
  const actions: RoomSettingsActions = {
    rename: async (name) => {
      const saved = await renameRoom(roomId, name)
      setRoomName(saved)
      send('room:renamed', { name: saved })
      return saved
    },
    setGuestAccess: async (allow) => {
      await setGuestAccess(roomId, allow)
      setAllowGuests(allow)
      send('room:guests', { allow })
    },
    remove: async () => {
      await deleteRoom(roomId)
      send('room:deleted', {})
      setFlash(`“${roomName}” was deleted.`)
      goHome()
    },
  }

  if (unnamed)
    return (
      <>
        <div className="fixed inset-0 z-40" onPointerDown={onClose} />
        <div className="dv-floating dv-no-drag absolute right-0 top-full z-50 mt-2 flex w-[340px] flex-col gap-4 p-4">
          <div className="flex flex-col gap-1">
            <span className="text-[13px] font-semibold">Save this room</span>
            <p className="m-0 text-xs leading-relaxed" style={{ color: 'var(--dv-muted)' }}>
              {UNSAVED_WARNING} Give it a name to keep it and invite people.
            </p>
          </div>
          <SaveRoomForm
            guest={!isOwner}
            save={async (name) => {
              await save(name)
              toast('Room saved.')
              onClose()
            }}
          />
        </div>
      </>
    )

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
        <RoomSettingsForm roomName={roomName} allowGuests={allowGuests} actions={actions} />
      </div>
    </>
  )
}

/* ------------------------------------------------------------------ */
/* Shell                                                               */
/* ------------------------------------------------------------------ */

const Shell: React.FC = () => {
  const { roomId, roomName, isOwner, setRoomName, setAllowGuests, unnamed, peers, status, me, on } =
    useRoom()
  const { isGuest, signOut } = useAuth()
  // Every visit to a room starts on the board (Shell remounts per room, so this resets on entry).
  const [page, setPage] = useState<Page>('board')
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
    // Guests are removed on the server when access is turned off; send them out of the room too.
    const offGuests = on('room:guests', ({ allow }: { allow: boolean }) => {
      setAllowGuests(allow)
      if (!allow && isGuest) {
        setFlash(
          `The owner of “${roomName}” turned off guest access. Sign in to keep working in it.`,
        )
        signOut().then(goHome)
      }
    })
    return () => {
      offRename()
      offDelete()
      offGuests()
    }
  }, [on, setRoomName, setAllowGuests, roomName, isGuest, signOut])
  const [toastMsg, setToastMsg] = useState<string | null>(null)
  const toastTimer = useRef<number | null>(null)

  // Closing or reloading the tab with an unnamed room: the browser's "leave site?" prompt.
  useEffect(() => {
    if (!unnamed) return
    const onBeforeUnload = (e: BeforeUnloadEvent) => {
      e.preventDefault()
      e.returnValue = UNSAVED_WARNING
    }
    window.addEventListener('beforeunload', onBeforeUnload)
    return () => window.removeEventListener('beforeunload', onBeforeUnload)
  }, [unnamed])

  /** Back to the rooms page (or, for guests, out). An unnamed room is confirmed, then discarded. */
  const leave = async () => {
    if (unnamed) {
      if (!window.confirm(`${UNSAVED_WARNING} Leave and discard it?`)) return
      await discardRoom(roomId)
    }
    if (isGuest) await signOut()
    goHome()
  }

  const go = useCallback((p: Page) => setPage(p), [])

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
            <button className="dv-btn ghost dv-no-drag" title="Leave this room" onClick={leave}>
              <LogOut size={14} />
              Leave
            </button>
          ) : (
            <button className="dv-iconbtn dv-no-drag" title="All rooms" onClick={leave}>
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
          {unnamed && (
            <button
              className="dv-btn ghost dv-no-drag shrink-0 text-xs"
              style={{ color: 'var(--dv-warning)' }}
              title={`${UNSAVED_WARNING} Name it to keep it.`}
              onClick={() => setSettingsOpen(true)}
            >
              Not saved
            </button>
          )}
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
              className="dv-avatar -ml-1.5 flex h-7 w-7 items-center justify-center rounded-full border-2 text-[10px] font-bold text-white first:ml-0"
              style={{ background: me.color, borderColor: 'var(--dv-panel)' }}
              data-tip={`${me.name} (you)`}
              aria-label={`${me.name} (you)`}
              tabIndex={0}
            >
              {initials(me.name)}
            </div>
            {shown.map((p) => (
              <div
                key={p.id}
                className="dv-avatar -ml-1.5 flex h-7 w-7 items-center justify-center rounded-full border-2 text-[10px] font-bold text-white"
                style={{ background: p.color, borderColor: 'var(--dv-panel)' }}
                data-tip={p.name}
                aria-label={p.name}
                tabIndex={0}
              >
                {initials(p.name)}
              </div>
            ))}
            {peers.length > shown.length && (
              <div
                className="dv-avatar multi -ml-1.5 flex h-7 w-7 items-center justify-center rounded-full border-2 text-[10px] font-semibold"
                data-tip={peers
                  .slice(shown.length)
                  .map((p) => p.name)
                  .join('\n')}
                aria-label={`Also here: ${peers
                  .slice(shown.length)
                  .map((p) => p.name)
                  .join(', ')}`}
                tabIndex={0}
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

          {(isOwner || unnamed) && (
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
  | { state: 'blocked'; name: string | null; deleted: boolean; error: unknown }

/** Lets you into `roomId`, joining it from the link if you're not a member yet. */
const RoomGate: React.FC<{ roomId: string; userId: string }> = ({ roomId, userId }) => {
  const [gate, setGate] = useState<Gate>({ state: 'checking' })

  useEffect(() => {
    let cancelled = false
    enterRoom(roomId)
      .catch(() => joinRoom(roomId))
      .then((room) => !cancelled && setGate({ state: 'in', room }))
      .catch(async (e) => {
        const info = await roomInviteInfo(roomId)
        if (!cancelled) setGate({ state: 'blocked', ...info, error: e })
      })
    return () => {
      cancelled = true
    }
  }, [roomId])

  if (gate.state === 'checking') return <Splash />
  if (gate.state === 'blocked')
    return (
      <JoinRoomScreen
        roomId={roomId}
        roomName={gate.name}
        deleted={gate.deleted}
        error={gate.error}
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
      allowGuests={gate.room.allowGuests}
      unnamed={gate.room.unnamed}
    >
      <Shell />
    </RoomProvider>
  )
}

const InviteOnboarding: React.FC<{ roomId: string; onHold: (hold: boolean) => void }> = ({
  roomId,
  onHold,
}) => {
  const [info, setInfo] = useState<{ name: string | null; deleted: boolean } | null>(null)
  useEffect(() => {
    roomInviteInfo(roomId)
      .then(setInfo)
      .catch(() => setInfo({ name: null, deleted: false }))
  }, [roomId])
  if (!info) return <Splash />
  return (
    <InviteScreen roomId={roomId} roomName={info.name} deleted={info.deleted} onHold={onHold} />
  )
}

const Router: React.FC = () => {
  const { ready, session, isGuest, recovering } = useAuth()
  const [roomId, setRoomId] = useState(getRoomIdFromLocation)
  // Keeps the invite screen up while a guest session starts and joins (see InviteScreen).
  const [holdInvite, setHoldInvite] = useState(false)

  // Back from Google sign-in: OAuth returns to the bare site URL, so reopen the linked room.
  useEffect(() => {
    if (!session || roomId) return
    const pending = takeReturnRoom()
    if (pending) goToRoom(pending)
  }, [session, roomId])

  useEffect(() => {
    const onHash = () => setRoomId(getRoomIdFromLocation())
    window.addEventListener('hashchange', onHash)
    return () => window.removeEventListener('hashchange', onHash)
  }, [])

  if (!ready) return <Splash />
  if (recovering) return <NewPasswordScreen />
  if (roomId) {
    if (!session || (holdInvite && isGuest))
      return <InviteOnboarding roomId={roomId} onHold={setHoldInvite} />
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
