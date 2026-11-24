import { getRoomIdFromLocation } from './room-links'

/**
 * Anonymous visit stats for /analytics (20261124_site_visits.sql). The id lives in memory only:
 * nothing is stored on the device, and no account or room is sent.
 */
export function trackVisit() {
  const optedOut =
    navigator.doNotTrack === '1' || (navigator as { globalPrivacyControl?: boolean }).globalPrivacyControl
  // Not in development, the desktop app, preview deployments or automated browsers.
  if (!import.meta.env.PROD || location.hostname !== 'brownboard.vercel.app' || optedOut || navigator.webdriver) return

  const url = `${import.meta.env.VITE_SUPABASE_URL}/rest/v1/rpc/track_visit`
  const key = import.meta.env.VITE_SUPABASE_ANON_KEY as string
  const screenName = () => getRoomIdFromLocation() ?? 'home'
  const w = window.innerWidth
  const fixed = {
    p_id: crypto.randomUUID(),
    p_landed_on: getRoomIdFromLocation() ? 'room' : 'home',
    p_screen_size: w < 640 ? 'phone' : w < 1024 ? 'tablet' : w < 1600 ? 'laptop' : 'large',
    p_language: navigator.language.split('-')[0].toLowerCase(),
  }

  let current = screenName()
  let screens = 1
  let visibleMs = 0
  let visibleSince = document.hidden ? null : performance.now()

  const send = () => {
    const ms = visibleMs + (visibleSince === null ? 0 : performance.now() - visibleSince)
    fetch(url, {
      method: 'POST',
      keepalive: true,
      headers: { apikey: key, Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...fixed, p_seconds: Math.round(ms / 1000), p_screens: screens }),
    }).catch(() => undefined)
  }
  const pause = () => {
    if (visibleSince === null) return
    visibleMs += performance.now() - visibleSince
    visibleSince = null
    send()
  }
  const resume = () => {
    visibleSince ??= performance.now()
  }

  send()
  // The moment a visit stops counting as a bounce.
  setTimeout(send, 10_500)
  setInterval(() => {
    if (!document.hidden) send()
  }, 30_000)
  document.addEventListener('visibilitychange', () => (document.hidden ? pause() : resume()))
  window.addEventListener('pagehide', pause)
  window.addEventListener('pageshow', resume)
  window.addEventListener('hashchange', () => {
    if (screenName() === current) return
    current = screenName()
    screens += 1
    send()
  })
}
