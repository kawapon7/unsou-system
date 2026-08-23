'use client'

import { useState, useEffect, useCallback } from 'react'
import { listIssuedDocuments, cancelIssuedDocument, reissueDocument } from '@/app/_actions/document-actions'
import type { IssuedDocumentFilter, IssuedDocumentSummary } from '@/utils/document-search'
import { IssuedDocumentModal } from '@/components/pdf/IssuedDocumentModal'

// ⚠️ 電子帳簿保存法の検索要件: 日付・相手先・金額で絞り込めること。条件は Server Action 側で正規化する。

const yen = (n: number) => `¥${n.toLocaleString('ja-JP')}`
const KIND_LABEL: Record<string, string> = { invoice: '請求書', payment_notice: '支払通知書' }

const EMPTY_FILTER: IssuedDocumentFilter = {
  kind: '', dateFrom: '', dateTo: '', party: '', minAmount: '', maxAmount: '', includeCancelled: false,
}

function Th({ children, right }: { children: React.ReactNode; right?: boolean }) {
  return (
    <th className={`px-4 py-3 text-xs font-medium text-zinc-500 ${right ? 'text-right' : 'text-left'}`}>
      {children}
    </th>
  )
}

function Td({ children, right, bold, muted }: { children: React.ReactNode; right?: boolean; bold?: boolean; muted?: boolean }) {
  return (
    <td className={`px-4 py-3 text-sm ${right ? 'text-right tabular-nums' : ''} ${bold ? 'font-medium text-zinc-900' : muted ? 'text-zinc-500' : 'text-zinc-700'}`}>
      {children}
    </td>
  )
}

const INPUT_CLS = 'rounded-md border border-zinc-300 bg-white px-3 py-2 text-sm text-zinc-900 focus:border-zinc-900 focus:outline-none focus:ring-1 focus:ring-zinc-900'

export default function DocumentsPage() {
  const [filter, setFilter]   = useState<IssuedDocumentFilter>(EMPTY_FILTER)
  const [rows, setRows]       = useState<IssuedDocumentSummary[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError]     = useState<string | null>(null)
  const [busyId, setBusyId]   = useState<string | null>(null)
  const [viewId, setViewId]   = useState<string | null>(null)

  const search = useCallback(async (f: IssuedDocumentFilter) => {
    setLoading(true)
    const res = await listIssuedDocuments(f)
    setLoading(false)
    if (res.error || !res.data) { setError(res.error ?? '取得に失敗しました'); setRows([]); return }
    setError(null)
    setRows(res.data)
  }, [])

  // 初回は非同期完了後にだけ state を触る（effect 内の同期 setState を避ける）
  useEffect(() => {
    let alive = true
    listIssuedDocuments(EMPTY_FILTER).then(res => {
      if (!alive) return
      if (res.error || !res.data) { setError(res.error ?? '取得に失敗しました'); return }
      setRows(res.data)
    })
    return () => { alive = false }
  }, [])

  const set = (k: keyof IssuedDocumentFilter) => (v: string | boolean) => setFilter(f => ({ ...f, [k]: v }))

  const handleCancel = async (r: IssuedDocumentSummary) => {
    const reason = prompt(`${r.documentNumber} を取消します。理由を入力してください（必須）`)
    if (reason === null) return
    setBusyId(r.id)
    const res = await cancelIssuedDocument(r.id, reason)
    setBusyId(null)
    if (res.error) { alert(res.error); return }
    search(filter)
  }

  const handleReissue = async (r: IssuedDocumentSummary) => {
    const reason = prompt(`${r.documentNumber} を取消し、現在のデータで新しい番号を採番して再発行します。理由を入力してください（必須）`)
    if (reason === null) return
    setBusyId(r.id)
    const res = await reissueDocument(r.id, reason)
    setBusyId(null)
    if (res.error || !res.data) { alert(res.error ?? '再発行に失敗しました'); return }
    alert(`再発行しました: ${res.data.documentNumber}`)
    search(filter)
  }

  const issuedCount = rows.filter(r => r.status === 'issued').length
  const issuedTotal = rows.filter(r => r.status === 'issued').reduce((s, r) => s + r.totalAmount, 0)

  return (
    <div className="p-6 max-w-6xl">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-xl font-semibold text-zinc-900">発行控え</h1>
          <p className="text-xs text-zinc-500 mt-1">
            確定発行した請求書・支払通知書の控え。発行当時の様式で再表示できます。訂正は「取消」または「再発行」で行い、上書きはしません。
          </p>
        </div>
      </div>

      <form
        onSubmit={e => { e.preventDefault(); search(filter) }}
        className="rounded-xl bg-white border border-zinc-200 px-5 py-4 mb-6 grid grid-cols-2 md:grid-cols-4 gap-3"
      >
        <label className="block">
          <span className="block text-xs font-medium text-zinc-600 mb-1">種別</span>
          <select value={filter.kind ?? ''} onChange={e => set('kind')(e.target.value)} className={`${INPUT_CLS} w-full`}>
            <option value="">すべて</option>
            <option value="invoice">請求書</option>
            <option value="payment_notice">支払通知書</option>
          </select>
        </label>
        <label className="block">
          <span className="block text-xs font-medium text-zinc-600 mb-1">相手先</span>
          <input type="text" value={filter.party ?? ''} onChange={e => set('party')(e.target.value)} placeholder="部分一致" className={`${INPUT_CLS} w-full`} />
        </label>
        <label className="block">
          <span className="block text-xs font-medium text-zinc-600 mb-1">発行日 から</span>
          <input type="date" value={filter.dateFrom ?? ''} onChange={e => set('dateFrom')(e.target.value)} className={`${INPUT_CLS} w-full`} />
        </label>
        <label className="block">
          <span className="block text-xs font-medium text-zinc-600 mb-1">発行日 まで</span>
          <input type="date" value={filter.dateTo ?? ''} onChange={e => set('dateTo')(e.target.value)} className={`${INPUT_CLS} w-full`} />
        </label>
        <label className="block">
          <span className="block text-xs font-medium text-zinc-600 mb-1">金額 以上</span>
          <input type="text" inputMode="numeric" value={filter.minAmount ?? ''} onChange={e => set('minAmount')(e.target.value)} className={`${INPUT_CLS} w-full`} />
        </label>
        <label className="block">
          <span className="block text-xs font-medium text-zinc-600 mb-1">金額 以下</span>
          <input type="text" inputMode="numeric" value={filter.maxAmount ?? ''} onChange={e => set('maxAmount')(e.target.value)} className={`${INPUT_CLS} w-full`} />
        </label>
        <label className="flex items-end gap-2 pb-2 text-sm text-zinc-700">
          <input type="checkbox" checked={!!filter.includeCancelled} onChange={e => set('includeCancelled')(e.target.checked)} />
          取消済も表示
        </label>
        <div className="flex items-end gap-2">
          <button type="submit" disabled={loading} className="rounded-md bg-zinc-900 hover:bg-zinc-800 disabled:opacity-50 px-4 py-2 text-sm font-medium text-white">
            {loading ? '検索中...' : '検索'}
          </button>
          <button type="button" onClick={() => { setFilter(EMPTY_FILTER); search(EMPTY_FILTER) }} className="rounded-md border border-zinc-300 bg-white hover:bg-zinc-50 px-4 py-2 text-sm text-zinc-700">
            クリア
          </button>
        </div>
      </form>

      <div className="grid grid-cols-2 gap-3 mb-6 max-w-md">
        <div className="rounded-xl bg-white border border-zinc-200 px-5 py-4">
          <p className="text-xs text-zinc-500 mb-1">有効な控え</p>
          <p className="text-xl font-bold text-zinc-900 tabular-nums">{issuedCount} 件</p>
        </div>
        <div className="rounded-xl bg-white border border-zinc-200 px-5 py-4">
          <p className="text-xs text-zinc-500 mb-1">合計（税込）</p>
          <p className="text-xl font-bold text-zinc-900 tabular-nums">{yen(issuedTotal)}</p>
        </div>
      </div>

      {error && <p className="mb-4 text-sm text-red-600">{error}</p>}

      {rows.length === 0 ? (
        <div className="py-16 text-center text-sm text-zinc-400">
          該当する控えがありません。請求書・支払通知書のPDF画面から「確定発行」すると、ここに控えが保存されます。
        </div>
      ) : (
        <div className="overflow-x-auto rounded-lg border border-zinc-200">
          <table className="w-full">
            <thead className="bg-zinc-50 border-b border-zinc-200">
              <tr>
                <Th>番号</Th>
                <Th>種別</Th>
                <Th>相手先</Th>
                <Th>発行日</Th>
                <Th right>金額（税込）</Th>
                <Th>状態</Th>
                <Th>操作</Th>
              </tr>
            </thead>
            <tbody className="divide-y divide-zinc-100">
              {rows.map(r => (
                <tr key={r.id} className="hover:bg-zinc-50">
                  <Td bold>{r.documentNumber}</Td>
                  <Td>{KIND_LABEL[r.kind] ?? r.kind}</Td>
                  <Td>{r.partyName}</Td>
                  <Td muted>{r.documentDate}</Td>
                  <Td right bold>{yen(r.totalAmount)}</Td>
                  <Td>
                    {r.status === 'cancelled' ? (
                      <span className="inline-block rounded px-2 py-0.5 text-xs bg-zinc-100 text-zinc-500" title={r.cancelReason ?? ''}>取消済</span>
                    ) : (
                      <span className="inline-block rounded px-2 py-0.5 text-xs bg-emerald-50 text-emerald-700">発行済</span>
                    )}
                    <span className="block text-[11px] text-zinc-400 mt-0.5">{r.formatKey} v{r.formatVersion}</span>
                  </Td>
                  <td className="px-4 py-3 whitespace-nowrap">
                    <button onClick={() => setViewId(r.id)} className="text-xs text-zinc-700 hover:underline mr-3">表示</button>
                    {r.status === 'issued' && (
                      <>
                        <button onClick={() => handleReissue(r)} disabled={busyId === r.id} className="text-xs text-zinc-700 hover:underline mr-3 disabled:opacity-50">再発行</button>
                        <button onClick={() => handleCancel(r)} disabled={busyId === r.id} className="text-xs text-red-600 hover:underline disabled:opacity-50">取消</button>
                      </>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {viewId && <IssuedDocumentModal id={viewId} onClose={() => setViewId(null)} />}
    </div>
  )
}
