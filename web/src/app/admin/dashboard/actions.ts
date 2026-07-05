'use server'

import { createServiceClient } from '@/utils/supabase/service'
import { getCurrentTenantId } from '@/utils/tenant'
import { requireOwner } from '@/utils/auth'
import { buildScheduleTrendMap } from './scheduleAggregation'

type ActionResult<T> = { data: T; error: null } | { data: null; error: string }

// ── ユーティリティ ────────────────────────────────────────

function toDbMonth(ym: string): string {
  return ym.length === 7 ? `${ym}-01` : ym
}

function pastMonths(n: number): string[] {
  const result: string[] = []
  const now = new Date()
  for (let i = 0; i < n; i++) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1)
    result.push(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`)
  }
  return result
}

/** 週の月曜〜日曜の ISO 日付を返す */
function weekRange(refDate: string): { from: string; to: string } {
  const d = new Date(refDate)
  const dow = d.getDay()                         // 0=日
  const mon = new Date(d)
  mon.setDate(d.getDate() - ((dow + 6) % 7))     // 月曜
  const sun = new Date(mon)
  sun.setDate(mon.getDate() + 6)                 // 日曜
  return {
    from: mon.toISOString().slice(0, 10),
    to:   sun.toISOString().slice(0, 10),
  }
}

function monthRange(ym: string): { from: string; to: string } {
  const [y, m] = ym.split('-').map(Number)
  return {
    from: `${ym}-01`,
    to:   new Date(y, m, 0).toISOString().slice(0, 10),
  }
}

// ── 型定義 ────────────────────────────────────────────────

export type PeriodType = 'month' | 'week' | 'day'

/** イン/アウト の確定・予定をまとめたサマリー */
export type CashflowSummary = {
  // 確定イン（invoices.status='paid'）
  confirmedIn:  number
  // 予定イン（invoices.status='issued', 未回収）
  projectedIn:  number
  // 確定アウト（payment_notices 合計、承認済み）
  confirmedOut: number
  // 予定アウト（payment_notices 合計、未承認）
  projectedOut: number
  // 粗利概算（確定イン + 予定イン - 確定アウト - 予定アウト）
  grossProfit:  number
}

export type TimelineInRow = {
  id:          string
  companyName: string
  amount:      number
  dueDate:     string | null
  status:      string   // 'paid' | 'issued' | 'draft'
  confirmed:   boolean
}

export type TimelineOutRow = {
  id:              string
  contractorName:  string
  amount:          number        // adjustment_amount 適用後
  adjustmentAmount: number
  dueDate:         string | null
  approved:        boolean
}

export type MonthlyTrendRow = {
  month:       string
  confirmedIn: number
  projectedIn: number
  confirmedOut: number
}

export type AlertData = {
  pendingInvoices:  number   // 未確定の請求書
}

// ── 期間別キャッシュフロー集計 ────────────────────────────

export async function fetchCashflowSummary(
  period: PeriodType,
  refDate: string,           // 月次='YYYY-MM', 週次/日次='YYYY-MM-DD'
): Promise<ActionResult<CashflowSummary>> {
  const auth = await requireOwner()
  if (!auth.ok) return { data: null, error: auth.error }
  const supabase = createServiceClient()

  let invoiceFilter: { from: string; to: string }
  let noticeFilter:  { from: string; to: string }

  if (period === 'month') {
    invoiceFilter = monthRange(refDate.slice(0, 7))
    noticeFilter  = invoiceFilter
  } else if (period === 'week') {
    invoiceFilter = weekRange(refDate)
    noticeFilter  = invoiceFilter
  } else {
    invoiceFilter = { from: refDate, to: refDate }
    noticeFilter  = invoiceFilter
  }

  const [invoiceRes, noticeRes] = await Promise.all([
    period === 'month'
      ? supabase
          .from('invoices')
          .select('status, total_amount')
          .eq('invoice_month', toDbMonth(refDate.slice(0, 7)))
      : supabase
          .from('invoices')
          .select('status, total_amount')
          .gte('due_date', invoiceFilter.from)
          .lte('due_date', invoiceFilter.to),
    period === 'month'
      ? supabase
          .from('payment_notices')
          .select('total_amount, adjustment_amount, approval_status')
          .eq('notice_month', toDbMonth(refDate.slice(0, 7)))
      : supabase
          .from('payment_notices')
          .select('total_amount, adjustment_amount, approval_status')
          .gte('created_at', `${noticeFilter.from}T00:00:00`)
          .lte('created_at', `${noticeFilter.to}T23:59:59`),
  ])

  if (invoiceRes.error) return { data: null, error: invoiceRes.error.message }
  if (noticeRes.error)  return { data: null, error: noticeRes.error.message }

  const invoices = invoiceRes.data ?? []
  const notices  = noticeRes.data  ?? []

  const confirmedIn  = invoices.filter(r => r.status === 'paid').reduce((s, r) => s + r.total_amount, 0)
  const projectedIn  = invoices.filter(r => r.status === 'issued').reduce((s, r) => s + r.total_amount, 0)

  // NOTE: adjustment_amount カラムは migration 後に追加。ない場合は 0 として扱う
  const confirmedOut = notices
    .filter(r => r.approval_status === 'approved')
    .reduce((s, r: any) => s + r.total_amount + (r.adjustment_amount ?? 0), 0)
  const projectedOut = notices
    .filter(r => r.approval_status !== 'approved')
    .reduce((s, r: any) => s + r.total_amount + (r.adjustment_amount ?? 0), 0)

  return {
    data: {
      confirmedIn,
      projectedIn,
      confirmedOut,
      projectedOut,
      grossProfit: confirmedIn + projectedIn - confirmedOut - projectedOut,
    },
    error: null,
  }
}

// ── タイムライン：イン（入金スケジュール） ────────────────

export async function fetchTimelineIn(
  period: PeriodType,
  refDate: string,
): Promise<ActionResult<TimelineInRow[]>> {
  const auth = await requireOwner()
  if (!auth.ok) return { data: null, error: auth.error }
  const supabase = createServiceClient()

  let query = supabase
    .from('invoices')
    .select('id, status, total_amount, due_date, clients(company_name)')

  if (period === 'month') {
    query = query.eq('invoice_month', toDbMonth(refDate.slice(0, 7))) as typeof query
  } else if (period === 'week') {
    const { from, to } = weekRange(refDate)
    query = query.gte('due_date', from).lte('due_date', to) as typeof query
  } else {
    query = query.eq('due_date', refDate) as typeof query
  }

  const { data, error } = await (query as any).order('due_date', { ascending: true })
  if (error) return { data: null, error: error.message }

  return {
    data: (data ?? []).map((r: any) => ({
      id:          r.id,
      companyName: r.clients?.company_name ?? '—',
      amount:      r.total_amount,
      dueDate:     r.due_date,
      status:      r.status,
      confirmed:   r.status === 'paid',
    })),
    error: null,
  }
}

// ── タイムライン：アウト（支払スケジュール） ─────────────

export async function fetchTimelineOut(
  period: PeriodType,
  refDate: string,
): Promise<ActionResult<TimelineOutRow[]>> {
  const auth = await requireOwner()
  if (!auth.ok) return { data: null, error: auth.error }
  const supabase = createServiceClient()

  let query = supabase
    .from('payment_notices')
    .select('id, total_amount, adjustment_amount, approval_status, created_at, contractors(name)')

  if (period === 'month') {
    query = query.eq('notice_month', toDbMonth(refDate.slice(0, 7))) as typeof query
  } else if (period === 'week') {
    const { from, to } = weekRange(refDate)
    query = query.gte('created_at', `${from}T00:00:00`).lte('created_at', `${to}T23:59:59`) as typeof query
  } else {
    query = query
      .gte('created_at', `${refDate}T00:00:00`)
      .lte('created_at', `${refDate}T23:59:59`) as typeof query
  }

  const { data, error } = await (query as any).order('total_amount', { ascending: false })
  if (error) return { data: null, error: error.message }

  return {
    data: (data ?? []).map((r: any) => ({
      id:               r.id,
      contractorName:   r.contractors?.name ?? '—',
      amount:           r.total_amount + (r.adjustment_amount ?? 0),
      adjustmentAmount: r.adjustment_amount ?? 0,
      dueDate:          null,   // NOTE: payment_due_date カラムがあれば差し替え
      approved:         r.approval_status === 'approved',
    })),
    error: null,
  }
}

// ── アラート ─────────────────────────────────────────────

export async function fetchAlerts(
  yearMonth: string,
): Promise<ActionResult<AlertData>> {
  const auth = await requireOwner()
  if (!auth.ok) return { data: null, error: auth.error }
  const supabase = createServiceClient()

  const { count } = await supabase
    .from('invoices')
    .select('id', { count: 'exact', head: true })
    .eq('invoice_month', toDbMonth(yearMonth))
    .eq('status', 'draft')

  return {
    data: { pendingInvoices: count ?? 0 },
    error: null,
  }
}

// ── 月別トレンド（過去12ヶ月） ───────────────────────────

export async function fetchMonthlyTrend(): Promise<ActionResult<MonthlyTrendRow[]>> {
  const auth = await requireOwner()
  if (!auth.ok) return { data: null, error: auth.error }
  const supabase = createServiceClient()
  const months = pastMonths(12)

  const [invoiceRes, noticeRes] = await Promise.all([
    supabase
      .from('invoices')
      .select('invoice_month, status, total_amount')
      .in('invoice_month', months.map(toDbMonth)),
    supabase
      .from('payment_notices')
      .select('notice_month, total_amount')
      .in('notice_month', months.map(toDbMonth)),
  ])

  if (invoiceRes.error) return { data: null, error: invoiceRes.error.message }

  const inMap  = new Map<string, { confirmed: number; projected: number }>()
  const outMap = new Map<string, number>()
  for (const m of months) {
    inMap.set(m,  { confirmed: 0, projected: 0 })
    outMap.set(m, 0)
  }

  for (const r of (invoiceRes.data ?? [])) {
    const ym = r.invoice_month.slice(0, 7)
    const entry = inMap.get(ym)
    if (!entry) continue
    if (r.status === 'paid') entry.confirmed += r.total_amount
    else                     entry.projected += r.total_amount
  }
  for (const r of (noticeRes.data ?? [])) {
    const ym = (r as any).notice_month.slice(0, 7)
    outMap.set(ym, (outMap.get(ym) ?? 0) + (r as any).total_amount)
  }

  return {
    data: months
      .map(m => ({
        month:        m,
        confirmedIn:  inMap.get(m)!.confirmed,
        projectedIn:  inMap.get(m)!.projected,
        confirmedOut: outMap.get(m) ?? 0,
      }))
      .reverse(),
    error: null,
  }
}

// ================================================================
// スケジュールベース 発生主義サマリー
// schedules × projects.sale_amount / buy_amount で算出
// 実績 = date <= 今日 かつ status != absent
// 予定 = date >  今日 かつ status = scheduled
// ================================================================

function todayJST(): string {
  return new Date().toLocaleDateString('sv-SE', { timeZone: 'Asia/Tokyo' })
}

export type ScheduleSummary = {
  confirmedSales: number
  projectedSales: number
  confirmedCost:  number
  projectedCost:  number
  confirmedDays:  number
  projectedDays:  number
  absentDays:     number
}

export type ProjectBreakdownRow = {
  projectId:     string
  projectName:   string
  clientName:    string
  confirmedDays: number
  projectedDays: number
  landingSales:  number
  landingCost:   number
  prevDays:      number
}

export type ScheduleTrendRow = {
  month:          string
  confirmedSales: number
  projectedSales: number
}

async function querySchedulesForMonth(
  db: any,
  tenantId: string,
  yearMonth: string,
) {
  const { from, to } = monthRange(yearMonth)
  return db
    .from('schedules')
    .select('date, status, projects(id, project_name, sale_amount, buy_amount, clients(company_name))')
    .eq('tenant_id', tenantId)
    .gte('date', from)
    .lte('date', to)
}

export async function fetchScheduleSummary(
  yearMonth: string,
): Promise<ActionResult<ScheduleSummary>> {
  const auth = await requireOwner()
  if (!auth.ok) return { data: null, error: auth.error }
  const tenantId = await getCurrentTenantId()
  const db       = createServiceClient() as any
  const today    = todayJST()

  const { data, error } = await querySchedulesForMonth(db, tenantId, yearMonth)
  if (error) return { data: null, error: error.message }

  let confirmedSales = 0, projectedSales = 0
  let confirmedCost  = 0, projectedCost  = 0
  let confirmedDays  = 0, projectedDays  = 0, absentDays = 0

  for (const s of (data ?? [])) {
    if (s.status === 'absent') { absentDays++; continue }
    const p    = s.projects as any
    const sale = p?.sale_amount ?? 0
    const cost = p?.buy_amount  ?? 0
    if (s.date <= today) {
      confirmedSales += sale; confirmedCost += cost; confirmedDays++
    } else if (s.status === 'scheduled') {
      projectedSales += sale; projectedCost += cost; projectedDays++
    }
  }

  return {
    data: { confirmedSales, projectedSales, confirmedCost, projectedCost, confirmedDays, projectedDays, absentDays },
    error: null,
  }
}

export async function fetchProjectBreakdown(
  yearMonth: string,
): Promise<ActionResult<ProjectBreakdownRow[]>> {
  const auth = await requireOwner()
  if (!auth.ok) return { data: null, error: auth.error }
  const tenantId = await getCurrentTenantId()
  const db       = createServiceClient() as any
  const today    = todayJST()

  const [y, m]  = yearMonth.split('-').map(Number)
  const prevDate = new Date(y, m - 2, 1)
  const prevYM   = `${prevDate.getFullYear()}-${String(prevDate.getMonth() + 1).padStart(2, '0')}`

  const [currRes, prevRes] = await Promise.all([
    querySchedulesForMonth(db, tenantId, yearMonth),
    querySchedulesForMonth(db, tenantId, prevYM),
  ])
  if (currRes.error) return { data: null, error: currRes.error.message }

  type Internal = ProjectBreakdownRow & { saleAmount: number; buyAmount: number }
  const map = new Map<string, Internal>()

  for (const s of (currRes.data ?? [])) {
    if (s.status === 'absent') continue
    const p = s.projects as any
    if (!p?.id) continue
    if (!map.has(p.id)) {
      map.set(p.id, {
        projectId:     p.id,
        projectName:   p.project_name,
        clientName:    p.clients?.company_name ?? '—',
        confirmedDays: 0,
        projectedDays: 0,
        landingSales:  0,
        landingCost:   0,
        prevDays:      0,
        saleAmount:    p.sale_amount ?? 0,
        buyAmount:     p.buy_amount  ?? 0,
      })
    }
    const row = map.get(p.id)!
    if (s.date <= today) row.confirmedDays++
    else if (s.status === 'scheduled') row.projectedDays++
  }

  for (const row of map.values()) {
    const total      = row.confirmedDays + row.projectedDays
    row.landingSales = total * row.saleAmount
    row.landingCost  = total * row.buyAmount
  }

  const prevMap = new Map<string, number>()
  for (const s of (prevRes.data ?? [])) {
    if (s.status === 'absent') continue
    const pid = (s.projects as any)?.id
    if (pid) prevMap.set(pid, (prevMap.get(pid) ?? 0) + 1)
  }
  for (const [pid, row] of map) row.prevDays = prevMap.get(pid) ?? 0

  return {
    data: [...map.values()]
      .map(({ saleAmount: _s, buyAmount: _b, ...rest }) => rest)
      .sort((a, b) => b.landingSales - a.landingSales),
    error: null,
  }
}

export async function fetchScheduleTrend(): Promise<ActionResult<ScheduleTrendRow[]>> {
  const auth = await requireOwner()
  if (!auth.ok) return { data: null, error: auth.error }
  const tenantId = await getCurrentTenantId()
  const db       = createServiceClient() as any
  const today    = todayJST()
  const months   = pastMonths(12)

  const fromDate = `${months[months.length - 1]}-01`
  const [lastY, lastM] = months[0].split('-').map(Number)
  const toDate   = new Date(lastY, lastM, 0).toISOString().slice(0, 10)

  const { data, error } = await db
    .from('schedules')
    .select('date, status, projects(sale_amount)')
    .eq('tenant_id', tenantId)
    .gte('date', fromDate)
    .lte('date', toDate)
    .neq('status', 'absent')

  if (error) return { data: null, error: error.message }

  const trendMap = buildScheduleTrendMap(data ?? [], today, months)

  return {
    data: months.map(m => ({
      month:          m,
      confirmedSales: trendMap.get(m)!.confirmed,
      projectedSales: trendMap.get(m)!.projected,
    })).reverse(),
    error: null,
  }
}
