'use server'

import { createClient } from '@/utils/supabase/server'
import type { Database } from '@/types/supabase'

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

type ProjectWithClient = {
  id:            string
  sale_amount:   number
  operation_end: string | null
  client_id:     string
  clients:       Pick<ClientRow, 'id' | 'company_name' | 'tax_type' | 'invoice_registered' | 'closing_day' | 'payment_site'> | null
}

type ProjectWithContractor = {
  id:            string
  buy_amount:    number | null
  operation_end: string | null
  contractor_id: string | null
  contractors:   Pick<ContractorRow, 'id' | 'name' | 'tax_type' | 'invoice_registration_type' | 'invoice_registration_number' | 'withholding_tax_flag' | 'payment_site'> | null
}

// ── 荷主向け請求集計 ──────────────────────────────────────

export async function fetchBillingByClient(
  yearMonth: string,
): Promise<ActionResult<BillingRow[]>> {
  const supabase = await createClient()

  const { data, error } = await supabase
    .from('projects')
    .select(`
      id,
      sale_amount,
      operation_end,
      client_id,
      clients (
        id,
        company_name,
        tax_type,
        invoice_registered,
        closing_day,
        payment_site
      )
    `)
    .eq('status', 'completed')
    .not('operation_end', 'is', null)

  if (error) return { data: null, error: error.message }

  const rows = (data ?? []) as unknown as ProjectWithClient[]
  const map = new Map<string, BillingRow>()

  for (const row of rows) {
    const client = row.clients
    if (!client || !row.operation_end) continue

    const { from, to } = closingRange(yearMonth, client.closing_day)
    const opEnd = new Date(row.operation_end)
    if (opEnd < from || opEnd > to) continue

    const net = row.sale_amount ?? 0
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
        invoiceRegistered: client.invoice_registered,
        closingDay:        client.closing_day,
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
  const supabase = await createClient()

  const { data, error } = await supabase
    .from('projects')
    .select(`
      id,
      buy_amount,
      operation_end,
      contractor_id,
      contractors (
        id,
        name,
        tax_type,
        invoice_registration_type,
        invoice_registration_number,
        withholding_tax_flag,
        payment_site
      )
    `)
    .eq('status', 'completed')
    .not('contractor_id', 'is', null)
    .not('operation_end', 'is', null)

  if (error) return { data: null, error: error.message }

  const rows = (data ?? []) as unknown as ProjectWithContractor[]
  const { from, to } = monthRange(yearMonth)
  const map = new Map<string, PaymentRow>()

  for (const row of rows) {
    const contractor = row.contractors
    if (!contractor || row.buy_amount == null || !row.operation_end) continue

    const opEnd = new Date(row.operation_end)
    if (opEnd < from || opEnd > to) continue

    const net         = row.buy_amount
    const tax         = calcTax(net, contractor.tax_type)
    const withholding = contractor.withholding_tax_flag ? calcWithholding(net) : 0

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
        taxType:            contractor.tax_type,
        invoiceType:        contractor.invoice_registration_type,
        invoiceNumber:      contractor.invoice_registration_number,
        withholdingTaxFlag: contractor.withholding_tax_flag,
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
