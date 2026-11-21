import { useSyncExternalStore } from 'react'

/** Phone-sized windows get the mobile layout. Keep in step with the 640px media queries in devboard.css. */
export const MOBILE_QUERY = '(max-width: 640px)'

const mql = window.matchMedia(MOBILE_QUERY)
const subscribe = (fn: () => void) => {
  mql.addEventListener('change', fn)
  return () => mql.removeEventListener('change', fn)
}

export const isMobileNow = () => mql.matches

/** True while the window is phone-sized; re-renders when that changes (rotating, resizing). */
export const useIsMobile = () => useSyncExternalStore(subscribe, isMobileNow)
