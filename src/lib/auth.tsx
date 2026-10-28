import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react'
import type { Session, User } from '@supabase/supabase-js'
import { supabase } from './supabase'
import { rememberReturnRoom } from './room'
import { markLeavingToSignIn, rememberLastAccount } from './sign-in-intent'

/**
 * Older username-only accounts are Supabase email accounts with a placeholder address (see the
 * SQL migrations). New accounts sign up with a real email; this only keeps the old ones working.
 */
const USERNAME_DOMAIN =
  (import.meta.env.VITE_USERNAME_EMAIL_DOMAIN as string | undefined) || 'users.brownboard.app'

export const isElectron = navigator.userAgent.includes('Electron')

export const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
export const MIN_PASSWORD = 8

/** Rough preview of the room name an email account gets (the server makes it unique). */
export const usernameFromEmail = (email: string) => {
  let base = email
    .split('@')[0]
    .replace(/[^a-zA-Z0-9_]/g, '')
    .toLowerCase()
    .slice(0, 19)
  if (base.length < 3) base += 'user'
  return base
}

const usernameEmail = (username: string) => `${username.trim().toLowerCase()}@${USERNAME_DOMAIN}`

export interface Profile {
  id: string
  username: string
  signup_method: 'username' | 'oauth' | 'email'
}

interface AuthContextValue {
  ready: boolean
  session: Session | null
  user: User | null
  profile: Profile | null
  /** True for room guests (anonymous Supabase sessions). */
  isGuest: boolean
  /** Username account that hasn't attached a real email yet, so it can't recover a lost password. */
  needsEmail: boolean
  /** Set after following a password-reset link; the app should ask for a new password. */
  recovering: boolean
  signInWithPassword: (login: string, password: string) => Promise<void>
  /** 'signed_in', or 'confirm' when Supabase requires clicking the emailed link first. */
  signUp: (email: string, password: string) => Promise<'signed_in' | 'confirm'>
  /** `loginHint` picks that Google account, so a returning user usually just clicks through. */
  signInWithGoogle: (loginHint?: string) => Promise<void>
  signInAsGuest: () => Promise<void>
  signOut: () => Promise<void>
  updateProfileName: (name: string) => Promise<void>
  updateEmail: (email: string) => Promise<void>
  sendPasswordReset: (email: string) => Promise<void>
  setNewPassword: (password: string) => Promise<void>
}

const AuthContext = createContext<AuthContextValue | null>(null)

/** Turns Supabase's error messages into something a person can act on. */
const friendly = (message: string) => {
  if (/invalid login credentials/i.test(message)) return 'That email or password is incorrect.'
  if (/already registered/i.test(message))
    return 'An account with that email already exists. Sign in instead.'
  if (/email not confirmed/i.test(message))
    return 'Confirm your email first: open the link we sent to your inbox.'
  if (/rate limit|too many/i.test(message)) return 'Too many attempts. Wait a minute and try again.'
  // Project-wide Supabase setting, not a room's "Guest access" switch.
  if (/anonymous sign-ins are disabled/i.test(message))
    return "Guest sign-in isn't set up for this app yet, so you'll need an account to join. (Admin: turn on Anonymous sign-ins in Supabase → Authentication.)"
  if (/database error saving new user/i.test(message))
    return 'Could not create your account. Try again in a moment.'
  return message
}
const fail = (message: string): never => {
  throw new Error(friendly(message))
}

const siteUrl = () => window.location.origin + window.location.pathname

export const AuthProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [ready, setReady] = useState(false)
  const [session, setSession] = useState<Session | null>(null)
  const [loadedProfile, setProfile] = useState<Profile | null>(null)
  const [recovering, setRecovering] = useState(false)

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      setSession(data.session)
      setReady(true)
    })
    const { data } = supabase.auth.onAuthStateChange((event, s) => {
      setSession(s)
      if (event === 'PASSWORD_RECOVERY') setRecovering(true)
    })
    return () => data.subscription.unsubscribe()
  }, [])

  const user = session?.user ?? null
  const isGuest = !!user?.is_anonymous

  const userId = user && !user.is_anonymous ? user.id : null
  // Ignore a profile left over from a previous user while the new one loads.
  const profile = loadedProfile?.id === userId ? loadedProfile : null

  useEffect(() => {
    if (!userId) return
    let cancelled = false
    supabase
      .from('profiles')
      .select('id,username,signup_method')
      .eq('id', userId)
      .maybeSingle()
      .then(({ data }) => {
        if (!cancelled) setProfile((data as Profile) ?? null)
      })
    return () => {
      cancelled = true
    }
  }, [userId])

  const signInWithPassword = useCallback(async (login: string, password: string) => {
    const value = login.trim()
    if (value.includes('@')) {
      const { error } = await supabase.auth.signInWithPassword({ email: value, password })
      if (error) fail(error.message)
      return
    }
    const { error } = await supabase.auth.signInWithPassword({
      email: usernameEmail(value),
      password,
    })
    if (!error) return
    // The username may exist but sign in another way. Say so instead of a bare "wrong password".
    if (/invalid login credentials/i.test(error.message)) {
      const { data: method } = await supabase.rpc('username_sign_in_method', { p_username: value })
      if (method === 'google') fail('This account uses Google. Use "Continue with Google" instead.')
      if (method === 'email')
        fail(
          'This account now signs in with its email address. Enter that instead of the username.',
        )
    }
    fail(error.message)
  }, [])

  const signUp = useCallback(async (email: string, password: string) => {
    const address = email.trim()
    if (!EMAIL_RE.test(address)) fail('Enter a valid email address.')
    if (password.length < MIN_PASSWORD) fail(`Passwords need at least ${MIN_PASSWORD} characters.`)
    // If confirmation is on, the emailed link returns to the bare site URL: remember the room.
    rememberReturnRoom()
    const { data, error } = await supabase.auth.signUp({
      email: address,
      password,
      options: { emailRedirectTo: siteUrl() },
    })
    if (error) fail(error.message)
    // No session means "Confirm email" is on. (Supabase answers the same way for an address that
    // already has an account, so this never reveals which emails are registered.)
    return data.session ? ('signed_in' as const) : ('confirm' as const)
  }, [])

  const signInWithGoogle = useCallback(async (loginHint?: string) => {
    rememberReturnRoom()
    markLeavingToSignIn()
    const { error } = await supabase.auth.signInWithOAuth({
      provider: 'google',
      options: {
        redirectTo: siteUrl(),
        ...(loginHint ? { queryParams: { login_hint: loginHint } } : {}),
      },
    })
    if (error) {
      markLeavingToSignIn(false)
      fail(error.message)
    }
  }, [])

  const signInAsGuest = useCallback(async () => {
    if (session) return
    const { error } = await supabase.auth.signInAnonymously()
    if (error) fail(error.message)
  }, [session])

  const signOut = useCallback(async () => {
    await supabase.auth.signOut()
    setRecovering(false)
  }, [])

  const updateEmail = useCallback(async (email: string) => {
    const address = email.trim()
    if (!EMAIL_RE.test(address)) fail('Enter a valid email address.')
    const { error } = await supabase.auth.updateUser(
      { email: address },
      { emailRedirectTo: siteUrl() },
    )
    if (error) fail(error.message)
    await supabase.auth.refreshSession()
  }, [])

  const updateProfileName = useCallback(async (name: string) => {
    const normalized = name.trim().toLowerCase()
    if (!/^[a-z0-9_]{3,24}$/.test(normalized))
      fail('Names must be 3–24 characters: letters, numbers and underscores.')
    const { data, error } = await supabase.rpc('update_profile_name', {
      p_username: normalized,
    })
    if (error) {
      if (error.code === '23505') fail('That name is already in use.')
      fail(error.message)
    }
    if (typeof data !== 'string') fail('Could not update your profile name. Try again.')
    setProfile((current) =>
      current ? { ...current, username: data } : current,
    )
  }, [])

  const sendPasswordReset = useCallback(async (email: string) => {
    const { error } = await supabase.auth.resetPasswordForEmail(email.trim(), {
      redirectTo: siteUrl(),
    })
    if (error) fail(error.message)
  }, [])

  const setNewPassword = useCallback(async (password: string) => {
    if (password.length < MIN_PASSWORD) fail(`Passwords need at least ${MIN_PASSWORD} characters.`)
    const { error } = await supabase.auth.updateUser({ password })
    if (error) fail(error.message)
    setRecovering(false)
  }, [])

  // Remember who signed in, for "Start a blank room" next time. Older username accounts sign in
  // with their username, since their email is a placeholder.
  useEffect(() => {
    if (!user || user.is_anonymous) return
    const google = user.app_metadata?.provider === 'google'
    const placeholder = !!user.email?.endsWith(`@${USERNAME_DOMAIN}`)
    const login = placeholder ? profile?.username : user.email
    if (login) rememberLastAccount({ login, method: google ? 'google' : 'email' })
  }, [user, profile])

  const needsEmail =
    !!user && !user.is_anonymous && !!user.email?.endsWith(`@${USERNAME_DOMAIN}`) && !user.new_email

  const value = useMemo<AuthContextValue>(
    () => ({
      ready,
      session,
      user,
      profile,
      isGuest,
      needsEmail,
      recovering,
      signInWithPassword,
      signUp,
      signInWithGoogle,
      signInAsGuest,
      signOut,
      updateProfileName,
      updateEmail,
      sendPasswordReset,
      setNewPassword,
    }),
    [
      ready,
      session,
      user,
      profile,
      isGuest,
      needsEmail,
      recovering,
      signInWithPassword,
      signUp,
      signInWithGoogle,
      signInAsGuest,
      signOut,
      updateProfileName,
      updateEmail,
      sendPasswordReset,
      setNewPassword,
    ],
  )

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}

export const useAuth = () => {
  const ctx = useContext(AuthContext)
  if (!ctx) throw new Error('useAuth must be used inside <AuthProvider>')
  return ctx
}
