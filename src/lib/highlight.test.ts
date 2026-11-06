import { describe, expect, it } from 'vitest'
import { hslToHex, inkOn, primaryColor } from './highlight'

const image = (...runs: [count: number, rgba: number[]][]) =>
  new Uint8ClampedArray(runs.flatMap(([count, rgba]) => Array(count).fill(rgba).flat()))

const hue = (color: string) => {
  const [r, g, b] = [1, 3, 5].map((i) => parseInt(color.slice(i, i + 2), 16))
  return { r, g, b }
}

describe('hslToHex', () => {
  it('converts primaries and greys', () => {
    expect(hslToHex(0, 1, 0.5)).toBe('#ff0000')
    expect(hslToHex(120, 1, 0.5)).toBe('#00ff00')
    expect(hslToHex(240, 1, 0.5)).toBe('#0000ff')
    expect(hslToHex(0, 0, 0.5)).toBe('#808080')
  })
})

describe('primaryColor', () => {
  it('picks the colour covering the most of the image', () => {
    const { r, g, b } = hue(
      primaryColor(image([70, [220, 30, 30, 255]], [30, [30, 30, 220, 255]]))!,
    )
    expect(r).toBeGreaterThan(g)
    expect(r).toBeGreaterThan(b)
  })

  it('ignores a plain backdrop', () => {
    const color = primaryColor(image([90, [255, 255, 255, 255]], [10, [30, 200, 30, 255]]))!
    const { r, g, b } = hue(color)
    expect(g).toBeGreaterThan(r)
    expect(g).toBeGreaterThan(b)
  })

  it('ignores transparent pixels', () => {
    const { r, b } = hue(primaryColor(image([90, [220, 30, 30, 0]], [10, [30, 30, 220, 255]]))!)
    expect(b).toBeGreaterThan(r)
  })

  it('lifts a very dark colour so it shows up', () => {
    const { b } = hue(primaryColor(image([100, [10, 10, 70, 255]]))!)
    expect(b).toBeGreaterThan(150)
  })

  it('gives grey for an image with no colour', () => {
    expect(primaryColor(image([100, [0, 0, 0, 255]]))).toBe('#999999')
  })

  it('gives null for a fully transparent image', () => {
    expect(primaryColor(image([100, [0, 0, 0, 0]]))).toBeNull()
  })
})

describe('inkOn', () => {
  it('uses dark text on pale colours and white otherwise', () => {
    expect(inkOn('#ffee88')).toBe('#111')
    expect(inkOn('#223344')).toBe('#fff')
    expect(inkOn('hsl(200 70% 52%)')).toBe('#fff')
  })
})
