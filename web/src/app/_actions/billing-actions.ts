'use server'

import { createClient } from '@/utils/supabase/server'
import { createServiceClient } from '@/utils/supabase/service'
import { calculateInvoiceTax, type TaxItem } from '@/utils/billing/taxCalculator'
import { getCurrentTenantId } from '@/utils/tenant'

type ActionResult<T = void> =
  | { data: T; error: null }
  | { data: null; error: string }

// ── 日付ユーティリティ ────────────────────────────────────────

function monthStart(yearMonth: string): Date {
  const [y, m] = yearMonth.split('-').map(Number)
  return new Date(y, m - 1, 1)
}

function monthEnd(yearMonth: string): Date {
  const [y, m] = yearMonth.split('-').map(Number)
  return new Date(y, m, 0, 23, 59, 59)
}

/** 締め日ベースの期間算出（billing/actions.ts の closingRange と同ロジック） */
function closingRange(yearMonth: string, closingDay: string): { from: Date; to: Date } {
  const [y, m] = yearMonth.split('-').map(Number)
  const isLastDay = closingDay === '月末' || closingDay === '末日' || closingDay === '99'
  const day = isLastDay ? 0 : Number(closingDay)

  const toDate   = isLastDay ? new Date(y, m, 0)     : new Date(y, m - 1, day)
  const fromDate = isLastDay ? new Date(y, m - 1, 1) : new Date(y, m - 2, day + 1)

  return { from: fromDate, to: toDate }
}

/** 支払期日 = 請求月最終日 + paymentSite 日 */
function calcDueDate(invoiceMonthEnd: Date, paymentSite: number): Date {
  const due = new Date(invoiceMonthEnd)
  due.setDate(due.getDate() + paymentSite)
  return due
}

// ── 監査ログ挿入（approval_history は UPDATE/DELETE 禁止テーブル） ─
// approval_history のカラム: payment_notice_id / action_by / action_type / unlock_reason

async function insertPaymentNoticeAuditLog(
  service: ReturnType<typeof createServiceClient>,
  params: {
    paymentNoticeId: string
    actionType:      string
    actionBy:        string
    unlockReason?:   string | null
  },
): Promise<void> {
  const { error } = await service
    .from('approval_history')
    .insert({
      payment_notice_id: params.paymentNoticeId,
      action_type:       params.actionType,
      action_by:         params.actionBy,
      unlock_reason:     params.unlockReason ?? null,
    })

  if (error) {
    throw new Error(`監査ログの記録に失敗しました: ${error.message}`)
  }
}

// ── 請求書確定（invoices テーブルへのスナップショット書き込み） ─

async function finalizeInvoice(
  service: ReturnType<typeof createServiceClient>,
  yearMonth: string,
  clientId: string,
  opts: { userId: string; isDeveloperUnlock?: boolean; unlockReason?: string },
): Promise<ActionResult> {
  const tenantId = await getCurrentTenantId()
  // 荷主情報取得
  const { data: client, error: clientErr } = await service
    .from('clients')
    .select('id, company_name, tax_type, invoice_registered, closing_day, payment_site')
    .eq('id', clientId)
    .eq('tenant_id', tenantId)
    .single()

  if (clientErr || !client) {
    return { data: null, error: clientErr?.message ?? '荷主が見つかりません' }
  }

  // 既存請求書のロックチェック（issued / paid は変更禁止）
  const invoiceMonthDate = monthStart(yearMonth).toISOString().slice(0, 10)
  const { data: existing } = await service
    .from('invoices')
    .select('id, status, total_amount')
    .eq('client_id', clientId)
    .eq('invoice_month', invoiceMonthDate)
    .maybeSingle()

  const isLocked = existing && (existing.status === 'issued' || existing.status === 'paid')
  if (isLocked) {
    if (!opts.isDeveloperUnlock || !opts.unlockReason) {
      return {
        data: null,
        error: `請求書はすでに「${existing.status}」状態のため変更できません。開発者アンロックが必要です。`,
      }
    }
    // invoices は approval_history に FK がないため監査ログは記録しない
  }

  // 締め日ベースの対象期間
  const { from, to } = closingRange(yearMonth, client.closing_day)

  // 対象 work_records を取得
  const { data: workRows, error: wrErr } = await service
    .from('work_records')
    .select('tax_excluded_sales, work_date, projects!inner( client_id )')
    .eq('projects.client_id', clientId)
    .eq('tenant_id', tenantId)
    .gte('work_date', from.toISOString().slice(0, 10))
    .lte('work_date', to.toISOString().slice(0, 10))

  if (wrErr) return { data: null, error: wrErr.message }

  const isTaxable = client.tax_type !== 'exempt'
  const items: TaxItem[] = (workRows ?? []).map((r) => ({
    amount: (r as Record<string, unknown> & { tax_excluded_sales: number }).tax_excluded_sales,
    isTaxable,
  }))

  const result = calculateInvoiceTax(items, client.invoice_registered, to)
  const dueDate = calcDueDate(to, client.payment_site)

  const newTotalAmount = result.finalAmount

  const { error: upsertErr } = await service
    .from('invoices')
    .upsert(
      {
        client_id:          clientId,
        invoice_month:      invoiceMonthDate,
        total_tax_excluded: result.subtotal,
        consumption_tax:    result.taxAmount,
        total_amount:       newTotalAmount,
        due_date:           dueDate.toISOString().slice(0, 10),
        status:             'draft',
      },
      { onConflict: 'client_id,invoice_month' },
    )

  if (upsertErr) return { data: null, error: upsertErr.message }

  return { data: undefined, error: null }
}

// ── 支払通知書確定（payment_notices テーブルへのスナップショット書き込み） ─

async function finalizePaymentNotice(
  service: ReturnType<typeof createServiceClient>,
  yearMonth: string,
  contractorId: string,
  opts: { userId: string; isDeveloperUnlock?: boolean; unlockReason?: string },
): Promise<ActionResult> {
  const tenantId = await getCurrentTenantId()
  // 委託先情報取得
  const { data: contractor, error: ctErr } = await service
    .from('contractors')
    .select('id, tax_type, invoice_registration_type')
    .eq('id', contractorId)
    .eq('tenant_id', tenantId)
    .single()

  if (ctErr || !contractor) {
    return { data: null, error: ctErr?.message ?? '委託先が見つかりません' }
  }

  const noticeMonthDate = monthStart(yearMonth).toISOString().slice(0, 10)

  // ── 3段構えのロックチェック ────────────────────────────────
  // 段1: 既存レコードの存在確認
  const { data: existingNotice } = await service
    .from('payment_notices')
    .select('id, approval_status, locked, total_amount')
    .eq('contractor_id', contractorId)
    .eq('notice_month', noticeMonthDate)
    .maybeSingle()

  // 段2: 承認済み or ロック確認
  const isLocked =
    existingNotice &&
    (existingNotice.approval_status === 'approved' || existingNotice.locked === true)

  if (isLocked) {
    // 段3: 開発者アンロックの意志と理由が揃っていない場合は拒否
    if (!opts.isDeveloperUnlock || !opts.unlockReason) {
      return {
        data: null,
        error:
          '支払通知書はロック済みのため変更できません。' +
          'isDeveloperUnlock=true および unlockReason の入力が必要です。',
      }
    }

    // 開発者アンロックが有効 → 逃げられない証跡を approval_history に刻む
    await insertPaymentNoticeAuditLog(service, {
      paymentNoticeId: existingNotice.id,
      actionType:      'developer_unlock',
      actionBy:        opts.userId,
      unlockReason:    opts.unlockReason,
    })
  }

  // ── データ集計 ───────────────────────────────────────────────
  const from = monthStart(yearMonth).toISOString().slice(0, 10)
  const to   = monthEnd(yearMonth).toISOString().slice(0, 10)

  const { data: workRows, error: wrErr } = await service
    .from('work_records')
    .select('tax_excluded_payment, work_date')
    .eq('contractor_id', contractorId)
    .eq('tenant_id', tenantId)
    .gte('work_date', from)
    .lte('work_date', to)

  if (wrErr) return { data: null, error: wrErr.message }

  const { data: expenseRows, error: exErr } = await service
    .from('expense_records')
    .select('amount_tax_excluded, tax_category, expense_date')
    .eq('contractor_id', contractorId)
    .eq('tenant_id', tenantId)
    .gte('expense_date', from)
    .lte('expense_date', to)

  if (exErr) return { data: null, error: exErr.message }

  const isRegistered    = contractor.invoice_registration_type === 'registered'
  const isLaborTaxable  = (contractor.tax_type ?? 'exclusive') !== 'exempt'
  const targetDate      = monthEnd(yearMonth)

  const laborItems: TaxItem[] = (workRows ?? []).map((r) => ({
    amount: (r as Record<string, unknown> & { tax_excluded_payment: number }).tax_excluded_payment,
    isTaxable: isLaborTaxable,
  }))
  const laborResult = calculateInvoiceTax(laborItems, isRegistered, targetDate)

  const expenseItems: TaxItem[] = (expenseRows ?? []).map((r) => ({
    amount:    (r as Record<string, unknown> & { amount_tax_excluded: number }).amount_tax_excluded,
    isTaxable: (r as Record<string, unknown> & { tax_category: string }).tax_category === 'taxable_10',
  }))
  const expenseResult = calculateInvoiceTax(expenseItems, isRegistered, targetDate)

  const totalDeductionRate = laborResult.deductionRate
  const totalDeduction     = laborResult.deductionAmount + expenseResult.deductionAmount
  const newTotalAmount     =
    laborResult.subtotal + laborResult.taxAmount +
    expenseResult.subtotal + expenseResult.taxAmount -
    totalDeduction

  const { error: upsertErr } = await service
    .from('payment_notices')
    .upsert(
      {
        contractor_id:        contractorId,
        notice_month:         noticeMonthDate,
        target_month:         noticeMonthDate,
        status:               'locked',
        labor_tax_excluded:   laborResult.subtotal,
        labor_tax:            laborResult.taxAmount,
        deduction_rate:       totalDeductionRate,
        deduction:            totalDeduction,
        expense_tax_excluded: expenseResult.subtotal,
        expense_tax:          expenseResult.taxAmount,
        total_amount:         newTotalAmount,
        approval_status:      'pending',
        locked:               false,
      },
      { onConflict: 'contractor_id,notice_month' },
    )

  if (upsertErr) return { data: null, error: upsertErr.message }

  // アンロック後の上書き完了ログ
  if (isLocked && existingNotice) {
    await insertPaymentNoticeAuditLog(service, {
      paymentNoticeId: existingNotice.id,
      actionType:      'overwrite_after_unlock',
      actionBy:        opts.userId,
      unlockReason:    opts.unlockReason ?? null,
    })
  }

  return { data: undefined, error: null }
}

// ── 公開 Server Action ────────────────────────────────────────

export type FinalizeTarget =
  | {
      type: 'invoice'
      yearMonth: string
      clientId:  string
      isDeveloperUnlock?: boolean
      unlockReason?:      string
    }
  | {
      type: 'payment_notice'
      yearMonth:     string
      contractorId:  string
      isDeveloperUnlock?: boolean
      unlockReason?:      string
    }

/**
 * 請求書または支払通知書を確定しスナップショットをDBに書き込む。
 *
 * 3段構えの保護ロジック:
 *   段1 既存レコードの有無確認
 *   段2 approved / locked 状態チェック → ロック中は通常更新を拒否
 *   段3 isDeveloperUnlock=true + unlockReason 必須 → 通過時は approval_history に証跡を記録
 */
export async function finalizeInvoiceAndNotice(
  target: FinalizeTarget,
): Promise<ActionResult> {
  // 認証チェック
  const supabase = await createClient()
  const { data: { user }, error: authErr } = await supabase.auth.getUser()
  if (authErr || !user) return { data: null, error: '認証が必要です' }

  const service = createServiceClient()
  const opts = {
    userId:            user.id,
    isDeveloperUnlock: target.isDeveloperUnlock,
    unlockReason:      target.unlockReason,
  }

  if (target.type === 'invoice') {
    return finalizeInvoice(service, target.yearMonth, target.clientId, opts)
  } else {
    return finalizePaymentNotice(service, target.yearMonth, target.contractorId, opts)
  }
}
