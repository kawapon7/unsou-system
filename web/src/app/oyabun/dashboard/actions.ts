'use server'

import { createServiceClient } from '@/utils/supabase/service'

type ActionResult<T> = { data: T; error: null } | { data: null; error: string }

function currentYearMonth() {
  const now = new Date()
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`
}

/** 過去 n ヶ月分の yearMonth 文字列を降順で返す */
function pastMonths(n: number): string[] {
  const result: string[] = []
  const now = new Date()
  for (let i = 0; i < n; i++) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1)
    result.push(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`)
  }
  return result
}

// ── 型定義 ────────────────────────────────────────────────

export type DashboardSummary = {
  totalReceivable: number  // 入金予定総額（未入金）
  totalReceived:   number  // 入金済額
  totalPayable:    number  // 支払予定総額
  grossProfit:     number  // 粗利概算（入金予定総額 - 支払予定総額）
}

export type InvoiceScheduleRow = {
  invoiceId:   string
  companyName: string
  dueDate:     string | null
  totalAmount: number
  status:      string
}

export type PaymentScheduleRow = {
  noticeId:       string
  contractorName: string
  totalAmount:    number
  approvalStatus: string
}

export type AlertData = {
  pendingApprovals:  number
  pendingCount:      number
}

export type MonthlyTrendRow = {
  month:         string
  totalAmount:   number
  paidAmount:    number
}

export type ClientPieRow = {
  companyName: string
  totalAmount: number
}

// ── KPIサマリー ───────────────────────────────────────────

export async function fetchDashboardSummary(
  yearMonth: string,
): Promise<ActionResult<DashboardSummary>> {
  const supabase = createServiceClient()

  const [invoiceRes, noticeRes] = await Promise.all([
    supabase
      .from('invoices')
      .select('status, total_amount')
      .eq('invoice_month', yearMonth),
    supabase
      .from('payment_notices')
      .select('total_amount')
      .eq('notice_month', yearMonth),
  ])

  if (invoiceRes.error) return { data: null, error: invoiceRes.error.message }
  if (noticeRes.error)  return { data: null, error: noticeRes.error.message }

  const invoices = invoiceRes.data ?? []
  const notices  = noticeRes.data  ?? []

  const totalReceivable = invoices
    .filter(r => r.status !== 'paid')
    .reduce((s, r) => s + r.total_amount, 0)
  const totalReceived = invoices
    .filter(r => r.status === 'paid')
    .reduce((s, r) => s + r.total_amount, 0)
  const totalPayable = notices.reduce((s, r) => s + r.total_amount, 0)

  return {
    data: {
      totalReceivable,
      totalReceived,
      totalPayable,
      grossProfit: totalReceivable + totalReceived - totalPayable,
    },
    error: null,
  }
}

// ── 入金スケジュール ──────────────────────────────────────

export async function fetchInvoiceSchedule(
  yearMonth: string,
): Promise<ActionResult<InvoiceScheduleRow[]>> {
  const supabase = createServiceClient()

  const { data, error } = await supabase
    .from('invoices')
    .select('id, status, total_amount, due_date, clients(company_name)')
    .eq('invoice_month', yearMonth)
    .order('due_date', { ascending: true })

  if (error) return { data: null, error: error.message }

  const rows = (data ?? []).map((r: any) => ({
    invoiceId:   r.id,
    companyName: r.clients?.company_name ?? '—',
    dueDate:     r.due_date,
    totalAmount: r.total_amount,
    status:      r.status,
  }))

  return { data: rows, error: null }
}

// ── 支払スケジュール ──────────────────────────────────────

export async function fetchPaymentSchedule(
  yearMonth: string,
): Promise<ActionResult<PaymentScheduleRow[]>> {
  const supabase = createServiceClient()

  const { data, error } = await supabase
    .from('payment_notices')
    .select('id, total_amount, approval_status, contractors(name)')
    .eq('notice_month', yearMonth)
    .order('total_amount', { ascending: false })

  if (error) return { data: null, error: error.message }

  const rows = (data ?? []).map((r: any) => ({
    noticeId:       r.id,
    contractorName: r.contractors?.name ?? '—',
    totalAmount:    r.total_amount,
    approvalStatus: r.approval_status,
  }))

  return { data: rows, error: null }
}

// ── アラート ──────────────────────────────────────────────

export async function fetchAlerts(
  yearMonth: string,
): Promise<ActionResult<AlertData>> {
  const supabase = createServiceClient()

  const [approvalRes, invoiceRes] = await Promise.all([
    supabase
      .from('payment_notices')
      .select('id', { count: 'exact', head: true })
      .eq('notice_month', yearMonth)
      .neq('approval_status', 'approved'),
    supabase
      .from('invoices')
      .select('id', { count: 'exact', head: true })
      .eq('invoice_month', yearMonth)
      .eq('status', 'draft'),
  ])

  return {
    data: {
      pendingApprovals: approvalRes.count ?? 0,
      pendingCount:     invoiceRes.count  ?? 0,
    },
    error: null,
  }
}

// ── 月別売上トレンド（過去12ヶ月） ───────────────────────

export async function fetchMonthlyTrend(): Promise<ActionResult<MonthlyTrendRow[]>> {
  const supabase = createServiceClient()
  const months   = pastMonths(12)

  const { data, error } = await supabase
    .from('invoices')
    .select('invoice_month, status, total_amount')
    .in('invoice_month', months)

  if (error) return { data: null, error: error.message }

  const map = new Map<string, MonthlyTrendRow>()
  for (const m of months) {
    map.set(m, { month: m, totalAmount: 0, paidAmount: 0 })
  }
  for (const row of (data ?? [])) {
    const entry = map.get(row.invoice_month)
    if (!entry) continue
    entry.totalAmount += row.total_amount
    if (row.status === 'paid') entry.paidAmount += row.total_amount
  }

  return {
    data: months.map(m => map.get(m)!).reverse(),
    error: null,
  }
}

// ── 荷主別売上構成（当月） ────────────────────────────────

export async function fetchClientPie(
  yearMonth: string,
): Promise<ActionResult<ClientPieRow[]>> {
  const supabase = createServiceClient()

  const { data, error } = await supabase
    .from('invoices')
    .select('total_amount, clients(company_name)')
    .eq('invoice_month', yearMonth)

  if (error) return { data: null, error: error.message }

  const map = new Map<string, number>()
  for (const r of (data ?? []) as any[]) {
    const name = r.clients?.company_name ?? '不明'
    map.set(name, (map.get(name) ?? 0) + r.total_amount)
  }

  return {
    data: Array.from(map.entries())
      .map(([companyName, totalAmount]) => ({ companyName, totalAmount }))
      .sort((a, b) => b.totalAmount - a.totalAmount),
    error: null,
  }
}
