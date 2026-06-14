'use server'

import { revalidatePath } from 'next/cache'
import { createServiceClient } from '@/utils/supabase/service'
import { getMissingInputs, type MissingInputRow } from './scheduleActions'
import { getDuplicateInputs, type DuplicateGroup } from './workRecordActions'
import { getCurrentTenantId } from '@/utils/tenant'

// ── 型定義 ──────────────────────────────────────────────────

export type ThresholdAlertRow = {
  id:             string
  table:          'work_records' | 'expense_records'
  contractorId:   string
  contractorName: string
  date:           string
  reason:         string   // '個数100超' | '立替金3万超'
  value:          number
  status:         string
}

export type InvoiceWarningRow = {
  contractorId:         string
  contractorName:       string
  invoiceNumber:        string | null
  invoiceStatus:        string | null
  registrationType:     string
}

export type PendingNoticeRow = {
  noticeId:       string
  contractorId:   string
  contractorName: string
  phone:          string | null
  email:          string | null
  targetMonth:    string
  createdAt:      string
  hoursElapsed:   number
}

export type DefensiveAlerts = {
  missingInputs:   MissingInputRow[]
  duplicates:      DuplicateGroup[]
  thresholds:      ThresholdAlertRow[]
  invoiceWarnings: InvoiceWarningRow[]
  pendingNotices:  PendingNoticeRow[]
  totalCount:      number
}

type ActionResult<T = void> =
  | { data: T; error: null }
  | { data: null; error: string }

// ================================================================
// ① 業務しきい値超過レコードの自動ロック＆取得
//    piece_count > 100  → work_records.status = 'pending_review'
//    amount_actual > 30000 → expense_records.status = 'pending_review'
// ================================================================
export async function getThresholdAlerts(): Promise<ActionResult<ThresholdAlertRow[]>> {
  try {
    return { data: await fetchAndLockThresholdViolations(), error: null }
  } catch (e) {
    return { data: null, error: e instanceof Error ? e.message : 'しきい値アラート取得に失敗しました' }
  }
}

async function fetchAndLockThresholdViolations(): Promise<ThresholdAlertRow[]> {
  const tenantId = await getCurrentTenantId()
  const db = createServiceClient() as any
  const results: ThresholdAlertRow[] = []

  // ── work_records: 個数100超 ──────────────────────────────
  const { data: wrViolations } = await db
    .from('work_records')
    .select(`
      id, contractor_id, work_date, date, piece_count, status,
      contractors ( id, name )
    `)
    .eq('tenant_id', tenantId)
    .gt('piece_count', 100)
    .neq('status', 'approved')

  if (wrViolations?.length) {
    // pending_review でないものを自動ロック
    const needsLock = (wrViolations as any[]).filter(
      (r: any) => r.status !== 'pending_review',
    )
    if (needsLock.length > 0) {
      await db
        .from('work_records')
        .update({ status: 'pending_review' })
        .in('id', needsLock.map((r: any) => r.id))
        .eq('tenant_id', tenantId)
    }

    for (const r of wrViolations as any[]) {
      results.push({
        id:             r.id,
        table:          'work_records',
        contractorId:   r.contractor_id,
        contractorName: r.contractors?.name ?? r.contractor_id,
        date:           r.date ?? r.work_date ?? '',
        reason:         '個数100超',
        value:          r.piece_count,
        status:         'pending_review',
      })
    }
  }

  // ── expense_records: 立替金3万超 ─────────────────────────
  const { data: erViolations } = await db
    .from('expense_records')
    .select(`
      id, contractor_id, expense_date, date, amount_actual, status,
      contractors ( id, name )
    `)
    .eq('tenant_id', tenantId)
    .gt('amount_actual', 30000)
    .neq('approval_status', 'approved')

  if (erViolations?.length) {
    const needsLock = (erViolations as any[]).filter(
      (r: any) => r.status !== 'pending_review',
    )
    if (needsLock.length > 0) {
      await db
        .from('expense_records')
        .update({ status: 'pending_review' })
        .in('id', needsLock.map((r: any) => r.id))
        .eq('tenant_id', tenantId)
    }

    for (const r of erViolations as any[]) {
      results.push({
        id:             r.id,
        table:          'expense_records',
        contractorId:   r.contractor_id,
        contractorName: r.contractors?.name ?? r.contractor_id,
        date:           r.date ?? r.expense_date ?? '',
        reason:         '立替金3万超',
        value:          r.amount_actual,
        status:         'pending_review',
      })
    }
  }

  return results
}

// ================================================================
// ④ インボイス公表サイト警告（モック）
//    invoice_status = 'expired' または invoice_registration_type = 'registered'
//    かつ invoice_number が未設定のケースを警告対象とする
// ================================================================
async function fetchInvoiceWarnings(): Promise<InvoiceWarningRow[]> {
  const tenantId = await getCurrentTenantId()
  const db = createServiceClient() as any

  const { data } = await db
    .from('contractors')
    .select('id, name, invoice_number, invoice_status, invoice_registration_type')
    .eq('invoice_registration_type', 'registered')
    .eq('tenant_id', tenantId)

  if (!data?.length) return []

  return (data as any[])
    .filter((r: any) =>
      r.invoice_status === 'expired' ||
      r.invoice_status === 'invalid' ||
      !r.invoice_number,
    )
    .map((r: any) => ({
      contractorId:      r.id,
      contractorName:    r.name,
      invoiceNumber:     r.invoice_number ?? null,
      invoiceStatus:     r.invoice_status ?? null,
      registrationType:  r.invoice_registration_type,
    }))
}

// ================================================================
// ⑤ 長期間未承認: 送信後48時間以上 approval_status='pending' の支払通知書
// ================================================================
export async function getPendingNotices(): Promise<ActionResult<PendingNoticeRow[]>> {
  try {
    return { data: await fetchLongPendingNotices(), error: null }
  } catch (e) {
    return { data: null, error: e instanceof Error ? e.message : '未承認通知書の取得に失敗しました' }
  }
}

async function fetchLongPendingNotices(): Promise<PendingNoticeRow[]> {
  const db = createServiceClient() as any

  const threshold = new Date(Date.now() - 48 * 60 * 60 * 1000).toISOString()

  const { data } = await db
    .from('payment_notices')
    .select(`
      id, contractor_id, notice_month, approval_status, created_at,
      contractors ( id, name, phone, email )
    `)
    .eq('approval_status', 'pending')
    .lt('created_at', threshold)
    .order('created_at', { ascending: true })

  if (!data?.length) return []

  const now = Date.now()
  return (data as any[]).map((r: any) => {
    const hoursElapsed = Math.floor(
      (now - new Date(r.created_at).getTime()) / (1000 * 60 * 60),
    )
    return {
      noticeId:       r.id,
      contractorId:   r.contractor_id,
      contractorName: r.contractors?.name  ?? r.contractor_id,
      phone:          r.contractors?.phone ?? null,
      email:          r.contractors?.email ?? null,
      targetMonth:    r.notice_month ?? '',
      createdAt:      r.created_at,
      hoursElapsed,
    }
  })
}

// ================================================================
// getDefensiveAlerts
// 5種のアラートを並列取得して返す統合エントリーポイント
// ================================================================
export async function getDefensiveAlerts(): Promise<ActionResult<DefensiveAlerts>> {
  try {
    const [
      missingRes,
      duplicatesRes,
      thresholds,
      invoiceWarnings,
      pendingNotices,
    ] = await Promise.all([
      getMissingInputs(),
      getDuplicateInputs(),
      fetchAndLockThresholdViolations(),
      fetchInvoiceWarnings(),
      fetchLongPendingNotices(),
    ])

    const missingInputs = missingRes.data  ?? []
    const duplicates    = duplicatesRes.data ?? []

    const totalCount =
      missingInputs.length +
      duplicates.length +
      thresholds.length +
      invoiceWarnings.length +
      pendingNotices.length

    return {
      data: {
        missingInputs,
        duplicates,
        thresholds,
        invoiceWarnings,
        pendingNotices,
        totalCount,
      },
      error: null,
    }
  } catch (e) {
    return { data: null, error: e instanceof Error ? e.message : 'アラート取得に失敗しました' }
  }
}

// ================================================================
// resolveDuplicateRecord
// 重複した work_records の不要な1件を削除する
// ================================================================
export async function resolveDuplicateRecord(
  recordId: string,
): Promise<ActionResult> {
  const tenantId = await getCurrentTenantId()
  const db = createServiceClient() as any

  const { error } = await db
    .from('work_records')
    .delete()
    .eq('id', recordId)
    .eq('tenant_id', tenantId)

  if (error) return { data: null, error: error.message }

  revalidatePath('/admin/dashboard')
  revalidatePath('/admin/sales')
  return { data: undefined, error: null }
}

// ================================================================
// reviewThresholdRecord
// 親分が「確認済み」を押したとき: pending_review → pending に戻す
// ================================================================
export async function reviewThresholdRecord(
  table: 'work_records' | 'expense_records',
  id: string,
): Promise<ActionResult> {
  const db = createServiceClient() as any

  const { error } = await db
    .from(table)
    .update({ status: 'pending' })
    .eq('id', id)
    .eq('status', 'pending_review')

  if (error) return { data: null, error: error.message }

  revalidatePath('/admin/dashboard')
  revalidatePath('/admin/sales')
  return { data: undefined, error: null }
}
