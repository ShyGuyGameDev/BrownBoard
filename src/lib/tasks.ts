import { useCallback, useEffect, useMemo, useState } from 'react'
import { supabase } from './supabase'
import { type Attachment, taskFiles } from './files'
import { useRoom } from './room'
import { toast } from './bus'
import {
  DEFAULT_STATUS,
  DEFAULT_URGENCY,
  type TaskOption,
  resolveOption,
  splitCustom,
} from './options.ts'

export interface TaskLite {
  id: string
  title: string
  status: string
  urgency: string
  description: string
  files: Attachment[]
  dueDate: string | null
  assigneeId: string | null
  assigneeName: string | null
}

export interface TaskAssignee {
  id: string
  name: string
  avatarUrl: string | null
}

export async function loadRoomTaskAssignees(roomId: string): Promise<TaskAssignee[]> {
  const { data, error } = await supabase.rpc('task_assignees', { p_room_id: roomId })
  if (error) throw new Error(error.message)

  const result = data as { ok?: boolean; error?: string; people?: unknown } | null
  if (!result?.ok) throw new Error(result?.error ?? 'Could not load task assignees')
  if (!Array.isArray(result.people)) return []

  return result.people.flatMap((person): TaskAssignee[] => {
    if (!person || typeof person !== 'object') return []
    const row = person as Record<string, unknown>
    if (typeof row.id !== 'string' || typeof row.name !== 'string') return []
    return [{
      id: row.id,
      name: row.name,
      avatarUrl: typeof row.avatar_url === 'string' ? row.avatar_url : null,
    }]
  })
}

export const formatDueDate = (value: string) => {
  const match = value.match(/^(\d{4})-(\d{2})-(\d{2})$/)
  if (!match) return value
  const date = new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3])))
  return new Intl.DateTimeFormat(undefined, {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    timeZone: 'UTC',
  }).format(date)
}

/**
 * Live view of the room's tasks. The canvas uses this so task cards always show the current
 * title, status, description and files, and so you can pick tasks to drop onto it.
 */
export function useRoomTasks() {
  const { roomId, on } = useRoom()
  const [list, setList] = useState<TaskLite[]>([])
  const [assignees, setAssignees] = useState<TaskAssignee[]>([])
  const [fieldVisibility, setFieldVisibility] = useState({ status: true, urgency: true })
  const [custom, setCustom] = useState<{ status: TaskOption[]; urgency: TaskOption[] }>({
    status: DEFAULT_STATUS,
    urgency: DEFAULT_URGENCY,
  })

  const load = useCallback(async () => {
    const [t, o, fields] = await Promise.all([
      supabase.from('tasks').select('*').eq('room_id', roomId),
      supabase
        .from('task_options')
        .select('*')
        .eq('room_id', roomId)
        .order('created_at', { ascending: true }),
      supabase
        .from('task_field_category_names')
        .select('field_type, is_deleted')
        .eq('room_id', roomId),
    ])
    if (fields.error) toast(fields.error.message)
    else if (fields.data) {
      setFieldVisibility({
        status: fields.data.find((field) => field.field_type === 'status')?.is_deleted !== true,
        urgency: fields.data.find((field) => field.field_type === 'urgency')?.is_deleted !== true,
      })
    }
    let people: TaskAssignee[] = []
    try {
      people = await loadRoomTaskAssignees(roomId)
    } catch (error) {
      toast(error instanceof Error ? error.message : 'Could not load task assignees')
    }
    setAssignees(people)
    if (t.data) {
      setList(
        t.data.map((r: any) => ({
          id: r.id,
          title: r.title,
          status: r.status,
          urgency: r.urgency ?? 'medium',
          description: r.description ?? '',
          files: taskFiles(r),
          dueDate: r.due_date ?? null,
          assigneeId: r.assignee_id ?? null,
          assigneeName: people.find((p) => p.id === r.assignee_id)?.name ?? null,
        })),
      )
    }
    if (o.data) setCustom(splitCustom(o.data))
  }, [roomId])

  useEffect(() => {
    load()
    return on('board', () => load())
  }, [load, on])

  const byId = useMemo(() => new Map(list.map((t) => [t.id, t])), [list])
  const statusOpt = useCallback(
    (v: string) => resolveOption(custom.status, v, 'status'),
    [custom],
  )
  const urgencyOpt = useCallback(
    (v: string) => resolveOption(custom.urgency, v, 'urgency'),
    [custom],
  )

  return {
    list,
    byId,
    statusOpt,
    urgencyOpt,
    assignees,
    statusEnabled: fieldVisibility.status,
    urgencyEnabled: fieldVisibility.urgency,
  }
}
