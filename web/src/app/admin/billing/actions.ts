'use server'

import { createServiceClient } from '@/utils/supabase/service'
import type { Database } from '@/types/supabase'
import { getCurrentTenantId } from '@/utils/tenant'
import { requireOwner } from '@/utils/auth'

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

// ── 端数処理 ──────────────────────────────────────────────

function applyRounding(value: number, rule: string): number {
  if (rule === 'floor') return Math.floor(value)
  if (rule === 'ceil')  return Math.ceil(value)
  return Math.round(value)  // 'round' = 四捨五入（デフォルト）
}

// ── project_payees ルール型 ──────────────────────────────

type PayeeRule = {
  project_id:                string
  contractor_id:             string
  payment_type:              string
  unit_price:                number | null
  tax_method:                string
  rounding_rule:             string
  adjustment_enabled:        boolean
  work_source_contractor_id: string | null
}

/**
 * project_payees ルールがある案件の件数単価計算。
 * 戻り値: { net: 税抜合計, adjustment: 調整金 }
 */
function calcPayeeAmount(rule: PayeeRule, workCount: number): { net: number; adjustment: number } {
  const unitPrice = rule.unit_price ?? 0
  const net = unitPrice * workCount

  if (!rule.adjustment_enabled || rule.tax_method !== 'inclusive') {
    return { net, adjustment: 0 }
  }

  // 業者が税込思考の場合: 単価×1.1 を端数処理した額 × 件数 が業者の期待値
  const perUnitInclusive = applyRounding(unitPrice * 1.1, rule.rounding_rule)
  const contractorExpects = perUnitInclusive * workCount
  const selfCalcInclusive = Math.floor(net * 1.1)
  const adjustment = contractorExpects - selfCalcInclusive

  return { net, adjustment }
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
  project_id:    string | null
  piece_count:   number | null
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
  const auth = await requireOwner()
  if (!auth.ok) return { data: null, error: auth.error }
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
  const auth = await requireOwner()
  if (!auth.ok) return { data: null, error: auth.error }
  const tenantId = await getCurrentTenantId()
  const supabase = createServiceClient()
  const { from, to } = monthRange(yearMonth)
  const fromStr = from.toISOString().slice(0, 10)
  const toStr   = to.toISOString().slice(0, 10)

  const [workResult, payeeResult] = await Promise.all([
    supabase
      .from('work_records')
      .select(`
        id,
        work_date,
        contractor_id,
        project_id,
        piece_count,
        projects ( price_rules ( buying_price ) ),
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
      .gte('work_date', fromStr)
      .lte('work_date', toStr),
    supabase
      .from('project_payees')
      .select('project_id, contractor_id, payment_type, unit_price, tax_method, rounding_rule, adjustment_enabled, work_source_contractor_id')
      .eq('tenant_id', tenantId),
  ])

  if (workResult.error) return { data: null, error: workResult.error.message }

  // payee rules: key = "contractor_id:project_id"
  const payeeMap = new Map<string, PayeeRule>()
  for (const r of (payeeResult.data ?? []) as any[]) {
    payeeMap.set(`${r.contractor_id}:${r.project_id}`, r as PayeeRule)
  }

  const rows = (workResult.data ?? []) as unknown as WorkRecordForPayment[]
  const map  = new Map<string, PaymentRow>()

  for (const row of rows) {
    const contractor = row.contractors
    if (!contractor) continue

    const rule = payeeMap.get(`${row.contractor_id}:${(row as any).project_id}`)
    let net: number
    if (rule && rule.unit_price !== null && rule.payment_type === 'per_piece') {
      // 個数単価制: unit_price × piece_count
      net = rule.unit_price * (row.piece_count ?? 1)
    } else if (rule && rule.unit_price !== null && rule.payment_type === 'per_unit') {
      net = rule.unit_price  // 件数単価ルールあり: 1件分の単価
    } else {
      net = (row as any).projects?.price_rules?.[0]?.buying_price ?? 0
    }

    const tax         = calcTax(net, contractor.tax_category)
    const withholding = contractor.has_withholding ? calcWithholding(net) : 0

    const existing = map.get(contractor.id)
    if (existing) {
      existing.projectCount   += 1
      existing.buyAmountNet   += net
      existing.taxAmount      += tax
      existing.withholdingTax += withholding
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
  const auth = await requireOwner()
  if (!auth.ok) return { data: null, error: auth.error }
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
  const auth = await requireOwner()
  if (!auth.ok) return { data: null, error: auth.error }
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
  const auth = await requireOwner()
  if (!auth.ok) return { data: null, error: auth.error }
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
  const auth = await requireOwner()
  if (!auth.ok) return { data: null, error: auth.error }
  const supabase = createServiceClient()
  const { data, error } = await (supabase as any)
    .from('payment_notices')
    .select('id, contractor_id, approval_status, locked, total_excluding_tax, total_tax, total_deduction, adjustment_amount')
    .eq('notice_month', `${yearMonth}-01`)

  if (error) return { data: null, error: error.message }

  return {
    data: (data ?? []).map((r: any) => ({
      contractorId:   r.contractor_id,
      noticeId:       r.id,
      approvalStatus: r.approval_status ?? 'pending',
      locked:         r.approval_status === 'approved' || r.locked === true,
      totalAmount:
        Number(r.total_excluding_tax ?? 0) +
        Number(r.total_tax ?? 0) -
        Number(r.total_deduction ?? 0) +
        Number(r.adjustment_amount ?? 0),
    })),
    error: null,
  }
}

/** 委託先1件分の支払通知書を生成（UPSERT） */
export async function generatePaymentNotice(
  contractorId: string,
  yearMonth: string,
): Promise<ActionResult<{ id: string; totalAmount: number }>> {
  const auth = await requireOwner()
  if (!auth.ok) return { data: null, error: auth.error }
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

  // project_payees ルール（この委託先の全案件設定）
  const { data: payeeRulesData, error: prErr } = await supabase
    .from('project_payees')
    .select('project_id, payment_type, unit_price, tax_method, rounding_rule, adjustment_enabled, work_source_contractor_id')
    .eq('contractor_id', contractorId)
    .eq('tenant_id', tenantId)
  if (prErr) return { data: null, error: prErr.message }

  const payeeRules = (payeeRulesData ?? []) as PayeeRule[]
  const payeeRuleMap = new Map(payeeRules.map(r => [r.project_id, r]))

  // 自身の稼働記録（案件別に集計）
  const { data: workData, error: wErr } = await supabase
    .from('work_records')
    .select('project_id, piece_count, projects(price_rules(buying_price))')
    .eq('contractor_id', contractorId)
    .eq('tenant_id', tenantId)
    .gte('work_date', fromStr)
    .lte('work_date', toStr)
  if (wErr) return { data: null, error: wErr.message }

  // 案件別集計: { count, pieceCount, buyingPriceSum }
  const projectAgg = new Map<string, { count: number; pieceCount: number; buyingPriceSum: number }>()
  for (const w of (workData ?? []) as any[]) {
    const pid = w.project_id as string | null
    if (!pid) continue
    const buying = Number(w.projects?.price_rules?.[0]?.buying_price ?? 0)
    const pieces = Number(w.piece_count ?? 1)
    const cur = projectAgg.get(pid) ?? { count: 0, pieceCount: 0, buyingPriceSum: 0 }
    projectAgg.set(pid, { count: cur.count + 1, pieceCount: cur.pieceCount + pieces, buyingPriceSum: cur.buyingPriceSum + buying })
  }

  // 再委託ケース: work_source_contractor_id が指定されている案件の稼働件数を別途取得
  const sourceContractorProjects = new Map<string, Set<string>>()
  for (const rule of payeeRules) {
    if (rule.work_source_contractor_id) {
      const set = sourceContractorProjects.get(rule.work_source_contractor_id) ?? new Set<string>()
      set.add(rule.project_id)
      sourceContractorProjects.set(rule.work_source_contractor_id, set)
    }
  }
  // sourceContractorId → (projectId → { count, pieceCount })
  const sourceWorkCounts = new Map<string, Map<string, { count: number; pieceCount: number }>>()
  for (const [sourceId, projectIds] of sourceContractorProjects) {
    const { data: srcData } = await supabase
      .from('work_records')
      .select('project_id, piece_count')
      .eq('contractor_id', sourceId)
      .eq('tenant_id', tenantId)
      .gte('work_date', fromStr)
      .lte('work_date', toStr)
      .in('project_id', Array.from(projectIds))
    const counts = new Map<string, { count: number; pieceCount: number }>()
    for (const w of (srcData ?? []) as any[]) {
      const pid    = w.project_id as string
      const pieces = Number(w.piece_count ?? 1)
      const cur    = counts.get(pid) ?? { count: 0, pieceCount: 0 }
      counts.set(pid, { count: cur.count + 1, pieceCount: cur.pieceCount + pieces })
    }
    sourceWorkCounts.set(sourceId, counts)
  }

  // 案件ごとに支払金額・調整金を算出
  // per_unit: unit_price × work_record件数
  // per_piece: unit_price × piece_count合計
  // ルールなし: buying_price の合算（後方互換）
  let laborTaxExcluded = 0
  let totalAdjustment  = 0
  const coveredProjects = new Set<string>()

  for (const rule of payeeRules) {
    if (rule.unit_price === null) continue
    if (rule.payment_type !== 'per_unit' && rule.payment_type !== 'per_piece') continue

    let workCount: number
    if (rule.payment_type === 'per_piece') {
      // 個数単価制: piece_count の合計を乗数とする
      if (rule.work_source_contractor_id) {
        workCount = sourceWorkCounts.get(rule.work_source_contractor_id)?.get(rule.project_id)?.pieceCount ?? 0
      } else {
        workCount = projectAgg.get(rule.project_id)?.pieceCount ?? 0
      }
    } else {
      // per_unit: work_record件数を乗数とする
      if (rule.work_source_contractor_id) {
        workCount = sourceWorkCounts.get(rule.work_source_contractor_id)?.get(rule.project_id)?.count ?? 0
      } else {
        workCount = projectAgg.get(rule.project_id)?.count ?? 0
      }
    }

    const { net, adjustment } = calcPayeeAmount(rule, workCount)
    laborTaxExcluded += net
    totalAdjustment  += adjustment
    coveredProjects.add(rule.project_id)
  }

  // payee ルール未設定案件: 旧来の buying_price 合算
  for (const [pid, agg] of projectAgg) {
    if (!coveredProjects.has(pid)) {
      laborTaxExcluded += agg.buyingPriceSum
    }
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

  const subtotalRegistered    = isRegistered ? laborTaxExcluded : 0
  const taxRegistered         = isRegistered ? laborTax : 0
  const subtotalUnregistered  = (!isRegistered && !isExempt) ? laborTaxExcluded : 0
  const taxUnregistered       = isRegistered ? 0 : laborTax
  const deductionUnregistered = deduction
  const subtotalExempt        = isExempt ? laborTaxExcluded : 0

  const totalExcludingTax = laborTaxExcluded + expenseTaxExcluded
  const totalTax          = laborTax + expenseTax
  const totalDeduction    = deduction
  // 調整金を加算して業者の期待値と一致させる
  const totalAmount = totalExcludingTax + totalTax - totalDeduction + totalAdjustment

  const db = supabase as any

  // 既存レコードを確認して INSERT or UPDATE
  const { data: existing } = await db
    .from('payment_notices')
    .select('id, status, approval_status, locked')
    .eq('contractor_id', contractorId)
    .eq('notice_month', targetMonth)
    .maybeSingle()

  // 子分が承認（status='locked'）/ approved / locked のいずれかなら再生成不可
  if (existing && (
    existing.approval_status === 'approved' ||
    existing.locked === true ||
    existing.status === 'locked'
  )) {
    return { data: null, error: '支払通知書はロック済みのため再生成できません。' }
  }

  // ⚠️ 生成時点では「未承認(pending)」で起票する。承認は子分（driver）が
  //    driver-actions.approvePaymentNotice で行い、その時に status='locked' /
  //    approval_status='approved' へ確定する。ここで approved 固定にすると
  //    承認フロー（合意証跡）が成立しないため厳禁。
  const noticePayload = {
    target_month:           targetMonth,
    status:                 'issued',
    subtotal_registered:    subtotalRegistered,
    tax_registered:         taxRegistered,
    subtotal_unregistered:  subtotalUnregistered,
    tax_unregistered:       taxUnregistered,
    deduction_unregistered: deductionUnregistered,
    subtotal_exempt:        subtotalExempt,
    total_excluding_tax:    totalExcludingTax,
    total_tax:              totalTax,
    total_deduction:        totalDeduction,
    adjustment_amount:      totalAdjustment,
    approval_status:        'pending',
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
  const auth = await requireOwner()
  if (!auth.ok) return { data: null, error: auth.error }
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
