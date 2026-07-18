/**
 * AIExtractor — Gemini 1.5 Flash による請求書構造化抽出アダプター
 *
 * モデル換装はこのファイルの MODEL 定数1行を変更するだけで完結する。
 * SCAN仕様書 §3-2 「換装設計」準拠。
 */

import {
  GoogleGenerativeAI,
  SchemaType,
  type ResponseSchema,
} from '@google/generative-ai'
import * as XLSX from 'xlsx'

// ── モデル設定（1行換装ポイント） ──────────────────────────
const MODEL = 'gemini-2.5-flash'

// ── 抽出データ型定義 ─────────────────────────────────────

/** 請求書から抽出する構造化データ（仕様書 §3-3 + 実装指示書スキーマ） */
export interface ExtractedInvoiceData {
  // 必須フィールド（実装指示書スキーマ）
  issuerName:         string    // 荷主・発行元名
  invoiceDate:        string    // 発行日 (YYYY-MM-DD)
  subtotal:           number    // 税抜金額合計
  taxAmount:          number    // 消費税額
  registrationNumber: string    // 適格請求書登録番号 (T+13桁, 不明なら空文字)
  items: {
    name:   string              // 品目・案件名
    amount: number              // 金額（税抜）
  }[]
  // 追加フィールド（SCAN仕様書 §3-3 拡張）
  invoiceNumber?:   string | null  // 請求書番号
  dueDate?:         string | null  // 支払期限 (YYYY-MM-DD)
  totalAmount?:     number | null  // 税込合計
  issuerPhone?:     string | null  // 発行者電話番号
  notes?:           string | null  // 備考・振込先等
}

// ── Gemini レスポンススキーマ ─────────────────────────────

const RESPONSE_SCHEMA: ResponseSchema = {
  type: SchemaType.OBJECT,
  properties: {
    issuerName: {
      type: SchemaType.STRING,
      description: '請求書発行者の会社名・屋号。不明な場合は「不明」',
      nullable: false,
    },
    invoiceDate: {
      type: SchemaType.STRING,
      description: '発行日（YYYY-MM-DD形式）。不明な場合はnull',
      nullable: true,
    },
    subtotal: {
      type: SchemaType.NUMBER,
      description: '税抜き金額の合計（整数・円）',
      nullable: false,
    },
    taxAmount: {
      type: SchemaType.NUMBER,
      description: '消費税額合計（整数・円）。記載なき場合はsubtotal×0.1四捨五入',
      nullable: false,
    },
    registrationNumber: {
      type: SchemaType.STRING,
      description: 'T+13桁の適格請求書発行事業者登録番号。記載なければ空文字',
      nullable: false,
    },
    items: {
      type: SchemaType.ARRAY,
      description: '請求明細行',
      items: {
        type: SchemaType.OBJECT,
        properties: {
          name:   { type: SchemaType.STRING, description: '品目・案件名', nullable: false },
          amount: { type: SchemaType.NUMBER, description: '税抜金額（整数・円）', nullable: false },
        },
        required: ['name', 'amount'],
      },
    },
    invoiceNumber: {
      type: SchemaType.STRING,
      description: '請求書番号・伝票番号。記載なければnull',
      nullable: true,
    },
    dueDate: {
      type: SchemaType.STRING,
      description: '支払期限（YYYY-MM-DD形式）。記載なければnull',
      nullable: true,
    },
    totalAmount: {
      type: SchemaType.NUMBER,
      description: '税込合計金額（整数・円）',
      nullable: true,
    },
    issuerPhone: {
      type: SchemaType.STRING,
      description: '発行者の電話番号。記載なければnull',
      nullable: true,
    },
    notes: {
      type: SchemaType.STRING,
      description: '備考・振込先・特記事項など。記載なければnull',
      nullable: true,
    },
  },
  required: ['issuerName', 'subtotal', 'taxAmount', 'registrationNumber', 'items'],
}

// ── プロンプト ────────────────────────────────────────────

const EXTRACTION_PROMPT = `あなたは日本の運送業向け請求書OCR専門AIです。
添付のファイル（請求書の画像またはPDF）を精密に解析し、指定のJSONスキーマに厳密に従って情報を抽出してください。

【抽出ルール】
- issuerName: 請求書の発行者（会社名・屋号）。不明な場合は「不明」とする
- invoiceDate: 発行日をYYYY-MM-DD形式で。不明・非記載ならnull
- subtotal: すべての品目の税抜き金額合計（整数）
- taxAmount: 消費税額合計（整数）。記載がない場合は subtotal × 0.1 の四捨五入値
- registrationNumber: 「T」で始まる14文字（T+13桁数字）の登録番号。記載なければ空文字「」
- items: 各明細行を1件ずつ配列に。最低1件は必須
- dueDate: 支払期限日。記載なければnull
- totalAmount: 税込合計金額。記載なければ subtotal + taxAmount の値
- issuerPhone: 発行者電話番号。記載なければnull
- notes: 振込先情報や備考。記載なければnull

【重要な注意事項】
- すべての金額はカンマ・円マーク（¥）を除いた純粋な整数として出力すること
- 税込金額を誤って subtotal に入れないこと。必ず税抜きで抽出すること
- 登録番号はT+13桁の形式。「登録番号」「適格」「T-」などのラベルを手がかりに探すこと`

// ── Gemini でサポートされる MIME タイプ ──────────────────

export const GEMINI_SUPPORTED_MIME_TYPES = [
  'image/png',
  'image/jpeg',
  'image/gif',
  'image/webp',
  'application/pdf',
] as const

export type GeminiSupportedMimeType = typeof GEMINI_SUPPORTED_MIME_TYPES[number]

export function isGeminiSupported(mimeType: string): mimeType is GeminiSupportedMimeType {
  return (GEMINI_SUPPORTED_MIME_TYPES as readonly string[]).includes(mimeType)
}

// ── 表形式ファイル（Excel/CSV）でサポートされる MIME タイプ ──

export const SPREADSHEET_SUPPORTED_MIME_TYPES = [
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', // .xlsx
  'application/vnd.ms-excel', // .xls
  'text/csv',
] as const

export type SpreadsheetSupportedMimeType = typeof SPREADSHEET_SUPPORTED_MIME_TYPES[number]

export function isSpreadsheetSupported(mimeType: string): mimeType is SpreadsheetSupportedMimeType {
  return (SPREADSHEET_SUPPORTED_MIME_TYPES as readonly string[]).includes(mimeType)
}

// ── メイン抽出関数 ────────────────────────────────────────

/**
 * ファイルバッファを Gemini 1.5 Flash に送り、請求書データを構造化抽出する。
 * AI換装時はこの関数のみ変更する。
 *
 * @throws GEMINI_API_KEY 未設定の場合、またはAPI呼び出し失敗時
 */
export async function extractInvoiceData(
  fileBuffer: Buffer,
  mimeType: GeminiSupportedMimeType,
): Promise<ExtractedInvoiceData> {
  const apiKey = process.env.GEMINI_API_KEY
  if (!apiKey) {
    throw new Error('環境変数 GEMINI_API_KEY が設定されていません')
  }

  const genAI = new GoogleGenerativeAI(apiKey)
  const model = genAI.getGenerativeModel({
    model: MODEL,
    generationConfig: {
      responseMimeType: 'application/json',
      responseSchema: RESPONSE_SCHEMA,
    },
  })

  const result = await model.generateContent([
    {
      inlineData: {
        data:     fileBuffer.toString('base64'),
        mimeType: mimeType,
      },
    },
    EXTRACTION_PROMPT,
  ])

  return parseExtractionResult(result.response.text())
}

// ── 表形式ファイル（Excel/CSV）→ テキスト変換 ─────────────────

/**
 * xlsx/xls/csv バッファを、Gemini に渡すためのプレーンテキスト（CSV相当）に変換する。
 * 先頭シートのみを対象とする（請求書1件=1ブック/1シート運用を想定）。
 */
function spreadsheetToText(fileBuffer: Buffer): string {
  const workbook  = XLSX.read(fileBuffer, { type: 'buffer' })
  const sheetName = workbook.SheetNames[0]
  if (!sheetName) {
    throw new Error('スプレッドシートにシートが見つかりません')
  }
  const sheet = workbook.Sheets[sheetName]
  return XLSX.utils.sheet_to_csv(sheet)
}

const SPREADSHEET_EXTRACTION_PROMPT = `あなたは日本の運送業向け請求書データ抽出専門AIです。
以下はExcel/CSVファイルから変換したCSVテキストです（請求書または明細一覧）。
内容を精密に解析し、指定のJSONスキーマに厳密に従って情報を抽出してください。

【抽出ルール】
- issuerName: 発行者（会社名・屋号）。列見出しや先頭行から判断。不明な場合は「不明」とする
- invoiceDate: 発行日をYYYY-MM-DD形式で。不明・非記載ならnull
- subtotal: すべての品目の税抜き金額合計（整数）
- taxAmount: 消費税額合計（整数）。記載がない場合は subtotal × 0.1 の四捨五入値
- registrationNumber: 「T」で始まる14文字（T+13桁数字）の登録番号。記載なければ空文字「」
- items: 各明細行を1件ずつ配列に。最低1件は必須（合計行・小計行は含めない）
- dueDate: 支払期限日。記載なければnull
- totalAmount: 税込合計金額。記載なければ subtotal + taxAmount の値
- issuerPhone: 発行者電話番号。記載なければnull
- notes: 振込先情報や備考。記載なければnull

【重要な注意事項】
- すべての金額はカンマ・円マーク（¥）を除いた純粋な整数として出力すること
- 税込金額を誤って subtotal に入れないこと。必ず税抜きで抽出すること
- CSVの空セルは無視し、意味のある行のみを items に含めること

--- CSVデータ ---
`

/**
 * xlsx/xls/csv ファイルを Gemini 1.5 Flash に送り、請求書データを構造化抽出する。
 * バイナリ添付ではなく、CSVテキスト化した内容をプロンプトとして送信する。
 *
 * @throws GEMINI_API_KEY 未設定の場合、またはAPI呼び出し失敗時
 */
export async function extractInvoiceDataFromSpreadsheet(
  fileBuffer: Buffer,
): Promise<ExtractedInvoiceData> {
  const apiKey = process.env.GEMINI_API_KEY
  if (!apiKey) {
    throw new Error('環境変数 GEMINI_API_KEY が設定されていません')
  }

  const csvText = spreadsheetToText(fileBuffer)
  if (!csvText.trim()) {
    throw new Error('スプレッドシートに読み取れるデータがありません')
  }

  const genAI = new GoogleGenerativeAI(apiKey)
  const model = genAI.getGenerativeModel({
    model: MODEL,
    generationConfig: {
      responseMimeType: 'application/json',
      responseSchema: RESPONSE_SCHEMA,
    },
  })

  const result = await model.generateContent([
    SPREADSHEET_EXTRACTION_PROMPT + csvText,
  ])

  return parseExtractionResult(result.response.text())
}

// ── 共通レスポンス整形 ────────────────────────────────────────

function parseExtractionResult(raw: string): ExtractedInvoiceData {
  const data = JSON.parse(raw) as ExtractedInvoiceData

  // 数値フィールドを確実に整数化（Gemini が小数を返す場合があるため）
  data.subtotal   = Math.round(data.subtotal)
  data.taxAmount  = Math.round(data.taxAmount)
  if (data.totalAmount != null) {
    data.totalAmount = Math.round(data.totalAmount)
  }
  if (Array.isArray(data.items)) {
    data.items = data.items.map(item => ({ ...item, amount: Math.round(item.amount) }))
  }

  return data
}
