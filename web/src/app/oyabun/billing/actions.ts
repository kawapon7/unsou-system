'use server'

import { createServiceClient } from '@/utils/supabase/service'
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
    .gte('work_date', from.toISOString().slice(0, 10))
    .lte('work_date', to.toISOString().slice(0, 10))

  if (error) return { data: null, error: error.message }

  const rows = (data ?? []) as unknown as WorkRecordForBilling[]
  const map = new Map<string, BillingRow>()

  for (const row of rows) {
    const client = row.projects?.clients
    if (!client) continue

    const { from: cFrom, to: cTo } = closingRange(yearMonth, client.closing_day)
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
