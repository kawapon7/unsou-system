import { describe, it, expect } from 'vitest'
import {
  closingRange,
  computeDueDate,
  isLastDayClosing,
  isWithinRange,
  formatLocalDate,
  parseLocalDate,
} from './closing-period'

describe('isLastDayClosing', () => {
  it('月末を表す表記ゆれをすべて月末と判定する', () => {
    for (const v of ['月末', '末日', '99']) {
      expect(isLastDayClosing(v)).toBe(true)
    }
  })

  it('未設定・不正値は月末として扱う（fail-safe）', () => {
    expect(isLastDayClosing(null)).toBe(true)
    expect(isLastDayClosing(undefined)).toBe(true)
    expect(isLastDayClosing('')).toBe(true)
    expect(isLastDayClosing('0')).toBe(true)
    expect(isLastDayClosing('31')).toBe(true)
  })

  it('日付締めは月末ではない', () => {
    expect(isLastDayClosing('20')).toBe(false)
    expect(isLastDayClosing('20日')).toBe(false)
    expect(isLastDayClosing('5')).toBe(false)
  })
})

describe('closingRange', () => {
  it('月末締めは当月1日〜当月末日', () => {
    expect(closingRange('2026-07', '月末')).toEqual({ from: '2026-07-01', to: '2026-07-31' })
  })

  it('30日しかない月の月末を正しく出す', () => {
    expect(closingRange('2026-06', '月末')).toEqual({ from: '2026-06-01', to: '2026-06-30' })
  })

  it('うるう年の2月末を正しく出す', () => {
    expect(closingRange('2028-02', '月末')).toEqual({ from: '2028-02-01', to: '2028-02-29' })
    expect(closingRange('2026-02', '月末')).toEqual({ from: '2026-02-01', to: '2026-02-28' })
  })

  it('20日締めは前月21日〜当月20日', () => {
    expect(closingRange('2026-07', '20')).toEqual({ from: '2026-06-21', to: '2026-07-20' })
  })

  it('年をまたぐ日付締めを正しく出す', () => {
    expect(closingRange('2026-01', '20')).toEqual({ from: '2025-12-21', to: '2026-01-20' })
  })

  // ⚠️ 回帰テスト: 従来は toISOString() を使っており、JST の開発機では
  //    月末が 1 日前（2026-07-30）にずれていた。本番 Workers は UTC でずれない。
  it('月末が1日前にずれない（toISOString による TZ ズレの回帰テスト）', () => {
    expect(closingRange('2026-07', '月末').to).toBe('2026-07-31')
    expect(closingRange('2026-12', '月末').to).toBe('2026-12-31')
  })

  it('yearMonth の形式が違えば例外にする（黙って誤集計しない）', () => {
    expect(() => closingRange('2026-07-01', '月末')).toThrow()
    expect(() => closingRange('2026/07', '月末')).toThrow()
  })
})

describe('computeDueDate', () => {
  it('月末締め・30日サイトは翌月末日', () => {
    expect(computeDueDate('2026-07', '月末', 30)).toBe('2026-08-30')
  })

  it('20日締めの起点は暦月末日ではなく締め日', () => {
    // 2026-07-20 + 30日
    expect(computeDueDate('2026-07', '20', 30)).toBe('2026-08-19')
  })

  it('サイト未設定は締め日当日', () => {
    expect(computeDueDate('2026-07', '月末', null)).toBe('2026-07-31')
  })
})

describe('isWithinRange', () => {
  const range = closingRange('2026-07', '20')   // 2026-06-21 〜 2026-07-20

  it('境界日を含む', () => {
    expect(isWithinRange('2026-06-21', range)).toBe(true)
    expect(isWithinRange('2026-07-20', range)).toBe(true)
  })

  it('境界の外は含まない', () => {
    expect(isWithinRange('2026-06-20', range)).toBe(false)
    expect(isWithinRange('2026-07-21', range)).toBe(false)
  })
})

describe('formatLocalDate / parseLocalDate', () => {
  it('往復して同じ日付になる', () => {
    for (const s of ['2026-01-01', '2026-07-31', '2028-02-29']) {
      expect(formatLocalDate(parseLocalDate(s))).toBe(s)
    }
  })

  it('parseLocalDate は UTC ではなくローカル日付として解釈する', () => {
    const d = parseLocalDate('2026-07-31')
    expect(d.getFullYear()).toBe(2026)
    expect(d.getMonth()).toBe(6)
    expect(d.getDate()).toBe(31)
  })
})
