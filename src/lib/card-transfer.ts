/**
 * Moving and copying cards to a list in this room or another one you're in
 * (move_task_to_room / copy_task_to_room in 20261120_templates_wip_and_cross_board.sql).
 */
import { supabase } from './supabase'
import { actAndNotify } from './rooms'
import { type Attachment, cleanAttachment, extensionOf, taskFiles } from './files'
import { readCover } from './cards'

export interface CopyKeep {
  checklists: boolean
  labels: boolean
  members: boolean
  attachments: boolean
  dates: boolean
}

export const KEEP_ALL: CopyKeep = {
  checklists: true,
  labels: true,
  members: true,
  attachments: true,
  dates: true,
}

export interface TransferTarget {
  roomId: string
  listId: string
  /** Index in the list; null = the bottom. */
  position: number | null
}

const ERRORS: Record<string, string> = {
  not_signed_in: 'Your session expired. Sign in again.',
  not_found: 'That card no longer exists.',
  not_member: "You aren't in that room any more.",
  bad_list: 'That list was archived or deleted. Pick another.',
}

async function call(fn: string, args: Record<string, unknown>): Promise<string> {
  const { data, error } = await supabase.rpc(fn, args)
  if (error)
    throw new Error(
      error.code === 'PGRST202'
        ? 'Moving and copying cards needs the latest database update.'
        : error.message,
    )
  if (!data?.ok) throw new Error(ERRORS[data?.error] ?? 'That didn’t work. Try again.')
  return data.task_id as string
}

/** Lists in a room, in board order, for picking where a card goes. */
export async function loadLists(roomId: string) {
  const { data, error } = await supabase
    .from('categories')
    .select('id, name, position, archived_at')
    .eq('room_id', roomId)
    .order('position', { ascending: true })
  if (error) throw new Error(error.message)
  return (data ?? [])
    .filter((c) => !c.archived_at)
    .map((c) => ({ id: c.id as string, name: c.name as string }))
}

/** How many cards are in a list (archived ones aside), for the "position" picker. */
export async function countCards(listId: string) {
  const { data, error } = await supabase
    .from('tasks')
    .select('id, is_template, archived_at')
    .eq('category_id', listId)
  if (error) throw new Error(error.message)
  return (data ?? []).filter((t) => !t.archived_at).length
}

const bucket = () => supabase.storage.from('board-assets')

/** The storage path of one of our own files, if `url` points into `roomId`'s folder. */
const pathIn = (url: string, roomId: string) => {
  const base = bucket().getPublicUrl('').data.publicUrl.replace(/\/?$/, '/')
  if (!url.startsWith(base)) return null
  const path = decodeURIComponent(url.slice(base.length).split('?')[0])
  return path.startsWith(`${roomId}/`) ? path : null
}

/**
 * Copies a card's files from one room's storage to the other's and points the card at the copies,
 * so they survive the first room being deleted. Best effort: a file that can't be copied keeps
 * its old link. Returns how many couldn't be.
 */
export async function rehomeFiles(taskId: string, fromRoom: string, toRoom: string) {
  if (fromRoom === toRoom) return 0
  const { data: row, error } = await supabase
    .from('tasks')
    .select('images, attachments, cover')
    .eq('id', taskId)
    .single()
  if (error || !row) return 0
  const files = taskFiles(row)
  const moved = new Map<string, string>()
  let failed = 0
  await Promise.all(
    files.map(async (f) => {
      const from = pathIn(f.url, fromRoom)
      if (!from) return
      const ext = extensionOf(from).replace(/[^a-z0-9]/g, '').slice(0, 10)
      const to = `${toRoom}/tasks/${crypto.randomUUID()}${ext ? `.${ext}` : ''}`
      const { error: copyError } = await bucket().copy(from, to)
      if (copyError) failed++
      else moved.set(f.url, bucket().getPublicUrl(to).data.publicUrl)
    }),
  )
  if (!moved.size) return failed
  const attachments = files
    .map((f): Attachment => ({ ...f, url: moved.get(f.url) ?? f.url }))
    .map(cleanAttachment)
    .filter(Boolean)
  const cover = readCover(row.cover)
  const { error: updateError } = await supabase
    .from('tasks')
    .update({
      attachments,
      images: [],
      ...(cover && 'url' in cover && moved.has(cover.url)
        ? { cover: { url: moved.get(cover.url) } }
        : {}),
    })
    .eq('id', taskId)
  return updateError ? files.length : failed
}

/** Runs `action`, and tells the other room's board to reload when the card went somewhere else. */
const withNotice = <T>(fromRoom: string, toRoom: string, action: () => Promise<T>) =>
  fromRoom === toRoom ? action() : actAndNotify(toRoom, action, 'board')

export async function moveCard(taskId: string, fromRoom: string, to: TransferTarget) {
  return withNotice(fromRoom, to.roomId, async () => {
    const id = await call('move_task_to_room', {
      p_task_id: taskId,
      p_room_id: to.roomId,
      p_category_id: to.listId,
      p_position: to.position,
    })
    const failedFiles = await rehomeFiles(id, fromRoom, to.roomId)
    return { taskId: id, failedFiles }
  })
}

export async function copyCard(
  taskId: string,
  fromRoom: string,
  to: TransferTarget,
  opts: { title?: string; keep?: CopyKeep; template?: boolean } = {},
) {
  return withNotice(fromRoom, to.roomId, async () => {
    const id = await call('copy_task_to_room', {
      p_task_id: taskId,
      p_room_id: to.roomId,
      p_category_id: to.listId,
      p_position: to.position,
      p_title: opts.title ?? null,
      p_keep: { ...(opts.keep ?? KEEP_ALL), template: !!opts.template },
    })
    const failedFiles = opts.keep?.attachments === false ? 0 : await rehomeFiles(id, fromRoom, to.roomId)
    return { taskId: id, failedFiles }
  })
}
