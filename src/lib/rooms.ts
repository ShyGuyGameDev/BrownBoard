import { supabase } from './supabase'
import { LIMITS, cleanLine } from './sanitize'

const cleanRoomName = (name: string) => cleanLine(name, LIMITS.roomName)

export interface RoomSession {
  roomId: string
  roomName: string
  displayName: string
  /** Signed-in creator of the room: can rename, delete and clear the canvas. */
  isOwner: boolean
  /** Whether people without an account can join. On by default; the owner can turn it off. */
  allowGuests: boolean
  /**
   * Started without a name ("Untitled room 2"): nobody else can join until it's named. Kept for
   * accounts; a guest's is discarded when they leave.
   */
  unnamed: boolean
  /** You made it, even as a guest (a guest creator can sign in to claim it). */
  isCreator: boolean
  /** It belongs to an account. Rooms made by guests have no owner until claimed. */
  hasOwner: boolean
}

export interface RoomSummary {
  roomId: string
  roomName: string
  lastActiveAt: string
  /** Last change to the board or canvas (tracked by triggers, to the minute). */
  lastEditedAt: string
  isOwner: boolean
  allowGuests: boolean
  /** Untitled: renaming it names it (saveRoom) instead. */
  unnamed: boolean
}

export type RoomError =
  | 'not_found'
  | 'taken'
  | 'bad_name'
  | 'rate_limited'
  | 'not_member'
  | 'not_signed_in'
  | 'not_owner'
  | 'deleted'
  | 'guests_disabled'
  | 'needs_account'
  | 'pick_owner'
  | 'bad_owner'

export class RoomRpcError extends Error {
  code: RoomError | string
  constructor(code: RoomError | string) {
    super(ROOM_ERRORS[code as RoomError] ?? code)
    this.code = code
  }
}

const ROOM_ERRORS: Record<RoomError, string> = {
  not_found: "This link doesn't point to a room.",
  taken: 'Another room already uses that name.',
  bad_name: 'Room names are 2–48 characters.',
  rate_limited: 'Too many tries. Wait a few minutes and try again.',
  not_member: "You haven't joined this room yet.",
  not_signed_in: 'Your session expired. Start again.',
  not_owner: 'Only the signed-in person who created this room can do that.',
  deleted: 'This room was deleted by its owner.',
  guests_disabled: 'This room only lets in signed-in accounts. Sign in to join it.',
  needs_account: 'Sign in to save this room.',
  pick_owner: 'Choose someone to take over this room before you leave it.',
  bad_owner: "That person can't take over this room. Choose someone else.",
}

async function rpc(fn: string, args: Record<string, string | boolean | null>) {
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
    unnamed: !!data.unnamed,
    isCreator: !!data.is_creator,
    hasOwner: data.has_owner ?? true,
  }
}

/** Joins the room a share link points to. The link is all you need. */
export const joinRoom = (roomId: string) => call('join_room', { p_room_id: roomId })

/** A room with no name yet, to get going right away. Name it with saveRoom. */
export const createQuickRoom = () => call('create_quick_room', {})

/** Names an unnamed room, so it's kept and anyone with its link can join. */
export const saveRoom = async (roomId: string, name: string): Promise<string> =>
  (await rpc('save_room', { p_room_id: roomId, p_name: cleanRoomName(name) })).room_name

/** Guest creator only, right before signing in: a one-time code the account uses to claim it. */
export const startRoomClaim = async (roomId: string): Promise<string> =>
  (await rpc('start_room_claim', { p_room_id: roomId })).token

/** Moves a room a guest made to the account they just signed in to. */
export const claimRoom = async (roomId: string, token: string) => {
  await rpc('claim_room', { p_room_id: roomId, p_token: token })
}

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

/** Turning guests off also removes the guests already in the room. */
export const setGuestAccess = async (roomId: string, allow: boolean) => {
  await rpc('set_room_guest_access', { p_room_id: roomId, p_allow: allow })
}

export const clearCanvas = async (roomId: string) => {
  await rpc('clear_canvas', { p_room_id: roomId })
}

async function removeRoomImages(roomId: string) {
  const bucket = supabase.storage.from('board-assets')
  for (const folder of [roomId, `${roomId}/tasks`]) {
    const { data } = await bucket.list(folder, { limit: 1000 })
    const files = (data ?? []).filter((f) => f.id).map((f) => `${folder}/${f.name}`)
    if (files.length) await bucket.remove(files)
  }
}

/** Removes the room's uploaded images (best effort), then the room and everything in it. */
export async function deleteRoom(roomId: string) {
  await removeRoomImages(roomId)
  await rpc('delete_room', { p_room_id: roomId })
}

/** Throws away a guest's untitled room as they leave. Best effort: leftovers are pruned later. */
export async function discardRoom(roomId: string) {
  try {
    await removeRoomImages(roomId)
    await rpc('discard_room', { p_room_id: roomId })
  } catch {
    /* pruned the next time they start a room, or after a day */
  }
}

/** Someone who has been in a room with an account, for its owner to hand it to. */
export interface RoomPerson {
  userId: string
  username: string
  avatarUrl: string | null
  lastSeenAt: string
  /** Still in the room (the others have left it). */
  isMember: boolean
}

/** Owner only: everyone else who has been in the room, most recently seen first. */
export async function roomPeople(roomId: string): Promise<RoomPerson[]> {
  const data = await rpc('room_people', { p_room_id: roomId })
  const people: {
    user_id: string
    username: string
    avatar_url: string | null
    last_seen_at: string
    is_member: boolean
  }[] = data.people ?? []
  return people.map((p) => ({
    userId: p.user_id,
    username: p.username,
    avatarUrl: p.avatar_url ?? null,
    lastSeenAt: p.last_seen_at,
    isMember: !!p.is_member,
  }))
}

export interface LeftRoom {
  /** The room's name afterwards: it gets a number if the new owner already has one called that. */
  roomName: string
  newOwnerName: string | null
}

/**
 * Leave a room; it drops off your rooms page and you'd need its link to come back. The owner
 * has to pass `newOwnerId`, someone from roomPeople, who then owns it.
 */
export async function leaveRoom(roomId: string, newOwnerId?: string): Promise<LeftRoom> {
  const data = await rpc('leave_room', { p_room_id: roomId, p_new_owner: newOwnerId ?? null })
  return { roomName: data.room_name, newOwnerName: data.new_owner_name ?? null }
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
    .select('room_id,last_active_at,rooms(name,created_by,last_edited_at,allow_guests,unnamed)')
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
    unnamed: !!r.rooms?.unnamed,
  }))
}
