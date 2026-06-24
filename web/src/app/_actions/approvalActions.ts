'use server'

import { createServiceClient } from '@/utils/supabase/service'
import { getCurrentTenantId } from '@/utils/tenant'
import { revalidatePath } from 'next/cache'

type ActionResult<T = void> =
  | { data: T;    error: null }
  | { data: null; error: string }

// ── 型定義 ──────────────────────────────────────────────────

export type PendingPaymentNoticeRow = {
  noticeId:       string
  contractorId:   string
  contractorName: string
  phone:          string | null
  email:          string | null
  targetMonth:    string
  totalAmount:    number
  approvalStatus: string
  createdAt:      string
  hoursElapsed:   number
}

export type PendingWorkRecordRow = {
  id:             string
  contractorId:   string
  contractorName: string
  projectName:    string
  date:           string
  reason:         string
  value:          number
}

export type ApprovalHistoryRow = {
  id:              string
  paymentNoticeId: string
  contractorName:  string
  targetMonth:     string
  actionType:      string
  actionBy:        string
  unlockReason:    string | null
  createdAt:       string
}

export type ApprovalSummary = {
  paymentNotices: { pending: number; approved: number; rejected: number }
  workRecords:    { pendingReview: number; approved: number }
  expenses:       { pending: number; approved: number; rejected: number }
}

// ================================================================
// fetchPendingPaymentNotices
// approval_status が pending または unapproved の支払通知書一覧
// ================================================================
export async function fetchPendingPaymentNotices(): Promise<ActionResult<PendingPaymentNoticeRow[]>> {
  try {
    const db  = createServiceClient() as any
    const now = Date.now()

    const { data, error } = await db
      .from('payment_notices')
      .select(`
        id, contractor_id, notice_month, approval_status, total_amount, created_at,
        contractors ( id, name, phone, email )
      `)
      .in('approval_status', ['pending', 'unapproved'])
      .order('created_at', { ascending: true })

    if (error) return { data: null, error: error.message }
    if (!data?.length) return { data: [], error: null }

    return {
      data: (data as any[]).map((r: any) => ({
        noticeId:       r.id,
        contractorId:   r.contractor_id,
        contractorName: r.contractors?.name  ?? r.contractor_id,
        phone:          r.contractors?.phone ?? null,
        email:          r.contractors?.email ?? null,
        targetMonth:    r.notice_month ?? '',
        totalAmount:    r.total_amount ?? 0,
        approvalStatus: r.approval_status,
        createdAt:      r.created_at,
        hoursElapsed:   Math.floor((now - new Date(r.created_at).getTime()) / (1000 * 60 * 60)),
      })),
      error: null,
    }
  } catch (e) {
    return { data: null, error: e instanceof Error ? e.message : '支払通知書の取得に失敗しました' }
  }
}

// ================================================================
// approvePaymentNotice / rejectPaymentNotice
// 支払通知書の承認・却下 + 監査ログ記録
// ================================================================
export async function approvePaymentNotice(noticeId: string): Promise<ActionResult> {
  const db = createServiceClient() as any
  const { error } = await db
    .from('payment_notices')
    .update({ approval_status: 'approved' })
    .eq('id', noticeId)
    .in('approval_status', ['pending', 'unapproved'])

  if (error) return { data: null, error: error.message }

  await db.from('approval_history').insert({
    payment_notice_id: noticeId,
    action_type:       'approve',
    action_by:         'admin',
    unlock_reason:     null,
  })

  revalidatePath('/admin/approval')
  return { data: undefined, error: null }
}

export async function rejectPaymentNotice(noticeId: string): Promise<ActionResult> {
  const db = createServiceClient() as any
  const { error } = await db
    .from('payment_notices')
    .update({ approval_status: 'rejected' })
    .eq('id', noticeId)
    .in('approval_status', ['pending', 'unapproved'])

  if (error) return { data: null, error: error.message }

  await db.from('approval_history').insert({
    payment_notice_id: noticeId,
    action_type:       'reject',
    action_by:         'admin',
    unlock_reason:     null,
  })

  revalidatePath('/admin/approval')
  return { data: undefined, error: null }
}

// ================================================================
// fetchPendingWorkRecords
// status = 'pending_review' の勤務記録一覧
// ================================================================
export async function fetchPendingWorkRecords(): Promise<ActionResult<PendingWorkRecordRow[]>> {
  try {
    const tenantId = await getCurrentTenantId()
    const db       = createServiceClient() as any

    const { data, error } = await db
      .from('work_records')
      .select(`
        id, contractor_id, date, work_date, piece_count, status,
        contractors ( id, name ),
        projects    ( id, project_name, name )
      `)
      .eq('status', 'pending_review')
      .eq('tenant_id', tenantId)
      .order('date', { ascending: false })

    if (error) return { data: null, error: error.message }
    if (!data?.length) return { data: [], error: null }

    return {
      data: (data as any[]).map((r: any) => ({
        id:             r.id,
        contractorId:   r.contractor_id,
        contractorName: r.contractors?.name ?? r.contractor_id,
        projectName:    r.projects?.project_name ?? r.projects?.name ?? '—',
        date:           r.date ?? r.work_date ?? '',
        reason:         '個数100超',
        value:          r.piece_count ?? 0,
      })),
      error: null,
    }
  } catch (e) {
    return { data: null, error: e instanceof Error ? e.message : '勤務記録の取得に失敗しました' }
  }
}

// ================================================================
// fetchApprovalHistory
// approval_history 最新100件（JOIN で委託先名・対象月を付加）
// ================================================================
export async function fetchApprovalHistory(): Promise<ActionResult<ApprovalHistoryRow[]>> {
  try {
    const db = createServiceClient() as any

    const { data, error } = await db
      .from('approval_history')
      .select(`
        id, payment_notice_id, action_type, action_by, unlock_reason, created_at,
        payment_notices (
          notice_month,
          contractors ( name )
        )
      `)
      .order('created_at', { ascending: false })
      .limit(100)

    if (error) return { data: null, error: error.message }

    return {
      data: (data ?? []).map((r: any) => ({
        id:              r.id,
        paymentNoticeId: r.payment_notice_id,
        contractorName:  r.payment_notices?.contractors?.name ?? '—',
        targetMonth:     r.payment_notices?.notice_month?.slice(0, 7) ?? '—',
        actionType:      r.action_type,
        actionBy:        r.action_by,
        unlockReason:    r.unlock_reason ?? null,
        createdAt:       r.created_at,
      })),
      error: null,
    }
  } catch (e) {
    return { data: null, error: e instanceof Error ? e.message : '承認履歴の取得に失敗しました' }
  }
}

// ================================================================
// getApprovalSummary
// cashflow 承認進捗タブ用の集計（yearMonth 指定）
// ================================================================
export async function getApprovalSummary(yearMonth: string): Promise<ActionResult<ApprovalSummary>> {
  try {
    const tenantId  = await getCurrentTenantId()
    const db        = createServiceClient() as any
    const monthStart = `${yearMonth}-01`
    const [y, m]    = yearMonth.split('-').map(Number)
    const monthEnd  = new Date(y, m, 0).toISOString().slice(0, 10)

    const [pnRes, wrRes, exRes] = await Promise.all([
      // 支払通知書 (notice_month で月絞り込み)
      db.from('payment_notices')
        .select('approval_status')
        .gte('notice_month', monthStart)
        .lte('notice_month', monthEnd),

      // 勤務記録 (pending_review)
      db.from('work_records')
        .select('status')
        .eq('tenant_id', tenantId)
        .gte('date', monthStart)
        .lte('date', monthEnd),

      // 立替金
      db.from('expense_records')
        .select('approval_status')
        .eq('tenant_id', tenantId)
        .gte('expense_date', monthStart)
        .lte('expense_date', monthEnd),
    ])

    const pnRows  = (pnRes.data ?? []) as any[]
    const wrRows  = (wrRes.data ?? []) as any[]
    const exRows  = (exRes.data ?? []) as any[]

    const count = <T extends { [k: string]: any }>(arr: T[], key: keyof T, val: string) =>
      arr.filter(r => r[key] === val).length

    return {
      data: {
        paymentNotices: {
          pending:  count(pnRows, 'approval_status', 'pending') + count(pnRows, 'approval_status', 'unapproved'),
          approved: count(pnRows, 'approval_status', 'approved'),
          rejected: count(pnRows, 'approval_status', 'rejected'),
        },
        workRecords: {
          pendingReview: count(wrRows, 'status', 'pending_review'),
          approved:      count(wrRows, 'status', 'approved'),
        },
        expenses: {
          pending:  count(exRows, 'approval_status', 'pending'),
          approved: count(exRows, 'approval_status', 'approved'),
          rejected: count(exRows, 'approval_status', 'rejected'),
        },
      },
      error: null,
    }
  } catch (e) {
    return { data: null, error: e instanceof Error ? e.message : '集計に失敗しました' }
  }
}
