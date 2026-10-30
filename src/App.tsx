import React, { useCallback, useEffect, useRef, useState } from 'react'
import {
  ArrowLeft,
  Check,
  Copy,
  Kanban,
  LoaderCircle,
  LogIn,
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
  takeReturnRoom,
  useRoom,
  type Peer,
} from './lib/room.tsx'
import { type ToastAction, bus, isTyping, toast } from './lib/bus.ts'
import {
  clearSignInIntent,
  leavingToSignIn,
  peekSignInIntent,
  takeStartRoomAfterSignIn,
} from './lib/sign-in-intent.ts'
import { AuthProvider, isElectron, useAuth } from './lib/auth.tsx'
import {
  type RoomSession,
  claimRoom,
  createQuickRoom,
  deleteRoom,
  discardRoom,
  enterRoom,
  joinRoom,
  leaveRoom,
  renameRoom,
  roomInviteInfo,
  roomPeople,
  saveRoom,
  setFlash,
  setGuestAccess,
} from './lib/rooms.ts'
import { useTheme } from './lib/theme.ts'
import { Avatar } from './avatar.tsx'
import { NotificationBell } from './notifications.tsx'
import {
  InlineEdit,
  InviteScreen,
  JoinRoomScreen,
  NewPasswordScreen,
  Onboarding,
  ProfileSettings,
  RoomsHome,
  type SignInReason,
  SignInPanel,
} from './onboarding.tsx'
import {
  type LeaveRoomActions,
  LeaveRoomSection,
  type RoomSettingsActions,
  RoomSettingsForm,
  SaveRoomForm,
} from './room-settings.tsx'

type Page = 'board' | 'canvas'

const isMac = /Mac/i.test(navigator.platform)

/** A guest's untitled room isn't kept (an account's is, as "Untitled room <n>"). */
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
  const { roomId, roomName, me, unnamed, hasOwner } = useRoom()
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
              Give it a name first, so people know what they're joining.
            </p>
          </div>
          <SaveRoomForm save={save} submitLabel="Name it and get link" />
        </div>
      </>
    )

  // Made by a guest before rooms needed an owner. Its creator gets the sign-in panel instead.
  if (!hasOwner)
    return (
      <>
        <div className="fixed inset-0 z-40" onPointerDown={onClose} />
        <div className="dv-floating dv-no-drag absolute right-0 top-full z-50 mt-2 flex w-[340px] flex-col gap-1 p-4">
          <span className="text-[13px] font-semibold">This room can't be shared yet</span>
          <p className="m-0 text-xs leading-relaxed" style={{ color: 'var(--dv-muted)' }}>
            Rooms are shared by the account that owns them, and a guest made this one. Whoever made
            it can sign in from inside it to make it theirs.
          </p>
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
/* Room settings                                                       */
/* ------------------------------------------------------------------ */

/** Owners get the full settings; everyone else signed in gets Leave. */
const RoomSettingsPopover: React.FC<{ onClose: () => void }> = ({ onClose }) => {
  const { roomId, roomName, isOwner, setRoomName, allowGuests, setAllowGuests, send, unnamed } =
    useRoom()
  const save = useSaveRoom()

  const leave: LeaveRoomActions = {
    people: () => roomPeople(roomId),
    leave: async (newOwnerId) => {
      const left = await leaveRoom(roomId, newOwnerId)
      if (newOwnerId) {
        // Still on the channel, so tell the new owner (and everyone else, for the name).
        send('room:owner', { userId: newOwnerId, name: left.roomName })
        setFlash(`You left “${roomName}”. ${left.newOwnerName ?? 'Your pick'} owns it now.`)
      } else {
        setFlash(`You left “${roomName}”.`)
      }
      goHome()
    },
  }

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
            <span className="text-[13px] font-semibold">Name this room</span>
            <p className="m-0 text-xs leading-relaxed" style={{ color: 'var(--dv-muted)' }}>
              It needs a name before you can invite people.
            </p>
          </div>
          <SaveRoomForm
            save={async (name) => {
              await save(name)
              toast('Room named.')
              onClose()
            }}
          />
        </div>
      </>
    )

  return (
    <>
      <div className="fixed inset-0 z-40" onPointerDown={onClose} />
      <div className="dv-floating dv-no-drag dv-scroll absolute right-0 top-full z-50 mt-2 flex max-h-[calc(100vh-72px)] w-[340px] flex-col gap-4 overflow-y-auto p-4">
        <div className="flex flex-col gap-1">
          <span className="text-[13px] font-semibold">Room settings</span>
          <p className="m-0 text-xs" style={{ color: 'var(--dv-muted)' }}>
            {isOwner
              ? 'Only you can change these, because you own this room.'
              : 'Only the owner can rename or delete this room.'}
          </p>
        </div>
        {isOwner ? (
          <RoomSettingsForm
            roomName={roomName}
            allowGuests={allowGuests}
            actions={actions}
            leave={<LeaveRoomSection roomName={roomName} isOwner actions={leave} />}
          />
        ) : (
          <LeaveRoomSection roomName={roomName} isOwner={false} actions={leave} divider={false} />
        )}
      </div>
    </>
  )
}

/* ------------------------------------------------------------------ */
/* Shell                                                               */
/* ------------------------------------------------------------------ */

/** `openOnEnter`: back from signing in to share or save, so pick up where they left off. */
const Shell: React.FC<{ openOnEnter?: 'share' | 'settings' }> = ({ openOnEnter }) => {
  const {
    roomId,
    roomName,
    isOwner,
    setIsOwner,
    setRoomName,
    setAllowGuests,
    unnamed,
    isCreator,
    hasOwner,
    peers,
    status,
    me,
    setActivity,
    setPlace,
    on,
    send,
  } = useRoom()
  const { user, isGuest, signOut } = useAuth()
  // Every visit to a room starts on the board (Shell remounts per room, so this resets on entry).
  const [page, setPage] = useState<Page>('board')
  const { theme, toggle: toggleTheme } = useTheme()
  const [shareOpen, setShareOpen] = useState(openOnEnter === 'share')
  const [settingsOpen, setSettingsOpen] = useState(openOnEnter === 'settings')
  const [signIn, setSignIn] = useState<SignInReason | null>(null)
  const [renaming, setRenaming] = useState(false)
  const [profileOpen, setProfileOpen] = useState(false)
  const save = useSaveRoom()

  /** Owner renaming from the header. An unnamed room is named (saved) instead. */
  const rename = async (name: string) => {
    if (unnamed) {
      await save(name)
      toast('Room named.')
      return
    }
    const saved = await renameRoom(roomId, name)
    setRoomName(saved)
    send('room:renamed', { name: saved })
  }
  // A guest's own room needs an account before it can be shared or saved.
  const mustSignIn = isGuest && isCreator && !hasOwner

  const openShare = useCallback(
    () => (mustSignIn ? setSignIn('share') : setShareOpen(true)),
    [mustSignIn],
  )
  const openSettings = () => (mustSignIn ? setSignIn('save') : setSettingsOpen(true))

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
    // The owner left and handed the room on. If it's to you, ask the server, then show it.
    const offOwner = on('room:owner', ({ userId, name }: { userId: string; name?: string }) => {
      if (name) setRoomName(name)
      if (userId !== user?.id) return
      enterRoom(roomId)
        .then((r) => {
          setIsOwner(r.isOwner)
          setRoomName(r.roomName)
          if (r.isOwner) toast(`You're now the owner of “${r.roomName}”.`)
        })
        .catch(() => {
          /* they'll see it next time they open the room */
        })
    })
    return () => {
      offRename()
      offDelete()
      offGuests()
      offOwner()
    }
  }, [on, setRoomName, setAllowGuests, setIsOwner, roomId, roomName, user, isGuest, signOut])
  const [toastMsg, setToastMsg] = useState<{ message: string; action?: ToastAction } | null>(null)
  const [uploads, setUploads] = useState<Map<number, string>>(() => new Map())
  const toastTimer = useRef<number | null>(null)

  // A guest's untitled room isn't kept: closing or reloading the tab gets the browser's
  // "leave site?" prompt.
  const temporary = unnamed && isGuest
  useEffect(() => {
    if (!temporary) return
    const onBeforeUnload = (e: BeforeUnloadEvent) => {
      if (leavingToSignIn) return // Google sign-in; they come straight back
      e.preventDefault()
      e.returnValue = UNSAVED_WARNING
    }
    window.addEventListener('beforeunload', onBeforeUnload)
    return () => window.removeEventListener('beforeunload', onBeforeUnload)
  }, [temporary])

  /** Back to the rooms page (or, for guests, out). A guest's untitled room is confirmed, then discarded. */
  const leave = async () => {
    if (temporary) {
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
    const onShare = () => openShare()
    window.addEventListener('keydown', onKey)
    window.addEventListener('devboard:navigate', onNavigate)
    window.addEventListener('devboard:share', onShare)
    const offNav = bus.on('nav', (p: Page) => go(p))
    const offToast = bus.on('toast', (msg: string | { message: string; action?: ToastAction }) => {
      const next = typeof msg === 'string' ? { message: msg } : msg
      setToastMsg(next)
      if (toastTimer.current) window.clearTimeout(toastTimer.current)
      // Longer when there's something to click.
      toastTimer.current = window.setTimeout(() => setToastMsg(null), next.action ? 6000 : 3200)
    })
    const offUploadStart = bus.on('upload:start', ({ id, label }: { id: number; label: string }) =>
      setUploads((current) => new Map(current).set(id, label)),
    )
    const offUploadEnd = bus.on('upload:end', ({ id }: { id: number }) =>
      setUploads((current) => {
        const next = new Map(current)
        next.delete(id)
        return next
      }),
    )
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
      offUploadStart()
      offUploadEnd()
    }
  }, [go, openShare])

  useEffect(() => setPlace({ page }), [page, setPlace])

  // Clicking someone takes you to where they are: their page, the card they have open, or
  // their spot and zoom on the canvas.
  const jumpTo = (p: Peer) => {
    const place = p.place
    if (!place?.page) return
    go(place.page)
    if (place.page === 'canvas' && place.canvas) bus.emit('canvas:goto', place.canvas)
    if (place.page === 'board' && place.card) bus.emit('board:open-card', { taskId: place.card })
  }

  useEffect(() => {
    const workspace = page === 'board' ? 'On the board' : 'On the whiteboard'
    setActivity('workspace', workspace, 1)
    const overlay = profileOpen
      ? 'Editing profile settings'
      : settingsOpen
        ? 'Editing room settings'
        : renaming
          ? 'Renaming the room'
          : shareOpen
            ? 'Viewing invite settings'
            : signIn
              ? 'Viewing sign-in options'
              : null
    setActivity('shell-overlay', overlay, 3)
  }, [page, profileOpen, settingsOpen, renaming, shareOpen, signIn, setActivity])

  const statusLabel =
    status === 'live' ? 'Live' : status === 'connecting' ? 'Connecting' : 'Offline'
  const statusColor =
    status === 'live' ? '#22c55e' : status === 'connecting' ? '#f59e0b' : '#ef4444'
  // Active people first, so whoever is away is the one folded into "+N".
  const ordered = [...peers.filter((p) => !p.idle), ...peers.filter((p) => p.idle)]
  const shown = ordered.slice(0, 4)
  const peerTip = (p: Peer) =>
    p.idle ? `${p.name} (inactive)` : `${p.name} · ${p.activity ?? 'Online'}`

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
          {renaming ? (
            <div className="dv-header-rename dv-no-drag">
              <InlineEdit
                initial={unnamed ? '' : roomName}
                label="Room name"
                placeholder="Name this room"
                minLength={2}
                maxLength={48}
                saveOnBlur
                onSave={async (name) => {
                  await rename(name)
                  setRenaming(false)
                }}
                onCancel={() => setRenaming(false)}
              />
            </div>
          ) : isOwner ? (
            <span
              className="dv-header-name editable dv-no-drag max-w-[220px] truncate text-[14px] font-semibold tracking-tight"
              title="Double-click to rename"
              onDoubleClick={() => setRenaming(true)}
            >
              {roomName}
            </span>
          ) : (
            <span
              className="max-w-[220px] truncate text-[14px] font-semibold tracking-tight"
              title={`Room id: ${roomId}`}
            >
              {roomName}
            </span>
          )}
          {temporary && (
            <button
              className="dv-btn ghost dv-no-drag shrink-0 text-xs"
              style={{ color: 'var(--dv-warning)' }}
              title={`${UNSAVED_WARNING} Sign in to keep it.`}
              onClick={openSettings}
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
            {/* You: opens your profile (guests: sign in, since a guest has no profile). */}
            <button
              type="button"
              className="dv-avatar dv-me-btn compact"
              data-tip={isGuest ? `${me.name} (you) · Sign in` : `${me.name} (you) · Your profile`}
              aria-label={isGuest ? `${me.name} (you). Sign in` : `${me.name} (you). Your profile`}
              onClick={() => (isGuest ? setSignIn('header') : setProfileOpen(true))}
            >
              <Avatar
                name={me.name}
                color={me.color}
                src={me.avatar}
                className="border-2"
                style={{ borderColor: 'var(--dv-panel)' }}
              />
            </button>
            {shown.map((p) => (
              <button
                type="button"
                key={p.id}
                className="relative -ml-1.5 rounded-full"
                title={peerTip(p)}
                aria-label={`${peerTip(p)}. Go to them`}
                onClick={() => jumpTo(p)}
              >
                <Avatar
                  name={p.name}
                  color={p.color}
                  src={p.avatar}
                  className="dv-avatar border-2"
                  style={{
                    borderColor: 'var(--dv-panel)',
                    filter: p.idle ? 'grayscale(1)' : undefined,
                    opacity: p.idle ? 0.5 : undefined,
                  }}
                  data-tip={peerTip(p)}
                  aria-label={peerTip(p)}
                />
                {!p.idle && p.activity && /^(Editing|Adding|Renaming)/.test(p.activity) && (
                  <span
                    className="absolute bottom-0 right-0 h-2.5 w-2.5 rounded-full border-2"
                    style={{ background: '#22c55e', borderColor: 'var(--dv-panel)' }}
                    aria-hidden="true"
                  />
                )}
              </button>
            ))}
            {peers.length > shown.length && (
              <div
                className="dv-avatar multi -ml-1.5 flex h-7 w-7 items-center justify-center rounded-full border-2 text-[10px] font-semibold"
                data-tip={ordered.slice(shown.length).map(peerTip).join('\n')}
                aria-label={`Also here: ${ordered.slice(shown.length).map(peerTip).join(', ')}`}
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

          {!isGuest && user && <NotificationBell userId={user.id} />}

          {(!isGuest || unnamed) && (
            <div className="relative">
              <button
                className="dv-iconbtn"
                title="Room settings"
                onClick={() => (settingsOpen ? setSettingsOpen(false) : openSettings())}
              >
                <Settings size={16} />
              </button>
              {settingsOpen && <RoomSettingsPopover onClose={() => setSettingsOpen(false)} />}
            </div>
          )}

          {isGuest && (
            <button className="dv-btn" onClick={() => setSignIn('header')}>
              <LogIn size={14} />
              Sign in
            </button>
          )}

          <div className="relative">
            <button
              className="dv-btn primary"
              onClick={() => (shareOpen ? setShareOpen(false) : openShare())}
            >
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

      {profileOpen && <ProfileSettings onClose={() => setProfileOpen(false)} />}

      {signIn && (
        <SignInPanel
          roomId={roomId}
          reason={signIn}
          claim={isGuest && isCreator && !hasOwner}
          guestName={me.name}
          onClose={() => setSignIn(null)}
        />
      )}

      {toastMsg && (
        <div
          className={`${toastMsg.action ? '' : 'pointer-events-none '}fixed bottom-6 left-1/2 z-[100] -translate-x-1/2`}
          role="status"
          aria-live="polite"
        >
          <div className="dv-toast flex items-center gap-3">
            <span>{toastMsg.message}</span>
            {toastMsg.action && (
              <button
                className="dv-toast-action"
                onClick={() => {
                  toastMsg.action!.run()
                  setToastMsg(null)
                }}
              >
                {toastMsg.action.label}
              </button>
            )}
          </div>
        </div>
      )}
      {uploads.size > 0 && (
        <div
          className="pointer-events-none fixed bottom-6 right-6 z-[101]"
          role="status"
          aria-live="polite"
        >
          <div className="dv-upload-toast flex items-center gap-2.5">
            <LoaderCircle className="dv-upload-spinner shrink-0" size={16} aria-hidden="true" />
            <span>
              {[...uploads.values()].at(-1)}
              {uploads.size > 1 && ` (+${uploads.size - 1} more)`}
            </span>
          </div>
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

/** How long after signing in a room still reopens Share or settings by itself. */
const INTENT_FRESH_MS = 15 * 60_000

/**
 * Lets you into `roomId`, joining it from the link if you're not a member yet. Back from signing
 * in from inside it, first claims the room if the guest made it.
 */
const RoomGate: React.FC<{ roomId: string; userId: string; isGuest: boolean }> = ({
  roomId,
  userId,
  isGuest,
}) => {
  // Your current name and picture, so editing your profile in the room shows up right away.
  const { profile } = useAuth()
  const [gate, setGate] = useState<Gate>({ state: 'checking' })
  // Read once per mount: the intent is cleared once used, and effects can run twice in dev.
  const [intent] = useState(() => {
    const it = !isGuest ? peekSignInIntent() : null
    return it?.roomId === roomId ? it : null
  })
  const openOnEnter = intent && Date.now() - intent.at < INTENT_FRESH_MS ? intent.then : undefined
  const claim = useRef<Promise<unknown> | null>(null)

  useEffect(() => {
    let cancelled = false
    if (intent) clearSignInIntent()
    // One claim per mount; a failed claim still lets them in (as a member, if the room is named).
    claim.current ??= intent?.claim
      ? claimRoom(roomId, intent.claim).catch(() => undefined)
      : Promise.resolve()
    claim.current
      .then(() => enterRoom(roomId))
      .catch(() => joinRoom(roomId))
      .then((room) => !cancelled && setGate({ state: 'in', room }))
      .catch(async (e) => {
        const info = await roomInviteInfo(roomId)
        if (!cancelled) setGate({ state: 'blocked', ...info, error: e })
      })
    return () => {
      cancelled = true
    }
  }, [roomId, intent])

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
      displayName={(!isGuest && profile?.username) || gate.room.displayName}
      avatar={isGuest ? null : profile?.avatar_url}
      userId={userId}
      isOwner={gate.room.isOwner}
      allowGuests={gate.room.allowGuests}
      unnamed={gate.room.unnamed}
      isCreator={gate.room.isCreator}
      hasOwner={gate.room.hasOwner}
    >
      <Shell openOnEnter={openOnEnter} />
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
  // A confirmation email can open in a new tab, which only has the sign-in intent to go on.
  // "Start a blank room" signed the last account in first: open the new room now.
  useEffect(() => {
    if (!session || roomId) return
    if (!isGuest && takeStartRoomAfterSignIn()) {
      // If it fails they're on their rooms page, where New room shows the error.
      createQuickRoom()
        .then((room) => goToRoom(room.roomId))
        .catch(() => undefined)
      return
    }
    const pending = takeReturnRoom() ?? (!isGuest ? peekSignInIntent()?.roomId : null)
    if (pending) goToRoom(pending)
  }, [session, roomId, isGuest])

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
      <RoomGate
        key={`${roomId}:${session.user.id}`}
        roomId={roomId}
        userId={session.user.id}
        isGuest={isGuest}
      />
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
