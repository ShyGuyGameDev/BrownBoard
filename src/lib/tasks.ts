import { useCallback, useEffect, useMemo, useState } from 'react'
import { supabase } from './supabase'
import { type Attachment, taskFiles } from './files'
import { useRoom } from './room'
import { toast } from './bus'
import {
  type BoardSettings,
  DEFAULT_BOARD_SETTINGS,
  DEFAULT_STATUS,
  DEFAULT_URGENCY,
  type TaskOption,
  categoryValue,
  isTaskDone,
  readCustomFields,
  resolveOption,
  readBoardSettings,
  splitCustom,
} from './options.ts'

export interface TaskLite {
  id: string
  title: string
  /** null = the category isn't on this task */
  status: string | null
  urgency: string | null
  customFields: Record<string, string>
  description: string
  files: Attachment[]
  dueDate: string | null
  assigneeId: string | null
  assigneeName: string | null
  memberIds: string[]
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
    return [
      {
        id: row.id,
        name: row.name,
        avatarUrl: typeof row.avatar_url === 'string' ? row.avatar_url : null,
      },
    ]
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
  const [settings, setSettings] = useState<BoardSettings>(DEFAULT_BOARD_SETTINGS)
  /** Custom category id → its statuses' colours, for the card stripe. */
  const [customColors, setCustomColors] = useState<Map<string, Map<string, string>>>(new Map())
  const [fieldVisibility, setFieldVisibility] = useState({ status: true, urgency: true })
  const [custom, setCustom] = useState<{ status: TaskOption[]; urgency: TaskOption[] }>({
    status: DEFAULT_STATUS,
    urgency: DEFAULT_URGENCY,
  })

  const load = useCallback(async () => {
    const [t, o, fields, board, cf] = await Promise.all([
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
      supabase.from('task_board_settings').select('*').eq('room_id', roomId).maybeSingle(),
      supabase
        .from('task_custom_fields')
        .select('id, task_custom_field_options(value, color)')
        .eq('room_id', roomId),
    ])
    // Missing table (migration not run yet) or no row: the defaults.
    setSettings(board.error ? DEFAULT_BOARD_SETTINGS : readBoardSettings(board.data))
    if (cf.data)
      setCustomColors(
        new Map(
          cf.data.map((f) => [
            f.id,
            new Map(
              ((f.task_custom_field_options ?? []) as { value: string; color: string }[]).map(
                (o) => [o.value, o.color],
              ),
            ),
          ]),
        ),
      )
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
        t.data
          .filter((r: any) => !r.archived_at)
          .map((r: any) => ({
            id: r.id,
            title: r.title,
            status: r.status ?? null,
            urgency: r.urgency ?? null,
            customFields: readCustomFields(r.custom_fields),
            description: r.description ?? '',
            files: taskFiles(r),
            dueDate: r.due_date ?? null,
            assigneeId: r.assignee_id ?? null,
            assigneeName: people.find((p) => p.id === r.assignee_id)?.name ?? null,
            memberIds: Array.isArray(r.member_ids)
              ? r.member_ids
              : r.assignee_id
                ? [r.assignee_id]
                : [],
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
  const statusOpt = useCallback((v: string) => resolveOption(custom.status, v, 'status'), [custom])
  const isDone = useCallback(
    (t: TaskLite) => isTaskDone(settings.crossoffs, t),
    [settings.crossoffs],
  )
  /** The card stripe's colour (from the category chosen in board settings), or null for none. */
  const barColor = useCallback(
    (t: TaskLite): string | null => {
      const field = settings.colorField
      if (!field) return null
      const value = categoryValue(t, field)
      if (value === null) return null
      if (field === 'status')
        return fieldVisibility.status ? resolveOption(custom.status, value, 'status').color : null
      if (field === 'urgency')
        return fieldVisibility.urgency
          ? resolveOption(custom.urgency, value, 'urgency').color
          : null
      return customColors.get(field)?.get(value) ?? null
    },
    [settings.colorField, custom, customColors, fieldVisibility],
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
    isDone,
    barColor,
    assignees,
    statusEnabled: fieldVisibility.status,
    urgencyEnabled: fieldVisibility.urgency,
  }
}
