'use client'

import { useState, useRef, useCallback, useTransition } from 'react'
import {
  previewEmergencyRecords,
  importCorrectedRecords,
  type PreviewEmergencyResult,
  type CorrectedRecord,
} from '@/app/_actions/emergencyImportActions'
import type { MatchedWorkRecord } from '@/utils/scan/fileConverter'
import { TRUST_THRESHOLD } from '@/utils/scan/fileConverter'

// ── 型 ───────────────────────────────────────────────────────

type Phase = 'input' | 'parsing' | 'review' | 'importing' | 'done' | 'error'
type InputMode = 'csv' | 'url'

type RowState = {
  contractorId: string
  projectId:    string
  date:         string
  quantity:     string
}

// ── 定数 / ユーティリティ ────────────────────────────────────

const INPUT_CLS =
  'w-full rounded-lg border border-zinc-300 px-3 py-2 text-sm text-zinc-900 ' +
  'outline-none focus:border-zinc-500 focus:ring-1 focus:ring-zinc-200 ' +
  'disabled:opacity-50 disabled:bg-zinc-50'

const SELECT_CLS =
  'rounded-lg border border-zinc-300 px-2 py-1.5 text-xs text-zinc-900 ' +
  'outline-none focus:border-zinc-500 focus:ring-1 focus:ring-zinc-200 ' +
  'disabled:opacity-50 bg-zinc-50 w-full'

function scoreColor(score: number): string {
  if (score >= TRUST_THRESHOLD) return 'text-emerald-700 bg-emerald-50'
  if (score >= 0.5)             return 'text-amber-700 bg-amber-50/60'
  return 'text-rose-700 bg-rose-50'
}

function initRowState(rec: MatchedWorkRecord): RowState {
  return {
    contractorId: rec.contractorId ?? '',
    projectId:    rec.projectId    ?? '',
    date:         rec.date         ?? '',
    quantity:     rec.quantity != null ? String(rec.quantity) : '',
  }
}

// ── メインコンポーネント ─────────────────────────────────────

export function EmergencyImportTab() {
  const [phase,       setPhase]       = useState<Phase>('input')
  const [inputMode,   setInputMode]   = useState<InputMode>('csv')
  const [urlValue,    setUrlValue]    = useState('')
  const [isDragging,  setIsDragging]  = useState(false)
  const [errorMsg,    setErrorMsg]    = useState<string | null>(null)
  const [toast,       setToast]       = useState<string | null>(null)
  const [preview,     setPreview]     = useState<PreviewEmergencyResult | null>(null)
  const [rowStates,   setRowStates]   = useState<Record<number, RowState>>({})
  const [doneResult,  setDoneResult]  = useState<{ imported: number; skipped: number; errors: string[] } | null>(null)
  const [isPending,   startTransition] = useTransition()

  const fileInputRef = useRef<HTMLInputElement>(null)

  // ── リセット ─────────────────────────────────────────────

  const reset = useCallback(() => {
    setPhase('input')
    setUrlValue('')
    setErrorMsg(null)
    setPreview(null)
    setRowStates({})
    setDoneResult(null)
    if (fileInputRef.current) fileInputRef.current.value = ''
  }, [])

  // ── プレビュー呼び出し ────────────────────────────────────

  const runPreview = useCallback((fileData: string, fileType: 'csv' | 'url') => {
    setPhase('parsing')
    setErrorMsg(null)
    startTransition(async () => {
      const res = await previewEmergencyRecords(fileData, fileType)
      if (res.error || !res.data) {
        setPhase('error')
        setErrorMsg(res.error ?? 'エラーが発生しました')
        return
      }
      const data = res.data
      if (data.records.length === 0) {
        setPhase('error')
        setErrorMsg(
          data.parseErrors.length > 0
            ? data.parseErrors[0]
            : 'データ行が見つかりませんでした。ファイルを確認してください。',
        )
        return
      }
      const initialStates: Record<number, RowState> = {}
      data.records.forEach((rec, i) => {
        initialStates[i] = initRowState(rec)
      })
      setPreview(data)
      setRowStates(initialStates)
      setPhase('review')
    })
  }, [])

  // ── CSV ファイル処理 ──────────────────────────────────────

  const handleFile = useCallback((file: File) => {
    if (!file.name.endsWith('.csv') && file.type !== 'text/csv' && file.type !== 'text/plain') {
      setErrorMsg('CSV ファイル（.csv）を選択してください')
      return
    }
    const reader = new FileReader()
    reader.onload = e => {
      const text = e.target?.result
      if (typeof text !== 'string') { setErrorMsg('ファイルの読み込みに失敗しました'); return }
      runPreview(text, 'csv')
    }
    reader.onerror = () => setErrorMsg('ファイルの読み込みに失敗しました')
    reader.readAsText(file, 'UTF-8')
  }, [runPreview])

  const onDragOver  = useCallback((e: React.DragEvent) => { e.preventDefault(); setIsDragging(true) }, [])
  const onDragLeave = useCallback(() => setIsDragging(false), [])
  const onDrop      = useCallback((e: React.DragEvent) => {
    e.preventDefault(); setIsDragging(false)
    const f = e.dataTransfer.files[0]
    if (f) handleFile(f)
  }, [handleFile])

  // ── URL 読み込み ──────────────────────────────────────────

  const handleUrl = useCallback(() => {
    if (!urlValue.trim()) { setErrorMsg('URLを入力してください'); return }
    if (!urlValue.includes('docs.google.com/spreadsheets')) {
      setErrorMsg('Google スプレッドシートの URL を入力してください')
      return
    }
    runPreview(urlValue.trim(), 'url')
  }, [urlValue, runPreview])

  // ── 行状態の更新 ──────────────────────────────────────────

  const updateRow = useCallback((idx: number, patch: Partial<RowState>) => {
    setRowStates(prev => ({ ...prev, [idx]: { ...prev[idx], ...patch } }))
  }, [])

  // ── 一括登録 ─────────────────────────────────────────────

  const handleImport = useCallback(() => {
    if (!preview) return
    const records: CorrectedRecord[] = []
    const skippedRows: number[] = []

    preview.records.forEach((rec, i) => {
      const s = rowStates[i]
      if (!s) return
      const qty = parseInt(s.quantity, 10)
      if (!s.contractorId || !s.projectId || !s.date || isNaN(qty)) {
        skippedRows.push(i + 1)
        return
      }
      records.push({
        contractorId: s.contractorId,
        projectId:    s.projectId,
        date:         s.date,
        quantity:     qty,
        sourceRow:    rec.sourceRow,
      })
    })

    if (records.length === 0) {
      setErrorMsg('登録できる行がありません。必須項目（委託先・案件・日付・個数）をすべて入力してください。')
      return
    }

    setPhase('importing')
    setErrorMsg(null)
    startTransition(async () => {
      const res = await importCorrectedRecords(records)
      if (res.error || !res.data) {
        setPhase('review')
        setErrorMsg(res.error ?? 'エラーが発生しました')
        return
      }
      setDoneResult(res.data)
      setPhase('done')
      setToast(`${res.data.imported} 件を登録しました`)
      setTimeout(() => setToast(null), 4000)
    })
  }, [preview, rowStates])

  // ── レンダリング ─────────────────────────────────────────

  return (
    <div className="max-w-4xl mx-auto space-y-4">

      {/* Toast */}
      {toast && (
        <div className="fixed bottom-6 right-6 z-50 rounded-xl bg-green-600 text-white px-5 py-3 shadow-lg text-sm font-medium">
          ✅ {toast}
        </div>
      )}

      {/* ─ Phase: input ────────────────────────────────────── */}
      {phase === 'input' && (
        <div className="space-y-4">
          <div className="rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-800">
            <span className="font-semibold">🚨 緊急インポートモード</span>
            <span className="ml-2">システム不具合時にGoogleフォーム収集データを管理画面から直接登録します。</span>
          </div>

          {/* 入力モード切替 */}
          <div className="flex rounded-lg border border-zinc-200 bg-zinc-100 p-1 w-fit">
            {(['csv', 'url'] as InputMode[]).map(mode => (
              <button
                key={mode}
                type="button"
                onClick={() => { setInputMode(mode); setErrorMsg(null) }}
                className={`px-4 py-1.5 rounded-md text-sm font-medium transition-colors ${
                  inputMode === mode
                    ? 'bg-white text-zinc-900 shadow-sm'
                    : 'text-zinc-500 hover:text-zinc-700'
                }`}
              >
                {mode === 'csv' ? '📄 CSVファイル' : '🔗 スプレッドシートURL'}
              </button>
            ))}
          </div>

          {/* CSV ドロップゾーン */}
          {inputMode === 'csv' && (
            <div
              role="button"
              tabIndex={0}
              aria-label="CSVファイルを選択またはドロップ"
              className={[
                'border-2 border-dashed rounded-2xl p-16 text-center transition-colors select-none outline-none cursor-pointer',
                isDragging ? 'border-rose-500 bg-rose-50/60' : 'border-zinc-300 bg-zinc-50 hover:border-zinc-400',
              ].join(' ')}
              onDragOver={onDragOver}
              onDragLeave={onDragLeave}
              onDrop={onDrop}
              onClick={() => fileInputRef.current?.click()}
              onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') fileInputRef.current?.click() }}
            >
              <div className="text-5xl mb-4">📋</div>
              <p className="text-zinc-800 font-semibold text-lg mb-1">
                GoogleフォームエクスポートCSVをドロップ
              </p>
              <p className="text-zinc-400 text-sm mb-2">
                必須列: ドライバー名・日付・案件名（列名の表記揺れ自動吸収）
              </p>
              <span className="mt-4 inline-block rounded-full bg-zinc-900 text-white text-xs font-medium px-5 py-2">
                ファイルを選択
              </span>
              <input
                ref={fileInputRef}
                type="file"
                accept=".csv,text/csv,text/plain"
                className="hidden"
                onChange={e => { const f = e.target.files?.[0]; if (f) handleFile(f); e.target.value = '' }}
              />
            </div>
          )}

          {/* URL 入力 */}
          {inputMode === 'url' && (
            <div className="rounded-2xl border border-zinc-200 bg-zinc-50 p-8 space-y-4">
              <div>
                <label className="block text-sm font-semibold text-zinc-700 mb-1.5">
                  GoogleスプレッドシートURL
                </label>
                <input
                  type="url"
                  value={urlValue}
                  onChange={e => setUrlValue(e.target.value)}
                  placeholder="https://docs.google.com/spreadsheets/d/..."
                  className={INPUT_CLS}
                />
                <p className="mt-1.5 text-xs text-zinc-400">
                  シートを「リンクを知っている全員が閲覧可」に設定してから入力してください
                </p>
              </div>
              <button
                type="button"
                onClick={handleUrl}
                className="rounded-lg bg-zinc-900 px-5 py-2.5 text-sm font-semibold text-white hover:bg-zinc-700 transition"
              >
                読み込む
              </button>
            </div>
          )}

          {errorMsg && (
            <p className="rounded-lg bg-rose-50/60 border border-rose-200 px-4 py-3 text-sm text-rose-700">
              {errorMsg}
            </p>
          )}
        </div>
      )}

      {/* ─ Phase: parsing ──────────────────────────────────── */}
      {phase === 'parsing' && (
        <div className="bg-zinc-50 border border-zinc-200 rounded-2xl p-16 text-center">
          <div className="w-12 h-12 rounded-full border-4 border-zinc-200 border-t-zinc-800 animate-spin mx-auto mb-4" />
          <p className="text-zinc-800 font-semibold text-lg mb-1">データを解析・マスタ照合中...</p>
          <p className="text-zinc-400 text-sm">しばらくお待ちください</p>
        </div>
      )}

      {/* ─ Phase: error ────────────────────────────────────── */}
      {phase === 'error' && (
        <div className="bg-rose-50/60 border border-rose-200 rounded-2xl p-12 text-center space-y-5">
          <div className="text-4xl">⚠️</div>
          <p className="text-rose-700 font-medium text-sm max-w-sm mx-auto leading-relaxed whitespace-pre-wrap">
            {errorMsg ?? 'エラーが発生しました'}
          </p>
          <button
            onClick={reset}
            className="px-6 py-2 rounded-lg bg-zinc-900 text-white text-sm font-medium hover:bg-zinc-700 transition"
          >
            もう一度試す
          </button>
        </div>
      )}

      {/* ─ Phase: review ───────────────────────────────────── */}
      {(phase === 'review' || phase === 'importing') && preview && (
        <div className="space-y-4">

          {/* サマリーヘッダー */}
          <div className="rounded-xl border border-zinc-200 bg-zinc-50 px-5 py-4 flex flex-wrap items-center justify-between gap-3">
            <div className="flex items-center gap-4 text-sm">
              <span className="font-semibold text-zinc-800">{preview.records.length} 行を読み込みました</span>
              {preview.records.filter(r => r.needsManualReview).length > 0 && (
                <span className="inline-flex items-center gap-1.5 rounded-full bg-amber-100 px-2.5 py-0.5 text-xs font-semibold text-amber-800">
                  ⚠️ 要確認 {preview.records.filter(r => r.needsManualReview).length} 行
                </span>
              )}
            </div>
            <button
              type="button"
              onClick={reset}
              className="text-xs text-zinc-400 hover:text-zinc-600"
            >
              ✕ やり直す
            </button>
          </div>

          {/* パースエラー（警告として表示） */}
          {preview.parseErrors.length > 0 && (
            <div className="rounded-xl border border-amber-200 bg-amber-50/60 px-4 py-3 space-y-1">
              <p className="text-xs font-semibold text-amber-800">⚠️ パース警告（{preview.parseErrors.length}件）</p>
              {preview.parseErrors.map((e, i) => (
                <p key={i} className="text-xs text-amber-700">{e}</p>
              ))}
            </div>
          )}

          {/* プレビューテーブル */}
          <div className="rounded-xl border border-zinc-200 bg-zinc-50 overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead>
                  <tr className="bg-zinc-50 border-b border-zinc-200">
                    <th className="px-3 py-2.5 text-left font-semibold text-zinc-600 w-10">行</th>
                    <th className="px-3 py-2.5 text-left font-semibold text-zinc-600">委託先（ドライバー）</th>
                    <th className="px-3 py-2.5 text-left font-semibold text-zinc-600">案件</th>
                    <th className="px-3 py-2.5 text-left font-semibold text-zinc-600 w-32">日付</th>
                    <th className="px-3 py-2.5 text-left font-semibold text-zinc-600 w-20">個数</th>
                    <th className="px-3 py-2.5 text-left font-semibold text-zinc-600 w-20">信頼度</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-zinc-100">
                  {preview.records.map((rec, i) => {
                    const s = rowStates[i]
                    if (!s) return null
                    const isReview = rec.needsManualReview
                    const rowBg = isReview ? 'bg-amber-50/60' : 'bg-zinc-50'

                    return (
                      <tr key={i} className={rowBg}>
                        <td className="px-3 py-2 text-zinc-400 tabular-nums">{rec.sourceRow ?? i + 1}</td>

                        {/* 委託先 */}
                        <td className="px-3 py-2 min-w-[180px]">
                          {isReview ? (
                            <div className="space-y-0.5">
                              <p className="text-zinc-400 line-through text-[10px]">{rec.rawDriverName ?? '—'}</p>
                              <select
                                value={s.contractorId}
                                onChange={e => updateRow(i, { contractorId: e.target.value })}
                                disabled={phase === 'importing'}
                                className={SELECT_CLS}
                              >
                                <option value="">— 委託先を選択 —</option>
                                {preview.contractors.map(c => (
                                  <option key={c.id} value={c.id}>{c.name}</option>
                                ))}
                              </select>
                            </div>
                          ) : (
                            <span className="text-zinc-800 font-medium">{rec.contractorMatch ?? rec.rawDriverName ?? '—'}</span>
                          )}
                        </td>

                        {/* 案件 */}
                        <td className="px-3 py-2 min-w-[180px]">
                          {isReview ? (
                            <div className="space-y-0.5">
                              <p className="text-zinc-400 line-through text-[10px]">{rec.rawProjectName ?? '—'}</p>
                              <select
                                value={s.projectId}
                                onChange={e => updateRow(i, { projectId: e.target.value })}
                                disabled={phase === 'importing'}
                                className={SELECT_CLS}
                              >
                                <option value="">— 案件を選択 —</option>
                                {preview.projects.map(p => (
                                  <option key={p.id} value={p.id}>{p.name}</option>
                                ))}
                              </select>
                            </div>
                          ) : (
                            <span className="text-zinc-800 font-medium">{rec.projectMatch ?? rec.rawProjectName ?? '—'}</span>
                          )}
                        </td>

                        {/* 日付 */}
                        <td className="px-3 py-2">
                          {s.date ? (
                            <input
                              type="date"
                              value={s.date}
                              onChange={e => updateRow(i, { date: e.target.value })}
                              disabled={phase === 'importing'}
                              className="rounded border border-zinc-300 px-2 py-1 text-xs text-zinc-900 outline-none focus:border-zinc-500 disabled:opacity-50 w-32"
                            />
                          ) : (
                            <input
                              type="date"
                              value={s.date}
                              onChange={e => updateRow(i, { date: e.target.value })}
                              disabled={phase === 'importing'}
                              placeholder="要入力"
                              className="rounded border border-rose-300 px-2 py-1 text-xs text-zinc-900 outline-none focus:border-rose-400 disabled:opacity-50 w-32 bg-rose-50/40"
                            />
                          )}
                        </td>

                        {/* 個数 */}
                        <td className="px-3 py-2">
                          <input
                            type="number"
                            min="0"
                            value={s.quantity}
                            onChange={e => updateRow(i, { quantity: e.target.value })}
                            disabled={phase === 'importing'}
                            placeholder={rec.quantity == null ? '要入力' : undefined}
                            className={[
                              'rounded border px-2 py-1 text-xs text-zinc-900 outline-none disabled:opacity-50 w-20 text-right tabular-nums',
                              rec.quantity == null && !s.quantity
                                ? 'border-rose-300 bg-rose-50/40 focus:border-rose-400'
                                : 'border-zinc-300 focus:border-zinc-500',
                            ].join(' ')}
                          />
                        </td>

                        {/* 信頼スコア */}
                        <td className="px-3 py-2">
                          <span className={`inline-flex rounded-full px-2 py-0.5 text-[10px] font-bold tabular-nums ${scoreColor(rec.trustScore)}`}>
                            {(rec.trustScore * 100).toFixed(0)}%
                          </span>
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          </div>

          {/* エラー表示（review内） */}
          {errorMsg && (
            <p className="rounded-lg bg-rose-50/60 border border-rose-200 px-4 py-3 text-sm text-rose-700">
              {errorMsg}
            </p>
          )}

          {/* 登録ボタン */}
          <div className="flex items-center justify-between gap-4">
            <p className="text-xs text-zinc-400">
              ⚠️ 信頼度が低い行（橙・赤）は必ず委託先・案件を選択してください
            </p>
            <button
              type="button"
              onClick={handleImport}
              disabled={phase === 'importing' || isPending}
              className="shrink-0 rounded-xl bg-rose-700 px-6 py-3 text-sm font-bold text-white hover:bg-rose-600 disabled:opacity-40 disabled:cursor-not-allowed transition"
            >
              {phase === 'importing' ? '登録中...' : 'この内容で一括登録する'}
            </button>
          </div>
        </div>
      )}

      {/* ─ Phase: done ─────────────────────────────────────── */}
      {phase === 'done' && doneResult && (
        <div className="rounded-2xl border border-emerald-200 bg-emerald-50 p-12 text-center space-y-6">
          <div className="text-5xl">✅</div>
          <div className="space-y-1">
            <p className="text-emerald-900 font-semibold text-lg">
              {doneResult.imported} 件を登録しました
            </p>
            {doneResult.skipped > 0 && (
              <p className="text-emerald-700 text-sm">{doneResult.skipped} 件はスキップされました</p>
            )}
          </div>
          {doneResult.errors.length > 0 && (
            <div className="text-left rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 space-y-1 max-w-sm mx-auto">
              <p className="text-xs font-semibold text-amber-800">登録エラー詳細</p>
              {doneResult.errors.map((e, i) => (
                <p key={i} className="text-xs text-amber-700">{e}</p>
              ))}
            </div>
          )}
          <button
            type="button"
            onClick={reset}
            className="px-6 py-2.5 rounded-lg bg-zinc-900 text-white text-sm font-medium hover:bg-zinc-700 transition"
          >
            続けてインポートする
          </button>
        </div>
      )}
    </div>
  )
}
