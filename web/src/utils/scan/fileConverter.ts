/**
 * fileConverter.ts — Googleフォーム（CSV/スプレッドシート行データ）パース・マスタ照合モジュール
 *
 * 仕様書 v2.0 §C「Googleフォーム緊急避難ルート」準拠。
 * SCANオプション（aiExtractor.ts）と共通インターフェースを持ち、重複実装を排除する。
 *
 * このファイルは純粋関数のみで構成する。データ登録処理（APIコール）は一切含めない。
 */

import type { ExtractedInvoiceData } from './aiExtractor'

// ── 定数 ─────────────────────────────────────────────────────

/** 信頼スコアの閾値。これを下回ると needsManualReview = true になる */
export const TRUST_THRESHOLD = 0.8

// ── 共通型定義（SCANオプション・Googleフォーム共通） ──────────

/** マスタデータのレコード（contractors / projects テーブルの最小表現） */
export interface MasterRecord {
  id:   string
  name: string
}

/**
 * パース済み勤務記録 — 画像/PDFパースとGoogleフォームパース共通の統一インターフェース。
 * SCANオプションの ExtractedInvoiceData は adaptInvoiceToWorkRecords() でこの型に変換する。
 */
export interface ParsedWorkRecord {
  rawDriverName:  string | null  // 入力テキスト原文（ドライバー名）
  rawProjectName: string | null  // 入力テキスト原文（案件名）
  date:           string | null  // YYYY-MM-DD（解析不可の場合 null）
  startTime:      string | null  // HH:MM（解析不可の場合 null）
  endTime:        string | null  // HH:MM（解析不可の場合 null）
  breakMinutes:   number | null  // 休憩時間（分）（解析不可の場合 null）
  quantity:       number | null  // 配達個数
  sourceRow:      number | null  // データ元の行番号（1-indexed、デバッグ用）
}

/** マスタ照合結果（ParsedWorkRecord にマスタ参照と信頼スコアを付与） */
export interface MatchedWorkRecord extends ParsedWorkRecord {
  contractorId:      string | null
  contractorMatch:   string | null  // マッチしたマスタ側の表記
  contractorScore:   number         // 0.000〜1.000
  projectId:         string | null
  projectMatch:      string | null  // マッチしたマスタ側の表記
  projectScore:      number         // 0.000〜1.000
  trustScore:        number         // 合成信頼スコア（算出ルールは matchMasterData を参照）
  needsManualReview: boolean        // trustScore < TRUST_THRESHOLD の場合 true
}

/** 自動認識する列の正規名 */
export type CanonicalColumn =
  | 'driverName'
  | 'date'
  | 'projectName'
  | 'startTime'
  | 'endTime'
  | 'breakMinutes'
  | 'quantity'

/** Googleフォーム CSV/スプレッドシートパース結果 */
export interface GoogleFormParseResult {
  records:     ParsedWorkRecord[]
  columnMap:   Partial<Record<CanonicalColumn, number>>
  parseErrors: string[]
}

/** マスタ照合まとめ結果 */
export interface MasterMatchResult {
  records:     MatchedWorkRecord[]
  matchErrors: string[]
}

// ── 列ヘッダー自動認識 ────────────────────────────────────────

/**
 * 列ヘッダー候補マップ。
 * normalizeStr() で正規化してから照合するため全角・半角・スペースの揺れに対応する。
 */
const COLUMN_ALIASES: Record<CanonicalColumn, string[]> = {
  driverName:   ['ドライバー名', '氏名', '委託先名', '名前', 'ドライバー', '運転手名', '運転手'],
  date:         ['日付', '作業日', '稼働日', '運行日', '日時', '記録日'],
  projectName:  ['案件名', '仕事', '業務', '仕事名', '業務名', '案件', 'プロジェクト名', 'プロジェクト'],
  startTime:    ['開始時間', '開始', '出発時間', '出発', '乗務開始', '開始時刻'],
  endTime:      ['終了時間', '終了', '帰着時間', '帰着', '乗務終了', '終了時刻'],
  breakMinutes: ['休憩時間', '休憩', '休憩(分)', '休憩時間(分)', '休憩（分）', '休憩時間（分）', '休憩分'],
  quantity:     ['個数', '配達個数', '件数', '配達件数', '取扱個数', '数量'],
}

/** 文字列を正規化する（全角英数→半角、スペース除去、小文字化） */
function normalizeStr(s: string): string {
  return s
    .replace(/[！-～]/g, c => String.fromCharCode(c.charCodeAt(0) - 0xfee0))
    .replace(/[　\s]/g, '')
    .toLowerCase()
}

/**
 * ヘッダー行から正規列名 → 列インデックスのマップを構築する。
 * ⚠️ ヘッダーが空または一致する列名がない場合は空オブジェクトを返す。
 *    呼び出し側で必須列の欠損チェックを行うこと。
 */
function buildColumnMap(headers: string[]): Partial<Record<CanonicalColumn, number>> {
  const normalized = headers.map(normalizeStr)
  const result: Partial<Record<CanonicalColumn, number>> = {}

  for (const [canon, aliases] of Object.entries(COLUMN_ALIASES) as [CanonicalColumn, string[]][]) {
    const normAliases = aliases.map(normalizeStr)
    const idx = normalized.findIndex(h => normAliases.includes(h))
    if (idx !== -1) result[canon] = idx
  }

  return result
}

// ── CSVパーサー ───────────────────────────────────────────────

/** RFC 4180 準拠の1行CSVパーサー。Googleフォームのクオートフィールドに対応する */
function parseCsvLine(line: string): string[] {
  const result: string[] = []
  let current = ''
  let inQuotes = false

  for (let i = 0; i < line.length; i++) {
    const ch = line[i]
    if (ch === '"') {
      if (inQuotes && line[i + 1] === '"') {
        current += '"'
        i++  // "" → " のエスケープ処理
      } else {
        inQuotes = !inQuotes
      }
    } else if (ch === ',' && !inQuotes) {
      result.push(current.trim())
      current = ''
    } else {
      current += ch
    }
  }
  result.push(current.trim())
  return result
}

// ── 日付・時刻パーサー ─────────────────────────────────────────

/**
 * 各種形式の日付文字列を YYYY-MM-DD に正規化する。
 * ⚠️ 解析不可能な形式（年なしの「M月D日」等）は null を返す。
 *    呼び出し側でパースエラーとして扱い、手動補正を促すこと。
 */
function parseDate(raw: string): string | null {
  const s = raw.trim()
  if (!s) return null

  // YYYY/MM/DD または YYYY-MM-DD
  let m = s.match(/^(\d{4})[\/\-](\d{1,2})[\/\-](\d{1,2})/)
  if (m) {
    return `${m[1]}-${m[2].padStart(2, '0')}-${m[3].padStart(2, '0')}`
  }

  // MM/DD/YYYY（Googleスプレッドシートの米国形式）
  m = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/)
  if (m) {
    return `${m[3]}-${m[1].padStart(2, '0')}-${m[2].padStart(2, '0')}`
  }

  // ⚠️ M月D日（年が確定できないため null を返す。手動補完が必要）
  if (/^\d{1,2}月\d{1,2}日?$/.test(s)) return null

  return null
}

/**
 * 各種形式の時刻文字列を HH:MM に正規化する。
 * ⚠️ 解析不可能な場合は null を返す。
 */
function parseTime(raw: string): string | null {
  const s = raw.trim()
  if (!s) return null

  // HH:MM または HH:MM:SS
  let m = s.match(/^(\d{1,2}):(\d{2})(?::\d{2})?$/)
  if (m) return `${m[1].padStart(2, '0')}:${m[2]}`

  // H時MM分 または H時MM
  m = s.match(/^(\d{1,2})時(\d{2})分?$/)
  if (m) return `${m[1].padStart(2, '0')}:${m[2]}`

  // H時（分なし）
  m = s.match(/^(\d{1,2})時$/)
  if (m) return `${m[1].padStart(2, '0')}:00`

  return null
}

/**
 * 休憩時間を「分」の整数に変換する。
 * 空文字・"-" は 0（休憩なし）として扱う。
 * ⚠️ 解析不可能な形式の場合は null を返す。
 */
function parseBreakMinutes(raw: string): number | null {
  const s = raw.trim()
  if (!s || s === '-') return 0

  // H:MM 形式（例：1:30 → 90分）
  let m = s.match(/^(\d{1,2}):(\d{2})$/)
  if (m) return parseInt(m[1]) * 60 + parseInt(m[2])

  // ◯時間◯分
  m = s.match(/^(\d+)時間(\d+)分$/)
  if (m) return parseInt(m[1]) * 60 + parseInt(m[2])

  // ◯時間
  m = s.match(/^(\d+)時間$/)
  if (m) return parseInt(m[1]) * 60

  // ◯分
  m = s.match(/^(\d+)分$/)
  if (m) return parseInt(m[1])

  // 純粋な数値（分として解釈）
  const n = parseFloat(s)
  if (!isNaN(n)) return Math.round(n)

  return null
}

// ── ファジーマッチング ─────────────────────────────────────────

/** バイグラム集合を生成する（日本語テキストの類似度計算に適する） */
function bigrams(s: string): Set<string> {
  const set = new Set<string>()
  for (let i = 0; i < s.length - 1; i++) set.add(s.slice(i, i + 2))
  return set
}

/** バイグラム Dice 係数による文字列類似度（0.0〜1.0） */
function bigramSimilarity(a: string, b: string): number {
  if (a === b) return 1.0
  if (a.length <= 1 || b.length <= 1) return b.includes(a) || a.includes(b) ? 0.5 : 0.0
  const ba = bigrams(a)
  const bb = bigrams(b)
  let intersect = 0
  for (const bg of ba) if (bb.has(bg)) intersect++
  return (2 * intersect) / (ba.size + bb.size)
}

/**
 * 入力テキストをマスタレコードリストとファジーマッチングし、最スコア候補とスコアを返す。
 *
 * スコアリング優先順（数値を離散的に区分してデバッグしやすくする）：
 *   1. 正規化完全一致 → 1.000
 *   2. 前方一致（どちらかが他方の前方一致） → 0.900
 *   3. 部分一致（どちらかが他方に含まれる） → 0.750
 *   4. バイグラム Dice 係数（×0.7 で圧縮し上位3階層と区別） → 0.000〜0.700
 *
 * ⚠️ masters が空の場合は { match: null, score: 0 } を返す。
 *    マスタ取得前にこの関数を呼ぶと全行が手動補正対象になるため注意すること。
 */
export function fuzzyMatch(
  input: string,
  masters: MasterRecord[],
): { match: MasterRecord | null; score: number } {
  if (!masters.length || !input.trim()) return { match: null, score: 0 }

  const normInput = normalizeStr(input)
  let bestMatch: MasterRecord | null = null
  let bestScore = -1

  for (const master of masters) {
    const normMaster = normalizeStr(master.name)
    let score: number

    if (normInput === normMaster) {
      score = 1.0
    } else if (normMaster.startsWith(normInput) || normInput.startsWith(normMaster)) {
      score = 0.9
    } else if (normMaster.includes(normInput) || normInput.includes(normMaster)) {
      score = 0.75
    } else {
      score = bigramSimilarity(normInput, normMaster) * 0.7
    }

    if (score > bestScore) {
      bestScore = score
      bestMatch = master
    }
  }

  return {
    match: bestMatch,
    score: Math.round(Math.max(0, bestScore) * 1000) / 1000,
  }
}

// ── メイン公開関数 ────────────────────────────────────────────

/**
 * GoogleフォームエクスポートCSVテキストをパースして ParsedWorkRecord[] を返す。
 *
 * ⚠️ 必須列（driverName / date / projectName）がいずれも検出できない場合、
 *    records は空配列を返す。呼び出し側で parseErrors を必ず確認すること。
 *
 * @param csvText - Googleフォームエクスポートの CSVテキスト全体（改行区切り）
 */
export function parseGoogleFormCsv(csvText: string): GoogleFormParseResult {
  const lines = csvText.split(/\r?\n/).filter(l => l.trim())
  if (lines.length < 2) {
    return {
      records: [],
      columnMap: {},
      parseErrors: ['CSVにヘッダー行またはデータ行が見つかりません'],
    }
  }

  const headers    = parseCsvLine(lines[0])
  const columnMap  = buildColumnMap(headers)
  const parseErrors: string[] = []

  // ⚠️ 3列すべてが検出できない場合は処理を中断する（部分インポートによる欠損データを防ぐ）
  const missing = (['driverName', 'date', 'projectName'] as CanonicalColumn[]).filter(
    c => columnMap[c] === undefined,
  )
  if (missing.length > 0) {
    parseErrors.push(
      `必須列が見つかりません: ${missing.join(', ')} | 検出ヘッダー: ${headers.join(' / ')}`,
    )
    return { records: [], columnMap, parseErrors }
  }

  const records: ParsedWorkRecord[] = []

  for (let i = 1; i < lines.length; i++) {
    const cells = parseCsvLine(lines[i])
    if (cells.every(c => !c)) continue  // 空行スキップ

    const get = (col: CanonicalColumn): string =>
      columnMap[col] !== undefined ? (cells[columnMap[col]!] ?? '').trim() : ''

    const rawDate    = get('date')
    const parsedDate = parseDate(rawDate)
    if (rawDate && !parsedDate) {
      // ⚠️ 日付形式が不明。レコード自体は残すが needsManualReview が true になる
      parseErrors.push(`行 ${i + 1}: 日付「${rawDate}」を解析できません（YYYY/MM/DD 形式を推奨）`)
    }

    const rawBreak     = get('breakMinutes')
    const breakMinutes = rawBreak ? parseBreakMinutes(rawBreak) : 0

    const rawQty  = get('quantity')
    const parsedQty = rawQty ? parseInt(rawQty, 10) : null

    records.push({
      rawDriverName:  get('driverName')  || null,
      rawProjectName: get('projectName') || null,
      date:           parsedDate,
      startTime:      parseTime(get('startTime')),
      endTime:        parseTime(get('endTime')),
      breakMinutes:   breakMinutes,
      quantity:       parsedQty !== null && !isNaN(parsedQty) ? parsedQty : null,
      sourceRow:      i,  // 1-indexed（ヘッダー行 = 0）
    })
  }

  return { records, columnMap, parseErrors }
}

/**
 * Google Sheets API の values.get() レスポンス形式（string[][]）をパースして ParsedWorkRecord[] を返す。
 * 先頭行をヘッダーとして扱う。
 *
 * ⚠️ 必須列（driverName / date / projectName）が検出できない場合、records は空配列を返す。
 */
export function parseGoogleSheetRows(rows: string[][]): GoogleFormParseResult {
  if (rows.length < 2) {
    return {
      records: [],
      columnMap: {},
      parseErrors: ['スプレッドシートにヘッダー行またはデータ行が見つかりません'],
    }
  }

  const headers    = rows[0].map(h => String(h ?? ''))
  const columnMap  = buildColumnMap(headers)
  const parseErrors: string[] = []

  const missing = (['driverName', 'date', 'projectName'] as CanonicalColumn[]).filter(
    c => columnMap[c] === undefined,
  )
  if (missing.length > 0) {
    parseErrors.push(
      `必須列が見つかりません: ${missing.join(', ')} | 検出ヘッダー: ${headers.join(' / ')}`,
    )
    return { records: [], columnMap, parseErrors }
  }

  const records: ParsedWorkRecord[] = []

  for (let i = 1; i < rows.length; i++) {
    const cells = rows[i]
    const get   = (col: CanonicalColumn): string =>
      columnMap[col] !== undefined ? String(cells[columnMap[col]!] ?? '').trim() : ''

    const rawDate    = get('date')
    const parsedDate = parseDate(rawDate)
    if (rawDate && !parsedDate) {
      parseErrors.push(`行 ${i + 1}: 日付「${rawDate}」を解析できません`)
    }

    const rawBreak     = get('breakMinutes')
    const breakMinutes = rawBreak ? parseBreakMinutes(rawBreak) : 0

    const rawQty  = get('quantity')
    const parsedQty = rawQty ? parseInt(rawQty, 10) : null

    records.push({
      rawDriverName:  get('driverName')  || null,
      rawProjectName: get('projectName') || null,
      date:           parsedDate,
      startTime:      parseTime(get('startTime')),
      endTime:        parseTime(get('endTime')),
      breakMinutes:   breakMinutes,
      quantity:       parsedQty !== null && !isNaN(parsedQty) ? parsedQty : null,
      sourceRow:      i,
    })
  }

  return { records, columnMap, parseErrors }
}

/**
 * ParsedWorkRecord[] にマスタ照合を実行し MatchedWorkRecord[] を返す。
 *
 * 信頼スコア算出ルール：
 *   - 両方マッチあり: trustScore = min(contractorScore, projectScore)
 *   - 片方マッチなし: trustScore = 残存スコア × 0.5（片方欠損は大幅減点）
 *
 * ⚠️ contractors / projects が空配列の場合は全行が needsManualReview = true になる。
 *    マスタ取得に失敗した状態でこの関数を呼び出さないこと。
 *
 * @param records     - parseGoogleFormCsv / parseGoogleSheetRows の出力
 * @param contractors - HIBIKIコアAPIから取得した委託先マスタ（{ id, name }[]）
 * @param projects    - HIBIKIコアAPIから取得した案件マスタ（project_name を name にマップ済み）
 */
export function matchMasterData(
  records: ParsedWorkRecord[],
  contractors: MasterRecord[],
  projects: MasterRecord[],
): MasterMatchResult {
  const matchErrors: string[] = []

  const matched: MatchedWorkRecord[] = records.map((rec, idx) => {
    const rowLabel = `行 ${rec.sourceRow ?? idx + 1}`

    // ── ドライバーマッチング ──
    const driverResult = rec.rawDriverName
      ? fuzzyMatch(rec.rawDriverName, contractors)
      : { match: null, score: 0 }

    if (!driverResult.match) {
      // ⚠️ マスタ未照合 → 手動補正が必須。未登録の委託先の可能性を親分に通知すること
      matchErrors.push(
        `${rowLabel}: ドライバー名「${rec.rawDriverName ?? '(空)'}」をマスタに照合できません`,
      )
    }

    // ── 案件マッチング ──
    const projectResult = rec.rawProjectName
      ? fuzzyMatch(rec.rawProjectName, projects)
      : { match: null, score: 0 }

    if (!projectResult.match) {
      // ⚠️ マスタ未照合 → 手動補正が必須。スポット案件としてマスタ化を検討すること
      matchErrors.push(
        `${rowLabel}: 案件名「${rec.rawProjectName ?? '(空)'}」をマスタに照合できません`,
      )
    }

    // ── 信頼スコア算出 ──
    const rawTrust =
      driverResult.match && projectResult.match
        ? Math.min(driverResult.score, projectResult.score)
        : Math.max(driverResult.score, projectResult.score) * 0.5

    const trustScore = Math.round(rawTrust * 1000) / 1000

    return {
      ...rec,
      contractorId:      driverResult.match?.id    ?? null,
      contractorMatch:   driverResult.match?.name  ?? null,
      contractorScore:   driverResult.score,
      projectId:         projectResult.match?.id   ?? null,
      projectMatch:      projectResult.match?.name ?? null,
      projectScore:      projectResult.score,
      trustScore,
      needsManualReview: trustScore < TRUST_THRESHOLD,
    }
  })

  return { records: matched, matchErrors }
}

/**
 * SCANオプション（aiExtractor.ts）の ExtractedInvoiceData を ParsedWorkRecord[] に変換するアダプター。
 * 画像/PDFパスとGoogleフォームパスのインターフェースを統一するためのブリッジ関数。
 * 変換後のレコードをそのまま matchMasterData() に渡すことができる。
 *
 * ⚠️ 請求書データには時刻・個数情報がないため startTime / endTime / breakMinutes / quantity は
 *    すべて null になる。matchMasterData() 実行後に手動補完フィールドを確認すること。
 */
export function adaptInvoiceToWorkRecords(invoice: ExtractedInvoiceData): ParsedWorkRecord[] {
  return invoice.items.map((item, idx) => ({
    rawDriverName:  invoice.issuerName  ?? null,
    rawProjectName: item.name           ?? null,
    date:           invoice.invoiceDate ?? null,
    startTime:      null,  // ⚠️ 請求書データには開始時刻なし
    endTime:        null,  // ⚠️ 請求書データには終了時刻なし
    breakMinutes:   null,  // ⚠️ 請求書データには休憩情報なし
    quantity:       null,  // ⚠️ 請求書データには配達個数なし
    sourceRow:      idx + 1,
  }))
}
