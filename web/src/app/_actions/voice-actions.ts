'use server'

import {
  GoogleGenerativeAI,
  SchemaType,
  type ResponseSchema,
} from '@google/generative-ai'
import { createClient }        from '@/utils/supabase/server'
import { createServiceClient } from '@/utils/supabase/service'
import { requireAuth }         from '@/utils/auth'

// ── 公開型 ────────────────────────────────────────────────

export interface VoiceIntentResult {
  intent:      'navigate' | 'add_expense' | 'unknown'
  targetUrl?:  '/admin/sales' | '/driver/dashboard' | '/admin/contractors'
  expenseData?: {
    category: 'highway' | 'parking' | 'fuel'
    amount:   number
  }
  replyMessage: string
}

export type ExpenseSaveParams = {
  contractorId: string
  category:     'highway' | 'parking' | 'fuel'
  amount:       number   // 税込実費
  date:         string   // YYYY-MM-DD
}

// ── Gemini 設定 ───────────────────────────────────────────

const MODEL = 'gemini-2.5-flash'

const RESPONSE_SCHEMA: ResponseSchema = {
  type: SchemaType.OBJECT,
  properties: {
    intent: {
      type:        SchemaType.STRING,
      description: '"navigate" | "add_expense" | "unknown"',
      nullable:    false,
    },
    targetUrl: {
      type:        SchemaType.STRING,
      description:
        '"/admin/sales" | "/driver/dashboard" | "/admin/contractors" — ' +
        'intent が navigate のときのみ設定。それ以外は null',
      nullable: true,
    },
    expenseData: {
      type:     SchemaType.OBJECT,
      nullable: true,
      properties: {
        category: {
          type:        SchemaType.STRING,
          description: '"highway" | "parking" | "fuel"',
          nullable:    false,
        },
        amount: {
          type:        SchemaType.NUMBER,
          description: '金額（整数・円）',
          nullable:    false,
        },
      },
      required: ['category', 'amount'],
    },
    replyMessage: {
      type:        SchemaType.STRING,
      description: 'ユーザーへの日本語応答（1〜2文）',
      nullable:    false,
    },
  },
  required: ['intent', 'replyMessage'],
}

const SYSTEM_PROMPT = `あなたは日本の運送業向け音声アシスタント「響き（HIBIKI）」です。
ユーザーの発話テキストを解析し、以下のルールで必ずJSON形式のインテントを返してください。

【インテント判定ルール】

■ intent = "navigate"（画面遷移）
・「売上管理」「請求書」「売上を見る」「請求を確認」  → targetUrl: "/admin/sales"
・「ダッシュボード」「ホーム」「トップ」「案件一覧」「案件を見る」→ targetUrl: "/driver/dashboard"
・「取引先」「荷主」「得意先一覧」「委託先一覧」「ドライバー一覧」→ targetUrl: "/admin/contractors"

■ intent = "add_expense"（立替金・経費入力）
・「高速」「ETC」「有料道路」「圏央道」「首都高」→ category: "highway"
・「駐車」「パーキング」「コインパーキング」       → category: "parking"
・「ガソリン」「燃料」「給油」「軽油」             → category: "fuel"
・金額を発話から整数で抽出（「3,500円」→ 3500、「3500」→ 3500）

■ intent = "unknown"
・上記どちらにも当てはまらない場合

【replyMessage 生成ルール】
・"navigate"  → 「{ページ名}へ移動します！」
・"add_expense"→ 「{種別}の¥{金額}を記録する準備ができました！」
・"unknown"   → 「申し訳ありません、もう一度はっきりお話しください。」
・必ず日本語・1〜2文で返す

発話：`

// ── Server Action: parseVoiceIntent ──────────────────────

export async function parseVoiceIntent(
  transcript: string,
): Promise<VoiceIntentResult> {
  // 認証必須（未ログインからの Gemini API 消費を防止）
  const auth = await requireAuth()
  if (!auth.ok) {
    return { intent: 'unknown', replyMessage: '音声機能の利用にはログインが必要です。' }
  }

  const apiKey = process.env.GEMINI_API_KEY
  if (!apiKey) {
    return {
      intent:       'unknown',
      replyMessage: 'AI音声解析サービスが利用できません（APIキー未設定）。',
    }
  }

  try {
    const genAI = new GoogleGenerativeAI(apiKey)
    const model = genAI.getGenerativeModel({
      model: MODEL,
      generationConfig: {
        responseMimeType: 'application/json',
        responseSchema:   RESPONSE_SCHEMA,
      },
    })

    const result = await model.generateContent(`${SYSTEM_PROMPT}「${transcript}」`)
    const raw    = result.response.text()
    const data   = JSON.parse(raw) as VoiceIntentResult

    // 型安全化
    if (!['navigate', 'add_expense', 'unknown'].includes(data.intent)) {
      data.intent = 'unknown'
    }
    if (data.intent === 'add_expense' && data.expenseData) {
      data.expenseData.amount = Math.round(Number(data.expenseData.amount) || 0)
      if (!['highway', 'parking', 'fuel'].includes(data.expenseData.category)) {
        data.intent = 'unknown'
      }
    }
    if (data.intent === 'navigate') {
      const VALID_URLS = ['/admin/sales', '/driver/dashboard', '/admin/contractors']
      if (!data.targetUrl || !VALID_URLS.includes(data.targetUrl)) {
        data.intent = 'unknown'
      }
    }

    return data
  } catch {
    return {
      intent:       'unknown',
      replyMessage: 'AI解析中にエラーが発生しました。もう一度お試しください。',
    }
  }
}

// ── Server Action: saveVoiceExpense ───────────────────────

const CATEGORY_TO_TYPE: Record<string, string> = {
  highway: 'toll',
  parking: 'parking',
  fuel:    'fuel',
}

const CATEGORY_LABEL: Record<string, string> = {
  highway: '高速道路料金',
  parking: '駐車場代',
  fuel:    '燃料費補助',
}

export async function saveVoiceExpense(
  params: ExpenseSaveParams,
): Promise<{ error: string | null }> {
  const supabase = await createClient()
  const { data: { user }, error: authErr } = await supabase.auth.getUser()
  if (authErr || !user) return { error: '認証が必要です' }

  const service           = createServiceClient()
  const amountTaxExcluded = Math.round(params.amount / 1.1)

  const { error } = await service
    .from('expense_records')
    .insert({
      contractor_id:       params.contractorId,
      expense_date:        params.date,
      expense_type:        CATEGORY_TO_TYPE[params.category] ?? 'other',
      amount_actual:       params.amount,
      amount_tax_excluded: amountTaxExcluded,
      tax_category:        'taxable_10',
      remarks:             `[VOICE] ${CATEGORY_LABEL[params.category] ?? 'その他'}`,
    })

  return { error: error?.message ?? null }
}
