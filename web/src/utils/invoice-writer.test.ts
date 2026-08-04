import { describe, it, expect } from 'vitest'
import { buildInvoiceRow, type InvoiceWritePayload } from './invoice-writer'

const base: InvoiceWritePayload = {
  clientId:     'client-1',
  departmentId: null,
  yearMonth:    '2026-06',
  subtotal:     1_020_000,
  taxAmount:    102_000,
  totalAmount:  1_122_000,
  status:       'draft',
  dueDate:      '2026-07-31',
  issuedAt:     null,
  tenantId:     '00000000-0000-0000-0000-0000000000a1',
}

describe('buildInvoiceRow', () => {
  it('新列と旧列に同じ値を入れる（3回発生した 23502 の再発防止）', () => {
    const row = buildInvoiceRow(base)
    // 旧列は NOT NULL・DEFAULT なし。新列と必ず同値でなければならない
    expect(row['target_month']).toBe(row['invoice_month'])
    expect(row['total_amount_ex_tax']).toBe(row['total_tax_excluded'])
    expect(row['total_tax']).toBe(row['consumption_tax'])
  })

  it('旧列3つが undefined にならない', () => {
    const row = buildInvoiceRow(base)
    expect(row['target_month']).toBeDefined()
    expect(row['total_amount_ex_tax']).toBeDefined()
    expect(row['total_tax']).toBeDefined()
  })

  it("yearMonth 'YYYY-MM' を月初日 'YYYY-MM-01' に変換する", () => {
    const row = buildInvoiceRow(base)
    expect(row['invoice_month']).toBe('2026-06-01')
    expect(row['target_month']).toBe('2026-06-01')
  })

  it('departmentId の null を保持する（部署なし荷主）', () => {
    const row = buildInvoiceRow(base)
    expect(row['department_id']).toBeNull()
  })

  it('departmentId を指定するとその値が入る', () => {
    const row = buildInvoiceRow({ ...base, departmentId: 'dept-1' })
    expect(row['department_id']).toBe('dept-1')
  })

  it('tenant_id を必ず書き込む（DEFAULT 依存をやめる）', () => {
    const row = buildInvoiceRow(base)
    expect(row['tenant_id']).toBe('00000000-0000-0000-0000-0000000000a1')
  })

  it('金額をそのまま渡す', () => {
    const row = buildInvoiceRow(base)
    expect(row['total_tax_excluded']).toBe(1_020_000)
    expect(row['consumption_tax']).toBe(102_000)
    expect(row['total_amount']).toBe(1_122_000)
  })

  it('yearMonth の形式が不正なら例外を投げる', () => {
    expect(() => buildInvoiceRow({ ...base, yearMonth: '2026-6' })).toThrow()
    expect(() => buildInvoiceRow({ ...base, yearMonth: '2026-06-01' })).toThrow()
  })
})
