/**
 * Cleans text people type before it's saved or shared with the room.
 *
 * React already escapes everything it renders, so this isn't about HTML injection. It removes
 * characters that are invisible or that change how text *looks* versus what it *is*:
 *   - control characters (anything a keyboard can't type, except tabs/newlines in multi-line text)
 *   - bidirectional overrides/isolates (U+202A–202E, U+2066–2069), used to make text read
 *     differently on screen than it's stored ("Trojan Source"-style spoofing)
 *   - zero-width space, word joiner and BOM, used to make look-alike names
 * Zero-width joiner/non-joiner (U+200D, U+200C) are kept: emoji sequences and several scripts
 * need them. Text is also Unicode-normalised (NFC) so visually identical strings compare equal.
 *
 * The database applies the same rules in triggers (see the sanitization SQL migration), so a
 * client that skips this still can't store these characters.
 */

/* eslint-disable no-control-regex -- matching control characters is the point */
const CONTROL_SINGLE = /[\u0000-\u001F\u007F-\u009F]/g
const CONTROL_MULTI = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F-\u009F]/g
/* eslint-enable no-control-regex */
const INVISIBLE = /[\u200B\u202A-\u202E\u2060-\u2064\u2066-\u2069\uFEFF]/g

/** Cut to `max` characters without splitting an emoji or accented letter in half. */
export const clamp = (value: string, max: number) => {
  const chars = [...value]
  return chars.length > max ? chars.slice(0, max).join('') : value
}

/** One-line fields (names, titles, labels): whitespace collapsed to single spaces, trimmed. */
export const cleanLine = (value: string, max: number) =>
  clamp(
    value
      .normalize('NFC')
      .replace(INVISIBLE, '')
      .replace(CONTROL_SINGLE, ' ')
      .replace(/\s+/g, ' ')
      .trim(),
    max,
  )

/** Multi-line fields (descriptions, canvas text): keeps line breaks, at most one blank line in a row. */
export const cleanMultiline = (value: string, max: number) =>
  clamp(
    value
      .normalize('NFC')
      .replace(/\r\n?/g, '\n')
      .replace(INVISIBLE, '')
      .replace(CONTROL_MULTI, '')
      .replace(/[ \t]+$/gm, '')
      .replace(/\n{3,}/g, '\n\n')
      .trim(),
    max,
  )

/** Length limits shared with the database constraints. */
export const LIMITS = {
  roomName: 48,
  categoryName: 80,
  taskTitle: 200,
  taskDescription: 5000,
  optionLabel: 40,
  canvasText: 4000,
} as const

/** `#rrggbb` (lower-cased), or `fallback` for anything else. */
export const cleanHexColor = (value: string | null | undefined, fallback: string) =>
  typeof value === 'string' && /^#[0-9a-f]{6}$/i.test(value) ? value.toLowerCase() : fallback

/** Canvas ink: 'auto' (follows the theme) or a hex colour. */
export const cleanInk = (value: unknown) =>
  value === 'auto' || (typeof value === 'string' && /^#[0-9a-f]{3,8}$/i.test(value))
    ? (value as string)
    : 'auto'

const SUPABASE_ORIGIN = (() => {
  try {
    return new URL(import.meta.env.VITE_SUPABASE_URL).origin
  } catch {
    return null
  }
})()

/**
 * Images we'll load: our own Supabase Storage, an embedded image (data:image/…), or a local
 * preview (blob:). Anything else is dropped, so a crafted canvas item can't make every viewer's
 * browser fetch an arbitrary URL (tracking pixels, odd schemes).
 */
export const isSafeImageSrc = (src: unknown): src is string => {
  if (typeof src !== 'string') return false
  if (/^data:image\/(png|jpe?g|gif|webp|avif|bmp);base64,/i.test(src)) return true
  if (src.startsWith('blob:')) return true
  try {
    const url = new URL(src)
    return url.origin === SUPABASE_ORIGIN && url.pathname.startsWith('/storage/v1/object/')
  } catch {
    return false
  }
}

/** File extension safe to use in a storage path. */
export const safeExtension = (fileName: string, fallback = 'png') =>
  (fileName.split('.').pop() || fallback)
    .toLowerCase()
    .replace(/[^a-z0-9]/g, '')
    .slice(0, 8) || fallback
