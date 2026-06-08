import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/utils/supabase/server'

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

  const allowedTypes = ['image/png', 'image/jpeg', 'application/pdf',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', 'text/csv']
  if (!allowedTypes.includes(file.type)) {
    return NextResponse.json({ error: 'Unsupported file type' }, { status: 415 })
  }

  const jobId = crypto.randomUUID()

  // TODO: ファイルをSupabase Storageへ保存し、scan_jobsテーブルにINSERTして非同期ワーカーを起動する
  return NextResponse.json({ jobId, status: 'queued' }, { status: 202 })
}
