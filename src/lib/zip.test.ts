import { describe, expect, it } from 'vitest'
import { crc32, makeZip } from './zip'
import { uniqueNames } from './files'

describe('zip', () => {
  it('computes the standard CRC-32', () => {
    expect(crc32(new TextEncoder().encode('123456789'))).toBe(0xcbf43926)
  })

  it('writes a readable archive', async () => {
    const enc = new TextEncoder()
    const blob = makeZip([
      { name: 'a.txt', data: enc.encode('hello') },
      { name: 'café.md', data: enc.encode('# hi') },
    ])
    const bytes = new Uint8Array(await blob.arrayBuffer())
    const view = new DataView(bytes.buffer)
    expect(view.getUint32(0, true)).toBe(0x04034b50)
    const end = bytes.length - 22
    expect(view.getUint32(end, true)).toBe(0x06054b50)
    expect(view.getUint16(end + 10, true)).toBe(2)
    if (process.env.ZIP_OUT) (await import('node:fs')).writeFileSync(process.env.ZIP_OUT, bytes)
  })
})

describe('uniqueNames', () => {
  it('numbers repeats and strips path separators', () => {
    expect(uniqueNames(['a.png', 'A.png', 'a.png', 'x/y', 'note'])).toEqual([
      'a.png',
      'A (2).png',
      'a (3).png',
      'x_y',
      'note',
    ])
  })
})
