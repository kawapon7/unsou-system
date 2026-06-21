'use server'

import { createClient } from '@/utils/supabase/server'
import { createServiceClient } from '@/utils/supabase/service'

type ActionResult<T = void> =
  | { data: T; error: null }
  | { data: null; error: string }

// dev bypass 用テスト委託先ID（鈴木次郎・免税）
const DEV_CONTRACTOR_ID = 'cc31ee16-660a-42db-acb4-05f148a3fce8'

// ── ログイン中の子分に紐づく contractor_id を取得 ─────────

async function resolveContractorId(userId: string, userEmail: string | undefined): Promise<string | null> {
  const service = createServiceClient()

  // users テーブルの contractor_id を優先
  const { data: userRow } = await service
    .from('users')
    .select('contractor_id')
    .eq('id', userId)
    .maybeSingle()

  if (userRow?.contractor_id) return userRow.contractor_id

  // フォールバック: email で contractors を直接検索
  if (userEmail) {
    const { data: contractor } = await service
      .from('contractors')
      .select('id')
      .eq('email', userEmail)
      .maybeSingle()
    if (contractor?.id) return contractor.id
  }

  return null
}

// ── 支払通知書一覧取得（自分のものだけ） ─────────────────

export type MyPaymentNotice = {
  id:             string
  noticeMonth:    string   // 'YYYY-MM-DD' (月初日)
  laborNet:       number
  laborTax:       number
  expenseNet:     number
  expenseTax:     number
  deductionRate:  number
  deduction:      number
  totalAmount:    number
  approvalStatus: string   // 'unapproved' | 'approved' | 'locked'
  locked:         boolean
}

export async function fetchMyPaymentNotices(): Promise<ActionResult<MyPaymentNotice[]>> {
  let contractorId: string | null

  if (process.env.NODE_ENV === 'development') {
    contractorId = DEV_CONTRACTOR_ID
  } else {
    const supabase = await createClient()
    const { data: { user }, error: authErr } = await supabase.auth.getUser()
    if (authErr || !user) return { data: null, error: '未ログインです' }
    contractorId = await resolveContractorId(user.id, user.email ?? undefined)
    if (!contractorId) return { data: null, error: '委託先レコードが見つかりません' }
  }

  const service = createServiceClient()
  const db = service as any

  const { data, error } = await db
    .from('payment_notices')
    .select(
      'id, notice_month, subtotal_registered, tax_registered, subtotal_unregistered, tax_unregistered, deduction_unregistered, subtotal_exempt, total_excluding_tax, total_tax, total_deduction, approval_status',
    )
    .eq('contractor_id', contractorId)
    .order('notice_month', { ascending: false })
    .limit(12)

  if (error) return { data: null, error: error.message }

  const rows: MyPaymentNotice[] = (data ?? []).map((r: any) => {
    const laborNet  = Number(r.subtotal_registered ?? 0) + Number(r.subtotal_unregistered ?? 0) + Number(r.subtotal_exempt ?? 0)
    const laborTax  = Number(r.tax_registered ?? 0) + Number(r.tax_unregistered ?? 0)
    const totalEx   = Number(r.total_excluding_tax ?? 0)
    const totalTax  = Number(r.total_tax ?? 0)
    const deduction = Number(r.total_deduction ?? 0)
    // 経過措置控除率: deduction / laborTax から逆算（0除算ガード）
    const deductionRate = laborTax > 0 ? Math.round((deduction / laborTax) * 100) / 100 : 0

    return {
      id:             r.id,
      noticeMonth:    r.notice_month,
      laborNet,
      laborTax,
      expenseNet:     Math.max(0, totalEx  - laborNet),
      expenseTax:     Math.max(0, totalTax - laborTax),
      deductionRate,
      deduction,
      totalAmount:    totalEx + totalTax - deduction,
      approvalStatus: r.approval_status ?? 'unapproved', // デフォルトは未承認状態
      locked:         r.approval_status === 'approved',
    }
  })

  return { data: rows, error: null }
}

// ── 支払通知書の承認 ─────────────────────────────────────

/**
 * 子分が自分の支払通知書に合意・承認する。
 * - contractor_id の一致を確認（他人の notice を承認不可）
 * - status を 'locked' に更新（承認確定）
 * - approval_history に監査ログを INSERT（ベストエフォート）
 */
export async function approvePaymentNotice(noticeId: string): Promise<ActionResult> {
  let contractorId: string | null
  let userId: string

  if (process.env.NODE_ENV === 'development') {
    contractorId = DEV_CONTRACTOR_ID
    userId = '00000000-0000-0000-0000-000000000000'  // dev dummy user ID
  } else {
    const supabase = await createClient()
    const { data: { user }, error: authErr } = await supabase.auth.getUser()
    if (authErr || !user) return { data: null, error: '未ログインです' }
    contractorId = await resolveContractorId(user.id, user.email ?? undefined)
    if (!contractorId) return { data: null, error: '委託先レコードが見つかりません' }
    userId = user.id
  }

  const service = createServiceClient()
  const db = service as any

  // 所有権バリデーション（自分の notice だけ操作可能）
  const { data: notice, error: fetchErr } = await db
    .from('payment_notices')
    .select('id, contractor_id, status')
    .eq('id', noticeId)
    .eq('contractor_id', contractorId)
    .single()

  if (fetchErr || !notice) {
    return { data: null, error: '対象の支払通知書が見つかりません' }
  }
  if (notice.status === 'locked') {
    return { data: null, error: 'すでに承認済みです' }
  }

  // status を 'locked' に更新（driver 承認確定）
  const { error: updateErr } = await db
    .from('payment_notices')
    .update({ status: 'locked' })
    .eq('id', noticeId)
    .eq('contractor_id', contractorId)

  if (updateErr) return { data: null, error: updateErr.message }

  // 監査ログ（ベストエフォート: 失敗しても承認自体は成功扱い）
  await db
    .from('approval_history')
    .insert({
      payment_notice_id: noticeId,
      action_type:       'driver_approval',
      action_by:         userId,
    })

  return { data: undefined, error: null }
}
