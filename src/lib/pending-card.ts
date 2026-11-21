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

/** Throws if session storage is unavailable. */
export const setPendingCard = (roomId: string, taskId: string) =>
  sessionStorage.setItem(PENDING_KEY, JSON.stringify({ room: roomId, task: taskId }))
