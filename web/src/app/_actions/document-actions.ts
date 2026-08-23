'use server'

import { createServiceClient } from '@/utils/supabase/service'
import { requireOwner, requireAuth } from '@/utils/auth'
import { getCurrentTenantId } from '@/utils/tenant'
import { fetchInvoicePdfData, fetchPaymentNoticePdfData } from './pdf-actions'
import {
  DEFAULT_INVOICE_NUMBER_FORMAT, DEFAULT_PAYMENT_NOTICE_NUMBER_FORMAT, formatDocumentNumber, sequencePeriodKey, validateDocumentNumberFormat,
} from '@/utils/document-number'
import { resolveDocumentFormat, type DocumentKind } from '@/utils/document-formats'
import {
  normalizeFilter,
  type IssuedDocumentFilter, type IssuedDocumentSummary, type IssuedDocumentDetail,
} from '@/utils/document-search'

type ActionResult<T> = { data: T; error: null } | { data: null; error: string }
type Service = ReturnType<typeof createServiceClient>

// ⚠️ 本ファイルは invoices / payment_notices を一切書かない。金額計算も持たない。
//    発行控えは「発行時点の描画データ（snapshot）」をそのまま保存する。
// ⚠️ DB 未適用環境（20260823150000 未実行）ではテーブルが無いため全アクションが error を返す。
// ⚠️ issued_documents は guard トリガで「取消以外の UPDATE」と DELETE が拒否される。
//    取消済み行は二度と更新できないので、superseded_by は取消の UPDATE と同じ文で書く必要があるが、
//    部分ユニーク索引 (tenant, kind, source_id) WHERE status='issued' のため新控えを先に作れない。
//    → 再発行は「取消 → 発行」の順とし、新旧の対応は document_history.reason に残す。

type Row = {
  id: string; kind: DocumentKind; source_id: string; document_number: string
  format_key: string; format_version: number; status: 'issued' | 'cancelled'
  issued_at: string; cancelled_at: string | null; cancel_reason: string | null
  superseded_by: string | null; party_name: string; document_date: string; total_amount: number
}
const SUMMARY_COLUMNS =
  'id, kind, source_id, document_number, format_key, format_version, status, issued_at, cancelled_at, cancel_reason, superseded_by, party_name, document_date, total_amount'

function toSummary(r: Row): IssuedDocumentSummary {
  return {
    id: r.id, kind: r.kind, sourceId: r.source_id, documentNumber: r.document_number,
    formatKey: r.format_key, formatVersion: r.format_version, status: r.status,
    issuedAt: r.issued_at, cancelledAt: r.cancelled_at, cancelReason: r.cancel_reason,
    supersededBy: r.superseded_by, partyName: r.party_name, documentDate: r.document_date,
    totalAmount: Number(r.total_amount),
  }
}

function todayStr(): string {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

/** 会社設定から採番書式・決算月・標準様式キーを取る（未登録は fail-closed） */
async function loadCompanyIssuanceSettings(service: Service, tenantId: string) {
  const { data, error } = await service
    .from('companies')
    .select('invoice_number_format, fiscal_year_end_month, document_format_key')
    .eq('tenant_id', tenantId)
    .maybeSingle()
  if (error) return { data: null, error: error.message }
  if (!data) return { data: null, error: '自社情報が未登録です。設定 > 自社情報を先に登録してください。' }
  const format = data.invoice_number_format || DEFAULT_INVOICE_NUMBER_FORMAT
  const fmtErr = validateDocumentNumberFormat(format)
  if (fmtErr) return { data: null, error: `採番書式が不正です: ${fmtErr}` }
  return {
    data: { format, fiscalYearEndMonth: data.fiscal_year_end_month, companyFormatKey: data.document_format_key },
    error: null,
  }
}

type IssueInput = {
  kind: DocumentKind
  sourceId: string
  contractorId: string | null
  partyName: string
  totalAmount: number
  snapshot: unknown
  clientFormatKey: string | null
  clientCode: string | null
  userId: string
  /** 再発行のとき: 旧番号と理由（履歴に残す） */
  reissueOf?: { documentNumber: string; reason: string }
}

/** 採番 → INSERT → 履歴 */
async function issueDocument(service: Service, tenantId: string, input: IssueInput): Promise<ActionResult<IssuedDocumentSummary>> {
  const settings = await loadCompanyIssuanceSettings(service, tenantId)
  if (settings.error || !settings.data) return { data: null, error: settings.error ?? '設定取得に失敗しました' }
  const { format: invoiceFormat, fiscalYearEndMonth, companyFormatKey } = settings.data

  // 有効な控えが既にあれば拒否（部分ユニーク索引でも守られるが、先に分かる文言で返す）
  const { data: active } = await service
    .from('issued_documents')
    .select('id, document_number')
    .eq('tenant_id', tenantId).eq('kind', input.kind).eq('source_id', input.sourceId).eq('status', 'issued')
    .maybeSingle()
  if (active) {
    return { data: null, error: `発行済みの控え（${active.document_number}）があります。取消してから再発行してください。` }
  }

  const ctx = { date: new Date(), fiscalYearEndMonth, clientCode: input.clientCode }
  // ⚠️ 支払通知書は会社設定の書式を使わず固定書式（PN-…）。同じ書式だと番号が UNIQUE 制約で請求書と衝突する（8/23 画面検証で再現）。
  const format = input.kind === 'payment_notice' ? DEFAULT_PAYMENT_NOTICE_NUMBER_FORMAT : invoiceFormat
  const periodKey = sequencePeriodKey(format, ctx)
  const { data: seq, error: seqErr } = await service.rpc('next_document_sequence', {
    p_tenant_id: tenantId, p_kind: input.kind, p_period_key: periodKey,
  })
  if (seqErr || typeof seq !== 'number') return { data: null, error: `採番に失敗しました: ${seqErr?.message ?? 'unknown'}` }
  const documentNumber = formatDocumentNumber(format, { ...ctx, seq })

  const fmt = resolveDocumentFormat(input.kind, { clientKey: input.clientFormatKey, companyKey: companyFormatKey })

  const { data: inserted, error: insErr } = await service
    .from('issued_documents')
    .insert({
      tenant_id: tenantId, kind: input.kind, source_id: input.sourceId, contractor_id: input.contractorId,
      document_number: documentNumber, format_key: fmt.key, format_version: fmt.version,
      status: 'issued', issued_by: input.userId,
      party_name: input.partyName, document_date: todayStr(), total_amount: input.totalAmount,
      // ⚠️ snapshot は InvoicePdfData / PaymentNoticePdfData をそのまま JSON 化。Json 型への変換は as で通す
      snapshot: JSON.parse(JSON.stringify(input.snapshot)),
    })
    .select(SUMMARY_COLUMNS)
    .single()
  if (insErr || !inserted) return { data: null, error: insErr?.message ?? '控えの保存に失敗しました' }

  const { error: histErr } = await service.from('document_history').insert({
    tenant_id: tenantId, issued_document_id: inserted.id,
    action_type: input.reissueOf ? 'reissued' : 'issued', action_by: input.userId,
    reason: input.reissueOf ? `旧番号 ${input.reissueOf.documentNumber} の再発行: ${input.reissueOf.reason}` : null,
  })
  if (histErr) return { data: null, error: `履歴の記録に失敗しました: ${histErr.message}` }

  return { data: toSummary(inserted as Row), error: null }
}

async function cancelInternal(
  service: Service, tenantId: string, id: string, reason: string, userId: string,
): Promise<ActionResult<Row>> {
  const trimmed = reason.trim()
  if (!trimmed) return { data: null, error: '取消理由を入力してください' }
  const { data: doc, error } = await service
    .from('issued_documents').select(SUMMARY_COLUMNS).eq('tenant_id', tenantId).eq('id', id).maybeSingle()
  if (error) return { data: null, error: error.message }
  if (!doc) return { data: null, error: '控えが見つかりません' }
  if (doc.status === 'cancelled') return { data: null, error: 'すでに取消済みです' }

  const { error: updErr } = await service
    .from('issued_documents')
    .update({ status: 'cancelled', cancelled_at: new Date().toISOString(), cancelled_by: userId, cancel_reason: trimmed })
    .eq('tenant_id', tenantId).eq('id', id)
  if (updErr) return { data: null, error: updErr.message }

  const { error: histErr } = await service.from('document_history').insert({
    tenant_id: tenantId, issued_document_id: id, action_type: 'cancelled', action_by: userId, reason: trimmed,
  })
  if (histErr) return { data: null, error: `履歴の記録に失敗しました: ${histErr.message}` }
  return { data: doc as Row, error: null }
}

/** 請求書の現在データから発行入力を組む（確定済みチェック込み） */
async function buildInvoiceIssueInput(
  service: Service, tenantId: string, clientId: string, yearMonth: string,
): Promise<ActionResult<Omit<IssueInput, 'userId' | 'reissueOf'>>> {
  // 確定済み（issued/paid）の請求書だけ発行できる
  const { data: inv, error: invErr } = await service
    .from('invoices').select('id, status')
    .eq('tenant_id', tenantId).eq('client_id', clientId).eq('invoice_month', `${yearMonth}-01`).is('department_id', null)
    .maybeSingle()
  if (invErr) return { data: null, error: invErr.message }
  if (!inv || (inv.status !== 'issued' && inv.status !== 'paid')) {
    return { data: null, error: '請求書が未確定です。「確定・ロック」で確定してから発行してください。' }
  }
  const { data: client, error: clErr } = await service
    .from('clients').select('document_format_key').eq('tenant_id', tenantId).eq('id', clientId).maybeSingle()
  if (clErr) return { data: null, error: clErr.message }

  const pdf = await fetchInvoicePdfData(clientId, yearMonth)
  if (pdf.error || !pdf.data) return { data: null, error: pdf.error ?? 'PDFデータの取得に失敗しました' }

  return {
    data: {
      kind: 'invoice', sourceId: inv.id, contractorId: null,
      partyName: pdf.data.clientName, totalAmount: pdf.data.totalAmount, snapshot: pdf.data,
      clientFormatKey: client?.document_format_key ?? null, clientCode: null,
    },
    error: null,
  }
}

/** 支払通知書の現在データから発行入力を組む（承認/ロック済みチェック込み） */
async function buildPaymentNoticeIssueInput(
  service: Service, tenantId: string, contractorId: string, yearMonth: string,
): Promise<ActionResult<Omit<IssueInput, 'userId' | 'reissueOf'>>> {
  // 承認済みまたはロック済みの支払通知書だけ発行できる（仕入明細書の相手方確認と整合）
  const { data: pn, error: pnErr } = await service
    .from('payment_notices').select('id, approval_status, locked')
    .eq('tenant_id', tenantId).eq('contractor_id', contractorId).eq('notice_month', `${yearMonth}-01`)
    .maybeSingle()
  if (pnErr) return { data: null, error: pnErr.message }
  if (!pn || !(pn.approval_status === 'approved' || pn.locked === true)) {
    return { data: null, error: '支払通知書が未承認です。承認（またはロック）後に発行してください。' }
  }

  const pdf = await fetchPaymentNoticePdfData(contractorId, yearMonth)
  if (pdf.error || !pdf.data) return { data: null, error: pdf.error ?? 'PDFデータの取得に失敗しました' }

  return {
    data: {
      kind: 'payment_notice', sourceId: pn.id, contractorId,
      partyName: pdf.data.contractorName, totalAmount: pdf.data.totalAmount, snapshot: pdf.data,
      clientFormatKey: null, clientCode: null,
    },
    error: null,
  }
}

// ── 公開 Server Actions ─────────────────────────────────────────

export async function issueInvoiceDocument(clientId: string, yearMonth: string): Promise<ActionResult<IssuedDocumentSummary>> {
  const auth = await requireOwner()
  if (!auth.ok) return { data: null, error: auth.error }
  const tenantId = await getCurrentTenantId()
  const service = createServiceClient()
  const input = await buildInvoiceIssueInput(service, tenantId, clientId, yearMonth)
  if (input.error || !input.data) return { data: null, error: input.error ?? '発行データの取得に失敗しました' }
  return issueDocument(service, tenantId, { ...input.data, userId: auth.ctx.userId })
}

export async function issuePaymentNoticeDocument(contractorId: string, yearMonth: string): Promise<ActionResult<IssuedDocumentSummary>> {
  const auth = await requireOwner()
  if (!auth.ok) return { data: null, error: auth.error }
  const tenantId = await getCurrentTenantId()
  const service = createServiceClient()
  const input = await buildPaymentNoticeIssueInput(service, tenantId, contractorId, yearMonth)
  if (input.error || !input.data) return { data: null, error: input.error ?? '発行データの取得に失敗しました' }
  return issueDocument(service, tenantId, { ...input.data, userId: auth.ctx.userId })
}

export async function cancelIssuedDocument(id: string, reason: string): Promise<ActionResult<void>> {
  const auth = await requireOwner()
  if (!auth.ok) return { data: null, error: auth.error }
  const tenantId = await getCurrentTenantId()
  const res = await cancelInternal(createServiceClient(), tenantId, id, reason, auth.ctx.userId)
  return res.error ? { data: null, error: res.error } : { data: undefined, error: null }
}

/** 取消 → 現在のデータで再発行（番号は新規採番） */
export async function reissueDocument(id: string, reason: string): Promise<ActionResult<IssuedDocumentSummary>> {
  const auth = await requireOwner()
  if (!auth.ok) return { data: null, error: auth.error }
  const tenantId = await getCurrentTenantId()
  const service = createServiceClient()
  if (!reason.trim()) return { data: null, error: '再発行理由を入力してください' }

  const { data: old, error } = await service
    .from('issued_documents').select(SUMMARY_COLUMNS)
    .eq('tenant_id', tenantId).eq('id', id).maybeSingle()
  if (error) return { data: null, error: error.message }
  if (!old) return { data: null, error: '控えが見つかりません' }
  if (old.status === 'cancelled') return { data: null, error: '取消済みの控えは再発行できません。元の請求書・支払通知書から発行してください。' }

  // 再発行は「現在のデータ」で取り直す（訂正後の内容を反映するため）。
  // 元データを取り直せない（削除済み等）なら取消もしない。
  let input: ActionResult<Omit<IssueInput, 'userId' | 'reissueOf'>>
  if (old.kind === 'invoice') {
    const { data: inv } = await service.from('invoices').select('client_id, invoice_month').eq('tenant_id', tenantId).eq('id', old.source_id).maybeSingle()
    if (!inv) return { data: null, error: '元の請求書が見つかりません' }
    input = await buildInvoiceIssueInput(service, tenantId, inv.client_id, String(inv.invoice_month).slice(0, 7))
  } else {
    const { data: pn } = await service.from('payment_notices').select('contractor_id, notice_month').eq('tenant_id', tenantId).eq('id', old.source_id).maybeSingle()
    if (!pn) return { data: null, error: '元の支払通知書が見つかりません' }
    input = await buildPaymentNoticeIssueInput(service, tenantId, pn.contractor_id, String(pn.notice_month).slice(0, 7))
  }
  if (input.error || !input.data) return { data: null, error: input.error ?? '発行データの取得に失敗しました' }

  const cancelled = await cancelInternal(service, tenantId, id, reason, auth.ctx.userId)
  if (cancelled.error) return { data: null, error: cancelled.error }

  return issueDocument(service, tenantId, {
    ...input.data, userId: auth.ctx.userId,
    reissueOf: { documentNumber: old.document_number, reason: reason.trim() },
  })
}

export async function listIssuedDocuments(filter: IssuedDocumentFilter): Promise<ActionResult<IssuedDocumentSummary[]>> {
  const auth = await requireOwner()
  if (!auth.ok) return { data: null, error: auth.error }
  const tenantId = await getCurrentTenantId()
  const f = normalizeFilter(filter)
  let q = createServiceClient().from('issued_documents').select(SUMMARY_COLUMNS).eq('tenant_id', tenantId)
  if (f.kind) q = q.eq('kind', f.kind)
  if (f.dateFrom) q = q.gte('document_date', f.dateFrom)
  if (f.dateTo) q = q.lte('document_date', f.dateTo)
  // ⚠️ ilike のワイルドカード文字（% _）はユーザー入力としてそのまま通す（検索意図として許容）
  if (f.party) q = q.ilike('party_name', `%${f.party}%`)
  if (f.minAmount !== null) q = q.gte('total_amount', f.minAmount)
  if (f.maxAmount !== null) q = q.lte('total_amount', f.maxAmount)
  if (!f.includeCancelled) q = q.eq('status', 'issued')
  const { data, error } = await q.order('issued_at', { ascending: false }).limit(200)
  if (error) return { data: null, error: error.message }
  return { data: (data as Row[]).map(toSummary), error: null }
}

export async function getIssuedDocument(id: string): Promise<ActionResult<IssuedDocumentDetail>> {
  const auth = await requireAuth()
  if (!auth.ok) return { data: null, error: auth.error }
  const tenantId = await getCurrentTenantId()
  const { data, error } = await createServiceClient()
    .from('issued_documents').select(`${SUMMARY_COLUMNS}, contractor_id, snapshot`)
    .eq('tenant_id', tenantId).eq('id', id).maybeSingle()
  if (error) return { data: null, error: error.message }
  if (!data) return { data: null, error: '控えが見つかりません' }
  // ドライバーは自分宛ての支払通知書の控えだけ
  if (!auth.ctx.isOwner) {
    if (data.kind !== 'payment_notice' || !auth.ctx.contractorId || data.contractor_id !== auth.ctx.contractorId) {
      return { data: null, error: '権限がありません' }
    }
  }
  return { data: { ...toSummary(data as unknown as Row), snapshot: data.snapshot }, error: null }
}

export async function getActiveIssuedDocumentForSource(kind: DocumentKind, sourceId: string): Promise<ActionResult<IssuedDocumentSummary | null>> {
  const auth = await requireOwner()
  if (!auth.ok) return { data: null, error: auth.error }
  const tenantId = await getCurrentTenantId()
  const { data, error } = await createServiceClient()
    .from('issued_documents').select(SUMMARY_COLUMNS)
    .eq('tenant_id', tenantId).eq('kind', kind).eq('source_id', sourceId).eq('status', 'issued').maybeSingle()
  if (error) return { data: null, error: error.message }
  return { data: data ? toSummary(data as Row) : null, error: null }
}
