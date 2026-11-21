import React, { useEffect, useState } from 'react'
import {
  ChevronLeft,
  ChevronRight,
  Download,
  File,
  FileAudio,
  FileCode,
  FileImage,
  FileSpreadsheet,
  FileText,
  FileVideo,
  X,
  type LucideIcon,
} from 'lucide-react'
import {
  type Attachment,
  type FileKind,
  downloadHref,
  fileBadge,
  fileKind,
  formatBytes,
} from './lib/files'

const KIND_ICONS: Record<FileKind, LucideIcon> = {
  image: FileImage,
  video: FileVideo,
  audio: FileAudio,
  pdf: FileText,
  text: FileCode,
  table: FileSpreadsheet,
  other: File,
}

export const FileIcon: React.FC<{ file: Attachment; size?: number }> = ({ file, size = 16 }) => {
  const Icon = KIND_ICONS[fileKind(file.type, file.name)]
  return <Icon size={size} />
}

/** A file as a small chip: icon, name, size. */
export const FileChip: React.FC<
  { file: Attachment } & React.ButtonHTMLAttributes<HTMLButtonElement>
> = ({ file, className = '', ...rest }) => (
  <button
    className={`flex min-w-0 items-center gap-1.5 rounded-md border px-2 py-1 text-left text-xs ${className}`}
    style={{ borderColor: 'var(--dv-border)', background: 'var(--dv-panel-2)' }}
    title={`Open ${file.name}`}
    {...rest}
  >
    <span className="shrink-0" style={{ color: 'var(--dv-muted)' }}>
      <FileIcon file={file} size={14} />
    </span>
    <span className="truncate">{file.name}</span>
    {file.size > 0 && (
      <span className="shrink-0" style={{ color: 'var(--dv-muted)' }}>
        {formatBytes(file.size)}
      </span>
    )}
  </button>
)

/** Text previews read at most this much, so a huge log doesn't download in full just to look at it. */
const TEXT_PREVIEW_BYTES = 2 * 1024 * 1024
const TABLE_PREVIEW_ROWS = 500

async function fetchText(url: string): Promise<{ text: string; cut: boolean; binary: boolean }> {
  const ranged = !url.startsWith('data:') && !url.startsWith('blob:')
  const res = await fetch(url, ranged ? { headers: { Range: `bytes=0-${TEXT_PREVIEW_BYTES - 1}` } } : {})
  if (!res.ok) throw new Error(`HTTP ${res.status}`)
  const buf = new Uint8Array(await res.arrayBuffer())
  const total = Number(res.headers.get('content-range')?.split('/')[1]) || buf.length
  const bytes = buf.subarray(0, TEXT_PREVIEW_BYTES)
  const binary = bytes.subarray(0, 8000).includes(0)
  return {
    text: new TextDecoder().decode(bytes),
    cut: total > bytes.length,
    binary,
  }
}

/** Splits CSV/TSV text into rows, honouring quoted fields. */
function parseDelimited(text: string, delim: string, maxRows: number): string[][] {
  const rows: string[][] = []
  let row: string[] = []
  let cell = ''
  let quoted = false
  for (let i = 0; i < text.length && rows.length < maxRows; i++) {
    const ch = text[i]
    if (quoted) {
      if (ch === '"' && text[i + 1] === '"') {
        cell += '"'
        i++
      } else if (ch === '"') quoted = false
      else cell += ch
    } else if (ch === '"' && cell === '') quoted = true
    else if (ch === delim) {
      row.push(cell)
      cell = ''
    } else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && text[i + 1] === '\n') i++
      row.push(cell)
      rows.push(row)
      row = []
      cell = ''
    } else cell += ch
  }
  if ((cell || row.length) && rows.length < maxRows) rows.push([...row, cell])
  return rows
}

const NoPreview: React.FC<{ file: Attachment; reason: string }> = ({ file, reason }) => (
  <div
    className="dv-floating flex w-[min(360px,88vw)] flex-col items-center gap-3 p-8 text-center"
    onClick={(e) => e.stopPropagation()}
  >
    <span style={{ color: 'var(--dv-muted)' }}>
      <FileIcon file={file} size={40} />
    </span>
    <div className="text-sm font-medium">{file.name}</div>
    <p className="text-xs" style={{ color: 'var(--dv-muted)' }}>
      {reason}
    </p>
    <a className="dv-btn primary" href={downloadHref(file)} download={file.name}>
      <Download size={14} />
      Download
    </a>
  </div>
)

const TextPreview: React.FC<{ file: Attachment; table: boolean }> = ({ file, table }) => {
  const [state, setState] = useState<
    { status: 'loading' } | { status: 'error' } | { status: 'ok'; text: string; cut: boolean; binary: boolean }
  >({ status: 'loading' })

  useEffect(() => {
    let live = true
    fetchText(file.url)
      .then((r) => live && setState({ status: 'ok', ...r }))
      .catch(() => live && setState({ status: 'error' }))
    return () => {
      live = false
    }
  }, [file.url])

  if (state.status === 'loading')
    return (
      <div className="text-sm text-white/80" onClick={(e) => e.stopPropagation()}>
        Loading…
      </div>
    )
  if (state.status === 'error') return <NoPreview file={file} reason="This file couldn't be loaded." />
  if (state.binary)
    return <NoPreview file={file} reason="This file isn't text, so there's nothing to show here." />

  let body: React.ReactNode
  if (table) {
    const delim = /\.tsv$/i.test(file.name) || file.type.includes('tab-separated') ? '\t' : ','
    const rows = parseDelimited(state.text, delim, TABLE_PREVIEW_ROWS + 1)
    const [head = [], ...rest] = rows
    body = (
      <table className="w-full border-collapse text-xs">
        <thead>
          <tr>
            {head.map((h, i) => (
              <th
                key={i}
                className="sticky top-0 border px-2 py-1 text-left font-semibold"
                style={{ borderColor: 'var(--dv-border)', background: 'var(--dv-panel-2)' }}
              >
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rest.slice(0, TABLE_PREVIEW_ROWS).map((r, i) => (
            <tr key={i}>
              {r.map((c, j) => (
                <td
                  key={j}
                  className="whitespace-pre border px-2 py-1 align-top"
                  style={{ borderColor: 'var(--dv-border)' }}
                >
                  {c}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    )
  } else {
    let text = state.text
    if (!state.cut && /\.json$/i.test(file.name)) {
      try {
        text = JSON.stringify(JSON.parse(text), null, 2)
      } catch {
        /* show it as written */
      }
    }
    body = (
      <pre
        className="whitespace-pre-wrap break-words p-4 text-xs leading-relaxed"
        style={{ fontFamily: 'var(--dv-mono)' }}
      >
        {text}
      </pre>
    )
  }

  return (
    <div
      className="dv-floating dv-scroll flex max-h-[80vh] w-[min(960px,92vw)] flex-col overflow-auto !p-0"
      onClick={(e) => e.stopPropagation()}
    >
      {body}
      {state.cut && (
        <p className="px-4 py-2 text-xs" style={{ color: 'var(--dv-muted)' }}>
          Showing the start of this file. Download it to see the rest.
        </p>
      )}
    </div>
  )
}

/**
 * Shows one file the way it's meant to be seen: picture, player, PDF, text or table.
 * Keyed by URL where it's used, so switching files starts from a clean state.
 */
const Preview: React.FC<{ file: Attachment }> = ({ file }) => {
  const [failed, setFailed] = useState(false)
  const kind = fileKind(file.type, file.name)
  const stop = (e: React.MouseEvent) => e.stopPropagation()
  const unsupported = "Your browser can't show this format. Download it to open it in another app."

  if (failed) return <NoPreview file={file} reason={unsupported} />
  switch (kind) {
    case 'image':
      return (
        <img
          src={file.url}
          alt={file.name}
          className="max-h-[80vh] max-w-[90vw] rounded-lg shadow-2xl"
          onClick={stop}
          onError={() => setFailed(true)}
        />
      )
    case 'video':
      return (
        <video
          key={file.url}
          src={file.url}
          controls
          autoPlay
          playsInline
          className="max-h-[80vh] max-w-[90vw] rounded-lg bg-black shadow-2xl"
          onClick={stop}
          onError={() => setFailed(true)}
        />
      )
    case 'audio':
      return (
        <div
          className="dv-floating flex w-[min(440px,88vw)] flex-col items-center gap-4 p-6"
          onClick={stop}
        >
          <span style={{ color: 'var(--dv-muted)' }}>
            <FileAudio size={40} />
          </span>
          <div className="max-w-full truncate text-sm font-medium">{file.name}</div>
          <audio
            key={file.url}
            src={file.url}
            controls
            autoPlay
            className="w-full"
            onError={() => setFailed(true)}
          />
        </div>
      )
    case 'pdf':
      return (
        <iframe
          key={file.url}
          src={file.url}
          title={file.name}
          className="h-[80vh] w-[min(960px,92vw)] rounded-lg bg-white shadow-2xl"
          onClick={stop}
        />
      )
    case 'text':
    case 'table':
      return <TextPreview file={file} table={kind === 'table'} />
    default:
      return <NoPreview file={file} reason="There's no preview for this kind of file." />
  }
}

/**
 * Full-screen viewer for a list of files. Arrow keys move between them, Esc closes.
 * Every file can be downloaded under its original name.
 */
export const FileViewer: React.FC<{
  files: Attachment[]
  index: number
  onIndex: (i: number) => void
  onClose: () => void
}> = ({ files, index, onIndex, onClose }) => {
  const file = files[index]
  const many = files.length > 1

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      // Leave arrow keys to a focused video/audio scrubber.
      const inMedia = e.target instanceof HTMLMediaElement
      if (e.key === 'Escape') onClose()
      else if (many && !inMedia && e.key === 'ArrowRight') onIndex((index + 1) % files.length)
      else if (many && !inMedia && e.key === 'ArrowLeft')
        onIndex((index - 1 + files.length) % files.length)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [index, files.length, many, onClose, onIndex])

  if (!file) return null
  const navBtn =
    'absolute top-1/2 flex h-10 w-10 -translate-y-1/2 items-center justify-center rounded-full bg-black/60 text-white'

  return (
    <div
      className="fixed inset-0 z-[90] flex flex-col items-center justify-center gap-3 bg-black/80 p-4"
      onClick={onClose}
    >
      <div
        className="absolute left-4 right-4 top-4 flex items-center gap-2 text-white"
        onClick={(e) => e.stopPropagation()}
      >
        <span className="rounded bg-white/15 px-1.5 py-0.5 text-[10px] font-semibold tracking-wide">
          {fileBadge(file)}
        </span>
        <span className="min-w-0 truncate text-sm font-medium">{file.name}</span>
        {file.size > 0 && <span className="shrink-0 text-xs text-white/60">{formatBytes(file.size)}</span>}
        <span className="flex-1" />
        <a
          className="flex h-9 items-center gap-1.5 rounded-full bg-black/60 px-3 text-xs font-medium"
          href={downloadHref(file)}
          download={file.name}
          title="Download"
        >
          <Download size={15} />
          Download
        </a>
        <button
          className="flex h-9 w-9 items-center justify-center rounded-full bg-black/60"
          onClick={onClose}
          title="Close (Esc)"
        >
          <X size={18} />
        </button>
      </div>

      <Preview key={file.url} file={file} />

      {many && (
        <>
          <button
            className={`${navBtn} left-4`}
            title="Previous (←)"
            onClick={(e) => {
              e.stopPropagation()
              onIndex((index - 1 + files.length) % files.length)
            }}
          >
            <ChevronLeft size={20} />
          </button>
          <button
            className={`${navBtn} right-4`}
            title="Next (→)"
            onClick={(e) => {
              e.stopPropagation()
              onIndex((index + 1) % files.length)
            }}
          >
            <ChevronRight size={20} />
          </button>
          <span className="rounded-md bg-black/60 px-2 py-1 text-xs text-white">
            {index + 1} / {files.length}
          </span>
        </>
      )}
    </div>
  )
}
