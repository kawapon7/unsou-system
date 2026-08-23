import { describe, it, expect } from 'vitest'
import { aggregateOobaInvoiceRows, buildOobaSubject, toReiwa, isWorkTypeProject } from './ooba-invoice-lines'

const line = (p: Partial<import('@/app/_actions/pdf-actions').InvoicePdfLine>) => ({
  workDate: '2026-06-01', projectName: 'X', quantity: 1, netAmount: 0, pieceCount: null, isWorkType: false, ...p,
})

describe('ooba-invoice-lines', () => {
  it('令和変換', () => { expect(toReiwa(2026)).toBe(8); expect(toReiwa(2019)).toBe(1) })
  it('件名', () => { expect(buildOobaSubject('2026-06')).toBe('R8．6月度 業務委託費') })
  it('作業系判定', () => {
    expect(isWorkTypeProject('協和冷蔵デバンニング作業')).toBe(true)
    expect(isWorkTypeProject('フジフィルム 2t配送')).toBe(false)
  })
  it('日数制は案件ごとに日数で束ね、単価は金額÷日数', () => {
    const rows = aggregateOobaInvoiceRows([
      line({ projectName: '(有)好川商通 安佐北区飯室荷役作業', netAmount: 12000 }),
      line({ projectName: '(有)好川商通 安佐北区飯室荷役作業', netAmount: 12000, workDate: '2026-06-02' }),
    ], '2026-06')
    expect(rows).toEqual([{ no: 1, description: '(有)好川商通 安佐北区飯室荷役作業', quantityLabel: '6月度 2 日', unitPrice: 12000, amount: 24000 }])
  })
  it('個数制は本数で束ね、同じ案件でも本数が違えば別行', () => {
    const rows = aggregateOobaInvoiceRows([
      line({ projectName: '協和冷蔵デバンニング作業', pieceCount: 1, quantity: 1, netAmount: 16000 }),
      line({ projectName: '協和冷蔵デバンニング作業', pieceCount: 2, quantity: 2, netAmount: 26000 }),
      line({ projectName: '協和冷蔵デバンニング作業', pieceCount: 2, quantity: 2, netAmount: 26000, workDate: '2026-06-03' }),
    ], '2026-06')
    expect(rows.map(r => [r.description, r.quantityLabel, r.unitPrice, r.amount])).toEqual([
      ['協和冷蔵デバンニング作業 1本', '6月度 1 日', 16000, 16000],
      ['協和冷蔵デバンニング作業 2本', '6月度 2 日', 13000, 52000],
    ])
  })
})
