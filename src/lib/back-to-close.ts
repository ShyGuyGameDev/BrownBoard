import { useEffect, useEffectEvent } from 'react'

/** Set while a closed sheet's history entry is being taken back off (history.back() is async). */
let unwinding: Promise<void> | null = null

const takeEntryBack = () => {
  unwinding = new Promise((resolve) => {
    const done = () => {
      window.removeEventListener('popstate', done)
      unwinding = null
      resolve()
    }
    window.addEventListener('popstate', done)
    history.back()
  })
}

/**
 * The phone's Back button (or back swipe) closes whatever is open, instead of leaving the room.
 * Adds a history entry while open and takes it back off when closed some other way.
 */
export function useBackToClose(onClose: () => void, enabled = true) {
  const close = useEffectEvent(onClose)
  useEffect(() => {
    if (!enabled) return
    const token = Math.random().toString(36).slice(2)
    let cancelled = false
    let pushed = false
    let popped = false
    const push = () => {
      if (cancelled) return
      history.pushState({ ...history.state, dvSheet: token }, '')
      pushed = true
    }
    // Deferred, so StrictMode's mount-unmount-mount in dev doesn't push and pop an entry, and
    // so a sheet opened from another one waits for that one's entry to come off first.
    const timer = window.setTimeout(() => (unwinding ? unwinding.then(push) : push()), 0)
    const onPop = (e: PopStateEvent) => {
      // Back from something opened on top of this one lands here; that one closes, not this.
      if (!pushed || e.state?.dvSheet === token) return
      popped = true
      close()
    }
    window.addEventListener('popstate', onPop)
    return () => {
      cancelled = true
      window.clearTimeout(timer)
      window.removeEventListener('popstate', onPop)
      if (pushed && !popped && history.state?.dvSheet === token) takeEntryBack()
    }
  }, [enabled])
}
