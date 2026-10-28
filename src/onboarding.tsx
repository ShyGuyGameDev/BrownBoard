import React, { useEffect, useId, useRef, useState } from 'react'
import {
  AlertCircle,
  ArrowLeft,
  ChevronRight,
  Clock,
  DoorOpen,
  Eye,
  EyeOff,
  Info,
  LogOut,
  Mail,
  Moon,
  Pencil,
  Plus,
  Search,
  Settings,
  Sun,
  UserRound,
  X,
} from 'lucide-react'
import { EMAIL_RE, MIN_PASSWORD, isElectron, useAuth, usernameFromEmail } from './lib/auth'
import {
  RoomRpcError,
  type RoomSummary,
  createQuickRoom,
  clearFlash,
  startRoomClaim,
  joinRoom,
  myRooms,
  peekFlash,
  actAndNotify,
  deleteRoom,
  renameRoom,
  saveRoom,
  setGuestAccess,
} from './lib/rooms'
import { type RoomSettingsActions, RoomSettingsForm } from './room-settings'
import { colorFor, goHome, goToRoom, initials } from './lib/room'
import { getLastAccount, setSignInIntent, setStartRoomAfterSignIn } from './lib/sign-in-intent'
import { useTheme } from './lib/theme'

/* ------------------------------------------------------------------ */
/* Pieces                                                              */
/* ------------------------------------------------------------------ */

export const Brand: React.FC = () => (
  <div className="flex items-center gap-2">
    <div
      className="flex h-6 w-6 items-center justify-center rounded-md text-[13px] font-bold"
      style={{ background: 'var(--dv-accent)', color: 'var(--dv-accent-fg)' }}
    >
      d
    </div>
    <span className="text-[14px] font-semibold tracking-tight">devboard</span>
  </div>
)

const ThemeButton: React.FC = () => {
  const { theme, toggle } = useTheme()
  return (
    <button
      className="dv-iconbtn"
      title={theme === 'dark' ? 'Switch to light theme' : 'Switch to dark theme'}
      onClick={toggle}
    >
      {theme === 'dark' ? <Sun size={16} /> : <Moon size={16} />}
    </button>
  )
}

/** Full-screen dotted backdrop (echoes the canvas) with a centred card. */
const AuthLayout: React.FC<{
  children: React.ReactNode
  wide?: boolean
  top?: React.ReactNode
}> = ({ children, wide, top }) => {
  // StrictMode runs state initialisers twice, so read the notice and clear it in separate steps.
  const [flash] = useState(peekFlash)
  useEffect(() => clearFlash(), [])
  return (
    <div className="dv-auth">
      <div
        className="dv-drag absolute left-0 right-0 top-0 flex h-12 items-center gap-2 px-4"
        style={{ paddingLeft: isElectron && /Mac/i.test(navigator.platform) ? 84 : undefined }}
      >
        {top ?? (
          <>
            <Brand />
            <div className="flex-1" />
          </>
        )}
        <ThemeButton />
      </div>
      <div className={`dv-floating dv-auth-card ${wide ? 'wide' : ''}`}>
        {flash && <Alert tone="info">{flash}</Alert>}
        {children}
      </div>
    </div>
  )
}

const Field: React.FC<{
  label: string
  hint?: React.ReactNode
  children: (id: string) => React.ReactNode
}> = ({ label, hint, children }) => {
  const id = useId()
  return (
    <label className="dv-field" htmlFor={id}>
      <span>{label}</span>
      {children(id)}
      {hint && <span className="dv-hint">{hint}</span>}
    </label>
  )
}

const PasswordInput: React.FC<
  { id: string; value: string; onChange: (v: string) => void } & Omit<
    React.InputHTMLAttributes<HTMLInputElement>,
    'onChange' | 'value' | 'type'
  >
> = ({ id, value, onChange, ...rest }) => {
  const [show, setShow] = useState(false)
  return (
    <div className="dv-pw">
      <input
        id={id}
        className="dv-input lg"
        type={show ? 'text' : 'password'}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        {...rest}
      />
      <button
        type="button"
        className="dv-iconbtn"
        aria-label={show ? 'Hide password' : 'Show password'}
        aria-pressed={show}
        onClick={() => setShow((v) => !v)}
      >
        {show ? <EyeOff size={16} /> : <Eye size={16} />}
      </button>
    </div>
  )
}

const Alert: React.FC<{ tone?: 'error' | 'info' | 'warn'; children: React.ReactNode }> = ({
  tone = 'error',
  children,
}) => (
  <div
    className={`dv-alert ${tone === 'error' ? '' : tone}`}
    role={tone === 'error' ? 'alert' : 'status'}
  >
    {tone === 'error' ? <AlertCircle size={15} /> : <Info size={15} />}
    <div className="min-w-0 flex-1">{children}</div>
  </div>
)

const Submit: React.FC<{ busy: boolean; disabled?: boolean; children: React.ReactNode }> = ({
  busy,
  disabled,
  children,
}) => (
  <button
    type="submit"
    className="dv-btn primary lg block"
    disabled={busy || disabled}
    aria-busy={busy}
  >
    {busy ? <span className="dv-spinner" aria-hidden /> : children}
  </button>
)

const BackButton: React.FC<{ onClick: () => void; label?: string }> = ({
  onClick,
  label = 'Back',
}) => (
  <button type="button" className="dv-btn ghost -ml-2 self-start" onClick={onClick}>
    <ArrowLeft size={14} />
    {label}
  </button>
)

const GoogleIcon = () => (
  <svg width="16" height="16" viewBox="0 0 48 48" aria-hidden>
    <path
      fill="#FFC107"
      d="M43.6 20.5H42V20H24v8h11.3C33.7 32.7 29.2 36 24 36c-6.6 0-12-5.4-12-12s5.4-12 12-12c3.1 0 5.8 1.2 7.9 3.1l5.7-5.7C34 6.1 29.3 4 24 4 12.9 4 4 12.9 4 24s8.9 20 20 20 20-8.9 20-20c0-1.3-.1-2.4-.4-3.5z"
    />
    <path
      fill="#FF3D00"
      d="M6.3 14.7l6.6 4.8C14.7 15.1 19 12 24 12c3.1 0 5.8 1.2 7.9 3.1l5.7-5.7C34 6.1 29.3 4 24 4 16.3 4 9.7 8.3 6.3 14.7z"
    />
    <path
      fill="#4CAF50"
      d="M24 44c5.2 0 9.9-2 13.4-5.2l-6.2-5.2C29.2 35.1 26.7 36 24 36c-5.2 0-9.6-3.3-11.3-8l-6.5 5C9.5 39.6 16.2 44 24 44z"
    />
    <path
      fill="#1976D2"
      d="M43.6 20.5H42V20H24v8h11.3c-.8 2.2-2.2 4.2-4.1 5.6l6.2 5.2C37 39.2 44 34 44 24c0-1.3-.1-2.4-.4-3.5z"
    />
  </svg>
)

const errorText = (e: unknown) =>
  e instanceof Error ? e.message : 'Something went wrong. Try again.'

/* ------------------------------------------------------------------ */
/* Sign in / sign up                                                   */
/* ------------------------------------------------------------------ */

const AccountForm: React.FC<{
  initialTab?: 'signin' | 'signup'
  /** Prefills the email (or old-style username), e.g. with the last account on this browser. */
  initialLogin?: string
  onForgot: () => void
}> = ({ initialTab = 'signin', initialLogin = '', onForgot }) => {
  const { signInWithPassword, signUp, signInWithGoogle } = useAuth()
  const [tab, setTab] = useState(initialTab)
  const [login, setLogin] = useState(initialLogin)
  const [password, setPassword] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [emailTouched, setEmailTouched] = useState(false)
  /** Set after sign-up when Supabase wants the emailed link clicked first. */
  const [sentTo, setSentTo] = useState<string | null>(null)

  const signup = tab === 'signup'
  const email = login.trim()
  const emailOk = EMAIL_RE.test(email)
  const emailBad = signup && emailTouched && email.length > 0 && !emailOk
  const passwordShort = signup && password.length > 0 && password.length < MIN_PASSWORD
  const canSubmit = signup ? emailOk && password.length >= MIN_PASSWORD : !!email && !!password

  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!canSubmit) return
    setBusy(true)
    setError(null)
    try {
      if (signup) {
        if ((await signUp(email, password)) === 'confirm') {
          setSentTo(email)
          setBusy(false)
        }
      } else {
        // Older username-only accounts still sign in by typing their username here.
        await signInWithPassword(login, password)
      }
    } catch (err) {
      setError(errorText(err))
      setBusy(false)
    }
  }

  if (sentTo) {
    return (
      <div className="flex flex-col gap-4">
        <span className="dv-choice-icon">
          <Mail size={18} />
        </span>
        <div className="flex flex-col gap-2">
          <h2>Check your inbox</h2>
          <p className="dv-sub">
            We sent a link to <strong>{sentTo}</strong>. Open it on this device to finish creating
            your account. If it doesn't arrive in a few minutes, check your spam folder.
          </p>
        </div>
        <button
          type="button"
          className="dv-btn lg block"
          onClick={() => {
            setSentTo(null)
            setTab('signin')
            setPassword('')
          }}
        >
          Back to sign in
        </button>
      </div>
    )
  }

  return (
    <div className="flex flex-col gap-5">
      <div className="dv-tabs">
        <div className="dv-seg" role="tablist">
          {(['signin', 'signup'] as const).map((t) => (
            <button
              key={t}
              type="button"
              role="tab"
              aria-selected={tab === t}
              data-active={tab === t}
              onClick={() => {
                setTab(t)
                setError(null)
              }}
            >
              {t === 'signin' ? 'Sign in' : 'Create account'}
            </button>
          ))}
        </div>
      </div>

      {!isElectron && (
        <>
          <button
            type="button"
            className="dv-btn lg block"
            onClick={async () => {
              setError(null)
              try {
                await signInWithGoogle()
              } catch (err) {
                setError(errorText(err))
              }
            }}
          >
            <GoogleIcon />
            Continue with Google
          </button>
          <div className="dv-divider">or</div>
        </>
      )}

      <form className="flex flex-col gap-4" onSubmit={submit} noValidate>
        <Field
          label="Email"
          hint={
            !signup
              ? undefined
              : emailBad
                ? 'Enter a valid email address, like you@example.com.'
                : emailOk
                  ? `In rooms, you'll appear as “${usernameFromEmail(email)}” (or similar, if that's taken).`
                  : 'In rooms, you appear with a name based on your email.'
          }
        >
          {(id) => (
            <input
              id={id}
              className="dv-input lg"
              type="email"
              inputMode="email"
              value={login}
              autoFocus={!initialLogin}
              autoCapitalize="none"
              autoCorrect="off"
              spellCheck={false}
              maxLength={254}
              autoComplete={signup ? 'email' : 'username'}
              placeholder="you@example.com"
              aria-invalid={emailBad}
              onBlur={() => setEmailTouched(true)}
              onChange={(e) => {
                setLogin(e.target.value)
                setError(null)
              }}
            />
          )}
        </Field>
        <Field
          label="Password"
          hint={
            signup
              ? passwordShort
                ? `${MIN_PASSWORD - password.length} more characters to go.`
                : `At least ${MIN_PASSWORD} characters.`
              : undefined
          }
        >
          {(id) => (
            <PasswordInput
              id={id}
              value={password}
              onChange={(v) => {
                setPassword(v)
                setError(null)
              }}
              autoComplete={signup ? 'new-password' : 'current-password'}
              autoFocus={!!initialLogin}
              aria-invalid={passwordShort}
            />
          )}
        </Field>
        {!signup && (
          <button
            type="button"
            className="dv-link -mt-2 self-end"
            style={{ fontSize: 'var(--dv-text-sm)' }}
            onClick={onForgot}
          >
            Forgot password?
          </button>
        )}

        {error && <Alert>{error}</Alert>}

        <Submit busy={busy} disabled={!canSubmit}>
          {signup ? 'Create account' : 'Sign in'}
        </Submit>
      </form>
    </div>
  )
}

const ForgotForm: React.FC<{ onBack: () => void }> = ({ onBack }) => {
  const { sendPasswordReset } = useAuth()
  const [email, setEmail] = useState('')
  const [busy, setBusy] = useState(false)
  const [sent, setSent] = useState(false)
  const [error, setError] = useState<string | null>(null)

  return (
    <>
      <BackButton onClick={onBack} />
      <div className="flex flex-col gap-2">
        <h2>Reset your password</h2>
        <p className="dv-sub">
          Enter the email you added to your account. Username-only accounts without an email can't
          be reset.
        </p>
      </div>
      {sent ? (
        <Alert tone="info">
          If an account uses {email.trim()}, a reset link is on its way. Check your inbox.
        </Alert>
      ) : (
        <form
          className="flex flex-col gap-4"
          onSubmit={async (e) => {
            e.preventDefault()
            setBusy(true)
            setError(null)
            try {
              await sendPasswordReset(email)
              setSent(true)
            } catch (err) {
              setError(errorText(err))
            } finally {
              setBusy(false)
            }
          }}
        >
          <Field label="Email">
            {(id) => (
              <input
                id={id}
                className="dv-input lg"
                type="email"
                autoComplete="email"
                autoFocus
                value={email}
                onChange={(e) => setEmail(e.target.value)}
              />
            )}
          </Field>
          {error && <Alert>{error}</Alert>}
          <Submit busy={busy} disabled={!email.includes('@')}>
            Send reset link
          </Submit>
        </form>
      )}
    </>
  )
}

/* ------------------------------------------------------------------ */
/* Onboarding                                                          */
/* ------------------------------------------------------------------ */

type Step = 'choose' | 'account' | 'forgot'

/** First screen for anyone without an account session (opened without a room link). */
export const Onboarding: React.FC = () => {
  const { signInAsGuest, signInWithGoogle } = useAuth()
  const [step, setStep] = useState<Step>('choose')
  const [starting, setStarting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  // Set when "Start a blank room" is signing in the last account first.
  const [startingAs, setStartingAs] = useState<string | null>(null)

  const startAsGuest = async () => {
    setStarting(true)
    setError(null)
    setStartRoomAfterSignIn(false)
    try {
      await signInAsGuest()
      goToRoom((await createQuickRoom()).roomId)
    } catch (e) {
      setError(errorText(e))
      setStarting(false)
    }
  }

  /**
   * With an account used on this browser before, sign that one in first and the room opens once
   * it's back (see the Router). Google goes straight through; email asks for the password.
   */
  const startRoom = async () => {
    const last = getLastAccount()
    if (!last || (last.method === 'google' && isElectron)) return startAsGuest()
    setError(null)
    setStartRoomAfterSignIn(true)
    if (last.method === 'email') {
      setStartingAs(last.login)
      setStep('account')
      return
    }
    setStarting(true)
    try {
      await signInWithGoogle(last.login)
    } catch (e) {
      setStartRoomAfterSignIn(false)
      setError(errorText(e))
      setStarting(false)
    }
  }

  return (
    <AuthLayout>
      {step === 'choose' && (
        <>
          <div className="flex flex-col gap-2">
            <h1>Welcome to devboard</h1>
            <p className="dv-sub">
              A shared task board and canvas for your team. How would you like to start?
            </p>
          </div>
          <div className="flex flex-col gap-3">
            <button className="dv-choice" onClick={() => setStep('account')}>
              <span className="dv-choice-icon">
                <UserRound size={18} />
              </span>
              <span className="min-w-0 flex-1">
                <span className="dv-choice-title block">Sign in or create an account</span>
                <span className="dv-choice-desc block">
                  Keep every room you've worked in, under your own name.
                </span>
              </span>
              <ChevronRight size={16} style={{ color: 'var(--dv-muted)' }} />
            </button>
            <button className="dv-choice" disabled={starting} onClick={startRoom}>
              <span className="dv-choice-icon">
                <Plus size={18} />
              </span>
              <span className="min-w-0 flex-1">
                <span className="dv-choice-title block">Start a blank room</span>
                <span className="dv-choice-desc block">
                  Jump straight in as a guest. Sign in when you want to keep or share it.
                </span>
              </span>
              {starting ? (
                <span className="dv-spinner" style={{ color: 'var(--dv-muted)' }} />
              ) : (
                <ChevronRight size={16} style={{ color: 'var(--dv-muted)' }} />
              )}
            </button>
          </div>
          {error && <Alert>{error}</Alert>}
        </>
      )}

      {step === 'account' && (
        <>
          <BackButton
            onClick={() => {
              setStartRoomAfterSignIn(false)
              setStartingAs(null)
              setStep('choose')
            }}
          />
          {startingAs && (
            <p className="dv-sub -mt-2">
              Sign in and your new room opens right away.{' '}
              <button type="button" className="dv-link" disabled={starting} onClick={startAsGuest}>
                Start as a guest instead
              </button>
            </p>
          )}
          <AccountForm
            key={startingAs ?? ''}
            initialLogin={startingAs ?? undefined}
            onForgot={() => setStep('forgot')}
          />
        </>
      )}

      {step === 'forgot' && <ForgotForm onBack={() => setStep('account')} />}
    </AuthLayout>
  )
}

/* ------------------------------------------------------------------ */
/* Share link, opened while signed out                                 */
/* ------------------------------------------------------------------ */

/**
 * Straight into the linked room as a guest, in one click. Signing in is one click away too.
 * `onHold(true)` keeps this screen up while the guest session starts and the join runs (the app
 * would otherwise switch to the room gate the moment a session exists); `onHold(false)` hands over.
 * Signing in with an account always hands over, since that isn't a guest session.
 */
export const InviteScreen: React.FC<{
  roomId: string
  roomName: string | null
  deleted: boolean
  onHold: (hold: boolean) => void
}> = ({ roomId, roomName, deleted, onHold }) => {
  const { signInAsGuest } = useAuth()
  const [step, setStep] = useState<'join' | 'account' | 'forgot'>('join')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [accountsOnly, setAccountsOnly] = useState(false)

  if (deleted) {
    return (
      <AuthLayout>
        <div className="flex flex-col gap-2">
          <h1>This room was deleted</h1>
          <p className="dv-sub">Its owner deleted it, so its board and canvas are gone.</p>
        </div>
        <button className="dv-btn lg block" onClick={goHome}>
          Go to the start page
        </button>
      </AuthLayout>
    )
  }

  if (step === 'account' || step === 'forgot') {
    return (
      <AuthLayout>
        {step === 'account' ? (
          <>
            <BackButton onClick={() => setStep('join')} />
            {roomName && (
              <p className="dv-sub -mt-2">
                After you sign in, you'll go straight to <strong>{roomName}</strong>.
              </p>
            )}
            <AccountForm onForgot={() => setStep('forgot')} />
          </>
        ) : (
          <ForgotForm onBack={() => setStep('account')} />
        )}
      </AuthLayout>
    )
  }

  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    setBusy(true)
    setError(null)
    onHold(true)
    try {
      await signInAsGuest()
      await joinRoom(roomId)
      onHold(false) // member now: the room gate takes over and opens the room
    } catch (err) {
      if (err instanceof RoomRpcError && err.code === 'guests_disabled') setAccountsOnly(true)
      else setError(errorText(err))
      setBusy(false)
    }
  }

  return (
    <AuthLayout>
      <div className="flex flex-col gap-2">
        <h1>{roomName ? `Join “${roomName}”` : 'Join this room'}</h1>
        <p className="dv-sub">
          You've been invited to a shared board and canvas. Jump in as a guest, or sign in.
        </p>
      </div>

      {accountsOnly ? (
        <Alert tone="info">
          <div className="flex flex-col gap-2">
            <span>This room only lets in signed-in accounts.</span>
            <button
              type="button"
              className="dv-btn primary self-start"
              onClick={() => setStep('account')}
            >
              Sign in or create an account
            </button>
          </div>
        </Alert>
      ) : (
        <form className="flex flex-col gap-4" onSubmit={submit}>
          {error && <Alert>{error}</Alert>}
          <Submit busy={busy}>Join as a guest</Submit>
          <p className="dv-sub text-center" style={{ fontSize: 'var(--dv-text-xs)' }}>
            You'll join as a guest, shown to others as an anonymous animal like “Anonymous Otter”.
          </p>
        </form>
      )}

      {!accountsOnly && (
        <>
          <div className="dv-divider">or</div>
          <button type="button" className="dv-btn lg block" onClick={() => setStep('account')}>
            <UserRound size={16} />
            Sign in to join with your account
          </button>
        </>
      )}
    </AuthLayout>
  )
}

/* ------------------------------------------------------------------ */
/* Join prompt for an invite link when you're signed in but not a member */
/* ------------------------------------------------------------------ */

export const JoinRoomScreen: React.FC<{
  roomId: string
  roomName: string | null
  deleted: boolean
  /** Why joining from the link failed. */
  error: unknown
}> = ({ roomName, deleted, error }) => {
  const { isGuest, signOut } = useAuth()
  const code = error instanceof RoomRpcError ? error.code : null
  const accountsOnly = code === 'guests_disabled'
  const missing = deleted || code === 'not_found' || code === 'deleted'
  return (
    <AuthLayout>
      <BackButton
        onClick={() => (isGuest ? signOut().then(goHome) : goHome())}
        label={isGuest ? 'Back' : 'Your rooms'}
      />
      <div className="flex flex-col gap-2">
        <h2>
          {deleted || code === 'deleted'
            ? 'This room was deleted'
            : missing
              ? 'Room not found'
              : accountsOnly && roomName
                ? `“${roomName}” is for accounts only`
                : "Couldn't open this room"}
        </h2>
        <p className="dv-sub">
          {deleted || code === 'deleted'
            ? 'Its owner deleted it, so its board and canvas are gone.'
            : missing
              ? "This link doesn't point to a room. Check that you copied all of it."
              : accountsOnly
                ? 'This room only lets in signed-in accounts.'
                : errorText(error)}
        </p>
      </div>
      {/* Signing out of the guest session brings back the link's sign-in screen. */}
      {accountsOnly && isGuest && (
        <button className="dv-btn primary lg block" onClick={signOut}>
          <UserRound size={16} />
          Sign in or create an account
        </button>
      )}
    </AuthLayout>
  )
}

/* ------------------------------------------------------------------ */
/* Signed-in home: your rooms                                          */
/* ------------------------------------------------------------------ */

const relative = (iso: string) => {
  const diff = (new Date(iso).getTime() - Date.now()) / 1000
  const rtf = new Intl.RelativeTimeFormat(undefined, { numeric: 'auto' })
  const steps: [Intl.RelativeTimeFormatUnit, number][] = [
    ['year', 31536000],
    ['month', 2592000],
    ['week', 604800],
    ['day', 86400],
    ['hour', 3600],
    ['minute', 60],
  ]
  for (const [unit, secs] of steps)
    if (Math.abs(diff) >= secs) return rtf.format(Math.round(diff / secs), unit)
  return 'just now'
}

const AddEmailBanner: React.FC = () => {
  const { updateEmail } = useAuth()
  const [open, setOpen] = useState(false)
  const [email, setEmail] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  return (
    <div className="dv-alert warn flex-col">
      <div className="flex items-start gap-2">
        <Mail size={15} className="mt-0.5 shrink-0" />
        <div className="flex-1">
          <strong>Add an email so you can't lose your account.</strong> Without one, there's no way
          to reset a forgotten password.
        </div>
        {!open && (
          <button className="dv-btn shrink-0" onClick={() => setOpen(true)}>
            Add email
          </button>
        )}
      </div>
      {open && (
        <form
          className="mt-2 flex w-full flex-col gap-2"
          onSubmit={async (e) => {
            e.preventDefault()
            setBusy(true)
            setError(null)
            try {
              await updateEmail(email)
            } catch (err) {
              setError(errorText(err))
            } finally {
              setBusy(false)
            }
          }}
        >
          <div className="flex gap-2">
            <input
              className="dv-input"
              type="email"
              autoComplete="email"
              placeholder="you@example.com"
              autoFocus
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              style={{ color: 'var(--dv-text)' }}
            />
            <button className="dv-btn primary shrink-0" disabled={busy || !email.includes('@')}>
              {busy ? <span className="dv-spinner" /> : 'Save'}
            </button>
          </div>
          <span style={{ fontSize: 'var(--dv-text-xs)' }}>
            After this, sign in with your email instead of your username. Your username stays the
            same in rooms.
          </span>
          {error && <span style={{ color: 'var(--dv-danger)' }}>{error}</span>}
        </form>
      )}
    </div>
  )
}

const fullDate = (iso: string) =>
  new Date(iso).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' })

/**
 * Text field that edits in place: Enter saves, Escape cancels. Blur saves when `saveOnBlur`,
 * otherwise cancels, so clicking away never changes anything by accident.
 */
export const InlineEdit: React.FC<{
  initial: string
  label: string
  placeholder?: string
  maxLength: number
  minLength: number
  saveOnBlur?: boolean
  onSave: (value: string) => Promise<void>
  onCancel: () => void
}> = ({ initial, label, placeholder, maxLength, minLength, saveOnBlur, onSave, onCancel }) => {
  const [value, setValue] = useState(initial)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const done = useRef(false)

  const save = async () => {
    if (busy || done.current) return
    const v = value.trim()
    if (v === initial.trim()) return onCancel()
    if (v.length < minLength) {
      setError(`At least ${minLength} characters.`)
      return
    }
    setBusy(true)
    setError(null)
    try {
      await onSave(v)
      done.current = true
    } catch (e) {
      setError(errorText(e))
      setBusy(false)
    }
  }

  return (
    <div className="dv-inline-edit">
      <input
        className="dv-input dv-inline-input"
        aria-label={label}
        aria-invalid={!!error}
        value={value}
        placeholder={placeholder}
        maxLength={maxLength}
        disabled={busy}
        autoFocus
        autoComplete="off"
        spellCheck={false}
        onFocus={(e) => e.currentTarget.select()}
        onChange={(e) => {
          setValue(e.target.value)
          setError(null)
        }}
        onKeyDown={(e) => {
          if (e.key === 'Enter') save()
          else if (e.key === 'Escape') onCancel()
        }}
        onBlur={() => (saveOnBlur ? save() : !busy && onCancel())}
      />
      {error && (
        <p className="dv-inline-error" role="alert">
          {error}
        </p>
      )}
    </div>
  )
}

const RoomCard: React.FC<{
  room: RoomSummary
  onSettings: () => void
  /** Owners only: inline rename. */
  actions?: RoomSettingsActions
}> = ({ room, onSettings, actions }) => {
  const [renaming, setRenaming] = useState(false)
  // The name opens the room on a single click, but waits a moment in case it's a double-click.
  const clickTimer = useRef<number | undefined>(undefined)
  useEffect(() => () => window.clearTimeout(clickTimer.current), [])

  return (
    <article className="dv-room-card">
      {/* Stretched button: the whole card opens the room; in-card controls sit above it. */}
      <button
        type="button"
        className="dv-room-card-open"
        aria-label={`Open ${room.roomName}`}
        onClick={() => goToRoom(room.roomId)}
      />
      <div
        className="dv-room-cover"
        style={{ '--room': colorFor(room.roomId) } as React.CSSProperties}
      >
        <span className="dv-room-initial" aria-hidden>
          {room.roomName.slice(0, 1).toUpperCase()}
        </span>
        {room.isOwner && (
          <>
            <span className="dv-room-owner">Owner</span>
            <button
              type="button"
              className="dv-room-settings"
              aria-label={`Settings for ${room.roomName}`}
              title="Room settings"
              onClick={onSettings}
            >
              <Settings size={15} />
            </button>
          </>
        )}
      </div>
      <div className="dv-room-body">
        {renaming && actions ? (
          <InlineEdit
            initial={room.roomName}
            label="Room name"
            minLength={2}
            maxLength={48}
            saveOnBlur
            onSave={async (name) => {
              await actions.rename(name)
              setRenaming(false)
            }}
            onCancel={() => setRenaming(false)}
          />
        ) : actions ? (
          <h3
            className="dv-room-name editable"
            title="Double-click to rename"
            onClick={() => {
              window.clearTimeout(clickTimer.current)
              clickTimer.current = window.setTimeout(() => goToRoom(room.roomId), 220)
            }}
            onDoubleClick={() => {
              window.clearTimeout(clickTimer.current)
              setRenaming(true)
            }}
          >
            <span className="truncate">{room.roomName}</span>
            <Pencil size={12} className="dv-edit-hint" aria-hidden />
          </h3>
        ) : (
          <h3 className="dv-room-name" title={room.roomName}>
            {room.roomName}
          </h3>
        )}
        <p className="dv-room-meta">
          <Clock size={12} aria-hidden />
          Edited{' '}
          <time dateTime={room.lastEditedAt} title={fullDate(room.lastEditedAt)}>
            {relative(room.lastEditedAt)}
          </time>
          {!room.allowGuests && <span title="Guests can't join this room"> · Accounts only</span>}
        </p>
      </div>
    </article>
  )
}

const RoomCardSkeleton: React.FC = () => (
  <div className="dv-room-card dv-skeleton" aria-hidden>
    <div className="dv-room-cover" />
    <div className="dv-room-body">
      <div className="dv-skel-line" style={{ width: '60%' }} />
      <div className="dv-skel-line" style={{ width: '40%' }} />
      <div className="dv-skel-line" style={{ width: '75%' }} />
    </div>
  </div>
)

const Modal: React.FC<{ title: string; onClose: () => void; children: React.ReactNode }> = ({
  title,
  onClose,
  children,
}) => {
  const titleId = useId()
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose()
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])
  return (
    <div
      className="dv-modal-backdrop"
      onPointerDown={(e) => e.target === e.currentTarget && onClose()}
    >
      <div
        className="dv-floating dv-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
      >
        <div className="flex items-center justify-between">
          <h2 id={titleId}>{title}</h2>
          <button type="button" className="dv-iconbtn" aria-label="Close" onClick={onClose}>
            <X size={16} />
          </button>
        </div>
        {children}
      </div>
    </div>
  )
}

const ProfileSettings: React.FC<{ onClose: () => void }> = ({ onClose }) => {
  const { user, profile, needsEmail, updateProfileName, updateEmail, setNewPassword } = useAuth()
  const [name, setName] = useState(profile?.username ?? '')
  const [email, setEmail] = useState(needsEmail ? '' : (user?.email ?? ''))
  const [password, setPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [busy, setBusy] = useState<'name' | 'email' | 'password' | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)

  const submit = async (
    section: 'name' | 'email' | 'password',
    action: () => Promise<void>,
    success: string,
  ) => {
    setBusy(section)
    setError(null)
    setNotice(null)
    try {
      await action()
      setNotice(success)
      if (section === 'password') {
        setPassword('')
        setConfirmPassword('')
      }
    } catch (e) {
      setError(errorText(e))
    } finally {
      setBusy(null)
    }
  }

  return (
    <Modal title="Edit profile" onClose={onClose}>
      <p className="dv-sub -mt-2">
        Your name is how you appear to others in rooms. Names use 3–24 letters, numbers, or
        underscores.
      </p>
      <form
        className="flex flex-col gap-3"
        onSubmit={(e) => {
          e.preventDefault()
          void submit('name', () => updateProfileName(name), 'Your name has been updated.')
        }}
      >
        <Field label="Name">
          {(id) => (
            <input
              id={id}
              className="dv-input lg"
              autoComplete="username"
              maxLength={24}
              value={name}
              onChange={(e) => setName(e.target.value)}
            />
          )}
        </Field>
        <Submit
          busy={busy === 'name'}
          disabled={!profile || !/^[a-zA-Z0-9_]{3,24}$/.test(name.trim())}
        >
          Save name
        </Submit>
      </form>

      <form
        className="flex flex-col gap-3 border-t pt-4"
        style={{ borderColor: 'var(--dv-border)' }}
        onSubmit={(e) => {
          e.preventDefault()
          void submit(
            'email',
            () => updateEmail(email),
            'Email update requested. Check your inbox if confirmation is required.',
          )
        }}
      >
        <Field label="Linked email">
          {(id) => (
            <input
              id={id}
              className="dv-input lg"
              type="email"
              autoComplete="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
            />
          )}
        </Field>
        <Submit busy={busy === 'email'} disabled={!EMAIL_RE.test(email.trim())}>
          Save email
        </Submit>
      </form>

      <form
        className="flex flex-col gap-3 border-t pt-4"
        style={{ borderColor: 'var(--dv-border)' }}
        onSubmit={(e) => {
          e.preventDefault()
          void submit('password', () => setNewPassword(password), 'Your password has been updated.')
        }}
      >
        <Field label="New password" hint={`At least ${MIN_PASSWORD} characters.`}>
          {(id) => (
            <PasswordInput
              id={id}
              value={password}
              onChange={setPassword}
              autoComplete="new-password"
            />
          )}
        </Field>
        <Field label="Confirm new password">
          {(id) => (
            <PasswordInput
              id={id}
              value={confirmPassword}
              onChange={setConfirmPassword}
              autoComplete="new-password"
            />
          )}
        </Field>
        <Submit
          busy={busy === 'password'}
          disabled={password.length < MIN_PASSWORD || password !== confirmPassword}
        >
          Save password
        </Submit>
      </form>
      {error && <Alert>{error}</Alert>}
      {notice && <Alert tone="info">{notice}</Alert>}
    </Modal>
  )
}

/* ------------------------------------------------------------------ */
/* Signing in from inside a room                                       */
/* ------------------------------------------------------------------ */

export type SignInReason = 'share' | 'save' | 'header'

const SIGN_IN_TITLES: Record<SignInReason, string> = {
  share: 'Sign in to share this room',
  save: 'Sign in to save this room',
  header: 'Sign in',
}

/**
 * The start screen's sign-in, over the room. Signing in swaps the guest session for the account,
 * which reopens the room as that account; a room the guest made moves to it (see claim_room).
 * Google leaves the page, so what to do afterwards is kept in a sign-in intent.
 */
export const SignInPanel: React.FC<{
  roomId: string
  reason: SignInReason
  /** The guest made this room, so it moves to the account. */
  claim: boolean
  guestName: string
  onClose: () => void
}> = ({ roomId, reason, claim, guestName, onClose }) => {
  const [step, setStep] = useState<'account' | 'forgot'>('account')
  const [ready, setReady] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    const then = reason === 'share' ? 'share' : reason === 'save' ? 'settings' : undefined
    ;(claim ? startRoomClaim(roomId) : Promise.resolve(undefined))
      .then((token) => {
        if (cancelled) return
        setSignInIntent({ roomId, claim: token, then })
        setReady(true)
      })
      .catch((e) => !cancelled && setError(errorText(e)))
    return () => {
      cancelled = true
    }
  }, [roomId, reason, claim])

  return (
    <Modal title={SIGN_IN_TITLES[reason]} onClose={onClose}>
      {step === 'forgot' ? (
        <ForgotForm onBack={() => setStep('account')} />
      ) : (
        <>
          <p className="dv-sub -mt-2">
            {claim
              ? "Rooms belong to an account. Sign in or create one and this room moves to it. You'll come straight back here."
              : `You'll come straight back to this room, under your own name instead of “${guestName}”.`}
          </p>
          {error ? (
            <Alert>{error}</Alert>
          ) : ready ? (
            <AccountForm onForgot={() => setStep('forgot')} />
          ) : (
            <div className="flex justify-center py-6">
              <span className="dv-spinner" style={{ color: 'var(--dv-muted)' }} />
            </div>
          )}
        </>
      )}
    </Modal>
  )
}

export const RoomsHome: React.FC = () => {
  const { user, profile, needsEmail, signOut } = useAuth()
  const [rooms, setRooms] = useState<RoomSummary[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [starting, setStarting] = useState(false)
  const [startError, setStartError] = useState<string | null>(null)
  const [query, setQuery] = useState('')
  const [settingsId, setSettingsId] = useState<string | null>(null)
  const [profileSettingsOpen, setProfileSettingsOpen] = useState(false)
  const [notice, setNotice] = useState<string | null>(null)
  const settingsRoom = rooms?.find((r) => r.roomId === settingsId) ?? null

  // From here we're not in the room, so each action briefly joins its channel to tell members.
  const settingsActions = (room: RoomSummary): RoomSettingsActions => ({
    // An untitled room is named instead. Only its owner is in it, so there's nobody to tell.
    rename: async (newName) => {
      const saved = room.unnamed
        ? await saveRoom(room.roomId, newName)
        : await actAndNotify(
            room.roomId,
            () => renameRoom(room.roomId, newName),
            'room:renamed',
            (n) => ({ name: n }),
          )
      setRooms(
        (rs) =>
          rs?.map((r) =>
            r.roomId === room.roomId
              ? { ...r, roomName: saved, unnamed: false, lastEditedAt: new Date().toISOString() }
              : r,
          ) ?? rs,
      )
      return saved
    },
    setGuestAccess: async (allow) => {
      await actAndNotify(
        room.roomId,
        () => setGuestAccess(room.roomId, allow),
        'room:guests',
        () => ({
          allow,
        }),
      )
      setRooms(
        (rs) => rs?.map((r) => (r.roomId === room.roomId ? { ...r, allowGuests: allow } : r)) ?? rs,
      )
    },
    remove: async () => {
      await actAndNotify(room.roomId, () => deleteRoom(room.roomId), 'room:deleted')
      setSettingsId(null)
      setRooms((rs) => rs?.filter((r) => r.roomId !== room.roomId) ?? rs)
      setNotice(`“${room.roomName}” was deleted.`)
    },
  })
  const [flash] = useState(peekFlash)
  useEffect(() => clearFlash(), [])

  useEffect(() => {
    if (!user) return
    myRooms(user.id)
      .then((r) => setRooms([...r].sort((a, b) => b.lastEditedAt.localeCompare(a.lastEditedAt))))
      .catch((e) => setError(errorText(e)))
  }, [user])

  const name = profile?.username ?? user?.email ?? ''
  const q = query.trim().toLowerCase()
  const shown = rooms?.filter((r) => !q || r.roomName.toLowerCase().includes(q)) ?? null

  return (
    <div className="dv-home dv-scroll">
      <header
        className="dv-home-bar dv-drag"
        style={{ paddingLeft: isElectron && /Mac/i.test(navigator.platform) ? 84 : undefined }}
      >
        <Brand />
        <div className="flex-1" />
        <div className="flex items-center gap-2 text-[13px]" style={{ color: 'var(--dv-muted)' }}>
          <div
            className="flex h-7 w-7 items-center justify-center rounded-full text-[10px] font-bold text-white"
            style={{ background: user ? colorFor(user.id) : 'var(--dv-muted)' }}
          >
            {initials(name)}
          </div>
          <span className="max-sm:hidden">{name}</span>
        </div>
        <button
          className="dv-btn ghost"
          title="Edit profile"
          onClick={() => setProfileSettingsOpen(true)}
        >
          <Pencil size={14} />
          <span className="max-sm:hidden">Profile</span>
        </button>
        <button className="dv-btn ghost" onClick={signOut}>
          <LogOut size={14} />
          <span className="max-sm:hidden">Sign out</span>
        </button>
        <ThemeButton />
      </header>

      <main className="dv-home-main">
        {flash && <Alert tone="info">{flash}</Alert>}
        {notice && <Alert tone="info">{notice}</Alert>}
        {needsEmail && <AddEmailBanner />}

        <div className="dv-home-head">
          <div className="flex min-w-0 flex-col gap-1">
            <h1>Your rooms</h1>
            <p className="dv-sub">
              You appear as {profile ? <strong>{profile.username}</strong> : 'yourself'} in every
              room.
            </p>
          </div>
          <div className="dv-home-actions">
            {rooms && rooms.length > 4 && (
              <label className="dv-search">
                <Search size={14} aria-hidden />
                <input
                  className="dv-input"
                  placeholder="Search rooms"
                  aria-label="Search rooms"
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                />
              </label>
            )}
            <button
              className="dv-btn primary"
              disabled={starting}
              onClick={async () => {
                setStarting(true)
                setStartError(null)
                try {
                  goToRoom((await createQuickRoom()).roomId)
                } catch (e) {
                  setStartError(errorText(e))
                  setStarting(false)
                }
              }}
            >
              {starting ? <span className="dv-spinner" /> : <Plus size={14} />}
              New room
            </button>
          </div>
        </div>

        {error && <Alert>{error}</Alert>}
        {startError && <Alert>{startError}</Alert>}

        {!error && (shown === null || shown.length > 0) && (
          <div className="dv-room-grid">
            {shown === null
              ? [0, 1, 2].map((i) => <RoomCardSkeleton key={i} />)
              : shown.map((r) => (
                  <RoomCard
                    key={r.roomId}
                    room={r}
                    actions={r.isOwner ? settingsActions(r) : undefined}
                    onSettings={() => {
                      setNotice(null)
                      setSettingsId(r.roomId)
                    }}
                  />
                ))}
          </div>
        )}

        {rooms && rooms.length > 0 && shown?.length === 0 && (
          <p className="dv-sub py-8 text-center">No rooms match “{query.trim()}”.</p>
        )}

        {rooms && rooms.length === 0 && (
          <div className="dv-empty">
            <span className="dv-choice-icon">
              <DoorOpen size={18} />
            </span>
            <span className="text-[15px] font-semibold">No rooms yet</span>
            <p className="dv-sub max-w-[360px]">
              Rooms you join or create will show up here. Open a link someone shared with you, or
              use <strong>New room</strong> to start your own.
            </p>
          </div>
        )}
      </main>

      {settingsRoom && (
        <Modal title="Room settings" onClose={() => setSettingsId(null)}>
          <p className="dv-sub -mt-2">
            <strong>{settingsRoom.roomName}</strong>. Only you can change these, because you created
            this room.
          </p>
          <RoomSettingsForm
            key={settingsRoom.roomId}
            roomName={settingsRoom.roomName}
            allowGuests={settingsRoom.allowGuests}
            actions={settingsActions(settingsRoom)}
          />
        </Modal>
      )}
      {profileSettingsOpen && <ProfileSettings onClose={() => setProfileSettingsOpen(false)} />}
    </div>
  )
}

/* ------------------------------------------------------------------ */
/* Password recovery                                                   */
/* ------------------------------------------------------------------ */

export const NewPasswordScreen: React.FC = () => {
  const { setNewPassword } = useAuth()
  const [password, setPassword] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  return (
    <AuthLayout>
      <div className="flex flex-col gap-2">
        <h2>Choose a new password</h2>
        <p className="dv-sub">You'll stay signed in on this device.</p>
      </div>
      <form
        className="flex flex-col gap-4"
        onSubmit={async (e) => {
          e.preventDefault()
          setBusy(true)
          setError(null)
          try {
            await setNewPassword(password)
            goHome()
          } catch (err) {
            setError(errorText(err))
          } finally {
            setBusy(false)
          }
        }}
      >
        <Field label="New password" hint={`At least ${MIN_PASSWORD} characters.`}>
          {(id) => (
            <PasswordInput
              id={id}
              value={password}
              onChange={setPassword}
              autoFocus
              autoComplete="new-password"
            />
          )}
        </Field>
        {error && <Alert>{error}</Alert>}
        <Submit busy={busy} disabled={password.length < MIN_PASSWORD}>
          Save password
        </Submit>
      </form>
    </AuthLayout>
  )
}
