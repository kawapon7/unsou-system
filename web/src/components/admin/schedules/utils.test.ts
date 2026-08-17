import { describe, it, expect } from 'vitest'
import { dateForYearMonth, yearMonthOf } from './utils'

/**
 * サイドバーの「対象年月」からカレンダーの表示日付を決める規則のテスト。
 * ⚠️ today を引数で受ける設計にしているのは、実時刻に依存させないため
 *    （実行日によって落ちるテストは無意味になる）。
 */
describe('dateForYearMonth', () => {
  const today = '2026-08-17'

  it('同じ月なら日付を動かさない（週表示・日表示で見ている日を奪わない）', () => {
    expect(dateForYearMonth('2026-08', '2026-08-25', today)).toBe('2026-08-25')
  })

  it('別の月を選んだら、その月の1日に移動する', () => {
    expect(dateForYearMonth('2026-09', '2026-08-25', today)).toBe('2026-09-01')
    expect(dateForYearMonth('2026-07', '2026-08-25', today)).toBe('2026-07-01')
  })

  it('今日の月を選んだ場合は1日ではなく今日に移動する（「今月に戻す」操作の期待に合わせる）', () => {
    expect(dateForYearMonth('2026-08', '2026-09-10', today)).toBe('2026-08-17')
  })

  it('年をまたいでも正しく移動する', () => {
    expect(dateForYearMonth('2027-01', '2026-12-31', today)).toBe('2027-01-01')
  })

  it('戻り値の年月は必ず選択した年月と一致する', () => {
    for (const ym of ['2026-01', '2026-02', '2026-08', '2026-12', '2027-03']) {
      expect(yearMonthOf(dateForYearMonth(ym, '2026-08-25', today))).toBe(ym)
    }
  })
})
