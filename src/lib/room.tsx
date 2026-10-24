import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react'
import type { RealtimeChannel } from '@supabase/supabase-js'
import { supabase } from './supabase'

/** Rows created before rooms existed live in this room (see the SQL migration). */
export const LEGACY_ROOM = 'room_1'

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
  me: Peer
  peers: Peer[]
  status: RoomStatus
  setName: (name: string) => void
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

export const getRoomIdFromLocation = () =>
  parseRoomId(window.location.hash) ?? (localStorage.getItem('devboard.room') || LEGACY_ROOM)

export const randomRoomId = () =>
  Array.from(crypto.getRandomValues(new Uint8Array(10)), (b) => 'abcdefghijklmnopqrstuvwxyz0123456789'[b % 36]).join('')

export const goToRoom = (id: string) => {
  localStorage.setItem('devboard.room', id)
  window.location.hash = `/r/${id}`
}

/**
 * In a browser this is just the current URL. In Electron (file://) there is no public URL,
 * so set VITE_SHARE_BASE_URL to wherever you host the web build; otherwise we fall back to
 * a devboard:// deep link that opens the desktop app.
 */
export const buildShareLink = (roomId: string) => {
  const envBase = import.meta.env.VITE_SHARE_BASE_URL as string | undefined
  const httpBase = window.location.protocol.startsWith('http') ? window.location.origin + window.location.pathname : ''
  const base = (envBase || httpBase).replace(/#.*$/, '')
  return base ? `${base}#/r/${roomId}` : `devboard://r/${roomId}`
}

const colorFor = (id: string) => {
  let h = 0
  for (const c of id) h = (h * 31 + c.charCodeAt(0)) % 360
  return `hsl(${h} 70% 52%)`
}

// ---------- provider ----------

export const RoomProvider: React.FC<{ roomId: string; children: React.ReactNode }> = ({ roomId, children }) => {
  const idRef = useRef(crypto.randomUUID())
  const [name, setNameState] = useState(
    () => localStorage.getItem('devboard.name') || `dev-${idRef.current.slice(0, 4)}`,
  )
  const me = useMemo<Peer>(() => ({ id: idRef.current, name, color: colorFor(idRef.current) }), [name])
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
    localStorage.setItem('devboard.room', roomId)
    const channel = supabase.channel(`devboard:${roomId}`, {
      config: { presence: { key: idRef.current }, broadcast: { self: false } },
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
            if (p.id && p.id !== idRef.current) seen.set(p.id, { id: p.id, name: p.name, color: p.color })
          })
        setPeers([...seen.values()])
      })
      .subscribe((s) => {
        if (s === 'SUBSCRIBED') {
          updateStatus('live')
          channel.track(meRef.current)
        } else if (s === 'CLOSED' || s === 'CHANNEL_ERROR' || s === 'TIMED_OUT') {
          updateStatus('offline')
        }
      })

    channelRef.current = channel
    return () => {
      channelRef.current = null
      supabase.removeChannel(channel)
    }
  }, [roomId])

  // Re-announce when the display name changes.
  useEffect(() => {
    if (statusRef.current === 'live') channelRef.current?.track(me)
  }, [me])

  const setName = useCallback((n: string) => {
    const clean = n.trim().slice(0, 24)
    if (!clean) return
    localStorage.setItem('devboard.name', clean)
    setNameState(clean)
  }, [])

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
    () => ({ roomId, me, peers, status, setName, send, on }),
    [roomId, me, peers, status, setName, send, on],
  )

  return <RoomContext.Provider value={value}>{children}</RoomContext.Provider>
}

export const useRoom = () => {
  const ctx = useContext(RoomContext)
  if (!ctx) throw new Error('useRoom must be used inside <RoomProvider>')
  return ctx
}
