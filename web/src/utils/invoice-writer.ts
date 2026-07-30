import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database } from '@/types/supabase'

// ⚠️ このファイルに 'use server' を付けてはならない。
//    純粋関数 buildInvoiceRow を export しているため、
//    'use server' を付けると「async 関数以外を export できない」で実行時エラーになる。

export type InvoiceWritePayload = {
  clientId:     string
  departmentId: string | null
  yearMonth:    string   // 'YYYY-MM'
  subtotal:     number   // 税抜合計
  taxAmount:    number   // 消費税額
  totalAmount:  number   // 税込合計
  status:       'draft' | 'issued' | 'paid'
  dueDate:      string | null
  issuedAt:     string | null
  tenantId:     string   // ⚠️ 必須。DEFAULT 依存をやめる（F0 テナント分離の Task 5B に相当）
}

/**
 * invoices の 1 行を組み立てる純粋関数。
 *
 * ⚠️ target_month / total_amount_ex_tax / total_tax は旧列だが NOT NULL・DEFAULT なし。
 *    渡さないと 23502 not-null violation で書き込みが必ず失敗する。
 *    2026-07-27 / 07-28 / 07-29 と 3 回続けて同じ事故が起きているため、
 *    ここ 1 箇所で新列と同値を保証し、テストで固定する。
 */
export function buildInvoiceRow(p: InvoiceWritePayload) {
  if (!/^\d{4}-\d{2}$/.test(p.yearMonth)) {
    throw new Error(`yearMonth は 'YYYY-MM' 形式で渡してください: ${p.yearMonth}`)
  }
  const month = `${p.yearMonth}-01`

  return {
    client_id:           p.clientId,
    department_id:       p.departmentId,
    invoice_month:       month,
    target_month:        month,              // 旧列（invoice_month と同値）
    total_tax_excluded:  p.subtotal,
    total_amount_ex_tax: p.subtotal,         // 旧列（total_tax_excluded と同値）
    consumption_tax:     p.taxAmount,
    total_tax:           p.taxAmount,        // 旧列（consumption_tax と同値）
    total_amount:        p.totalAmount,
    status:              p.status,
    due_date:            p.dueDate,
    issued_at:           p.issuedAt,
    tenant_id:           p.tenantId,
    updated_at:          new Date().toISOString(),
  }
}

/**
 * invoices への唯一の書き込み口。
 *
 * (client_id, department_id, invoice_month) で既存行を探し、
 * あれば UPDATE・なければ INSERT する。
 *
 * ⚠️ onConflict を使わない。
 *    Task 7 で一意性を「部分ユニークインデックス 2 本」に張り替えるため、
 *    onConflict では対象を指定できない。
 *
 * ⚠️ この関数は「確定済み請求書のロック判定」を行わない。
 *    status が issued / paid の請求書を上書きしてよいかの判断は業務ロジックであり、
 *    呼び出し側の責任として残す（例: billing-actions.ts の開発者アンロック）。
 *    ここで守られると思い込むと、発行済み請求書が黙って上書きされる事故になる。
 */
export async function writeInvoice(
  service: SupabaseClient<Database>,
  payload: InvoiceWritePayload,
): Promise<{ id: string | null; error: string | null }> {
  const row = buildInvoiceRow(payload)

  // ⚠️ department_id が null のとき .eq('department_id', null) は PostgREST では動かない。
  //    必ず .is('department_id', null) を使うこと。
  let query = service
    .from('invoices')
    .select('id')
    .eq('client_id',     payload.clientId)
    .eq('invoice_month', row.invoice_month)
    .eq('tenant_id',     payload.tenantId)

  query = payload.departmentId === null
    ? query.is('department_id', null)
    : query.eq('department_id', payload.departmentId)

  const { data: existing, error: selectErr } = await query.maybeSingle()
  if (selectErr) return { id: null, error: selectErr.message }

  if (existing) {
    const { error } = await service
      .from('invoices')
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      .update(row as any)
      .eq('id', existing.id)
    if (error) return { id: null, error: error.message }
    return { id: existing.id, error: null }
  }

  const { data, error } = await service
    .from('invoices')
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    .insert(row as any)
    .select('id')
    .single()
  if (error) return { id: null, error: error.message }
  return { id: (data as { id: string }).id, error: null }
}
