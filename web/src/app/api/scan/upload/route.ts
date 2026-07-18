import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/utils/supabase/server'
import { createServiceClient } from '@/utils/supabase/service'
import { mergeMetadata } from '@/app/_actions/scan-voice-bridge'
import {
  extractInvoiceData,
  extractInvoiceDataFromSpreadsheet,
  isGeminiSupported,
  isSpreadsheetSupported,
  type ExtractedInvoiceData,
} from '@/utils/scan/aiExtractor'

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
        job_id:          params.jobId,
        user_id:         params.userId,
        status:          params.status,
        file_name:       params.fileName       ?? null,
        file_type:       params.fileType       ?? null,
        work_record_id:  params.workRecordId   ?? null,
        extracted_data:  params.extractedData  ?? null,
        error_message:   params.errorMessage   ?? null,
        updated_at:      new Date().toISOString(),
      },
      { onConflict: 'job_id' },
    )
    .throwOnError()
}

// ── Route Handler ─────────────────────────────────────────

export async function POST(req: NextRequest) {
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

  const jobId        = crypto.randomUUID()
  const workRecordId = formData.get('work_record_id')
  const wrid         = typeof workRecordId === 'string' ? workRecordId : null

  // ── ジョブ受付ログを scan_jobs に INSERT ─────────────
  await upsertScanJob({
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
  await upsertScanJob({ jobId, userId: user.id, status: 'processing', workRecordId: wrid }).catch(() => {})
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

// ── ジョブステータス照会 ──────────────────────────────────

export async function GET(req: NextRequest) {
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
