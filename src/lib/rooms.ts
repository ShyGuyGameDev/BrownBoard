import { supabase } from './supabase'

export interface RoomSession {
  roomId: string
  roomName: string
  displayName: string
}

export interface RoomSummary {
  roomId: string
  roomName: string
  lastActiveAt: string
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
  taken: 'A room with that name already exists.',
  bad_name: 'Room names are 2–48 characters.',
  bad_password: 'Room passwords need at least 4 characters.',
  rate_limited: 'Too many tries. Wait a few minutes and try again.',
  not_member: "You haven't joined this room yet.",
  not_signed_in: 'Your session expired. Start again.',
}

async function call(fn: string, args: Record<string, string>): Promise<RoomSession> {
  const { data, error } = await supabase.rpc(fn, args)
  if (error) throw new Error(error.message)
  if (!data?.ok) throw new RoomRpcError(data?.error ?? 'unknown')
  return { roomId: data.room_id, roomName: data.room_name, displayName: data.display_name }
}

export const joinRoom = (name: string, password: string) => call('join_room', { p_name: name, p_password: password })

export const createRoom = (name: string, password: string) =>
  call('create_room', { p_name: name, p_password: password })

/** Re-enter a room you're already a member of. */
export const enterRoom = (roomId: string) => call('enter_room', { p_room_id: roomId })

/** The room's name for an invite link, without needing to be a member. */
export async function roomInviteName(roomId: string): Promise<string | null> {
  const { data } = await supabase.rpc('room_invite_name', { p_room_id: roomId })
  return (data as string | null) ?? null
}

export async function myRooms(userId: string): Promise<RoomSummary[]> {
  const { data, error } = await supabase
    .from('room_members')
    .select('room_id,last_active_at,rooms(name)')
    .eq('user_id', userId)
    .order('last_active_at', { ascending: false })
  if (error) throw new Error(error.message)
  return (data ?? []).map((r: any) => ({
    roomId: r.room_id,
    roomName: r.rooms?.name ?? r.room_id,
    lastActiveAt: r.last_active_at,
  }))
}
