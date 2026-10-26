import React, { useEffect, useId, useState } from 'react'
import {
  AlertCircle,
  ArrowLeft,
  Check,
  ChevronRight,
  Clock,
  Copy,
  DoorOpen,
  Eye,
  EyeOff,
  Info,
  KeyRound,
  LogOut,
  Mail,
  Moon,
  Plus,
  Search,
  Settings,
  Sun,
  UserRound,
  X,
} from 'lucide-react'
import { MIN_PASSWORD, USERNAME_RE, isElectron, useAuth } from './lib/auth'
import {
  RoomRpcError,
  type RoomSession,
  type RoomSummary,
  createRoom,
  clearFlash,
  joinRoom,
  myRooms,
  peekFlash,
  actAndNotify,
  changeRoomPassword,
  deleteRoom,
  renameRoom,
  roomPassword,
  setGuestAccess,
} from './lib/rooms'
import { type RoomSettingsActions, RoomSettingsForm } from './room-settings'
import { colorFor, goHome, goToRoom } from './lib/room'
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
/* Room form (guests and signed-in users)                              */
/* ------------------------------------------------------------------ */

/**
 * Join a room by name + password. If the name doesn't exist yet, offers to create it with the
 * password already typed, so nobody has to fill the form in twice.
 */
export const RoomForm: React.FC<{
  initialName?: string
  lockName?: boolean
  /** Join this exact room (invite links), since several rooms can share a name. */
  roomId?: string
  /** Runs before any RPC (guests use it to start an anonymous session). */
  prepare?: () => Promise<void>
  onEntered: (room: RoomSession) => void
  guest?: boolean
  /** Fix the form to joining or creating, with no switch between the two. */
  only?: 'join' | 'create'
}> = ({ initialName = '', lockName, roomId, prepare, onEntered, guest, only }) => {
  const [mode, setMode] = useState<'join' | 'create'>(only ?? 'join')
  const [name, setName] = useState(initialName)
  const [password, setPassword] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [offerCreate, setOfferCreate] = useState(false)
  const [wasDeleted, setWasDeleted] = useState(false)

  useEffect(() => setName(initialName), [initialName])

  const run = async (action: 'join' | 'create') => {
    setBusy(true)
    setError(null)
    setOfferCreate(false)
    try {
      await prepare?.()
      const room =
        action === 'join'
          ? await joinRoom(name, password, roomId)
          : await createRoom(name, password)
      onEntered(room)
    } catch (e) {
      const code = e instanceof RoomRpcError ? e.code : null
      if ((code === 'not_found' || code === 'deleted') && !lockName && only !== 'join') {
        setWasDeleted(code === 'deleted')
        setOfferCreate(true)
      } else setError(errorText(e))
    } finally {
      setBusy(false)
    }
  }

  const clean = name.trim()
  const canSubmit = clean.length >= 2 && password.length >= (mode === 'create' ? 4 : 1)

  return (
    <form
      className="flex flex-col gap-4"
      onSubmit={(e) => {
        e.preventDefault()
        if (canSubmit) run(mode)
      }}
    >
      <Field label="Room name">
        {(id) => (
          <input
            id={id}
            className="dv-input lg"
            value={name}
            readOnly={lockName}
            maxLength={48}
            autoFocus={!lockName}
            autoComplete="off"
            spellCheck={false}
            placeholder={mode === 'create' ? 'e.g. Design sprint' : 'The room you were invited to'}
            onChange={(e) => {
              setName(e.target.value)
              setOfferCreate(false)
            }}
          />
        )}
      </Field>
      <Field
        label={mode === 'create' ? 'Choose a room password' : 'Room password'}
        hint={
          mode === 'create'
            ? 'Share it with the people you want to invite. At least 4 characters.'
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
            autoFocus={lockName}
            maxLength={72}
            autoComplete={mode === 'create' ? 'new-password' : 'current-password'}
          />
        )}
      </Field>

      {guest && (mode === 'create' || offerCreate) && (
        <Alert tone="warn">
          As a guest, you won't be able to rename this room, change its password, delete it or clear
          its canvas later. Sign in first if you want to manage it.
        </Alert>
      )}
      {error && <Alert>{error}</Alert>}
      {offerCreate && (
        <Alert tone="info">
          <div className="flex flex-col gap-2">
            {wasDeleted ? (
              <span>
                <strong>{clean}</strong> was deleted by its owner. Create a new room with this name?
              </span>
            ) : (
              <span>
                There's no room called <strong>{clean}</strong> yet. Create it with this password?
              </span>
            )}
            <button
              type="button"
              className="dv-btn primary self-start"
              disabled={busy || password.length < 4}
              onClick={() => run('create')}
            >
              <Plus size={14} />
              Create “{clean}”
            </button>
            {password.length < 4 && (
              <span className="dv-hint">Room passwords need at least 4 characters.</span>
            )}
          </div>
        </Alert>
      )}

      <Submit busy={busy} disabled={!canSubmit}>
        {mode === 'create' ? 'Create room' : 'Enter room'}
      </Submit>

      {!lockName && !only && (
        <p className="dv-sub text-center">
          {mode === 'join' ? 'Starting something new? ' : 'Have a room already? '}
          <button
            type="button"
            className="dv-link"
            onClick={() => {
              setMode((m) => (m === 'join' ? 'create' : 'join'))
              setError(null)
              setOfferCreate(false)
            }}
          >
            {mode === 'join' ? 'Create a room' : 'Join a room'}
          </button>
        </p>
      )}
      {guest && (
        <p
          className="dv-hint text-center"
          style={{ color: 'var(--dv-muted)', fontSize: 'var(--dv-text-xs)' }}
        >
          You'll appear to others as an anonymous animal, like “Anonymous Otter”.
        </p>
      )}
    </form>
  )
}

/* ------------------------------------------------------------------ */
/* Sign in / sign up                                                   */
/* ------------------------------------------------------------------ */

const AccountForm: React.FC<{ initialTab?: 'signin' | 'signup'; onForgot: () => void }> = ({
  initialTab = 'signin',
  onForgot,
}) => {
  const { signInWithPassword, signUp, signInWithGoogle } = useAuth()
  const [tab, setTab] = useState(initialTab)
  const [login, setLogin] = useState('')
  const [password, setPassword] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const signup = tab === 'signup'
  const username = login.trim().toLowerCase()
  const usernameBad = signup && login.length > 0 && !USERNAME_RE.test(username)
  const passwordShort = signup && password.length > 0 && password.length < MIN_PASSWORD
  const canSubmit = signup
    ? USERNAME_RE.test(username) && password.length >= MIN_PASSWORD
    : !!login.trim() && !!password

  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!canSubmit) return
    setBusy(true)
    setError(null)
    try {
      if (signup) await signUp(username, password)
      else await signInWithPassword(login, password)
    } catch (err) {
      setError(errorText(err))
      setBusy(false)
    }
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
          label={signup ? 'Username' : 'Username or email'}
          hint={
            signup
              ? usernameBad
                ? '3–24 characters: lowercase letters, numbers and underscores.'
                : 'This is the name people see in your rooms.'
              : undefined
          }
        >
          {(id) => (
            <input
              id={id}
              className="dv-input lg"
              value={login}
              autoFocus
              autoCapitalize="none"
              autoCorrect="off"
              spellCheck={false}
              maxLength={signup ? 24 : 254}
              autoComplete="username"
              aria-invalid={usernameBad}
              onChange={(e) => {
                setLogin(signup ? e.target.value.toLowerCase() : e.target.value)
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
        {signup && (
          <p className="dv-sub text-center" style={{ fontSize: 'var(--dv-text-xs)' }}>
            No email needed. You can add one later so you can recover your account.
          </p>
        )}
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

type Step = 'choose' | 'account' | 'guest' | 'forgot'

/** First screen for anyone without an account session. `inviteName` is set when they opened a room link. */
export const Onboarding: React.FC<{ inviteName?: string | null; inviteDeleted?: boolean }> = ({
  inviteName,
  inviteDeleted,
}) => {
  const { signInAsGuest } = useAuth()
  const [step, setStep] = useState<Step>('choose')
  const [error, setError] = useState<string | null>(null)

  const chooseGuest = async () => {
    if (!inviteName) return setStep('guest')
    // Invite link: start the guest session now; the room gate then asks for this room's password.
    setError(null)
    try {
      await signInAsGuest()
    } catch (e) {
      setError(errorText(e))
    }
  }

  return (
    <AuthLayout>
      {step === 'choose' && (
        <>
          {inviteDeleted && (
            <Alert tone="info">
              The room in this link was deleted by its owner, so its board and canvas are gone.
            </Alert>
          )}
          <div className="flex flex-col gap-2">
            <h1>{inviteName ? `Join “${inviteName}”` : 'Welcome to devboard'}</h1>
            <p className="dv-sub">
              {inviteName
                ? "You've been invited to a shared board and canvas. How would you like to come in?"
                : 'A shared task board and canvas for your team. How would you like to start?'}
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
            <button className="dv-choice" onClick={chooseGuest}>
              <span className="dv-choice-icon">
                <DoorOpen size={18} />
              </span>
              <span className="min-w-0 flex-1">
                <span className="dv-choice-title block">Work in a room as a guest</span>
                <span className="dv-choice-desc block">
                  Just the room name and password. No account needed.
                </span>
              </span>
              <ChevronRight size={16} style={{ color: 'var(--dv-muted)' }} />
            </button>
          </div>
          {error && <Alert>{error}</Alert>}
        </>
      )}

      {step === 'account' && (
        <>
          <BackButton onClick={() => setStep('choose')} />
          <AccountForm onForgot={() => setStep('forgot')} />
        </>
      )}

      {step === 'forgot' && <ForgotForm onBack={() => setStep('account')} />}

      {step === 'guest' && (
        <>
          <BackButton onClick={() => setStep('choose')} />
          <div className="flex flex-col gap-2">
            <h2>Enter a room</h2>
            <p className="dv-sub">Ask whoever invited you for the room's name and password.</p>
          </div>
          <RoomForm guest prepare={signInAsGuest} onEntered={(room) => goToRoom(room.roomId)} />
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
  onJoined: () => void
}> = ({ roomId, roomName, deleted, onJoined }) => {
  const { isGuest, signOut } = useAuth()
  return (
    <AuthLayout>
      <BackButton
        onClick={() => (isGuest ? signOut().then(goHome) : goHome())}
        label={isGuest ? 'Back' : 'Your rooms'}
      />
      <div className="flex flex-col gap-2">
        <h2>
          {roomName ? `Enter “${roomName}”` : deleted ? 'This room was deleted' : 'Room not found'}
        </h2>
        <p className="dv-sub">
          {roomName
            ? "Enter the room's password to join. You'll only need it once."
            : deleted
              ? 'Its owner deleted it, so its board and canvas are gone.'
              : "This link doesn't point to a room. Check that you copied all of it."}
        </p>
      </div>
      {roomName && (
        <RoomForm
          initialName={roomName}
          roomId={roomId}
          lockName
          guest={isGuest}
          onEntered={onJoined}
        />
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
  const { addEmail } = useAuth()
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
              await addEmail(email)
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

/** Password on a room card: hidden until asked for, fetched only then, copyable. */
const CardPassword: React.FC<{ roomId: string; isOwner: boolean }> = ({ roomId, isOwner }) => {
  const [value, setValue] = useState<string | null | undefined>(undefined) // undefined = not fetched
  const [shown, setShown] = useState(false)
  const [copied, setCopied] = useState(false)
  const [busy, setBusy] = useState(false)

  const load = async () => {
    if (value !== undefined) return value
    setBusy(true)
    try {
      const pw = await roomPassword(roomId)
      setValue(pw)
      return pw
    } catch {
      setValue(null)
      return null
    } finally {
      setBusy(false)
    }
  }

  if (value === null) {
    return (
      <p className="dv-room-pw-missing">
        {isOwner
          ? 'Password not saved. Set a new one in room settings to show it here.'
          : 'Password not saved. Ask the owner for it.'}
      </p>
    )
  }

  return (
    <div className="dv-room-pw">
      <KeyRound size={13} aria-hidden />
      <span
        className="dv-room-pw-value"
        aria-label={shown ? 'Room password' : 'Room password hidden'}
      >
        {/* Fixed-width mask so the hidden state doesn't reveal the length. */}
        {shown && value ? value : '••••••••'}
      </span>
      <button
        type="button"
        className="dv-iconbtn sm"
        aria-label={shown ? 'Hide password' : 'Show password'}
        aria-pressed={shown}
        disabled={busy}
        onClick={async () => {
          if (!shown) await load()
          setShown((v) => !v)
        }}
      >
        {busy ? (
          <span className="dv-spinner sm" />
        ) : shown ? (
          <EyeOff size={14} />
        ) : (
          <Eye size={14} />
        )}
      </button>
      <button
        type="button"
        className="dv-iconbtn sm"
        aria-label="Copy password"
        disabled={busy}
        onClick={async () => {
          const pw = await load()
          if (!pw) return
          try {
            await navigator.clipboard.writeText(pw)
            setCopied(true)
            setTimeout(() => setCopied(false), 1400)
          } catch {
            setShown(true)
          }
        }}
      >
        {copied ? <Check size={14} /> : <Copy size={14} />}
      </button>
    </div>
  )
}

const RoomCard: React.FC<{
  room: RoomSummary
  /** Bumped after a password change so the card forgets the old one. */
  passwordRev: number
  onSettings: () => void
}> = ({ room, passwordRev, onSettings }) => (
  <article className="dv-room-card">
    {/* Stretched button: the whole card opens the room; the password buttons sit above it. */}
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
            title="Rename, change password or delete"
            onClick={onSettings}
          >
            <Settings size={15} />
          </button>
        </>
      )}
    </div>
    <div className="dv-room-body">
      <h3 className="dv-room-name" title={room.roomName}>
        {room.roomName}
      </h3>
      <p className="dv-room-meta">
        <Clock size={12} aria-hidden />
        Edited{' '}
        <time dateTime={room.lastEditedAt} title={fullDate(room.lastEditedAt)}>
          {relative(room.lastEditedAt)}
        </time>
        {!room.allowGuests && <span title="Guests can't join this room"> · Accounts only</span>}
      </p>
      <CardPassword key={passwordRev} roomId={room.roomId} isOwner={room.isOwner} />
    </div>
  </article>
)

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

export const RoomsHome: React.FC = () => {
  const { user, profile, needsEmail, signOut } = useAuth()
  const [rooms, setRooms] = useState<RoomSummary[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [panel, setPanel] = useState<'join' | 'create' | null>(null)
  const [query, setQuery] = useState('')
  const [settingsId, setSettingsId] = useState<string | null>(null)
  const [passwordRevs, setPasswordRevs] = useState<Record<string, number>>({})
  const [notice, setNotice] = useState<string | null>(null)
  const settingsRoom = rooms?.find((r) => r.roomId === settingsId) ?? null

  // From here we're not in the room, so each action briefly joins its channel to tell members.
  const settingsActions = (room: RoomSummary): RoomSettingsActions => ({
    rename: async (newName) => {
      const saved = await actAndNotify(
        room.roomId,
        () => renameRoom(room.roomId, newName),
        'room:renamed',
        (n) => ({ name: n }),
      )
      setRooms(
        (rs) =>
          rs?.map((r) =>
            r.roomId === room.roomId
              ? { ...r, roomName: saved, lastEditedAt: new Date().toISOString() }
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
    changePassword: async (password) => {
      await changeRoomPassword(room.roomId, password)
      setPasswordRevs((revs) => ({ ...revs, [room.roomId]: (revs[room.roomId] ?? 0) + 1 }))
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
            {name.slice(0, 2).toUpperCase()}
          </div>
          <span className="max-sm:hidden">{name}</span>
        </div>
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
            <button className="dv-btn" onClick={() => setPanel('create')}>
              <Plus size={14} />
              New room
            </button>
            <button className="dv-btn primary" onClick={() => setPanel('join')}>
              <DoorOpen size={14} />
              Join room
            </button>
          </div>
        </div>

        {error && <Alert>{error}</Alert>}

        {!error && (shown === null || shown.length > 0) && (
          <div className="dv-room-grid">
            {shown === null
              ? [0, 1, 2].map((i) => <RoomCardSkeleton key={i} />)
              : shown.map((r) => (
                  <RoomCard
                    key={r.roomId}
                    room={r}
                    passwordRev={passwordRevs[r.roomId] ?? 0}
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
              Rooms you join or create will show up here. Use <strong>Join room</strong> for one
              someone shared with you, or <strong>New room</strong> to start your own.
            </p>
          </div>
        )}
      </main>

      {panel && (
        <Modal
          title={panel === 'join' ? 'Join a room' : 'Create a room'}
          onClose={() => setPanel(null)}
        >
          <RoomForm key={panel} only={panel} onEntered={(room) => goToRoom(room.roomId)} />
        </Modal>
      )}

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
