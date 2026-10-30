import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react'
import type { RealtimeChannel } from '@supabase/supabase-js'
import { supabase } from './supabase'

export interface Peer {
  id: string
  name: string
  color: string
  /** Profile picture URL, for accounts that set one. */
  avatar?: string | null
  /** What this person is currently working on in the room. */
  activity?: string | null
  /** What they have selected or are editing: task ids on the board, element ids on the canvas. */
  selection?: PeerSelection | null
  /** On another tab, or no input at all for IDLE_AFTER. */
  idle?: boolean
  /** Where they are, so clicking them can take you there. */
  place?: PeerPlace | null
}

export interface PeerPlace {
  page?: 'board' | 'canvas'
  /** The card they have open on the board. */
  card?: string | null
  /** The middle of their canvas view (world coordinates) and their zoom. */
  canvas?: { x: number; y: number; k: number }
}

export type SelectionArea = 'board' | 'canvas'
export type PeerSelection = Record<SelectionArea, string[]>

export type RoomStatus = 'connecting' | 'live' | 'offline'

/** Minimum ms between presence updates; Realtime closes the channel of a client that tracks often. */
const TRACK_GAP = 2000
/** Minimum ms between activity / selection broadcasts. */
const STATE_GAP = 100
/** Broadcast event carrying a peer's activity and selection (kept out of presence, see trackIdentity). */
const PEER_STATE = 'peer:state'
/** No mouse, keyboard, scroll or touch input for this long counts as inactive. */
const IDLE_AFTER = 5 * 60 * 1000

type PeerState = {
  id: string
  activity: string | null
  selection: PeerSelection | null
  idle: boolean
  place: PeerPlace | null
}

/** `fromSelf` is true when the event was emitted locally with send(..., true). */
type Handler = (payload: any, fromSelf: boolean) => void

interface RoomContextValue {
  roomId: string
  roomName: string
  /** Signed-in creator: can rename, re-password, delete the room and clear the canvas. */
  isOwner: boolean
  /** After the owner hands the room to you (they leave, you take over). */
  setIsOwner: (isOwner: boolean) => void
  /** Update the name shown locally (after a rename here or by the owner elsewhere). */
  setRoomName: (name: string) => void
  allowGuests: boolean
  setAllowGuests: (allow: boolean) => void
  /** No name or password yet: only its creator is in it, and it isn't kept. */
  unnamed: boolean
  setUnnamed: (unnamed: boolean) => void
  /** You made it, even as a guest. */
  isCreator: boolean
  /** It belongs to an account (only those rooms can be shared). */
  hasOwner: boolean
  me: Peer
  peers: Peer[]
  status: RoomStatus
  setActivity: (source: string, activity: string | null, priority?: number) => void
  /** Share where you are (page, open card, canvas view) so others can jump to you. */
  setPlace: (place: PeerPlace) => void
  /** Share what you're editing in one area, so others see it outlined in your colour. */
  setSelection: (area: SelectionArea, ids: string[]) => void
  /** Broadcast to everyone else in the room. Pass `local = true` to also notify handlers in this window. */
  send: (event: string, payload?: any, local?: boolean) => void
  on: (event: string, handler: Handler) => () => void
}

const RoomContext = createContext<RoomContextValue | null>(null)

// ---------- room id helpers ----------

/** Accepts a full share link, a devboard:// link, or a bare room code. */
export const parseRoomId = (input: string): string | null => {
  const m = input.trim().match(/(?:#\/r\/|devboard:\/\/(?:join|r)\/|^)([A-Za-z0-9_-]{3,64})\/?$/)
  return m ? m[1] : null
}

/** The room in the URL (`#/r/<id>`), or null on the home / onboarding screens. */
export const getRoomIdFromLocation = () => {
  const m = window.location.hash.match(/^#\/r\/([A-Za-z0-9_-]{3,64})\/?$/)
  return m ? m[1] : null
}

export const goToRoom = (id: string) => {
  window.location.hash = `/r/${id}`
}

export const goHome = () => {
  window.location.hash = '/'
}

/** Remember the room in the URL across a full-page sign-in redirect (Google), which drops it. */
export const rememberReturnRoom = () => {
  const id = getRoomIdFromLocation()
  try {
    if (id) sessionStorage.setItem('devboard.returnRoom', id)
  } catch {
    /* storage unavailable: they'll land on their rooms page instead */
  }
}

export const takeReturnRoom = (): string | null => {
  try {
    const id = sessionStorage.getItem('devboard.returnRoom')
    sessionStorage.removeItem('devboard.returnRoom')
    return id
  } catch {
    return null
  }
}

/**
 * In a browser this is just the current URL. In Electron (file://) there is no public URL,
 * so set VITE_SHARE_BASE_URL to wherever you host the web build; otherwise we fall back to
 * a devboard:// deep link that opens the desktop app.
 */
export const buildShareLink = (roomId: string) => {
  const envBase = import.meta.env.VITE_SHARE_BASE_URL as string | undefined
  const httpBase = window.location.protocol.startsWith('http')
    ? window.location.origin + window.location.pathname
    : ''
  const base = (envBase || httpBase).replace(/#.*$/, '')
  return base ? `${base}#/r/${roomId}` : `devboard://r/${roomId}`
}

/** Avatar letters: first letter of the first two words ("Anonymous Cat" → "AC", "shaayer" → "S"). */
export const initials = (name: string) => {
  const words = name.trim().split(/\s+/).filter(Boolean)
  // [...word][0] takes a whole character, so names starting with an emoji or accent stay intact.
  return (
    words
      .slice(0, 2)
      .map((w) => [...w][0])
      .join('')
      .toUpperCase() || '?'
  )
}

export const colorFor = (id: string) => {
  let h = 0
  for (const c of id) h = (h * 31 + c.charCodeAt(0)) % 360
  return `hsl(${h} 70% 52%)`
}

// ---------- provider ----------

interface RoomProviderProps {
  roomId: string
  roomName: string
  /** Username for accounts, "Anonymous <Animal>" for guests. Assigned by the server on join. */
  displayName: string
  avatar?: string | null
  userId: string
  isOwner: boolean
  allowGuests: boolean
  unnamed: boolean
  isCreator: boolean
  hasOwner: boolean
  children: React.ReactNode
}

export const RoomProvider: React.FC<RoomProviderProps> = ({
  roomId,
  roomName: initialRoomName,
  displayName,
  avatar,
  userId,
  isOwner: initialIsOwner,
  allowGuests: initialAllowGuests,
  unnamed: initialUnnamed,
  isCreator,
  hasOwner,
  children,
}) => {
  const [roomName, setRoomName] = useState(initialRoomName)
  const [isOwner, setIsOwner] = useState(initialIsOwner)
  const [allowGuests, setAllowGuests] = useState(initialAllowGuests)
  const [unnamed, setUnnamed] = useState(initialUnnamed)
  // Presence is per tab (so two tabs don't fight over one cursor); colour follows the person.
  const idRef = useRef(crypto.randomUUID())
  const me = useMemo<Peer>(
    () => ({
      id: idRef.current,
      name: displayName,
      color: colorFor(userId),
      avatar: avatar ?? null,
    }),
    [displayName, avatar, userId],
  )
  const meRef = useRef(me)
  meRef.current = me

  const [peers, setPeers] = useState<Peer[]>([])
  const [status, setStatus] = useState<RoomStatus>('connecting')
  const statusRef = useRef<RoomStatus>('connecting')
  const channelRef = useRef<RealtimeChannel | null>(null)
  const handlers = useRef(new Map<string, Set<Handler>>())
  const activities = useRef(new Map<string, { activity: string; priority: number }>())
  const currentActivity = useRef<string | null>(null)
  const selection = useRef<PeerSelection>({ board: [], canvas: [] })
  /** Activity + selection of each peer, which arrive by broadcast rather than presence. */
  const peerStates = useRef(new Map<string, PeerState>())
  /** Everyone presence says is here (not including this tab). */
  const present = useRef<Peer[]>([])
  const trackTimer = useRef(0)
  const lastTrackAt = useRef(0)
  const lastTracked = useRef('')
  const stateTimer = useRef(0)
  const lastStateAt = useRef(0)
  const lastState = useRef('')
  const idle = useRef(false)
  const place = useRef<PeerPlace>({})

  const updateStatus = (s: RoomStatus) => {
    statusRef.current = s
    setStatus(s)
  }

  const publishPeers = () =>
    setPeers(
      present.current.map((p) => {
        const s = peerStates.current.get(p.id)
        return {
          ...p,
          activity: s?.activity ?? null,
          selection: s?.selection ?? null,
          idle: s?.idle ?? false,
          place: s?.place ?? null,
        }
      }),
    )

  // Realtime closes the channel of a client that updates presence more than a few times in a few
  // seconds, so presence only says who you are (sent on join and when your name or picture
  // changes). What you're doing and have selected changes constantly, so it goes by broadcast.
  const trackIdentity = useCallback(() => {
    if (trackTimer.current) return
    const wait = Math.max(0, lastTrackAt.current + TRACK_GAP - Date.now())
    trackTimer.current = window.setTimeout(() => {
      trackTimer.current = 0
      if (statusRef.current !== 'live') return
      const key = JSON.stringify(meRef.current)
      if (key === lastTracked.current) return
      lastTracked.current = key
      lastTrackAt.current = Date.now()
      channelRef.current?.track({ ...meRef.current })
    }, wait)
  }, [])

  // Selections can change many times a second (marquee drags), so these are batched too.
  const sendState = useCallback(() => {
    if (stateTimer.current) return
    const wait = Math.max(0, lastStateAt.current + STATE_GAP - Date.now())
    stateTimer.current = window.setTimeout(() => {
      stateTimer.current = 0
      if (statusRef.current !== 'live') return
      const state: PeerState = {
        id: idRef.current,
        activity: currentActivity.current,
        selection: selection.current,
        idle: idle.current,
        place: place.current,
      }
      const key = JSON.stringify(state)
      if (key === lastState.current) return
      lastState.current = key
      lastStateAt.current = Date.now()
      channelRef.current?.send({ type: 'broadcast', event: PEER_STATE, payload: state })
    }, wait)
  }, [])

  useEffect(() => {
    let cancelled = false
    let channel: RealtimeChannel | null = null
    let retryTimer = 0
    let attempts = 0

    const join = () => {
      // Private channel: Realtime checks room membership against the policies on realtime.messages.
      const ch = supabase.channel(`devboard:${roomId}`, {
        config: { private: true, presence: { key: idRef.current }, broadcast: { self: false } },
      })
      channel = ch
      channelRef.current = ch

      ch.on('broadcast', { event: '*' }, (msg: any) => {
        if (msg.event === PEER_STATE) {
          const s = msg.payload as PeerState
          if (!s?.id || s.id === idRef.current) return
          peerStates.current.set(s.id, {
            id: s.id,
            activity: s.activity ?? null,
            selection: s.selection ?? null,
            idle: s.idle === true,
            place: s.place && typeof s.place === 'object' ? s.place : null,
          })
          publishPeers()
          return
        }
        handlers.current.get(msg.event)?.forEach((fn) => fn(msg.payload, false))
      })
        .on('presence', { event: 'join' }, ({ key }: { key: string }) => {
          // Someone new: tell them what we're up to (they missed the earlier broadcasts).
          if (key === idRef.current) return
          lastState.current = ''
          sendState()
        })
        .on('presence', { event: 'sync' }, () => {
          const state = ch.presenceState<Peer>()
          const seen = new Map<string, Peer>()
          Object.values(state)
            .flat()
            .forEach((p) => {
              if (p.id && p.id !== idRef.current)
                seen.set(p.id, {
                  id: p.id,
                  name: p.name,
                  color: p.color,
                  avatar: p.avatar ?? null,
                })
            })
          present.current = [...seen.values()]
          for (const id of peerStates.current.keys())
            if (!seen.has(id)) peerStates.current.delete(id)
          publishPeers()
        })

      const onStatus = (s: string) => {
        if (cancelled || channel !== ch) return
        if (s === 'SUBSCRIBED') {
          attempts = 0
          updateStatus('live')
          // A fresh join has no presence yet, so announce even if nothing changed.
          lastTracked.current = ''
          lastState.current = ''
          trackIdentity()
          sendState()
        } else if (s === 'CHANNEL_ERROR' || s === 'TIMED_OUT') {
          // The client rejoins these by itself.
          updateStatus('offline')
        } else if (s === 'CLOSED') {
          // Closed by the server: it won't come back on its own, so join again on a fresh channel.
          // (The client already dropped this one, so supabase.channel() won't hand it back.)
          channel = null
          channelRef.current = null
          updateStatus('offline')
          present.current = []
          peerStates.current.clear()
          setPeers([])
          retryTimer = window.setTimeout(
            () => {
              if (!cancelled) join()
            },
            Math.min(1000 * 2 ** attempts++, 15000),
          )
        }
      }

      // Make sure the socket carries this user's JWT before joining a private channel.
      supabase.realtime.setAuth().then(() => {
        if (!cancelled && channel === ch) ch.subscribe(onStatus)
      })
    }

    join()
    return () => {
      cancelled = true
      window.clearTimeout(retryTimer)
      window.clearTimeout(trackTimer.current)
      window.clearTimeout(stateTimer.current)
      trackTimer.current = 0
      stateTimer.current = 0
      channelRef.current = null
      if (channel) supabase.removeChannel(channel)
    }
  }, [roomId, trackIdentity, sendState])

  // Inactive = this tab is hidden, or nothing has been touched for IDLE_AFTER. Any input (even
  // just moving the mouse) makes you active again straight away.
  useEffect(() => {
    let lastInput = Date.now()
    const update = () => {
      const next = document.hidden || Date.now() - lastInput >= IDLE_AFTER
      if (next === idle.current) return
      idle.current = next
      sendState()
    }
    const onInput = () => {
      lastInput = Date.now()
      if (idle.current) update()
    }
    // Coming back to the tab counts as activity.
    const onVisibility = () => (document.hidden ? update() : onInput())
    const inputs = ['pointermove', 'pointerdown', 'keydown', 'wheel', 'scroll', 'touchstart']
    inputs.forEach((e) => window.addEventListener(e, onInput, { capture: true, passive: true }))
    document.addEventListener('visibilitychange', onVisibility)
    const timer = window.setInterval(update, 10000)
    update()
    return () => {
      inputs.forEach((e) => window.removeEventListener(e, onInput, { capture: true }))
      document.removeEventListener('visibilitychange', onVisibility)
      window.clearInterval(timer)
    }
  }, [sendState])

  // Re-announce when the display name or picture changes.
  useEffect(() => {
    trackIdentity()
  }, [me, trackIdentity])

  const setActivity = useCallback(
    (source: string, activity: string | null, priority = 1) => {
      if (activity) activities.current.set(source, { activity: activity.slice(0, 120), priority })
      else activities.current.delete(source)
      currentActivity.current =
        [...activities.current.values()].sort((a, b) => b.priority - a.priority)[0]?.activity ??
        null
      sendState()
    },
    [sendState],
  )

  const setPlace = useCallback(
    (patch: PeerPlace) => {
      place.current = { ...place.current, ...patch }
      sendState()
    },
    [sendState],
  )

  const setSelection = useCallback(
    (area: SelectionArea, ids: string[]) => {
      const cur = selection.current[area]
      if (cur.length === ids.length && cur.every((id, i) => id === ids[i])) return
      selection.current = { ...selection.current, [area]: ids.slice(0, 100) }
      sendState()
    },
    [sendState],
  )

  const on = useCallback((event: string, handler: Handler) => {
    if (!handlers.current.has(event)) handlers.current.set(event, new Set())
    handlers.current.get(event)!.add(handler)
    return () => {
      handlers.current.get(event)?.delete(handler)
    }
  }, [])

  const send = useCallback((event: string, payload?: any, local = false) => {
    if (local) handlers.current.get(event)?.forEach((fn) => fn(payload, true))
    if (statusRef.current !== 'live') return
    channelRef.current?.send({ type: 'broadcast', event, payload })
  }, [])

  const value = useMemo(
    () => ({
      roomId,
      roomName,
      isOwner,
      setIsOwner,
      setRoomName,
      allowGuests,
      setAllowGuests,
      unnamed,
      setUnnamed,
      isCreator,
      hasOwner,
      me,
      peers,
      status,
      setActivity,
      setPlace,
      setSelection,
      send,
      on,
    }),
    [
      roomId,
      roomName,
      isOwner,
      allowGuests,
      unnamed,
      isCreator,
      hasOwner,
      me,
      peers,
      status,
      setActivity,
      setPlace,
      setSelection,
      send,
      on,
    ],
  )

  return <RoomContext.Provider value={value}>{children}</RoomContext.Provider>
}

export const useRoom = () => {
  const ctx = useContext(RoomContext)
  if (!ctx) throw new Error('useRoom must be used inside <RoomProvider>')
  return ctx
}
