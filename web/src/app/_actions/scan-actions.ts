'use server'

import { createClient }        from '@/utils/supabase/server'
import { createServiceClient } from '@/utils/supabase/service'
import { getCurrentTenantId }  from '@/utils/tenant'

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

  const invoiceMonth = `${params.invoiceDate.slice(0, 7)}-01`
  const service = createServiceClient()

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: record, error: insertErr } = await (service as any)
    .from('invoices')
    .insert({
      client_id:          params.clientId,
      invoice_month:      invoiceMonth,
      total_tax_excluded: params.subtotal,
      consumption_tax:    params.taxAmount,
      total_amount:       params.subtotal + params.taxAmount,
      status:             'draft',
      tenant_id:          tenantId,
    })
    .select('id')
    .single() as { data: Record<string, unknown> | null; error: { message: string } | null }

  if (insertErr || !record) {
    return { data: null, error: insertErr?.message ?? '保存に失敗しました' }
  }

  return { data: { id: record['id'] as string }, error: null }
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

  const service = createServiceClient()

  // metadata は生成型に含まれないため any キャスト（scan-voice-bridge.ts と同方針）
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: record, error: insertErr } = await (service as any)
    .from('work_records')
    .insert({
      contractor_id:        params.contractorId,
      work_date:            params.invoiceDate,
      tax_excluded_payment: params.subtotal,
      memo:                 `[AI SCAN] ${params.issuerName}`,
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
