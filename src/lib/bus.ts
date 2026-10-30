type Handler = (data?: any) => void

const handlers = new Map<string, Set<Handler>>()

/**
 * Tiny in-app event bus. Used so the board and the canvas can talk to each other
 * (e.g. "send this task to the canvas", "jump to this task on the board")
 * without either component knowing about the other.
 */
export const bus = {
  on(event: string, fn: Handler) {
    if (!handlers.has(event)) handlers.set(event, new Set())
    handlers.get(event)!.add(fn)
    return () => {
      handlers.get(event)?.delete(fn)
    }
  },
  emit(event: string, data?: any) {
    handlers.get(event)?.forEach((fn) => fn(data))
  },
}

export const toast = (message: string) => bus.emit('toast', message)

export interface ToastAction {
  label: string
  run: () => void
}

/** A toast with an Undo button, for actions that are easy to reverse (archiving, deleting a checklist). */
export const undoToast = (message: string, undo: () => void) =>
  bus.emit('toast', { message, action: { label: 'Undo', run: undo } })

let nextUploadId = 0

/** Keeps the app-wide upload indicator visible for the duration of a file upload. */
export async function withUploadFeedback<T>(label: string, upload: () => Promise<T>): Promise<T> {
  const id = ++nextUploadId
  bus.emit('upload:start', { id, label })
  try {
    return await upload()
  } finally {
    bus.emit('upload:end', { id })
  }
}

/** True when the keyboard event came from a text field, so global shortcuts should stay out of the way. */
export const isTyping = (e: Event) => {
  const el = e.target as HTMLElement | null
  if (!el) return false
  const tag = el.tagName
  return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || el.isContentEditable
}

/**
 * How many canvas items are linked to each task (by connector or by being created while that task
 * was in focus). The canvas publishes this; the board shows it on task cards.
 * A task id being present means "this task has a card on the canvas".
 */
let linkCounts = new Map<string, number>()
export const getLinkCounts = () => linkCounts
export const setLinkCounts = (counts: Map<string, number>) => {
  linkCounts = counts
  bus.emit('canvas:links', counts)
}
