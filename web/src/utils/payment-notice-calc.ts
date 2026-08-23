// ── 支払通知書の金額算出の唯一の正本 ──────────────────────────────
//
// ⚠️ この計算は以前 2 箇所に重複していた（2026-08-02 に集約）:
//      - app/admin/billing/actions.ts  generatePaymentNotice（管理画面からの生成）
//      - app/_actions/billing-actions.ts finalizePaymentNotice（確定・ロック）
//    後者は前者の劣化コピーで、①稼働金額が buying_price の単純合算（個数も
//    calculation_type も無視）②payee ルール・調整金・再委託を見ない ③経過措置の率を
//    月単位で判定 ④内訳列を DB に書かない、という 4 つの食い違いを抱えていた。
//    同じ委託先・同じ月でも経路によって金額が変わる状態だったため、ここへ寄せた。
//
// ⚠️ このファイルに 'use server' を付けてはならない。
//    'use server' ファイルは非 async の export（型・純粋関数）を持てず、
//    付けると実行時エラーになる。ここは型と純粋関数を export している。

import type { SupabaseClient } from '@supabase/supabase-js'
import { closingRange, parseLocalDate } from '@/utils/closing-period'
import {
  calcTransitionalDeduction,
  getDeductionRate,
  type TransitionalPurchase,
} from '@/utils/transitional-deduction'
import { isQualifiedInvoiceIssuer, normalizeInvoiceRegistration } from '@/utils/invoice-registration'
import { getTransportInsuranceAmount } from '@/utils/company'
import { decideInsuranceDeduction } from '@/utils/transport-insurance'
import { assemblePaymentTotals } from '@/utils/payment-notice-totals'
import {
  calcWorkAmount,
  buildPriceRuleMap,
  WORK_RECORD_AMOUNT_COLUMNS,
  PRICE_RULE_COLUMNS,
  type PriceRuleRecord,
  type RawWorkRecord,
} from '@/utils/work-amount'

// ── 税額計算 ──────────────────────────────────────────────

export function calcTax(amount: number, taxType: string): number {
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
export function buildTaxIncludedPurchases(
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

export type WorkBucket = {
  count: number
  pieceCount: number
  /**
   * payee ルールが無い案件で使う税抜労務報酬の合計。
   * ⚠️ 単価の素値ではなく calcWorkAmount（piece/hourly/fixed/hybrid を解釈した額）の合計。
   *    2026-08-02 まで buying_price を稼働 1 件につき 1 回足すだけで、個数も
   *    calculation_type も無視していた（piece 制の委託先で桁が丸ごと落ちていた）。
   */
  buyingAmountSum: number
  sampleDate: string
}

export function bucketsOf<K>(m: Map<K, Map<number, WorkBucket>>, key: K): Map<number, WorkBucket> {
  const existing = m.get(key)
  if (existing) return existing
  const created = new Map<number, WorkBucket>()
  m.set(key, created)
  return created
}

export function addToBucket(
  buckets: Map<number, WorkBucket>,
  workDate: string,
  add: { count: number; pieceCount: number; buyingAmountSum: number },
): void {
  // 登録状況に関わらず率で分ける。適格なら最終的に差し引き 0 になるだけ
  const rate = getDeductionRate(parseLocalDate(workDate))
  const cur  = buckets.get(rate)
  if (cur) {
    cur.count           += add.count
    cur.pieceCount      += add.pieceCount
    cur.buyingAmountSum += add.buyingAmountSum
  } else {
    buckets.set(rate, { ...add, sampleDate: workDate })
  }
}

// ── 端数処理 ──────────────────────────────────────────────

export function applyRounding(value: number, rule: string): number {
  if (rule === 'floor') return Math.floor(value)
  if (rule === 'ceil')  return Math.ceil(value)
  return Math.round(value)  // 'round' = 四捨五入（デフォルト）
}

// ── project_payees ルール型 ──────────────────────────────

export type PayeeRule = {
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
export function calcPayeeAmount(rule: PayeeRule, workCount: number): { net: number; adjustment: number } {
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

// ── 支払通知書の金額一式 ──────────────────────────────────

export type PaymentNoticeAmounts = {
  laborTaxExcluded: number; laborTax: number
  expenseTaxExcluded: number; expenseTax: number
  /** 経過措置による差し引き額 */
  deduction: number
  /**
   * 保存用の率（payment_notices.deduction_rate）。小数（例 0.02）。
   * ⚠️ 率が混在する締め期間は「単一の正しい％」が存在しない。差し引き額と辻褄が合うよう
   *    実効率（差し引き額 ÷ 税込合計）を返す。率が 1 つの通常月はその率と一致する。
   */
  deductionRate: number
  /** 実際に適用した調整＝自動端数補正 + 手入力。payment_notices.adjustment_amount に入る */
  adjustment: number
  /** 手入力の調整額（±）だけを取り出したもの。監査・再編集用 */
  manualAdjustment: number
  /** 運送保険の相殺額（委託先負担・非課税）。totalDeduction に含まれる */
  insuranceDeduction: number
  subtotalRegistered: number; taxRegistered: number
  subtotalUnregistered: number; taxUnregistered: number
  deductionUnregistered: number; subtotalExempt: number
  totalExcludingTax: number; totalTax: number; totalDeduction: number
  totalAmount: number
  /** 実際に集計した締め期間（'YYYY-MM-DD'）。呼び出し側の表示・検証用 */
  period: { from: string; to: string }
}

type CalcResult =
  | { data: PaymentNoticeAmounts; error: null }
  | { data: null; error: string }

/**
 * 委託先1件分の支払通知書金額を算出する。DBは読むだけで、書き込みは一切しない。
 *
 * ⚠️ 対象期間は「対象月の1日〜末日」ではなく**委託先ごとの締め期間**（closingRange）。
 *    委託先マスタの closing_day が効く。呼び出し側で月初〜月末を作り直さないこと。
 */
export async function computePaymentNoticeAmounts(
  db: SupabaseClient,
  params: {
    tenantId: string
    contractorId: string
    yearMonth: string
    /**
     * 親分が手で入れる調整額（±円）。省略時は保存済みの手動調整を引き継ぐ。
     * ⚠️ 自動端数補正（calcPayeeAmount）とは別枠。合算した実適用額が adjustment になる。
     */
    manualAdjustment?: number
  },
): Promise<CalcResult> {
  const { tenantId, contractorId, yearMonth } = params
  // ⚠️ 生成 SDK の型は列の増減に追従していないため、既存コードに合わせて any 経由で叩く
  const supabase = db as any

  // 委託先マスタ
  const { data: c, error: cErr } = await supabase
    .from('contractors')
    .select('tax_category, invoice_registration_type, has_withholding, closing_day, is_internal, apply_transport_insurance')
    .eq('id', contractorId)
    .eq('tenant_id', tenantId)
    .single()
  if (cErr || !c) return { data: null, error: cErr?.message ?? '委託先が見つかりません' }
  const contractor = c as any
  // 自社区分（代表者・従業員）は外注費ではないため支払通知書を作らない（fail-closed）。
  // 経過措置・源泉の計算もここを通るので、この1箇所で OUT 側から除外される。
  if (contractor.is_internal) return { data: null, error: '自社区分（代表者・従業員）の委託先は支払通知書の対象外です' }

  // 締め日は委託先ごとに異なる（fetchPaymentByContractor と同じ closingRange ロジック）
  // ⚠️ 従来 toISOString() を挟んでおり JST の開発機で 1 日ずれていた。共通モジュールは
  //    はじめからローカル日付の 'YYYY-MM-DD' を返すため、そのまま使う。
  const { from: fromStr, to: toStr } = closingRange(yearMonth, String(contractor.closing_day ?? '月末'))

  // project_payees ルール（この委託先の全案件設定）
  const { data: payeeRulesData, error: prErr } = await supabase
    .from('project_payees')
    .select('project_id, contractor_id, payment_type, unit_price, tax_method, rounding_rule, adjustment_enabled, work_source_contractor_id')
    .eq('contractor_id', contractorId)
    .eq('tenant_id', tenantId)
  if (prErr) return { data: null, error: prErr.message }

  const payeeRules = (payeeRulesData ?? []) as PayeeRule[]

  // 自身の稼働記録（案件別・経過措置の率別に集計）
  // ⚠️ work_date を取るのは、経過措置の率が稼働日ごとに決まるため（消基通 11-3-1）。
  //    締め期間が 2026年10月1日をまたぐと、1 枚の通知書に 2% 分と 3% 分が混在する。
  // ⚠️ 金額列は work_records に存在しない。列名をここに増やす前に utils/work-amount.ts を読むこと。
  const { data: workData, error: wErr } = await supabase
    .from('work_records')
    .select(`${WORK_RECORD_AMOUNT_COLUMNS}, work_date`)
    .eq('contractor_id', contractorId)
    .eq('tenant_id', tenantId)
    .gte('work_date', fromStr)
    .lte('work_date', toStr)
  if (wErr) return { data: null, error: wErr.message }

  const workRows = (workData ?? []) as unknown as (RawWorkRecord & { work_date: string })[]

  // 単価ルールは別クエリで引く。
  // ⚠️ price_rules には tenant_id 列が無い。上のクエリで tenant を確認済みの
  //    project_id だけを .in() に渡すこと（テナントをまたいで単価を拾わないため）。
  const projectIds = [...new Set(workRows.map(r => r.project_id).filter((id): id is string => !!id))]
  let ruleMap = new Map<string, PriceRuleRecord>()
  if (projectIds.length > 0) {
    const { data: rules, error: ruleErr } = await supabase
      .from('price_rules')
      .select(PRICE_RULE_COLUMNS)
      .in('project_id', projectIds)
    if (ruleErr) return { data: null, error: ruleErr.message }
    ruleMap = buildPriceRuleMap(rules as unknown as PriceRuleRecord[])
  }

  // 案件別・率別集計: projectId → rate → WorkBucket
  const projectAgg = new Map<string, Map<number, WorkBucket>>()
  for (const w of workRows) {
    const pid = w.project_id
    if (!pid) continue
    // ⚠️ ここは buying_price の素値ではなく calcWorkAmount を通す。
    //    calculation_type='piece' の委託先で個数を掛け忘れると桁が落ちる（2026-08-02 修正）。
    const amount = calcWorkAmount(w, ruleMap.get(pid), 'buying')
    const pieces = Number(w.piece_count ?? 1)
    addToBucket(bucketsOf(projectAgg, pid), String(w.work_date), {
      count: 1,
      pieceCount: pieces,
      buyingAmountSum: amount,
    })
  }

  // 再委託ケース: work_source_contractor_id が指定されている案件の稼働件数を別途取得
  // ⚠️ この経路は件数・個数しか使わない（金額は payee ルールの unit_price で決まる）ため
  //    buyingAmountSum は 0 のままでよい。
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
  for (const [sourceId, sourceProjectIds] of sourceContractorProjects) {
    // ⚠️ エラーを握り潰すと再委託分の稼働がゼロ扱いになり、支払額が黙って過少になる
    const { data: srcData, error: srcErr } = await supabase
      .from('work_records')
      .select('project_id, work_date, piece_count')
      .eq('contractor_id', sourceId)
      .eq('tenant_id', tenantId)
      .gte('work_date', fromStr)
      .lte('work_date', toStr)
      .in('project_id', Array.from(sourceProjectIds))
    if (srcErr) return { data: null, error: srcErr.message }
    const counts = new Map<string, Map<number, WorkBucket>>()
    for (const w of (srcData ?? []) as any[]) {
      const pid    = w.project_id as string
      const pieces = Number(w.piece_count ?? 1)
      addToBucket(bucketsOf(counts, pid), String(w.work_date), { count: 1, pieceCount: pieces, buyingAmountSum: 0 })
    }
    sourceWorkCounts.set(sourceId, counts)
  }

  // 案件ごとに支払金額・調整金を算出
  // per_unit: unit_price × work_record件数
  // per_piece: unit_price × piece_count合計
  // ルールなし: price_rules から calcWorkAmount した額の合算
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

  // payee ルール未設定案件: price_rules 由来の金額を合算
  for (const [pid, buckets] of projectAgg) {
    if (coveredProjects.has(pid)) continue
    for (const bucket of buckets.values()) {
      laborTaxExcluded += bucket.buyingAmountSum
      addNet(bucket.sampleDate, bucket.buyingAmountSum)
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
  // ⚠️ 率の正本は utils/transitional-deduction.ts。ここに率表をベタ書きしないこと
  //    （以前 5 箇所に複製があり、5 本とも古かった）。
  // ⚠️ '適格' 直書き判定も禁止。`registered` の委託先を未登録扱いにして控除していた。
  const isRegisteredContractor = isQualifiedInvoiceIssuer(contractor.invoice_registration_type)
  const deductionResult = calcTransitionalDeduction(
    buildTaxIncludedPurchases(netByDate, contractor.tax_category),
    isRegisteredContractor,
  )
  const deduction = deductionResult.deduction
  const deductionBase = deductionResult.breakdown.reduce((s, b) => s + b.taxIncludedAmount, 0)
  const deductionRate = deductionBase > 0 ? deduction / deductionBase : 0

  // invoice_registration_type 別に集計列へ振り分け
  const registrationStatus = normalizeInvoiceRegistration(contractor.invoice_registration_type)
  const isRegistered = registrationStatus === 'registered'
  const isExempt     = registrationStatus === 'exempt'

  const subtotalRegistered    = isRegistered ? laborTaxExcluded : 0
  const taxRegistered         = isRegistered ? laborTax : 0
  const subtotalUnregistered  = (!isRegistered && !isExempt) ? laborTaxExcluded : 0
  const taxUnregistered       = isRegistered ? 0 : laborTax
  const deductionUnregistered = deduction
  const subtotalExempt        = isExempt ? laborTaxExcluded : 0

  // 手入力の調整額。明示的に渡されていなければ保存済みの値を引き継ぐ。
  // ⚠️ 引き継がないと、一覧のライブ計算（手入力を渡さない経路）が手動調整を毎回 0 に
  //    見せてしまい、生成済みの通知書と金額が食い違う。
  let manualAdjustment = params.manualAdjustment
  if (manualAdjustment === undefined) {
    const { data: saved, error: savedErr } = await supabase
      .from('payment_notices')
      .select('manual_adjustment')
      .eq('contractor_id', contractorId)
      .eq('tenant_id', tenantId)
      .eq('notice_month', `${yearMonth}-01`)
      .maybeSingle()
    // ⚠️ fail-closed。読めないまま 0 で進めると支払額が黙って変わる
    if (savedErr) return { data: null, error: savedErr.message }
    manualAdjustment = Number(saved?.manual_adjustment ?? 0)
  }

  // 運送保険（委託先負担・非課税）。相殺額合計にだけ積む。
  // ⚠️ fail-closed。取得できなければ止める（相殺し忘れた通知書を出さないため）
  const insuranceRes = await getTransportInsuranceAmount(tenantId)
  if (insuranceRes.error !== null) return { data: null, error: insuranceRes.error }
  // 稼働も立替も無い月は保険だけを相殺してマイナス支給にしない。
  // 委託先ごとの適用有無（作業系は無し）は contractors.apply_transport_insurance。
  // ⚠️ 列が読めていない（undefined）場合は fail-closed で止める。黙って 0 にしない。
  if (typeof contractor.apply_transport_insurance !== 'boolean') {
    return { data: null, error: '委託先の運送保険設定（apply_transport_insurance）が読めません' }
  }
  const hasActivity = laborTaxExcluded > 0 || expenseTaxExcluded > 0
  const insuranceDeduction = decideInsuranceDeduction({
    hasActivity, applies: contractor.apply_transport_insurance, amount: insuranceRes.amount,
  })

  // 差引支給額の組み立ては utils/payment-notice-totals.ts が正本。ここで式を再現しないこと
  const { totalExcludingTax, totalTax, totalDeduction, totalAmount } = assemblePaymentTotals({
    laborTaxExcluded,
    laborTax,
    expenseTaxExcluded,
    expenseTax,
    deduction,
    adjustment: totalAdjustment + manualAdjustment,
    insuranceDeduction,
  })

  return {
    data: {
      laborTaxExcluded,
      laborTax,
      expenseTaxExcluded,
      expenseTax,
      deduction,
      deductionRate,
      adjustment: totalAdjustment + manualAdjustment,
      manualAdjustment,
      insuranceDeduction,
      subtotalRegistered,
      taxRegistered,
      subtotalUnregistered,
      taxUnregistered,
      deductionUnregistered,
      subtotalExempt,
      totalExcludingTax,
      totalTax,
      totalDeduction,
      totalAmount,
      period: { from: fromStr, to: toStr },
    },
    error: null,
  }
}
