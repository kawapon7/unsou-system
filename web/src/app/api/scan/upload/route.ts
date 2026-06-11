import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/utils/supabase/server'
import { mergeMetadata } from '@/app/_actions/scan-voice-bridge'

const ALLOWED_TYPES = [
  'image/png',
  'image/jpeg',
  'application/pdf',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'text/csv',
]

export async function POST(req: NextRequest) {
  const supabase = await createClient()
  const { data: { user }, error: authError } = await supabase.auth.getUser()
  if (authError || !user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const formData = await req.formData()
  const file = formData.get('file') as File | null
  if (!file) {
    return NextResponse.json({ error: 'No file provided' }, { status: 400 })
  }
  if (!ALLOWED_TYPES.includes(file.type)) {
    return NextResponse.json({ error: 'Unsupported file type' }, { status: 415 })
  }

  const jobId = crypto.randomUUID()

  // 対象 work_record が指定されていれば初期メタデータを書き込む（非同期・失敗しても202を返す）
  const workRecordId = formData.get('work_record_id')
  if (workRecordId && typeof workRecordId === 'string') {
    mergeMetadata('work_records', workRecordId, {
      'scan::job_id': jobId,
      'scan::status': 'processing',
      'scan::uploaded_at': new Date().toISOString(),
    }).catch(() => {
      // メタデータ書き込み失敗はジョブ受付には影響させない
    })
  }

  // TODO: ファイルをSupabase Storageへ保存し scan_jobs テーブルにINSERTして非同期ワーカーを起動する
  return NextResponse.json({ jobId, status: 'queued' }, { status: 202 })
}
