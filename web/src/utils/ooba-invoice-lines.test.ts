import { describe, it, expect } from 'vitest'
import { aggregateOobaInvoiceRows, layoutOobaInvoiceRows, buildOobaSubject, toReiwa, isWorkCategory } from './ooba-invoice-lines'

const line = (p: Partial<import('@/app/_actions/pdf-actions').InvoicePdfLine>) => ({
  workDate: '2026-06-01', projectName: 'X', quantity: 1, netAmount: 0, pieceCount: null, isWorkType: false, ...p,
})

describe('ooba-invoice-lines', () => {
  it('令和変換', () => { expect(toReiwa(2026)).toBe(8); expect(toReiwa(2019)).toBe(1) })
  it('件名', () => { expect(buildOobaSubject('2026-06')).toBe('R8．6月度 業務委託費') })
  it('カテゴリが work の案件だけ作業系として扱う', () => {
    expect(isWorkCategory('work')).toBe(true)
    expect(isWorkCategory('transport')).toBe(false)
  })

  it('カテゴリ未設定（案件なしの記録など）は作業系として扱わない', () => {
    expect(isWorkCategory(null)).toBe(false)
    expect(isWorkCategory(undefined)).toBe(false)
  })

  it('案件名に「作業」を含んでもカテゴリが transport なら作業系ではない', () => {
    // 文字列依存が切れたことの確認。名前は判定に一切使わない
    expect(isWorkCategory('transport')).toBe(false)
  })
  it('日数制は案件ごとに日数で束ね、単価は金額÷日数', () => {
    const rows = aggregateOobaInvoiceRows([
      line({ projectName: '(有)好川商通 安佐北区飯室荷役作業', netAmount: 12000 }),
      line({ projectName: '(有)好川商通 安佐北区飯室荷役作業', netAmount: 12000, workDate: '2026-06-02' }),
    ], '2026-06')
    expect(rows.map(r => [r.no, r.groupStart, r.monthLabel, r.description, r.days, r.unitPrice, r.amount]))
      .toEqual([[1, true, '6月度', '(有)好川商通 安佐北区飯室荷役作業', 2, 12000, 24000]])
  })
  it('個数制は本数で束ね、同じ案件でも本数が違えば別行', () => {
    const rows = aggregateOobaInvoiceRows([
      line({ projectName: '協和冷蔵デバンニング作業', pieceCount: 1, quantity: 1, netAmount: 16000 }),
      line({ projectName: '協和冷蔵デバンニング作業', pieceCount: 2, quantity: 2, netAmount: 26000 }),
      line({ projectName: '協和冷蔵デバンニング作業', pieceCount: 2, quantity: 2, netAmount: 26000, workDate: '2026-06-03' }),
    ], '2026-06')
    expect(rows.map(r => [r.description, r.days, r.unitPrice, r.amount])).toEqual([
      ['協和冷蔵デバンニング作業 1本', 1, 16000, 16000],
      ['協和冷蔵デバンニング作業 2本', 2, 26000, 52000],
    ])
  })
  it('同一日付の複数レコードは1日として束ね、単価は1日分', () => {
    const rows = aggregateOobaInvoiceRows([
      line({ projectName: 'テスト案件', netAmount: 30000 }),
      line({ projectName: 'テスト案件', netAmount: 20000, workDate: '2026-06-01' }),
    ], '2026-06')
    expect(rows.map(r => [r.days, r.unitPrice, r.amount])).toEqual([[1, 50000, 50000]])
  })
  it('担当者ごとに①②を振り、作業系→非作業系の順。同じ人は別案件でも同じ番号（見本 2026-06）', () => {
    const mk = (c: string, p: string, date: string, amt: number, pc: number | null, w: boolean) =>
      line({ contractorName: c, projectName: p, workDate: date, netAmount: amt, pieceCount: pc, isWorkType: w })
    const rows = aggregateOobaInvoiceRows([
      mk('坂田', '(有)好川商通 荷役作業', '2026-06-01', 12000, null, false),
      mk('坂田', '協和冷蔵デバンニング作業', '2026-06-02', 13000, 1, true),
      mk('山本', '協和冷蔵デバンニング作業', '2026-06-02', 13000, 1, true),
      mk('坂田', '協和冷蔵デバンニング作業', '2026-06-03', 16000, 2, true),
      mk('山本', '(有)好川商通 荷役作業', '2026-06-01', 12000, null, false),
    ], '2026-06')
    expect(rows.map(r => [r.no, r.groupStart, r.description, r.amount])).toEqual([
      [1, true,  '協和冷蔵デバンニング作業 1本', 13000],
      [1, false, '協和冷蔵デバンニング作業 2本', 16000],
      [2, true,  '協和冷蔵デバンニング作業 1本', 13000],
      [1, true,  '(有)好川商通 荷役作業', 12000],
      [2, true,  '(有)好川商通 荷役作業', 12000],
    ])
    const layout = layoutOobaInvoiceRows(rows)
    expect(layout.map(d => d.type === 'line' ? `${d.row.no}:${d.row.description}` : d.type === 'note' ? d.text : '-')).toEqual([
      '1:協和冷蔵デバンニング作業 1本', '1:協和冷蔵デバンニング作業 2本', '-',
      '2:協和冷蔵デバンニング作業 1本', '-', '※人員結果は別紙参照', '-',
      '1:(有)好川商通 荷役作業', '2:(有)好川商通 荷役作業',
      '-', '-', '-', '-', '-', '-', '-', '-',
    ])
    expect(layout.length).toBe(17)
  })
  it('作業系が無ければ注記行を出さず、17行に満たない分は空行で埋める', () => {
    const layout = layoutOobaInvoiceRows(aggregateOobaInvoiceRows([line({ projectName: 'X', netAmount: 1 })], '2026-06'))
    expect(layout.filter(d => d.type === 'note')).toHaveLength(0)
    expect(layout.length).toBe(17)
  })
})
