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
}

export type RoomStatus = 'connecting' | 'live' | 'offline'

/** `fromSelf` is true when the event was emitted locally with send(..., true). */
type Handler = (payload: any, fromSelf: boolean) => void

interface RoomContextValue {
  roomId: string
  roomName: string
  /** Signed-in creator: can rename, re-password, delete the room and clear the canvas. */
  isOwner: boolean
  /** Update the name shown locally (after a rename here or by the owner elsewhere). */
  setRoomName: (name: string) => void
  allowGuests: boolean
  setAllowGuests: (allow: boolean) => void
  me: Peer
  peers: Peer[]
  status: RoomStatus
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
  userId: string
  isOwner: boolean
  allowGuests: boolean
  children: React.ReactNode
}

export const RoomProvider: React.FC<RoomProviderProps> = ({
  roomId,
  roomName: initialRoomName,
  displayName,
  userId,
  isOwner,
  allowGuests: initialAllowGuests,
  children,
}) => {
  const [roomName, setRoomName] = useState(initialRoomName)
  const [allowGuests, setAllowGuests] = useState(initialAllowGuests)
  // Presence is per tab (so two tabs don't fight over one cursor); colour follows the person.
  const idRef = useRef(crypto.randomUUID())
  const me = useMemo<Peer>(
    () => ({ id: idRef.current, name: displayName, color: colorFor(userId) }),
    [displayName, userId],
  )
  const meRef = useRef(me)
  meRef.current = me

  const [peers, setPeers] = useState<Peer[]>([])
  const [status, setStatus] = useState<RoomStatus>('connecting')
  const statusRef = useRef<RoomStatus>('connecting')
  const channelRef = useRef<RealtimeChannel | null>(null)
  const handlers = useRef(new Map<string, Set<Handler>>())

  const updateStatus = (s: RoomStatus) => {
    statusRef.current = s
    setStatus(s)
  }

  useEffect(() => {
    // Private channel: Realtime checks room membership against the policies on realtime.messages.
    const channel = supabase.channel(`devboard:${roomId}`, {
      config: { private: true, presence: { key: idRef.current }, broadcast: { self: false } },
    })

    channel
      .on('broadcast', { event: '*' }, (msg: any) => {
        handlers.current.get(msg.event)?.forEach((fn) => fn(msg.payload, false))
      })
      .on('presence', { event: 'sync' }, () => {
        const state = channel.presenceState<Peer>()
        const seen = new Map<string, Peer>()
        Object.values(state)
          .flat()
          .forEach((p) => {
            if (p.id && p.id !== idRef.current)
              seen.set(p.id, { id: p.id, name: p.name, color: p.color })
          })
        setPeers([...seen.values()])
      })
    const onStatus = (s: string) => {
      if (s === 'SUBSCRIBED') {
        updateStatus('live')
        channel.track(meRef.current)
      } else if (s === 'CLOSED' || s === 'CHANNEL_ERROR' || s === 'TIMED_OUT') {
        updateStatus('offline')
      }
    }

    channelRef.current = channel
    let cancelled = false
    // Make sure the socket carries this user's JWT before joining a private channel.
    supabase.realtime.setAuth().then(() => {
      if (!cancelled) channel.subscribe(onStatus)
    })
    return () => {
      cancelled = true
      channelRef.current = null
      supabase.removeChannel(channel)
    }
  }, [roomId])

  // Re-announce when the display name changes.
  useEffect(() => {
    if (statusRef.current === 'live') channelRef.current?.track(me)
  }, [me])

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
      setRoomName,
      allowGuests,
      setAllowGuests,
      me,
      peers,
      status,
      send,
      on,
    }),
    [roomId, roomName, isOwner, allowGuests, me, peers, status, send, on],
  )

  return <RoomContext.Provider value={value}>{children}</RoomContext.Provider>
}

export const useRoom = () => {
  const ctx = useContext(RoomContext)
  if (!ctx) throw new Error('useRoom must be used inside <RoomProvider>')
  return ctx
}
