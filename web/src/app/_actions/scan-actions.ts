'use server'

import { createClient }        from '@/utils/supabase/server'
import { createServiceClient } from '@/utils/supabase/service'
import { requireOwner }        from '@/utils/auth'
import { getCurrentTenantId }  from '@/utils/tenant'
import { writeInvoice }        from '@/utils/invoice-writer'
import { invoiceLockError }    from '@/utils/invoice-lock'

type ActionResult<T = void> =
  | { data: T;    error: null   }
  | { data: null; error: string }

// ── 委託先プルダウン用 ────────────────────────────────────

export type ContractorOption = { id: string; name: string }

export async function fetchContractorOptions(): Promise<ActionResult<ContractorOption[]>> {
  const tenantId = await getCurrentTenantId()
  const supabase = await createClient()
  const { data: { user }, error: authErr } = await supabase.auth.getUser()
  if (authErr || !user) return { data: null, error: '認証が必要です' }
  const __owner = await requireOwner()
  if (!__owner.ok) return { data: null, error: __owner.error }

  const service = createServiceClient()
  const { data, error } = await service
    .from('contractors')
    .select('id, name')
    .eq('tenant_id', tenantId)
    .order('name')

  if (error) return { data: null, error: error.message }
  return { data: (data ?? []) as ContractorOption[], error: null }
}

// ── 荷主プルダウン用（IN スキャン） ──────────────────────

export type ClientOption = { id: string; company_name: string }

export async function fetchClientOptionsForScan(): Promise<ActionResult<ClientOption[]>> {
  const tenantId = await getCurrentTenantId()
  const supabase = await createClient()
  const { data: { user }, error: authErr } = await supabase.auth.getUser()
  if (authErr || !user) return { data: null, error: '認証が必要です' }
  const __owner = await requireOwner()
  if (!__owner.ok) return { data: null, error: __owner.error }

  const service = createServiceClient()
  const { data, error } = await service
    .from('clients')
    .select('id, company_name')
    .eq('tenant_id', tenantId)
    .order('company_name')

  if (error) return { data: null, error: error.message }
  return { data: (data ?? []) as ClientOption[], error: null }
}

// ── AI解析結果をinvoicesへ確定保存（IN スキャン） ─────────

export type ClientScanSaveParams = {
  clientId:           string
  issuerName:         string
  registrationNumber: string
  invoiceDate:        string   // YYYY-MM-DD
  subtotal:           number   // 税抜合計
  taxAmount:          number   // 消費税額
  jobId?:             string | null
}

export async function saveClientScanResult(
  params: ClientScanSaveParams,
): Promise<ActionResult<{ id: string }>> {
  const tenantId = await getCurrentTenantId()
  const supabase = await createClient()
  const { data: { user }, error: authErr } = await supabase.auth.getUser()
  if (authErr || !user) return { data: null, error: '認証が必要です' }
  const __owner = await requireOwner()
  if (!__owner.ok) return { data: null, error: __owner.error }

  const service = createServiceClient()

  // ⚠️ 従来は素の insert だったため、同一荷主・同一月の 2 枚目をスキャンすると
  //    23505 duplicate key で失敗していた（B-2）。
  //    2026-07-28 に UNIQUE(client_id, invoice_month) を追加したことで顕在化した。
  //    共通ライタの SELECT→UPDATE/INSERT へ移行して解消する。
  // ⚠️ 挙動: 同一荷主・同一月の 2 枚目は 1 枚目を「上書き」する（draft 同士に限る）。
  //    スキャンは 1 荷主 1 月 1 枚が前提であるという判断に基づく。
  //    ただし issued / paid まで進んだ請求書を無警告で下書きに戻すのは事故なので、
  //    その場合だけ止める（2026-07-31 の上書き事故と同種のガード）。
  const yearMonth = params.invoiceDate.slice(0, 7)
  const monthDate = `${yearMonth}-01`
  const { data: existing } = await service
    .from('invoices')
    .select('status')
    .eq('client_id', params.clientId)
    .eq('invoice_month', monthDate)
    .eq('tenant_id', tenantId)
    .is('department_id', null)   // Task 11 で部署対応を入れる
    .maybeSingle()

  const lockErr = invoiceLockError(existing)
  if (lockErr) return { data: null, error: lockErr }

  const { id, error: writeErr } = await writeInvoice(service, {
    clientId:     params.clientId,
    departmentId: null,          // Task 11 で部署対応を入れる
    yearMonth,
    subtotal:     params.subtotal,
    taxAmount:    params.taxAmount,
    totalAmount:  params.subtotal + params.taxAmount,
    status:       'draft',
    dueDate:      null,
    issuedAt:     null,
    tenantId:     tenantId,
  })

  if (writeErr || !id) {
    return { data: null, error: writeErr ?? '保存に失敗しました' }
  }

  return { data: { id }, error: null }
}

// ── AI解析結果をwork_recordsへ確定保存 ───────────────────

export type ScanSaveParams = {
  contractorId:       string
  issuerName:         string
  registrationNumber: string
  invoiceDate:        string   // YYYY-MM-DD
  subtotal:           number   // 税抜合計
  taxAmount:          number   // 消費税額
  jobId?:             string | null
}

export async function saveScanResult(
  params: ScanSaveParams,
): Promise<ActionResult<{ id: string }>> {
  const tenantId = await getCurrentTenantId()
  const supabase = await createClient()
  const { data: { user }, error: authErr } = await supabase.auth.getUser()
  if (authErr || !user) return { data: null, error: '認証が必要です' }
  const __owner = await requireOwner()
  if (!__owner.ok) return { data: null, error: __owner.error }

  const service = createServiceClient()

  // metadata は生成型に含まれないため any キャスト（scan-voice-bridge.ts と同方針）
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: record, error: insertErr } = await (service as any)
    .from('work_records')
    .insert({
      contractor_id:        params.contractorId,
      work_date:            params.invoiceDate,
      // ⚠️ `tax_excluded_payment` と `memo` は work_records に存在しない列で、
      //    この INSERT は 42703 で必ず失敗していた（2026-08-02 修正）。
      //    金額は metadata['scan::subtotal'] に入るため情報は失われない。備考列は `note`。
      note:                 `[AI SCAN] ${params.issuerName}`,
      tenant_id:            tenantId,
      metadata: {
        'scan::issuer_name':   params.issuerName,
        'scan::reg_number':    params.registrationNumber,
        'scan::invoice_date':  params.invoiceDate,
        'scan::subtotal':      params.subtotal,
        'scan::tax_amount':    params.taxAmount,
        'scan::job_id':        params.jobId ?? null,
        'scan::confirmed_at':  new Date().toISOString(),
      },
    })
    .select('id')
    .single() as { data: Record<string, unknown> | null; error: { message: string } | null }

  if (insertErr || !record) {
    return { data: null, error: insertErr?.message ?? '保存に失敗しました' }
  }

  return { data: { id: record['id'] as string }, error: null }
}
