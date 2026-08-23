import { describe, it, expect } from 'vitest'
import { splitExpenseTax } from './expense-tax'

describe('splitExpenseTax', () => {
  it('課税10%: 税込実費を税抜と税に分ける（税抜は切り捨てではなく四捨五入・従来互換）', () => {
    expect(splitExpenseTax(1500)).toEqual({ amountTaxExcluded: 1364, taxAmount: 136, taxCategory: 'taxable_10' })
    expect(splitExpenseTax(1100)).toEqual({ amountTaxExcluded: 1000, taxAmount: 100, taxCategory: 'taxable_10' })
  })
  it('非課税: 税抜＝実費、税0', () => {
    expect(splitExpenseTax(400, true)).toEqual({ amountTaxExcluded: 400, taxAmount: 0, taxCategory: 'exempt' })
  })
  it('税抜＋税＝実費 が常に成り立つ', () => {
    for (const a of [1, 7, 333, 1500, 99999]) {
      const r = splitExpenseTax(a)
      expect(r.amountTaxExcluded + r.taxAmount).toBe(a)
    }
  })
})
