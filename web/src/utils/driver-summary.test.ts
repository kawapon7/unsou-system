import { describe, it, expect } from 'vitest'
import { summarizeAnnual, type PaymentHistoryRow } from './driver-summary'

const row = (m: string, over: Partial<PaymentHistoryRow> = {}): PaymentHistoryRow => ({
  noticeMonth:    m,
  laborNet:       100000,
  expenseNet:     5000,
  totalTax:       10500,
  deduction:      231,
  insurance:      1000,
  totalAmount:    114269,
  approvalStatus: 'approved',
  ...over,
})

describe('summarizeAnnual', () => {
  it('その年の行だけを合算する', () => {
    const s = summarizeAnnual(2026, [row('2026-01-01'), row('2026-02-01'), row('2025-12-01')])
    expect(s.monthCount).toBe(2)
    expect(s.laborNetTotal).toBe(200000)
    expect(s.expenseNetTotal).toBe(10000)
    expect(s.paidTotal).toBe(228538)
  })

  it('行が無い年は全て0を返す（例外にしない）', () => {
    expect(summarizeAnnual(2024, [])).toEqual({
      year: 2024, laborNetTotal: 0, expenseNetTotal: 0, taxTotal: 0,
      deductionTotal: 0, insuranceTotal: 0, paidTotal: 0, monthCount: 0,
    })
  })

  it('未承認の月も年計に含める（支払予定として見せるため）', () => {
    const s = summarizeAnnual(2026, [row('2026-03-01', { approvalStatus: 'pending' })])
    expect(s.monthCount).toBe(1)
    expect(s.paidTotal).toBe(114269)
  })

  it('経過措置控除と運送保険を別々に合算する', () => {
    const s = summarizeAnnual(2026, [
      row('2026-01-01', { deduction: 200, insurance: 1000 }),
      row('2026-02-01', { deduction: 300, insurance: 1000 }),
    ])
    expect(s.deductionTotal).toBe(500)
    expect(s.insuranceTotal).toBe(2000)
  })

  it('年をまたぐデータを渡しても取り違えない', () => {
    const rows = [row('2025-11-01', { laborNet: 1 }), row('2026-11-01', { laborNet: 2 })]
    expect(summarizeAnnual(2025, rows).laborNetTotal).toBe(1)
    expect(summarizeAnnual(2026, rows).laborNetTotal).toBe(2)
  })
})

describe('availableYearsOf', () => {
  it('通知書が存在する年だけを新しい順に返す', async () => {
    const { availableYearsOf } = await import('./driver-summary')
    expect(availableYearsOf(['2026-07-01', '2026-01-01', '2024-03-01'])).toEqual([2026, 2024])
  })

  it('1件も無ければ空配列（当年を勝手に足さない）', async () => {
    const { availableYearsOf } = await import('./driver-summary')
    expect(availableYearsOf([])).toEqual([])
  })
})
