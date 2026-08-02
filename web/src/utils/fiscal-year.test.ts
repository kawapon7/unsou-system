import { describe, it, expect } from 'vitest'
import {
  fiscalYearRange,
  fiscalYearLabel,
  normalizeFiscalYearEndMonth,
  DEFAULT_FISCAL_YEAR_END_MONTH,
} from './fiscal-year'

describe('normalizeFiscalYearEndMonth', () => {
  it('未設定・範囲外は暦年（12月決算）として扱う', () => {
    for (const v of [null, undefined, 0, 13, -1, 3.5, NaN]) {
      expect(normalizeFiscalYearEndMonth(v as number | null)).toBe(DEFAULT_FISCAL_YEAR_END_MONTH)
    }
  })

  it('1〜12 はそのまま', () => {
    expect(normalizeFiscalYearEndMonth(1)).toBe(1)
    expect(normalizeFiscalYearEndMonth(3)).toBe(3)
    expect(normalizeFiscalYearEndMonth(12)).toBe(12)
  })
})

describe('fiscalYearRange', () => {
  it('3月決算: 4月1日〜翌年3月31日', () => {
    expect(fiscalYearRange('2026-08', 3)).toEqual({ from: '2026-04-01', to: '2027-03-31' })
  })

  it('3月決算: 決算月そのものは前年開始の年度に属する', () => {
    expect(fiscalYearRange('2026-03', 3)).toEqual({ from: '2025-04-01', to: '2026-03-31' })
  })

  it('3月決算: 年度の開始月（4月）は新しい年度に属する', () => {
    expect(fiscalYearRange('2026-04', 3)).toEqual({ from: '2026-04-01', to: '2027-03-31' })
  })

  it('12月決算は暦年と一致する', () => {
    expect(fiscalYearRange('2026-08', 12)).toEqual({ from: '2026-01-01', to: '2026-12-31' })
    expect(fiscalYearRange('2026-01', 12)).toEqual({ from: '2026-01-01', to: '2026-12-31' })
    expect(fiscalYearRange('2026-12', 12)).toEqual({ from: '2026-01-01', to: '2026-12-31' })
  })

  it('未設定なら暦年になる', () => {
    expect(fiscalYearRange('2026-08', null)).toEqual({ from: '2026-01-01', to: '2026-12-31' })
  })

  it('1月決算: 2月1日〜翌年1月31日', () => {
    expect(fiscalYearRange('2026-08', 1)).toEqual({ from: '2026-02-01', to: '2027-01-31' })
    expect(fiscalYearRange('2026-01', 1)).toEqual({ from: '2025-02-01', to: '2026-01-31' })
  })

  it('2月決算のうるう年で末日が29日になる', () => {
    expect(fiscalYearRange('2028-02', 2)).toEqual({ from: '2027-03-01', to: '2028-02-29' })
    expect(fiscalYearRange('2026-02', 2)).toEqual({ from: '2025-03-01', to: '2026-02-28' })
  })

  // ⚠️ toISOString を使う実装だと JST で 1 日前にずれ、年度の境界を跨いで誤判定する
  it('年度末が1日前にずれない（TZズレの回帰テスト）', () => {
    expect(fiscalYearRange('2026-08', 3).to).toBe('2027-03-31')
    expect(fiscalYearRange('2026-08', 12).to).toBe('2026-12-31')
  })

  it('形式違いは例外にする（黙って誤集計しない）', () => {
    expect(() => fiscalYearRange('2026-8', 3)).toThrow()
    expect(() => fiscalYearRange('2026-08-01', 3)).toThrow()
  })
})

describe('fiscalYearLabel', () => {
  it('人が読める形にする', () => {
    expect(fiscalYearLabel('2026-08', 3)).toBe('2026年4月〜2027年3月')
    expect(fiscalYearLabel('2026-08', 12)).toBe('2026年1月〜2026年12月')
  })
})
