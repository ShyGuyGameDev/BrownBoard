import { hslToHex } from './highlight'

/** Accepts a full share link, a BrownBoard desktop link, or a bare room code. */
export const parseRoomId = (input: string): string | null => {
  const m = input
    .trim()
    .match(/(?:#\/r\/|(?:brownboard|devboard):\/\/(?:join|r)\/|^)([A-Za-z0-9_-]{3,64})\/?$/)
  return m ? m[1] : null
}

/** The room in the URL (`#/r/<id>`), or null on the home / onboarding screens. */
export const getRoomIdFromLocation = () => {
  const m = window.location.hash.match(/^#\/r\/([A-Za-z0-9_-]{3,64})\/?$/)
  return m ? m[1] : null
}

export const goToRoom = (id: string) => {
  window.location.hash = `/r/${id}`
}

export const goHome = () => {
  window.location.hash = '/'
}

/** Remember the room in the URL across a full-page sign-in redirect (Google), which drops it. */
export const rememberReturnRoom = () => {
  const id = getRoomIdFromLocation()
  try {
    if (id) sessionStorage.setItem('devboard.returnRoom', id)
  } catch {
    /* storage unavailable: they'll land on their rooms page instead */
  }
}

export const takeReturnRoom = (): string | null => {
  try {
    const id = sessionStorage.getItem('devboard.returnRoom')
    sessionStorage.removeItem('devboard.returnRoom')
    return id
  } catch {
    return null
  }
}

/**
 * In a browser this is just the current URL. In Electron (file://) there is no public URL,
 * so set VITE_SHARE_BASE_URL to wherever you host the web build; otherwise we fall back to
 * a brownboard:// deep link that opens the desktop app.
 */
export const buildShareLink = (roomId: string) => {
  const envBase = import.meta.env.VITE_SHARE_BASE_URL as string | undefined
  const httpBase = window.location.protocol.startsWith('http')
    ? window.location.origin + window.location.pathname
    : ''
  const base = (envBase || httpBase).replace(/#.*$/, '')
  return base ? `${base}#/r/${roomId}` : `brownboard://r/${roomId}`
}

/** Avatar letters: first letter of the first two words ("Anonymous Cat" → "AC", "shaayer" → "S"). */
export const initials = (name: string) => {
  const words = name.trim().split(/\s+/).filter(Boolean)
  // [...word][0] takes a whole character, so names starting with an emoji or accent stay intact.
  return (
    words
      .slice(0, 2)
      .map((w) => [...w][0])
      .join('')
      .toUpperCase() || '?'
  )
}

const hueFor = (id: string) => {
  let h = 0
  for (const c of id) h = (h * 31 + c.charCodeAt(0)) % 360
  return h
}

export const colorFor = (id: string) => `hsl(${hueFor(id)} 70% 52%)`

/** colorFor as #rrggbb, for colour inputs. */
export const hexColorFor = (id: string) => hslToHex(hueFor(id), 0.7, 0.52)
