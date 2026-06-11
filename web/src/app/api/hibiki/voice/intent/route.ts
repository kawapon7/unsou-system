import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/utils/supabase/server'

// VOICE仕様書 §2-4 種別自動判定ルール準拠
const EXPENSE_RULES: { type: string; keywords: string[] }[] = [
  { type: 'toll',    keywords: ['高速', 'ETC', '有料道路', '圏央道', '首都高'] },
  { type: 'parking', keywords: ['駐車', 'パーキング', 'コインパーキング'] },
  { type: 'fuel',    keywords: ['ガソリン', '燃料', '給油'] },
]

// VOICE仕様書 §2-3 勤務記録キーワード
const WORK_RECORD_KEYWORDS = ['稼働', '記録', '業務を登録', '今日の仕事', '勤務']

// VOICE仕様書 §2-1 画面遷移コマンド
const NAVIGATE_KEYWORDS = ['ダッシュボード', 'ホームに戻', '売上管理', '取引先', '委託先', 'ログアウト']

// VOICE仕様書 §2-6 確認・キャンセルコマンド
const CONFIRM_KEYWORDS  = ['登録して', 'はい', '確定して', '送信して']
const CANCEL_KEYWORDS   = ['やっぱりやめて', 'キャンセル', 'やめて']

function detectExpenseType(text: string): string | null {
  for (const rule of EXPENSE_RULES) {
    if (rule.keywords.some((kw) => text.includes(kw))) return rule.type
  }
  // 「立替」「経費」が含まれるが種別不明 → other
  if (text.includes('立替') || text.includes('経費')) return 'other'
  return null
}

function parseIntent(text: string) {
  if (CONFIRM_KEYWORDS.some((kw) => text.includes(kw))) {
    return { intent: 'confirm' }
  }
  if (CANCEL_KEYWORDS.some((kw) => text.includes(kw))) {
    return { intent: 'cancel' }
  }

  const expenseType = detectExpenseType(text)
  if (expenseType) {
    return { intent: 'expense_input', type: expenseType }
  }

  if (WORK_RECORD_KEYWORDS.some((kw) => text.includes(kw))) {
    return { intent: 'work_record_input' }
  }

  if (NAVIGATE_KEYWORDS.some((kw) => text.includes(kw))) {
    return { intent: 'navigate' }
  }

  return { intent: 'unknown' }
}

export async function POST(req: NextRequest) {
  const supabase = await createClient()
  const { data: { user }, error: authError } = await supabase.auth.getUser()
  if (authError || !user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  let body: { text?: unknown }
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
  }

  if (!body.text || typeof body.text !== 'string') {
    return NextResponse.json({ error: 'text is required' }, { status: 400 })
  }

  const result = parseIntent(body.text)
  return NextResponse.json(result, { status: 200 })
}
