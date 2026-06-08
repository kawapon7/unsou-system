'use server'

import { createServiceClient } from '@/utils/supabase/service'
import type { Database } from '@/types/supabase'
import { calcInvoiceTax } from '@/lib/invoice'

type ClientRow = Database['public']['Tables']['clients']['Row']

// ── 締め日ユーティリティ ──────────────────────────────────

function closingRange(yearMonth: string, closingDay: string): { from: Date; to: Date } {
  const [y, m] = yearMonth.split('-').map(Number)
  const isLastDay = closingDay === '月末' || closingDay === '末日' || closingDay === '99'
  const day = isLastDay ? 0 : Number(closingDay)
  const toDate   = isLastDay ? new Date(y, m, 0)      : new Date(y, m - 1, day)
  const fromDate = isLastDay ? new Date(y, m - 1, 1)  : new Date(y, m - 2, day + 1)
  return { from: fromDate, to: toDate }
}

function computeDueDate(yearMonth: string, closingDay: string, paymentSite: number): string {
  const { to } = closingRange(yearMonth, closingDay)
  const due = new Date(to)
  due.setDate(due.getDate() + paymentSite)
  return due.toISOString().slice(0, 10)
}

// ── 型定義 ─────────────────────────────────────────────────

export type SalesListRow = {
  invoiceId:    string | null
  clientId:     string
  companyName:  string
  invoiceMonth: string
  taxType:      string
  closingDay:   string
  paymentSite:  number
  dueDate:      string
  status:       string   // 'no_invoice' | 'issued' | 'paid' | 'draft'
  netAmount:    number
  taxAmount:    number
  totalAmount:  number
}

export type InvoicePreviewLine = {
  workDate:    string
  projectName: string
  projectCode: string
  quantity:    number
  netAmount:   number
  memo:        string | null
}

export type InvoicePreview = {
  clientId:          string
  companyName:       string
  contactName:       string | null
  email:             string | null
  taxType:           string
  invoiceMonth:      string
  closingDay:        string
  paymentSite:       number
  dueDate:           string
  lines:             InvoicePreviewLine[]
  netTotal:          number
  taxTotal:          number
  grandTotal:        number
  existingInvoiceId: string | null
  invoiceStatus:     string | null
}

type ActionResult<T> = { data: T; error: null } | { data: null; error: string }

// ── 売上一覧取得 ──────────────────────────────────────────
// invoices テーブルにある請求書 + work_records はあるが未請求の荷主を合算

export async function fetchSalesList(
  yearMonth: string,
): Promise<ActionResult<SalesListRow[]>> {
  const supabase = createServiceClient()

  const [y, m] = yearMonth.split('-').map(Number)
  const periodStart = `${yearMonth}-01`
  const periodEnd   = new Date(y, m, 0).toISOString().slice(0, 10)

  const [invoicesRes, clientsRes] = await Promise.all([
    supabase
      .from('invoices')
      .select('id, client_id, invoice_month, status, total_tax_excluded, consumption_tax, total_amount, due_date')
      .eq('invoice_month', yearMonth),
    supabase
      .from('clients')
      .select('id, company_name, tax_type, closing_day, payment_site'),
  ])

  if (clientsRes.error) return { data: null, error: clientsRes.error.message }

  type ClientOption = { id: string; company_name: string; tax_type: string; closing_day: string; payment_site: number }
  type InvoiceOption = { id: string; client_id: string; invoice_month: string; status: string; total_tax_excluded: number; consumption_tax: number; total_amount: number; due_date: string | null }

  const clientMap = new Map<string, ClientOption>(
    (clientsRes.data ?? []).map(c => [c.id, c])
  )
  const invoiceMap = new Map<string, InvoiceOption>(
    (invoicesRes.data ?? []).map(inv => [inv.client_id, inv])
  )
  const invoicedClientIds = new Set(invoiceMap.keys())

  // invoices テーブルの行を変換
  const invoiceRows: SalesListRow[] = (invoicesRes.data ?? []).map(inv => {
    const client = clientMap.get(inv.client_id)
    return {
      invoiceId:    inv.id,
      clientId:     inv.client_id,
      companyName:  client?.company_name ?? '',
      invoiceMonth: inv.invoice_month,
      taxType:      client?.tax_type ?? 'exclusive',
      closingDay:   client?.closing_day ?? '月末',
      paymentSite:  client?.payment_site ?? 30,
      dueDate:      inv.due_date ?? '',
      status:       inv.status,
      netAmount:    inv.total_tax_excluded,
      taxAmount:    inv.consumption_tax,
      totalAmount:  inv.total_amount,
    }
  })

  // work_records から未請求荷主の概算を算出
  const workRes = await supabase
    .from('work_records')
    .select('tax_excluded_sales, project_id')
    .gte('work_date', periodStart)
    .lte('work_date', periodEnd)

  const extraRows: SalesListRow[] = []

  if (!workRes.error && (workRes.data ?? []).length > 0) {
    const projectIds = [
      ...new Set(
        (workRes.data ?? []).map(r => r.project_id).filter((id): id is string => id !== null),
      ),
    ]

    if (projectIds.length > 0) {
      const { data: projects } = await supabase
        .from('projects')
        .select('id, client_id')
        .in('id', projectIds)

      const projectClientMap = new Map<string, string>(
        (projects ?? []).map(p => [p.id, p.client_id]),
      )

      const clientNetMap = new Map<string, number>()
      for (const r of workRes.data ?? []) {
        if (!r.project_id) continue
        const clientId = projectClientMap.get(r.project_id)
        if (!clientId || invoicedClientIds.has(clientId)) continue
        clientNetMap.set(clientId, (clientNetMap.get(clientId) ?? 0) + r.tax_excluded_sales)
      }

      for (const [clientId, net] of clientNetMap) {
        const client = clientMap.get(clientId)
        if (!client) continue
        const tax     = calcInvoiceTax(net, client.tax_type)
        const dueDate = computeDueDate(yearMonth, client.closing_day, client.payment_site)
        extraRows.push({
          invoiceId:    null,
          clientId,
          companyName:  client.company_name,
          invoiceMonth: yearMonth,
          taxType:      client.tax_type,
          closingDay:   client.closing_day,
          paymentSite:  client.payment_site,
          dueDate,
          status:       'no_invoice',
          netAmount:    net,
          taxAmount:    tax,
          totalAmount:  net + tax,
        })
      }
    }
  }

  const all = [...invoiceRows, ...extraRows].sort((a, b) =>
    a.companyName.localeCompare(b.companyName, 'ja'),
  )

  return { data: all, error: null }
}

// ── インボイスプレビュー計算 ──────────────────────────────
// 仕様書 3-5: インボイス区分ごとに合計 → 一括で消費税計算（四捨五入1回）

export async function computeInvoicePreview(
  clientId: string,
  yearMonth: string,
): Promise<ActionResult<InvoicePreview>> {
  const supabase = createServiceClient()

  const { data: client, error: clientErr } = await supabase
    .from('clients')
    .select('id, company_name, contact_name, email, tax_type, closing_day, payment_site')
    .eq('id', clientId)
    .single()

  if (clientErr || !client) {
    return { data: null, error: clientErr?.message ?? '荷主が見つかりません' }
  }

  const { from, to } = closingRange(yearMonth, client.closing_day)
  const dueDate = computeDueDate(yearMonth, client.closing_day, client.payment_site)

  const { data: projects, error: projErr } = await supabase
    .from('projects')
    .select('id, project_name, project_code')
    .eq('client_id', clientId)

  if (projErr) return { data: null, error: projErr.message }

  const projectIds  = (projects ?? []).map(p => p.id)
  const projectMap  = new Map((projects ?? []).map(p => [p.id, p]))

  const base: Omit<InvoicePreview, 'lines' | 'netTotal' | 'taxTotal' | 'grandTotal' | 'existingInvoiceId' | 'invoiceStatus'> = {
    clientId,
    companyName:  client.company_name,
    contactName:  client.contact_name,
    email:        client.email,
    taxType:      client.tax_type,
    invoiceMonth: yearMonth,
    closingDay:   client.closing_day,
    paymentSite:  client.payment_site,
    dueDate,
  }

  if (projectIds.length === 0) {
    return {
      data: { ...base, lines: [], netTotal: 0, taxTotal: 0, grandTotal: 0, existingInvoiceId: null, invoiceStatus: null },
      error: null,
    }
  }

  const [recordsRes, existingRes] = await Promise.all([
    supabase
      .from('work_records')
      .select('id, work_date, project_id, tax_excluded_sales, quantity, memo')
      .in('project_id', projectIds)
      .gte('work_date', from.toISOString().slice(0, 10))
      .lte('work_date', to.toISOString().slice(0, 10))
      .order('work_date'),
    supabase
      .from('invoices')
      .select('id, status')
      .eq('client_id', clientId)
      .eq('invoice_month', yearMonth)
      .maybeSingle(),
  ])

  if (recordsRes.error) return { data: null, error: recordsRes.error.message }

  const lines: InvoicePreviewLine[] = (recordsRes.data ?? []).map(r => {
    const proj = r.project_id ? projectMap.get(r.project_id) : null
    return {
      workDate:    r.work_date,
      projectName: proj?.project_name ?? '（案件なし）',
      projectCode: proj?.project_code ?? '',
      quantity:    r.quantity,
      netAmount:   r.tax_excluded_sales,
      memo:        r.memo,
    }
  })

  // 仕様書 3-5: 合計額に対して消費税を一括計算（端数処理は四捨五入で1回）
  const netTotal   = lines.reduce((sum, l) => sum + l.netAmount, 0)
  const taxTotal   = calcInvoiceTax(netTotal, client.tax_type)
  const grandTotal = netTotal + taxTotal

  return {
    data: {
      ...base,
      lines,
      netTotal,
      taxTotal,
      grandTotal,
      existingInvoiceId: existingRes.data?.id ?? null,
      invoiceStatus:     existingRes.data?.status ?? null,
    },
    error: null,
  }
}

// ── インボイス確定・保存 ──────────────────────────────────

export async function upsertInvoice(
  clientId: string,
  yearMonth: string,
): Promise<ActionResult<{ id: string }>> {
  const supabase = createServiceClient()

  const previewRes = await computeInvoicePreview(clientId, yearMonth)
  if (previewRes.error || !previewRes.data) {
    return { data: null, error: previewRes.error ?? 'プレビュー計算失敗' }
  }
  const preview = previewRes.data

  const { data: existing } = await supabase
    .from('invoices')
    .select('id')
    .eq('client_id', clientId)
    .eq('invoice_month', yearMonth)
    .maybeSingle()

  if (existing) {
    const { error } = await supabase
      .from('invoices')
      .update({
        total_tax_excluded: preview.netTotal,
        consumption_tax:    preview.taxTotal,
        total_amount:       preview.grandTotal,
        due_date:           preview.dueDate,
        status:             'issued',
        issued_at:          new Date().toISOString(),
      })
      .eq('id', existing.id)
    if (error) return { data: null, error: error.message }
    return { data: { id: existing.id }, error: null }
  }

  const { data, error } = await supabase
    .from('invoices')
    .insert({
      client_id:          clientId,
      invoice_month:      yearMonth,
      total_tax_excluded: preview.netTotal,
      consumption_tax:    preview.taxTotal,
      total_amount:       preview.grandTotal,
      due_date:           preview.dueDate,
      status:             'issued',
      issued_at:          new Date().toISOString(),
    })
    .select('id')
    .single()

  if (error) return { data: null, error: error.message }
  return { data: { id: data.id }, error: null }
}

// ── 入金ステータス更新 ────────────────────────────────────

export async function updateInvoiceStatus(
  invoiceId: string,
  status: 'issued' | 'paid',
): Promise<ActionResult<{ id: string }>> {
  const supabase = createServiceClient()
  const { data, error } = await supabase
    .from('invoices')
    .update({ status })
    .eq('id', invoiceId)
    .select('id')
    .single()
  if (error) return { data: null, error: error.message }
  return { data: { id: data.id }, error: null }
}

// ── クライアント一覧 ──────────────────────────────────────

export async function fetchClientOptions(): Promise<
  ActionResult<Pick<ClientRow, 'id' | 'company_name'>[]>
> {
  const supabase = createServiceClient()
  const { data, error } = await supabase
    .from('clients')
    .select('id, company_name')
    .order('company_name')
  if (error) return { data: null, error: error.message }
  return { data: data ?? [], error: null }
}
