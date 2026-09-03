import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/utils/supabase/server'
import { createServiceClient } from '@/utils/supabase/service'
import { getCurrentTenantId } from '@/utils/tenant'
import { mergeMetadata } from '@/app/_actions/scan-voice-bridge'
import {
  extractInvoiceData,
  extractInvoiceDataFromSpreadsheet,
  isGeminiSupported,
  isSpreadsheetSupported,
  type ExtractedInvoiceData,
} from '@/utils/scan/aiExtractor'
import { capturedRoute } from '@/utils/error-monitor/captured'

const ALLOWED_TYPES = [
  'image/png',
  'image/jpeg',
  'application/pdf',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'application/vnd.ms-excel',
  'text/csv',
]

// ── scan_jobs ヘルパー ─────────────────────────────────────

type JobStatus = 'queued' | 'processing' | 'completed' | 'failed'

async function upsertScanJob(params: {
  /** ⚠️ F0で tenant_id の DEFAULT を撤去したため必須。省略すると NOT NULL 違反になる */
  tenantId:       string
  jobId:          string
  userId:         string
  status:         JobStatus
  fileName?:      string
  fileType?:      string
  workRecordId?:  string | null
  extractedData?: ExtractedInvoiceData | null
  errorMessage?:  string | null
}) {
  const service = createServiceClient()
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  await (service as any)
    .from('scan_jobs')
    .upsert(
      {
        tenant_id:       params.tenantId,
        job_id:          params.jobId,
        user_id:         params.userId,
        status:          params.status,
        // ⚠️ 渡されなかった項目は「キーごと省く」。`?? null` で埋めてはならない。
        //    このヘルパーは onConflict: 'job_id' の upsert を同一ジョブに対して
        //    queued → processing → completed と 3 回叩く。null を書くと、最初の
        //    queued で入れた file_name / file_type を後続が NULL で上書きしてしまい、
        //    取り込み履歴から「どのファイルを読んだのか」が消える（2026-08-17 実測で発覚）。
        ...(params.fileName      !== undefined && { file_name:      params.fileName }),
        ...(params.fileType      !== undefined && { file_type:      params.fileType }),
        ...(params.workRecordId  !== undefined && { work_record_id: params.workRecordId }),
        ...(params.extractedData !== undefined && { extracted_data: params.extractedData }),
        ...(params.errorMessage  !== undefined && { error_message:  params.errorMessage }),
        updated_at:      new Date().toISOString(),
      },
      { onConflict: 'job_id' },
    )
    .throwOnError()
}

// ── Route Handler ─────────────────────────────────────────

async function handlePost(req: NextRequest) {
  // ── 認証チェック ──────────────────────────────────────
  const supabase = await createClient()
  const { data: { user }, error: authError } = await supabase.auth.getUser()
  if (authError || !user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  // ── リクエスト解析 ────────────────────────────────────
  const formData = await req.formData()
  const file     = formData.get('file') as File | null
  if (!file) {
    return NextResponse.json({ error: 'No file provided' }, { status: 400 })
  }
  if (!ALLOWED_TYPES.includes(file.type)) {
    return NextResponse.json({ error: 'Unsupported file type' }, { status: 415 })
  }

  const tenantId     = await getCurrentTenantId()
  const jobId        = crypto.randomUUID()
  const workRecordId = formData.get('work_record_id')
  const wrid         = typeof workRecordId === 'string' ? workRecordId : null

  // ── ジョブ受付ログを scan_jobs に INSERT ─────────────
  await upsertScanJob({
    tenantId,
    jobId,
    userId:        user.id,
    status:        'queued',
    fileName:      file.name,
    fileType:      file.type,
    workRecordId:  wrid,
  }).catch(() => { /* scan_jobs テーブル未適用環境でも続行 */ })

  // ── どちらの抽出経路にも該当しない形式は queued のまま返却 ──
  if (!isGeminiSupported(file.type) && !isSpreadsheetSupported(file.type)) {
    if (wrid) {
      mergeMetadata('work_records', wrid, {
        'scan::job_id':       jobId,
        'scan::status':       'queued',
        'scan::uploaded_at':  new Date().toISOString(),
        'scan::file_type':    file.type,
      }).catch(() => {})
    }
    return NextResponse.json({ jobId, status: 'queued' }, { status: 202 })
  }

  // ── Gemini 1.5 Flash による同期処理 ─────────────────

  // 処理開始ステータスを記録
  await upsertScanJob({ tenantId, jobId, userId: user.id, status: 'processing', workRecordId: wrid }).catch(() => {})
  if (wrid) {
    mergeMetadata('work_records', wrid, {
      'scan::job_id':      jobId,
      'scan::status':      'processing',
      'scan::uploaded_at': new Date().toISOString(),
    }).catch(() => {})
  }

  try {
    const fileBuffer = Buffer.from(await file.arrayBuffer())
    const extracted  = isGeminiSupported(file.type)
      ? await extractInvoiceData(fileBuffer, file.type)
      : await extractInvoiceDataFromSpreadsheet(fileBuffer)

    // ── 成功: scan_jobs と metadata に結果を保存 ─────────
    await upsertScanJob({
      tenantId,
      jobId,
      userId:       user.id,
      status:       'completed',
      workRecordId: wrid,
      extractedData: extracted,
    }).catch(() => {})

    if (wrid) {
      await mergeMetadata('work_records', wrid, {
        'scan::job_id':        jobId,
        'scan::status':        'completed',
        'scan::processed_at':  new Date().toISOString(),
        'scan::extracted':     extracted,
        // クイックアクセス用フラット化フィールド
        'scan::issuer_name':   extracted.issuerName,
        'scan::invoice_date':  extracted.invoiceDate  ?? null,
        'scan::subtotal':      extracted.subtotal,
        'scan::tax_amount':    extracted.taxAmount,
        'scan::reg_number':    extracted.registrationNumber,
        'scan::invoice_no':    extracted.invoiceNumber ?? null,
        'scan::due_date':      extracted.dueDate       ?? null,
      })
    }

    return NextResponse.json(
      { jobId, status: 'completed', data: extracted },
      { status: 200 },
    )
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)

    await upsertScanJob({
      tenantId,
      jobId,
      userId:       user.id,
      status:       'failed',
      workRecordId: wrid,
      errorMessage: message,
    }).catch(() => {})

    if (wrid) {
      mergeMetadata('work_records', wrid, {
        'scan::job_id':    jobId,
        'scan::status':    'failed',
        'scan::error':     message,
        'scan::failed_at': new Date().toISOString(),
      }).catch(() => {})
    }

    return NextResponse.json(
      { jobId, status: 'failed', error: message },
      { status: 502 },
    )
  }
}

export const POST = capturedRoute('scan/upload:POST', handlePost)

// ── ジョブステータス照会 ──────────────────────────────────

async function handleGet(req: NextRequest) {
  const supabase = await createClient()
  const { data: { user }, error: authError } = await supabase.auth.getUser()
  if (authError || !user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const jobId = req.nextUrl.searchParams.get('jobId')
  if (!jobId) {
    return NextResponse.json({ error: 'jobId is required' }, { status: 400 })
  }

  const service = createServiceClient()
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data, error } = await (service as any)
    .from('scan_jobs')
    .select('job_id, status, extracted_data, error_message, created_at, updated_at')
    .eq('job_id', jobId)
    .eq('user_id', user.id)
    .single() as { data: Record<string, unknown> | null; error: unknown }

  if (error || !data) {
    return NextResponse.json({ error: 'Job not found' }, { status: 404 })
  }

  return NextResponse.json({
    jobId:     data['job_id'],
    status:    data['status'],
    data:      data['extracted_data'],
    error:     data['error_message'],
    createdAt: data['created_at'],
    updatedAt: data['updated_at'],
  })
}

export const GET = capturedRoute('scan/upload:GET', handleGet)
