import { describe, it, expect } from 'vitest'
import { normalizeFilter } from './document-search'

describe('normalizeFilter', () => {
  it('空文字は null、金額は数値化、前後空白を除く', () => {
    expect(normalizeFilter({ kind: '', dateFrom: '', party: ' おおば ', minAmount: '1,000', maxAmount: 'abc' }))
      .toEqual({ kind: null, dateFrom: null, dateTo: null, party: 'おおば', minAmount: 1000, maxAmount: null, includeCancelled: false })
  })
  it('日付は YYYY-MM-DD のみ受け付ける', () => {
    expect(normalizeFilter({ dateFrom: '2026-08-01', dateTo: '2026/08/31' }).dateFrom).toBe('2026-08-01')
    expect(normalizeFilter({ dateFrom: '2026-08-01', dateTo: '2026/08/31' }).dateTo).toBeNull()
  })
})
