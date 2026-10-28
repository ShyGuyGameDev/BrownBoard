import { supabase } from './supabase'
import { cleanLine, isSafeImageSrc } from './sanitize'

/** A file someone added to a task or the canvas. `type` is the MIME type the browser reported. */
export interface Attachment {
  url: string
  name: string
  type: string
  size: number
}

/** How a file can be shown: picture, player, PDF frame, text, table, or download only. */
export type FileKind = 'image' | 'video' | 'audio' | 'pdf' | 'text' | 'table' | 'other'

/** Matches the board-assets bucket limit set in 20261028_room_files.sql. */
export const MAX_FILE_BYTES = 50 * 1024 * 1024

const IMAGE_EXT = /^(png|jpe?g|gif|webp|avif|bmp|svg|ico|heic|heif|tiff?)$/
const VIDEO_EXT = /^(mp4|m4v|mov|webm|mkv|ogv|avi|wmv|mpe?g|3gp)$/
const AUDIO_EXT = /^(mp3|wav|ogg|oga|opus|m4a|aac|flac|weba|aiff?|mid|midi)$/
const TABLE_EXT = /^(csv|tsv)$/
// Checked before the MIME type: some systems call .ts files "video/mp2t", and many code files arrive with no type.
const TEXT_EXT =
  /^(txt|text|md|markdown|mdx|rst|log|json|jsonc|json5|ndjson|geojson|yaml|yml|toml|ini|cfg|conf|env|properties|xml|html?|xhtml|css|scss|sass|less|js|jsx|mjs|cjs|ts|tsx|mts|cts|py|rb|go|rs|java|kt|kts|scala|c|h|cc|cpp|hpp|cs|php|sh|bash|zsh|fish|ps1|bat|sql|swift|r|lua|pl|dart|vue|svelte|tex|bib|srt|vtt|diff|patch|gradle|dockerfile|makefile|gitignore|graphql|gql|proto|sol)$/

export const extensionOf = (name: string) =>
  name.includes('.') ? (name.split('.').pop() ?? '').toLowerCase() : name.toLowerCase()

export function fileKind(type: string, name: string): FileKind {
  const ext = extensionOf(name)
  const t = type.toLowerCase()
  if (TABLE_EXT.test(ext) || t === 'text/csv' || t === 'text/tab-separated-values') return 'table'
  if (TEXT_EXT.test(ext)) return 'text'
  if (t.startsWith('image/') || IMAGE_EXT.test(ext)) return 'image'
  if (t.startsWith('video/') || VIDEO_EXT.test(ext)) return 'video'
  if (t.startsWith('audio/') || AUDIO_EXT.test(ext)) return 'audio'
  if (t === 'application/pdf' || ext === 'pdf') return 'pdf'
  if (t.startsWith('text/') || /(json|xml|javascript|yaml|toml|x-sh|sql)/.test(t)) return 'text'
  return 'other'
}

/** Short label for a file: its extension, or its kind when it has none. */
export const fileBadge = (a: Pick<Attachment, 'name' | 'type'>) => {
  const ext = a.name.includes('.') ? extensionOf(a.name) : ''
  return (ext && ext.length <= 5 ? ext : fileKind(a.type, a.name)).toUpperCase()
}

export const formatBytes = (n: number) => {
  if (!Number.isFinite(n) || n <= 0) return ''
  if (n < 1024) return `${n} B`
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(n < 10 * 1024 ? 1 : 0)} KB`
  if (n < 1024 * 1024 * 1024) return `${(n / 1024 / 1024).toFixed(1)} MB`
  return `${(n / 1024 / 1024 / 1024).toFixed(1)} GB`
}

/**
 * Validates an attachment from the database or another person. Like canvas images, only our own
 * storage (or an embedded/local image) is allowed, so a crafted row can't point viewers anywhere else.
 */
export function cleanAttachment(raw: unknown): Attachment | null {
  if (typeof raw === 'string') {
    // Old tasks.images entry: a bare image URL.
    if (!isSafeImageSrc(raw)) return null
    const name = raw.startsWith('data:') ? 'image' : decodeURIComponent(raw.split('/').pop() ?? 'image')
    return { url: raw, name: cleanLine(name, 200) || 'image', type: 'image/*', size: 0 }
  }
  if (!raw || typeof raw !== 'object') return null
  const r = raw as Record<string, unknown>
  if (!isSafeImageSrc(r.url)) return null
  return {
    url: r.url,
    name: cleanLine(typeof r.name === 'string' ? r.name : '', 200) || 'file',
    type: typeof r.type === 'string' && /^[\w.+-]+\/[\w.+*-]+$/.test(r.type) ? r.type : '',
    size: typeof r.size === 'number' && r.size >= 0 ? r.size : 0,
  }
}

/** A task's files: attachments, plus images from the older `images` column not yet moved over. */
export function taskFiles(row: { images?: unknown; attachments?: unknown }): Attachment[] {
  const list = (v: unknown) =>
    (Array.isArray(v) ? v : []).map(cleanAttachment).filter((a): a is Attachment => !!a)
  const files = list(row.attachments)
  const seen = new Set(files.map((f) => f.url))
  return [...list(row.images).filter((f) => !seen.has(f.url)), ...files]
}

export const isImageFile = (f: Attachment) => fileKind(f.type, f.name) === 'image'

// Served from our storage domain, these would render as live pages; store them as plain text instead.
const ACTIVE_TYPE = /^(text\/html|application\/xhtml\+xml|text\/xml|application\/xml)/i
const ACTIVE_EXT = /^(html?|xhtml|shtml|xml|xht|mht|mhtml)$/

/**
 * Uploads a file to board-assets/<roomId>[/<folder>]/ and returns it as an attachment.
 * Throws a readable error on failure.
 */
export async function uploadRoomFile(file: File, roomId: string, folder?: string): Promise<Attachment> {
  if (file.size > MAX_FILE_BYTES)
    throw new Error(`"${file.name}" is ${formatBytes(file.size)}. Files must be under 50 MB.`)
  const ext = file.name.includes('.')
    ? extensionOf(file.name).replace(/[^a-z0-9]/g, '').slice(0, 10)
    : ''
  const path = `${roomId}/${folder ? `${folder}/` : ''}${crypto.randomUUID()}${ext ? `.${ext}` : ''}`
  const type = file.type || 'application/octet-stream'
  const contentType = ACTIVE_TYPE.test(type) || ACTIVE_EXT.test(ext) ? 'text/plain' : type
  const { error } = await supabase.storage
    .from('board-assets')
    .upload(path, file, { contentType, cacheControl: '31536000' })
  if (error) throw new Error(`Couldn't upload "${file.name}": ${error.message}`)
  return {
    url: supabase.storage.from('board-assets').getPublicUrl(path).data.publicUrl,
    name: cleanLine(file.name, 200) || 'file',
    type: file.type,
    size: file.size,
  }
}

/** A link that saves the file under its original name instead of opening it. */
export function downloadHref(a: Attachment) {
  if (a.url.startsWith('data:') || a.url.startsWith('blob:')) return a.url
  const u = new URL(a.url)
  u.searchParams.set('download', a.name)
  return u.toString()
}
