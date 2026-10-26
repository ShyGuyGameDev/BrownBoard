import { supabase } from './supabase'
import { LIMITS, cleanLine } from './sanitize'

const cleanRoomName = (name: string) => cleanLine(name, LIMITS.roomName)

export interface RoomSession {
  roomId: string
  roomName: string
  displayName: string
  /** Signed-in creator of the room: can rename, re-password, delete and clear the canvas. */
  isOwner: boolean
  /** Whether people without an account can join. On by default; the owner can turn it off. */
  allowGuests: boolean
}

export interface RoomSummary {
  roomId: string
  roomName: string
  lastActiveAt: string
  /** Last change to the board or canvas (tracked by triggers, to the minute). */
  lastEditedAt: string
  isOwner: boolean
  allowGuests: boolean
}

export type RoomError =
  | 'not_found'
  | 'wrong_password'
  | 'taken'
  | 'bad_name'
  | 'bad_password'
  | 'rate_limited'
  | 'not_member'
  | 'not_signed_in'
  | 'not_owner'
  | 'deleted'
  | 'same_password'
  | 'guests_disabled'

export class RoomRpcError extends Error {
  code: RoomError | string
  constructor(code: RoomError | string) {
    super(ROOM_ERRORS[code as RoomError] ?? code)
    this.code = code
  }
}

const ROOM_ERRORS: Record<RoomError, string> = {
  not_found: 'No room has that name.',
  wrong_password: "That password doesn't match this room.",
  taken: 'Another room already uses that name.',
  bad_name: 'Room names are 2–48 characters.',
  bad_password: 'Room passwords need at least 4 characters.',
  rate_limited: 'Too many tries. Wait a few minutes and try again.',
  not_member: "You haven't joined this room yet.",
  not_signed_in: 'Your session expired. Start again.',
  not_owner: 'Only the signed-in person who created this room can do that.',
  deleted: 'This room was deleted by its owner.',
  guests_disabled: 'This room only lets in signed-in accounts. Sign in to join it.',
  same_password:
    'Another room with this name already uses that password. Choose a different password.',
}

async function rpc(fn: string, args: Record<string, string | boolean>) {
  const { data, error } = await supabase.rpc(fn, args)
  if (error) throw new Error(error.message)
  if (!data?.ok) throw new RoomRpcError(data?.error ?? 'unknown')
  return data
}

async function call(fn: string, args: Record<string, string>): Promise<RoomSession> {
  const data = await rpc(fn, args)
  return {
    roomId: data.room_id,
    roomName: data.room_name,
    displayName: data.display_name,
    isOwner: !!data.is_owner,
    allowGuests: data.allow_guests ?? true,
  }
}

/** `roomId` pins the join to one room (invite links), since several rooms can share a name. */
export const joinRoom = (name: string, password: string, roomId?: string) =>
  call('join_room', {
    p_name: cleanRoomName(name),
    p_password: password,
    ...(roomId ? { p_room_id: roomId } : {}),
  })

export const createRoom = (name: string, password: string) =>
  call('create_room', { p_name: cleanRoomName(name), p_password: password })

/** Re-enter a room you're already a member of. */
export const enterRoom = (roomId: string) => call('enter_room', { p_room_id: roomId })

/** One-off notice to show on the next screen (e.g. after a room is deleted). */
export const setFlash = (msg: string) => {
  try {
    sessionStorage.setItem('devboard.flash', msg)
  } catch {
    /* storage unavailable: skip the notice */
  }
}

export const peekFlash = (): string | null => {
  try {
    return sessionStorage.getItem('devboard.flash')
  } catch {
    return null
  }
}

export const clearFlash = () => {
  try {
    sessionStorage.removeItem('devboard.flash')
  } catch {
    /* ignore */
  }
}

/** The room's password, for members. Null for rooms created before passwords were kept readable. */
export async function roomPassword(roomId: string): Promise<string | null> {
  return (await rpc('room_password', { p_room_id: roomId })).password ?? null
}

/* ---------- owner only ---------- */

/**
 * From outside a room (the rooms page): join its channel, run `action`, then tell everyone in
 * the room. Joining first matters for deletes, since afterwards you're no longer a member.
 * Best effort: if the channel can't be reached, the action still runs.
 */
export async function actAndNotify<T>(
  roomId: string,
  action: () => Promise<T>,
  event: string,
  payload: (result: T) => Record<string, unknown> = () => ({}),
): Promise<T> {
  await supabase.realtime.setAuth()
  const channel = supabase.channel(`devboard:${roomId}`, {
    config: { private: true, broadcast: { self: false } },
  })
  const joined = await new Promise<boolean>((resolve) => {
    const timer = setTimeout(() => resolve(false), 4000)
    channel.subscribe((status) => {
      if (status === 'SUBSCRIBED' || status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') {
        clearTimeout(timer)
        resolve(status === 'SUBSCRIBED')
      }
    })
  })
  try {
    const result = await action()
    if (joined) await channel.send({ type: 'broadcast', event, payload: payload(result) })
    return result
  } finally {
    supabase.removeChannel(channel)
  }
}

export const renameRoom = async (roomId: string, name: string): Promise<string> =>
  (await rpc('rename_room', { p_room_id: roomId, p_name: cleanRoomName(name) })).room_name

export const changeRoomPassword = async (roomId: string, password: string) => {
  await rpc('change_room_password', { p_room_id: roomId, p_password: password })
}

/** Turning guests off also removes the guests already in the room. */
export const setGuestAccess = async (roomId: string, allow: boolean) => {
  await rpc('set_room_guest_access', { p_room_id: roomId, p_allow: allow })
}

export const clearCanvas = async (roomId: string) => {
  await rpc('clear_canvas', { p_room_id: roomId })
}

/** Removes the room's uploaded images (best effort), then the room and everything in it. */
export async function deleteRoom(roomId: string) {
  const bucket = supabase.storage.from('board-assets')
  for (const folder of [roomId, `${roomId}/tasks`]) {
    const { data } = await bucket.list(folder, { limit: 1000 })
    const files = (data ?? []).filter((f) => f.id).map((f) => `${folder}/${f.name}`)
    if (files.length) await bucket.remove(files)
  }
  await rpc('delete_room', { p_room_id: roomId })
}

export interface InviteInfo {
  name: string | null
  deleted: boolean
}

/** What an invite link points to, without needing to be a member. */
export async function roomInviteInfo(roomId: string): Promise<InviteInfo> {
  const { data } = await supabase.rpc('room_invite_info', { p_room_id: roomId })
  return { name: data?.name ?? null, deleted: !!data?.deleted }
}

export async function myRooms(userId: string): Promise<RoomSummary[]> {
  const { data, error } = await supabase
    .from('room_members')
    .select('room_id,last_active_at,rooms(name,created_by,last_edited_at,allow_guests)')
    .eq('user_id', userId)
    .order('last_active_at', { ascending: false })
  if (error) throw new Error(error.message)
  return (data ?? []).map((r: any) => ({
    roomId: r.room_id,
    roomName: r.rooms?.name ?? r.room_id,
    lastActiveAt: r.last_active_at,
    lastEditedAt: r.rooms?.last_edited_at ?? r.last_active_at,
    isOwner: r.rooms?.created_by === userId,
    allowGuests: r.rooms?.allow_guests ?? true,
  }))
}
