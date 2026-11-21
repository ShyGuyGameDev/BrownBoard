import { createContext, useContext } from 'react'

// Room types, context and hook, kept apart from the provider component so Fast Refresh works.

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

/** `fromSelf` is true when the event was emitted locally with send(..., true). */
export type Handler<T = unknown> = (payload: T, fromSelf: boolean) => void

export interface RoomContextValue {
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
  send: (event: string, payload?: unknown, local?: boolean) => void
  /** `T` is the payload shape the sender uses for this event; it isn't checked at runtime. */
  on: <T = unknown>(event: string, handler: Handler<T>) => () => void
}

export const RoomContext = createContext<RoomContextValue | null>(null)

export const useRoom = () => {
  const ctx = useContext(RoomContext)
  if (!ctx) throw new Error('useRoom must be used inside <RoomProvider>')
  return ctx
}
