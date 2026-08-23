import { describe, it, expect } from 'vitest'
import { decideInsuranceDeduction } from './transport-insurance'

describe('decideInsuranceDeduction', () => {
  it('稼働あり・適用ありなら設定額を引く', () => {
    expect(decideInsuranceDeduction({ hasActivity: true, applies: true, amount: 1000 })).toBe(1000)
  })
  it('委託先が適用なし（作業系など）なら稼働があっても 0', () => {
    expect(decideInsuranceDeduction({ hasActivity: true, applies: false, amount: 1000 })).toBe(0)
  })
  it('稼働も立替も無い月は適用ありでも 0（マイナス支給を作らない）', () => {
    expect(decideInsuranceDeduction({ hasActivity: false, applies: true, amount: 1000 })).toBe(0)
  })
  it('設定額 0 なら 0', () => {
    expect(decideInsuranceDeduction({ hasActivity: true, applies: true, amount: 0 })).toBe(0)
  })
})
