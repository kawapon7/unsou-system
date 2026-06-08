import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/utils/supabase/server'

interface IntentRequest {
  text: string
}

export async function POST(req: NextRequest) {
  const supabase = await createClient()
  const { data: { user }, error: authError } = await supabase.auth.getUser()

  if (authError || !user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const body = await req.json() as IntentRequest
  if (!body.text || typeof body.text !== 'string') {
    return NextResponse.json({ error: 'text is required' }, { status: 400 })
  }

  // TODO: サーバーサイドNLP補助ロジックを実装する（必要時のみ。基本はクライアントサイドのキーワードマッチで完結）
  return NextResponse.json({ intent: null, message: 'NLP processing not yet implemented' }, { status: 200 })
}
