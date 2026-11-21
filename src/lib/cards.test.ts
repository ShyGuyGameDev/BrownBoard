import { describe, expect, it } from 'vitest'
import { readCover } from './cards'

describe('readCover', () => {
  it('keeps valid cover colours and rejects invalid ones', () => {
    expect(readCover({ color: '#AABBCC' })).toEqual({ color: '#AABBCC' })
    expect(readCover({ color: 'red' })).toBeNull()
  })

  it('rejects cover URLs outside the configured storage origin', () => {
    expect(readCover({ url: 'https://tracker.example/pixel.png' })).toBeNull()
    expect(readCover({ url: 'javascript:alert(1)' })).toBeNull()
  })
})
