'use client'

import { useCallback, useRef, useState, useTransition } from 'react'
import * as XLSX from 'xlsx'
import {
  validateAndConvert,
  TEMPLATE_HEADERS,
  SHEET_NAMES,
  type ImportFile,
  type RawRow,
  type RowError,
} from '@/utils/partner-import'
import { importPartners, type ImportResult } from '@/app/_actions/partnerImportActions'
import { CATEGORY_STYLES } from '../../nav'

// このシートはマスタ・設定カテゴリ（slate）に属する画面のため配色を揃える
const ACCENT = CATEGORY_STYLES.slate

type Phase = 'idle' | 'parsed' | 'importing' | 'done'

// テンプレート出力・読み込みの対象シート（依存関係の順: 請求先→部署→委託先→案件）
const SHEET_ORDER = ['clients', 'departments', 'contractors', 'projects'] as const

// 記入例（テンプレ3行目。2行目はGUIDE_ROWS）。1列目が「例）」or「※」始まりの行は validateAndConvert 側でスキップされる。
const EXAMPLE_ROWS: Record<(typeof SHEET_ORDER)[number], string[]> = {
  clients: [
    '例）株式会社サンプル商事', '山田太郎', 'yamada@example.com', '03-xxxx-xxxx',
    '月末', '翌月', '15', '外税', 'あり', 'あり',
    '○○銀行', '○○支店', '普通', '1234567', 'カ)サンプルショウジ',
  ],
  departments: [
    '例）株式会社サンプル商事', '東京支店', '鈴木花子', 'suzuki@example.com', '03-xxxx-xxxx',
  ],
  contractors: [
    '例）山田運送', 'yamada-unso@example.com', '090-xxxx-xxxx',
    '月末', '翌月', '15', '振込', '外税', '適格', 'T1234567890123',
    '○○銀行', '○○支店', '普通', '7654321', 'ヤマダ ウンソウ',
  ],
  projects: [
    '例）株式会社サンプル商事', '東京支店', '広島定期便', '輸送系', '山田運送', '15000', '12000',
  ],
}

// 必須/任意ガイド行（2行目・「※」始まり）。1列目が「※」or「例）」始まりの行は
// validateAndConvert 側と同じ基準で非データ行としてスキップされる。
const GUIDE_ROWS: Record<(typeof SHEET_ORDER)[number], string[]> = {
  clients: [
    '※必須', '任意', '任意', '任意',
    '必須（月末 または 1〜28）', '必須（当月/翌月/翌々月/3ヶ月後）', '必須（月末 または 1〜28）', '必須（外税/内税/非課税）',
    '必須（あり/なし）', '必須（あり/なし）',
    '任意', '任意', '任意（普通/当座）', '任意', '任意',
  ],
  departments: [
    '※必須（請求先シートの会社名と一致）', '必須', '任意', '任意', '任意',
  ],
  contractors: [
    '※必須', '必須', '任意',
    '必須（月末 または 1〜28）', '必須（当月/翌月/翌々月/3ヶ月後）', '必須（月末 または 1〜28）', '必須（振込/現金）',
    '必須（外税/内税/非課税）', '必須（適格/免税）', '適格のみ必須（T+13桁）・免税は記入不可',
    '任意', '任意', '任意（普通/当座）', '任意', '任意',
  ],
  projects: [
    '※必須（請求先シートの会社名と一致）', '荷主が「部署を使う=あり」の場合は必須', '必須',
    '必須（輸送系/作業系）', '任意（委託先シートの名前と一致）', '必須（数字のみ）', '任意（数字のみ）',
  ],
}

function isExampleRow(row: RawRow): boolean {
  const first = Object.values(row)[0]
  return typeof first === 'string' && (first.startsWith('例）') || first.startsWith('※'))
}

function countDataRows(file: ImportFile): number {
  return SHEET_ORDER.reduce((sum, key) => sum + file[key].filter(r => !isExampleRow(r)).length, 0)
}

const INPUT_CLS =
  'w-full rounded-lg border border-zinc-300 px-3 py-2 text-sm text-zinc-900 ' +
  'outline-none focus:border-zinc-500 focus:ring-1 focus:ring-zinc-200'

// ── テンプレートダウンロード ────────────────────────────────

function downloadTemplate() {
  const wb = XLSX.utils.book_new()
  for (const key of SHEET_ORDER) {
    const headers: string[] = [...TEMPLATE_HEADERS[key]]
    const example = EXAMPLE_ROWS[key]
    const ws = XLSX.utils.aoa_to_sheet([headers, GUIDE_ROWS[key], example])
    XLSX.utils.book_append_sheet(wb, ws, SHEET_NAMES[key])
  }
  XLSX.writeFile(wb, 'HIBIKI_取引先インポート.xlsx')
}

// ── エラーテーブル ────────────────────────────────────────

function ErrorTable({ errors }: { errors: RowError[] }) {
  return (
    <div className="rounded-xl border border-rose-200 bg-rose-50/60 overflow-hidden">
      <div className="overflow-x-auto">
        <table className="w-full text-xs">
          <thead>
            <tr className="border-b border-rose-200">
              <th className="px-3 py-2 text-left font-semibold text-rose-700 w-24">シート</th>
              <th className="px-3 py-2 text-left font-semibold text-rose-700 w-16">行</th>
              <th className="px-3 py-2 text-left font-semibold text-rose-700 w-32">列</th>
              <th className="px-3 py-2 text-left font-semibold text-rose-700">理由</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-rose-100">
            {errors.map((e, i) => (
              <tr key={i}>
                <td className="px-3 py-2 text-rose-800">{e.sheet}</td>
                <td className="px-3 py-2 text-rose-800 tabular-nums">{e.row}</td>
                <td className="px-3 py-2 text-rose-800">{e.column}</td>
                <td className="px-3 py-2 text-rose-800">{e.reason}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}

// ── メインコンポーネント ─────────────────────────────────────

export default function ImportClient() {
  const [phase, setPhase] = useState<Phase>('idle')
  const [fileName, setFileName] = useState<string | null>(null)
  const [parseError, setParseError] = useState<string | null>(null)
  const [importFile, setImportFile] = useState<ImportFile | null>(null)
  const [previewErrors, setPreviewErrors] = useState<RowError[]>([])
  const [totalRows, setTotalRows] = useState(0)
  const [result, setResult] = useState<ImportResult | null>(null)
  const [isPending, startTransition] = useTransition()

  const fileInputRef = useRef<HTMLInputElement>(null)

  const reset = useCallback(() => {
    setPhase('idle')
    setFileName(null)
    setParseError(null)
    setImportFile(null)
    setPreviewErrors([])
    setTotalRows(0)
    setResult(null)
    if (fileInputRef.current) fileInputRef.current.value = ''
  }, [])

  const handleFile = useCallback(async (file: File) => {
    setFileName(file.name)
    setParseError(null)
    setResult(null)

    // XLSX.read〜行のString化までを1つの try/catch にまとめる。
    // sheet_to_json やセル値の String() 変換も壊れたファイル（不正なブック構造・巨大セル等）で
    // 例外を投げうるため、読み込み系の処理は丸ごと保護してユーザー向けエラーに変換する。
    let next: ImportFile
    try {
      const buf = await file.arrayBuffer()
      const wb = XLSX.read(buf)

      // 請求先・部署・委託先の3シートは従来どおり必須。案件シートは後方互換のため任意。
      const requiredSheets = SHEET_ORDER.filter(key => key !== 'projects')
      const missing = requiredSheets.filter(key => !wb.SheetNames.includes(SHEET_NAMES[key]))
      if (missing.length > 0) {
        setParseError(
          `シート名が一致しません（見つからないシート: ${missing.map(k => SHEET_NAMES[k]).join('、')}）。` +
          'テンプレートをダウンロードして、シート名を変更せずに入力してください。',
        )
        return
      }

      next = { clients: [], departments: [], contractors: [], projects: [] }
      for (const key of SHEET_ORDER) {
        const ws = wb.Sheets[SHEET_NAMES[key]]
        if (!ws) {
          // 案件シートは後方互換のため任意。取引先3シートは従来どおり必須
          if (key === 'projects') { next[key] = []; continue }
          setParseError(
            `シート「${SHEET_NAMES[key]}」が見つかりません。` +
            'テンプレートをダウンロードして、シート名を変更せずに入力してください。',
          )
          return
        }
        // blankrows: true で空行もインデックスを保持したまま取得する（行番号ズレ防止）。
        // 全セル空文字の行は validateAndConvert 側の isBlankRow で無視される。
        const rows = XLSX.utils.sheet_to_json<Record<string, unknown>>(ws, { defval: '', blankrows: true })
        next[key] = rows.map(row => {
          const out: RawRow = {}
          for (const k of Object.keys(row)) out[k] = String(row[k]).trim()
          return out
        })
      }
    } catch {
      setParseError('ファイルの読み込みに失敗しました。.xlsx 形式のファイルを選択してください。')
      return
    }

    const { errors } = validateAndConvert(next, { clientNames: [], contractorNames: [], contractorEmails: [], departmentKeys: [] })
    setImportFile(next)
    setPreviewErrors(errors)
    setTotalRows(countDataRows(next))
    setPhase('parsed')
  }, [])

  const handleSubmit = useCallback(() => {
    if (!importFile) return
    setPhase('importing')
    startTransition(async () => {
      const res = await importPartners(importFile)
      setResult(res)
      setPhase('done')
    })
  }, [importFile])

  const canSubmit = phase === 'parsed' && previewErrors.length === 0 && totalRows > 0 && !isPending

  return (
    <div className="max-w-4xl mx-auto px-4 lg:px-6 py-6 space-y-5">

      <div>
        <h1 className="text-lg font-semibold text-zinc-900">取引先一括インポート</h1>
        <p className="mt-1 text-sm text-zinc-500">
          初期導入時に請求先・部署・委託先をまとめて登録します（運営者専用）。
        </p>
      </div>

      {/* テンプレートDL */}
      <div className="rounded-xl border border-zinc-200 bg-zinc-50 px-5 py-4 flex flex-wrap items-center justify-between gap-3">
        <div>
          <p className="text-sm font-semibold text-zinc-800">1. テンプレートをダウンロード</p>
          <p className="text-xs text-zinc-500 mt-0.5">請求先・部署・委託先・案件 の4シート構成です。</p>
          <p className="text-xs text-zinc-400 mt-0.5">
            各シート2行目は必須／任意のガイド、3行目の「例）」はダミー値の記入例です。どちらも残したまま取り込んで問題ありません（データとしては読み込まれません）。
          </p>
        </div>
        <button
          type="button"
          onClick={downloadTemplate}
          className={`rounded-lg px-4 py-2 text-sm font-semibold transition hover:opacity-90 ${ACCENT.pillActive}`}
        >
          テンプレートをダウンロード
        </button>
      </div>

      {/* ファイル選択 */}
      <div className="rounded-xl border border-zinc-200 bg-zinc-50 px-5 py-4 space-y-3">
        <p className="text-sm font-semibold text-zinc-800">2. 入力済みファイルを選択</p>
        <input
          ref={fileInputRef}
          type="file"
          accept=".xlsx"
          onChange={e => {
            const f = e.target.files?.[0]
            if (f) handleFile(f)
          }}
          className={INPUT_CLS}
        />
        {fileName && <p className="text-xs text-zinc-400">選択中: {fileName}</p>}
      </div>

      {/* パースエラー */}
      {parseError && (
        <p className="rounded-lg bg-rose-50/60 border border-rose-200 px-4 py-3 text-sm text-rose-700 whitespace-pre-wrap">
          {parseError}
        </p>
      )}

      {/* プレビュー */}
      {(phase === 'parsed' || phase === 'importing') && importFile && (
        <div className="space-y-3">
          <div className="rounded-xl border border-zinc-200 bg-zinc-50 px-5 py-4 space-y-2">
            <p className="text-sm font-semibold text-zinc-800">3. 登録内容を確認</p>
            <p className="text-xs text-zinc-500">
              {SHEET_NAMES.clients} {importFile.clients.filter(r => !isExampleRow(r)).length}件 ／
              {' '}{SHEET_NAMES.departments} {importFile.departments.filter(r => !isExampleRow(r)).length}件 ／
              {' '}{SHEET_NAMES.contractors} {importFile.contractors.filter(r => !isExampleRow(r)).length}件 ／
              {' '}{SHEET_NAMES.projects} {importFile.projects.filter(r => !isExampleRow(r)).length}件
            </p>
            <p className="text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded-md px-3 py-2">
              ⚠️ この画面でのチェックは入力形式のみの確認です。既存データとの重複はサーバー側で最終確認されます。
            </p>
          </div>

          {totalRows === 0 && (
            <p className="rounded-lg bg-amber-50 border border-amber-200 px-4 py-3 text-sm text-amber-800">
              登録対象が0件です。各シートにデータ行を入力してください。
            </p>
          )}

          {previewErrors.length > 0 && (
            <div className="space-y-1.5">
              <p className="text-xs font-semibold text-rose-700">
                入力エラー（{previewErrors.length}件） — すべて解消してから登録してください
              </p>
              <ErrorTable errors={previewErrors} />
            </div>
          )}

          <div className="flex justify-end">
            <button
              type="button"
              onClick={handleSubmit}
              disabled={!canSubmit}
              className="rounded-xl bg-zinc-900 px-6 py-3 text-sm font-bold text-white hover:bg-zinc-700 disabled:opacity-40 disabled:cursor-not-allowed transition"
            >
              {phase === 'importing' ? '登録中...' : 'この内容で一括登録する'}
            </button>
          </div>
        </div>
      )}

      {/* 結果 */}
      {phase === 'done' && result && (
        <div className="space-y-3">
          {result.ok ? (
            <div className="rounded-2xl border border-emerald-200 bg-emerald-50 p-8 text-center space-y-2">
              <div className="text-4xl">✅</div>
              <p className="text-emerald-900 font-semibold">
                請求先{result.inserted.clients}件・部署{result.inserted.departments}件・委託先{result.inserted.contractors}件・案件{result.inserted.projects}件を登録しました
              </p>
            </div>
          ) : (
            <div className="space-y-3">
              {result.fatal && (
                <p className="rounded-lg bg-rose-50/60 border border-rose-200 px-4 py-3 text-sm text-rose-700 whitespace-pre-wrap">
                  {result.fatal}
                </p>
              )}
              {result.errors.length > 0 && (
                <div className="space-y-1.5">
                  <p className="text-xs font-semibold text-rose-700">サーバー側検証エラー（{result.errors.length}件）</p>
                  <ErrorTable errors={result.errors} />
                </div>
              )}
            </div>
          )}
          <div className="flex justify-center">
            <button
              type="button"
              onClick={reset}
              className="rounded-lg bg-zinc-900 px-6 py-2.5 text-sm font-medium text-white hover:bg-zinc-700 transition"
            >
              続けてインポートする
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
