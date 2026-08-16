import { describe, it, expect } from 'vitest'
import { assemblePaymentTotals } from './payment-notice-totals'

/**
 * 支払通知書の差引支給額の組み立て。
 *
 * 実物の支払明細書の構造:
 *   支払運賃
 *   調整                        ← 税込思考業者の端数補正（calcPayeeAmount）
 *   10%対象小計【①】
 *   消費税額（10%）【②】
 *   相殺額
 *      2%分                     ← 経過措置
 *      運送保険（非課税）         ← 全委託先一律。消費税の対象外
 *   相殺額合計【③】
 *   立替金【④】
 *   差引支給額【①+②+③+④】（税込）
 */
describe('assemblePaymentTotals', () => {
  const base = {
    laborTaxExcluded: 60_000,
    laborTax: 6_000,
    expenseTaxExcluded: 2_000,
    expenseTax: 200,
    deduction: 0,
    adjustment: 0,
    insuranceDeduction: 0,
  }

  it('相殺が無ければ 税抜合計 + 消費税 が支給額になる', () => {
    const t = assemblePaymentTotals(base)

    expect(t.totalExcludingTax).toBe(62_000)
    expect(t.totalTax).toBe(6_200)
    expect(t.totalDeduction).toBe(0)
    expect(t.totalAmount).toBe(68_200)
  })

  it('運送保険は相殺額合計に含まれ、支給額から引かれる', () => {
    const t = assemblePaymentTotals({ ...base, insuranceDeduction: 1_000 })

    expect(t.totalDeduction).toBe(1_000)
    expect(t.totalAmount).toBe(67_200)
  })

  it('運送保険は非課税なので消費税額を動かさない', () => {
    const withInsurance = assemblePaymentTotals({ ...base, insuranceDeduction: 1_000 })

    expect(withInsurance.totalTax).toBe(base.laborTax + base.expenseTax)
    expect(withInsurance.totalExcludingTax).toBe(62_000)
  })

  it('経過措置と運送保険は両方とも相殺額合計に積み上がる', () => {
    const t = assemblePaymentTotals({ ...base, deduction: 1_452, insuranceDeduction: 1_000 })

    expect(t.totalDeduction).toBe(2_452)
    expect(t.totalAmount).toBe(65_748)
  })

  it('調整は相殺ではなく加算として効く', () => {
    const t = assemblePaymentTotals({ ...base, adjustment: 33, insuranceDeduction: 1_000 })

    expect(t.totalDeduction).toBe(1_000)
    expect(t.totalAmount).toBe(67_233)
  })
})
