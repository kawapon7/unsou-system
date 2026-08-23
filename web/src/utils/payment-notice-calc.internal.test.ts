import { describe, it, expect } from 'vitest'
import { computePaymentNoticeAmounts } from './payment-notice-calc'

// 自社区分(is_internal)の委託先は支払通知書の対象外（fail-closed）であることを固定する。
// contractors を引いた直後に弾かれるため、後続テーブルへは一切アクセスしない想定の最小フェイク。
function fakeDb(contractorRow: Record<string, unknown>) {
  const touched: string[] = []
  const chain = (table: string) => {
    const q: any = {
      select: () => q, eq: () => q, gte: () => q, lte: () => q, in: () => q, order: () => q,
      single: async () => ({ data: table === 'contractors' ? contractorRow : null, error: null }),
      maybeSingle: async () => ({ data: null, error: null }),
      then: (resolve: (v: unknown) => void) => resolve({ data: [], error: null }),
    }
    return q
  }
  return {
    touched,
    from: (table: string) => { touched.push(table); return chain(table) },
  }
}

describe('computePaymentNoticeAmounts / is_internal', () => {
  it('自社区分の委託先はエラーで止まり、後続テーブルを読まない', async () => {
    const db = fakeDb({ tax_category: 'exclusive', invoice_registration_type: '免税', has_withholding: false, closing_day: '月末', is_internal: true })
    const res = await computePaymentNoticeAmounts(db as any, { tenantId: 't', contractorId: 'c', yearMonth: '2026-08' })
    expect(res.data).toBeNull()
    expect(res.error).toContain('対象外')
    expect(db.touched).toEqual(['contractors'])
  })
})
