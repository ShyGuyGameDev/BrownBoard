import React, { useCallback, useEffect, useMemo, useState } from 'react'
import type { Session } from '@supabase/supabase-js'
import { supabase } from './supabase'
import { rememberReturnRoom } from './room-links'
import {
  AuthContext,
  EMAIL_RE,
  MIN_PASSWORD,
  USERNAME_DOMAIN,
  type AuthContextValue,
  type Profile,
} from './auth-context'
import { forgetLastAccount, markLeavingToSignIn, rememberLastAccount } from './sign-in-intent'
import { removeRoomImages } from './rooms'
import { withUploadFeedback } from './bus'
import { removeOldAvatars, uploadAvatar } from './upload'
import { imagePrimaryColor } from './highlight'

const usernameEmail = (username: string) => `${username.trim().toLowerCase()}@${USERNAME_DOMAIN}`

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
  // A server function the app calls doesn't exist yet: a migration hasn't been run.
  if (/could not find the function|schema cache/i.test(message))
    return "This isn't set up on the server yet. (Admin: run the latest Supabase migrations.)"
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
      // All columns, so this still works before the avatar_url migration has run.
      .select('*')
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
    setProfile((current) => (current ? { ...current, username: data } : current))
  }, [])

  const saveHighlight = useCallback(async (color: string | null, sync: boolean) => {
    const { error } = await supabase.rpc('update_profile_highlight', {
      p_color: color,
      p_sync: sync,
    })
    if (error) fail(error.message)
    setProfile((current) =>
      current ? { ...current, highlight_color: color, highlight_sync: sync } : current,
    )
  }, [])

  const avatarUrl = loadedProfile?.avatar_url ?? null
  const highlightSync = !!loadedProfile?.highlight_sync

  const updateHighlight = useCallback(
    async (color: string | null, sync: boolean) => {
      // With no picture the icon is your initials on the default colour, which null already means.
      const synced =
        sync && avatarUrl
          ? await imagePrimaryColor(avatarUrl).catch(() =>
              fail("Your picture couldn't be read. Try again."),
            )
          : null
      await saveHighlight(sync ? synced : color, sync)
    },
    [avatarUrl, saveHighlight],
  )

  const updateAvatar = useCallback(
    async (file: File | null) => {
      if (!userId) fail('Sign in to set a profile picture.')
      const url = file
        ? await withUploadFeedback('Uploading profile picture…', () => uploadAvatar(file, userId!))
        : null
      const { error } = await supabase.rpc('update_profile_avatar', { p_url: url })
      if (error) fail(error.message)
      setProfile((current) => (current ? { ...current, avatar_url: url } : current))
      removeOldAvatars(userId!, url).catch(() => undefined)
      // The picture is saved either way; a colour that can't be read just stays as it was.
      if (highlightSync)
        await (url ? imagePrimaryColor(url) : Promise.resolve(null))
          .then((color) => saveHighlight(color, true))
          .catch(() => undefined)
    },
    [userId, highlightSync, saveHighlight],
  )

  const deleteAccount = useCallback(async () => {
    if (!userId) fail('Sign in to delete your account.')
    // Uploaded files can't be removed from SQL, so clear them out first: the images in rooms you
    // own and your profile pictures. Best effort, like deleteRoom.
    const { data: owned } = await supabase.from('rooms').select('id').eq('created_by', userId!)
    await Promise.all(
      [...(owned ?? []).map((r) => removeRoomImages(r.id)), removeOldAvatars(userId!, null)].map(
        (p) => p.catch(() => undefined),
      ),
    )
    const { data, error } = await supabase.rpc('delete_my_account')
    if (error) fail(error.message)
    if (!data?.ok) fail('Could not delete your account. Try again.')
    forgetLastAccount()
    // The account is gone, so only this browser's session needs clearing.
    await supabase.auth.signOut({ scope: 'local' })
    setRecovering(false)
  }, [userId])

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
      updateAvatar,
      updateHighlight,
      sendPasswordReset,
      setNewPassword,
      deleteAccount,
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
      updateAvatar,
      updateHighlight,
      sendPasswordReset,
      setNewPassword,
      deleteAccount,
    ],
  )

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}
