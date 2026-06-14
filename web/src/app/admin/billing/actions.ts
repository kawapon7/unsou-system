'use server'

import { createServiceClient } from '@/utils/supabase/service'
import type { Database } from '@/types/supabase'
import { getCurrentTenantId } from '@/utils/tenant'

type ClientRow     = Database['public']['Tables']['clients']['Row']
type ContractorRow = Database['public']['Tables']['contractors']['Row']

// ── 締め日ユーティリティ ───────────────────────────────────

/**
 * 締め日文字列（"20", "25", "月末" 等）と年月から締め期間を算出。
 * 例: yearMonth=2026-06, closingDay=20 → 2026-05-21 〜 2026-06-20
 */
function closingRange(yearMonth: string, closingDay: string): { from: Date; to: Date } {
  const [y, m] = yearMonth.split('-').map(Number)

  const isLastDay = closingDay === '月末' || closingDay === '末日' || closingDay === '99'
  const day = isLastDay ? 0 : Number(closingDay)

  const toDate = isLastDay
    ? new Date(y, m, 0)
    : new Date(y, m - 1, day)

  const fromDate = isLastDay
    ? new Date(y, m - 1, 1)
    : new Date(y, m - 2, day + 1)

  return { from: fromDate, to: toDate }
}

/** 当月の開始・終了を返す（contractors 用: closing_day がない） */
function monthRange(yearMonth: string): { from: Date; to: Date } {
  const [y, m] = yearMonth.split('-').map(Number)
  return {
    from: new Date(y, m - 1, 1),
    to:   new Date(y, m, 0, 23, 59, 59),
  }
}

// ── 税額計算 ──────────────────────────────────────────────

function calcTax(amount: number, taxType: string): number {
  if (taxType === 'exclusive') return Math.floor(amount * 0.1)
  if (taxType === 'inclusive') return Math.floor(amount - amount / 1.1)
  return 0
}

/** 源泉徴収税額（支払運賃の 10.21%、1円未満切り捨て） */
function calcWithholding(amount: number): number {
  return Math.floor(amount * 0.1021)
}

// ── 戻り値型 ──────────────────────────────────────────────

export type BillingRow = {
  clientId:          string
  companyName:       string
  taxType:           string
  invoiceRegistered: boolean
  closingDay:        string
  paymentSite:       number
  projectCount:      number
  saleAmountNet:     number
  taxAmount:         number
  totalGross:        number
}

export type PaymentRow = {
  contractorId:       string
  name:               string
  taxType:            string
  invoiceType:        string
  invoiceNumber:      string | null
  withholdingTaxFlag: boolean
  paymentSite:        number
  projectCount:       number
  buyAmountNet:       number
  taxAmount:          number
  withholdingTax:     number
  netPayment:         number
}

type ActionResult<T> = { data: T; error: null } | { data: null; error: string }

// ── JOIN 結果の型 ──────────────────────────────────────────

type WorkRecordForBilling = {
  id:        string
  work_date: string
  projects: {
    client_id:   string
    price_rules: { selling_price: number }[]
    clients:     Pick<ClientRow, 'id' | 'company_name' | 'tax_type' | 'invoice_registered' | 'closing_day' | 'payment_site'> | null
  } | null
}

type WorkRecordForPayment = {
  id:            string
  work_date:     string
  contractor_id: string
  projects: {
    price_rules: { buying_price: number }[]
  } | null
  contractors: (Pick<ContractorRow, 'id' | 'name' | 'invoice_registration_type' | 'payment_site'> & {
    tax_category:    string
    has_withholding: boolean
    invoice_number:  string | null
  }) | null
}

// ── 荷主向け請求集計 ──────────────────────────────────────

export async function fetchBillingByClient(
  yearMonth: string,
): Promise<ActionResult<BillingRow[]>> {
  const tenantId = await getCurrentTenantId()
  const supabase = createServiceClient()
  const { from, to } = monthRange(yearMonth)

  const { data, error } = await supabase
    .from('work_records')
    .select(`
      id,
      work_date,
      projects (
        client_id,
        price_rules ( selling_price ),
        clients (
          id,
          company_name,
          tax_type,
          invoice_registered,
          closing_day,
          payment_site
        )
      )
    `)
    .eq('tenant_id', tenantId)
    .gte('work_date', from.toISOString().slice(0, 10))
    .lte('work_date', to.toISOString().slice(0, 10))

  if (error) return { data: null, error: error.message }

  const rows = (data ?? []) as unknown as WorkRecordForBilling[]
  const map = new Map<string, BillingRow>()

  for (const row of rows) {
    const client = row.projects?.clients
    if (!client) continue

    const { from: cFrom, to: cTo } = closingRange(yearMonth, String(client.closing_day))
    const workDate = new Date(row.work_date)
    if (workDate < cFrom || workDate > cTo) continue

    const net = row.projects?.price_rules?.[0]?.selling_price ?? 0
    const tax = calcTax(net, client.tax_type)

    const existing = map.get(client.id)
    if (existing) {
      existing.projectCount  += 1
      existing.saleAmountNet += net
      existing.taxAmount     += tax
      existing.totalGross     = existing.saleAmountNet + existing.taxAmount
    } else {
      map.set(client.id, {
        clientId:          client.id,
        companyName:       client.company_name,
        taxType:           client.tax_type,
        invoiceRegistered: client.invoice_registered ?? false,
        closingDay:        String(client.closing_day),
        paymentSite:       client.payment_site,
        projectCount:      1,
        saleAmountNet:     net,
        taxAmount:         tax,
        totalGross:        net + tax,
      })
    }
  }

  const result = Array.from(map.values()).map(r => ({
    ...r,
    totalGross: r.saleAmountNet + r.taxAmount,
  }))

  return { data: result, error: null }
}

// ── 委託先向け支払集計 ────────────────────────────────────

export async function fetchPaymentByContractor(
  yearMonth: string,
): Promise<ActionResult<PaymentRow[]>> {
  const tenantId = await getCurrentTenantId()
  const supabase = createServiceClient()
  const { from, to } = monthRange(yearMonth)

  const { data, error } = await supabase
    .from('work_records')
    .select(`
      id,
      work_date,
      contractor_id,
      projects (
        price_rules ( buying_price )
      ),
      contractors (
        id,
        name,
        tax_category,
        invoice_registration_type,
        invoice_number,
        has_withholding,
        payment_site
      )
    `)
    .eq('tenant_id', tenantId)
    .gte('work_date', from.toISOString().slice(0, 10))
    .lte('work_date', to.toISOString().slice(0, 10))

  if (error) return { data: null, error: error.message }

  const rows = (data ?? []) as unknown as WorkRecordForPayment[]
  const map = new Map<string, PaymentRow>()

  for (const row of rows) {
    const contractor = row.contractors
    if (!contractor) continue

    const net = row.projects?.price_rules?.[0]?.buying_price ?? 0
    const tax         = calcTax(net, contractor.tax_category)
    const withholding = contractor.has_withholding ? calcWithholding(net) : 0

    const existing = map.get(contractor.id)
    if (existing) {
      existing.projectCount   += 1
      existing.buyAmountNet   += net
      existing.taxAmount      += tax
      existing.withholdingTax += withholding
      existing.netPayment      = existing.buyAmountNet + existing.taxAmount - existing.withholdingTax
    } else {
      map.set(contractor.id, {
        contractorId:       contractor.id,
        name:               contractor.name,
        taxType:            contractor.tax_category,
        invoiceType:        contractor.invoice_registration_type,
        invoiceNumber:      contractor.invoice_number,
        withholdingTaxFlag: contractor.has_withholding,
        paymentSite:        contractor.payment_site,
        projectCount:       1,
        buyAmountNet:       net,
        taxAmount:          tax,
        withholdingTax:     withholding,
        netPayment:         net + tax - withholding,
      })
    }
  }

  const result = Array.from(map.values()).map(r => ({
    ...r,
    netPayment: r.buyAmountNet + r.taxAmount - r.withholdingTax,
  }))

  return { data: result, error: null }
}

// ── 立替金承認管理 ────────────────────────────────────────

export type ExpenseApprovalRow = {
  id:             string
  contractorId:   string
  contractorName: string
  expenseDate:    string
  expenseType:    string
  amountActual:   number
  remarks:        string | null
  approvalStatus: string
}

export async function fetchExpensesForApproval(
  yearMonth: string,
): Promise<ActionResult<ExpenseApprovalRow[]>> {
  const tenantId = await getCurrentTenantId()
  const supabase = createServiceClient()
  const [y, m] = yearMonth.split('-').map(Number)
  const from = `${yearMonth}-01`
  const to   = new Date(y, m, 0).toISOString().slice(0, 10)

  const { data, error } = await supabase
    .from('expense_records')
    .select('id, contractor_id, expense_date, expense_type, amount_actual, remarks, approval_status, contractors(name)')
    .eq('tenant_id', tenantId)
    .gte('expense_date', from)
    .lte('expense_date', to)
    .order('expense_date', { ascending: false })

  if (error) return { data: null, error: error.message }

  return {
    data: (data ?? []).map((r: any) => ({
      id:             r.id,
      contractorId:   r.contractor_id,
      contractorName: r.contractors?.name ?? '—',
      expenseDate:    r.expense_date,
      expenseType:    r.expense_type,
      amountActual:   r.amount_actual,
      remarks:        r.remarks,
      approvalStatus: r.approval_status,
    })),
    error: null,
  }
}

export async function approveExpense(
  expenseId: string,
): Promise<ActionResult<{ id: string }>> {
  const supabase = createServiceClient()
  const { data, error } = await supabase
    .from('expense_records')
    .update({ approval_status: 'approved' })
    .eq('id', expenseId)
    .select('id')
    .single()
  if (error) return { data: null, error: error.message }
  return { data: { id: data.id }, error: null }
}

export async function rejectExpense(
  expenseId: string,
): Promise<ActionResult<{ id: string }>> {
  const supabase = createServiceClient()
  const { data, error } = await supabase
    .from('expense_records')
    .update({ approval_status: 'rejected' })
    .eq('id', expenseId)
    .select('id')
    .single()
  if (error) return { data: null, error: error.message }
  return { data: { id: data.id }, error: null }
}

// ── 支払通知書生成 ────────────────────────────────────────

/** インボイス制度経過措置控除率 */
function calcDeductionRate(invoiceType: string, yearMonth: string): number {
  if (invoiceType === '適格') return 0
  const [y, m] = yearMonth.split('-').map(Number)
  const ym = y * 100 + m
  if (ym >= 202310 && ym <= 202609) return 0.2
  if (ym >= 202610 && ym <= 202909) return 0.5
  return 0
}

export type PaymentNoticeStatus = {
  contractorId:   string
  noticeId:       string
  approvalStatus: string
  locked:         boolean
  totalAmount:    number
}

/** 対象月の既存支払通知書ステータス一覧 */
export async function fetchPaymentNoticeStatuses(
  yearMonth: string,
): Promise<ActionResult<PaymentNoticeStatus[]>> {
  const supabase = createServiceClient()
  const { data, error } = await (supabase as any)
    .from('payment_notices')
    .select('id, contractor_id, approval_status, total_excluding_tax, total_tax, total_deduction')
    .eq('notice_month', `${yearMonth}-01`)

  if (error) return { data: null, error: error.message }

  return {
    data: (data ?? []).map((r: any) => ({
      contractorId:   r.contractor_id,
      noticeId:       r.id,
      approvalStatus: r.approval_status ?? 'pending',
      locked:         false,
      totalAmount:    Number(r.total_excluding_tax ?? 0) + Number(r.total_tax ?? 0) - Number(r.total_deduction ?? 0),
    })),
    error: null,
  }
}

/** 委託先1件分の支払通知書を生成（UPSERT） */
export async function generatePaymentNotice(
  contractorId: string,
  yearMonth: string,
): Promise<ActionResult<{ id: string; totalAmount: number }>> {
  const tenantId = await getCurrentTenantId()
  const supabase = createServiceClient()
  const { from, to } = monthRange(yearMonth)
  const fromStr    = from.toISOString().slice(0, 10)
  const toStr      = to.toISOString().slice(0, 10)
  const targetMonth = `${yearMonth}-01`

  // 委託先マスタ
  const { data: c, error: cErr } = await supabase
    .from('contractors')
    .select('tax_category, invoice_registration_type, has_withholding')
    .eq('id', contractorId)
    .eq('tenant_id', tenantId)
    .single()
  if (cErr || !c) return { data: null, error: cErr?.message ?? '委託先が見つかりません' }
  const contractor = c as any

  // 稼働記録から労務報酬を集計
  const { data: workData, error: wErr } = await supabase
    .from('work_records')
    .select('projects(price_rules(buying_price))')
    .eq('contractor_id', contractorId)
    .eq('tenant_id', tenantId)
    .gte('work_date', fromStr)
    .lte('work_date', toStr)
  if (wErr) return { data: null, error: wErr.message }

  let laborTaxExcluded = 0
  for (const w of (workData ?? []) as any[]) {
    laborTaxExcluded += Number(w.projects?.price_rules?.[0]?.buying_price ?? 0)
  }
  const laborTax = calcTax(laborTaxExcluded, contractor.tax_category)

  // 承認済み立替金を集計
  const { data: expData, error: eErr } = await supabase
    .from('expense_records')
    .select('amount_actual, amount_tax_excluded')
    .eq('contractor_id', contractorId)
    .eq('tenant_id', tenantId)
    .eq('approval_status', 'approved')
    .gte('expense_date', fromStr)
    .lte('expense_date', toStr)
  if (eErr) return { data: null, error: eErr.message }

  let expenseTaxExcluded = 0
  let expenseTax = 0
  for (const e of (expData ?? []) as any[]) {
    expenseTaxExcluded += Number(e.amount_tax_excluded ?? 0)
    expenseTax         += Number(e.amount_actual ?? 0) - Number(e.amount_tax_excluded ?? 0)
  }

  // 経過措置控除（免税・未登録のみ）
  const deductionRate = calcDeductionRate(contractor.invoice_registration_type, yearMonth)
  const deduction     = Math.floor(laborTax * deductionRate)

  // invoice_registration_type 別に集計列へ振り分け
  const isRegistered = contractor.invoice_registration_type === '適格'
  const isExempt     = contractor.invoice_registration_type === '免税'

  const subtotalRegistered   = isRegistered ? laborTaxExcluded : 0
  const taxRegistered        = isRegistered ? laborTax          : 0
  const subtotalUnregistered = (!isRegistered && !isExempt) ? laborTaxExcluded : 0
  const taxUnregistered      = isRegistered ? 0 : laborTax
  const deductionUnregistered = deduction
  const subtotalExempt       = isExempt ? laborTaxExcluded : 0

  const totalExcludingTax = laborTaxExcluded + expenseTaxExcluded
  const totalTax          = laborTax + expenseTax
  const totalDeduction    = deduction
  const totalAmount       = totalExcludingTax + totalTax - totalDeduction

  const db = supabase as any

  // 既存レコードを確認して INSERT or UPDATE
  const { data: existing } = await db
    .from('payment_notices')
    .select('id')
    .eq('contractor_id', contractorId)
    .eq('notice_month', targetMonth)
    .maybeSingle()

  const noticePayload = {
    subtotal_registered:    subtotalRegistered,
    tax_registered:         taxRegistered,
    subtotal_unregistered:  subtotalUnregistered,
    tax_unregistered:       taxUnregistered,
    deduction_unregistered: deductionUnregistered,
    subtotal_exempt:        subtotalExempt,
    total_excluding_tax:    totalExcludingTax,
    total_tax:              totalTax,
    total_deduction:        totalDeduction,
    approval_status:        'approved',
  }

  let noticeId: string
  if (existing?.id) {
    const { data: updated, error: uErr } = await db
      .from('payment_notices')
      .update(noticePayload)
      .eq('id', existing.id)
      .select('id')
      .single()
    if (uErr) return { data: null, error: uErr.message }
    noticeId = updated.id
  } else {
    const { data: inserted, error: iErr } = await db
      .from('payment_notices')
      .insert({ contractor_id: contractorId, notice_month: targetMonth, ...noticePayload })
      .select('id')
      .single()
    if (iErr) return { data: null, error: iErr.message }
    noticeId = inserted.id
  }

  return { data: { id: noticeId, totalAmount }, error: null }
}

/** 対象月の全委託先分を一括生成 */
export async function generateAllPaymentNotices(
  yearMonth: string,
): Promise<ActionResult<{ generated: number; errors: string[] }>> {
  const tenantId = await getCurrentTenantId()
  const supabase = createServiceClient()
  const { from, to } = monthRange(yearMonth)

  const { data: workRows, error: wErr } = await supabase
    .from('work_records')
    .select('contractor_id')
    .eq('tenant_id', tenantId)
    .gte('work_date', from.toISOString().slice(0, 10))
    .lte('work_date', to.toISOString().slice(0, 10))
    .not('contractor_id', 'is', null)
  if (wErr) return { data: null, error: wErr.message }

  const ids = [...new Set((workRows ?? []).map((r: any) => r.contractor_id as string))]

  const results = await Promise.allSettled(
    ids.map(id => generatePaymentNotice(id, yearMonth)),
  )

  let generated = 0
  const errors: string[] = []
  for (const r of results) {
    if (r.status === 'fulfilled' && !r.value.error) generated++
    else if (r.status === 'fulfilled' && r.value.error) errors.push(r.value.error)
    else if (r.status === 'rejected') errors.push(String(r.reason))
  }

  return { data: { generated, errors }, error: null }
}
