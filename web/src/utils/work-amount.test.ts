import { describe, it, expect } from 'vitest'
import {
  calcWorkAmount,
  WORK_RECORD_AMOUNT_COLUMNS,
  type PriceRuleRecord,
  type RawWorkRecord,
} from './work-amount'

const rec = (o: Partial<RawWorkRecord> = {}): RawWorkRecord => ({
  project_id:    'p1',
  piece_count:   null,
  start_time:    null,
  end_time:      null,
  break_minutes: null,
  ...o,
})

const rule = (o: Partial<PriceRuleRecord> = {}): PriceRuleRecord => ({
  project_id:       'p1',
  calculation_type: 'piece',
  selling_price:    null,
  buying_price:     null,
  margin_fixed:     null,
  ...o,
})

describe('WORK_RECORD_AMOUNT_COLUMNS', () => {
  // ⚠️ この定数がガードの本体。実DBに存在しない列（tax_excluded_sales / tax_excluded_payment /
  //    quantity / spot_generic_id）を混ぜると PostgREST が 42703 を返し機能が丸ごと停止する。
  it('実DBに存在しない列を含まない', () => {
    const forbidden = [
      'tax_excluded_sales',
      'tax_excluded_payment',
      'quantity',
      'spot_generic_id',
    ]
    for (const col of forbidden) {
      expect(WORK_RECORD_AMOUNT_COLUMNS).not.toContain(col)
    }
  })

  it('計算に必要な計測列をすべて含む', () => {
    for (const col of ['project_id', 'piece_count', 'start_time', 'end_time', 'break_minutes']) {
      expect(WORK_RECORD_AMOUNT_COLUMNS).toContain(col)
    }
  })
})

describe('calcWorkAmount', () => {
  it('price_rule が無ければ 0', () => {
    expect(calcWorkAmount(rec({ piece_count: 10 }), undefined, 'selling')).toBe(0)
  })

  it('piece: 個数 × 単価', () => {
    const r = rule({ calculation_type: 'piece', selling_price: 300, buying_price: 200 })
    expect(calcWorkAmount(rec({ piece_count: 10 }), r, 'selling')).toBe(3000)
    expect(calcWorkAmount(rec({ piece_count: 10 }), r, 'buying')).toBe(2000)
  })

  it('piece: 個数が null なら 0', () => {
    const r = rule({ calculation_type: 'piece', selling_price: 300 })
    expect(calcWorkAmount(rec(), r, 'selling')).toBe(0)
  })

  it('hourly: (実働時間 − 休憩) × 単価、四捨五入', () => {
    const r = rule({ calculation_type: 'hourly', selling_price: 1200 })
    const w = rec({
      start_time:    '2026-07-15T09:00:00Z',
      end_time:      '2026-07-15T18:00:00Z',
      break_minutes: 60,
    })
    // 9時間 − 1時間 = 8時間 × 1200
    expect(calcWorkAmount(w, r, 'selling')).toBe(9600)
  })

  it('hourly: 時刻が欠けていれば 0', () => {
    const r = rule({ calculation_type: 'hourly', selling_price: 1200 })
    expect(calcWorkAmount(rec({ start_time: '2026-07-15T09:00:00Z' }), r, 'selling')).toBe(0)
  })

  it('fixed: 計測値によらず単価そのもの', () => {
    const r = rule({ calculation_type: 'fixed', selling_price: 50000 })
    expect(calcWorkAmount(rec({ piece_count: 999 }), r, 'selling')).toBe(50000)
  })

  it('hybrid: 固定 + 個数 × margin_fixed', () => {
    const r = rule({ calculation_type: 'hybrid', selling_price: 10000, margin_fixed: 50 })
    expect(calcWorkAmount(rec({ piece_count: 20 }), r, 'selling')).toBe(11000)
  })

  it('未知の calculation_type は 0', () => {
    const r = rule({ calculation_type: 'unknown', selling_price: 999 })
    expect(calcWorkAmount(rec({ piece_count: 5 }), r, 'selling')).toBe(0)
  })

  it('単価が null なら 0 として扱う', () => {
    const r = rule({ calculation_type: 'piece', selling_price: null })
    expect(calcWorkAmount(rec({ piece_count: 10 }), r, 'selling')).toBe(0)
  })
})
