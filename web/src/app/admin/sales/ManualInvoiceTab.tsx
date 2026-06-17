'use client'

import { useState, useEffect, useCallback, useId } from 'react'
import {
  fetchClientOptions,
  fetchContractorOptions,
  computeManualInvoicePreview,
  commitManualInvoice,
  type ManualInvoiceLine,
  type ManualInvoicePreview,
} from './actions'

// ── ユーティリティ ────────────────────────────────────────

const yen = (n: number) => `¥${n.toLocaleString('ja-JP')}`

function pct(rate: number) {
  return `${Math.round(rate * 100)}%`
}

function makeId() {
  return Math.random().toString(36).slice(2, 10)
}

function todayISO() {
  return new Date().toLocaleDateString('sv-SE', { timeZone: 'Asia/Tokyo' })
}

// ── 行テンプレート ────────────────────────────────────────

function emptyLine(): ManualInvoiceLine {
  return {
    id:          makeId(),
    date:        todayISO(),
    projectName: '',
    amount:      0,
    isTaxable:   true,
    checked:     true,
  }
}

// ── 明細テーブル ─────────────────────────────────────────

function LineTable({
  lines,
  onChange,
  onRemove,
}: {
  lines:    ManualInvoiceLine[]
  onChange: (id: string, patch: Partial<ManualInvoiceLine>) => void
  onRemove: (id: string) => void
}) {
  return (
    <div className="overflow-x-auto rounded-xl border border-zinc-200">
      <table className="w-full text-sm">
        <thead className="bg-zinc-50">
          <tr>
            <th className="px-3 py-2.5 text-center text-xs font-medium text-zinc-500 w-10">✅</th>
            <th className="px-3 py-2.5 text-left text-xs font-medium text-zinc-500 min-w-[110px]">日付</th>
            <th className="px-3 py-2.5 text-left text-xs font-medium text-zinc-500 min-w-[160px]">案件名</th>
            <th className="px-3 py-2.5 text-right text-xs font-medium text-zinc-500 min-w-[120px]">金額（税抜）</th>
            <th className="px-3 py-2.5 text-center text-xs font-medium text-zinc-500 w-20">課税</th>
            <th className="px-3 py-2.5 w-10" />
          </tr>
        </thead>
        <tbody className="divide-y divide-zinc-100">
          {lines.map(line => (
            <tr key={line.id} className={line.checked ? '' : 'opacity-50 bg-zinc-50'}>
              {/* チェック — DB反映対象フラグ */}
              <td className="px-3 py-2 text-center">
                <input
                  type="checkbox"
                  checked={line.checked}
                  onChange={e => onChange(line.id, { checked: e.target.checked })}
                  className="h-4 w-4 rounded border-zinc-300 accent-emerald-600"
                  title="チェックした行のみ集計・DB登録されます"
                />
              </td>
              {/* 日付 */}
              <td className="px-3 py-2">
                <input
                  type="date"
                  value={line.date}
                  onChange={e => onChange(line.id, { date: e.target.value })}
                  className="w-full rounded border border-zinc-200 bg-white px-2 py-1 text-xs text-zinc-900 outline-none focus:border-zinc-400"
                />
              </td>
              {/* 案件名 */}
              <td className="px-3 py-2">
                <input
                  type="text"
                  value={line.projectName}
                  onChange={e => onChange(line.id, { projectName: e.target.value })}
                  placeholder="案件名を入力…"
                  className="w-full rounded border border-zinc-200 bg-white px-2 py-1 text-xs text-zinc-900 outline-none focus:border-zinc-400"
                />
              </td>
              {/* 金額 */}
              <td className="px-3 py-2">
                <input
                  type="number"
                  min="0"
                  step="1"
                  value={line.amount || ''}
                  onChange={e => onChange(line.id, { amount: parseInt(e.target.value, 10) || 0 })}
                  placeholder="0"
                  className="w-full rounded border border-zinc-200 bg-white px-2 py-1 text-xs text-right text-zinc-900 outline-none focus:border-zinc-400"
                />
              </td>
              {/* 課税フラグ */}
              <td className="px-3 py-2 text-center">
                <select
                  value={line.isTaxable ? 'taxable' : 'exempt'}
                  onChange={e => onChange(line.id, { isTaxable: e.target.value === 'taxable' })}
                  className="rounded border border-zinc-200 bg-white px-1.5 py-1 text-xs text-zinc-900 outline-none focus:border-zinc-400"
                >
                  <option value="taxable">課税</option>
                  <option value="exempt">非課税</option>
                </select>
              </td>
              {/* 削除 */}
              <td className="px-2 py-2 text-center">
                <button
                  type="button"
                  onClick={() => onRemove(line.id)}
                  className="text-zinc-300 hover:text-rose-500 transition text-lg leading-none"
                  title="この行を削除"
                >
                  ×
                </button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

// ── プレビュー ────────────────────────────────────────────

function PreviewCard({
  preview,
  mode,
}: {
  preview: ManualInvoicePreview
  mode:    'in' | 'out'
}) {
  const accentCls = mode === 'in'
    ? 'bg-emerald-50 border-emerald-200 text-emerald-800'
    : 'bg-rose-50 border-rose-200 text-rose-800'
  const labelCls  = mode === 'in' ? 'text-emerald-600' : 'text-rose-600'

  return (
    <div className={`rounded-xl border px-5 py-4 space-y-1.5 ${accentCls}`}>
      <p className="text-xs font-semibold mb-2">計算プレビュー（インボイス経過措置自動計算）</p>
      <Row label="税抜き合計" value={yen(preview.subtotal)} />
      <Row label="消費税（10%）" value={`+ ${yen(preview.taxAmount)}`} />
      {preview.deductionRate > 0 && (
        <Row
          label={`経過措置差し引き（${pct(preview.deductionRate)}）`}
          value={`− ${yen(preview.deductionAmount)}`}
          muted
        />
      )}
      <div className={`flex items-center justify-between pt-2 border-t border-current/20 font-bold ${labelCls}`}>
        <span>最終{mode === 'in' ? '請求' : '支払'}額</span>
        <span className="text-lg tabular-nums">{yen(preview.finalAmount)}</span>
      </div>
    </div>
  )
}

function Row({ label, value, muted }: { label: string; value: string; muted?: boolean }) {
  return (
    <div className={`flex items-center justify-between text-sm ${muted ? 'text-current/60' : ''}`}>
      <span>{label}</span>
      <span className="tabular-nums font-medium">{value}</span>
    </div>
  )
}

// ================================================================
// ManualInvoiceTab メインコンポーネント
// ================================================================

type TabMode = 'in' | 'out'

export function ManualInvoiceTab({ yearMonth }: { yearMonth: string }) {
  const [mode,        setMode]        = useState<TabMode>('in')
  const [lines,       setLines]       = useState<ManualInvoiceLine[]>([emptyLine()])
  const [clientId,    setClientId]    = useState('')
  const [contractorId, setContractorId] = useState('')
  const [clients,     setClients]     = useState<{ id: string; company_name: string }[]>([])
  const [contractors, setContractors] = useState<{ id: string; name: string; isRegistered: boolean }[]>([])
  const [preview,     setPreview]     = useState<ManualInvoicePreview | null>(null)
  const [saving,      setSaving]      = useState(false)
  const [saved,       setSaved]       = useState(false)
  const [error,       setError]       = useState<string | null>(null)

  // 取引先マスタを読み込む
  useEffect(() => {
    fetchClientOptions().then(r => { if (r.data) setClients(r.data) })
    fetchContractorOptions().then(r => { if (r.data) setContractors(r.data) })
  }, [])

  // プレビューを自動再計算（checkedな行が変わるたびに）
  useEffect(() => {
    const checkedLines = lines.filter(l => l.checked && l.amount > 0)
    if (checkedLines.length === 0) { setPreview(null); return }

    const isRegistered = mode === 'in'
      ? (clients.find(c => c.id === clientId) as any)?.invoice_registered ?? false
      : contractors.find(c => c.id === contractorId)?.isRegistered ?? false

    const targetDate = checkedLines[0]?.date ?? todayISO()

    void computeManualInvoicePreview({ lines: checkedLines, isRegistered, targetDate })
      .then(r => { if (r.data) setPreview(r.data) })
  }, [lines, mode, clientId, contractorId, clients, contractors])

  function updateLine(id: string, patch: Partial<ManualInvoiceLine>) {
    setLines(prev => prev.map(l => l.id === id ? { ...l, ...patch } : l))
  }

  function removeLine(id: string) {
    setLines(prev => prev.filter(l => l.id !== id))
  }

  function addLine() {
    setLines(prev => [...prev, emptyLine()])
  }

  async function handleSave() {
    if (!preview) return
    setSaving(true)
    setError(null)
    const res = await commitManualInvoice({
      yearMonth,
      lines,
      clientId:     mode === 'in' ? clientId : undefined,
      contractorId: mode === 'out' ? contractorId : undefined,
      mode,
      finalAmount: preview.finalAmount,
    })
    setSaving(false)
    if (res.error) { setError(res.error); return }
    setSaved(true)
    setLines([emptyLine()])
    setPreview(null)
    setTimeout(() => setSaved(false), 3000)
  }

  const checkedCount = lines.filter(l => l.checked).length

  return (
    <div className="space-y-5">

      {/* イン/アウト切り替え */}
      <div className="flex rounded-xl border border-zinc-200 bg-white overflow-hidden text-sm font-medium w-fit">
        {([['in', '売上請求書（イン）'], ['out', '支払請求書（アウト）']] as [TabMode, string][]).map(([key, label]) => (
          <button
            key={key}
            type="button"
            onClick={() => { setMode(key); setLines([emptyLine()]); setPreview(null) }}
            className={`px-5 py-2.5 transition ${mode === key
              ? key === 'in' ? 'bg-emerald-600 text-white' : 'bg-rose-600 text-white'
              : 'text-zinc-600 hover:bg-zinc-50'}`}
          >
            {label}
          </button>
        ))}
      </div>

      {/* 取引先選択 */}
      <div className="flex flex-wrap items-end gap-4">
        {mode === 'in' ? (
          <div>
            <label className="block text-xs text-zinc-500 mb-1">荷主</label>
            <select
              value={clientId}
              onChange={e => setClientId(e.target.value)}
              className="rounded-lg border border-zinc-300 bg-white px-3 py-2 text-sm text-zinc-900 outline-none focus:border-zinc-500 min-w-[200px]"
            >
              <option value="">（荷主を選択）</option>
              {clients.map(c => <option key={c.id} value={c.id}>{c.company_name}</option>)}
            </select>
          </div>
        ) : (
          <div>
            <label className="block text-xs text-zinc-500 mb-1">委託先</label>
            <select
              value={contractorId}
              onChange={e => setContractorId(e.target.value)}
              className="rounded-lg border border-zinc-300 bg-white px-3 py-2 text-sm text-zinc-900 outline-none focus:border-zinc-500 min-w-[200px]"
            >
              <option value="">（委託先を選択）</option>
              {contractors.map(c => (
                <option key={c.id} value={c.id}>
                  {c.name}{c.isRegistered ? '' : '（免税）'}
                </option>
              ))}
            </select>
          </div>
        )}
        <p className="text-xs text-zinc-400 pb-2">
          対象月: {yearMonth}
        </p>
      </div>

      {/* 明細テーブル */}
      <div>
        <div className="flex items-center justify-between mb-2">
          <h3 className="text-sm font-semibold text-zinc-700">明細入力</h3>
          <p className="text-xs text-zinc-400">
            ✅ チェックした行のみ集計・登録されます（ノイズ除去）
          </p>
        </div>
        <LineTable lines={lines} onChange={updateLine} onRemove={removeLine} />
        <button
          type="button"
          onClick={addLine}
          className="mt-2 inline-flex items-center gap-1.5 rounded-lg border border-dashed border-zinc-300 bg-white px-3 py-1.5 text-xs text-zinc-500 hover:border-zinc-400 hover:bg-zinc-50 transition"
        >
          + 行を追加
        </button>
      </div>

      {/* プレビュー */}
      {preview && <PreviewCard preview={preview} mode={mode} />}

      {error && (
        <p className="rounded-lg bg-red-50 border border-red-200 px-3 py-2 text-xs text-red-600">{error}</p>
      )}

      {saved && (
        <p className="rounded-lg bg-emerald-50 border border-emerald-200 px-3 py-2 text-xs text-emerald-700">
          ✅ DBに登録しました（チェック {checkedCount} 行）
        </p>
      )}

      {/* 登録ボタン */}
      <button
        type="button"
        onClick={handleSave}
        disabled={saving || !preview || checkedCount === 0 || (mode === 'in' ? !clientId : !contractorId)}
        className="rounded-xl bg-zinc-900 px-6 py-3 text-sm font-bold text-white hover:bg-zinc-700 disabled:opacity-40 transition"
      >
        {saving ? '登録中…' : `✅ チェック ${checkedCount} 行をDBへ登録`}
      </button>
    </div>
  )
}
