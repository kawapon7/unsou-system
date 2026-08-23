import { describe, it, expect } from 'vitest'
import { workMinutesFromHHMM, formatHHMM } from './work-minutes'

describe('workMinutesFromHHMM', () => {
  it('通常勤務: 08:00〜17:00 休憩60分 → 480分', () => {
    expect(workMinutesFromHHMM('08:00', '17:00', 60)).toBe(480)
  })

  it('深夜またぎ: 22:00〜06:00 休憩60分 → 420分', () => {
    expect(workMinutesFromHHMM('22:00', '06:00', 60)).toBe(420)
  })

  it('開始時刻なし → null', () => {
    expect(workMinutesFromHHMM(null, '17:00', 60)).toBeNull()
  })

  it('終了時刻なし → null', () => {
    expect(workMinutesFromHHMM('08:00', null, 60)).toBeNull()
  })
})

describe('formatHHMM', () => {
  it('480分 → "8:00"', () => {
    expect(formatHHMM(480)).toBe('8:00')
  })

  it('null → ""', () => {
    expect(formatHHMM(null)).toBe('')
  })
})
