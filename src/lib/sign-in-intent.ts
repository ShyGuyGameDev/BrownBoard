/**
 * Signing in from inside a room: what to do once you're back in it. `claim` moves a room the
 * guest made to the account; `then` reopens what they were doing. In localStorage, since a
 * confirmation email can open in a new tab.
 */
export interface SignInIntent {
  roomId: string
  claim?: string
  then?: 'share' | 'settings'
  at: number
}

const INTENT_KEY = 'devboard.signInIntent'

export const setSignInIntent = (intent: Omit<SignInIntent, 'at'>) => {
  try {
    localStorage.setItem(INTENT_KEY, JSON.stringify({ ...intent, at: Date.now() }))
  } catch {
    /* storage unavailable: they come back to the room, without claiming it */
  }
}

/** Claim codes last a day on the server; anything older is dropped. */
export const peekSignInIntent = (): SignInIntent | null => {
  try {
    const intent = JSON.parse(localStorage.getItem(INTENT_KEY) ?? 'null') as SignInIntent | null
    return intent && Date.now() - intent.at < 24 * 3600_000 ? intent : null
  } catch {
    return null
  }
}

export const clearSignInIntent = () => {
  try {
    localStorage.removeItem(INTENT_KEY)
  } catch {
    /* ignore */
  }
}

/** Set right before a full-page sign-in redirect, so the room's "not saved" prompt stays quiet. */
export let leavingToSignIn = false
export const markLeavingToSignIn = (leaving = true) => {
  leavingToSignIn = leaving
}
