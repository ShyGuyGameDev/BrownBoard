import { cleanHexColor } from './sanitize'

const SAMPLE_PX = 32
const HUE_BINS = 36

const hex = (n: number) => Math.round(n).toString(16).padStart(2, '0')

/** h in degrees, s and l from 0 to 1. */
export const hslToHex = (h: number, s: number, l: number) => {
  const a = s * Math.min(l, 1 - l)
  const channel = (n: number) => {
    const k = (n + h / 30) % 12
    return 255 * (l - a * Math.max(-1, Math.min(k - 3, 9 - k, 1)))
  }
  return `#${hex(channel(0))}${hex(channel(8))}${hex(channel(4))}`
}

const rgbToHsl = (r: number, g: number, b: number) => {
  const [rn, gn, bn] = [r / 255, g / 255, b / 255]
  const max = Math.max(rn, gn, bn)
  const min = Math.min(rn, gn, bn)
  const d = max - min
  const l = (max + min) / 2
  if (d === 0) return { h: 0, s: 0, l }
  const s = d / (1 - Math.abs(2 * l - 1))
  const sector =
    max === rn ? ((gn - bn) / d + 6) % 6 : max === gn ? (bn - rn) / d + 2 : (rn - gn) / d + 4
  return { h: sector * 60, s, l }
}

/**
 * The main colour of an image's RGBA pixels: the hue covering the most of it, counting vivid pixels
 * for more so a plain backdrop doesn't win. Its lightness is kept in a range that shows up as an
 * outline, and an image with no real colour gives a mid grey. Null if every pixel is transparent.
 */
export const primaryColor = (pixels: Uint8ClampedArray): string | null => {
  const bins = Array.from({ length: HUE_BINS }, () => ({ weight: 0, r: 0, g: 0, b: 0 }))
  let visible = 0
  for (let i = 0; i < pixels.length; i += 4) {
    if (pixels[i + 3] < 128) continue
    visible++
    const [r, g, b] = [pixels[i], pixels[i + 1], pixels[i + 2]]
    const { h, s, l } = rgbToHsl(r, g, b)
    // Near-black, near-white and grey pixels have no hue worth speaking of.
    if (s < 0.2 || l < 0.1 || l > 0.92) continue
    const bin = bins[Math.floor(h / (360 / HUE_BINS)) % HUE_BINS]
    bin.weight += s
    bin.r += r * s
    bin.g += g * s
    bin.b += b * s
  }
  if (!visible) return null
  const top = bins.reduce((best, bin) => (bin.weight > best.weight ? bin : best))
  if (!top.weight) return hslToHex(0, 0, 0.6)
  const { h, s, l } = rgbToHsl(top.r / top.weight, top.g / top.weight, top.b / top.weight)
  return hslToHex(h, Math.max(s, 0.45), Math.min(Math.max(l, 0.45), 0.65))
}

/** The main colour of a profile picture, or null if it has none (fully transparent). */
export async function imagePrimaryColor(url: string): Promise<string | null> {
  // Fetched rather than loaded into an <img>: the avatar's own cached copy has no CORS headers,
  // which would stop the canvas being read.
  const response = await fetch(url, { cache: 'no-cache' })
  if (!response.ok) throw new Error(`Picture request failed: ${response.status}`)
  const bitmap = await createImageBitmap(await response.blob())
  const canvas = document.createElement('canvas')
  canvas.width = canvas.height = SAMPLE_PX
  const ctx = canvas.getContext('2d', { willReadFrequently: true })!
  ctx.drawImage(bitmap, 0, 0, SAMPLE_PX, SAMPLE_PX)
  bitmap.close()
  return primaryColor(ctx.getImageData(0, 0, SAMPLE_PX, SAMPLE_PX).data)
}

/** Text colour that reads on `color`. Default colours aren't hex and are all dark enough for white. */
export const inkOn = (color: string) => {
  const value = cleanHexColor(color, '')
  if (!value) return '#fff'
  const [r, g, b] = [1, 3, 5].map((i) => parseInt(value.slice(i, i + 2), 16))
  return 0.299 * r + 0.587 * g + 0.114 * b > 170 ? '#111' : '#fff'
}
