'use server'

import { createServiceClient } from '@/utils/supabase/service'
import type { Database } from '@/types/supabase'
import { getCurrentTenantId } from '@/utils/tenant'
import { requireOwner } from '@/utils/auth'
import { closingRange, formatLocalDate } from '@/utils/closing-period'
import { calcTransitionalDeduction } from '@/utils/transitional-deduction'
import { fiscalYearRange, fiscalYearLabel } from '@/utils/fiscal-year'
import { isQualifiedInvoiceIssuer } from '@/utils/invoice-registration'
// ⚠️ 支払通知書の金額算出は utils/payment-notice-calc.ts が正本。
//    この画面（生成）と _actions/billing-actions.ts（確定・ロック）の 2 経路が
//    別々に同じ計算を持っていて食い違っていたため、2026-08-02 に集約した。
//    ここに計算式を書き戻さないこと。
import {
  calcTax,
  buildTaxIncludedPurchases,
  calcPayeeAmount,
  computePaymentNoticeAmounts,
  type PayeeRule,
} from '@/utils/payment-notice-calc'
import { calcWorkAmount, type PriceRuleRecord, type RawWorkRecord } from '@/utils/work-amount'

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

// ── 税額計算・payee ルール・経過措置バケット ──────────────
// ⚠️ calcTax / buildTaxIncludedPurchases / WorkBucket / calcPayeeAmount 等は
//    utils/payment-notice-calc.ts へ移した（上部の import を参照）。
//    支払通知書の確定経路と共有するため、ここに再実装しないこと。

/** 源泉徴収税額（支払運賃の 10.21%、1円未満切り捨て） */
// ⚠️ 源泉は一覧集計だけで使う。支払通知書には載せていないため共通モジュールへは移していない。
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
      project_id,
      piece_count,
      start_time,
      end_time,
      break_minutes,
      projects (
        client_id,
        price_rules ( calculation_type, selling_price, buying_price, margin_fixed ),
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

    // ⚠️ 単価の素値を足すと calculation_type='piece' の案件で個数が抜けて桁が落ちる。
    //    金額は必ず calcWorkAmount を通す（正本 utils/work-amount.ts）。2026-08-02 修正
    const net = calcWorkAmount(
      row as unknown as RawWorkRecord,
      (row.projects?.price_rules?.[0] ?? undefined) as PriceRuleRecord | undefined,
      'selling',
    )

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
        start_time,
        end_time,
        break_minutes,
        projects ( price_rules ( calculation_type, selling_price, buying_price, margin_fixed ) ),
        contractors (
          id,
          name,
          tax_category,
          invoice_registration_type,
          invoice_number,
          has_withholding,
          closing_day,
          payment_site,
          is_internal
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

  // 自社区分（代表者・従業員）の実績は売上(IN)には載せるが支払(OUT)には載せない
  const rows = ((workResult.data ?? []) as unknown as WorkRecordForPayment[])
    .filter(r => !(r.contractors as any)?.is_internal)

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
      // ⚠️ payee ルール未設定案件のフォールバック。単価の素値ではなく calcWorkAmount を通す
      //    （piece 制で個数が抜けて ¥990 と表示されていた。2026-08-02 修正）
      net = calcWorkAmount(
        row as unknown as RawWorkRecord,
        ((row as any).projects?.price_rules?.[0] ?? undefined) as PriceRuleRecord | undefined,
        'buying',
      )
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
      isQualifiedInvoiceIssuer(a.invoiceType),
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

// ── 委託先ごとの年度累計 ──────────────────────────────────

export type ContractorFiscalTotal = {
  contractorId:  string
  /** 労務報酬（税込） */
  laborTotal:    number
  /** 立替金（税込） */
  expenseTotal:  number
  /** 合計（税込） */
  total:         number
}

export type FiscalTotalsResult = {
  /** 事業年度の表示名（例: '2026年4月〜2027年3月'） */
  fiscalYearLabel:    string
  /** 決算月が未設定で暦年にフォールバックしているか */
  usingCalendarYear:  boolean
  /**
   * 事業年度の途中からしか記録が無い場合、最も古い確定済み通知書の月（'YYYY-MM'）。
   * 年度まるごとを表していないことを画面に添えるために使う。null なら年度頭から記録がある
   */
  recordsStartFrom:   string | null
  totals:             ContractorFiscalTotal[]
}

/**
 * 委託先ごとに「この事業年度いくら払ったか」を返す。
 *
 * ⚠️ 数えるのは**確定済み（locked）の支払通知書だけ**。未確定の月は含まない。
 * ⚠️ 労務報酬と立替金を分けて返す。立替金を課税仕入れに含めるかは税理士確認待ちのため、
 *    どちらの結論でも画面を作り直さずに済むようにしてある。
 * ⚠️ これは表示用であって、経過措置の1億円上限の判定は行っていない。
 *    上限は「一の免税事業者等から」＝委託先1社ごとの判定であり、想定規模では届かないため
 *    実装していない（設計書 2026-08-02 を参照）。
 */
export async function fetchContractorFiscalTotals(
  yearMonth: string,
): Promise<ActionResult<FiscalTotalsResult>> {
  const auth = await requireOwner()
  if (!auth.ok) return { data: null, error: auth.error }
  const tenantId = await getCurrentTenantId()
  const supabase = createServiceClient()

  const { data: company } = await supabase
    .from('companies')
    .select('fiscal_year_end_month')
    .eq('tenant_id', tenantId)
    .maybeSingle()

  const endMonth = (company as { fiscal_year_end_month?: number | null } | null)?.fiscal_year_end_month ?? null
  const { from, to } = fiscalYearRange(yearMonth, endMonth)

  const { data, error } = await supabase
    .from('payment_notices')
    .select('contractor_id, notice_month, labor_tax_excluded, labor_tax, expense_tax_excluded, expense_tax')
    .eq('tenant_id', tenantId)
    .eq('locked', true)
    .gte('notice_month', from)
    .lte('notice_month', to)

  if (error) return { data: null, error: error.message }

  const map = new Map<string, ContractorFiscalTotal>()
  let earliest: string | null = null

  type FiscalNoticeRow = {
    contractor_id:        string | null
    notice_month:         string
    labor_tax_excluded:   number | null
    labor_tax:            number | null
    expense_tax_excluded: number | null
    expense_tax:          number | null
  }

  for (const row of (data ?? []) as unknown as FiscalNoticeRow[]) {
    const cid = row.contractor_id
    if (!cid) continue

    const month = String(row.notice_month).slice(0, 7)
    if (earliest === null || month < earliest) earliest = month

    const labor   = Number(row.labor_tax_excluded ?? 0) + Number(row.labor_tax ?? 0)
    const expense = Number(row.expense_tax_excluded ?? 0) + Number(row.expense_tax ?? 0)

    const cur = map.get(cid) ?? { contractorId: cid, laborTotal: 0, expenseTotal: 0, total: 0 }
    cur.laborTotal   += labor
    cur.expenseTotal += expense
    cur.total         = cur.laborTotal + cur.expenseTotal
    map.set(cid, cur)
  }

  // 年度の頭から記録があるかどうか。無ければ累計は年度まるごとを表していない
  const fiscalStartMonth = from.slice(0, 7)
  const recordsStartFrom = earliest !== null && earliest > fiscalStartMonth ? earliest : null

  return {
    data: {
      fiscalYearLabel:   fiscalYearLabel(yearMonth, endMonth),
      usingCalendarYear: endMonth == null,
      recordsStartFrom,
      totals: [...map.values()],
    },
    error: null,
  }
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
  const tenantId = await getCurrentTenantId()
  const supabase = createServiceClient()
  const { data, error } = await (supabase as any)
    .from('payment_notices')
    .select('id, contractor_id, approval_status, locked, total_excluding_tax, total_tax, total_deduction, adjustment_amount')
    .eq('tenant_id', tenantId)
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
  /** 親分が手で入れる調整額（±円）。未指定なら保存済みの値を引き継ぐ */
  manualAdjustment?: number,
): Promise<ActionResult<{ id: string; totalAmount: number }>> {
  const auth = await requireOwner()
  if (!auth.ok) return { data: null, error: auth.error }
  const tenantId = await getCurrentTenantId()
  const supabase = createServiceClient()
  const targetMonth = `${yearMonth}-01`

  // ⚠️ Server Action は画面を介さず直接呼べるため、検証をクライアント側に置かない。
  //    未検証だと 0.5 のような小数がそのまま numeric 列に入り金額に小数が乗るほか、
  //    大きな負値で「差引支給額がマイナスの支払通知書」を作れてしまう。
  const MAX_MANUAL_ADJUSTMENT = 1_000_000
  if (manualAdjustment !== undefined) {
    if (!Number.isInteger(manualAdjustment)) {
      return { data: null, error: '調整額は整数で指定してください。' }
    }
    if (Math.abs(manualAdjustment) > MAX_MANUAL_ADJUSTMENT) {
      return { data: null, error: `調整額は ±${MAX_MANUAL_ADJUSTMENT.toLocaleString()} 円以内で指定してください。` }
    }
  }

  // ── 金額算出は共通モジュールへ集約（utils/payment-notice-calc.ts） ──
  // ⚠️ 同じ計算が _actions/billing-actions.ts の finalizePaymentNotice にも重複しており、
  //    そちらが劣化コピーになっていた（2026-08-02 に一本化）。
  //    ここに計算式を書き戻すと、また 2 経路で金額が食い違う。
  const { data: a, error: calcErr } = await computePaymentNoticeAmounts(
    supabase,
    { tenantId, contractorId, yearMonth, manualAdjustment },
  )
  if (calcErr || !a) return { data: null, error: calcErr ?? '支払通知書の金額算出に失敗しました' }

  // ⚠️ 差引支給額がマイナスの通知書は作らせない。調整額の符号ミスをここで止める。
  if (a.totalAmount < 0) {
    return {
      data: null,
      error: `差引支給額がマイナス（${a.totalAmount.toLocaleString()}円）になります。調整額を見直してください。`,
    }
  }

  const db = supabase as any

  // 既存レコードを確認して INSERT or UPDATE
  const { data: existing } = await db
    .from('payment_notices')
    .select('id, status, approval_status, locked')
    // ⚠️ 一意制約は (contractor_id, notice_month) で tenant_id を含まない。
    //    service クライアントは RLS を通らないため tenant_id で必ず絞る。
    .eq('tenant_id', tenantId)
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
    subtotal_registered:    a.subtotalRegistered,
    tax_registered:         a.taxRegistered,
    subtotal_unregistered:  a.subtotalUnregistered,
    tax_unregistered:       a.taxUnregistered,
    deduction_unregistered: a.deductionUnregistered,
    subtotal_exempt:        a.subtotalExempt,
    total_excluding_tax:    a.totalExcludingTax,
    total_tax:              a.totalTax,
    total_deduction:        a.totalDeduction,
    insurance_deduction:    a.insuranceDeduction,
    // ⚠️ adjustment_amount には「実際に適用した調整（自動端数補正＋手入力）」を入れる。
    //    PDF・一覧・total_amount はこの列だけを見る。手動分の内訳は manual_adjustment。
    adjustment_amount:      a.adjustment,
    manual_adjustment:      a.manualAdjustment,
    approval_status:        'pending',
    // ⚠️ 2026-08-02 追加。この経路は内訳列と total_amount を一切書いておらず、
    //    生成された支払通知書は DB 上 total_amount=0・内訳すべて 0 のままだった
    //    （一覧画面は total_excluding_tax + total_tax - total_deduction + adjustment で
    //     その場で計算し直しており、列の欠落が表面化していなかった）。
    //    PDF は deduction_rate を印字し、年度累計は labor_*/expense_* を積むため、実値を保存する。
    labor_tax_excluded:     a.laborTaxExcluded,
    labor_tax:              a.laborTax,
    deduction_rate:         a.deductionRate,
    deduction:              a.deduction,
    expense_tax_excluded:   a.expenseTaxExcluded,
    expense_tax:            a.expenseTax,
    total_amount:           a.totalAmount,
  }

  let noticeId: string
  if (existing?.id) {
    const { data: updated, error: uErr } = await db
      .from('payment_notices')
      .update(noticePayload)
      .eq('id', existing.id)
      .eq('tenant_id', tenantId)
      .select('id')
      .single()
    if (uErr) return { data: null, error: uErr.message }
    noticeId = updated.id
  } else {
    const { data: inserted, error: iErr } = await db
      .from('payment_notices')
      // ⚠️ F0で tenant_id の DEFAULT を撤去したため、明示的に渡さないと NOT NULL 違反になる
      .insert({ tenant_id: tenantId, contractor_id: contractorId, notice_month: targetMonth, ...noticePayload })
      .select('id')
      .single()
    if (iErr) return { data: null, error: iErr.message }
    noticeId = inserted.id
  }

  return { data: { id: noticeId, totalAmount: a.totalAmount }, error: null }
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

  const candidateIds = [...new Set((workRows ?? []).map((r: any) => r.contractor_id as string))]

  // 自社区分（is_internal）の委託先は通知書を作らない。generatePaymentNotice 側でも弾くが、
  // ここで除外しないと errors に毎月「対象外」が積まれて一括生成が失敗扱いに見えるため先に落とす。
  const { data: extRows, error: cErr } = await supabase
    .from('contractors')
    .select('id')
    .eq('tenant_id', tenantId)
    .eq('is_internal', false)
    .in('id', candidateIds.length ? candidateIds : ['00000000-0000-0000-0000-000000000000'])
  if (cErr) return { data: null, error: cErr.message }
  const ids = (extRows ?? []).map((r: any) => r.id as string)

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
