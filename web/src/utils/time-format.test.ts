import { describe, it, expect } from 'vitest'
import { toHHMM } from './time-format'

describe('toHHMM', () => {
  it('ISO タイムスタンプを JST の HH:MM に変換する', () => {
    expect(toHHMM('2025-11-01T23:00:00Z')).toBe('08:00')
  })
  it('null/undefined は null を返す', () => {
    expect(toHHMM(null)).toBe(null)
    expect(toHHMM(undefined)).toBe(null)
  })
  it('日付が変わる境界も JST で正しく変換する', () => {
    expect(toHHMM('2025-11-01T15:00:00Z')).toBe('00:00')
  })
})
