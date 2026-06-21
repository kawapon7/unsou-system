'use client'

import { useState, useRef, useCallback, useEffect } from 'react'
import {
  fetchContractorOptions,
  saveScanResult,
  type ContractorOption,
  type ScanSaveParams,
} from '@/app/_actions/scan-actions'

// ── 型 ───────────────────────────────────────────────────

type Phase = 'drop' | 'uploading' | 'polling' | 'review' | 'saving' | 'error'

interface ReviewForm {
  issuerName:         string
  registrationNumber: string
  invoiceDate:        string
  subtotal:           string
  taxAmount:          string
}

type ScanJobResponse = {
  jobId?:   string
  status?:  string
  data?:    Record<string, unknown>
  error?:   string
}

const EMPTY_FORM: ReviewForm = {
  issuerName:         '',
  registrationNumber: '',
  invoiceDate:        '',
  subtotal:           '0',
  taxAmount:          '0',
}

const MAX_POLLS = 40  // 40 × 3s = 2分タイムアウト

// ── 共通インプットクラス ──────────────────────────────────

const INPUT_CLS =
  'w-full rounded-lg border border-zinc-300 px-3 py-2 text-sm text-zinc-900 ' +
  'outline-none focus:border-zinc-500 focus:ring-1 focus:ring-zinc-200 ' +
  'disabled:opacity-50 disabled:bg-zinc-50'

// ── ScanTab ───────────────────────────────────────────────

export function ScanTab() {
  const [phase,        setPhase]        = useState<Phase>('drop')
  const [jobId,        setJobId]        = useState<string | null>(null)
  const [errorMsg,     setErrorMsg]     = useState<string | null>(null)
  const [toast,        setToast]        = useState<string | null>(null)
  const [isDragging,   setIsDragging]   = useState(false)
  const [form,         setForm]         = useState<ReviewForm>(EMPTY_FORM)
  const [contractorId, setContractorId] = useState('')
  const [contractors,  setContractors]  = useState<ContractorOption[]>([])

  const fileInputRef = useRef<HTMLInputElement>(null)
  const pollRef      = useRef<ReturnType<typeof setInterval> | null>(null)
  const pollCount    = useRef(0)

  // 委託先リストをロード
  useEffect(() => {
    fetchContractorOptions().then(r => { if (r.data) setContractors(r.data) })
  }, [])

  // アンマウント時にポーリング停止
  useEffect(() => () => { if (pollRef.current) clearInterval(pollRef.current) }, [])

  // ── ポーリング制御 ────────────────────────────────────

  const stopPolling = useCallback(() => {
    if (pollRef.current) { clearInterval(pollRef.current); pollRef.current = null }
    pollCount.current = 0
  }, [])

  // ── 解析データをフォームに適用 ───────────────────────

  const applyExtracted = useCallback((d: Record<string, unknown>) => {
    setForm({
      issuerName:         String(d.issuerName          ?? ''),
      registrationNumber: String(d.registrationNumber  ?? ''),
      invoiceDate:        String(d.invoiceDate          ?? ''),
      subtotal:           String(Math.round(Number(d.subtotal  ?? 0))),
      taxAmount:          String(Math.round(Number(d.taxAmount ?? 0))),
    })
  }, [])

  // ── ポーリング開始（xlsx/csv など非同期ジョブ用）────

  const startPolling = useCallback((jid: string) => {
    stopPolling()
    pollRef.current = setInterval(async () => {
      pollCount.current++
      if (pollCount.current > MAX_POLLS) {
        stopPolling()
        setPhase('error')
        setErrorMsg('解析がタイムアウトしました（2分超）。再度お試しください。')
        return
      }
      try {
        const res  = await fetch(`/api/scan/upload?jobId=${encodeURIComponent(jid)}`)
        const json = await res.json() as ScanJobResponse
        if (json.status === 'completed' && json.data) {
          stopPolling(); applyExtracted(json.data); setPhase('review')
        } else if (json.status === 'failed') {
          stopPolling()
          setPhase('error')
          setErrorMsg(json.error ?? 'AI解析に失敗しました')
        }
        // queued / processing → 継続
      } catch { /* ネットワーク一時エラーは継続。タイムアウトで停止 */ }
    }, 3000)
  }, [stopPolling, applyExtracted])

  // ── リセット ──────────────────────────────────────────

  const reset = useCallback(() => {
    stopPolling()
    setPhase('drop')
    setJobId(null)
    setErrorMsg(null)
    setForm(EMPTY_FORM)
    setContractorId('')
  }, [stopPolling])

  // ── ファイル送信 ──────────────────────────────────────

  const handleFile = useCallback(async (file: File) => {
    setPhase('uploading')
    setErrorMsg(null)
    const fd = new FormData()
    fd.append('file', file)

    try {
      const res  = await fetch('/api/scan/upload', { method: 'POST', body: fd })
      const json = await res.json() as ScanJobResponse

      if (!res.ok) {
        setPhase('error')
        // 429: クレジット残高不足 / 415: 非対応形式 / 401: 未認証
        const hint =
          res.status === 429 ? '（Gemini APIのクレジット残高が不足しています）' :
          res.status === 415 ? '（非対応ファイル形式です）'                     :
          res.status === 401 ? '（ログインが必要です）'                          : ''
        setErrorMsg(`${json.error ?? 'アップロードエラー'} ${hint}`.trim())
        return
      }

      if (json.status === 'completed' && json.data) {
        // 同期処理完了（画像・PDFはGemini処理後にここに到達）
        applyExtracted(json.data)
        if (json.jobId) setJobId(json.jobId)
        setPhase('review')
        return
      }

      if (json.jobId) {
        // 非同期ジョブ（xlsx/csv等）→ ポーリング開始
        setJobId(json.jobId)
        setPhase('polling')
        startPolling(json.jobId)
        return
      }

      setPhase('error')
      setErrorMsg('予期しないレスポンス形式です')
    } catch (e) {
      setPhase('error')
      setErrorMsg(e instanceof Error ? e.message : 'ネットワークエラーが発生しました')
    }
  }, [applyExtracted, startPolling])

  // ── ドラッグ&ドロップ ─────────────────────────────────

  const onDragOver  = useCallback((e: React.DragEvent) => { e.preventDefault(); setIsDragging(true) }, [])
  const onDragLeave = useCallback(() => setIsDragging(false), [])
  const onDrop      = useCallback((e: React.DragEvent) => {
    e.preventDefault()
    setIsDragging(false)
    const f = e.dataTransfer.files[0]
    if (f) handleFile(f)
  }, [handleFile])

  // ── 確定保存 ──────────────────────────────────────────

  const handleSave = useCallback(async () => {
    if (!contractorId) { setErrorMsg('委託先（ドライバー）を選択してください'); return }
    setPhase('saving')
    setErrorMsg(null)

    const params: ScanSaveParams = {
      contractorId,
      issuerName:         form.issuerName,
      registrationNumber: form.registrationNumber,
      invoiceDate:        form.invoiceDate || new Date().toISOString().slice(0, 10),
      subtotal:           parseInt(form.subtotal,  10) || 0,
      taxAmount:          parseInt(form.taxAmount, 10) || 0,
      jobId,
    }

    const r = await saveScanResult(params)
    if (r.error) { setPhase('review'); setErrorMsg(r.error); return }

    setToast('売上実績に登録しました')
    setTimeout(() => setToast(null), 3000)
    reset()
  }, [contractorId, form, jobId, reset])

  // ── レンダリング ──────────────────────────────────────

  return (
    <div className="max-w-2xl mx-auto space-y-4">

      {/* Toast */}
      {toast && (
        <div className="fixed bottom-6 right-6 z-50 rounded-xl bg-green-600 text-white px-5 py-3 shadow-lg text-sm font-medium">
          ✅ {toast}
        </div>
      )}

      {/* ─ Phase: drop / uploading ─────────────────────── */}
      {(phase === 'drop' || phase === 'uploading') && (
        <div
          role="button"
          tabIndex={0}
          aria-label="請求書ファイルを選択またはドロップ"
          className={[
            'border-2 border-dashed rounded-2xl p-16 text-center transition-colors select-none outline-none',
            isDragging ? 'border-blue-500 bg-blue-50/60' : 'border-zinc-300 bg-zinc-50 hover:border-zinc-400',
            phase === 'uploading' ? 'opacity-60 pointer-events-none' : 'cursor-pointer',
          ].join(' ')}
          onDragOver={onDragOver}
          onDragLeave={onDragLeave}
          onDrop={onDrop}
          onClick={() => phase === 'drop' && fileInputRef.current?.click()}
          onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') fileInputRef.current?.click() }}
        >
          {phase === 'uploading' ? (
            <>
              <div className="w-12 h-12 rounded-full border-4 border-zinc-200 border-t-zinc-800 animate-spin mx-auto mb-4" />
              <p className="text-zinc-700 font-semibold text-lg mb-1">
                Gemini 2.0 がインボイス情報を解析中...
              </p>
              <p className="text-zinc-400 text-sm">しばらくお待ちください（通常 10〜30 秒）</p>
            </>
          ) : (
            <>
              <div className="text-5xl mb-4">📄</div>
              <p className="text-zinc-800 font-semibold text-lg mb-1">
                ここに請求書をドロップ
              </p>
              <p className="text-zinc-400 text-sm">PNG・JPEG・PDF に対応</p>
              <span className="mt-6 inline-block rounded-full bg-zinc-900 text-white text-xs font-medium px-5 py-2">
                ファイルを選択
              </span>
            </>
          )}
          <input
            ref={fileInputRef}
            type="file"
            accept="image/png,image/jpeg,application/pdf"
            className="hidden"
            onChange={e => { const f = e.target.files?.[0]; if (f) handleFile(f); e.target.value = '' }}
          />
        </div>
      )}

      {/* ─ Phase: polling ──────────────────────────────── */}
      {phase === 'polling' && (
        <div className="bg-zinc-50 border border-zinc-200 rounded-2xl p-16 text-center">
          <div className="w-12 h-12 rounded-full border-4 border-zinc-200 border-t-zinc-800 animate-spin mx-auto mb-4" />
          <p className="text-zinc-800 font-semibold text-lg mb-1">
            Gemini 2.0 がインボイス情報を解析中...
          </p>
          <p className="text-zinc-400 text-sm">3 秒ごとに自動確認中</p>
        </div>
      )}

      {/* ─ Phase: error ────────────────────────────────── */}
      {phase === 'error' && (
        <div className="bg-rose-50/60 border border-rose-200 rounded-2xl p-12 text-center space-y-5">
          <div className="text-4xl">⚠️</div>
          <p className="text-rose-700 font-medium text-sm max-w-sm mx-auto leading-relaxed">
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

      {/* ─ Phase: review / saving ──────────────────────── */}
      {(phase === 'review' || phase === 'saving') && (
        <div className="bg-zinc-50 border border-zinc-200 rounded-2xl overflow-hidden">

          {/* ヘッダー */}
          <div className="px-6 py-4 bg-zinc-50 border-b border-zinc-100 flex items-start justify-between gap-4">
            <div>
              <h3 className="font-semibold text-zinc-900">AI解析結果の確認・修正</h3>
              <p className="text-xs text-zinc-500 mt-0.5">
                内容を確認し、必要に応じて修正してから保存してください
              </p>
            </div>
            <button
              onClick={reset}
              className="text-xs text-zinc-400 hover:text-zinc-600 whitespace-nowrap mt-0.5"
            >
              ✕ キャンセル
            </button>
          </div>

          <div className="px-6 py-5 space-y-4">

            {/* 委託先 */}
            <div>
              <label className="block text-xs font-semibold text-zinc-600 mb-1">
                対象委託先 <span className="text-red-500">*</span>
              </label>
              <select
                value={contractorId}
                onChange={e => { setContractorId(e.target.value); setErrorMsg(null) }}
                disabled={phase === 'saving'}
                className={INPUT_CLS}
              >
                <option value="">— 選択してください —</option>
                {contractors.map(c => (
                  <option key={c.id} value={c.id}>{c.name}</option>
                ))}
              </select>
            </div>

            {/* 発行元名 */}
            <div>
              <label className="block text-xs font-semibold text-zinc-600 mb-1">発行元名</label>
              <input
                type="text"
                value={form.issuerName}
                onChange={e => setForm(f => ({ ...f, issuerName: e.target.value }))}
                disabled={phase === 'saving'}
                placeholder="株式会社〇〇運送"
                className={INPUT_CLS}
              />
            </div>

            {/* 登録番号 */}
            <div>
              <label className="block text-xs font-semibold text-zinc-600 mb-1">
                インボイス登録番号（T＋13桁）
              </label>
              <input
                type="text"
                value={form.registrationNumber}
                onChange={e => setForm(f => ({ ...f, registrationNumber: e.target.value }))}
                disabled={phase === 'saving'}
                placeholder="T1234567890123"
                className={INPUT_CLS}
              />
            </div>

            {/* 発行日 */}
            <div>
              <label className="block text-xs font-semibold text-zinc-600 mb-1">発行日</label>
              <input
                type="date"
                value={form.invoiceDate}
                onChange={e => setForm(f => ({ ...f, invoiceDate: e.target.value }))}
                disabled={phase === 'saving'}
                className={INPUT_CLS}
              />
            </div>

            {/* 金額 */}
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-xs font-semibold text-zinc-600 mb-1">
                  税抜合計金額（円）
                </label>
                <input
                  type="number"
                  min="0"
                  value={form.subtotal}
                  onChange={e => setForm(f => ({ ...f, subtotal: e.target.value }))}
                  disabled={phase === 'saving'}
                  className={INPUT_CLS}
                />
              </div>
              <div>
                <label className="block text-xs font-semibold text-zinc-600 mb-1">
                  消費税額（円）
                </label>
                <input
                  type="number"
                  min="0"
                  value={form.taxAmount}
                  onChange={e => setForm(f => ({ ...f, taxAmount: e.target.value }))}
                  disabled={phase === 'saving'}
                  className={INPUT_CLS}
                />
              </div>
            </div>

            {/* エラー（review フェーズ内） */}
            {errorMsg && (
              <p className="text-rose-600 text-xs bg-rose-50/60 rounded-lg px-3 py-2">
                {errorMsg}
              </p>
            )}
          </div>

          {/* 保存ボタン */}
          <div className="px-6 py-4 bg-zinc-50 border-t border-zinc-100">
            <button
              onClick={handleSave}
              disabled={phase === 'saving' || !contractorId}
              className="w-full py-3.5 rounded-xl bg-zinc-900 text-white text-sm font-bold hover:bg-zinc-700 disabled:opacity-40 disabled:cursor-not-allowed transition"
            >
              {phase === 'saving' ? '保存中...' : 'この内容で売上実績に登録する'}
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
