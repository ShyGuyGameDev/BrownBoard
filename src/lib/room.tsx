import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { RealtimeChannel } from '@supabase/supabase-js'
import { supabase } from './supabase'
import { colorFor } from './room-links'
import {
  RoomContext,
  type Handler,
  type Peer,
  type PeerPlace,
  type PeerSelection,
  type RoomStatus,
  type SelectionArea,
} from './room-context'

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

// ---------- provider ----------

interface RoomProviderProps {
  roomId: string
  roomName: string
  /** Username for accounts, "Anonymous <Animal>" for guests. Assigned by the server on join. */
  displayName: string
  avatar?: string | null
  /** Chosen highlight colour; null for the default from `userId`. */
  highlightColor?: string | null
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
  highlightColor,
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
      color: highlightColor || colorFor(userId),
      avatar: avatar ?? null,
    }),
    [displayName, avatar, highlightColor, userId],
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
  // seconds, so presence only says who you are (sent on join and when your name, picture or
  // colour changes). What you're doing and have selected changes constantly, so it goes by broadcast.
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

      ch.on('broadcast', { event: '*' }, (msg: { event: string; payload: unknown }) => {
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

  // Re-announce when the display name, picture or colour changes.
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

  const on = useCallback(<T,>(event: string, typed: Handler<T>) => {
    const handler = typed as Handler
    if (!handlers.current.has(event)) handlers.current.set(event, new Set())
    handlers.current.get(event)!.add(handler)
    return () => {
      handlers.current.get(event)?.delete(handler)
    }
  }, [])

  const send = useCallback((event: string, payload?: unknown, local = false) => {
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
