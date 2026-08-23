'use server'

import { createServiceClient } from '@/utils/supabase/service'
import { requireOwner, requireAuth } from '@/utils/auth'
import { getCurrentTenantId } from '@/utils/tenant'
import { getCompanyInfo, type CompanyInfo } from '@/utils/company'
import {
  calcWorkAmount,
  buildPriceRuleMap,
  WORK_RECORD_AMOUNT_COLUMNS,
  PRICE_RULE_COLUMNS,
  type PriceRuleRecord,
  type RawWorkRecord,
} from '@/utils/work-amount'
import { closingRange, computeDueDate } from '@/utils/closing-period'
import { isQualifiedInvoiceIssuer } from '@/utils/invoice-registration'
import { getDeductionRate } from '@/utils/transitional-deduction'
import { computePaymentNoticeAmounts } from '@/utils/payment-notice-calc'

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
  /** 発行元（自社）情報。DBの自社マスタから取得する */
  company:       CompanyInfo
}

export async function fetchInvoicePdfData(
  clientId:  string,
  yearMonth: string,
): Promise<ActionResult<InvoicePdfData>> {
  const auth = await requireOwner()
  if (!auth.ok) return { data: null, error: auth.error }
  const tenantId = await getCurrentTenantId()

  const service = createServiceClient()

  const [clientRes, invoiceRes, projectsRes] = await Promise.all([
    service.from('clients')
      .select('company_name, contact_name, tax_type, tenant_id, closing_day, payment_site')
      .eq('id', clientId).single(),
    // billing-actions.ts は YYYY-MM-01 形式で保存するため DATE 型に合わせる
    service.from('invoices')
      .select('id, total_tax_excluded, consumption_tax, total_amount, due_date')
      .eq('client_id', clientId)
      .eq('invoice_month', `${yearMonth}-01`)
      .maybeSingle(),
    service.from('projects').select('id, project_name').eq('client_id', clientId),
  ])

  if (clientRes.error || !clientRes.data || clientRes.data.tenant_id !== tenantId) {
    return { data: null, error: '荷主が見つかりません' }
  }

  const client   = clientRes.data
  const invoice  = invoiceRes.data
  const projects = projectsRes.data ?? []
  const projMap  = new Map(projects.map(p => [p.id, p.project_name]))
  const projIds  = projects.map(p => p.id)

  // ⚠️ 2026-08-02 まで存在しない列 `quantity` / `tax_excluded_sales` を select しており、
  //    PostgREST が 42703 を返して請求書PDFが「データ取得エラー」で出せなかった。
  //    数量は piece_count、金額は price_rules から都度計算する。詳細は utils/work-amount.ts。
  // ⚠️ 2026-08-02 まで暦月（1日〜末日）で集計しており、締め日ベースで集計する
  //    請求書確定（finalizeInvoice）と明細が食い違っていた。締め日ベースに統一。
  const { from, to } = closingRange(yearMonth, client.closing_day)

  const { data: workRows, error: wrErr } = await service
    .from('work_records')
    .select(`${WORK_RECORD_AMOUNT_COLUMNS}, work_date`)
    .in('project_id', projIds.length > 0 ? projIds : ['__never__'])
    .gte('work_date', from)
    .lte('work_date', to)
    .order('work_date')

  if (wrErr) return { data: null, error: wrErr.message }

  const rawRows = (workRows ?? []) as unknown as (RawWorkRecord & { work_date: string })[]

  // price_rules には tenant_id が無いため、テナント確認済みの案件IDだけを引く
  let ruleMap = new Map<string, PriceRuleRecord>()
  if (projIds.length > 0) {
    const { data: rules, error: ruleErr } = await service
      .from('price_rules')
      .select(PRICE_RULE_COLUMNS)
      .in('project_id', projIds)
    if (ruleErr) return { data: null, error: ruleErr.message }
    ruleMap = buildPriceRuleMap(rules as unknown as PriceRuleRecord[])
  }

  const lines: InvoicePdfLine[] = rawRows.map(r => ({
    workDate:    r.work_date,
    projectName: r.project_id ? (projMap.get(r.project_id) ?? '（案件なし）') : '（案件なし）',
    quantity:    r.piece_count ?? 0,
    netAmount:   calcWorkAmount(r, r.project_id ? ruleMap.get(r.project_id) : undefined, 'selling'),
  }))

  // 確定済み invoice があればその値を優先（taxCalculator.ts との一致を保証）
  const netTotal    = invoice?.total_tax_excluded ?? lines.reduce((s, l) => s + l.netAmount, 0)
  const taxAmount   = invoice?.consumption_tax    ?? Math.round(netTotal * (client.tax_type !== 'exempt' ? 0.1 : 0))
  const totalAmount = invoice?.total_amount       ?? (netTotal + taxAmount)
  // 確定済み請求書に支払期日があればそれを使う。無ければ締め日＋支払サイトで算出する
  const dueDate     = invoice?.due_date           ?? computeDueDate(yearMonth, client.closing_day, client.payment_site)

  // 請求書番号: 発行控え（issued_documents）があればその番号。
  // 無ければ従来の暫定番号 INV-YYYYMM-{id先頭5文字} に「(未発行)」を付けて区別する。
  // ⚠️ 正式な番号は document-actions.ts の確定発行で採番される。ここでは採番しない。
  const suffix        = invoice?.id ? invoice.id.replace(/-/g, '').slice(0, 5).toUpperCase() : 'XXXXX'
  let   invoiceNumber = `INV-${yearMonth.replace('-', '')}-${suffix} (未発行)`
  if (invoice?.id) {
    const { data: issuedDoc } = await service
      .from('issued_documents')
      .select('document_number')
      .eq('tenant_id', tenantId).eq('kind', 'invoice').eq('source_id', invoice.id).eq('status', 'issued')
      .maybeSingle()
    if (issuedDoc?.document_number) invoiceNumber = issuedDoc.document_number
  }

  // ⚠️ fail-closed: 自社情報が未登録ならPDFを生成せずエラーを返す。
  //    仮の登録番号を印字した請求書が社外に出るのを防ぐ。
  const companyRes = await getCompanyInfo(tenantId)
  if (!companyRes.data) return { data: null, error: companyRes.error }

  return {
    data: {
      company: companyRes.data,
      invoiceNumber,
      issueDate:    new Date().toISOString().slice(0, 10),
      dueDate,
      clientName:   client.company_name,
      contactName:  client.contact_name,
      invoiceMonth: `${Number(yearMonth.slice(0, 4))}年${Number(yearMonth.slice(5, 7))}月分`,
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
  /** 運送保険の相殺額（非課税）。0 なら印字しない */
  insuranceDeduction:   number
  /** 税込思考業者の端数補正。0 なら印字しない */
  adjustment:           number
  totalAmount:          number
  /** 発行元（自社）情報。振込先は支払通知書には印字しない */
  company:              CompanyInfo
}

export async function fetchPaymentNoticePdfData(
  contractorId: string,
  yearMonth:    string,
): Promise<ActionResult<PaymentNoticePdfData>> {
  const auth = await requireAuth()
  if (!auth.ok) return { data: null, error: auth.error }

  const service = createServiceClient()

  if (auth.ctx.isOwner) {
    const tenantId = await getCurrentTenantId()
    const { data: contractorCheck } = await service
      .from('contractors').select('tenant_id').eq('id', contractorId).maybeSingle()
    if (!contractorCheck || (contractorCheck as any).tenant_id !== tenantId) {
      return { data: null, error: '委託先が見つかりません' }
    }
  } else if (auth.ctx.contractorId !== contractorId) {
    return { data: null, error: '委託先が見つかりません' }
  }

  const [y, m] = yearMonth.split('-').map(Number)
  const from   = `${yearMonth}-01`
  const to     = new Date(y, m, 0).toISOString().slice(0, 10)

  const [contractorRes, noticeRes, workRes, expenseRes, projectsRes] = await Promise.all([
    // tenant_id は自社情報の取得に使う（ドライバー閲覧時は上の isOwner ブロックを通らないため、
    // 委託先レコード自身からテナントを引く）
    (service as any).from('contractors').select('name, invoice_registration_type, tenant_id, is_internal').eq('id', contractorId).single(),
    (service as any).from('payment_notices')
      .select('subtotal_registered, tax_registered, subtotal_unregistered, tax_unregistered, deduction_unregistered, subtotal_exempt, total_excluding_tax, total_tax, total_deduction, insurance_deduction, adjustment_amount')
      .eq('contractor_id', contractorId)
      .eq('notice_month', from)
      .maybeSingle(),
    // ⚠️ 存在しない列 `quantity` / `tax_excluded_payment` を select していたため、
    //    PostgREST が 42703 を返して支払通知書PDFが出せなかった（2026-08-02 修正）。
    //    数量は piece_count、金額は price_rules から都度計算する。詳細は utils/work-amount.ts。
    service.from('work_records')
      .select(`${WORK_RECORD_AMOUNT_COLUMNS}, work_date`)
      .eq('contractor_id', contractorId)
      .gte('work_date', from).lte('work_date', to)
      .order('work_date'),
    // ⚠️ 承認済みだけを載せる。小計は payment_notices の保存値（承認済みのみ集計）を使うため、
    //    ここで未承認まで明細に出すと「明細に行があるのに小計 0」という文書になる（2026-08-02 修正）。
    service.from('expense_records')
      .select('expense_date, expense_type, amount_tax_excluded, tax_category')
      .eq('contractor_id', contractorId)
      .eq('approval_status', 'approved')
      .gte('expense_date', from).lte('expense_date', to)
      .order('expense_date'),
    service.from('projects').select('id, project_name'),
  ])

  if (contractorRes.error || !contractorRes.data) return { data: null, error: '委託先が見つかりません' }

  const contractor = contractorRes.data
  // 自社区分（代表者・従業員）には支払通知書が存在しないため PDF も出さない
  if ((contractor as any).is_internal) return { data: null, error: '自社区分（代表者・従業員）の委託先は支払通知書の対象外です' }
  const notice     = noticeRes.data
  const projMap    = new Map((projectsRes.data ?? []).map(p => [p.id, p.project_name]))

  const laborRows = (workRes.data ?? []) as unknown as (RawWorkRecord & { work_date: string })[]

  // price_rules には tenant_id が無いため、実際に出てきた案件IDだけを引く
  // （work_records は contractor_id で絞ってあり、その委託先のテナントは上で確認済み）
  const laborProjIds = Array.from(
    new Set(laborRows.map(r => r.project_id).filter((id): id is string => !!id)),
  )
  let payRuleMap = new Map<string, PriceRuleRecord>()
  if (laborProjIds.length > 0) {
    const { data: rules, error: ruleErr } = await service
      .from('price_rules')
      .select(PRICE_RULE_COLUMNS)
      .in('project_id', laborProjIds)
    if (ruleErr) return { data: null, error: ruleErr.message }
    payRuleMap = buildPriceRuleMap(rules as unknown as PriceRuleRecord[])
  }

  const laborLines: LaborPdfLine[] = laborRows.map(r => ({
    workDate:    r.work_date,
    projectName: r.project_id ? (projMap.get(r.project_id) ?? '（案件なし）') : '（案件なし）',
    quantity:    r.piece_count ?? 0,
    // 支払通知書は「買値」side。請求書（selling）と取り違えないこと
    netAmount:   calcWorkAmount(r, r.project_id ? payRuleMap.get(r.project_id) : undefined, 'buying'),
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
  let totalEx     = n ? Number(n.total_excluding_tax ?? 0) : laborNet + expenseLines.reduce((s, l) => s + l.netAmount, 0)
  let totalTax    = n ? Number(n.total_tax ?? 0) : laborTax
  // ⚠️ total_deduction は相殺額合計（経過措置＋運送保険）。経過措置だけを取り出して表示する。
  //    ここを分けずに全額を「経過措置控除（税込額の2%）」と印字すると、金額と率が合わない
  //    通知書を委託先に渡すことになる。
  const extra = n as { insurance_deduction?: number | null; adjustment_amount?: number | null } | null
  // ⚠️ 通知書が未生成の月は、以前ここで相殺を一律 0 にしていた。その結果、画面の一覧は
  //    「運送保険 ▲1,000 / 経過措置 ▲x」を出しているのに、同じ行の「プレビュー・出力」から
  //    出る PDF は満額を印字する、という食い違いが起きていた（委託先に渡す紙が狂う）。
  //    未生成のときは金額の正本（computePaymentNoticeAmounts）にライブ計算させる。
  let insuranceDeduction = Number(extra?.insurance_deduction ?? 0)
  let totalDeduction     = n ? Number(n.total_deduction ?? 0) : 0
  let adjustment         = Number(extra?.adjustment_amount ?? 0)
  if (!n) {
    const live = await computePaymentNoticeAmounts(service, {
      tenantId:     (contractor as { tenant_id?: string }).tenant_id ?? '',
      contractorId,
      yearMonth,
    })
    // ⚠️ fail-closed。計算できないまま満額の通知書を出さない
    if (live.error || !live.data) {
      return { data: null, error: live.error ?? '支払通知書の金額算出に失敗しました' }
    }
    // 相殺だけ正本から取って合計は自前計算、では辻褄が合わない。合計もまとめて置き換える
    totalEx            = live.data.totalExcludingTax
    totalTax           = live.data.totalTax
    insuranceDeduction = live.data.insuranceDeduction
    totalDeduction     = live.data.totalDeduction
    adjustment         = live.data.adjustment
  }
  // ⚠️ 立替の内訳は合計の確定後に出す。上の !n ブロックで totalEx / totalTax を
  //    正本の値へ差し替えるため、先に計算すると差し替え前の値が残る。
  const expenseNet = Math.max(0, totalEx - laborNet)
  const expenseTax = Math.max(0, totalTax - laborTax)
  const deduction  = Math.max(0, totalDeduction - insuranceDeduction)
  // ⚠️ 以前は `deduction / laborTax` を率としていたため「20%」と表示され、画面の
  //    「現在フェーズ 2%」と食い違っていた（消費税額に対する割合を出していたのが原因）。
  // ⚠️ `payment_notices.deduction_rate` は**単位が混在**していて使えない。
  //    実データに `2.0000`（パーセント）と `0.0200`（小数）が両方入っている（書き込み経路が
  //    複数あった名残）。そのまま率として使うと 200% と表示される。
  //    表示は制度上の率が唯一確かなので、正本から対象月の率を引く。
  // ⚠️ 締め期間が率の切り替わり（2026-10-01 など）をまたぐ月は単一の率が存在しない。
  //    その場合ここは期間末の率を表示する（金額は保存済みの差し引き額が正）。
  const deductionRate = getDeductionRate(
    new Date(y, m, 0),
    isQualifiedInvoiceIssuer(contractor.invoice_registration_type),
  )
  const totalAmount = totalEx + totalTax - totalDeduction + adjustment

  // ⚠️ fail-closed: 自社情報が未登録なら支払通知書も発行しない（請求書と同じ方針）
  const companyRes = await getCompanyInfo((contractor as any).tenant_id ?? '')
  if (!companyRes.data) return { data: null, error: companyRes.error }

  return {
    data: {
      company:             companyRes.data,
      contractorName:      contractor.name,
      invoiceRegistration: isQualifiedInvoiceIssuer(contractor.invoice_registration_type) ? 'registered' : 'unregistered',
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
      insuranceDeduction,
      adjustment,
      totalAmount,
    },
    error: null,
  }
}
