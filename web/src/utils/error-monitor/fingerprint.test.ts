import { describe, it, expect } from 'vitest'
import { fingerprint, normalizeMessage } from './fingerprint'

describe('normalizeMessage', () => {
  it('UUID と数字列を潰し空白を圧縮する', () => {
    expect(normalizeMessage('row 3f2a1b7c-1234-4bcd-9e0f-aabbccddeeff  count 42')).toBe('row <uuid> count <n>')
  })
})

describe('fingerprint', () => {
  it('16桁 hex', () => {
    expect(fingerprint('action', 'upsertSchedule', 'x')).toMatch(/^[0-9a-f]{16}$/)
  })
  it('数字・UUID 違いは同一', () => {
    const a = fingerprint('action', 'a', 'id 111 failed')
    const b = fingerprint('action', 'a', 'id 222 failed')
    expect(a).toBe(b)
  })
  it('action 名が違えば別', () => {
    expect(fingerprint('action', 'a', 'm')).not.toBe(fingerprint('action', 'b', 'm'))
  })
  it('source が違えば別', () => {
    expect(fingerprint('action', 'a', 'm')).not.toBe(fingerprint('route', 'a', 'm'))
  })
})
