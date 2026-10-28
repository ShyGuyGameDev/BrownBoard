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

/**
 * The last account signed in on this browser, so starting a room can offer it again. Kept after
 * signing out (that's the point), but never the password: `login` is what the sign-in form takes.
 */
export interface LastAccount {
  login: string
  method: 'google' | 'email'
}

const LAST_ACCOUNT_KEY = 'devboard.lastAccount'

export const rememberLastAccount = (account: LastAccount) => {
  try {
    localStorage.setItem(LAST_ACCOUNT_KEY, JSON.stringify(account))
  } catch {
    /* storage unavailable: starting a room just uses a guest */
  }
}

export const getLastAccount = (): LastAccount | null => {
  try {
    return JSON.parse(localStorage.getItem(LAST_ACCOUNT_KEY) ?? 'null') as LastAccount | null
  } catch {
    return null
  }
}

/** "Start a blank room" sent them to sign in first: open a new room once they're back. */
const START_ROOM_KEY = 'devboard.startRoomAfterSignIn'

export const setStartRoomAfterSignIn = (start: boolean) => {
  try {
    if (start) sessionStorage.setItem(START_ROOM_KEY, '1')
    else sessionStorage.removeItem(START_ROOM_KEY)
  } catch {
    /* storage unavailable: they land on their rooms page instead */
  }
}

export const takeStartRoomAfterSignIn = (): boolean => {
  try {
    const start = sessionStorage.getItem(START_ROOM_KEY) === '1'
    sessionStorage.removeItem(START_ROOM_KEY)
    return start
  } catch {
    return false
  }
}
