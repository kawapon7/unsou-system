'use client'

import { useState, useRef, useCallback, useEffect } from 'react'
import { useSearchParams, useRouter, usePathname } from 'next/navigation'
import {
  fetchContractorOptions,
  saveScanResult,
  saveClientScanResult,
  type ContractorOption,
  type ScanSaveParams,
  type ClientScanSaveParams,
} from '@/app/_actions/scan-actions'
import { fetchClientOptions } from '@/app/admin/sales/actions'

// ── 型 ───────────────────────────────────────────────────

type ScanTab = 'in' | 'out' | 'history'

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

const MAX_POLLS = 40

const INPUT_CLS =
  'w-full rounded-lg border border-zinc-300 px-3 py-2 text-sm text-zinc-900 ' +
  'outline-none focus:border-zinc-500 focus:ring-1 focus:ring-zinc-200 ' +
  'disabled:opacity-50 disabled:bg-zinc-50'

// ── 共通：スキャンUI コア ──────────────────────────────────

function ScanCore({
  mode,
}: {
  mode: 'in' | 'out'
}) {
  const [phase,        setPhase]        = useState<Phase>('drop')
  const [jobId,        setJobId]        = useState<string | null>(null)
  const [errorMsg,     setErrorMsg]     = useState<string | null>(null)
  const [toast,        setToast]        = useState<string | null>(null)
  const [isDragging,   setIsDragging]   = useState(false)
  const [form,         setForm]         = useState<ReviewForm>(EMPTY_FORM)
  const [masterId,     setMasterId]     = useState('')
  const [contractors,  setContractors]  = useState<ContractorOption[]>([])
  const [clients,      setClients]      = useState<{ id: string; company_name: string }[]>([])

  const fileInputRef = useRef<HTMLInputElement>(null)
  const pollRef      = useRef<ReturnType<typeof setInterval> | null>(null)
  const pollCount    = useRef(0)

  useEffect(() => {
    if (mode === 'out') {
      fetchContractorOptions().then(r => { if (r.data) setContractors(r.data) })
    } else {
      fetchClientOptions().then(r => { if (!r.error && r.data) setClients(r.data) })
    }
  }, [mode])

  useEffect(() => () => { if (pollRef.current) clearInterval(pollRef.current) }, [])

  const stopPolling = useCallback(() => {
    if (pollRef.current) { clearInterval(pollRef.current); pollRef.current = null }
    pollCount.current = 0
  }, [])

  const applyExtracted = useCallback((d: Record<string, unknown>) => {
    setForm({
      issuerName:         String(d.issuerName          ?? ''),
      registrationNumber: String(d.registrationNumber  ?? ''),
      invoiceDate:        String(d.invoiceDate          ?? ''),
      subtotal:           String(Math.round(Number(d.subtotal  ?? 0))),
      taxAmount:          String(Math.round(Number(d.taxAmount ?? 0))),
    })
  }, [])

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
      } catch { /* ネットワーク一時エラーは継続 */ }
    }, 3000)
  }, [stopPolling, applyExtracted])

  const reset = useCallback(() => {
    stopPolling()
    setPhase('drop')
    setJobId(null)
    setErrorMsg(null)
    setForm(EMPTY_FORM)
    setMasterId('')
  }, [stopPolling])

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
        const hint =
          res.status === 429 ? '（Gemini APIのクレジット残高が不足しています）' :
          res.status === 415 ? '（非対応ファイル形式です）'                     :
          res.status === 401 ? '（ログインが必要です）'                          : ''
        setErrorMsg(`${json.error ?? 'アップロードエラー'} ${hint}`.trim())
        return
      }

      if (json.status === 'completed' && json.data) {
        applyExtracted(json.data)
        if (json.jobId) setJobId(json.jobId)
        setPhase('review')
        return
      }

      if (json.jobId) {
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

  const onDragOver  = useCallback((e: React.DragEvent) => { e.preventDefault(); setIsDragging(true) }, [])
  const onDragLeave = useCallback(() => setIsDragging(false), [])
  const onDrop      = useCallback((e: React.DragEvent) => {
    e.preventDefault(); setIsDragging(false)
    const f = e.dataTransfer.files[0]
    if (f) handleFile(f)
  }, [handleFile])

  const handleSave = useCallback(async () => {
    if (!masterId) {
      setErrorMsg(mode === 'in' ? '荷主を選択してください' : '委託先（ドライバー）を選択してください')
      return
    }
    setPhase('saving')
    setErrorMsg(null)

    const today = `${new Date().getFullYear()}-${String(new Date().getMonth() + 1).padStart(2, '0')}-${String(new Date().getDate()).padStart(2, '0')}`
    const invoiceDate = form.invoiceDate || today

    if (mode === 'in') {
      const params: ClientScanSaveParams = {
        clientId:           masterId,
        issuerName:         form.issuerName,
        registrationNumber: form.registrationNumber,
        invoiceDate,
        subtotal:           parseInt(form.subtotal,  10) || 0,
        taxAmount:          parseInt(form.taxAmount, 10) || 0,
        jobId,
      }
      const r = await saveClientScanResult(params)
      if (r.error) { setPhase('review'); setErrorMsg(r.error) }
      else { setToast('売上書類を保存しました ✅'); setTimeout(() => setToast(null), 4000); reset() }
      return
    }

    const params: ScanSaveParams = {
      contractorId:       masterId,
      issuerName:         form.issuerName,
      registrationNumber: form.registrationNumber,
      invoiceDate,
      subtotal:           parseInt(form.subtotal,  10) || 0,
      taxAmount:          parseInt(form.taxAmount, 10) || 0,
      jobId,
    }

    const r = await saveScanResult(params)
    if (r.error) {
      setPhase('review')
      setErrorMsg(r.error)
    } else {
      setToast('保存しました ✅')
      setTimeout(() => setToast(null), 4000)
      reset()
    }
  }, [mode, masterId, form, jobId, reset])

  const masterLabel   = mode === 'in' ? '荷主' : '委託先（ドライバー）'
  const masterOptions = mode === 'in'
    ? clients.map(c => ({ id: c.id, name: c.company_name }))
    : contractors.map(c => ({ id: c.id, name: c.name }))

  const totalAmount = (parseInt(form.subtotal, 10) || 0) + (parseInt(form.taxAmount, 10) || 0)

  return (
    <div className="space-y-5">

      {/* 説明バナー */}
      <div className={`rounded-lg px-4 py-3 text-sm font-medium ${
        mode === 'in'
          ? 'bg-blue-50 text-blue-800 border border-blue-200'
          : 'bg-violet-50 text-violet-800 border border-violet-200'
      }`}>
        {mode === 'in'
          ? '📥 売上書類（荷主からの発注書・受領書）をスキャンして売上データに取り込みます。荷主マスタと照合されます。'
          : '📤 支払書類（委託先からの請求書・領収書）をスキャンして支払データに取り込みます。委託先マスタと照合されます。'}
      </div>

      {/* ドロップゾーン */}
      {(phase === 'drop' || phase === 'error') && (
        <div
          onDragOver={onDragOver}
          onDragLeave={onDragLeave}
          onDrop={onDrop}
          onClick={() => fileInputRef.current?.click()}
          className={`flex flex-col items-center justify-center gap-3 rounded-xl border-2 border-dashed cursor-pointer transition-colors py-16 ${
            isDragging ? 'border-zinc-500 bg-zinc-100' : 'border-zinc-300 bg-zinc-50 hover:bg-white hover:border-zinc-400'
          }`}
        >
          <svg className="w-10 h-10 text-zinc-400" fill="none" viewBox="0 0 24 24" strokeWidth={1.2} stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" d="M3 16.5v2.25A2.25 2.25 0 0 0 5.25 21h13.5A2.25 2.25 0 0 0 21 18.75V16.5m-13.5-9L12 3m0 0 4.5 4.5M12 3v13.5" />
          </svg>
          <div className="text-center">
            <p className="text-sm font-medium text-zinc-700">クリックまたはドラッグ&amp;ドロップ</p>
            <p className="text-xs text-zinc-400 mt-1">PDF / 画像（PNG・JPG） / Excel / CSV に対応</p>
          </div>
          <input ref={fileInputRef} type="file" accept=".pdf,.png,.jpg,.jpeg,.xlsx,.xls,.csv" className="hidden"
            onChange={e => { const f = e.target.files?.[0]; if (f) handleFile(f) }} />
        </div>
      )}

      {phase === 'error' && errorMsg && (
        <p className="rounded-lg bg-red-50 border border-red-200 px-4 py-3 text-sm text-red-700">{errorMsg}</p>
      )}

      {/* アップロード中 */}
      {phase === 'uploading' && (
        <div className="flex items-center gap-3 rounded-xl border border-zinc-200 bg-white px-6 py-12 justify-center">
          <div className="h-5 w-5 animate-spin rounded-full border-2 border-zinc-900 border-t-transparent" />
          <p className="text-sm text-zinc-600">アップロード中...</p>
        </div>
      )}

      {/* ポーリング */}
      {phase === 'polling' && (
        <div className="flex flex-col items-center gap-3 rounded-xl border border-zinc-200 bg-white px-6 py-12 justify-center">
          <div className="h-6 w-6 animate-spin rounded-full border-2 border-zinc-900 border-t-transparent" />
          <p className="text-sm text-zinc-600">AIが解析中です。しばらくお待ちください...</p>
          <p className="text-xs text-zinc-400">Job ID: {jobId}</p>
        </div>
      )}

      {/* レビューフォーム */}
      {(phase === 'review' || phase === 'saving') && (
        <div className="rounded-xl border border-zinc-200 bg-white overflow-hidden">
          <div className="border-b border-zinc-200 bg-zinc-50 px-5 py-4 flex items-center justify-between">
            <div>
              <p className="text-xs text-zinc-500">AI解析結果を確認・修正してください</p>
              <p className="text-sm font-semibold text-zinc-900 mt-0.5">内容確認・保存</p>
            </div>
            <button onClick={reset}
              className="text-xs text-zinc-400 hover:text-zinc-700 underline">
              やり直す
            </button>
          </div>

          <div className="p-5 grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className="block text-xs font-medium text-zinc-600 mb-1">発行者名</label>
              <input type="text" value={form.issuerName} className={INPUT_CLS}
                onChange={e => setForm(f => ({ ...f, issuerName: e.target.value }))} />
            </div>
            <div>
              <label className="block text-xs font-medium text-zinc-600 mb-1">登録番号（T始まり）</label>
              <input type="text" value={form.registrationNumber} placeholder="T1234567890123" className={INPUT_CLS}
                onChange={e => setForm(f => ({ ...f, registrationNumber: e.target.value }))} />
            </div>
            <div>
              <label className="block text-xs font-medium text-zinc-600 mb-1">請求日</label>
              <input type="date" value={form.invoiceDate} className={INPUT_CLS}
                onChange={e => setForm(f => ({ ...f, invoiceDate: e.target.value }))} />
            </div>
            <div>
              <label className="block text-xs font-medium text-zinc-600 mb-1">{masterLabel}</label>
              <select value={masterId} className={INPUT_CLS}
                onChange={e => setMasterId(e.target.value)}>
                <option value="">選択してください</option>
                {masterOptions.map(o => (
                  <option key={o.id} value={o.id}>{o.name}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-xs font-medium text-zinc-600 mb-1">税抜金額（円）</label>
              <input type="number" min={0} value={form.subtotal} className={INPUT_CLS}
                onChange={e => setForm(f => ({ ...f, subtotal: e.target.value }))} />
            </div>
            <div>
              <label className="block text-xs font-medium text-zinc-600 mb-1">消費税額（円）</label>
              <input type="number" min={0} value={form.taxAmount} className={INPUT_CLS}
                onChange={e => setForm(f => ({ ...f, taxAmount: e.target.value }))} />
            </div>
          </div>

          <div className="border-t border-zinc-200 bg-zinc-50 px-5 py-4 flex items-center justify-between">
            <p className="text-sm font-semibold text-zinc-900">
              合計（税込）：¥{totalAmount.toLocaleString('ja-JP')}
            </p>
            {errorMsg && <p className="text-xs text-red-600">{errorMsg}</p>}
            <button
              onClick={handleSave}
              disabled={phase === 'saving'}
              className="rounded-lg bg-zinc-900 px-5 py-2 text-sm font-medium text-white hover:bg-zinc-700 disabled:opacity-50 transition"
            >
              {phase === 'saving' ? '保存中...' : '確定・保存'}
            </button>
          </div>
        </div>
      )}

      {/* トースト */}
      {toast && (
        <div className="fixed bottom-6 right-6 z-50 rounded-xl bg-zinc-900 px-5 py-3 text-sm font-medium text-white shadow-lg">
          {toast}
        </div>
      )}
    </div>
  )
}

// ── 取り込み履歴タブ ──────────────────────────────────────

function ScanHistoryTab() {
  return (
    <div className="flex flex-col items-center justify-center py-24 text-center">
      <svg className="w-12 h-12 text-zinc-300 mb-4" fill="none" viewBox="0 0 24 24" strokeWidth={1.2} stroke="currentColor">
        <path strokeLinecap="round" strokeLinejoin="round" d="M12 6v6h4.5m4.5 0a9 9 0 1 1-18 0 9 9 0 0 1 18 0Z" />
      </svg>
      <p className="text-sm font-medium text-zinc-500">取り込み履歴</p>
      <p className="text-xs text-zinc-400 mt-1">スキャン済みデータの一覧表示機能は近日実装予定です。</p>
    </div>
  )
}

// ── メインページ ──────────────────────────────────────────

const TABS: { key: ScanTab; label: string }[] = [
  { key: 'in',      label: '売上書類取込（IN）' },
  { key: 'out',     label: '支払書類取込（OUT）' },
  { key: 'history', label: '取り込み履歴' },
]

export default function ScanPage() {
  const searchParams = useSearchParams()
  const router       = useRouter()
  const pathname     = usePathname()
  const tab          = (searchParams.get('tab') as ScanTab | null) ?? 'in'
  const setTab       = (t: ScanTab) => router.replace(`${pathname}?tab=${t}`)

  return (
    <div className="min-h-screen bg-zinc-50">
      <div className="mx-auto max-w-3xl px-6 py-8">

        <div className="flex items-center justify-between gap-4 mb-6">
          <h1 className="text-xl font-semibold text-zinc-900">AIスキャン</h1>
        </div>

        {/* タブ（最大3個） */}
        <div className="flex gap-1 border-b border-zinc-200 mb-6">
          {TABS.map(({ key, label }) => (
            <button
              key={key}
              onClick={() => setTab(key)}
              className={`px-5 py-2.5 text-sm font-medium border-b-2 -mb-px transition ${
                tab === key
                  ? 'border-zinc-900 text-zinc-900'
                  : 'border-transparent text-zinc-500 hover:text-zinc-700'
              }`}
            >
              {label}
            </button>
          ))}
        </div>

        {tab === 'in'      && <ScanCore mode="in" />}
        {tab === 'out'     && <ScanCore mode="out" />}
        {tab === 'history' && <ScanHistoryTab />}
      </div>
    </div>
  )
}
