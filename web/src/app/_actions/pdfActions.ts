'use server'

import React from 'react'
import { renderToBuffer } from '@react-pdf/renderer'
import { createClient } from '@/utils/supabase/server'
import { createServiceClient } from '@/utils/supabase/service'
import { decryptBankFieldValue } from '@/utils/crypto'
import { calcInvoiceTax } from '@/lib/invoice'
import { getTransitionalDeductionRate } from '@/utils/billing/taxCalculator'
import { getCurrentTenantId } from '@/utils/tenant'
import InvoicePdfTemplate from '@/app/admin/_components/InvoicePdfTemplate'
import PaymentNoticePdfTemplate from '@/app/admin/_components/PaymentNoticePdfTemplate'
import { ensurePdfFonts } from '@/utils/pdf/registerFonts'

type ActionResult<T> = { data: T; error: null } | { data: null; error: string }

export type InvoicePdfLine = {
  workDate:    string
  projectName: string
  quantity:    number
  netAmount:   number
}

export type InvoicePdfTemplateData = {
  invoiceNumber: string
  issueDate:     string
  dueDate:       string
  clientName:    string
  contactName:   string | null
  invoiceMonth:  string
  lines:         InvoicePdfLine[]
  netTotal:      number
  taxAmount:     number
  totalAmount:   number
  isTaxable:     boolean
}

export type LaborPdfLine = {
  workDate:    string
  projectName: string
  quantity:    number
  netAmount:   number
}

export type ExpensePdfLine = {
  expenseDate: string
  expenseType: string
  netAmount:   number
  taxAmount:   number
}

export type PaymentNoticePdfTemplateData = {
  contractorName:      string
  noticeMonth:         string
  issueDate:           string
  isInvoiceRegistered: boolean
  laborLines:          LaborPdfLine[]
  expenseLines:        ExpensePdfLine[]
  laborNet:            number
  laborTax:            number
  expenseNet:          number
  expenseTax:          number
  deductionRate:       number
  deduction:           number
  totalAmount:         number
  bankName:            string
  bankBranch:          string
  accountType:         string
  accountNumber:       string
  accountHolder:       string
}

export type PdfPayload = {
  pdfBase64: string
  filename:  string
}

function toDbMonth(yearMonth: string): string {
  return yearMonth.length === 7 ? `${yearMonth}-01` : yearMonth
}

function monthBounds(yearMonth: string) {
  const [y, m] = yearMonth.split('-').map(Number)
  return {
    from:       `${yearMonth}-01`,
    to:         new Date(y, m, 0).toISOString().slice(0, 10),
    targetDate: new Date(y, m - 1, 15),
    label:      `${y}年${m}月分`,
  }
}

function metaNumber(meta: unknown, key: string): number | null {
  if (!meta || typeof meta !== 'object' || Array.isArray(meta)) return null
  const v = (meta as Record<string, unknown>)[key]
  return typeof v === 'number' ? v : null
}

function isInvoiceRegistered(type: string | null | undefined): boolean {
  return type === 'registered' || type === '適格'
}

function isTaxableCategory(category: string | null | undefined): boolean {
  return category !== 'exempt' && category !== '免税' && category !== 'non_taxable'
}

function resolveSalesNet(row: any): number {
  const fromMeta = metaNumber(row.metadata, 'tax_excluded_sales') ?? metaNumber(row.metadata, 'net_amount')
  if (fromMeta != null) return fromMeta

  const rules = row.projects?.price_rules
  const rule  = Array.isArray(rules) ? rules[0] : rules ?? null
  const unit    = Number(rule?.selling_price ?? row.projects?.sale_amount ?? 0)
  const qty     = Number(row.piece_count ?? 1)
  return unit * (qty || 1)
}

function resolvePaymentNet(row: any): number {
  const fromMeta = metaNumber(row.metadata, 'tax_excluded_payment') ?? metaNumber(row.metadata, 'payment_net')
  if (fromMeta != null) return fromMeta

  const rules = row.projects?.price_rules
  const rule  = Array.isArray(rules) ? rules[0] : rules ?? null
  const unit    = Number(rule?.buying_price ?? 0)
  const qty     = Number(row.piece_count ?? 1)
  return unit * (qty || 1)
}

async function requireAuth() {
  const supabase = await createClient()
  const { data: { user }, error } = await supabase.auth.getUser()
  if (error || !user) return { ok: false as const, error: '認証が必要です' }
  return { ok: true as const, user }
}

export async function buildInvoicePdfData(
  clientId:  string,
  yearMonth: string,
): Promise<ActionResult<InvoicePdfTemplateData>> {
  const auth = await requireAuth()
  if (!auth.ok) return { data: null, error: auth.error }

  const tenantId = await getCurrentTenantId()
  const service  = createServiceClient()
  const bounds   = monthBounds(yearMonth)

  const [clientRes, invoiceRes, projectsRes] = await Promise.all([
    service.from('clients')
      .select('company_name, contact_name, tax_type, closing_day, payment_site')
      .eq('id', clientId)
      .eq('tenant_id', tenantId)
      .single(),
    service.from('invoices')
      .select('id, total_tax_excluded, consumption_tax, total_amount, due_date, total_amount_ex_tax, total_tax')
      .eq('client_id', clientId)
      .eq('target_month', toDbMonth(yearMonth))
      .maybeSingle(),
    service.from('projects')
      .select('id, project_name, sale_amount, price_rules(selling_price)')
      .eq('client_id', clientId)
      .eq('tenant_id', tenantId),
  ])

  if (clientRes.error || !clientRes.data) {
    return { data: null, error: clientRes.error?.message ?? '荷主が見つかりません' }
  }

  const client   = clientRes.data
  const invoice  = invoiceRes.data
  const projects = projectsRes.data ?? []
  const projMap  = new Map(projects.map(p => [p.id, p.project_name]))
  const projIds  = projects.map(p => p.id)

  const { data: workRows, error: wrErr } = await service
    .from('work_records')
    .select('work_date, project_id, piece_count, metadata, projects(project_name, sale_amount, price_rules(selling_price))')
    .in('project_id', projIds.length > 0 ? projIds : ['00000000-0000-0000-0000-000000000000'])
    .eq('tenant_id', tenantId)
    .gte('work_date', bounds.from)
    .lte('work_date', bounds.to)
    .order('work_date')

  if (wrErr) return { data: null, error: wrErr.message }

  const lines: InvoicePdfLine[] = (workRows ?? []).map(r => ({
    workDate:    r.work_date,
    projectName: r.project_id ? (projMap.get(r.project_id) ?? '（案件なし）') : '（案件なし）',
    quantity:    Number(r.piece_count ?? 0),
    netAmount:   resolveSalesNet(r),
  }))

  const netFromLines = lines.reduce((s, l) => s + l.netAmount, 0)
  const netTotal     = invoice?.total_tax_excluded ?? invoice?.total_amount_ex_tax ?? netFromLines
  const isTaxable    = client.tax_type !== 'exempt'
  const taxAmount    = invoice?.consumption_tax ?? invoice?.total_tax ?? (isTaxable ? calcInvoiceTax(netTotal, client.tax_type) : 0)
  const totalAmount  = invoice?.total_amount ?? (netTotal + taxAmount)
  const dueDate      = invoice?.due_date ?? bounds.to

  const suffix        = invoice?.id ? invoice.id.replace(/-/g, '').slice(0, 5).toUpperCase() : 'DRAFT'
  const invoiceNumber = `INV-${yearMonth.replace('-', '')}-${suffix}`

  return {
    data: {
      invoiceNumber,
      issueDate:    new Date().toISOString().slice(0, 10),
      dueDate,
      clientName:   client.company_name,
      contactName:  client.contact_name,
      invoiceMonth: bounds.label,
      lines,
      netTotal,
      taxAmount,
      totalAmount,
      isTaxable,
    },
    error: null,
  }
}

export async function buildPaymentNoticePdfData(
  contractorId: string,
  yearMonth:    string,
): Promise<ActionResult<PaymentNoticePdfTemplateData>> {
  const auth = await requireAuth()
  if (!auth.ok) return { data: null, error: auth.error }

  const tenantId = await getCurrentTenantId()
  const service  = createServiceClient()
  const bounds   = monthBounds(yearMonth)

  const [contractorRes, workRes, expenseRes, projectsRes] = await Promise.all([
    service.from('contractors')
      .select('name, tax_category, invoice_registration_type, bank_name, bank_branch, account_type, account_number, account_holder, branch_name')
      .eq('id', contractorId)
      .eq('tenant_id', tenantId)
      .single(),
    service.from('work_records')
      .select('work_date, project_id, piece_count, metadata, projects(project_name, price_rules(buying_price))')
      .eq('contractor_id', contractorId)
      .eq('tenant_id', tenantId)
      .gte('work_date', bounds.from)
      .lte('work_date', bounds.to)
      .order('work_date'),
    service.from('expense_records')
      .select('expense_date, expense_type, category, amount_tax_excluded, amount_actual, tax_category')
      .eq('contractor_id', contractorId)
      .eq('tenant_id', tenantId)
      .gte('expense_date', bounds.from)
      .lte('expense_date', bounds.to)
      .order('expense_date'),
    service.from('projects')
      .select('id, project_name'),
  ])

  if (contractorRes.error || !contractorRes.data) {
    return { data: null, error: contractorRes.error?.message ?? '委託先が見つかりません' }
  }
  if (workRes.error) return { data: null, error: workRes.error.message }
  if (expenseRes.error) return { data: null, error: expenseRes.error.message }

  const contractor = contractorRes.data
  const projMap    = new Map((projectsRes.data ?? []).map(p => [p.id, p.project_name]))
  const registered = isInvoiceRegistered(contractor.invoice_registration_type)

  const laborLines: LaborPdfLine[] = (workRes.data ?? []).map(r => ({
    workDate:    r.work_date,
    projectName: r.project_id ? (projMap.get(r.project_id) ?? '（案件なし）') : '（案件なし）',
    quantity:    Number(r.piece_count ?? 0),
    netAmount:   resolvePaymentNet(r),
  }))

  const laborNet = laborLines.reduce((s, l) => s + l.netAmount, 0)
  const laborTax = isTaxableCategory(contractor.tax_category) ? Math.round(laborNet * 0.1) : 0

  const expenseLines: ExpensePdfLine[] = (expenseRes.data ?? []).map(r => {
    const net = Number(r.amount_tax_excluded ?? 0)
    const taxable = isTaxableCategory(r.tax_category)
    return {
      expenseDate: r.expense_date,
      expenseType: r.expense_type ?? r.category ?? 'other',
      netAmount:   net,
      taxAmount:   taxable ? Math.max(0, Number(r.amount_actual ?? 0) - net) : 0,
    }
  })

  const expenseNet     = expenseLines.reduce((s, l) => s + l.netAmount, 0)
  const expenseTaxable = expenseLines.filter(l => l.taxAmount > 0).reduce((s, l) => s + l.netAmount, 0)
  const expenseTax     = Math.round(expenseTaxable * 0.1)

  const deductionRate = getTransitionalDeductionRate(registered, bounds.targetDate)
  const laborWithTax  = laborNet + laborTax
  const deduction     = !registered && laborTax > 0 ? Math.round(laborWithTax * deductionRate) : 0
  const totalAmount   = laborNet + laborTax + expenseNet + expenseTax - deduction

  return {
    data: {
      contractorName:      contractor.name,
      noticeMonth:         bounds.label,
      issueDate:           new Date().toISOString().slice(0, 10),
      isInvoiceRegistered: registered,
      laborLines,
      expenseLines,
      laborNet,
      laborTax,
      expenseNet,
      expenseTax,
      deductionRate,
      deduction,
      totalAmount,
      bankName:      decryptBankFieldValue(contractor.bank_name),
      bankBranch:    decryptBankFieldValue(contractor.bank_branch ?? contractor.branch_name),
      accountType:   decryptBankFieldValue(contractor.account_type),
      accountNumber: decryptBankFieldValue(contractor.account_number),
      accountHolder: decryptBankFieldValue(contractor.account_holder),
    },
    error: null,
  }
}

export async function generateInvoicePdf(
  clientId:  string,
  yearMonth: string,
): Promise<ActionResult<PdfPayload>> {
  const built = await buildInvoicePdfData(clientId, yearMonth)
  if (built.error || !built.data) return { data: null, error: built.error ?? 'データ組み立て失敗' }

  try {
    ensurePdfFonts()
    const buffer = await renderToBuffer(
      React.createElement(InvoicePdfTemplate, { data: built.data }) as any,
    )
    return {
      data: {
        pdfBase64: Buffer.from(buffer).toString('base64'),
        filename:  `invoice_${yearMonth}_${clientId.slice(0, 8)}.pdf`,
      },
      error: null,
    }
  } catch (e) {
    return { data: null, error: e instanceof Error ? e.message : 'PDF生成に失敗しました' }
  }
}

export async function generatePaymentNoticePdf(
  contractorId: string,
  yearMonth:    string,
): Promise<ActionResult<PdfPayload>> {
  const built = await buildPaymentNoticePdfData(contractorId, yearMonth)
  if (built.error || !built.data) return { data: null, error: built.error ?? 'データ組み立て失敗' }

  try {
    ensurePdfFonts()
    const buffer = await renderToBuffer(
      React.createElement(PaymentNoticePdfTemplate, { data: built.data }) as any,
    )
    return {
      data: {
        pdfBase64: Buffer.from(buffer).toString('base64'),
        filename:  `payment_notice_${yearMonth}_${contractorId.slice(0, 8)}.pdf`,
      },
      error: null,
    }
  } catch (e) {
    return { data: null, error: e instanceof Error ? e.message : 'PDF生成に失敗しました' }
  }
}
