'use server'

import { createClient } from '@/utils/supabase/server'
import { createServiceClient } from '@/utils/supabase/service'

type ActionResult<T> = { data: T; error: null } | { data: null; error: string }

// ── 請求書PDFデータ ───────────────────────────────────────

export type InvoicePdfLine = {
  workDate:    string
  projectName: string
  quantity:    number
  netAmount:   number
}

export type InvoicePdfData = {
  invoiceNumber: string
  issueDate:     string   // 'YYYY-MM-DD'
  dueDate:       string
  clientName:    string
  contactName:   string | null
  invoiceMonth:  string   // 'YYYY年MM月分'
  lines:         InvoicePdfLine[]
  netTotal:      number
  taxAmount:     number
  totalAmount:   number
  isTaxable:     boolean
}

export async function fetchInvoicePdfData(
  clientId:  string,
  yearMonth: string,
): Promise<ActionResult<InvoicePdfData>> {
  const supabase = await createClient()
  const { data: { user }, error: authErr } = await supabase.auth.getUser()
  if (authErr || !user) return { data: null, error: '認証が必要です' }

  const service = createServiceClient()
  const [y, m]  = yearMonth.split('-').map(Number)
  const monthEndDate = new Date(y, m, 0).toISOString().slice(0, 10)

  const [clientRes, invoiceRes, projectsRes] = await Promise.all([
    service.from('clients').select('company_name, contact_name, tax_type').eq('id', clientId).single(),
    // billing-actions.ts は YYYY-MM-01 形式で保存するため DATE 型に合わせる
    service.from('invoices')
      .select('id, total_tax_excluded, consumption_tax, total_amount, due_date')
      .eq('client_id', clientId)
      .eq('invoice_month', `${yearMonth}-01`)
      .maybeSingle(),
    service.from('projects').select('id, project_name').eq('client_id', clientId),
  ])

  if (clientRes.error || !clientRes.data) return { data: null, error: '荷主が見つかりません' }

  const client   = clientRes.data
  const invoice  = invoiceRes.data
  const projects = projectsRes.data ?? []
  const projMap  = new Map(projects.map(p => [p.id, p.project_name]))
  const projIds  = projects.map(p => p.id)

  const { data: workRows, error: wrErr } = await service
    .from('work_records')
    .select('work_date, project_id, quantity, tax_excluded_sales')
    .in('project_id', projIds.length > 0 ? projIds : ['__never__'])
    .gte('work_date', `${yearMonth}-01`)
    .lte('work_date', monthEndDate)
    .order('work_date')

  if (wrErr) return { data: null, error: wrErr.message }

  const lines: InvoicePdfLine[] = (workRows ?? []).map(r => ({
    workDate:    r.work_date,
    projectName: r.project_id ? (projMap.get(r.project_id) ?? '（案件なし）') : '（案件なし）',
    quantity:    r.quantity,
    netAmount:   r.tax_excluded_sales,
  }))

  // 確定済み invoice があればその値を優先（taxCalculator.ts との一致を保証）
  const netTotal    = invoice?.total_tax_excluded ?? lines.reduce((s, l) => s + l.netAmount, 0)
  const taxAmount   = invoice?.consumption_tax    ?? Math.round(netTotal * (client.tax_type !== 'exempt' ? 0.1 : 0))
  const totalAmount = invoice?.total_amount       ?? (netTotal + taxAmount)
  const dueDate     = invoice?.due_date           ?? monthEndDate

  // 請求書番号: INV-YYYYMM-{id先頭5文字}
  const suffix        = invoice?.id ? invoice.id.replace(/-/g, '').slice(0, 5).toUpperCase() : 'XXXXX'
  const invoiceNumber = `INV-${yearMonth.replace('-', '')}-${suffix}`

  return {
    data: {
      invoiceNumber,
      issueDate:    new Date().toISOString().slice(0, 10),
      dueDate,
      clientName:   client.company_name,
      contactName:  client.contact_name,
      invoiceMonth: `${y}年${m}月分`,
      lines,
      netTotal,
      taxAmount,
      totalAmount,
      isTaxable:    client.tax_type !== 'exempt',
    },
    error: null,
  }
}

// ── 支払通知書PDFデータ ──────────────────────────────────

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

export type PaymentNoticePdfData = {
  contractorName:       string
  invoiceRegistration:  'registered' | 'unregistered'
  noticeMonth:          string   // 'YYYY年MM月分'
  issueDate:            string
  laborLines:           LaborPdfLine[]
  expenseLines:         ExpensePdfLine[]
  laborNet:             number
  laborTax:             number
  expenseNet:           number
  expenseTax:           number
  deductionRate:        number   // e.g. 0.02
  deduction:            number
  totalAmount:          number
}

export async function fetchPaymentNoticePdfData(
  contractorId: string,
  yearMonth:    string,
): Promise<ActionResult<PaymentNoticePdfData>> {
  const supabase = await createClient()
  const { data: { user }, error: authErr } = await supabase.auth.getUser()
  if (authErr || !user) return { data: null, error: '認証が必要です' }

  const service = createServiceClient()
  const [y, m] = yearMonth.split('-').map(Number)
  const from   = `${yearMonth}-01`
  const to     = new Date(y, m, 0).toISOString().slice(0, 10)

  const [contractorRes, noticeRes, workRes, expenseRes, projectsRes] = await Promise.all([
    service.from('contractors').select('name, invoice_registration_type').eq('id', contractorId).single(),
    (service as any).from('payment_notices')
      .select('subtotal_registered, tax_registered, subtotal_unregistered, tax_unregistered, deduction_unregistered, subtotal_exempt, total_excluding_tax, total_tax, total_deduction')
      .eq('contractor_id', contractorId)
      .eq('target_month', from)
      .maybeSingle(),
    service.from('work_records')
      .select('work_date, project_id, quantity, tax_excluded_payment')
      .eq('contractor_id', contractorId)
      .gte('work_date', from).lte('work_date', to)
      .order('work_date'),
    service.from('expense_records')
      .select('expense_date, expense_type, amount_tax_excluded, tax_category')
      .eq('contractor_id', contractorId)
      .gte('expense_date', from).lte('expense_date', to)
      .order('expense_date'),
    service.from('projects').select('id, project_name'),
  ])

  if (contractorRes.error || !contractorRes.data) return { data: null, error: '委託先が見つかりません' }

  const contractor = contractorRes.data
  const notice     = noticeRes.data
  const projMap    = new Map((projectsRes.data ?? []).map(p => [p.id, p.project_name]))

  const laborLines: LaborPdfLine[] = (workRes.data ?? []).map(r => ({
    workDate:    r.work_date,
    projectName: r.project_id ? (projMap.get(r.project_id) ?? '（案件なし）') : '（案件なし）',
    quantity:    r.quantity,
    netAmount:   r.tax_excluded_payment,
  }))

  const expenseLines: ExpensePdfLine[] = (expenseRes.data ?? []).map(r => ({
    expenseDate: r.expense_date,
    expenseType: r.expense_type,
    netAmount:   r.amount_tax_excluded,
    taxAmount:   r.tax_category === 'taxable_10' ? Math.round(r.amount_tax_excluded * 0.1) : 0,
  }))

  // 確定済み notice があればその値を優先（taxCalculator.ts との一致を保証）
  const n = notice as any
  const laborNetFromNotice = n
    ? Number(n.subtotal_registered ?? 0) + Number(n.subtotal_unregistered ?? 0) + Number(n.subtotal_exempt ?? 0)
    : null
  const laborTaxFromNotice = n
    ? Number(n.tax_registered ?? 0) + Number(n.tax_unregistered ?? 0)
    : null
  const laborNet    = laborNetFromNotice ?? laborLines.reduce((s, l) => s + l.netAmount, 0)
  const laborTax    = laborTaxFromNotice ?? 0
  const totalEx     = n ? Number(n.total_excluding_tax ?? 0) : laborNet + expenseLines.reduce((s, l) => s + l.netAmount, 0)
  const totalTax    = n ? Number(n.total_tax ?? 0) : laborTax
  const expenseNet  = Math.max(0, totalEx - laborNet)
  const expenseTax  = Math.max(0, totalTax - laborTax)
  const deduction   = n ? Number(n.total_deduction ?? 0) : 0
  const deductionRate = laborTax > 0 ? Math.round((deduction / laborTax) * 100) / 100 : 0
  const totalAmount = totalEx + totalTax - deduction

  return {
    data: {
      contractorName:      contractor.name,
      invoiceRegistration: contractor.invoice_registration_type === 'registered' ? 'registered' : 'unregistered',
      noticeMonth:         `${y}年${m}月分`,
      issueDate:           new Date().toISOString().slice(0, 10),
      laborLines,
      expenseLines,
      laborNet,
      laborTax,
      expenseNet,
      expenseTax,
      deductionRate,
      deduction,
      totalAmount,
    },
    error: null,
  }
}
