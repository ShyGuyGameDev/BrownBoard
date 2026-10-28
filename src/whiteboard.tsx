import React, { useCallback, useEffect, useRef, useState } from 'react'
import {
  ArrowUpRight,
  Circle,
  Crosshair,
  Download,
  Eye,
  Heart,
  ImageIcon,
  Kanban,
  ListTodo,
  Maximize,
  Minus,
  MousePointer2,
  Pen,
  Plus,
  Redo2,
  Settings,
  Square,
  Star,
  StickyNote,
  Trash2,
  Type,
  Undo2,
  X,
  type LucideIcon,
} from 'lucide-react'
import { HexColorPicker } from 'react-colorful'
import { supabase } from './lib/supabase'
import { useRoom } from './lib/room'
import { bus, isTyping, setLinkCounts, toast } from './lib/bus'
import { formatDueDate, type TaskLite, useRoomTasks } from './lib/tasks'
import { clearCanvas as clearRoomCanvas } from './lib/rooms'
import { canvas, font, noteColors, noteInk, swatches } from './design/tokens'
import { LIMITS, cleanInk, cleanLine, cleanMultiline, isSafeImageSrc, safeExtension } from './lib/sanitize'
import {
  type Attachment,
  type FileKind,
  MAX_FILE_BYTES,
  fileBadge,
  fileKind,
  downloadHref,
  formatBytes,
  isImageFile,
  uploadRoomFile,
} from './lib/files'
import { FileChip, FileViewer } from './file-viewer'

/* ================================================================== */
/* Types                                                               */
/* ================================================================== */

type Pt = { x: number; y: number }
type BBox = { minX: number; minY: number; maxX: number; maxY: number }
type ShapeKind = 'rectangle' | 'circle' | 'star' | 'heart'
type Tool = 'select' | 'pen' | 'shape' | 'text' | 'note' | 'connect'

interface El {
  id: string
  type: 'stroke' | 'shape' | 'image' | 'file' | 'text' | 'task' | 'connector'
  userId?: string
  /** stroke: polyline. shape / image / file / text / task: [topLeft, bottomRight]. connector: unused (derived from from/to). */
  points: Pt[]
  lineWidth?: number
  /** a hex colour, or 'auto' = the theme's ink colour */
  color?: string
  shapeKind?: ShapeKind
  fill?: 'outline' | 'fill'
  /** image / file: where it's stored */
  src?: string
  /** image / file: original file name, MIME type and size in bytes (absent on older images) */
  name?: string
  mime?: string
  size?: number
  text?: string
  fontSize?: number
  /** background colour; present => sticky note, absent => plain text box */
  note?: string
  taskId?: string
  from?: string
  to?: string
  /** id of the task card that was in focus when this was created (keeps it part of that task's context) */
  tag?: string
}

interface Entry {
  added: El[]
  removed: El[]
  before: El[]
  after: El[]
  tag?: string
  t?: number
}

type Act =
  | null
  | { kind: 'pan'; sx: number; sy: number; vx: number; vy: number }
  | { kind: 'draw' }
  | { kind: 'drag'; start: Pt; snaps: El[]; moved: boolean }
  | { kind: 'resize'; handle: string; start: Pt; snaps: El[]; moved: boolean }
  | { kind: 'marquee'; start: Pt; base: Set<string> }
  | { kind: 'connect'; from: string; at: Pt }

/* ================================================================== */
/* Constants + pure helpers                                            */
/* ================================================================== */

const FONT = font.sans
const MONO = font.mono

const PAL = canvas

const NOTE_COLORS = noteColors
const SWATCHES = ['auto', ...swatches]
const HANDLE = 8
const PAD = 10

const arrowCursor = new Path2D('M0 0 L0 16 L4.5 12 L8 19.5 L10.5 18.4 L7 11.2 L12.5 11 Z')
const measureCtx = document.createElement('canvas').getContext('2d')!
const hitCtx = document.createElement('canvas').getContext('2d')!

const uid = () => crypto.randomUUID()
const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v))
const bboxOf = (a: Pt, b: Pt): BBox => ({
  minX: Math.min(a.x, b.x),
  minY: Math.min(a.y, b.y),
  maxX: Math.max(a.x, b.x),
  maxY: Math.max(a.y, b.y),
})
const unionBox = (boxes: BBox[]): BBox => ({
  minX: Math.min(...boxes.map((b) => b.minX)),
  minY: Math.min(...boxes.map((b) => b.minY)),
  maxX: Math.max(...boxes.map((b) => b.maxX)),
  maxY: Math.max(...boxes.map((b) => b.maxY)),
})
const intersects = (a: BBox, b: BBox) =>
  a.minX <= b.maxX && a.maxX >= b.minX && a.minY <= b.maxY && a.maxY >= b.minY
const inBox = (p: Pt, b: BBox, pad = 0) =>
  p.x >= b.minX - pad && p.x <= b.maxX + pad && p.y >= b.minY - pad && p.y <= b.maxY + pad
const isBoxEl = (e: El) =>
  e.type === 'image' || e.type === 'file' || e.type === 'text' || e.type === 'task'

/** An image or file item as something the file viewer can show. */
const toAttachment = (el: El): Attachment => ({
  url: el.src ?? '',
  name: el.name || (el.type === 'image' ? 'image' : 'file'),
  type: el.mime || (el.type === 'image' ? 'image/*' : ''),
  size: el.size ?? 0,
})

const FILE_CARD = { w: 260, h: 64 }
const KIND_COLORS: Record<FileKind, string> = {
  image: '#0d9488',
  video: '#7c3aed',
  audio: '#ea580c',
  pdf: '#dc2626',
  text: '#2563eb',
  table: '#16a34a',
  other: '#64748b',
}

/** One line of text, cut with an ellipsis to fit `maxW`. */
const ellipsize = (ctx: CanvasRenderingContext2D, text: string, maxW: number) => {
  if (ctx.measureText(text).width <= maxW) return text
  const chars = [...text]
  while (chars.length && ctx.measureText(chars.join('') + '…').width > maxW) chars.pop()
  return chars.join('') + '…'
}

/* Task cards on the canvas mirror the board card: title, description, images and files. */
type Rect = { x: number; y: number; w: number; h: number }
interface TaskCardLayout {
  title: string[]
  desc: string[]
  /** Images (shown whole) and file rows, positioned relative to the card's top-left. */
  images: (Rect & { file: Attachment })[]
  rows: (Rect & { file: Attachment })[]
  /** "+N more …" lines for what didn't fit. */
  more: { y: number; text: string }[]
  /** Everything in the order the viewer steps through them. */
  files: Attachment[]
  height: number
}

const TASK_CARD = {
  w: 260,
  pad: 16,
  minH: 92,
  titleLines: 2,
  titleLH: 19,
  descLines: 4,
  descLH: 17,
  maxImages: 3,
  /** Taller images are scaled down to this height, never cropped. */
  maxImageH: 260,
  imageGap: 6,
  maxRows: 3,
  rowH: 26,
  moreH: 18,
  footer: 58,
}

/**
 * Set by the mounted canvas so module-level geometry (getBBox, hit tests) can size task cards
 * from the live task. There's only ever one canvas on screen.
 */
let lookupTask: (taskId: string) => TaskLite | undefined = () => undefined
/** Natural sizes of loaded images, so task cards can give each image its own shape. */
const imageDims = new Map<string, { w: number; h: number }>()
/** Bumped whenever an image size becomes known, so cached card layouts are redone. */
let imageDimsVersion = 0
const layoutCache = new Map<
  string,
  { task: TaskLite | undefined; w: number; version: number; layout: TaskCardLayout }
>()

const plural = (n: number, word: string) => `+${n} more ${word}${n === 1 ? '' : 's'}`

function layoutTaskCard(el: El, w: number): TaskCardLayout {
  const task = el.taskId ? lookupTask(el.taskId) : undefined
  const hit = layoutCache.get(el.id)
  if (hit && hit.task === task && hit.w === w && hit.version === imageDimsVersion) return hit.layout

  const { pad } = TASK_CARD
  const inner = Math.max(40, w - pad * 2)
  let y = 28
  measureCtx.font = `600 14px ${FONT}`
  const title = wrapLines(measureCtx, task ? task.title : 'This task was deleted', inner).slice(
    0,
    TASK_CARD.titleLines,
  )
  y += Math.max(1, title.length) * TASK_CARD.titleLH

  let desc: string[] = []
  if (task?.description) {
    measureCtx.font = `12.5px ${FONT}`
    const all = task.description
      .split('\n')
      .flatMap((p) => (p.trim() ? wrapLines(measureCtx, p, inner) : []))
    desc = all.slice(0, TASK_CARD.descLines)
    if (all.length > desc.length)
      desc[desc.length - 1] = ellipsize(measureCtx, `${desc[desc.length - 1]}…`, inner)
    if (desc.length) y += 4 + desc.length * TASK_CARD.descLH
  }

  const imageFiles = task?.files.filter(isImageFile) ?? []
  const others = task?.files.filter((f) => !isImageFile(f)) ?? []
  const more: TaskCardLayout['more'] = []

  const images: TaskCardLayout['images'] = []
  if (imageFiles.length) {
    y += 8
    imageFiles.slice(0, TASK_CARD.maxImages).forEach((file, i) => {
      if (i) y += TASK_CARD.imageGap
      // Full width at the image's own proportions (16:9 until it has loaded).
      const d = imageDims.get(file.url)
      const h = Math.min(TASK_CARD.maxImageH, d ? (inner * d.h) / d.w : inner * (9 / 16))
      images.push({ file, x: pad, y, w: inner, h })
      y += h
    })
    if (imageFiles.length > TASK_CARD.maxImages) {
      more.push({ y: y + 4, text: plural(imageFiles.length - TASK_CARD.maxImages, 'image') })
      y += TASK_CARD.moreH
    }
  }

  const rows: TaskCardLayout['rows'] = []
  if (others.length) {
    y += 8
    others.slice(0, TASK_CARD.maxRows).forEach((file) => {
      rows.push({ file, x: pad, y, w: inner, h: TASK_CARD.rowH - 4 })
      y += TASK_CARD.rowH
    })
    if (others.length > TASK_CARD.maxRows) {
      more.push({ y: y + 2, text: plural(others.length - TASK_CARD.maxRows, 'file') })
      y += TASK_CARD.moreH
    }
  }

  const layout: TaskCardLayout = {
    title,
    desc,
    images,
    rows,
    more,
    files: [...imageFiles, ...others],
    height: Math.max(TASK_CARD.minH, y + TASK_CARD.footer),
  }
  layoutCache.set(el.id, { task, w, version: imageDimsVersion, layout })
  return layout
}

/** Which of a task card's files is at world point `p`, if any. */
const taskFileAt = (el: El, b: BBox, p: Pt) => {
  const layout = layoutTaskCard(el, b.maxX - b.minX)
  const at = [...layout.images, ...layout.rows].find(
    (r) =>
      p.x >= b.minX + r.x &&
      p.x <= b.minX + r.x + r.w &&
      p.y >= b.minY + r.y &&
      p.y <= b.minY + r.y + r.h,
  )
  return at ? { files: layout.files, index: layout.files.indexOf(at.file) } : null
}

/** Draws all of `img` inside the rect, centred, keeping its proportions. */
const drawContain = (ctx: CanvasRenderingContext2D, img: HTMLImageElement, r: Rect) => {
  const iw = img.naturalWidth || r.w
  const ih = img.naturalHeight || r.h
  const s = Math.min(r.w / iw, r.h / ih)
  ctx.drawImage(img, r.x + (r.w - iw * s) / 2, r.y + (r.h - ih * s) / 2, iw * s, ih * s)
}
const resolveColor = (c: string | undefined, ink: string) => (!c || c === 'auto' ? ink : c)

const segDist = (p: Pt, a: Pt, b: Pt) => {
  const abx = b.x - a.x
  const aby = b.y - a.y
  const len2 = abx * abx + aby * aby
  const t = len2 > 0 ? clamp(((p.x - a.x) * abx + (p.y - a.y) * aby) / len2, 0, 1) : 0
  return Math.hypot(p.x - (a.x + t * abx), p.y - (a.y + t * aby))
}

/** Where a line from the centre of `b` towards (tx, ty) leaves the rectangle. */
const rectEdge = (b: BBox, tx: number, ty: number): Pt => {
  const cx = (b.minX + b.maxX) / 2
  const cy = (b.minY + b.maxY) / 2
  const dx = tx - cx
  const dy = ty - cy
  if (!dx && !dy) return { x: cx, y: cy }
  const hw = (b.maxX - b.minX) / 2 + 4
  const hh = (b.maxY - b.minY) / 2 + 4
  const s = Math.min(dx ? hw / Math.abs(dx) : Infinity, dy ? hh / Math.abs(dy) : Infinity)
  return { x: cx + dx * s, y: cy + dy * s }
}

const wrapLines = (ctx: CanvasRenderingContext2D, text: string, maxW: number) => {
  const out: string[] = []
  for (const para of text.split('\n')) {
    let line = ''
    for (const word of para.split(' ')) {
      const test = line ? `${line} ${word}` : word
      if (line && ctx.measureText(test).width > maxW) {
        out.push(line)
        line = word
      } else line = test
    }
    out.push(line)
  }
  return out
}

const shapePath = (el: El): Path2D => {
  const p = new Path2D()
  if (el.points.length < 2) return p
  const [s, e] = el.points
  const w = e.x - s.x
  const h = e.y - s.y
  const cx = s.x + w / 2
  const cy = s.y + h / 2
  const aw = Math.abs(w)
  const ah = Math.abs(h)
  switch (el.shapeKind) {
    case 'circle':
      p.ellipse(cx, cy, Math.max(aw / 2, 1), Math.max(ah / 2, 1), 0, 0, Math.PI * 2)
      break
    case 'star': {
      const outer = Math.max(aw, ah) / 2 || 1
      for (let i = 0; i < 10; i++) {
        const a = (Math.PI / 5) * i - Math.PI / 2
        const r = i % 2 === 0 ? outer : outer * 0.5
        const x = cx + Math.cos(a) * r
        const y = cy + Math.sin(a) * r
        i === 0 ? p.moveTo(x, y) : p.lineTo(x, y)
      }
      p.closePath()
      break
    }
    case 'heart': {
      const sx = aw / 2 || 1
      const sy = ah / 2 || 1
      p.moveTo(cx, cy + sy * 0.9)
      p.bezierCurveTo(cx + sx, cy + sy * 0.7, cx + sx * 0.9, cy - sy * 0.2, cx, cy + sy * 0.25)
      p.bezierCurveTo(cx - sx * 0.9, cy - sy * 0.2, cx - sx, cy + sy * 0.7, cx, cy + sy * 0.9)
      p.closePath()
      break
    }
    default:
      p.rect(Math.min(s.x, e.x), Math.min(s.y, e.y), aw, ah)
  }
  return p
}

const connPts = (el: El, map: Map<string, El>): [Pt, Pt] | null => {
  const a = el.from ? map.get(el.from) : undefined
  const b = el.to ? map.get(el.to) : undefined
  if (!a || !b) return null
  const ba = getBBox(a, map)
  const bb = getBBox(b, map)
  const ca = { x: (ba.minX + ba.maxX) / 2, y: (ba.minY + ba.maxY) / 2 }
  const cb = { x: (bb.minX + bb.maxX) / 2, y: (bb.minY + bb.maxY) / 2 }
  return [rectEdge(ba, cb.x, cb.y), rectEdge(bb, ca.x, ca.y)]
}

function getBBox(el: El, map: Map<string, El>): BBox {
  if (el.type === 'connector') {
    const p = connPts(el, map)
    return p ? bboxOf(p[0], p[1]) : { minX: 0, minY: 0, maxX: 0, maxY: 0 }
  }
  if (el.type === 'task' && el.points.length >= 2) {
    // Grows to fit the task's description and files; never smaller than its stored size.
    const b = bboxOf(el.points[0], el.points[1])
    const need = layoutTaskCard(el, b.maxX - b.minX).height
    return { ...b, maxY: Math.max(b.maxY, b.minY + need) }
  }
  if ((isBoxEl(el) || el.type === 'shape') && el.points.length >= 2)
    return bboxOf(el.points[0], el.points[1])
  const r = el.type === 'stroke' ? (el.lineWidth ?? 4) / 2 : 0
  const xs = el.points.map((p) => p.x)
  const ys = el.points.map((p) => p.y)
  return {
    minX: Math.min(...xs) - r,
    minY: Math.min(...ys) - r,
    maxX: Math.max(...xs) + r,
    maxY: Math.max(...ys) + r,
  }
}

const pointNear = (el: El, p: Pt, pad: number, map: Map<string, El>): boolean => {
  if (isBoxEl(el)) return inBox(p, getBBox(el, map), pad)
  const hit = (el.lineWidth ?? 4) / 2 + pad
  if (el.type === 'connector') {
    const pts = connPts(el, map)
    return !!pts && segDist(p, pts[0], pts[1]) <= Math.max(hit, 6 + pad)
  }
  if (!inBox(p, getBBox(el, map), hit)) return false
  if (el.type === 'stroke') {
    const pts = el.points
    if (pts.length === 1) return Math.hypot(p.x - pts[0].x, p.y - pts[0].y) <= hit
    for (let i = 0; i < pts.length - 1; i++) if (segDist(p, pts[i], pts[i + 1]) <= hit) return true
    return false
  }
  if (el.type === 'shape') {
    const path = shapePath(el)
    if (el.fill === 'fill') return hitCtx.isPointInPath(path, p.x, p.y)
    hitCtx.lineWidth = (el.lineWidth ?? 4) + pad * 2
    return hitCtx.isPointInStroke(path, p.x, p.y)
  }
  return false
}

/**
 * Every item that arrives from the database or another person passes through here.
 * Old rows used drawColor / shapeFill / imageDataUrl; map them onto the current schema.
 * Also sanitises what could be abused: text (see lib/sanitize), ink colour, and image sources
 * (only our storage / embedded images load, so a crafted item can't make viewers fetch any URL).
 */
const normalize = (raw: any): El => {
  const { drawColor, shapeFill, imageDataUrl, drawing, ...rest } = raw
  let color = rest.color ?? drawColor
  if (color === '#000000' || color === '#0a0a0a') color = 'auto'
  const src = rest.src ?? imageDataUrl
  const el = { ...rest, color: cleanInk(color), fill: rest.fill ?? shapeFill } as El
  if (src !== undefined) el.src = isSafeImageSrc(src) ? src : undefined
  if (typeof el.text === 'string') el.text = cleanMultiline(el.text, LIMITS.canvasText)
  if (el.name !== undefined) el.name = cleanLine(String(el.name), 200)
  if (el.mime !== undefined)
    el.mime = typeof el.mime === 'string' && /^[\w.+-]+\/[\w.+*-]+$/.test(el.mime) ? el.mime : ''
  if (el.size !== undefined) el.size = typeof el.size === 'number' && el.size >= 0 ? el.size : 0
  return el
}

/** Auto-height for plain text; sticky notes only grow. */
const fitText = (el: El): El => {
  const fs = el.fontSize ?? 18
  const pad = el.note ? 12 : 6
  const b = bboxOf(el.points[0], el.points[1])
  measureCtx.font = `${fs}px ${FONT}`
  const lines = wrapLines(measureCtx, el.text ?? '', b.maxX - b.minX - pad * 2)
  const need = Math.max(1, lines.length) * fs * 1.35 + pad * 2
  const h = el.note ? Math.max(b.maxY - b.minY, need) : need
  return {
    ...el,
    points: [
      { x: b.minX, y: b.minY },
      { x: b.maxX, y: b.minY + h },
    ],
  }
}

const strokePolyline = (ctx: CanvasRenderingContext2D, pts: Pt[]) => {
  ctx.beginPath()
  if (pts.length === 1) {
    ctx.arc(pts[0].x, pts[0].y, ctx.lineWidth / 2, 0, Math.PI * 2)
    ctx.fillStyle = ctx.strokeStyle
    ctx.fill()
    return
  }
  ctx.moveTo(pts[0].x, pts[0].y)
  if (pts.length === 2) ctx.lineTo(pts[1].x, pts[1].y)
  else {
    for (let i = 1; i < pts.length - 1; i++) {
      const mx = (pts[i].x + pts[i + 1].x) / 2
      const my = (pts[i].y + pts[i + 1].y) / 2
      ctx.quadraticCurveTo(pts[i].x, pts[i].y, mx, my)
    }
    ctx.lineTo(pts[pts.length - 1].x, pts[pts.length - 1].y)
  }
  ctx.stroke()
}

/* ================================================================== */
/* Small UI pieces                                                     */
/* ================================================================== */

const ToolBtn: React.FC<{
  icon: React.ReactNode
  label: string
  kbd?: string
  active?: boolean
  disabled?: boolean
  danger?: boolean
  onClick: () => void
}> = ({ icon, label, kbd, active, disabled, danger, onClick }) => (
  <button
    className={`dv-iconbtn ${danger ? 'danger' : ''}`}
    data-active={!!active}
    disabled={disabled}
    title={kbd ? `${label} (${kbd})` : label}
    aria-label={label}
    onClick={onClick}
  >
    {icon}
  </button>
)

const shapeIcons: Record<ShapeKind, LucideIcon> = {
  rectangle: Square,
  circle: Circle,
  star: Star,
  heart: Heart,
}

/* ================================================================== */
/* Whiteboard                                                          */
/* ================================================================== */

export const Whiteboard: React.FC<{ active?: boolean; theme?: 'light' | 'dark' }> = ({
  active = true,
  theme = 'light',
}) => {
  const { roomId, me, send, on, status, isOwner } = useRoom()
  const taskData = useRoomTasks()

  const wrapRef = useRef<HTMLDivElement>(null)
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const editorRef = useRef<HTMLTextAreaElement>(null)

  /* ---------- mutable scene (read by the draw loop; React state is only for UI) ---------- */
  const st = useRef({
    els: [] as El[],
    map: new Map<string, El>(),
    sel: new Set<string>(),
    view: { x: 0, y: 0, k: 1 },
    w: 0,
    h: 0,
    dpr: 1,
    hoverId: null as string | null,
    hoverHandle: null as string | null,
    preview: null as El | null,
    marquee: null as BBox | null,
    act: null as Act,
    space: false,
    focusId: null as string | null,
    focusSet: null as Set<string> | null,
    prevView: null as { x: number; y: number; k: number } | null,
    linkSig: '',
    cursors: new Map<string, { name: string; color: string; x: number; y: number; t: number }>(),
  }).current

  // ---------- UI state ----------
  const [tool, setToolState] = useState<Tool>('select')
  const [color, setColor] = useState('auto')
  const [lineWidth, setLineWidth] = useState(4)
  const [shapeKind, setShapeKind] = useState<ShapeKind>('rectangle')
  const [shapeFill, setShapeFill] = useState<'outline' | 'fill'>('outline')
  const [noteColor, setNoteColor] = useState(NOTE_COLORS[0])
  const [selIds, setSelIds] = useState<string[]>([])
  const [count, setCount] = useState(0)
  const [zoomPct, setZoomPct] = useState(100)
  const [canUndo, setCanUndo] = useState(false)
  const [canRedo, setCanRedo] = useState(false)
  const [showSettings, setShowSettings] = useState(false)
  const [showTasks, setShowTasks] = useState(false)
  const [showPicker, setShowPicker] = useState(false)
  const [taskQuery, setTaskQuery] = useState('')
  const [isDragOver, setIsDragOver] = useState(false)
  const [focus, setFocus] = useState<string | null>(null)
  const [cfg, setCfg] = useState({
    bg: 'theme' as 'theme' | 'custom',
    customBg: '#ffffff',
    grid: 'dots' as 'none' | 'dots' | 'lines',
    gridSize: 24,
    snap: false,
  })
  const [editing, setEditing] = useState<{ id: string; isNew: boolean } | null>(null)
  const [editText, setEditText] = useState('')
  const [viewing, setViewing] = useState<{ files: Attachment[]; index: number } | null>(null)
  const viewingRef = useRef(false)
  viewingRef.current = !!viewing
  const [, force] = useState(0)

  // ---------- refs that mirror state for event handlers ----------
  const toolRef = useRef(tool)
  toolRef.current = tool
  const styleRef = useRef({ color, lineWidth, shapeKind, shapeFill, noteColor })
  styleRef.current = { color, lineWidth, shapeKind, shapeFill, noteColor }
  const cfgRef = useRef(cfg)
  cfgRef.current = cfg
  const themeRef = useRef(theme)
  themeRef.current = theme
  const activeRef = useRef(active)
  activeRef.current = active
  const editingRef = useRef<{ id: string; isNew: boolean } | null>(null)
  const editTextRef = useRef('')
  const taskRef = useRef(taskData)
  taskRef.current = taskData
  lookupTask = (id) => taskRef.current.byId.get(id)
  const undoStack = useRef<Entry[]>([])
  const redoStack = useRef<Entry[]>([])
  const pointers = useRef(new Map<number, Pt>())
  const pinch = useRef<{ d: number; cx: number; cy: number } | null>(null)
  const lastCursorSend = useRef(0)
  const lastLiveSend = useRef(0)
  const imageCache = useRef(new Map<string, HTMLImageElement | 'loading'>())
  const cursorStr = useRef('')
  const api = useRef<any>({})

  /* ================================================================== */
  /* Drawing                                                             */
  /* ================================================================== */

  const rafRef = useRef(0)
  const drawRef = useRef<() => void>(() => {})
  const requestDraw = useCallback(() => {
    if (rafRef.current) {
      cancelAnimationFrame(rafRef.current)
    }

    rafRef.current = requestAnimationFrame(() => {
      rafRef.current = 0
      drawRef.current()
    })
  }, [])

  const getImage = (src: string) => {
    const cached = imageCache.current.get(src)
    if (cached && cached !== 'loading') return cached
    if (!cached) {
      imageCache.current.set(src, 'loading')
      const img = new Image()
      img.onload = () => {
        imageCache.current.set(src, img)
        imageDims.set(src, { w: img.naturalWidth || 1, h: img.naturalHeight || 1 })
        imageDimsVersion++
        requestDraw()
      }
      img.onerror = () => imageCache.current.delete(src)
      img.src = src
    }
    return null
  }

  const selBox = (): BBox | null => {
    const items = [...st.sel]
      .map((id) => st.map.get(id))
      .filter((e): e is El => !!e && e.type !== 'connector')
    if (!items.length) return null
    const b = unionBox(items.map((e) => getBBox(e, st.map)))
    return { minX: b.minX - PAD, minY: b.minY - PAD, maxX: b.maxX + PAD, maxY: b.maxY + PAD }
  }

  const handlesOf = (b: BBox) => [
    { id: 'nw', x: b.minX, y: b.minY },
    { id: 'ne', x: b.maxX, y: b.minY },
    { id: 'se', x: b.maxX, y: b.maxY },
    { id: 'sw', x: b.minX, y: b.maxY },
  ]

  const draw = () => {
    const canvas = canvasRef.current
    if (!canvas || !st.w || !st.h) return
    const ctx = canvas.getContext('2d')
    if (!ctx) return
    const pal = PAL[themeRef.current]
    const c = cfgRef.current
    const { view } = st
    const k = view.k
    const editId = editingRef.current?.id
    const dim = (id: string) => !!st.focusSet && st.map.has(id) && !st.focusSet.has(id)

    ctx.setTransform(st.dpr, 0, 0, st.dpr, 0, 0)
    ctx.fillStyle = c.bg === 'custom' ? c.customBg : pal.bg
    ctx.fillRect(0, 0, st.w, st.h)

    // grid
    if (c.grid !== 'none') {
      let step = c.gridSize * k
      while (step < 10) step *= 2
      const ox = ((view.x % step) + step) % step
      const oy = ((view.y % step) + step) % step
      if (c.grid === 'dots') {
        ctx.fillStyle = pal.dot
        for (let x = ox; x < st.w; x += step)
          for (let y = oy; y < st.h; y += step) ctx.fillRect(x - 0.75, y - 0.75, 1.5, 1.5)
      } else {
        ctx.strokeStyle = pal.line
        ctx.lineWidth = 1
        ctx.beginPath()
        for (let x = ox; x < st.w; x += step) {
          ctx.moveTo(Math.round(x) + 0.5, 0)
          ctx.lineTo(Math.round(x) + 0.5, st.h)
        }
        for (let y = oy; y < st.h; y += step) {
          ctx.moveTo(0, Math.round(y) + 0.5)
          ctx.lineTo(st.w, Math.round(y) + 0.5)
        }
        ctx.stroke()
      }
    }

    ctx.save()
    ctx.translate(view.x, view.y)
    ctx.scale(k, k)
    ctx.lineCap = 'round'
    ctx.lineJoin = 'round'

    const all = st.preview ? [...st.els, st.preview] : st.els

    const outline = (el: El, strokeStyle: string, px: number, dashed = false) => {
      ctx.save()
      ctx.strokeStyle = strokeStyle
      ctx.lineWidth = px / k
      if (dashed) ctx.setLineDash([6 / k, 4 / k])
      if (el.type === 'stroke') {
        ctx.lineWidth = (el.lineWidth ?? 4) + 6 / k
        strokePolyline(ctx, el.points)
      } else if (el.type === 'shape') {
        ctx.lineWidth = (el.lineWidth ?? 4) + 6 / k
        ctx.stroke(shapePath(el))
      } else if (el.type === 'connector') {
        const p = connPts(el, st.map)
        if (p) {
          ctx.lineWidth = (el.lineWidth ?? 2) + 6 / k
          ctx.beginPath()
          ctx.moveTo(p[0].x, p[0].y)
          ctx.lineTo(p[1].x, p[1].y)
          ctx.stroke()
        }
      } else {
        const b = getBBox(el, st.map)
        const g = 3 / k
        ctx.beginPath()
        ctx.roundRect(b.minX - g, b.minY - g, b.maxX - b.minX + g * 2, b.maxY - b.minY + g * 2, 8)
        ctx.stroke()
      }
      ctx.restore()
    }

    // connectors sit underneath everything else
    for (const el of all) {
      if (el.type !== 'connector') continue
      const p = connPts(el, st.map)
      if (!p) continue
      const lw = el.lineWidth ?? 2
      const col = st.sel.has(el.id)
        ? pal.accent
        : el.color
          ? resolveColor(el.color, pal.ink)
          : pal.link
      ctx.save()
      if (dim(el.id)) ctx.globalAlpha = 0.12
      ctx.strokeStyle = col
      ctx.fillStyle = col
      ctx.lineWidth = lw
      ctx.beginPath()
      ctx.moveTo(p[0].x, p[0].y)
      ctx.lineTo(p[1].x, p[1].y)
      ctx.stroke()
      const ang = Math.atan2(p[1].y - p[0].y, p[1].x - p[0].x)
      const head = 9 + lw * 1.5
      ctx.beginPath()
      ctx.moveTo(p[1].x, p[1].y)
      ctx.lineTo(p[1].x - head * Math.cos(ang - 0.4), p[1].y - head * Math.sin(ang - 0.4))
      ctx.lineTo(p[1].x - head * Math.cos(ang + 0.4), p[1].y - head * Math.sin(ang + 0.4))
      ctx.closePath()
      ctx.fill()
      ctx.restore()
    }

    for (const el of all) {
      if (el.type === 'connector') continue
      ctx.save()
      if (dim(el.id)) ctx.globalAlpha = 0.12
      if (el.type === 'stroke' && el.points.length) {
        ctx.strokeStyle = resolveColor(el.color, pal.ink)
        ctx.lineWidth = el.lineWidth ?? 4
        strokePolyline(ctx, el.points)
      } else if (el.type === 'shape' && el.points.length >= 2) {
        const col = resolveColor(el.color, pal.ink)
        ctx.lineWidth = el.lineWidth ?? 4
        ctx.strokeStyle = col
        ctx.fillStyle = col
        const path = shapePath(el)
        el.fill === 'fill' ? ctx.fill(path) : ctx.stroke(path)
      } else if (el.type === 'image' && el.src && el.points.length >= 2) {
        const b = getBBox(el, st.map)
        const img = getImage(el.src)
        if (img) ctx.drawImage(img, b.minX, b.minY, b.maxX - b.minX, b.maxY - b.minY)
        else {
          ctx.fillStyle = pal.border
          ctx.fillRect(b.minX, b.minY, b.maxX - b.minX, b.maxY - b.minY)
        }
      } else if (el.type === 'file' && el.points.length >= 2) {
        const b = getBBox(el, st.map)
        const w = b.maxX - b.minX
        const h = b.maxY - b.minY
        const file = toAttachment(el)
        ctx.shadowColor = 'rgba(0,0,0,0.16)'
        ctx.shadowBlur = 10
        ctx.shadowOffsetY = 3
        ctx.fillStyle = pal.panel
        ctx.beginPath()
        ctx.roundRect(b.minX, b.minY, w, h, 10)
        ctx.fill()
        ctx.shadowColor = 'transparent'
        ctx.strokeStyle = pal.border
        ctx.lineWidth = 1 / k
        ctx.stroke()
        const side = Math.min(40, h - 16)
        const bx = b.minX + 12
        const by = b.minY + (h - side) / 2
        ctx.fillStyle = KIND_COLORS[fileKind(file.type, file.name)]
        ctx.beginPath()
        ctx.roundRect(bx, by, side, side, 8)
        ctx.fill()
        ctx.fillStyle = '#ffffff'
        ctx.font = `600 10px ${MONO}`
        ctx.textAlign = 'center'
        ctx.textBaseline = 'middle'
        ctx.fillText(ellipsize(ctx, fileBadge(file), side - 4), bx + side / 2, by + side / 2)
        ctx.textAlign = 'left'
        ctx.textBaseline = 'top'
        const tx = bx + side + 12
        const tw = b.maxX - tx - 12
        const ty = b.minY + h / 2
        ctx.fillStyle = pal.ink
        ctx.font = `600 14px ${FONT}`
        ctx.fillText(ellipsize(ctx, file.name, tw), tx, ty - 18)
        ctx.fillStyle = pal.muted
        ctx.font = `12px ${FONT}`
        const meta = [formatBytes(file.size), 'double-click to open'].filter(Boolean).join(' · ')
        ctx.fillText(ellipsize(ctx, meta, tw), tx, ty + 2)
      } else if (el.type === 'text' && el.points.length >= 2) {
        const b = getBBox(el, st.map)
        const w = b.maxX - b.minX
        const h = b.maxY - b.minY
        const fs = el.fontSize ?? 18
        const pad = el.note ? 12 : 6
        if (el.note) {
          ctx.shadowColor = 'rgba(0,0,0,0.18)'
          ctx.shadowBlur = 10
          ctx.shadowOffsetY = 3
          ctx.fillStyle = el.note
          ctx.beginPath()
          ctx.roundRect(b.minX, b.minY, w, h, 6)
          ctx.fill()
          ctx.shadowColor = 'transparent'
        }
        if (el.id !== editId) {
          ctx.fillStyle = el.note ? noteInk : resolveColor(el.color, pal.ink)
          ctx.font = `${fs}px ${FONT}`
          ctx.textBaseline = 'top'
          wrapLines(ctx, el.text ?? '', w - pad * 2).forEach((line, i) =>
            ctx.fillText(line, b.minX + pad, b.minY + pad + i * fs * 1.35),
          )
        }
      } else if (el.type === 'task' && el.points.length >= 2) {
        const b = getBBox(el, st.map)
        const w = b.maxX - b.minX
        const h = b.maxY - b.minY
        const task = el.taskId ? taskRef.current.byId.get(el.taskId) : undefined
        const urg = task ? taskRef.current.urgencyOpt(task.urgency) : null
        const stat = task ? taskRef.current.statusOpt(task.status) : null
        const done = task?.status === 'completed'
        if (done) {
          // Greyed out, like completed cards on the board.
          ctx.globalAlpha *= 0.55
          ctx.filter = 'grayscale(1)'
        }
        ctx.shadowColor = 'rgba(0,0,0,0.16)'
        ctx.shadowBlur = 10
        ctx.shadowOffsetY = 3
        ctx.fillStyle = pal.panel
        ctx.beginPath()
        ctx.roundRect(b.minX, b.minY, w, h, 10)
        ctx.fill()
        ctx.shadowColor = 'transparent'
        ctx.strokeStyle = pal.border
        ctx.lineWidth = 1 / k
        ctx.stroke()
        ctx.save()
        ctx.beginPath()
        ctx.roundRect(b.minX, b.minY, w, h, 10)
        ctx.clip()
        ctx.fillStyle = urg?.color ?? pal.border
        ctx.fillRect(b.minX, b.minY, 5, h)
        ctx.restore()
        const layout = layoutTaskCard(el, w)
        ctx.textBaseline = 'top'
        ctx.fillStyle = pal.muted
        ctx.font = `11px ${MONO}`
        ctx.fillText('task', b.minX + 16, b.minY + 11)
        ctx.fillStyle = task && !done ? pal.ink : pal.muted
        ctx.font = `600 14px ${FONT}`
        layout.title.forEach((l, i) => {
          const y = b.minY + 28 + i * TASK_CARD.titleLH
          ctx.fillText(l, b.minX + 16, y)
          if (done) ctx.fillRect(b.minX + 16, y + 8, ctx.measureText(l).width, 1.25)
        })
        if (layout.desc.length) {
          ctx.fillStyle = pal.muted
          ctx.font = `12.5px ${FONT}`
          const dy = 28 + layout.title.length * TASK_CARD.titleLH + 4
          layout.desc.forEach((l, i) =>
            ctx.fillText(l, b.minX + 16, b.minY + dy + i * TASK_CARD.descLH),
          )
        }
        for (const im of layout.images) {
          const r = { x: b.minX + im.x, y: b.minY + im.y, w: im.w, h: im.h }
          const img = getImage(im.file.url)
          if (img) drawContain(ctx, img, r)
          else {
            ctx.fillStyle = pal.border
            ctx.beginPath()
            ctx.roundRect(r.x, r.y, r.w, r.h, 6)
            ctx.fill()
          }
        }
        for (const row of layout.rows) {
          const x = b.minX + row.x
          const y = b.minY + row.y
          ctx.strokeStyle = pal.border
          ctx.lineWidth = 1 / k
          ctx.beginPath()
          ctx.roundRect(x, y, row.w, row.h, 6)
          ctx.stroke()
          ctx.fillStyle = KIND_COLORS[fileKind(row.file.type, row.file.name)]
          ctx.beginPath()
          ctx.roundRect(x + 4, y + 4, 30, row.h - 8, 4)
          ctx.fill()
          ctx.fillStyle = '#ffffff'
          ctx.font = `600 8px ${MONO}`
          ctx.textAlign = 'center'
          ctx.textBaseline = 'middle'
          ctx.fillText(ellipsize(ctx, fileBadge(row.file), 28), x + 19, y + row.h / 2)
          ctx.textAlign = 'left'
          const size = formatBytes(row.file.size)
          ctx.font = `11px ${FONT}`
          const sizeW = size ? ctx.measureText(size).width + 8 : 0
          ctx.fillStyle = pal.muted
          if (size) ctx.fillText(size, x + row.w - sizeW, y + row.h / 2)
          ctx.fillStyle = pal.ink
          ctx.font = `12px ${FONT}`
          ctx.fillText(ellipsize(ctx, row.file.name, row.w - 46 - sizeW), x + 40, y + row.h / 2)
          ctx.textBaseline = 'top'
        }
        ctx.fillStyle = pal.muted
        ctx.font = `11.5px ${FONT}`
        for (const m of layout.more) ctx.fillText(m.text, b.minX + 16, b.minY + m.y)
        if (stat) {
          ctx.fillStyle = stat.color
          ctx.beginPath()
          ctx.arc(b.minX + 20, b.maxY - 36, 4, 0, Math.PI * 2)
          ctx.fill()
          ctx.fillStyle = pal.muted
          ctx.font = `12px ${FONT}`
          ctx.fillText(`${stat.label}${urg ? ` · ${urg.label}` : ''}`, b.minX + 30, b.maxY - 43)
        }
        if (task && (task.dueDate || task.assigneeName)) {
          const details = [
            task.dueDate ? `Due ${formatDueDate(task.dueDate)}` : '',
            task.assigneeName ?? '',
          ]
            .filter(Boolean)
            .join(' · ')
          ctx.fillStyle = pal.muted
          ctx.font = `11.5px ${FONT}`
          ctx.fillText(ellipsize(ctx, details, w - 32), b.minX + 16, b.maxY - 20)
        }
      }
      ctx.restore()
    }

    // connect-tool preview
    if (st.act?.kind === 'connect') {
      const from = st.map.get(st.act.from)
      if (from) {
        const p0 = rectEdge(getBBox(from, st.map), st.act.at.x, st.act.at.y)
        ctx.save()
        ctx.strokeStyle = pal.accent
        ctx.lineWidth = 2 / k
        ctx.setLineDash([6 / k, 5 / k])
        ctx.beginPath()
        ctx.moveTo(p0.x, p0.y)
        ctx.lineTo(st.act.at.x, st.act.at.y)
        ctx.stroke()
        ctx.restore()
      }
    }

    // hover
    if (st.hoverId && (!st.act || st.act.kind === 'connect')) {
      const el = st.map.get(st.hoverId)
      if (el && !st.sel.has(el.id))
        outline(
          el,
          pal.accent + (toolRef.current === 'connect' ? 'ff' : '88'),
          toolRef.current === 'connect' ? 2.5 : 1.5,
        )
    }

    // marquee
    if (st.marquee) {
      const m = st.marquee
      ctx.save()
      ctx.fillStyle = pal.accent + '14'
      ctx.strokeStyle = pal.accent
      ctx.lineWidth = 1 / k
      ctx.setLineDash([4 / k, 3 / k])
      ctx.fillRect(m.minX, m.minY, m.maxX - m.minX, m.maxY - m.minY)
      ctx.strokeRect(m.minX, m.minY, m.maxX - m.minX, m.maxY - m.minY)
      ctx.restore()
    }

    // selection
    if (st.sel.size) {
      for (const id of st.sel) {
        const el = st.map.get(id)
        if (el && el.type !== 'connector') outline(el, pal.accent, 1.5, true)
      }
      const box = selBox()
      if (box && !st.act?.kind.match(/draw|connect/)) {
        ctx.save()
        ctx.fillStyle = pal.accent + '0d'
        ctx.strokeStyle = pal.accent
        ctx.lineWidth = 1 / k
        ctx.fillRect(box.minX, box.minY, box.maxX - box.minX, box.maxY - box.minY)
        ctx.strokeRect(box.minX, box.minY, box.maxX - box.minX, box.maxY - box.minY)
        const hs = HANDLE / k
        for (const h of handlesOf(box)) {
          const size = st.hoverHandle === h.id ? hs * 1.4 : hs
          ctx.fillStyle = st.hoverHandle === h.id ? pal.accent : '#ffffff'
          ctx.fillRect(h.x - size / 2, h.y - size / 2, size, size)
          ctx.strokeRect(h.x - size / 2, h.y - size / 2, size, size)
        }
        ctx.restore()
      }
    }
    ctx.restore()

    // teammates' cursors (screen space)
    const now = Date.now()
    st.cursors.forEach((cur) => {
      if (now - cur.t > 8000) return
      const sx = cur.x * k + view.x
      const sy = cur.y * k + view.y
      ctx.save()
      ctx.translate(sx, sy)
      ctx.fillStyle = cur.color
      ctx.strokeStyle = '#fff'
      ctx.lineWidth = 1.5
      ctx.lineJoin = 'round'
      ctx.stroke(arrowCursor)
      ctx.fill(arrowCursor)
      ctx.font = `600 11px ${FONT}`
      const tw = ctx.measureText(cur.name).width
      ctx.fillStyle = cur.color
      ctx.beginPath()
      ctx.roundRect(14, 14, tw + 12, 20, 6)
      ctx.fill()
      ctx.fillStyle = '#fff'
      ctx.textBaseline = 'middle'
      ctx.fillText(cur.name, 20, 24.5)
      ctx.restore()
    })
  }
  drawRef.current = draw

  /* ================================================================== */
  /* Scene mutation primitives (local state + DB + broadcast)            */
  /* ================================================================== */

  /** The focused task card, everything within two connector hops, and anything created while it was focused. */
  const computeFocusSet = (): Set<string> | null => {
    const f = st.focusId
    if (!f || !st.map.has(f)) return null
    const adj = new Map<string, string[]>()
    const link = (a: string, b: string) => adj.set(a, [...(adj.get(a) ?? []), b])
    for (const e of st.els) {
      if (e.type === 'connector' && e.from && e.to) {
        link(e.from, e.to)
        link(e.to, e.from)
      }
    }
    const set = new Set([f])
    let frontier = [f]
    for (let depth = 0; depth < 2; depth++) {
      const next: string[] = []
      for (const id of frontier) {
        for (const n of adj.get(id) ?? []) {
          if (!set.has(n)) {
            set.add(n)
            next.push(n)
          }
        }
      }
      frontier = next
    }
    for (const e of st.els) if (e.tag === f) set.add(e.id)
    for (const e of st.els)
      if (e.type === 'connector' && set.has(e.from!) && set.has(e.to!)) set.add(e.id)
    return set
  }

  /** Tells the board how many canvas items each task card is linked to (only when something changed). */
  const publishLinks = () => {
    const cards = new Map<string, string>()
    for (const e of st.els) if (e.type === 'task' && e.taskId) cards.set(e.id, e.taskId)
    if (!cards.size && !st.linkSig) return
    const linked = new Map<string, Set<string>>()
    cards.forEach((_t, id) => linked.set(id, new Set()))
    for (const e of st.els) {
      if (e.type === 'connector') {
        if (e.from && e.to && linked.has(e.from)) linked.get(e.from)!.add(e.to)
        if (e.from && e.to && linked.has(e.to)) linked.get(e.to)!.add(e.from)
      } else if (e.tag && e.tag !== e.id && linked.has(e.tag)) linked.get(e.tag)!.add(e.id)
    }
    const counts = new Map<string, number>()
    linked.forEach((set, id) => {
      const taskId = cards.get(id)!
      counts.set(taskId, (counts.get(taskId) ?? 0) + set.size)
    })
    const sig = [...counts].sort().join('|')
    if (sig === st.linkSig) return
    st.linkSig = sig
    setLinkCounts(counts)
  }

  const setEls = (next: El[]) => {
    st.els = next
    st.map = new Map(next.map((e) => [e.id, e]))
    if (st.focusId && !st.map.has(st.focusId)) {
      // the focused card was deleted
      st.focusId = null
      st.prevView = null
      setFocus(null)
    }
    st.focusSet = computeFocusSet()
    setCount(next.length)
    publishLinks()
    requestDraw()
  }

  /** While a task is focused, new items join its context: objects get a visible link, drawings are just tagged. */
  const withFocus = (items: El[]): El[] => {
    const f = st.focusId
    if (!f || !st.map.has(f)) return items
    const out: El[] = []
    for (const e of items) {
      out.push({ ...e, tag: f })
      if (isBoxEl(e) && e.id !== f) {
        out.push({
          id: uid(),
          type: 'connector',
          userId: me.id,
          points: [],
          from: f,
          to: e.id,
          lineWidth: 2,
          tag: f,
        })
      }
    }
    return out
  }

  const setSel = (next: Set<string>) => {
    if (next.size === st.sel.size && [...next].every((id) => st.sel.has(id))) return
    st.sel = next
    setSelIds([...next])
    requestDraw()
  }

  const logErr = ({ error }: { error: { message: string } | null }) => {
    if (error) console.error('[whiteboard]', error.message)
  }

  const opAdd = (items: El[]) => {
    const ids = new Set(items.map((i) => i.id))
    setEls([...st.els.filter((e) => !ids.has(e.id)), ...items])
    supabase
      .from('strokes')
      .insert(items.map((data) => ({ room_id: roomId, data })))
      .then(logErr)
    send('wb:add', { items })
  }

  const opPatch = (items: (Partial<El> & { id: string })[], persist = true) => {
    const m = new Map(items.map((i) => [i.id, i]))
    setEls(st.els.map((e) => (m.has(e.id) ? { ...e, ...m.get(e.id)! } : e)))
    if (persist) {
      for (const it of items) {
        const full = st.map.get(it.id)
        if (full)
          supabase
            .from('strokes')
            .update({ data: full })
            .eq('room_id', roomId)
            .eq('data->>id', it.id)
            .then(logErr)
      }
    }
    send('wb:patch', { items })
  }

  const opRemove = (ids: string[]) => {
    const s = new Set(ids)
    setEls(st.els.filter((e) => !s.has(e.id)))
    setSel(new Set([...st.sel].filter((id) => !s.has(id))))
    supabase.from('strokes').delete().eq('room_id', roomId).in('data->>id', ids).then(logErr)
    send('wb:remove', { ids })
  }

  const syncHistoryFlags = () => {
    setCanUndo(undoStack.current.length > 0)
    setCanRedo(redoStack.current.length > 0)
  }

  /** Records an undoable step. Entries with the same `tag` within 800ms merge (slider drags etc.). */
  const commit = (entry: Entry) => {
    const last = undoStack.current[undoStack.current.length - 1]
    const now = Date.now()
    if (entry.tag && last && last.tag === entry.tag && now - (last.t ?? 0) < 800) {
      last.after = entry.after
      last.t = now
    } else undoStack.current.push({ ...entry, t: now })
    redoStack.current = []
    syncHistoryFlags()
  }

  const runEntry = (e: Entry, dir: 'undo' | 'redo') => {
    const rm = dir === 'undo' ? e.added : e.removed
    const ad = dir === 'undo' ? e.removed : e.added
    const pt = dir === 'undo' ? e.before : e.after
    if (rm.length) opRemove(rm.map((x) => x.id))
    if (ad.length) opAdd(ad)
    if (pt.length) opPatch(pt.filter((p) => st.map.has(p.id)))
  }

  const undo = () => {
    const e = undoStack.current.pop()
    if (!e) return
    redoStack.current.push(e)
    runEntry(e, 'undo')
    syncHistoryFlags()
  }

  const redo = () => {
    const e = redoStack.current.pop()
    if (!e) return
    undoStack.current.push(e)
    runEntry(e, 'redo')
    syncHistoryFlags()
  }

  /** Removes elements plus any connectors attached to them, as one undo step. */
  const removeWithLinks = (ids: string[]) => {
    const set = new Set(ids)
    const doomed = st.els.filter(
      (e) => set.has(e.id) || (e.type === 'connector' && (set.has(e.from!) || set.has(e.to!))),
    )
    if (!doomed.length) return
    commit({ added: [], removed: doomed, before: [], after: [] })
    opRemove(doomed.map((e) => e.id))
  }

  const deleteSelection = () => {
    if (st.sel.size) removeWithLinks([...st.sel])
  }

  const duplicateSelection = () => {
    const picked = [...st.sel]
      .map((id) => st.map.get(id))
      .filter((e): e is El => !!e && e.type !== 'connector')
    if (!picked.length) return
    const idMap = new Map(picked.map((e) => [e.id, uid()]))
    const copies = picked.map((e) => ({
      ...e,
      id: idMap.get(e.id)!,
      userId: me.id,
      points: e.points.map((p) => ({ x: p.x + 28, y: p.y + 28 })),
    }))
    const links = st.els
      .filter((e) => e.type === 'connector' && idMap.has(e.from!) && idMap.has(e.to!))
      .map((e) => ({ ...e, id: uid(), from: idMap.get(e.from!), to: idMap.get(e.to!) }))
    const added = [...copies, ...links]
    commit({ added, removed: [], before: [], after: [] })
    opAdd(added)
    setSel(new Set(copies.map((c) => c.id)))
  }

  const applyStyle = (patch: Partial<El>, tag: string) => {
    const targets = [...st.sel].map((id) => st.map.get(id)).filter((e): e is El => !!e)
    const keys = Object.keys(patch) as (keyof El)[]
    const changed = targets.filter((e) => {
      if (keys.includes('lineWidth') && !['stroke', 'shape', 'connector'].includes(e.type))
        return false
      if (keys.includes('fontSize') && e.type !== 'text') return false
      if (keys.includes('note') && !(e.type === 'text' && e.note)) return false
      if (keys.includes('color') && !['stroke', 'shape', 'connector', 'text'].includes(e.type))
        return false
      return true
    })
    if (!changed.length) return
    const before = changed.map((e) => ({ ...e }))
    opPatch(changed.map((e) => ({ id: e.id, ...patch })))
    commit({
      added: [],
      removed: [],
      before,
      after: changed.map((e) => ({ ...st.map.get(e.id)! })),
      tag,
    })
  }

  /* ================================================================== */
  /* View helpers                                                        */
  /* ================================================================== */

  const setView = (v: Partial<{ x: number; y: number; k: number }>) => {
    st.view = { ...st.view, ...v }
    if (v.k !== undefined) setZoomPct(Math.round(st.view.k * 100))
    if (editingRef.current) force((n) => n + 1)
    requestDraw()
  }

  const zoomAt = (factor: number, clientX: number, clientY: number) => {
    const r = canvasRef.current?.getBoundingClientRect()
    if (!r) return
    const fx = clientX - r.left
    const fy = clientY - r.top
    const k0 = st.view.k
    const k1 = clamp(k0 * factor, 0.1, 4)
    const wx = (fx - st.view.x) / k0
    const wy = (fy - st.view.y) / k0
    setView({ k: k1, x: fx - wx * k1, y: fy - wy * k1 })
  }

  const zoomCenter = (factor: number) => {
    const r = canvasRef.current?.getBoundingClientRect()
    if (r) zoomAt(factor, r.left + st.w / 2, r.top + st.h / 2)
  }

  const fitContent = () => {
    const items = st.els.filter((e) => e.type !== 'connector')
    if (!items.length) return setView({ x: 0, y: 0, k: 1 })
    const b = unionBox(items.map((e) => getBBox(e, st.map)))
    const bw = b.maxX - b.minX + 160
    const bh = b.maxY - b.minY + 160
    const k = clamp(Math.min(st.w / bw, st.h / bh), 0.1, 1.5)
    setView({
      k,
      x: st.w / 2 - ((b.minX + b.maxX) / 2) * k,
      y: st.h / 2 - ((b.minY + b.maxY) / 2) * k,
    })
  }

  const centerOnWorld = (p: Pt) =>
    setView({ x: st.w / 2 - p.x * st.view.k, y: st.h / 2 - p.y * st.view.k })
  const viewCenter = (): Pt => ({
    x: (st.w / 2 - st.view.x) / st.view.k,
    y: (st.h / 2 - st.view.y) / st.view.k,
  })

  const animToken = useRef(0)
  const animateTo = (t: { x: number; y: number; k: number }) => {
    const token = ++animToken.current
    const from = { ...st.view }
    const t0 = performance.now()
    const step = (now: number) => {
      if (token !== animToken.current) return
      const p = Math.min(1, (now - t0) / 240)
      const e = 1 - Math.pow(1 - p, 3)
      setView({
        x: from.x + (t.x - from.x) * e,
        y: from.y + (t.y - from.y) * e,
        k: from.k + (t.k - from.k) * e,
      })
      if (p < 1) requestAnimationFrame(step)
    }
    requestAnimationFrame(step)
  }

  const viewForItems = (items: El[], maxK = 1.25) => {
    const b = unionBox(items.map((e) => getBBox(e, st.map)))
    const k = clamp(
      Math.min(st.w / (b.maxX - b.minX + 220), st.h / (b.maxY - b.minY + 260)),
      0.1,
      maxK,
    )
    return {
      k,
      x: st.w / 2 - ((b.minX + b.maxX) / 2) * k,
      y: st.h / 2 - ((b.minY + b.maxY) / 2) * k,
    }
  }

  /** Zoom to a task card and everything linked to it; the rest of the canvas fades back. */
  const enterFocus = (cardId: string) => {
    const card = st.map.get(cardId)
    if (!card || card.type !== 'task') return
    finishEdit()
    if (!st.focusId) st.prevView = { ...st.view }
    st.focusId = cardId
    st.focusSet = computeFocusSet()
    setFocus(cardId)
    setSel(new Set())
    setToolState('select')
    toolRef.current = 'select'
    const items = st.els.filter((e) => e.type !== 'connector' && st.focusSet?.has(e.id))
    animateTo(viewForItems(items))
    requestDraw()
  }

  const exitFocus = () => {
    if (!st.focusId) return
    st.focusId = null
    st.focusSet = null
    setFocus(null)
    if (st.prevView) animateTo(st.prevView)
    st.prevView = null
    requestDraw()
  }

  const focusTask = (taskId: string) => {
    let card = st.els.find((e) => e.type === 'task' && e.taskId === taskId)
    if (!card) {
      addTaskCard(taskId)
      card = st.els.find((e) => e.type === 'task' && e.taskId === taskId)
    }
    if (card) enterFocus(card.id)
  }

  const openOnBoard = (taskId?: string) => {
    bus.emit('nav', 'board')
    if (taskId) window.setTimeout(() => bus.emit('board:focus-task', { taskId }), 60)
  }

  const toWorld = (e: { clientX: number; clientY: number }): Pt => {
    const r = canvasRef.current!.getBoundingClientRect()
    return {
      x: (e.clientX - r.left - st.view.x) / st.view.k,
      y: (e.clientY - r.top - st.view.y) / st.view.k,
    }
  }

  const snap = (v: number) =>
    cfgRef.current.snap ? Math.round(v / cfgRef.current.gridSize) * cfgRef.current.gridSize : v
  const snapPt = (p: Pt): Pt => ({ x: snap(p.x), y: snap(p.y) })

  const setCursor = (c: string) => {
    if (cursorStr.current === c || !canvasRef.current) return
    cursorStr.current = c
    canvasRef.current.style.cursor = c
  }

  const setTool = (t: Tool) => {
    finishEdit()
    setToolState(t)
    toolRef.current = t
    if (t !== 'select') setSel(new Set())
    st.hoverId = null
    setShowTasks(false)
    requestDraw()
  }

  /* ================================================================== */
  /* Text editing                                                        */
  /* ================================================================== */

  const beginEdit = (el: El, isNew: boolean) => {
    editingRef.current = { id: el.id, isNew }
    editTextRef.current = el.text ?? ''
    setEditText(el.text ?? '')
    setEditing({ id: el.id, isNew })
    requestDraw()
  }

  const finishEdit = () => {
    const ed = editingRef.current
    if (!ed) return
    editingRef.current = null
    setEditing(null)
    const text = cleanMultiline(editTextRef.current, LIMITS.canvasText)
    const el = st.preview?.id === ed.id ? st.preview : st.map.get(ed.id)
    if (st.preview?.id === ed.id) st.preview = null
    if (!el) return requestDraw()
    if (ed.isNew) {
      if (text.trim()) {
        const fitted = fitText({ ...el, text })
        const added = withFocus([fitted])
        commit({ added, removed: [], before: [], after: [] })
        opAdd(added)
        setSel(new Set([fitted.id]))
      }
      setToolState('select')
      toolRef.current = 'select'
    } else if (!text.trim()) {
      removeWithLinks([el.id])
    } else if (text !== el.text) {
      const next = fitText({ ...el, text })
      commit({ added: [], removed: [], before: [el], after: [next] })
      opPatch([{ id: el.id, text: next.text, points: next.points }])
    }
    requestDraw()
  }

  const createText = (p: Pt, isNote: boolean) => {
    const s = styleRef.current
    const q = snapPt(p)
    const el: El = {
      id: uid(),
      type: 'text',
      userId: me.id,
      points: [q, { x: q.x + (isNote ? 200 : 260), y: q.y + (isNote ? 160 : 36) }],
      text: '',
      fontSize: isNote ? 15 : 20,
      color: s.color,
      note: isNote ? s.noteColor : undefined,
    }
    st.preview = el
    beginEdit(el, true)
  }

  useEffect(() => {
    if (editing) {
      const t = editorRef.current
      if (t) {
        t.focus()
        t.setSelectionRange(t.value.length, t.value.length)
      }
    }
  }, [editing])

  /* ================================================================== */
  /* Images + task cards                                                 */
  /* ================================================================== */

  const uploadImage = async (file: File): Promise<string> => {
    const path = `${roomId}/${uid()}.${safeExtension(file.name)}`
    const { error } = await supabase.storage
      .from('board-assets')
      .upload(path, file, { contentType: file.type, cacheControl: '31536000' })
    if (!error) return supabase.storage.from('board-assets').getPublicUrl(path).data.publicUrl
    console.warn('[whiteboard] storage upload failed, embedding image instead:', error.message)
    toast(
      'Image storage is not set up, so this image is embedded and may not sync reliably. See the SQL migration.',
    )
    return new Promise<string>((res, rej) => {
      const r = new FileReader()
      r.onload = () => res(r.result as string)
      r.onerror = rej
      r.readAsDataURL(file)
    })
  }

  /** Adds any file: pictures the browser can draw go on the canvas as images, everything else as a file card. */
  const addFile = async (file: File, at?: Pt) => {
    if (file.size > MAX_FILE_BYTES)
      return toast(`"${file.name}" is ${formatBytes(file.size)}. Files must be under 50 MB.`)
    if (file.type.startsWith('image/') && (await addImage(file, at))) return
    let a: Attachment
    try {
      a = await uploadRoomFile(file, roomId)
    } catch (e) {
      return toast(e instanceof Error ? e.message : 'Could not add that file.')
    }
    const c = at ?? viewCenter()
    const el: El = {
      id: uid(),
      type: 'file',
      userId: me.id,
      points: [
        { x: c.x - FILE_CARD.w / 2, y: c.y - FILE_CARD.h / 2 },
        { x: c.x + FILE_CARD.w / 2, y: c.y + FILE_CARD.h / 2 },
      ],
      src: a.url,
      name: a.name,
      mime: a.type,
      size: a.size,
    }
    const added = withFocus([el])
    commit({ added, removed: [], before: [], after: [] })
    opAdd(added)
    setSel(new Set([el.id]))
    setTool('select')
  }

  /** Several files at once (a drop), fanned out a little so they don't stack exactly. */
  const addFiles = (files: File[], at?: Pt) =>
    files.forEach((f, i) => addFile(f, at && { x: at.x + i * 28, y: at.y + i * 28 }))

  /** Returns false (adding nothing) if the browser can't decode this picture, so it becomes a file card instead. */
  const addImage = async (file: File, at?: Pt): Promise<boolean> => {
    const local = URL.createObjectURL(file)
    const dims = await new Promise<{ w: number; h: number } | null>((res) => {
      const img = new Image()
      img.onload = () => res({ w: img.naturalWidth || 400, h: img.naturalHeight || 300 })
      img.onerror = () => res(null)
      img.src = local
    })
    URL.revokeObjectURL(local)
    if (!dims) return false
    const scale = Math.min(1, 420 / dims.w, 420 / dims.h)
    const w = dims.w * scale
    const h = dims.h * scale
    const c = at ?? viewCenter()
    let src: string
    try {
      src = await uploadImage(file)
    } catch {
      toast('Could not add that image.')
      return true
    }
    const el: El = {
      id: uid(),
      type: 'image',
      userId: me.id,
      points: [
        { x: c.x - w / 2, y: c.y - h / 2 },
        { x: c.x + w / 2, y: c.y + h / 2 },
      ],
      src,
      name: cleanLine(file.name, 200),
      mime: file.type,
      size: file.size,
    }
    const added = withFocus([el])
    commit({ added, removed: [], before: [], after: [] })
    opAdd(added)
    setSel(new Set([el.id]))
    setTool('select')
    return true
  }

  const addTaskCard = (taskId: string) => {
    const existing = st.els.find((e) => e.type === 'task' && e.taskId === taskId)
    if (existing) {
      const b = getBBox(existing, st.map)
      centerOnWorld({ x: (b.minX + b.maxX) / 2, y: (b.minY + b.maxY) / 2 })
      setSel(new Set([existing.id]))
      return toast('That task is already on the canvas.')
    }
    const c = viewCenter()
    const n = st.els.filter((e) => e.type === 'task').length % 6
    const el: El = {
      id: uid(),
      type: 'task',
      userId: me.id,
      taskId,
      points: [
        { x: c.x - 130 + n * 24, y: c.y - 46 + n * 24 },
        { x: c.x + 130 + n * 24, y: c.y + 46 + n * 24 },
      ],
    }
    const added = withFocus([el])
    commit({ added, removed: [], before: [], after: [] })
    opAdd(added)
    setSel(new Set([el.id]))
    setToolState('select')
    toolRef.current = 'select'
    setShowTasks(false)
  }

  /* ================================================================== */
  /* Hit testing + pointer handling                                      */
  /* ================================================================== */

  const hitTest = (p: Pt): El | null => {
    const pad = 6 / st.view.k
    const out = (e: El) => !!st.focusSet && !st.focusSet.has(e.id)
    for (let i = st.els.length - 1; i >= 0; i--) {
      const e = st.els[i]
      if (e.type !== 'connector' && !out(e) && pointNear(e, p, pad, st.map)) return e
    }
    for (let i = st.els.length - 1; i >= 0; i--) {
      const e = st.els[i]
      if (e.type === 'connector' && !out(e) && pointNear(e, p, pad, st.map)) return e
    }
    return null
  }

  const handleAt = (p: Pt): string | null => {
    const box = selBox()
    if (!box) return null
    const tol = 12 / st.view.k
    return (
      handlesOf(box).find((h) => Math.abs(p.x - h.x) < tol && Math.abs(p.y - h.y) < tol)?.id ?? null
    )
  }

  const brushCursor = () => {
    const d = clamp(styleRef.current.lineWidth * st.view.k, 6, 96)
    const s = d + 4
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${s}" height="${s}"><circle cx="${s / 2}" cy="${s / 2}" r="${d / 2}" fill="none" stroke="white" stroke-width="2.5"/><circle cx="${s / 2}" cy="${s / 2}" r="${d / 2}" fill="none" stroke="black" stroke-width="1"/></svg>`
    return `url("data:image/svg+xml,${encodeURIComponent(svg)}") ${s / 2} ${s / 2}, crosshair`
  }

  const idleCursor = () => {
    if (st.space) return 'grab'
    const t = toolRef.current
    if (t === 'pen') return brushCursor()
    if (t === 'text' || t === 'note') return 'text'
    if (t === 'shape' || t === 'connect') return 'crosshair'
    return st.hoverHandle
      ? st.hoverHandle === 'nw' || st.hoverHandle === 'se'
        ? 'nwse-resize'
        : 'nesw-resize'
      : st.hoverId
        ? 'pointer'
        : 'default'
  }

  const cancelAct = () => {
    st.act = null
    st.preview = st.preview && editingRef.current?.id === st.preview.id ? st.preview : null
    st.marquee = null
    requestDraw()
  }

  const mkEl = (partial: Partial<El> & Pick<El, 'type' | 'points'>): El => ({
    id: uid(),
    userId: me.id,
    lineWidth: styleRef.current.lineWidth,
    color: styleRef.current.color,
    ...partial,
  })

  const selectDown = (p: Pt, additive: boolean) => {
    const hb = handleAt(p)
    if (hb) {
      const snaps = [...st.sel]
        .map((id) => st.map.get(id))
        .filter((e): e is El => !!e && e.type !== 'connector')
        .map((e) => ({ ...e, points: e.points.map((q) => ({ ...q })) }))
      st.act = { kind: 'resize', handle: hb, start: p, snaps, moved: false }
      return
    }
    const hit = hitTest(p)
    const dragSnaps = () =>
      [...st.sel]
        .map((id) => st.map.get(id))
        .filter((e): e is El => !!e && e.type !== 'connector')
        .map((e) => ({ ...e, points: e.points.map((q) => ({ ...q })) }))
    if (hit) {
      if (additive) {
        const next = new Set(st.sel)
        next.has(hit.id) ? next.delete(hit.id) : next.add(hit.id)
        setSel(next)
      } else if (!st.sel.has(hit.id)) setSel(new Set([hit.id]))
      st.act = { kind: 'drag', start: p, snaps: dragSnaps(), moved: false }
      return
    }
    const box = selBox()
    if (box && st.sel.size > 1 && inBox(p, box)) {
      st.act = { kind: 'drag', start: p, snaps: dragSnaps(), moved: false }
      return
    }
    const base = additive ? new Set(st.sel) : new Set<string>()
    if (!additive) setSel(new Set())
    st.act = { kind: 'marquee', start: p, base }
    st.marquee = { minX: p.x, minY: p.y, maxX: p.x, maxY: p.y }
  }

  const onPointerDown = (e: React.PointerEvent<HTMLCanvasElement>) => {
    animToken.current++
    e.currentTarget.setPointerCapture(e.pointerId)
    pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY })
    if (pointers.current.size === 2) {
      cancelAct()
      return
    }
    finishEdit()
    if (e.button === 1 || e.button === 2 || st.space) {
      st.act = { kind: 'pan', sx: e.clientX, sy: e.clientY, vx: st.view.x, vy: st.view.y }
      setCursor('grabbing')
      return
    }
    if (e.button !== 0) return
    const p = toWorld(e)
    const t = toolRef.current
    if (t === 'select') return selectDown(p, e.shiftKey)
    if (t === 'pen') {
      st.preview = mkEl({ type: 'stroke', points: [p] })
      st.act = { kind: 'draw' }
    } else if (t === 'shape') {
      const q = snapPt(p)
      st.preview = mkEl({
        type: 'shape',
        points: [q, q],
        shapeKind: styleRef.current.shapeKind,
        fill: styleRef.current.shapeFill,
      })
      st.act = { kind: 'draw' }
    } else if (t === 'text' || t === 'note') {
      createText(p, t === 'note')
      e.preventDefault()
    } else if (t === 'connect') {
      const hit = hitTest(p)
      if (hit && hit.type !== 'connector') st.act = { kind: 'connect', from: hit.id, at: p }
    }
    requestDraw()
  }

  const pushLive = (items: (Partial<El> & { id: string })[]) => {
    const now = performance.now()
    if (now - lastLiveSend.current < 40) return
    lastLiveSend.current = now
    send('wb:patch', { items })
  }

  const onPointerMove = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (pointers.current.has(e.pointerId))
      pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY })

    // two-finger pinch + pan
    if (pointers.current.size === 2) {
      const [a, b] = [...pointers.current.values()]
      const d = Math.hypot(a.x - b.x, a.y - b.y)
      const cx = (a.x + b.x) / 2
      const cy = (a.y + b.y) / 2
      const prev = pinch.current
      if (prev && prev.d > 0) {
        zoomAt(d / prev.d, cx, cy)
        setView({ x: st.view.x + (cx - prev.cx), y: st.view.y + (cy - prev.cy) })
      }
      pinch.current = { d, cx, cy }
      return
    }

    const p = toWorld(e)
    const now = performance.now()
    if (now - lastCursorSend.current > 40) {
      lastCursorSend.current = now
      send('wb:cursor', { id: me.id, name: me.name, color: me.color, x: p.x, y: p.y })
    }

    const act = st.act
    if (!act) {
      const t = toolRef.current
      if (t === 'select' || t === 'connect') {
        const hb = t === 'select' ? handleAt(p) : null
        const hit = hb ? null : hitTest(p)
        const nextId = t === 'connect' && hit?.type === 'connector' ? null : (hit?.id ?? null)
        if (hb !== st.hoverHandle || nextId !== st.hoverId) {
          st.hoverHandle = hb
          st.hoverId = nextId
          requestDraw()
        }
      }
      setCursor(idleCursor())
      return
    }

    switch (act.kind) {
      case 'pan':
        setView({ x: act.vx + (e.clientX - act.sx), y: act.vy + (e.clientY - act.sy) })
        break
      case 'draw': {
        const el = st.preview
        if (!el) break
        if (el.type === 'shape') {
          let q = snapPt(p)
          if (e.shiftKey) {
            const s = el.points[0]
            const m = Math.max(Math.abs(q.x - s.x), Math.abs(q.y - s.y))
            q = { x: s.x + Math.sign(q.x - s.x || 1) * m, y: s.y + Math.sign(q.y - s.y || 1) * m }
          }
          st.preview = { ...el, points: [el.points[0], q] }
        } else if (e.shiftKey || e.altKey) {
          const s = el.points[0]
          let q = p
          if (e.shiftKey) {
            const dist = Math.hypot(p.x - s.x, p.y - s.y)
            const ang =
              Math.round(Math.atan2(p.y - s.y, p.x - s.x) / (Math.PI / 12)) * (Math.PI / 12)
            q = { x: s.x + dist * Math.cos(ang), y: s.y + dist * Math.sin(ang) }
          }
          st.preview = { ...el, points: [s, q] }
        } else {
          const last = el.points[el.points.length - 1]
          if (Math.hypot(p.x - last.x, p.y - last.y) * st.view.k >= 1.5)
            st.preview = { ...el, points: [...el.points, p] }
        }
        requestDraw()
        break
      }
      case 'drag': {
        let dx = p.x - act.start.x
        let dy = p.y - act.start.y
        if (!act.moved && Math.hypot(dx, dy) * st.view.k < 3) break
        act.moved = true
        dx = snap(dx)
        dy = snap(dy)
        const moved = new Map(
          act.snaps.map((s) => [s.id, s.points.map((q) => ({ x: q.x + dx, y: q.y + dy }))]),
        )
        setEls(st.els.map((el) => (moved.has(el.id) ? { ...el, points: moved.get(el.id)! } : el)))
        pushLive([...moved].map(([id, points]) => ({ id, points })))
        setCursor('move')
        break
      }
      case 'resize': {
        if (!act.snaps.length) break
        act.moved = true
        const box = unionBox(act.snaps.map((s) => getBBox(s, st.map)))
        const ow = box.maxX - box.minX
        const oh = box.maxY - box.minY
        if (ow < 1 || oh < 1) break
        const dx = p.x - act.start.x
        const dy = p.y - act.start.y
        const hd = act.handle
        let nx0 = hd.includes('w') ? box.minX + dx : box.minX
        let nx1 = hd.includes('e') ? box.maxX + dx : box.maxX
        let ny0 = hd.includes('n') ? box.minY + dy : box.minY
        let ny1 = hd.includes('s') ? box.maxY + dy : box.maxY
        if (act.snaps.length === 1 && act.snaps[0].type === 'image') {
          const ratio = ow / oh
          const lockedH = (nx1 - nx0) / ratio
          if (hd.includes('n')) ny0 = ny1 - lockedH
          else ny1 = ny0 + lockedH
        }
        const nw = nx1 - nx0
        const nh = ny1 - ny0
        if (Math.abs(nw) < 8 || Math.abs(nh) < 8) break
        const m = new Map(
          act.snaps.map((s) => [
            s.id,
            s.points.map((q) => ({
              x: nx0 + ((q.x - box.minX) / ow) * nw,
              y: ny0 + ((q.y - box.minY) / oh) * nh,
            })),
          ]),
        )
        setEls(st.els.map((el) => (m.has(el.id) ? { ...el, points: m.get(el.id)! } : el)))
        pushLive([...m].map(([id, points]) => ({ id, points })))
        break
      }
      case 'marquee': {
        const m = bboxOf(act.start, p)
        st.marquee = m
        const hits = st.els
          .filter(
            (el) =>
              el.type !== 'connector' &&
              (!st.focusSet || st.focusSet.has(el.id)) &&
              intersects(getBBox(el, st.map), m),
          )
          .map((el) => el.id)
        setSel(new Set([...act.base, ...hits]))
        requestDraw()
        break
      }
      case 'connect': {
        act.at = p
        const hit = hitTest(p)
        const next = hit && hit.type !== 'connector' && hit.id !== act.from ? hit.id : null
        if (next !== st.hoverId) st.hoverId = next
        requestDraw()
        break
      }
    }
  }

  const onPointerUp = (e: React.PointerEvent<HTMLCanvasElement>) => {
    pointers.current.delete(e.pointerId)
    if (pointers.current.size < 2) pinch.current = null
    const act = st.act
    st.act = null
    if (!act) return
    switch (act.kind) {
      case 'pan':
        setCursor(idleCursor())
        break
      case 'draw': {
        const el = st.preview
        st.preview = null
        if (!el) break
        const tiny =
          el.type === 'shape' &&
          Math.hypot(el.points[1].x - el.points[0].x, el.points[1].y - el.points[0].y) < 4
        if (!tiny) {
          const added = withFocus([el])
          commit({ added, removed: [], before: [], after: [] })
          opAdd(added)
          if (el.type === 'shape') {
            setSel(new Set([el.id]))
            setToolState('select')
            toolRef.current = 'select'
          }
        }
        break
      }
      case 'drag':
      case 'resize': {
        if (act.moved) {
          const ids = act.snaps.map((s) => s.id)
          const after = ids.map((id) => st.map.get(id)).filter((x): x is El => !!x)
          commit({ added: [], removed: [], before: act.snaps, after: after.map((a) => ({ ...a })) })
          opPatch(after.map((a) => ({ id: a.id, points: a.points })))
        }
        break
      }
      case 'marquee':
        if (
          st.marquee &&
          st.marquee.maxX - st.marquee.minX < 4 / st.view.k &&
          st.marquee.maxY - st.marquee.minY < 4 / st.view.k
        )
          setSel(act.base)
        st.marquee = null
        break
      case 'connect': {
        const hit = hitTest(toWorld(e))
        if (hit && hit.type !== 'connector' && hit.id !== act.from) {
          const dupe = st.els.some(
            (x) =>
              x.type === 'connector' &&
              ((x.from === act.from && x.to === hit.id) ||
                (x.from === hit.id && x.to === act.from)),
          )
          if (!dupe) {
            const link: El = {
              id: uid(),
              type: 'connector',
              userId: me.id,
              points: [],
              from: act.from,
              to: hit.id,
              lineWidth: 2,
            }
            commit({ added: [link], removed: [], before: [], after: [] })
            opAdd([link])
          }
        }
        st.hoverId = null
        break
      }
    }
    requestDraw()
  }

  const onDoubleClick = (e: React.MouseEvent<HTMLCanvasElement>) => {
    if (toolRef.current !== 'select') return
    const p = toWorld(e)
    const hit = hitTest(p)
    if (!hit) return createText(p, false)
    if (hit.type === 'text') beginEdit(hit, false)
    else if (hit.type === 'task') {
      const file = taskFileAt(hit, getBBox(hit, st.map), p)
      if (file) setViewing(file)
      else enterFocus(hit.id)
    } else if ((hit.type === 'file' || hit.type === 'image') && hit.src)
      setViewing({ files: [toAttachment(hit)], index: 0 })
  }

  /* ================================================================== */
  /* Effects                                                             */
  /* ================================================================== */

  // Keep latest handlers reachable from long-lived listeners.
  api.current = {
    undo,
    redo,
    deleteSelection,
    duplicateSelection,
    addFile,
    addTaskCard,
    setTool,
    fitContent,
    createText,
    viewCenter,
    enterFocus,
    exitFocus,
    focusTask,
  }

  // canvas sizing
  useEffect(() => {
    const wrap = wrapRef.current!
    const canvas = canvasRef.current!
    const ro = new ResizeObserver(() => {
      const r = wrap.getBoundingClientRect()
      const dpr = window.devicePixelRatio || 1
      st.w = r.width
      st.h = r.height
      st.dpr = dpr
      canvas.width = Math.max(1, Math.round(r.width * dpr))
      canvas.height = Math.max(1, Math.round(r.height * dpr))
      requestDraw()
    })
    ro.observe(wrap)
    return () => {
      ro.disconnect()
      cancelAnimationFrame(rafRef.current)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => {
    requestDraw()
  }, [
    cfg,
    theme,
    active,
    tool,
    taskData.byId,
    taskData.statusOpt,
    taskData.urgencyOpt,
    requestDraw,
  ])

  // wheel: pan, ctrl/cmd (and trackpad pinch) zoom
  useEffect(() => {
    const canvas = canvasRef.current!
    const onWheel = (e: WheelEvent) => {
      e.preventDefault()
      animToken.current++
      if (e.ctrlKey || e.metaKey) {
        const mag = Math.min(Math.abs(e.deltaY) / 200, 0.5) + 1
        zoomAt(e.deltaY < 0 ? mag : 1 / mag, e.clientX, e.clientY)
      } else setView({ x: st.view.x - e.deltaX, y: st.view.y - e.deltaY })
    }
    canvas.addEventListener('wheel', onWheel, { passive: false })
    return () => canvas.removeEventListener('wheel', onWheel)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // load + realtime
  useEffect(() => {
    let cancelled = false
    st.linkSig = ''
    setLinkCounts(new Map())
    const load = async () => {
      const rows: any[] = []
      for (let from = 0; ; from += 1000) {
        const { data, error } = await supabase
          .from('strokes')
          .select('data')
          .eq('room_id', roomId)
          .order('created_at')
          .range(from, from + 999)
        if (error || !data) break
        rows.push(...data)
        if (data.length < 1000) break
      }
      if (!cancelled) setEls(rows.map((r) => normalize(r.data)))
    }
    load()

    const offs = [
      on('wb:add', ({ items }: { items: any[] }) => {
        const incoming = items.map(normalize)
        const ids = new Set(incoming.map((i) => i.id))
        setEls([...st.els.filter((e) => !ids.has(e.id)), ...incoming])
      }),
      on('wb:patch', ({ items }: { items: any[] }) => {
        const m = new Map(items.map((i) => [i.id, i]))
        setEls(st.els.map((e) => (m.has(e.id) ? normalize({ ...e, ...m.get(e.id) }) : e)))
      }),
      on('wb:remove', ({ ids }: { ids: string[] }) => {
        const s = new Set(ids)
        setEls(st.els.filter((e) => !s.has(e.id)))
        setSel(new Set([...st.sel].filter((id) => !s.has(id))))
      }),
      on('wb:clear', () => {
        setEls([])
        setSel(new Set())
      }),
      on('wb:cursor', (c: { id: string; name: string; color: string; x: number; y: number }) => {
        st.cursors.set(c.id, { name: c.name, color: c.color, x: c.x, y: c.y, t: Date.now() })
        requestDraw()
      }),
    ]
    return () => {
      cancelled = true
      offs.forEach((off) => off())
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [roomId, on])

  // resync after a dropped connection
  const prevStatus = useRef(status)
  useEffect(() => {
    if (prevStatus.current === 'offline' && status === 'live') {
      supabase
        .from('strokes')
        .select('data')
        .eq('room_id', roomId)
        .order('created_at')
        .then(({ data }) => data && setEls(data.map((r) => normalize(r.data))))
    }
    prevStatus.current = status
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [status])

  // cross-view events + Electron menu
  useEffect(() => {
    const offAdd = bus.on('canvas:add-task', ({ taskId }: { taskId: string }) =>
      api.current.addTaskCard(taskId),
    )
    const offHist = bus.on(
      'history',
      (dir: 'undo' | 'redo') => activeRef.current && api.current[dir](),
    )
    const offFocus = bus.on('canvas:focus-task', ({ taskId }: { taskId: string }) =>
      api.current.focusTask(taskId),
    )
    return () => {
      offAdd()
      offHist()
      offFocus()
    }
  }, [])

  // keyboard
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      // The file viewer handles its own keys; Delete there mustn't remove the selected item.
      if (!activeRef.current || viewingRef.current) return
      const typing = isTyping(e)
      const mod = e.metaKey || e.ctrlKey
      if (e.key === 'Escape') {
        if (editingRef.current) return
        if (st.focusId && !st.sel.size && toolRef.current === 'select' && !st.act) {
          api.current.exitFocus()
          return
        }
        setSel(new Set())
        setShowSettings(false)
        setShowTasks(false)
        if (st.act?.kind === 'connect') st.act = null
        api.current.setTool('select')
        return
      }
      if (typing) return
      if (e.key === ' ') {
        e.preventDefault()
        if (!st.space) {
          st.space = true
          setCursor('grab')
        }
        return
      }
      if (e.key === 'Delete' || e.key === 'Backspace') {
        if (st.sel.size) {
          e.preventDefault()
          api.current.deleteSelection()
        }
        return
      }
      if (e.key === 'Enter' && st.sel.size === 1) {
        const only = st.map.get([...st.sel][0])
        if (only?.type === 'task') {
          e.preventDefault()
          api.current.enterFocus(only.id)
          return
        }
      }
      if (mod) {
        const key = e.key.toLowerCase()
        if (key === 'z') {
          e.preventDefault()
          e.shiftKey ? api.current.redo() : api.current.undo()
        } else if (key === 'y') {
          e.preventDefault()
          api.current.redo()
        } else if (key === 'd') {
          e.preventDefault()
          api.current.duplicateSelection()
        } else if (key === 'a') {
          e.preventDefault()
          setSel(
            new Set(
              st.els
                .filter((x) => x.type !== 'connector' && (!st.focusSet || st.focusSet.has(x.id)))
                .map((x) => x.id),
            ),
          )
        }
        return
      }
      if (e.altKey) return
      const tools: Record<string, Tool> = {
        v: 'select',
        p: 'pen',
        s: 'shape',
        t: 'text',
        n: 'note',
        c: 'connect',
      }
      const k = e.key.toLowerCase()
      if (tools[k]) api.current.setTool(tools[k])
      else if (k === 'i') fileInputRef.current?.click()
      else if (k === 'k') setShowTasks((v) => !v)
      else if (k === 'f') api.current.fitContent()
    }
    const onKeyUp = (e: KeyboardEvent) => {
      if (e.key === ' ' && st.space) {
        st.space = false
        setCursor(idleCursor())
      }
    }
    const onPaste = (e: ClipboardEvent) => {
      if (!activeRef.current || isTyping(e)) return
      const files = [...(e.clipboardData?.files ?? [])]
      if (files.length) {
        e.preventDefault()
        files.forEach((f) => api.current.addFile(f))
        return
      }
      const text = e.clipboardData?.getData('text/plain')
      if (text?.trim()) {
        e.preventDefault()
        const c = api.current.viewCenter()
        const el: El = {
          id: uid(),
          type: 'text',
          userId: me.id,
          points: [c, { x: c.x + 320, y: c.y + 40 }],
          text: cleanMultiline(text, LIMITS.canvasText),
          fontSize: 18,
          color: styleRef.current.color,
        }
        const fitted = fitText(el)
        const added = withFocus([fitted])
        commit({ added, removed: [], before: [], after: [] })
        opAdd(added)
        setSel(new Set([fitted.id]))
      }
    }
    window.addEventListener('keydown', onKeyDown)
    window.addEventListener('keyup', onKeyUp)
    window.addEventListener('paste', onPaste)
    return () => {
      window.removeEventListener('keydown', onKeyDown)
      window.removeEventListener('keyup', onKeyUp)
      window.removeEventListener('paste', onPaste)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => setCursor(idleCursor()), [tool, lineWidth, zoomPct]) // eslint-disable-line react-hooks/exhaustive-deps

  /* ================================================================== */
  /* Render                                                              */
  /* ================================================================== */

  const clearCanvas = async () => {
    if (!isOwner || !st.els.length) return
    if (!window.confirm('Clear the whole canvas for everyone in this room?')) return
    try {
      await clearRoomCanvas(roomId)
    } catch (e) {
      toast(e instanceof Error ? e.message : 'Could not clear the canvas.')
      return
    }
    commit({ added: [], removed: [...st.els], before: [], after: [] })
    setEls([])
    setSel(new Set())
    send('wb:clear', {})
  }

  const selEls = selIds.map((id) => st.map.get(id)).filter((e): e is El => !!e)
  const hasStroke = selEls.some((e) => ['stroke', 'shape', 'connector'].includes(e.type))
  const hasText = selEls.some((e) => e.type === 'text')
  const hasNote = selEls.some((e) => e.type === 'text' && e.note)
  const showWidth = tool === 'pen' || tool === 'shape' || hasStroke
  const showFont = tool === 'text' || hasText
  const showNotes = tool === 'note' || hasNote
  const showProps =
    tool === 'pen' ||
    tool === 'shape' ||
    tool === 'text' ||
    tool === 'note' ||
    selEls.some((e) => e.type !== 'task' && e.type !== 'image' && e.type !== 'file')
  const ink = PAL[theme].ink
  const pickerColor = resolveColor(color, ink)

  const edEl = editing
    ? st.preview?.id === editing.id
      ? st.preview
      : st.map.get(editing.id)
    : null
  const edBox = edEl ? getBBox(edEl, st.map) : null

  const filteredTasks = taskData.list.filter((t) =>
    t.title.toLowerCase().includes(taskQuery.trim().toLowerCase()),
  )
  const ShapeIcon = shapeIcons[shapeKind]
  const singleFile =
    selEls.length === 1 && (selEls[0].type === 'file' || selEls[0].type === 'image') && selEls[0].src
      ? toAttachment(selEls[0])
      : null
  const singleTask =
    selEls.length === 1 && selEls[0].type === 'task' && selEls[0].id !== focus ? selEls[0] : null
  const singleTaskFiles = singleTask?.taskId ? (taskData.byId.get(singleTask.taskId)?.files ?? []) : []
  const focusCard = focus ? st.map.get(focus) : undefined
  const focusTaskInfo = focusCard?.taskId ? taskData.byId.get(focusCard.taskId) : undefined
  const focusLinked = st.focusSet
    ? [...st.focusSet].filter((id) => id !== focus && st.map.get(id)?.type !== 'connector').length
    : 0

  const chooseColor = (c: string) => {
    setColor(c)
    if (st.sel.size) applyStyle({ color: c }, 'color')
  }

  return (
    <div
      ref={wrapRef}
      className="absolute inset-0 select-none overflow-hidden"
      onDragOver={(e) => {
        e.preventDefault()
        setIsDragOver(true)
      }}
      onDragLeave={() => setIsDragOver(false)}
      onDrop={(e) => {
        e.preventDefault()
        setIsDragOver(false)
        const files = [...e.dataTransfer.files]
        if (files.length) addFiles(files, toWorld(e))
      }}
    >
      <input
        ref={fileInputRef}
        type="file"
        multiple
        className="hidden"
        onChange={(e) => {
          addFiles([...(e.target.files ?? [])])
          e.target.value = ''
        }}
      />

      <canvas
        ref={canvasRef}
        className="absolute inset-0 h-full w-full"
        style={{ touchAction: 'none' }}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
        onPointerLeave={() => {
          if (!st.act && (st.hoverId || st.hoverHandle)) {
            st.hoverId = null
            st.hoverHandle = null
            requestDraw()
          }
        }}
        onDoubleClick={onDoubleClick}
        onContextMenu={(e) => e.preventDefault()}
      />

      {/* inline text editor */}
      {edEl && edBox && (
        <textarea
          ref={editorRef}
          value={editText}
          spellCheck={false}
          placeholder={edEl.note ? 'Type a note' : 'Type'}
          onChange={(e) => {
            setEditText(e.target.value)
            editTextRef.current = e.target.value
          }}
          onBlur={() => finishEdit()}
          onKeyDown={(e) => {
            e.stopPropagation()
            if (e.key === 'Escape' || (e.key === 'Enter' && (e.metaKey || e.ctrlKey))) {
              e.preventDefault()
              finishEdit()
            }
          }}
          className="absolute m-0 resize-none border-0 bg-transparent outline-none"
          style={{
            left: edBox.minX * st.view.k + st.view.x,
            top: edBox.minY * st.view.k + st.view.y,
            width: (edBox.maxX - edBox.minX) * st.view.k,
            height: Math.max(edBox.maxY - edBox.minY, 36) * st.view.k,
            padding: (edEl.note ? 12 : 6) * st.view.k,
            fontSize: (edEl.fontSize ?? 18) * st.view.k,
            lineHeight: 1.35,
            fontFamily: FONT,
            color: edEl.note ? noteInk : resolveColor(edEl.color, ink),
            boxShadow: edEl.note ? undefined : `0 0 0 1.5px ${PAL[theme].accent}`,
            borderRadius: 6,
            zIndex: 15,
          }}
        />
      )}

      {isDragOver && (
        <div
          className="pointer-events-none absolute inset-3 z-40 flex items-center justify-center rounded-2xl border-2 border-dashed"
          style={{ borderColor: 'var(--dv-accent)', background: 'var(--dv-accent-soft)' }}
        >
          <div className="dv-floating flex items-center gap-2 px-5 py-3 text-sm font-medium">
            <ImageIcon size={18} />
            Drop to add files
          </div>
        </div>
      )}

      {count === 0 && !editing && (
        <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
          <div
            className="max-w-sm text-center text-[13px] leading-relaxed"
            style={{ color: 'var(--dv-muted)' }}
          >
            <p className="mb-1 text-[15px] font-semibold" style={{ color: 'var(--dv-text)' }}>
              Empty canvas
            </p>
            Double-click to write, drag in images or paste a screenshot. Press{' '}
            <span className="dv-kbd">K</span> to pull in a task from the board, then link things
            with the arrow tool (<span className="dv-kbd">C</span>).
          </div>
        </div>
      )}

      {/* focus mode banner */}
      {focus && (
        <div className="absolute left-1/2 top-4 z-20 -translate-x-1/2">
          <div className="dv-floating flex items-center gap-3 py-1.5 pl-4 pr-1.5">
            <Crosshair size={15} style={{ color: 'var(--dv-accent)' }} />
            <div className="flex min-w-0 flex-col leading-tight">
              <span className="max-w-[300px] truncate text-[13px] font-semibold">
                {focusTaskInfo?.title ?? 'Task'}
              </span>
              <span className="text-[11px]" style={{ color: 'var(--dv-muted)' }}>
                Focus mode · {focusLinked} item{focusLinked === 1 ? '' : 's'} in context · new items
                link here automatically
              </span>
            </div>
            <button
              className="dv-btn"
              onClick={() => openOnBoard(focusCard?.taskId)}
              title="Show this task on the board"
            >
              <Kanban size={14} />
              Board
            </button>
            <button
              className="dv-btn primary"
              onClick={exitFocus}
              title="Back to the full canvas (Esc)"
            >
              <X size={14} />
              Show all
            </button>
          </div>
        </div>
      )}

      {singleFile && (
        <div className="dv-floating absolute left-4 top-1/2 z-20 flex w-[196px] -translate-y-1/2 flex-col gap-2 p-3.5">
          <span className="dv-label truncate" title={singleFile.name}>
            {singleFile.name}
          </span>
          <button className="dv-btn primary justify-center" onClick={() => setViewing({ files: [singleFile], index: 0 })}>
            <Eye size={14} />
            Open
          </button>
          <a
            className="dv-btn justify-center"
            href={downloadHref(singleFile)}
            download={singleFile.name}
          >
            <Download size={14} />
            Download
          </a>
        </div>
      )}

      {viewing && (
        <FileViewer
          files={viewing.files}
          index={viewing.index}
          onIndex={(index) => setViewing((v) => v && { ...v, index })}
          onClose={() => setViewing(null)}
        />
      )}

      {singleTask && (
        <div className="dv-floating absolute left-4 top-1/2 z-20 flex w-[196px] -translate-y-1/2 flex-col gap-2 p-3.5">
          <span className="dv-label">Task card</span>
          <button
            className="dv-btn primary justify-center"
            onClick={() => enterFocus(singleTask.id)}
          >
            <Crosshair size={14} />
            Focus
            <span
              className="dv-kbd"
              style={{ background: 'transparent', color: 'inherit', borderColor: 'currentColor' }}
            >
              Enter
            </span>
          </button>
          <button className="dv-btn justify-center" onClick={() => openOnBoard(singleTask.taskId)}>
            <Kanban size={14} />
            Open on board
          </button>
          {singleTaskFiles.length > 0 && (
            <>
              <span className="dv-label mt-1.5">Files</span>
              <div className="dv-scroll flex max-h-48 flex-col gap-1 overflow-y-auto">
                {singleTaskFiles.map((f, i) => (
                  <FileChip
                    key={f.url}
                    file={f}
                    onClick={() => setViewing({ files: singleTaskFiles, index: i })}
                  />
                ))}
              </div>
            </>
          )}
        </div>
      )}

      {/* properties */}
      {showProps && (
        <div className="dv-floating absolute left-4 top-1/2 z-20 flex w-[196px] -translate-y-1/2 flex-col gap-3.5 p-3.5">
          {showWidth && (
            <div className="flex flex-col gap-1.5">
              <span className="dv-label">Line width</span>
              <div className="flex items-center gap-2">
                <Minus
                  size={12}
                  className="cursor-pointer"
                  style={{ color: 'var(--dv-muted)' }}
                  onClick={() => {
                    const v = clamp(lineWidth - 1, 1, 50)
                    setLineWidth(v)
                    applyStyle({ lineWidth: v }, 'lw')
                  }}
                />
                <input
                  type="range"
                  min={1}
                  max={50}
                  value={lineWidth}
                  className="flex-1"
                  style={{ accentColor: 'var(--dv-accent)' }}
                  onChange={(e) => {
                    const v = parseInt(e.target.value)
                    setLineWidth(v)
                    applyStyle({ lineWidth: v }, 'lw')
                  }}
                />
                <Plus
                  size={12}
                  className="cursor-pointer"
                  style={{ color: 'var(--dv-muted)' }}
                  onClick={() => {
                    const v = clamp(lineWidth + 1, 1, 50)
                    setLineWidth(v)
                    applyStyle({ lineWidth: v }, 'lw')
                  }}
                />
                <span
                  className="w-5 text-right text-xs tabular-nums"
                  style={{ color: 'var(--dv-muted)' }}
                >
                  {lineWidth}
                </span>
              </div>
            </div>
          )}
          {showFont && (
            <div className="flex flex-col gap-1.5">
              <span className="dv-label">Text size</span>
              <input
                type="range"
                min={12}
                max={72}
                defaultValue={20}
                style={{ accentColor: 'var(--dv-accent)' }}
                onChange={(e) => {
                  const fs = parseInt(e.target.value)
                  applyStyle({ fontSize: fs }, 'fs')
                  for (const el of st.els.filter((x) => st.sel.has(x.id) && x.type === 'text'))
                    opPatch([{ id: el.id, points: fitText(st.map.get(el.id)!).points }])
                }}
              />
            </div>
          )}
          {showNotes && (
            <div className="flex flex-col gap-1.5">
              <span className="dv-label">Note color</span>
              <div className="flex flex-wrap gap-1.5">
                {NOTE_COLORS.map((c) => (
                  <button
                    key={c}
                    aria-label={`Note color ${c}`}
                    className="h-5 w-5 rounded-md"
                    style={{
                      background: c,
                      outline:
                        noteColor === c
                          ? '2px solid var(--dv-accent)'
                          : '1px solid rgba(0,0,0,.18)',
                      outlineOffset: noteColor === c ? 1 : 0,
                    }}
                    onClick={() => {
                      setNoteColor(c)
                      applyStyle({ note: c }, 'note')
                    }}
                  />
                ))}
              </div>
            </div>
          )}
          {tool !== 'note' && (
            <div className="flex flex-col gap-1.5">
              <span className="dv-label">Color</span>
              <div className="grid grid-cols-5 gap-1.5">
                {SWATCHES.map((c) => (
                  <button
                    key={c}
                    aria-label={c === 'auto' ? 'Theme ink' : `Color ${c}`}
                    title={c === 'auto' ? 'Theme ink (adapts to light and dark)' : c}
                    className="h-6 w-6 rounded-md"
                    style={{
                      background:
                        c === 'auto' ? 'linear-gradient(135deg, #15171c 50%, #f4f5f7 50%)' : c,
                      outline:
                        color === c
                          ? '2px solid var(--dv-accent)'
                          : '1px solid rgba(128,128,128,.4)',
                      outlineOffset: color === c ? 1 : 0,
                    }}
                    onClick={() => chooseColor(c)}
                  />
                ))}
              </div>
              <button
                className="dv-btn mt-1 justify-center"
                onClick={() => setShowPicker((v) => !v)}
              >
                {showPicker ? 'Hide picker' : 'Custom color'}
              </button>
              {showPicker && (
                <HexColorPicker
                  color={pickerColor}
                  onChange={chooseColor}
                  style={{ width: '100%', height: 110 }}
                />
              )}
            </div>
          )}
        </div>
      )}

      {/* toolbar */}
      <div className="absolute bottom-5 left-1/2 z-20 -translate-x-1/2">
        <div className="dv-floating relative flex items-center gap-0.5 p-1.5">
          <ToolBtn
            icon={<MousePointer2 size={16} />}
            label="Select"
            kbd="V"
            active={tool === 'select'}
            onClick={() => setTool('select')}
          />
          <ToolBtn
            icon={<Pen size={16} />}
            label="Pen"
            kbd="P"
            active={tool === 'pen'}
            onClick={() => setTool('pen')}
          />
          <ToolBtn
            icon={<ShapeIcon size={16} />}
            label="Shape"
            kbd="S"
            active={tool === 'shape'}
            onClick={() => setTool('shape')}
          />
          <ToolBtn
            icon={<Type size={16} />}
            label="Text"
            kbd="T"
            active={tool === 'text'}
            onClick={() => setTool('text')}
          />
          <ToolBtn
            icon={<StickyNote size={16} />}
            label="Sticky note"
            kbd="N"
            active={tool === 'note'}
            onClick={() => setTool('note')}
          />
          <ToolBtn
            icon={<ArrowUpRight size={16} />}
            label="Link two items"
            kbd="C"
            active={tool === 'connect'}
            onClick={() => setTool('connect')}
          />
          <ToolBtn
            icon={<ImageIcon size={16} />}
            label="Add image or file"
            kbd="I"
            onClick={() => fileInputRef.current?.click()}
          />
          <ToolBtn
            icon={<ListTodo size={16} />}
            label="Add a task from the board"
            kbd="K"
            active={showTasks}
            onClick={() => setShowTasks((v) => !v)}
          />
          <div className="dv-sep" />
          <ToolBtn
            icon={<Undo2 size={16} />}
            label="Undo"
            kbd="Ctrl Z"
            disabled={!canUndo}
            onClick={undo}
          />
          <ToolBtn
            icon={<Redo2 size={16} />}
            label="Redo"
            kbd="Ctrl Shift Z"
            disabled={!canRedo}
            onClick={redo}
          />
          {isOwner && (
            <>
              <div className="dv-sep" />
              <ToolBtn
                icon={<Trash2 size={16} />}
                label="Clear canvas"
                danger
                onClick={clearCanvas}
              />
            </>
          )}

          {tool === 'shape' && (
            <div className="dv-floating absolute bottom-full left-1/2 mb-2 flex -translate-x-1/2 flex-col gap-2 p-2.5">
              <div className="flex gap-1">
                {(Object.keys(shapeIcons) as ShapeKind[]).map((kind) => {
                  const Icon = shapeIcons[kind]
                  return (
                    <ToolBtn
                      key={kind}
                      icon={<Icon size={16} />}
                      label={kind[0].toUpperCase() + kind.slice(1)}
                      active={shapeKind === kind}
                      onClick={() => setShapeKind(kind)}
                    />
                  )
                })}
              </div>
              <div className="dv-seg">
                {(['outline', 'fill'] as const).map((m) => (
                  <button
                    key={m}
                    data-active={shapeFill === m}
                    className="flex-1 justify-center capitalize"
                    onClick={() => setShapeFill(m)}
                  >
                    {m}
                  </button>
                ))}
              </div>
            </div>
          )}

          {showTasks && (
            <div className="dv-floating absolute bottom-full left-1/2 mb-2 flex w-[300px] -translate-x-1/2 flex-col gap-2 p-2.5">
              <input
                autoFocus
                className="dv-input"
                placeholder="Find a task"
                value={taskQuery}
                onChange={(e) => setTaskQuery(e.target.value)}
                onKeyDown={(e) =>
                  e.key === 'Enter' && filteredTasks[0] && addTaskCard(filteredTasks[0].id)
                }
              />
              <div className="dv-scroll flex max-h-64 flex-col overflow-y-auto">
                {filteredTasks.length === 0 && (
                  <p className="px-2 py-4 text-center text-xs" style={{ color: 'var(--dv-muted)' }}>
                    {taskData.list.length === 0
                      ? 'No tasks yet. Add some on the board.'
                      : 'No matches'}
                  </p>
                )}
                {filteredTasks.map((t) => {
                  const s = taskData.statusOpt(t.status)
                  return (
                    <button key={t.id} className="dv-menu-item" onClick={() => addTaskCard(t.id)}>
                      <span className="dv-dot" style={{ background: s.color }} />
                      <span className="flex-1 truncate">{t.title}</span>
                    </button>
                  )
                })}
              </div>
            </div>
          )}
        </div>
      </div>

      {/* zoom */}
      <div className="absolute bottom-5 left-5 z-20">
        <div className="dv-floating flex items-center gap-0.5 p-1.5">
          <ToolBtn
            icon={<Minus size={15} />}
            label="Zoom out"
            onClick={() => zoomCenter(1 / 1.25)}
          />
          <button
            className="dv-btn !border-0 !bg-transparent tabular-nums"
            style={{ width: 54, justifyContent: 'center' }}
            title="Reset zoom"
            onClick={() => {
              const k0 = st.view.k
              zoomCenter(1 / k0)
            }}
          >
            {zoomPct}%
          </button>
          <ToolBtn icon={<Plus size={15} />} label="Zoom in" onClick={() => zoomCenter(1.25)} />
          <div className="dv-sep" />
          <ToolBtn
            icon={<Maximize size={15} />}
            label="Fit to content"
            kbd="F"
            onClick={fitContent}
          />
        </div>
      </div>

      {/* settings */}
      <div className="absolute bottom-5 right-5 z-20">
        <ToolBtn
          icon={<Settings size={16} />}
          label="Canvas settings"
          active={showSettings}
          onClick={() => setShowSettings((v) => !v)}
        />
        {showSettings && (
          <>
            <div className="fixed inset-0 z-40" onPointerDown={() => setShowSettings(false)} />
            <div className="dv-floating absolute bottom-full right-0 z-50 mb-2 flex w-72 flex-col gap-4 p-4">
              <div className="flex flex-col gap-2">
                <span className="dv-label">Background</span>
                <div className="dv-seg">
                  {(['theme', 'custom'] as const).map((m) => (
                    <button
                      key={m}
                      data-active={cfg.bg === m}
                      className="flex-1 justify-center capitalize"
                      onClick={() => setCfg({ ...cfg, bg: m })}
                    >
                      {m === 'theme' ? 'Match theme' : 'Custom'}
                    </button>
                  ))}
                </div>
                {cfg.bg === 'custom' && (
                  <input
                    type="color"
                    value={cfg.customBg}
                    onChange={(e) => setCfg({ ...cfg, customBg: e.target.value })}
                    className="h-8 w-full cursor-pointer rounded border-0 bg-transparent"
                  />
                )}
              </div>
              <div className="flex flex-col gap-2">
                <span className="dv-label">Grid</span>
                <div className="dv-seg">
                  {(['none', 'dots', 'lines'] as const).map((g) => (
                    <button
                      key={g}
                      data-active={cfg.grid === g}
                      className="flex-1 justify-center capitalize"
                      onClick={() => setCfg({ ...cfg, grid: g })}
                    >
                      {g}
                    </button>
                  ))}
                </div>
                <div
                  className="flex items-center gap-2 text-xs"
                  style={{ color: 'var(--dv-muted)' }}
                >
                  Spacing
                  <input
                    type="range"
                    min={10}
                    max={120}
                    value={cfg.gridSize}
                    className="flex-1"
                    style={{ accentColor: 'var(--dv-accent)' }}
                    onChange={(e) => setCfg({ ...cfg, gridSize: parseInt(e.target.value) })}
                  />
                  <span className="w-9 text-right tabular-nums">{cfg.gridSize}px</span>
                </div>
                <label className="flex cursor-pointer items-center justify-between text-[13px]">
                  Snap to grid
                  <input
                    type="checkbox"
                    checked={cfg.snap}
                    style={{ accentColor: 'var(--dv-accent)' }}
                    onChange={(e) => setCfg({ ...cfg, snap: e.target.checked })}
                  />
                </label>
              </div>
              <p className="text-[11px] leading-relaxed" style={{ color: 'var(--dv-muted)' }}>
                Space + drag or right-drag to pan. Ctrl/Cmd + scroll to zoom. Shift constrains lines
                and shapes. Ctrl/Cmd + D duplicates.
              </p>
            </div>
          </>
        )}
      </div>
    </div>
  )
}
