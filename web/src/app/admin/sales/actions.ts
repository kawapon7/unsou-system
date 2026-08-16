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
import { computePaymentNoticeAmounts } from '@/utils/payment-notice-calc'
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
  clientId:               string
  companyName:            string
  contactName:            string | null
  email:                  string | null
  taxType:                string
  invoiceMonth:           string
  closingDay:             string
  paymentSite:            number
  dueDate:                string
  lines:                  InvoicePreviewLine[]
  netTotal:               number
  taxTotal:               number
  grandTotal:             number
  existingInvoiceId:      string | null
  invoiceStatus:          string | null
  unassignedProjectCount: number
}

export type ExistingInvoiceSummary = {
  id:             string
  departmentId:   string | null
  departmentName: string | null
  status:         string
  totalAmount:    number
}

type ActionResult<T> = { data: T; error: null } | { data: null; error: string }

// ── invoices 既存行のロック判定用ルックアップ ──────────────
// upsertInvoice / commitManualInvoice で共有。writeInvoice の検索条件と揃える
// （department_id は null のとき .is() を使う。.eq(col, null) は PostgREST で動かない）。
async function fetchExistingInvoiceStatus(
  supabase: ReturnType<typeof createServiceClient>,
  params: { clientId: string; departmentId: string | null; yearMonth: string; tenantId: string },
): Promise<{ data: { status: string | null } | null; error: string | null }> {
  let query = supabase
    .from('invoices')
    .select('status')
    .eq('client_id', params.clientId)
    .eq('invoice_month', toDbMonth(params.yearMonth))
    .eq('tenant_id', params.tenantId)

  query = params.departmentId === null
    ? query.is('department_id', null)
    : query.eq('department_id', params.departmentId)

  const { data, error } = await query.maybeSingle()
  // ⚠️ fail-open 厳禁: エラーを握り潰すと「既存なし」と読めてしまい、
  //    確定済み(issued/paid)の請求書がロックをすり抜けて上書きされる。
  //    ロックは砦なので、確認できなかったときは通さない（2026-08-02）。
  if (error) return { data: null, error: `既存請求書の確認に失敗しました: ${error.message}` }
  return { data, error: null }
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
  departmentId?: string | null,
): Promise<ActionResult<InvoicePreview>> {
  const auth = await requireOwner()
  if (!auth.ok) return { data: null, error: auth.error }
  const tenantId = await getCurrentTenantId()
  const supabase = createServiceClient()

  const { data: client, error: clientErr } = await supabase
    .from('clients')
    .select('id, company_name, contact_name, email, tax_type, closing_day, payment_site, use_departments')
    .eq('id', clientId)
    .eq('tenant_id', tenantId)
    .single()

  if (clientErr || !client) {
    return { data: null, error: clientErr?.message ?? '荷主が見つかりません' }
  }

  // 部署制ONなら departmentId は必須。未指定で全案件を集めると、
  // 部署をまたいだ請求書ができて取引先に誤った金額を提示することになる
  if (client.use_departments && !departmentId) {
    return { data: null, error: '部署を選択してください' }
  }

  const { from, to } = closingRange(yearMonth, client.closing_day)
  const dueDate = computeDueDate(yearMonth, client.closing_day, client.payment_site)

  let projectQuery = supabase
    .from('projects')
    .select('id, project_name, project_code')
    .eq('client_id', clientId)
    .eq('tenant_id', tenantId)

  // ⚠️ use_departments = false の場合は絞り込みを一切足さない（回帰防止・従来どおり全案件が対象）
  if (client.use_departments) {
    projectQuery = projectQuery.eq('department_id', departmentId!)
  }

  const { data: projects, error: projErr } = await projectQuery

  if (projErr) return { data: null, error: projErr.message }

  const projectIds  = (projects ?? []).map(p => p.id)
  const projectMap  = new Map((projects ?? []).map(p => [p.id, p]))

  // 未割当案件数（部署制の荷主だけ数える。生成をブロックするためではなく警告表示用）
  let unassignedProjectCount = 0
  if (client.use_departments) {
    const { count } = await supabase
      .from('projects')
      .select('id', { count: 'exact', head: true })
      .eq('client_id', clientId)
      .eq('tenant_id', tenantId)
      .is('department_id', null)
    unassignedProjectCount = count ?? 0
  }

  const base: Omit<InvoicePreview, 'lines' | 'netTotal' | 'taxTotal' | 'grandTotal' | 'existingInvoiceId' | 'invoiceStatus' | 'unassignedProjectCount'> = {
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
      data: { ...base, lines: [], netTotal: 0, taxTotal: 0, grandTotal: 0, existingInvoiceId: null, invoiceStatus: null, unassignedProjectCount },
      error: null,
    }
  }

  const normalizedDepartmentId = client.use_departments ? (departmentId ?? null) : null

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
    (() => {
      let q = supabase
        .from('invoices')
        .select('id, status')
        .eq('client_id', clientId)
        .eq('invoice_month', toDbMonth(yearMonth))
        .eq('tenant_id', tenantId)
      // ⚠️ .eq('department_id', null) は PostgREST では動かない。必ず .is() を使う
      q = normalizedDepartmentId ? q.eq('department_id', normalizedDepartmentId) : q.is('department_id', null)
      return q.maybeSingle()
    })(),
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
      unassignedProjectCount,
    },
    error: null,
  }
}

// ── インボイス確定・保存 ──────────────────────────────────

export async function upsertInvoice(
  clientId: string,
  yearMonth: string,
  departmentId?: string | null,
): Promise<ActionResult<{ id: string }>> {
  const auth = await requireOwner()
  if (!auth.ok) return { data: null, error: auth.error }
  const supabase = createServiceClient()
  // ⚠️ 従来この経路は tenant_id を渡さず DEFAULT 'local-dev' に依存していた。
  //    共通ライタは tenant_id を必須で書き、既存行の検索にもテナントを掛ける。
  const tenantId = await getCurrentTenantId()
  const normalizedDepartmentId = departmentId ?? null

  // ⚠️ 確定済み（issued/paid）の上書き防止。共通ライタはロックを守らないため、書く前にここで止める。
  //    2026-07-31、この判定が無かったため「請求書プレビュー」タブの再確定が
  //    issued の請求書を無警告で上書きした（税抜 134,500 → 130,510）。
  //    解除は「確定・ロック」タブの強制アンロック経由のみ。
  const existing = await fetchExistingInvoiceStatus(supabase, {
    clientId,
    departmentId: normalizedDepartmentId,
    yearMonth,
    tenantId,
  })

  if (existing.error) return { data: null, error: existing.error }
  const lockErr = invoiceLockError(existing.data)
  if (lockErr) return { data: null, error: lockErr }

  const previewRes = await computeInvoicePreview(clientId, yearMonth, normalizedDepartmentId)
  if (previewRes.error || !previewRes.data) {
    return { data: null, error: previewRes.error ?? 'プレビュー計算失敗' }
  }
  const preview = previewRes.data

  // ⚠️ 旧列（target_month / total_amount_ex_tax / total_tax）の充足は共通ライタが担う。
  //    ここで個別に insert / update を書き直すと、3回続いた 23502 の再発源が復活する。
  const { id, error } = await writeInvoice(supabase, {
    clientId:     clientId,
    departmentId: normalizedDepartmentId,
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

// ── 既存請求書一覧（同一荷主・同一月）────────────────────────
// 生成前に表示し、二重請求（既に発行済みの請求書があるのに気づかず再生成）を防ぐ

export async function fetchExistingInvoices(
  clientId: string,
  yearMonth: string,
): Promise<ActionResult<ExistingInvoiceSummary[]>> {
  const auth = await requireOwner()
  if (!auth.ok) return { data: null, error: auth.error }
  const tenantId = await getCurrentTenantId()
  const supabase = createServiceClient()

  const { data, error } = await supabase
    .from('invoices')
    .select('id, department_id, status, total_amount, client_departments ( name )')
    .eq('client_id',     clientId)
    .eq('invoice_month', toDbMonth(yearMonth))
    .eq('tenant_id',     tenantId)
  if (error) return { data: null, error: error.message }

  return {
    data: (data ?? []).map(r => ({
      id:             r.id as string,
      departmentId:   (r.department_id as string | null),
      departmentName: ((r as Record<string, unknown>)['client_departments'] as { name: string } | null)?.name ?? null,
      status:         r.status as string,
      totalAmount:    r.total_amount as number,
    })),
    error: null,
  }
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
  ActionResult<Pick<ClientRow, 'id' | 'company_name' | 'use_departments'>[]>
> {
  const auth = await requireOwner()
  if (!auth.ok) return { data: null, error: auth.error }
  const tenantId = await getCurrentTenantId()
  const supabase = createServiceClient()
  const { data, error } = await supabase
    .from('clients')
    .select('id, company_name, use_departments')
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
  /** 運送保険の相殺額（非課税）。deduction とは別枠で表示する */
  insuranceDeduction: number
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

  // ⚠️ 対象期間は暦月固定ではなく委託先ごとの締め期間。金額の算出は
  //    computePaymentNoticeAmounts（唯一の正本）に委譲する。以前はここだけが
  //    暦月固定の自前計算で、月末以外の締めの委託先が入った瞬間に
  //    通知書と金額が食い違う状態だった。自前計算に戻さないこと。
  // 締め日は委託先ごとに異なるため、対象委託先の洗い出しは「前月1日〜当月末日」に
  // 広げる（generateAllPaymentNotices と同じパターン）。実際の集計期間は
  // computePaymentNoticeAmounts 側で closing_day により再度絞り込まれる。
  const [y, m] = yearMonth.split('-').map(Number)
  const wideFrom = formatLocalDate(new Date(y, m - 2, 1))
  const wideTo   = formatLocalDate(new Date(y, m, 0))
  const noticeMonth = `${yearMonth}-01`

  const [contractorsRes, workRes, expenseRes, noticesRes] = await Promise.all([
    supabase
      .from('contractors')
      .select('id, name, invoice_registration_type')
      .eq('tenant_id', tenantId)
      .order('name'),
    supabase
      .from('work_records')
      .select('contractor_id, work_date')
      .eq('tenant_id', tenantId)
      .gte('work_date', wideFrom)
      .lte('work_date', wideTo)
      .not('contractor_id', 'is', null),
    // 承認済みのみ。通知書の集計（payment-notice-calc.ts）と同じ絞り込み
    supabase
      .from('expense_records')
      .select('contractor_id, expense_date')
      .eq('tenant_id', tenantId)
      .eq('approval_status', 'approved')
      .gte('expense_date', wideFrom)
      .lte('expense_date', wideTo),
    supabase
      .from('payment_notices')
      .select('id, contractor_id, approval_status, locked, labor_tax_excluded, labor_tax, expense_tax_excluded, expense_tax, deduction_rate, deduction, insurance_deduction, total_amount')
      // ⚠️ tenant_id 条件を忘れないこと。2026-08-04 の billing-actions 側の修正
      //    （481712c）と同型の漏れがここに残っていた（2026-08-10 修正）
      .eq('tenant_id', tenantId)
      .eq('notice_month', toDbMonth(noticeMonth)),
  ])

  if (contractorsRes.error) return { data: null, error: contractorsRes.error.message }
  if (workRes.error)        return { data: null, error: workRes.error.message }
  if (expenseRes.error)     return { data: null, error: expenseRes.error.message }
  if (noticesRes.error)     return { data: null, error: noticesRes.error.message }

  const noticeMap = new Map(
    (noticesRes.data ?? []).map(n => [n.contractor_id, n]),
  )

  // 広域窓に活動のある委託先だけをライブ計算の候補にする（activityDates は
  // 締め期間確定後の「表示するか」の最終判定に使う）
  const activityDates = new Map<string, string[]>()
  for (const r of workRes.data ?? []) {
    if (!r.contractor_id) continue
    const dates = activityDates.get(r.contractor_id) ?? []
    dates.push(r.work_date)
    activityDates.set(r.contractor_id, dates)
  }
  for (const r of expenseRes.data ?? []) {
    const dates = activityDates.get(r.contractor_id) ?? []
    dates.push(r.expense_date)
    activityDates.set(r.contractor_id, dates)
  }

  let rows: (PaymentNoticeSummaryRow | null)[]
  try {
    rows = await Promise.all(
    (contractorsRes.data ?? []).map(async (contractor): Promise<PaymentNoticeSummaryRow | null> => {
      const existing = noticeMap.get(contractor.id)
      if (existing) {
        // 既存 notice の保存値をそのまま表示
        return {
          contractorId:  contractor.id,
          name:          contractor.name,
          invoiceType:   contractor.invoice_registration_type,
          laborNet:      existing.labor_tax_excluded,
          laborTax:      existing.labor_tax,
          expenseNet:    existing.expense_tax_excluded,
          expenseTax:    existing.expense_tax,
          deductionRate: Number(existing.deduction_rate),
          deduction:     existing.deduction,
          insuranceDeduction: Number((existing as { insurance_deduction?: number }).insurance_deduction ?? 0),
          totalAmount:   existing.total_amount,
          noticeId:      existing.id,
          approvalStatus: existing.approval_status,
          locked:        existing.locked,
        }
      }

      const dates = activityDates.get(contractor.id)
      if (!dates) return null  // 広域窓に稼働・承認済み経費なし → 表示しない

      // 未確定 → 正本のライブ計算（締め期間・payee ルール・調整金・稼働日別の率まで
      // 通知書の生成とまったく同じ計算）で表示する
      const { data: a, error } = await computePaymentNoticeAmounts(supabase, {
        tenantId,
        contractorId: contractor.id,
        yearMonth,
      })
      // ⚠️ 1件の失敗で行を黙って落とすと支払漏れにつながるため fail-closed
      if (error || !a) throw new Error(`${contractor.name}: ${error ?? '計算結果が空です'}`)

      // 広域窓の活動がこの委託先の締め期間の外だけ（例: 前月分は前月の通知書の範囲）
      // なら、この月の行としては表示しない
      const inPeriod = dates.some(d => d >= a.period.from && d <= a.period.to)
      if (!inPeriod) return null

      return {
        contractorId:  contractor.id,
        name:          contractor.name,
        invoiceType:   contractor.invoice_registration_type,
        laborNet:      a.laborTaxExcluded,
        laborTax:      a.laborTax,
        expenseNet:    a.expenseTaxExcluded,
        expenseTax:    a.expenseTax,
        deductionRate: a.deductionRate,
        deduction:     a.deduction,
        insuranceDeduction: a.insuranceDeduction,
        // 調整金込み。通知書が保存する total_amount と同じ定義
        totalAmount:   a.totalAmount,
        noticeId:      null,
        approvalStatus: 'pending',
        locked:        false,
      }
    }),
    )
  } catch (e) {
    return { data: null, error: e instanceof Error ? e.message : String(e) }
  }

  return { data: rows.filter((r): r is PaymentNoticeSummaryRow => r !== null), error: null }
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
 *
 * ⚠️ 経過措置を適用するかどうかは **mode がサーバー側で決める**。呼び出し側に決めさせないこと。
 *    売上（in・自社が売り手）は差し引きなし、支払（out・自社が買い手）だけ差し引く。
 *    2026-08-16 以前は mode を受け取らず、画面が渡す isRegistered だけで判定していた。
 *    その値は fetchClientOptions が invoice_registered を返さないため売上側で常に false に落ち、
 *    **荷主の登録状況にかかわらず全ての手入力売上請求書から2%が引かれていた**（論点B）。
 *
 * isRegistered: 委託先のインボイス登録状態（mode='out' のときだけ意味を持つ）
 * targetDate: 取引日（最初の行の日付を代表として使用）
 */
export async function computeManualInvoicePreview(params: {
  lines:        ManualInvoiceLine[]
  mode:         'in' | 'out'
  isRegistered: boolean
  targetDate:   string
}): Promise<ActionResult<ManualInvoicePreview>> {
  const auth = await requireOwner()
  if (!auth.ok) return { data: null, error: auth.error }
  const { calculateInvoiceTax, calculatePaymentTax } = await import('@/utils/billing/taxCalculator')

  const items = params.lines
    .filter(l => l.checked)
    .map(l => ({ amount: l.amount, isTaxable: l.isTaxable }))

  const result =
    params.mode === 'out'
      ? calculatePaymentTax(items, params.isRegistered, new Date(params.targetDate))
      : { ...calculateInvoiceTax(items), deductionRate: 0, deductionAmount: 0 }

  return {
    data: {
      subtotal:        result.subtotal,
      taxAmount:       result.taxAmount,
      deductionRate:   result.deductionRate,
      deductionAmount: result.deductionAmount,
      finalAmount:     result.finalAmount,
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
    if (existing.error) return { data: null, error: existing.error }
    const lockErr = invoiceLockError(existing.data)
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
