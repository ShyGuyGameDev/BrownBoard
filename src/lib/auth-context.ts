import { createContext, useContext } from 'react'
import type { Session, User } from '@supabase/supabase-js'

// Auth types, helpers, context and hook, kept apart from the provider component so Fast Refresh works.

/**
 * Older username-only accounts are Supabase email accounts with a placeholder address (see the
 * SQL migrations). New accounts sign up with a real email; this only keeps the old ones working.
 */
export const USERNAME_DOMAIN =
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

export interface Profile {
  id: string
  username: string
  signup_method: 'username' | 'oauth' | 'email'
  /** Profile picture, or null to show initials. */
  avatar_url?: string | null
  /** #rrggbb shown to others around what you're editing, or null for the default colour. */
  highlight_color?: string | null
  /** Keep highlight_color matched to the profile picture. */
  highlight_sync?: boolean
}

export interface AuthContextValue {
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
  /** New profile picture from a file, or null to remove it. */
  updateAvatar: (file: File | null) => Promise<void>
  /** Saves a highlight colour (null for the default), or with `sync` takes it from your picture. */
  updateHighlight: (color: string | null, sync: boolean) => Promise<void>
  sendPasswordReset: (email: string) => Promise<void>
  setNewPassword: (password: string) => Promise<void>
  /** Deletes every room you own and your account (leaving all other rooms), then signs out. */
  deleteAccount: () => Promise<void>
}

export const AuthContext = createContext<AuthContextValue | null>(null)

export const useAuth = () => {
  const ctx = useContext(AuthContext)
  if (!ctx) throw new Error('useAuth must be used inside <AuthProvider>')
  return ctx
}
