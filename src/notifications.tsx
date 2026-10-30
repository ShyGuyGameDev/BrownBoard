import React, { useCallback, useEffect, useMemo, useState } from 'react'
import {
  AtSign,
  Bell,
  CalendarClock,
  CheckCheck,
  MessageSquare,
  RefreshCw,
  UserPlus,
} from 'lucide-react'
import { supabase } from './lib/supabase'
import { goToRoom, useRoom } from './lib/room'
import { bus } from './lib/bus'
import { toTitleCase } from './lib/options'
import { useRoomTasks } from './lib/tasks'
import { relative, fullDate } from './lib/time'
import { daysUntil, describeChanges, dueLabel } from './lib/cards'

interface Notification {
  id: string
  roomId: string
  roomName: string | null
  taskId: string | null
  kind: 'mention' | 'comment' | 'added' | 'activity' | string
  actorName: string
  taskTitle: string
  body: string
  detail: Record<string, unknown> | null
  createdAt: string
  readAt: string | null
}

/** A card to open once its room has loaded (set when a notification points to another room). */
const PENDING_KEY = 'brownboard:open-card'

export const takePendingCard = (roomId: string): string | null => {
  try {
    const raw = sessionStorage.getItem(PENDING_KEY)
    if (!raw) return null
    const { room, task } = JSON.parse(raw)
    if (room !== roomId) return null
    sessionStorage.removeItem(PENDING_KEY)
    return typeof task === 'string' ? task : null
  } catch {
    return null
  }
}

const icon = (kind: string) =>
  kind === 'mention' ? (
    <AtSign size={14} />
  ) : kind === 'comment' ? (
    <MessageSquare size={14} />
  ) : kind === 'added' ? (
    <UserPlus size={14} />
  ) : (
    <RefreshCw size={14} />
  )

/**
 * The bell: mentions, comments and changes on cards you watch, being added to a card, and your
 * cards that are due soon in this room. Signed-in accounts only (guests can't be notified).
 */
export const NotificationBell: React.FC<{ userId: string }> = ({ userId }) => {
  const { roomId, on } = useRoom()
  const tasks = useRoomTasks()
  const [open, setOpen] = useState(false)
  const [items, setItems] = useState<Notification[]>([])
  const [unavailable, setUnavailable] = useState(false)

  const load = useCallback(async () => {
    const { data, error } = await supabase
      .from('notifications')
      .select('*, rooms(name)')
      .eq('user_id', userId)
      .order('created_at', { ascending: false })
      .limit(50)
    if (error) {
      // Without room names (or before the migration), try plain rows.
      const plain = await supabase
        .from('notifications')
        .select('*')
        .eq('user_id', userId)
        .order('created_at', { ascending: false })
        .limit(50)
      setUnavailable(!!plain.error)
      if (plain.data) setItems(plain.data.map((r) => toNotification(r)))
      return
    }
    setUnavailable(false)
    setItems((data ?? []).map((r) => toNotification(r)))
  }, [userId])

  useEffect(() => {
    load()
    const timer = window.setInterval(load, 60_000)
    const onFocus = () => load()
    window.addEventListener('focus', onFocus)
    let debounce = 0
    const off = on('board', () => {
      window.clearTimeout(debounce)
      debounce = window.setTimeout(load, 800)
    })
    return () => {
      window.clearInterval(timer)
      window.removeEventListener('focus', onFocus)
      window.clearTimeout(debounce)
      off()
    }
  }, [load, on])

  // Your cards in this room that are overdue or due in the next two days, and not done.
  const dueSoon = useMemo(
    () =>
      tasks.list
        .filter((t) => t.dueDate && t.memberIds.includes(userId) && !tasks.isDone(t))
        .map((t) => ({ task: t, days: daysUntil(t.dueDate!) ?? 99 }))
        .filter((x) => x.days <= 2)
        .sort((a, b) => a.days - b.days),
    [tasks, userId],
  )

  const unread = items.filter((n) => !n.readAt).length

  const markRead = async (ids: string[]) => {
    if (!ids.length) return
    const now = new Date().toISOString()
    setItems((list) =>
      list.map((n) => (ids.includes(n.id) ? { ...n, readAt: n.readAt ?? now } : n)),
    )
    await supabase.from('notifications').update({ read_at: now }).in('id', ids)
  }

  const openCard = (room: string, taskId: string | null) => {
    setOpen(false)
    if (!taskId) return
    if (room === roomId) {
      bus.emit('nav', 'board')
      window.setTimeout(() => bus.emit('board:open-card', { taskId }), 40)
    } else {
      try {
        sessionStorage.setItem(PENDING_KEY, JSON.stringify({ room, task: taskId }))
      } catch {
        /* opens the room without the card */
      }
      goToRoom(room)
    }
  }

  const names = {
    fieldName: (field: string) =>
      field === 'status' ? 'Status' : field === 'urgency' ? 'Urgency' : 'a category',
    valueLabel: (field: string, value: string) =>
      field === 'status'
        ? tasks.statusOpt(value).label
        : field === 'urgency'
          ? tasks.urgencyOpt(value).label
          : toTitleCase(value),
  }

  const text = (n: Notification) => {
    switch (n.kind) {
      case 'mention':
        return (
          <>
            <strong>{n.actorName}</strong> mentioned you on <strong>{n.taskTitle}</strong>
          </>
        )
      case 'comment':
        return (
          <>
            <strong>{n.actorName}</strong> commented on <strong>{n.taskTitle}</strong>
          </>
        )
      case 'added':
        return (
          <>
            <strong>{n.actorName}</strong> added you to <strong>{n.taskTitle}</strong>
          </>
        )
      default:
        return (
          <>
            <strong>{n.actorName}</strong> updated <strong>{n.taskTitle}</strong>
          </>
        )
    }
  }

  /** The second line: the comment, or what changed ("Moved it from To do to Doing"). */
  const quote = (n: Notification) => {
    if (n.kind === 'mention' || n.kind === 'comment') return n.body
    if (n.kind !== 'activity') return ''
    const said = describeChanges(n.detail, names).replace(/\bthis card\b|\bthis\b/g, 'it')
    return said.charAt(0).toUpperCase() + said.slice(1)
  }

  return (
    <div className="relative">
      <button
        className="dv-iconbtn dv-bell"
        aria-label={unread ? `Notifications, ${unread} unread` : 'Notifications'}
        title="Notifications"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
      >
        <Bell size={16} />
        {unread > 0 ? (
          <span className="dv-bell-count">{unread > 9 ? '9+' : unread}</span>
        ) : dueSoon.length > 0 ? (
          <span className="dv-bell-dot" aria-hidden />
        ) : null}
      </button>
      {open && (
        <>
          <div className="fixed inset-0 z-40" onPointerDown={() => setOpen(false)} />
          <div className="dv-menu dv-bell-panel" role="dialog" aria-label="Notifications">
            <div className="flex items-center justify-between px-2 pb-1 pt-1.5">
              <span className="text-sm font-semibold">Notifications</span>
              {unread > 0 && (
                <button
                  className="dv-link flex items-center gap-1 text-xs"
                  onClick={() => markRead(items.filter((n) => !n.readAt).map((n) => n.id))}
                >
                  <CheckCheck size={13} />
                  Mark all as read
                </button>
              )}
            </div>

            {dueSoon.length > 0 && (
              <>
                <div className="dv-menu-head">
                  <CalendarClock size={12} /> Your cards due soon
                </div>
                {dueSoon.map(({ task, days }) => (
                  <button
                    key={task.id}
                    className="dv-notif"
                    onClick={() => openCard(roomId, task.id)}
                  >
                    <span className="dv-notif-icon" data-due={days < 0 ? 'overdue' : 'soon'}>
                      <CalendarClock size={14} />
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-[13px] font-medium">{task.title}</span>
                      <span
                        className="block text-xs"
                        style={{ color: days < 0 ? 'var(--dv-danger)' : 'var(--dv-muted)' }}
                      >
                        {days < 0
                          ? `Overdue · was due ${dueLabel(task.dueDate!)}`
                          : `Due ${dueLabel(task.dueDate!).toLowerCase()}`}
                      </span>
                    </span>
                  </button>
                ))}
                <div className="dv-menu-sep" />
              </>
            )}

            <div className="max-h-[60vh] overflow-y-auto">
              {items.map((n) => (
                <button
                  key={n.id}
                  className="dv-notif"
                  data-unread={!n.readAt}
                  onClick={() => {
                    markRead([n.id])
                    openCard(n.roomId, n.taskId)
                  }}
                >
                  <span className="dv-notif-icon" data-kind={n.kind}>
                    {icon(n.kind)}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block text-[13px] leading-snug">{text(n)}</span>
                    {quote(n) && <span className="dv-notif-quote">{quote(n)}</span>}
                    <span
                      className="block text-[11px]"
                      style={{ color: 'var(--dv-muted)' }}
                      title={fullDate(n.createdAt)}
                    >
                      {relative(n.createdAt)}
                      {n.roomId !== roomId && ` · ${n.roomName ?? 'another room'}`}
                    </span>
                  </span>
                  {!n.readAt && <span className="dv-notif-unread" aria-label="Unread" />}
                </button>
              ))}
              {items.length === 0 && dueSoon.length === 0 && (
                <div className="dv-notif-empty">
                  <Bell size={18} />
                  <p>
                    {unavailable
                      ? 'Notifications aren’t available yet: the database needs its latest update.'
                      : 'You’re all caught up. Mentions, cards you’re added to, and changes on cards you watch show up here.'}
                  </p>
                </div>
              )}
            </div>
          </div>
        </>
      )}
    </div>
  )
}

const toNotification = (r: Record<string, unknown>): Notification => ({
  id: String(r.id),
  roomId: String(r.room_id),
  roomName:
    r.rooms &&
    typeof r.rooms === 'object' &&
    typeof (r.rooms as { name?: unknown }).name === 'string'
      ? (r.rooms as { name: string }).name || null
      : null,
  taskId: typeof r.task_id === 'string' ? r.task_id : null,
  kind: String(r.kind),
  actorName: typeof r.actor_name === 'string' && r.actor_name ? r.actor_name : 'Someone',
  taskTitle: typeof r.task_title === 'string' && r.task_title ? r.task_title : 'a card',
  body: typeof r.body === 'string' ? r.body : '',
  detail: r.detail && typeof r.detail === 'object' ? (r.detail as Record<string, unknown>) : null,
  createdAt: String(r.created_at),
  readAt: typeof r.read_at === 'string' ? r.read_at : null,
})
