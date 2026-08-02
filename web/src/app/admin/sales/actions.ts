'use server'

import { createServiceClient } from '@/utils/supabase/service'
import type { Database } from '@/types/supabase'
import { calcInvoiceTax } from '@/lib/invoice'
import { getCurrentTenantId } from '@/utils/tenant'
import { requireOwner } from '@/utils/auth'
import { writeInvoice } from '@/utils/invoice-writer'
import { invoiceLockError } from '@/utils/invoice-lock'
import {
  calcWorkAmount,
  type PriceRuleRecord,
  type RawWorkRecord,
} from '@/utils/work-amount'
import { closingRange, computeDueDate, isWithinRange, formatLocalDate } from '@/utils/closing-period'
import { isQualifiedInvoiceIssuer } from '@/utils/invoice-registration'

type ClientRow = Database['public']['Tables']['clients']['Row']

/** "YYYY-MM" → "YYYY-MM-01"（DATE型カラムへのクエリ用） */
function toDbMonth(yearMonth: string): string {
  return yearMonth.length === 7 ? `${yearMonth}-01` : yearMonth
}

// ── 単価ルールから売上/支払金額を計算 ────────────────────────
// work_records は金額列を持たないため price_rules から都度計算する。
// 実装は utils/work-amount.ts に集約した（同じ計算がこのファイルにも重複していたため、
// 他経路が「存在しない列」を参照したまま取り残されて 3 機能が停止していた）。

// ── 締め日ユーティリティ ──────────────────────────────────
// closingRange / computeDueDate は utils/closing-period.ts へ集約した
// （billing-actions.ts にも同じ実装が重複しており、片方だけ直しても直らなかった）。

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

// ── invoices 既存行のロック判定用ルックアップ ──────────────
// upsertInvoice / commitManualInvoice で共有。writeInvoice の検索条件と揃える
// （department_id は null のとき .is() を使う。.eq(col, null) は PostgREST で動かない）。
async function fetchExistingInvoiceStatus(
  supabase: ReturnType<typeof createServiceClient>,
  params: { clientId: string; departmentId: string | null; yearMonth: string; tenantId: string },
): Promise<{ status: string | null } | null> {
  let query = supabase
    .from('invoices')
    .select('status')
    .eq('client_id', params.clientId)
    .eq('invoice_month', toDbMonth(params.yearMonth))
    .eq('tenant_id', params.tenantId)

  query = params.departmentId === null
    ? query.is('department_id', null)
    : query.eq('department_id', params.departmentId)

  const { data } = await query.maybeSingle()
  return data
}

// ── 売上一覧取得 ──────────────────────────────────────────
// invoices テーブルにある請求書 + work_records はあるが未請求の荷主を合算

export async function fetchSalesList(
  yearMonth: string,
): Promise<ActionResult<SalesListRow[]>> {
  const auth = await requireOwner()
  if (!auth.ok) return { data: null, error: auth.error }
  const tenantId = await getCurrentTenantId()
  const supabase = createServiceClient()

  // ⚠️ 集計は締め日ベース（2026-08-02 ボス判断）。締め日は荷主ごとに違うため、
  //    ここでは起こりうる最も広い期間（前月1日〜当月末日）でまとめて引き、
  //    荷主ごとの期間で後からふるいにかける。1荷主ずつ引くとN+1クエリになる。
  //    日付締めの下限は前月2日（1日締めの場合）、上限は月末締めの当月末日。
  //    余裕を見て前月1日を下限にする。
  const [y, m] = yearMonth.split('-').map(Number)
  const widestStart = formatLocalDate(new Date(y, m - 2, 1))
  const widestEnd   = closingRange(yearMonth, '月末').to

  const [invoicesRes, clientsRes] = await Promise.all([
    supabase
      .from('invoices')
      .select('id, client_id, invoice_month, status, total_tax_excluded, consumption_tax, total_amount, due_date')
      .eq('invoice_month', toDbMonth(yearMonth))
      // ⚠️ 2026-08-02 まで tenant 条件が欠落しており、他テナントの請求書が混ざりえた
      .eq('tenant_id', tenantId),
    supabase
      .from('clients')
      .select('id, company_name, tax_type, closing_day, payment_site')
      .eq('tenant_id', tenantId),
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
  // ※ tax_excluded_sales カラムは実DBに存在しないため、price_rules から都度計算
  const workRes = await supabase
    .from('work_records')
    .select('project_id, work_date, piece_count, start_time, end_time, break_minutes')
    .eq('tenant_id', tenantId)
    .gte('work_date', widestStart)
    .lte('work_date', widestEnd)

  const extraRows: SalesListRow[] = []

  if (!workRes.error && (workRes.data ?? []).length > 0) {
    const projectIds = [
      ...new Set(
        (workRes.data ?? []).map(r => r.project_id).filter((id): id is string => id !== null),
      ),
    ]

    if (projectIds.length > 0) {
      const [projectsData, rulesData] = await Promise.all([
        supabase.from('projects').select('id, client_id').in('id', projectIds).eq('tenant_id', tenantId),
        supabase.from('price_rules').select('project_id, calculation_type, selling_price, buying_price, margin_fixed').in('project_id', projectIds),
      ])

      const projectClientMap = new Map<string, string>(
        (projectsData.data ?? []).map(p => [p.id, p.client_id]),
      )
      const priceRuleMap = new Map<string, PriceRuleRecord>(
        (rulesData.data ?? []).map(r => [r.project_id, r as PriceRuleRecord]),
      )

      // 荷主ごとの締め日で対象期間を作り、その期間内の稼働だけを合算する
      const rangeCache = new Map<string, { from: string; to: string }>()

      const clientNetMap = new Map<string, number>()
      for (const r of workRes.data ?? []) {
        if (!r.project_id) continue
        const clientId = projectClientMap.get(r.project_id)
        if (!clientId || invoicedClientIds.has(clientId)) continue
        const client = clientMap.get(clientId)
        if (!client) continue

        let range = rangeCache.get(clientId)
        if (!range) {
          range = closingRange(yearMonth, client.closing_day)
          rangeCache.set(clientId, range)
        }
        if (!isWithinRange(r.work_date, range)) continue

        const rule = priceRuleMap.get(r.project_id)
        const net  = calcWorkAmount(r as RawWorkRecord, rule, 'selling')
        clientNetMap.set(clientId, (clientNetMap.get(clientId) ?? 0) + net)
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
  const auth = await requireOwner()
  if (!auth.ok) return { data: null, error: auth.error }
  const tenantId = await getCurrentTenantId()
  const supabase = createServiceClient()

  const { data: client, error: clientErr } = await supabase
    .from('clients')
    .select('id, company_name, contact_name, email, tax_type, closing_day, payment_site')
    .eq('id', clientId)
    .eq('tenant_id', tenantId)
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
    .eq('tenant_id', tenantId)

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

  const [recordsRes, rulesRes, existingRes] = await Promise.all([
    supabase
      .from('work_records')
      .select('id, work_date, project_id, piece_count, start_time, end_time, break_minutes, note')
      .in('project_id', projectIds)
      .eq('tenant_id', tenantId)
      .gte('work_date', from)
      .lte('work_date', to)
      .order('work_date'),
    supabase
      .from('price_rules')
      .select('project_id, calculation_type, selling_price, buying_price, margin_fixed')
      .in('project_id', projectIds),
    supabase
      .from('invoices')
      .select('id, status')
      .eq('client_id', clientId)
      .eq('invoice_month', toDbMonth(yearMonth))
      .maybeSingle(),
  ])

  if (recordsRes.error) return { data: null, error: recordsRes.error.message }

  const priceRuleMap = new Map<string, PriceRuleRecord>(
    (rulesRes.data ?? []).map(r => [r.project_id, r as PriceRuleRecord]),
  )

  const lines: InvoicePreviewLine[] = (recordsRes.data ?? []).map(r => {
    const proj = r.project_id ? projectMap.get(r.project_id) : null
    const rule = r.project_id ? priceRuleMap.get(r.project_id) : undefined
    const net  = calcWorkAmount(r as RawWorkRecord, rule, 'selling')
    const qty  = rule?.calculation_type === 'hourly'
      ? (r.start_time && r.end_time
          ? (new Date(r.end_time).getTime() - new Date(r.start_time).getTime()) / 3_600_000 - (r.break_minutes ?? 0) / 60
          : 0)
      : (r.piece_count ?? 0)
    return {
      workDate:    r.work_date,
      projectName: (proj as { project_name?: string; name?: string } | null)?.project_name ?? (proj as { name?: string } | null)?.name ?? '（案件なし）',
      projectCode: (proj as { project_code?: string } | null)?.project_code ?? '',
      quantity:    Math.round(qty * 10) / 10,
      netAmount:   net,
      memo:        r.note ?? null,
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
  const auth = await requireOwner()
  if (!auth.ok) return { data: null, error: auth.error }
  const supabase = createServiceClient()
  // ⚠️ 従来この経路は tenant_id を渡さず DEFAULT 'local-dev' に依存していた。
  //    共通ライタは tenant_id を必須で書き、既存行の検索にもテナントを掛ける。
  const tenantId = await getCurrentTenantId()

  // ⚠️ 確定済み（issued/paid）の上書き防止。共通ライタはロックを守らないため、書く前にここで止める。
  //    2026-07-31、この判定が無かったため「請求書プレビュー」タブの再確定が
  //    issued の請求書を無警告で上書きした（税抜 134,500 → 130,510）。
  //    解除は「確定・ロック」タブの強制アンロック経由のみ。
  const existing = await fetchExistingInvoiceStatus(supabase, {
    clientId,
    departmentId: null,          // Task 11 で部署対応を入れる
    yearMonth,
    tenantId,
  })

  const lockErr = invoiceLockError(existing)
  if (lockErr) return { data: null, error: lockErr }

  const previewRes = await computeInvoicePreview(clientId, yearMonth)
  if (previewRes.error || !previewRes.data) {
    return { data: null, error: previewRes.error ?? 'プレビュー計算失敗' }
  }
  const preview = previewRes.data

  // ⚠️ 旧列（target_month / total_amount_ex_tax / total_tax）の充足は共通ライタが担う。
  //    ここで個別に insert / update を書き直すと、3回続いた 23502 の再発源が復活する。
  const { id, error } = await writeInvoice(supabase, {
    clientId:     clientId,
    departmentId: null,          // Task 11 で部署対応を入れる
    yearMonth:    yearMonth,
    subtotal:     preview.netTotal,
    taxAmount:    preview.taxTotal,
    totalAmount:  preview.grandTotal,
    status:       'issued',
    dueDate:      preview.dueDate,
    issuedAt:     new Date().toISOString(),
    tenantId:     tenantId,
  })

  if (error || !id) return { data: null, error: error ?? '請求書の保存に失敗しました' }
  return { data: { id }, error: null }
}

// ── 入金ステータス更新 ────────────────────────────────────

export async function updateInvoiceStatus(
  invoiceId: string,
  status: 'issued' | 'paid',
): Promise<ActionResult<{ id: string }>> {
  const auth = await requireOwner()
  if (!auth.ok) return { data: null, error: auth.error }
  const tenantId = await getCurrentTenantId()
  const supabase = createServiceClient()
  const { data, error } = await supabase
    .from('invoices')
    .update({ status })
    .eq('id', invoiceId)
    .eq('tenant_id', tenantId)
    .select('id')
    .single()
  if (error) return { data: null, error: error.message }
  return { data: { id: data.id }, error: null }
}

// ── クライアント一覧 ──────────────────────────────────────

export async function fetchClientOptions(): Promise<
  ActionResult<Pick<ClientRow, 'id' | 'company_name'>[]>
> {
  const auth = await requireOwner()
  if (!auth.ok) return { data: null, error: auth.error }
  const tenantId = await getCurrentTenantId()
  const supabase = createServiceClient()
  const { data, error } = await supabase
    .from('clients')
    .select('id, company_name')
    .eq('tenant_id', tenantId)
    .order('company_name')
  if (error) return { data: null, error: error.message }
  return { data: data ?? [], error: null }
}

// ── 確定・ロック管理用：支払通知書サマリー ──────────────────

export type PaymentNoticeSummaryRow = {
  contractorId:    string
  name:            string
  invoiceType:     string
  laborNet:        number
  laborTax:        number
  expenseNet:      number
  expenseTax:      number
  deductionRate:   number
  deduction:       number
  totalAmount:     number
  // 既存 payment_notice
  noticeId:        string | null
  approvalStatus:  string   // 'pending' | 'approved'
  locked:          boolean
}

export async function fetchPaymentNoticeSummary(
  yearMonth: string,
): Promise<ActionResult<PaymentNoticeSummaryRow[]>> {
  const auth = await requireOwner()
  if (!auth.ok) return { data: null, error: auth.error }
  const tenantId = await getCurrentTenantId()
  const supabase = createServiceClient()

  const [y, m] = yearMonth.split('-').map(Number)
  const from = `${yearMonth}-01`
  const to   = new Date(y, m, 0).toISOString().slice(0, 10)
  const noticeMonth = `${yearMonth}-01`

  const [contractorsRes, workRes, expenseRes, noticesRes] = await Promise.all([
    supabase
      .from('contractors')
      // ⚠️ `tax_type` は contractors に存在しない列。正しくは `tax_category`。
      //    参照していた間は 42703 でこの一覧が丸ごと空になっていた（2026-08-02 修正）。
      .select('id, name, invoice_registration_type, tax_category')
      .eq('tenant_id', tenantId)
      .order('name'),
    supabase
      .from('work_records')
      // tax_excluded_payment は実DBに存在しないため project_id + 計測値を取得して都度計算
      .select('contractor_id, project_id, piece_count, start_time, end_time, break_minutes')
      .eq('tenant_id', tenantId)
      .gte('work_date', from)
      .lte('work_date', to),
    // ⚠️ 承認済みだけを集計する。支払通知書の生成（utils/payment-notice-calc.ts）が
    //    approval_status='approved' で絞っているのに、ここだけ絞っていなかったため
    //    未承認の立替金まで支払予定に乗り、一覧のほうが過大に出ていた（2026-08-02 修正）。
    supabase
      .from('expense_records')
      .select('contractor_id, amount_tax_excluded, tax_category')
      .eq('tenant_id', tenantId)
      .eq('approval_status', 'approved')
      .gte('expense_date', from)
      .lte('expense_date', to),
    supabase
      .from('payment_notices')
      .select('id, contractor_id, approval_status, locked, labor_tax_excluded, labor_tax, expense_tax_excluded, expense_tax, deduction_rate, deduction, total_amount')
      .eq('notice_month', toDbMonth(noticeMonth)),
  ])

  if (contractorsRes.error) return { data: null, error: contractorsRes.error.message }

  const noticeMap = new Map(
    (noticesRes.data ?? []).map(n => [n.contractor_id, n]),
  )

  // price_rules を一括取得して project_id → rule のマップを構築
  const allProjectIds = [
    ...new Set((workRes.data ?? []).map(r => r.project_id).filter((id): id is string => id !== null)),
  ]
  const priceRuleMapForPayment = new Map<string, PriceRuleRecord>()
  if (allProjectIds.length > 0) {
    const { data: rules } = await supabase
      .from('price_rules')
      .select('project_id, calculation_type, selling_price, buying_price, margin_fixed')
      .in('project_id', allProjectIds)
    for (const r of rules ?? []) priceRuleMapForPayment.set(r.project_id, r as PriceRuleRecord)
  }

  // 稼働・経費の税抜き合計を contractor ごとに集計
  type WorkAccum  = { laborNet: number }
  type ExpAccum   = { expNetTaxable: number; expNetExempt: number }
  const workMap   = new Map<string, WorkAccum>()
  const expMap    = new Map<string, ExpAccum>()

  for (const r of workRes.data ?? []) {
    const rule = r.project_id ? priceRuleMapForPayment.get(r.project_id) : undefined
    const payment = calcWorkAmount(r as RawWorkRecord, rule, 'buying')
    const acc = workMap.get(r.contractor_id) ?? { laborNet: 0 }
    acc.laborNet += payment
    workMap.set(r.contractor_id, acc)
  }
  for (const r of expenseRes.data ?? []) {
    const acc = expMap.get(r.contractor_id) ?? { expNetTaxable: 0, expNetExempt: 0 }
    if ((r as { tax_category: string }).tax_category === 'taxable_10') {
      acc.expNetTaxable += r.amount_tax_excluded
    } else {
      acc.expNetExempt  += r.amount_tax_excluded
    }
    expMap.set(r.contractor_id, acc)
  }

  const { getTransitionDeductionRate } = await import('@/lib/invoice')
  const targetDate = new Date(y, m, 0) // 月末

  const rows: PaymentNoticeSummaryRow[] = []

  for (const contractor of contractorsRes.data ?? []) {
    const work = workMap.get(contractor.id)
    const exp  = expMap.get(contractor.id)
    if (!work && !exp) continue  // この月の稼働・経費なし → 表示しない

    const existing = noticeMap.get(contractor.id)
    if (existing) {
      // 既存 notice の保存値をそのまま表示
      rows.push({
        contractorId:  contractor.id,
        name:          contractor.name,
        invoiceType:   contractor.invoice_registration_type,
        laborNet:      existing.labor_tax_excluded,
        laborTax:      existing.labor_tax,
        expenseNet:    existing.expense_tax_excluded,
        expenseTax:    existing.expense_tax,
        deductionRate: Number(existing.deduction_rate),
        deduction:     existing.deduction,
        totalAmount:   existing.total_amount,
        noticeId:      existing.id,
        approvalStatus: existing.approval_status,
        locked:        existing.locked,
      })
      continue
    }

    // 未確定 → ライブ計算で表示
    // ⚠️ 表記ゆれ（registered / 適格）があるため正本の判定を使う。直書きに戻さないこと
    const isRegistered  = isQualifiedInvoiceIssuer(contractor.invoice_registration_type)
    // 免税の表現ゆれ（'exempt' / '免税' / 'non_taxable'）に合わせる。pdfActions.ts と同判定
    const taxCategory = contractor.tax_category ?? 'exclusive'
    const isLaborTaxable = taxCategory !== 'exempt' && taxCategory !== '免税' && taxCategory !== 'non_taxable'
    const deductionRate = getTransitionDeductionRate(targetDate)

    const laborNet  = work?.laborNet ?? 0
    const laborTax  = isLaborTaxable ? Math.round(laborNet * 0.1) : 0
    const expNetTax = exp?.expNetTaxable ?? 0
    const expNetExm = exp?.expNetExempt  ?? 0
    const expTax    = Math.round(expNetTax * 0.1)

    const totalWithTax = laborNet + laborTax + expNetTax + expNetExm + expTax
    const deduction = isRegistered ? 0 : Math.round(totalWithTax * deductionRate)
    const totalAmount = totalWithTax - deduction

    rows.push({
      contractorId:  contractor.id,
      name:          contractor.name,
      invoiceType:   contractor.invoice_registration_type,
      laborNet,
      laborTax,
      expenseNet:    expNetTax + expNetExm,
      expenseTax:    expTax,
      deductionRate: isRegistered ? 0 : deductionRate,
      deduction,
      totalAmount,
      noticeId:      null,
      approvalStatus: 'pending',
      locked:        false,
    })
  }

  return { data: rows, error: null }
}

// ================================================================
// 手入力インボイス（req 5）
// ================================================================

export type ManualInvoiceLine = {
  id:          string   // フロントエンド一時ID（uuid v4 推奨）
  date:        string   // 'YYYY-MM-DD'
  projectName: string
  amount:      number   // 税抜き金額
  isTaxable:   boolean
  checked:     boolean  // ✅ DB反映対象フラグ
}

export type ManualInvoicePreview = {
  subtotal:        number
  taxAmount:       number
  deductionRate:   number
  deductionAmount: number
  finalAmount:     number
}

/**
 * 手入力インボイスの計算プレビュー（保存しない・純粋計算）
 * isRegistered: 荷主 or 委託先のインボイス登録状態
 * targetDate: 取引日（最初の行の日付を代表として使用）
 */
export async function computeManualInvoicePreview(params: {
  lines:        ManualInvoiceLine[]
  isRegistered: boolean
  targetDate:   string
}): Promise<ActionResult<ManualInvoicePreview>> {
  const auth = await requireOwner()
  if (!auth.ok) return { data: null, error: auth.error }
  const { getTransitionalDeductionRate } = await import('@/utils/billing/taxCalculator')
  const date = new Date(params.targetDate)

  const taxableSub = params.lines
    .filter(l => l.checked && l.isTaxable)
    .reduce((s, l) => s + l.amount, 0)
  const nonTaxSub = params.lines
    .filter(l => l.checked && !l.isTaxable)
    .reduce((s, l) => s + l.amount, 0)

  const taxAmount = Math.round(taxableSub * 0.1)
  const deductionRate   = getTransitionalDeductionRate(params.isRegistered, date)
  const deductionAmount = params.isRegistered
    ? 0
    : Math.round((taxableSub + taxAmount) * deductionRate)

  return {
    data: {
      subtotal:        taxableSub + nonTaxSub,
      taxAmount,
      deductionRate,
      deductionAmount,
      finalAmount:     taxableSub + nonTaxSub + taxAmount - deductionAmount,
    },
    error: null,
  }
}

/**
 * チェック済み行のみを DB（invoices + billing_records）に反映する。
 * clientId: 「売上請求書（イン）」のとき荷主ID
 * contractorId: 「支払請求書（アウト）」のとき委託先ID
 * mode: 'in' | 'out'
 */
export async function commitManualInvoice(params: {
  yearMonth:     string
  lines:         ManualInvoiceLine[]   // checked=true の行のみ反映
  clientId?:     string
  contractorId?: string
  mode:          'in' | 'out'
  // ⚠️ finalAmount は税込・経過措置差引後の最終請求額。
  //    税抜合計と消費税額は別物なので、旧列 total_amount_ex_tax（税抜であるべき列）へ
  //    finalAmount を流し込まないよう、呼び出し側から3つとも受け取る。
  subtotalExTax: number   // 税抜合計（preview.subtotal）
  taxAmount:     number   // 消費税額（preview.taxAmount）
  finalAmount:   number   // 税込・経過措置差引後（preview.finalAmount）
}): Promise<ActionResult<{ id: string }>> {
  const auth = await requireOwner()
  if (!auth.ok) return { data: null, error: auth.error }
  const tenantId = await getCurrentTenantId()
  const db = createServiceClient() as any

  const checkedLines = params.lines.filter(l => l.checked)
  if (checkedLines.length === 0)
    return { data: null, error: 'チェック済みの行がありません' }

  const noticeMonth = `${params.yearMonth}-01`

  if (params.mode === 'in') {
    // 売上請求書（イン）→ invoices テーブルへ upsert
    if (!params.clientId)
      return { data: null, error: '荷主を選択してください' }

    // ⚠️ 2026-07-29 まで target_month / total_amount_ex_tax / total_tax が未指定で、
    //    23502 not-null violation により必ず失敗していた（B-1）。
    //    また素の insert だったため、同一荷主・同一月の 2 回目が 23505 で失敗した（B-3）。
    //    共通ライタへ移行して両方を解消する。
    // ⚠️ 確定済み（issued/paid）の上書き防止。共通ライタはロックを守らないため、書く前にここで止める
    //    （upsertInvoice / finalizeInvoice と同じ判定。この画面には開発者アンロックUIが無いため
    //    オプションなしで呼び、fail-closed で止める）。
    const existing = await fetchExistingInvoiceStatus(db, {
      clientId:     params.clientId,
      departmentId: null,          // Task 11 で部署対応を入れる
      yearMonth:    params.yearMonth,
      tenantId,
    })
    const lockErr = invoiceLockError(existing)
    if (lockErr) return { data: null, error: lockErr }

    const { id, error } = await writeInvoice(db, {
      clientId:     params.clientId,
      departmentId: null,          // Task 11 で部署対応を入れる
      yearMonth:    params.yearMonth,
      subtotal:     params.subtotalExTax,   // 税抜合計
      taxAmount:    params.taxAmount,       // 消費税額
      totalAmount:  params.finalAmount,     // 税込（経過措置差引後）
      status:       'draft',
      dueDate:      null,
      issuedAt:     null,
      tenantId:     tenantId,
    })

    if (error || !id) return { data: null, error: error ?? '請求書の保存に失敗しました' }
    return { data: { id }, error: null }
  } else {
    // 支払請求書（アウト）→ payment_notices テーブルへ insert
    if (!params.contractorId)
      return { data: null, error: '委託先を選択してください' }

    const { data, error } = await db
      .from('payment_notices')
      .insert({
        contractor_id:   params.contractorId,
        notice_month:    noticeMonth,
        total_amount:    params.finalAmount,
        adjustment_amount: 0,
        approval_status: 'unapproved',
        tenant_id:       tenantId,
        updated_at:      new Date().toISOString(),
      })
      .select('id')
      .single()

    if (error || !data) return { data: null, error: error?.message ?? '登録に失敗しました' }
    return { data: { id: data.id }, error: null }
  }
}

/** 取引先リスト（委託先）*/
export async function fetchContractorOptions(): Promise<
  ActionResult<{ id: string; name: string; isRegistered: boolean }[]>
> {
  const auth = await requireOwner()
  if (!auth.ok) return { data: null, error: auth.error }
  const tenantId = await getCurrentTenantId()
  const db = createServiceClient() as any
  const { data, error } = await db
    .from('contractors')
    .select('id, name, invoice_registration_type')
    .eq('tenant_id', tenantId)
    .order('name')
  if (error) return { data: null, error: error.message }
  return {
    data: (data ?? []).map((r: any) => ({
      id:           r.id,
      name:         r.name,
      isRegistered: isQualifiedInvoiceIssuer(r.invoice_registration_type),
    })),
    error: null,
  }
}
