'use server'

import { createClient } from '@/utils/supabase/server'
import { createServiceClient } from '@/utils/supabase/service'

type ActionResult<T = void> =
  | { data: T; error: null }
  | { data: null; error: string }

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
  id:              string
  noticeMonth:     string   // 'YYYY-MM-DD' (月初日)
  laborNet:        number
  laborTax:        number
  expenseNet:      number
  expenseTax:      number
  deductionRate:   number
  deduction:       number
  totalAmount:     number
  approvalStatus:  string   // 'pending' | 'approved'
  locked:          boolean
}

export async function fetchMyPaymentNotices(): Promise<ActionResult<MyPaymentNotice[]>> {
  const supabase = await createClient()
  const { data: { user }, error: authErr } = await supabase.auth.getUser()
  if (authErr || !user) return { data: null, error: '未ログインです' }

  const contractorId = await resolveContractorId(user.id, user.email ?? undefined)
  if (!contractorId) return { data: null, error: '委託先レコードが見つかりません' }

  const service = createServiceClient()
  const { data, error } = await service
    .from('payment_notices')
    .select(
      'id, notice_month, labor_tax_excluded, labor_tax, expense_tax_excluded, expense_tax, deduction_rate, deduction, total_amount, approval_status, locked',
    )
    .eq('contractor_id', contractorId)
    .order('notice_month', { ascending: false })
    .limit(12)

  if (error) return { data: null, error: error.message }

  const rows: MyPaymentNotice[] = (data ?? []).map(r => ({
    id:             r.id,
    noticeMonth:    r.notice_month,
    laborNet:       r.labor_tax_excluded,
    laborTax:       r.labor_tax,
    expenseNet:     r.expense_tax_excluded,
    expenseTax:     r.expense_tax,
    deductionRate:  Number(r.deduction_rate),
    deduction:      r.deduction,
    totalAmount:    r.total_amount,
    approvalStatus: r.approval_status,
    locked:         r.locked,
  }))

  return { data: rows, error: null }
}

// ── 支払通知書の承認 ─────────────────────────────────────

/**
 * 子分が自分の支払通知書に合意・承認する。
 * - contractor_id の一致を確認（他人の notice を承認不可）
 * - approval_status を 'approved' に更新
 * - approval_history に監査ログを INSERT
 */
export async function approvePaymentNotice(noticeId: string): Promise<ActionResult> {
  const supabase = await createClient()
  const { data: { user }, error: authErr } = await supabase.auth.getUser()
  if (authErr || !user) return { data: null, error: '未ログインです' }

  const contractorId = await resolveContractorId(user.id, user.email ?? undefined)
  if (!contractorId) return { data: null, error: '委託先レコードが見つかりません' }

  const service = createServiceClient()

  // 所有権バリデーション：自分の notice だけ承認可能
  const { data: notice, error: fetchErr } = await service
    .from('payment_notices')
    .select('id, contractor_id, approval_status, locked, total_amount')
    .eq('id', noticeId)
    .eq('contractor_id', contractorId)   // 他人の notice は取得不可
    .single()

  if (fetchErr || !notice) {
    return { data: null, error: '対象の支払通知書が見つかりません' }
  }
  if (notice.approval_status === 'approved') {
    return { data: null, error: 'すでに承認済みです' }
  }
  if (notice.locked) {
    return { data: null, error: '支払通知書はロック済みです。親分に確認してください。' }
  }

  // approval_status を approved に更新
  const { error: updateErr } = await service
    .from('payment_notices')
    .update({ approval_status: 'approved' })
    .eq('id', noticeId)
    .eq('contractor_id', contractorId)

  if (updateErr) return { data: null, error: updateErr.message }

  // 監査ログを approval_history に INSERT（変更・削除不可）
  const { error: logErr } = await service
    .from('approval_history')
    .insert({
      target_type:  'payment_notice',
      target_id:    noticeId,
      action_type:  'driver_approval',
      operator_id:  user.id,
      amount_after: notice.total_amount,
      memo:         '子分によるスマホからの承認',
    })

  if (logErr) return { data: null, error: `承認は完了しましたが監査ログの記録に失敗しました: ${logErr.message}` }

  return { data: undefined, error: null }
}
