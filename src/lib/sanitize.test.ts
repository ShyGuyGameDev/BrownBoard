import { describe, expect, it } from 'vitest'
import {
  cleanHexColor,
  cleanInk,
  cleanLine,
  cleanMultiline,
  isSafeImageSrc,
  safeExtension,
} from './sanitize'

describe('cleanLine', () => {
  it('trims and collapses whitespace, including newlines and tabs', () => {
    expect(cleanLine('  Design \n\t sprint  ', 48)).toBe('Design sprint')
  })
  it('removes bidi overrides and zero-width spaces', () => {
    expect(cleanLine('ad\u202Emin\u200B', 48)).toBe('admin')
  })
  it('replaces control characters', () => {
    expect(cleanLine('a\u0007b', 48)).toBe('a b')
  })
  it('keeps emoji sequences that use zero-width joiners', () => {
    expect(cleanLine('team 👩\u200D💻', 48)).toBe('team 👩\u200D💻')
  })
  it('caps length without splitting a character', () => {
    expect(cleanLine('😀😀😀', 2)).toBe('😀😀')
  })
  it('normalises to NFC', () => {
    expect(cleanLine('é', 10)).toBe('é')
  })
})

describe('cleanMultiline', () => {
  it('keeps line breaks but limits blank lines', () => {
    expect(cleanMultiline('one  \r\n\r\n\r\n\r\ntwo\t', 100)).toBe('one\n\ntwo')
  })
})

describe('colours', () => {
  it('accepts hex and rejects anything else', () => {
    expect(cleanHexColor('#ABCDEF', '#000000')).toBe('#abcdef')
    expect(cleanHexColor('red; background:url(x)', '#71717a')).toBe('#71717a')
    expect(cleanInk('auto')).toBe('auto')
    expect(cleanInk('url(javascript:1)')).toBe('auto')
  })
})

describe('isSafeImageSrc', () => {
  it('allows embedded images and local previews', () => {
    expect(isSafeImageSrc('data:image/png;base64,AAAA')).toBe(true)
    expect(isSafeImageSrc('blob:http://localhost/123')).toBe(true)
  })
  it('rejects other sites and schemes', () => {
    expect(isSafeImageSrc('https://tracker.example.com/pixel.gif')).toBe(false)
    expect(isSafeImageSrc('javascript:alert(1)')).toBe(false)
    expect(isSafeImageSrc('data:text/html;base64,AAAA')).toBe(false)
    expect(isSafeImageSrc(42)).toBe(false)
  })
})

describe('safeExtension', () => {
  it('strips anything that could escape a storage path', () => {
    expect(safeExtension('photo.PNG')).toBe('png')
    expect(safeExtension('evil.png/../../x')).toBe('x')
    expect(safeExtension('noext')).toBe('noext')
    expect(safeExtension('...')).toBe('png')
  })
})
