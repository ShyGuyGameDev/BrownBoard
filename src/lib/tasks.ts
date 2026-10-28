import { useCallback, useEffect, useMemo, useState } from 'react'
import { supabase } from './supabase'
import { useRoom } from './room'
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
}

/**
 * Lightweight, live view of the room's tasks. The canvas uses this so task cards
 * always show the current title / status, and so you can pick tasks to drop onto it.
 */
export function useRoomTasks() {
  const { roomId, on } = useRoom()
  const [list, setList] = useState<TaskLite[]>([])
  const [custom, setCustom] = useState<{ status: TaskOption[]; urgency: TaskOption[] }>({
    status: [],
    urgency: [],
  })

  const load = useCallback(async () => {
    const [t, o] = await Promise.all([
      supabase.from('tasks').select('id,title,status,urgency').eq('room_id', roomId),
      supabase.from('task_options').select('*').eq('room_id', roomId),
    ])
    if (t.data) {
      setList(
        t.data.map((r: any) => ({
          id: r.id,
          title: r.title,
          status: r.status,
          urgency: r.urgency ?? 'medium',
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
    (v: string) => resolveOption([...DEFAULT_STATUS, ...custom.status], v, 'status'),
    [custom],
  )
  const urgencyOpt = useCallback(
    (v: string) => resolveOption([...DEFAULT_URGENCY, ...custom.urgency], v, 'urgency'),
    [custom],
  )

  return { list, byId, statusOpt, urgencyOpt }
}
