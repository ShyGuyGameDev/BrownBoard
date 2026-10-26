import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react'
import type { Session, User } from '@supabase/supabase-js'
import { supabase } from './supabase'

/**
 * Username accounts are Supabase email accounts with a placeholder address (see the SQL migration).
 * Use a domain you control so the address can never belong to a real inbox.
 */
const USERNAME_DOMAIN =
  (import.meta.env.VITE_USERNAME_EMAIL_DOMAIN as string | undefined) || 'users.brownboard.app'

export const isElectron = navigator.userAgent.includes('Electron')

export const USERNAME_RE = /^[a-z0-9_]{3,24}$/
export const MIN_PASSWORD = 8

const usernameEmail = (username: string) => `${username.trim().toLowerCase()}@${USERNAME_DOMAIN}`

export interface Profile {
  id: string
  username: string
  signup_method: 'username' | 'oauth'
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
  signUp: (username: string, password: string) => Promise<void>
  signInWithGoogle: () => Promise<void>
  signInAsGuest: () => Promise<void>
  signOut: () => Promise<void>
  addEmail: (email: string) => Promise<void>
  sendPasswordReset: (email: string) => Promise<void>
  setNewPassword: (password: string) => Promise<void>
}

const AuthContext = createContext<AuthContextValue | null>(null)

/** Turns Supabase's error messages into something a person can act on. */
const friendly = (message: string) => {
  if (/invalid login credentials/i.test(message)) return 'That username or password is incorrect.'
  if (/already registered/i.test(message)) return 'That username is taken.'
  if (/rate limit|too many/i.test(message)) return 'Too many attempts. Wait a minute and try again.'
  // Project-wide Supabase setting, not a room's "Guest access" switch.
  if (/anonymous sign-ins are disabled/i.test(message))
    return "Guest sign-in isn't set up for this app yet, so you'll need an account to join. (Admin: turn on Anonymous sign-ins in Supabase → Authentication.)"
  if (/database error saving new user/i.test(message))
    return 'That username is taken or not allowed.'
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

  const signUp = useCallback(async (username: string, password: string) => {
    const name = username.trim().toLowerCase()
    if (!USERNAME_RE.test(name))
      fail('Usernames are 3–24 characters: letters, numbers and underscores.')
    if (password.length < MIN_PASSWORD) fail(`Passwords need at least ${MIN_PASSWORD} characters.`)
    const { data: available } = await supabase.rpc('username_available', { p_username: name })
    if (available === false) fail('That username is taken.')
    const { data, error } = await supabase.auth.signUp({
      email: usernameEmail(name),
      password,
      options: { data: { username: name } },
    })
    if (error) fail(error.message)
    if (!data.session)
      fail(
        'Account created, but email confirmation is on in Supabase. Turn it off to use usernames.',
      )
  }, [])

  const signInWithGoogle = useCallback(async () => {
    const { error } = await supabase.auth.signInWithOAuth({
      provider: 'google',
      options: { redirectTo: siteUrl() },
    })
    if (error) fail(error.message)
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

  const addEmail = useCallback(async (email: string) => {
    const { error } = await supabase.auth.updateUser(
      { email: email.trim() },
      { emailRedirectTo: siteUrl() },
    )
    if (error) fail(error.message)
    // With "Confirm email" off the change is immediate; refresh so needsEmail clears.
    await supabase.auth.refreshSession()
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
      addEmail,
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
      addEmail,
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
