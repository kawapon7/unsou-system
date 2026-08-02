'use server'

import { createServiceClient } from '@/utils/supabase/service'
import type { Database } from '@/types/supabase'
import { getCurrentTenantId } from '@/utils/tenant'
import { requireOwner } from '@/utils/auth'
import { closingRange, formatLocalDate } from '@/utils/closing-period'
import {
  calcTransitionalDeduction,
  getDeductionRate,
  type TransitionalPurchase,
} from '@/utils/transitional-deduction'
import { parseLocalDate } from '@/utils/closing-period'

type ClientRow     = Database['public']['Tables']['clients']['Row']
type ContractorRow = Database['public']['Tables']['contractors']['Row']

// ── 締め日ユーティリティ ───────────────────────────────────

/**
 * 締め日文字列（"20", "25", "月末" 等）と年月から締め期間を算出。
 * 例: yearMonth=2026-06, closingDay=20 → 2026-05-21 〜 2026-06-20
 *
 * ⚠️ 実装は utils/closing-period.ts へ集約した（2026-08-02）。
 *    同じ closingRange がこのファイルを含め 3 箇所に重複していた。
 *    返り値はローカル日付の 'YYYY-MM-DD' 文字列（date 列とそのまま比較できる）。
 *    従来の toISOString() 方式は JST の開発機で月末が 1 日前にずれていた。
 */

// ── 税額計算 ──────────────────────────────────────────────

function calcTax(amount: number, taxType: string): number {
  if (taxType === 'exclusive') return Math.floor(amount * 0.1)
  if (taxType === 'inclusive') return Math.floor(amount - amount / 1.1)
  return 0
}

/**
 * 日付ごとの税抜額から、経過措置の判定に渡す「税込」の課税仕入れリストを作る。
 *
 * ⚠️ ここで出す税込額は**経過措置の差し引き額を出すためだけ**に使う。
 *    日付ごとに消費税を計算して足し合わせるため、支払通知書本体の消費税額
 *    （税抜合計に対して 1 回だけ算出する）とは数円ずれうる。本体金額には使わないこと。
 */
function buildTaxIncludedPurchases(
  netByDate: Map<string, number>,
  taxType: string,
): TransitionalPurchase[] {
  return [...netByDate.entries()].map(([date, taxExcluded]) => ({
    date,
    taxIncludedAmount: taxType === 'inclusive'
      ? taxExcluded                                  // 単価が税込。そのまま税込額
      : taxExcluded + calcTax(taxExcluded, taxType), // exclusive は加算、非課税は 0 加算
  }))
}

// ── 経過措置の率ごとの稼働バケット ────────────────────────
// ⚠️ 率は稼働日ごとに決まるため（消基通 11-3-1）、案件別の集計を率でも分ける。
//    率をキーにするのは、同じ率の日をまとめて 1 回だけ端数処理するため。
//    sampleDate はその率を代表する日付（calcTransitionalDeduction に渡す）。

type WorkBucket = { count: number; pieceCount: number; buyingPriceSum: number; sampleDate: string }

function bucketsOf<K>(m: Map<K, Map<number, WorkBucket>>, key: K): Map<number, WorkBucket> {
  const existing = m.get(key)
  if (existing) return existing
  const created = new Map<number, WorkBucket>()
  m.set(key, created)
  return created
}

function addToBucket(
  buckets: Map<number, WorkBucket>,
  workDate: string,
  add: { count: number; pieceCount: number; buyingPriceSum: number },
): void {
  // 登録状況に関わらず率で分ける。適格なら最終的に差し引き 0 になるだけ
  const rate = getDeductionRate(parseLocalDate(workDate))
  const cur  = buckets.get(rate)
  if (cur) {
    cur.count          += add.count
    cur.pieceCount     += add.pieceCount
    cur.buyingPriceSum += add.buyingPriceSum
  } else {
    buckets.set(rate, { ...add, sampleDate: workDate })
  }
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
  deductionTax:       number   // インボイス経過措置による控除額（免税・未登録のみ）
  adjustment:         number   // 税込思考業者の端数補正（inclusive＋調整有効の payee のみ）
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
  contractors: (Pick<ContractorRow, 'id' | 'name' | 'invoice_registration_type' | 'closing_day' | 'payment_site'> & {
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

  // 締め日は荷主ごとに異なるため、取得窓は「前月1日〜当月末日」に広げ、
  // 行ごとに各荷主の closingRange で絞り込む（前月締め分の取りこぼし防止）。
  const [yy, mm]  = yearMonth.split('-').map(Number)
  const fetchFrom = new Date(yy, mm - 2, 1)
  const fetchTo   = new Date(yy, mm, 0)

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
    .gte('work_date', fetchFrom.toISOString().slice(0, 10))
    .lte('work_date', fetchTo.toISOString().slice(0, 10))

  if (error) return { data: null, error: error.message }

  const rows = (data ?? []) as unknown as WorkRecordForBilling[]

  // 税抜き売上(net)と件数のみ集計し、税は「合計後に1回」算出する。
  type BillingAgg = Omit<BillingRow, 'taxAmount' | 'totalGross'>
  const map = new Map<string, BillingAgg>()

  for (const row of rows) {
    const client = row.projects?.clients
    if (!client) continue

    const { from: cFrom, to: cTo } = closingRange(yearMonth, String(client.closing_day))
    const workDate = row.work_date            // 'YYYY-MM-DD'。文字列比較で足りる
    if (workDate < cFrom || workDate > cTo) continue

    const net = row.projects?.price_rules?.[0]?.selling_price ?? 0

    const existing = map.get(client.id)
    if (existing) {
      existing.projectCount  += 1
      existing.saleAmountNet += net
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
      })
    }
  }

  const result: BillingRow[] = Array.from(map.values()).map(r => {
    const taxAmount = calcTax(r.saleAmountNet, r.taxType)
    return { ...r, taxAmount, totalGross: r.saleAmountNet + taxAmount }
  })

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

  // 締め日は委託先ごとに異なるため、取得窓は「前月1日〜当月末日」に広げ、
  // 行ごとに各委託先の closingRange で絞り込む（前月締め分の取りこぼし防止）。
  // clients 側の fetchBillingByClient と同じパターン。
  // ⚠️ 従来 toISOString() で日付文字列を作っており、JST の開発機では 1 日前にずれていた
  //    （本番 Workers は UTC なのでずれない＝開発機と本番で取得範囲が食い違う）。
  const [yy, mm] = yearMonth.split('-').map(Number)
  const fromStr  = formatLocalDate(new Date(yy, mm - 2, 1))
  const toStr    = formatLocalDate(new Date(yy, mm, 0))

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
          closing_day,
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

  // ── ① 委託先ごとに税抜き支払額(net)と件数のみを集計 ──
  // 税・控除・源泉は「合計後に1回」算出する（行ごと丸めによる1円ズレ防止／generatePaymentNotice と整合）。
  type PayeeAgg = {
    contractorId:       string
    name:               string
    taxType:            string
    invoiceType:        string
    invoiceNumber:      string | null
    withholdingTaxFlag: boolean
    paymentSite:        number
    projectCount:       number
    buyAmountNet:       number
    /** 経過措置の率判定用。稼働日ごとの税抜額を保持する（月単位で率を決めると誤る） */
    netByDate:          Map<string, number>
  }
  const map = new Map<string, PayeeAgg>()
  // 調整金算出用: contractorId → (projectId → { count, pieceCount })
  const workAgg = new Map<string, Map<string, { count: number; pieceCount: number }>>()

  for (const row of rows) {
    const contractor = row.contractors
    if (!contractor) continue

    const { from: ccFrom, to: ccTo } = closingRange(yearMonth, String(contractor.closing_day ?? '月末'))
    const workDate = row.work_date            // 'YYYY-MM-DD'。文字列比較で足りる
    if (workDate < ccFrom || workDate > ccTo) continue

    const projectId = (row as any).project_id as string | null
    const rule = payeeMap.get(`${row.contractor_id}:${projectId}`)
    let net: number
    if (rule && rule.unit_price !== null && rule.payment_type === 'per_piece') {
      // 個数単価制: unit_price × piece_count
      net = rule.unit_price * (row.piece_count ?? 1)
    } else if (rule && rule.unit_price !== null && rule.payment_type === 'per_unit') {
      net = rule.unit_price  // 件数単価ルールあり: 1件分の単価
    } else {
      net = (row as any).projects?.price_rules?.[0]?.buying_price ?? 0
    }

    // 案件別の件数・個数を集計（調整金計算に使用）
    if (projectId) {
      const byProject = workAgg.get(contractor.id) ?? new Map<string, { count: number; pieceCount: number }>()
      const cur = byProject.get(projectId) ?? { count: 0, pieceCount: 0 }
      byProject.set(projectId, { count: cur.count + 1, pieceCount: cur.pieceCount + (row.piece_count ?? 1) })
      workAgg.set(contractor.id, byProject)
    }

    const existing = map.get(contractor.id)
    if (existing) {
      existing.projectCount += 1
      existing.buyAmountNet += net
      existing.netByDate.set(workDate, (existing.netByDate.get(workDate) ?? 0) + net)
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
        netByDate:          new Map([[workDate, net]]),
      })
    }
  }

  // payee ルールを委託先ごとにまとめる（調整金算出用）
  const rulesByContractor = new Map<string, PayeeRule[]>()
  for (const rule of payeeMap.values()) {
    const list = rulesByContractor.get(rule.contractor_id) ?? []
    list.push(rule)
    rulesByContractor.set(rule.contractor_id, list)
  }

  // ── ② 合計に対して税・経過措置控除・源泉・調整金を1回ずつ算出 ──
  const result: PaymentRow[] = Array.from(map.values()).map(a => {
    const taxAmount      = calcTax(a.buyAmountNet, a.taxType)
    // ⚠️ 経過措置の差し引き。2026-08-02 に 3 点を修正した:
    //    ①率は正本 utils/transitional-deduction.ts から取る（旧 calcDeductionRate は
    //      令和8年度改正の 3% 区分を持たず、2029年10月以降は 0 を返していた）
    //    ②基準額を税抜(laborTax)から**税込**へ（実物の支払明細書に合わせる）
    //    ③率は対象月ではなく**稼働日ごと**に判定する（消基通 11-3-1）
    const deductionTax   = calcTransitionalDeduction(
      buildTaxIncludedPurchases(a.netByDate, a.taxType),
      a.invoiceType === '適格',
    ).deduction
    const withholdingTax = a.withholdingTaxFlag ? calcWithholding(a.buyAmountNet) : 0

    // 調整金: inclusive＋調整有効の payee ルールについて端数補正を加算。
    // ※再委託（work_source_contractor_id 指定）は一覧では未対応（確定通知書側で算出）。
    let adjustment = 0
    const projAgg = workAgg.get(a.contractorId)
    for (const rule of rulesByContractor.get(a.contractorId) ?? []) {
      if (rule.unit_price === null) continue
      if (rule.payment_type !== 'per_unit' && rule.payment_type !== 'per_piece') continue
      if (rule.work_source_contractor_id) continue
      const agg = projAgg?.get(rule.project_id)
      if (!agg) continue
      const workCount = rule.payment_type === 'per_piece' ? agg.pieceCount : agg.count
      adjustment += calcPayeeAmount(rule, workCount).adjustment
    }

    return {
      ...a,
      taxAmount,
      deductionTax,
      adjustment,
      withholdingTax,
      netPayment: a.buyAmountNet + taxAmount - deductionTax + adjustment - withholdingTax,
    }
  })

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
  const tenantId = await getCurrentTenantId()
  const supabase = createServiceClient()
  const { data, error } = await supabase
    .from('expense_records')
    .update({ approval_status: 'approved' })
    .eq('id', expenseId)
    .eq('tenant_id', tenantId)
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
  const tenantId = await getCurrentTenantId()
  const supabase = createServiceClient()
  const { data, error } = await supabase
    .from('expense_records')
    .update({ approval_status: 'rejected' })
    .eq('id', expenseId)
    .eq('tenant_id', tenantId)
    .select('id')
    .single()
  if (error) return { data: null, error: error.message }
  return { data: { id: data.id }, error: null }
}

// ── 支払通知書生成 ────────────────────────────────────────

// ⚠️ 旧 calcDeductionRate はここにあったが 2026-08-02 に廃止した。
//    ①令和8年度改正で新設された 70%控除（差し引き 3%）の区分を持っていなかった
//    ②2029年10月以降に 0 を返していた（経過措置が終わって全額控除不可になる時期に
//      差し引きをやめるという、向きが逆の誤り）
//    ③基準額が税抜だった（実物の支払明細書は税込基準）
//    ④率を対象月で決めていた（正しくは稼働日ごと。消基通 11-3-1）
//    率の正本は utils/transitional-deduction.ts。ここに率表を再び書かないこと。

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
  const targetMonth = `${yearMonth}-01`

  // 委託先マスタ
  const { data: c, error: cErr } = await supabase
    .from('contractors')
    .select('tax_category, invoice_registration_type, has_withholding, closing_day')
    .eq('id', contractorId)
    .eq('tenant_id', tenantId)
    .single()
  if (cErr || !c) return { data: null, error: cErr?.message ?? '委託先が見つかりません' }
  const contractor = c as any

  // 締め日は委託先ごとに異なる（fetchPaymentByContractor と同じ closingRange ロジック）
  // ⚠️ 従来 toISOString() を挟んでおり JST の開発機で 1 日ずれていた。共通モジュールは
  //    はじめからローカル日付の 'YYYY-MM-DD' を返すため、そのまま使う。
  const { from: fromStr, to: toStr } = closingRange(yearMonth, String(contractor.closing_day ?? '月末'))

  // project_payees ルール（この委託先の全案件設定）
  const { data: payeeRulesData, error: prErr } = await supabase
    .from('project_payees')
    .select('project_id, payment_type, unit_price, tax_method, rounding_rule, adjustment_enabled, work_source_contractor_id')
    .eq('contractor_id', contractorId)
    .eq('tenant_id', tenantId)
  if (prErr) return { data: null, error: prErr.message }

  const payeeRules = (payeeRulesData ?? []) as PayeeRule[]
  const payeeRuleMap = new Map(payeeRules.map(r => [r.project_id, r]))

  // 自身の稼働記録（案件別・経過措置の率別に集計）
  // ⚠️ work_date を取るのは、経過措置の率が稼働日ごとに決まるため（消基通 11-3-1）。
  //    締め期間が 2026年10月1日をまたぐと、1 枚の通知書に 2% 分と 3% 分が混在する。
  const { data: workData, error: wErr } = await supabase
    .from('work_records')
    .select('project_id, work_date, piece_count, projects(price_rules(buying_price))')
    .eq('contractor_id', contractorId)
    .eq('tenant_id', tenantId)
    .gte('work_date', fromStr)
    .lte('work_date', toStr)
  if (wErr) return { data: null, error: wErr.message }

  // 案件別・率別集計: projectId → rate → { count, pieceCount, buyingPriceSum, sampleDate }
  const projectAgg = new Map<string, Map<number, WorkBucket>>()
  for (const w of (workData ?? []) as any[]) {
    const pid = w.project_id as string | null
    if (!pid) continue
    const buying = Number(w.projects?.price_rules?.[0]?.buying_price ?? 0)
    const pieces = Number(w.piece_count ?? 1)
    addToBucket(bucketsOf(projectAgg, pid), String(w.work_date), { count: 1, pieceCount: pieces, buyingPriceSum: buying })
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
  // sourceContractorId → (projectId → rate → WorkBucket)
  const sourceWorkCounts = new Map<string, Map<string, Map<number, WorkBucket>>>()
  for (const [sourceId, projectIds] of sourceContractorProjects) {
    const { data: srcData } = await supabase
      .from('work_records')
      .select('project_id, work_date, piece_count')
      .eq('contractor_id', sourceId)
      .eq('tenant_id', tenantId)
      .gte('work_date', fromStr)
      .lte('work_date', toStr)
      .in('project_id', Array.from(projectIds))
    const counts = new Map<string, Map<number, WorkBucket>>()
    for (const w of (srcData ?? []) as any[]) {
      const pid    = w.project_id as string
      const pieces = Number(w.piece_count ?? 1)
      addToBucket(bucketsOf(counts, pid), String(w.work_date), { count: 1, pieceCount: pieces, buyingPriceSum: 0 })
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
  // 経過措置の判定用: 率を代表する日付 → その率に属する税抜労務報酬
  const netByDate = new Map<string, number>()
  const addNet = (sampleDate: string, amount: number) => {
    netByDate.set(sampleDate, (netByDate.get(sampleDate) ?? 0) + amount)
  }

  for (const rule of payeeRules) {
    if (rule.unit_price === null) continue
    if (rule.payment_type !== 'per_unit' && rule.payment_type !== 'per_piece') continue

    const buckets = rule.work_source_contractor_id
      ? sourceWorkCounts.get(rule.work_source_contractor_id)?.get(rule.project_id)
      : projectAgg.get(rule.project_id)

    // ⚠️ 率ごとに calcPayeeAmount を呼ぶ。締め期間が率の境界をまたぐ月は呼び出しが
    //    2 回になるため、端数処理の回数が増えて従来より最大 1 円ずれうる。
    //    率が 1 つしかない通常月では従来と完全に同じ結果になる。
    for (const bucket of (buckets?.values() ?? [])) {
      const workCount = rule.payment_type === 'per_piece' ? bucket.pieceCount : bucket.count
      const { net, adjustment } = calcPayeeAmount(rule, workCount)
      laborTaxExcluded += net
      totalAdjustment  += adjustment
      addNet(bucket.sampleDate, net)
    }
    coveredProjects.add(rule.project_id)
  }

  // payee ルール未設定案件: 旧来の buying_price 合算
  for (const [pid, buckets] of projectAgg) {
    if (coveredProjects.has(pid)) continue
    for (const bucket of buckets.values()) {
      laborTaxExcluded += bucket.buyingPriceSum
      addNet(bucket.sampleDate, bucket.buyingPriceSum)
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
  // ⚠️ 2026-08-02 に 3 点修正: ①率は正本 utils/transitional-deduction.ts から取る
  //    ②基準額を税抜(laborTax)から税込へ ③率は対象月でなく稼働日ごとに判定（消基通 11-3-1）
  const isRegisteredContractor = contractor.invoice_registration_type === '適格'
  const deductionResult = calcTransitionalDeduction(
    buildTaxIncludedPurchases(netByDate, contractor.tax_category),
    isRegisteredContractor,
  )
  const deduction = deductionResult.deduction
  // 保存用の率（payment_notices.deduction_rate）。
  // ⚠️ 率が混在する月は「単一の正しい％」が存在しない。差し引き額と辻褄が合うよう
  //    実効率（差し引き額 ÷ 税込合計）を保存する。率が 1 つの通常月はその率と一致する。
  const deductionBase = deductionResult.breakdown.reduce((s, b) => s + b.taxIncludedAmount, 0)
  const deductionRate = deductionBase > 0 ? deduction / deductionBase : 0

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
    // ⚠️ payment_notices.status の許可値は 'unapproved' | 'approved' | 'locked' のみ
    //    （DBのCHECK制約 payment_notices_status_check）。
    //    'issued' / 'paid' は invoices（請求書）側の語彙であり、ここで使うと
    //    「new row violates check constraint」で生成が必ず失敗する。
    status:                 'unapproved',
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
    // ⚠️ 2026-08-02 追加。この経路は内訳列と total_amount を一切書いておらず、
    //    生成された支払通知書は DB 上 total_amount=0・内訳すべて 0 のままだった
    //    （一覧画面は total_excluding_tax + total_tax - total_deduction + adjustment で
    //     その場で計算し直しており、列の欠落が表面化していなかった）。
    //    PDF は deduction_rate を印字し、年度累計は labor_*/expense_* を積むため、実値を保存する。
    labor_tax_excluded:     laborTaxExcluded,
    labor_tax:              laborTax,
    deduction_rate:         deductionRate,
    deduction:              deduction,
    expense_tax_excluded:   expenseTaxExcluded,
    expense_tax:            expenseTax,
    total_amount:           totalAmount,
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

  // 締め日は委託先ごとに異なるため、対象委託先の洗い出しは「前月1日〜当月末日」に広げる。
  // 実際の集計期間は generatePaymentNotice 側で各委託先の closing_day により再度絞り込まれる。
  const [yy, mm]  = yearMonth.split('-').map(Number)
  const fetchFrom = new Date(yy, mm - 2, 1)
  const fetchTo   = new Date(yy, mm, 0)

  const { data: workRows, error: wErr } = await supabase
    .from('work_records')
    .select('contractor_id')
    .eq('tenant_id', tenantId)
    .gte('work_date', fetchFrom.toISOString().slice(0, 10))
    .lte('work_date', fetchTo.toISOString().slice(0, 10))
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
