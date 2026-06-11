'use client'

import { useState, useEffect, useCallback } from 'react'
import {
  fetchSalesList,
  fetchClientOptions,
  computeInvoicePreview,
  upsertInvoice,
  updateInvoiceStatus,
  fetchPaymentNoticeSummary,
  type SalesListRow,
  type InvoicePreview,
  type PaymentNoticeSummaryRow,
} from './actions'
import { finalizeInvoiceAndNotice } from '@/app/_actions/billing-actions'
import {
  fetchUnassignedSpots,
  promoteSpotToOfficialProject,
  type SpotGroup,
} from '@/app/_actions/project-actions'

// ── ユーティリティ ────────────────────────────────────────

const yen = (n: number) => `¥${n.toLocaleString('ja-JP')}`

function currentYearMonth() {
  const now = new Date()
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`
}

const TAX_TYPE_LABEL: Record<string, string> = {
  exclusive: '外税',
  inclusive: '内税',
  exempt:    '非課税',
}

const STATUS_META: Record<string, { label: string; cls: string }> = {
  no_invoice: { label: '未請求',   cls: 'bg-zinc-100 text-zinc-500' },
  draft:      { label: '下書き',   cls: 'bg-yellow-50 text-yellow-700' },
  issued:     { label: '請求済',   cls: 'bg-blue-50 text-blue-700' },
  paid:       { label: '入金済',   cls: 'bg-green-50 text-green-700' },
}

// ── 共通 UI ───────────────────────────────────────────────

function Th({ children, right }: { children: React.ReactNode; right?: boolean }) {
  return (
    <th className={`px-4 py-3 text-xs font-medium text-zinc-500 ${right ? 'text-right' : 'text-left'}`}>
      {children}
    </th>
  )
}

function Td({
  children,
  right,
  bold,
  muted,
}: {
  children: React.ReactNode
  right?: boolean
  bold?: boolean
  muted?: boolean
}) {
  return (
    <td
      className={`px-4 py-3 text-sm ${right ? 'text-right' : ''} ${
        bold ? 'font-semibold text-zinc-900' : ''
      } ${muted ? 'text-zinc-400' : 'text-zinc-700'}`}
    >
      {children}
    </td>
  )
}

function SummaryCard({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className="rounded-xl bg-white border border-zinc-200 px-5 py-4">
      <p className="text-xs text-zinc-500 mb-1">{label}</p>
      <p className="text-xl font-bold text-zinc-900 tabular-nums">{value}</p>
      {sub && <p className="text-xs text-zinc-400 mt-0.5">{sub}</p>}
    </div>
  )
}

function StatusBadge({ status }: { status: string }) {
  const meta = STATUS_META[status] ?? { label: status, cls: 'bg-zinc-100 text-zinc-500' }
  return (
    <span className={`inline-block rounded-full px-2 py-0.5 text-xs font-medium ${meta.cls}`}>
      {meta.label}
    </span>
  )
}

// ── 画面①：売上一覧 ──────────────────────────────────────

function SalesListTab({ yearMonth }: { yearMonth: string }) {
  const [rows, setRows]         = useState<SalesListRow[]>([])
  const [loading, setLoading]   = useState(true)
  const [error, setError]       = useState<string | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    const res = await fetchSalesList(yearMonth)
    if (res.error) setError(res.error)
    else setRows(res.data ?? [])
    setLoading(false)
  }, [yearMonth])

  useEffect(() => { load() }, [load])

  const totals = rows.reduce(
    (acc, r) => ({
      net:   acc.net   + r.netAmount,
      tax:   acc.tax   + r.taxAmount,
      total: acc.total + r.totalAmount,
    }),
    { net: 0, tax: 0, total: 0 },
  )
  const paidTotal     = rows.filter(r => r.status === 'paid').reduce((s, r) => s + r.totalAmount, 0)
  const pendingTotal  = rows.filter(r => r.status === 'issued').reduce((s, r) => s + r.totalAmount, 0)

  if (loading) return <div className="py-20 text-center text-sm text-zinc-400">読み込み中...</div>
  if (error)   return <p className="text-sm text-red-600 bg-red-50 rounded-lg px-4 py-3">{error}</p>

  return (
    <div>
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-6">
        <SummaryCard label="荷主数"         value={`${rows.length} 社`} />
        <SummaryCard label="請求合計（税込）" value={yen(totals.total)} sub={`税抜 ${yen(totals.net)}`} />
        <SummaryCard label="入金済"           value={yen(paidTotal)}   />
        <SummaryCard label="未入金（請求済）" value={yen(pendingTotal)} />
      </div>

      {rows.length === 0 ? (
        <div className="py-16 text-center text-sm text-zinc-400">対象データがありません</div>
      ) : (
        <div className="overflow-x-auto rounded-lg border border-zinc-200">
          <table className="w-full">
            <thead className="bg-zinc-50 border-b border-zinc-200">
              <tr>
                <Th>荷主名</Th>
                <Th>消費税区分</Th>
                <Th>締め日</Th>
                <Th>入金予定日</Th>
                <Th>ステータス</Th>
                <Th right>税抜金額</Th>
                <Th right>消費税</Th>
                <Th right>請求金額（税込）</Th>
              </tr>
            </thead>
            <tbody className="divide-y divide-zinc-100">
              {rows.map(r => (
                <tr key={r.clientId} className="hover:bg-zinc-50">
                  <Td bold>{r.companyName}</Td>
                  <Td>
                    <span className="rounded-full bg-zinc-100 px-2 py-0.5 text-xs text-zinc-600">
                      {TAX_TYPE_LABEL[r.taxType] ?? r.taxType}
                    </span>
                  </Td>
                  <Td muted>
                    {r.closingDay === '月末' || r.closingDay === '末日' || r.closingDay === '99'
                      ? '月末締め'
                      : `${r.closingDay}日締め`}
                  </Td>
                  <Td muted>{r.dueDate || '—'}</Td>
                  <Td><StatusBadge status={r.status} /></Td>
                  <Td right>{r.netAmount > 0 ? yen(r.netAmount) : <span className="text-zinc-300">—</span>}</Td>
                  <Td right muted={r.taxType === 'exempt'}>
                    {r.taxAmount > 0 ? yen(r.taxAmount) : <span className="text-zinc-300">—</span>}
                  </Td>
                  <Td right bold>
                    {r.totalAmount > 0 ? yen(r.totalAmount) : <span className="text-zinc-400">（未集計）</span>}
                  </Td>
                </tr>
              ))}
            </tbody>
            <tfoot className="border-t-2 border-zinc-200 bg-zinc-50">
              <tr>
                <td colSpan={5} className="px-4 py-3 text-xs font-semibold text-zinc-500">合計</td>
                <Td right bold>{yen(totals.net)}</Td>
                <Td right bold>{yen(totals.tax)}</Td>
                <Td right bold>{yen(totals.total)}</Td>
              </tr>
            </tfoot>
          </table>
        </div>
      )}
    </div>
  )
}

// ── 請求書プレビューコンポーネント ────────────────────────

function InvoicePreviewCard({
  data,
  onConfirm,
  confirming,
  onPrint,
}: {
  data: InvoicePreview
  onConfirm: () => void
  confirming: boolean
  onPrint: () => void
}) {
  const TAX_LABEL = TAX_TYPE_LABEL[data.taxType] ?? data.taxType

  return (
    <div className="rounded-xl border border-zinc-200 bg-white overflow-hidden">
      {/* ヘッダー */}
      <div className="border-b border-zinc-200 bg-zinc-50 px-6 py-4 flex flex-wrap items-center justify-between gap-3">
        <div>
          <p className="text-xs text-zinc-500">請求書プレビュー</p>
          <p className="text-lg font-semibold text-zinc-900">{data.companyName} 御中</p>
          <p className="text-sm text-zinc-500">{data.invoiceMonth} 分 ／ 入金予定日：{data.dueDate}</p>
        </div>
        <div className="flex gap-2 flex-wrap">
          <button
            onClick={onPrint}
            className="flex items-center gap-1.5 rounded-lg border border-zinc-300 bg-white px-4 py-2 text-sm font-medium text-zinc-700 hover:bg-zinc-50 transition"
          >
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" strokeWidth={1.6} stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" d="M6.72 13.829c-.24.03-.48.062-.72.096m.72-.096a42.415 42.415 0 0 1 10.56 0m-10.56 0L6.34 18m10.94-4.171c.24.03.48.062.72.096m-.72-.096L17.66 18m0 0 .229 2.523a1.125 1.125 0 0 1-1.12 1.227H7.231c-.662 0-1.18-.568-1.12-1.227L6.34 18m11.318 0h1.091A2.25 2.25 0 0 0 21 15.75V9.456c0-1.081-.768-2.015-1.837-2.175a48.055 48.055 0 0 0-1.913-.247M6.34 18H5.25A2.25 2.25 0 0 1 3 15.75V9.456c0-1.081.768-2.015 1.837-2.175a48.056 48.056 0 0 1 1.913-.247m10.5 0a48.536 48.536 0 0 0-10.5 0m10.5 0V3.375c0-.621-.504-1.125-1.125-1.125h-8.25c-.621 0-1.125.504-1.125 1.125v3.659M18 10.5h.008v.008H18V10.5Zm-3 0h.008v.008H15V10.5Z" />
            </svg>
            PDF出力
          </button>
          <button
            onClick={onConfirm}
            disabled={confirming || data.lines.length === 0}
            className="flex items-center gap-1.5 rounded-lg bg-zinc-900 px-4 py-2 text-sm font-medium text-white hover:bg-zinc-700 disabled:opacity-50 disabled:cursor-not-allowed transition"
          >
            {confirming ? '処理中...' : (data.existingInvoiceId ? '再確定（更新）' : '請求書を確定')}
          </button>
        </div>
      </div>

      {/* 既存ステータス */}
      {data.invoiceStatus && (
        <div className="px-6 py-3 bg-blue-50 border-b border-blue-100 flex items-center gap-2 text-sm text-blue-700">
          <StatusBadge status={data.invoiceStatus} />
          <span>この月の請求書は既にDBに保存されています。「再確定」で上書きできます。</span>
        </div>
      )}

      {/* 明細テーブル */}
      {data.lines.length === 0 ? (
        <div className="py-12 text-center text-sm text-zinc-400">
          対象期間に勤務記録がありません
        </div>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead className="bg-zinc-50 border-b border-zinc-200">
              <tr>
                <Th>稼働日</Th>
                <Th>案件コード</Th>
                <Th>案件名</Th>
                <Th right>数量</Th>
                <Th right>金額（税抜）</Th>
                <Th>備考</Th>
              </tr>
            </thead>
            <tbody className="divide-y divide-zinc-100">
              {data.lines.map((l, i) => (
                <tr key={i} className="hover:bg-zinc-50">
                  <Td muted>{l.workDate}</Td>
                  <Td muted>{l.projectCode}</Td>
                  <Td>{l.projectName}</Td>
                  <Td right>{l.quantity.toLocaleString('ja-JP')}</Td>
                  <Td right>{yen(l.netAmount)}</Td>
                  <Td muted>{l.memo ?? '—'}</Td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* 合計欄 */}
      <div className="border-t border-zinc-200 bg-zinc-50 px-6 py-4 flex justify-end">
        <div className="w-64 space-y-1.5 text-sm">
          <div className="flex justify-between text-zinc-600">
            <span>小計（税抜）</span>
            <span className="tabular-nums">{yen(data.netTotal)}</span>
          </div>
          <div className="flex justify-between text-zinc-600">
            <span>消費税（{TAX_LABEL}・10%）</span>
            <span className="tabular-nums">{yen(data.taxTotal)}</span>
          </div>
          <div className="flex justify-between font-bold text-zinc-900 border-t border-zinc-300 pt-1.5 mt-1.5">
            <span>請求金額合計</span>
            <span className="tabular-nums text-base">{yen(data.grandTotal)}</span>
          </div>
        </div>
      </div>

      {/* 消費税計算注記 */}
      <div className="px-6 py-3 border-t border-zinc-100 text-xs text-zinc-400">
        ※ 消費税は仕様書 3-5 準拠：税抜合計に対して一括計算（四捨五入1回）
      </div>
    </div>
  )
}

// ── 画面②：請求書生成 ────────────────────────────────────

function InvoiceGenerateTab({ yearMonth }: { yearMonth: string }) {
  const [clientOptions, setClientOptions] = useState<{ id: string; company_name: string }[]>([])
  const [selectedClientId, setSelectedClientId] = useState('')
  const [targetMonth, setTargetMonth]           = useState(yearMonth)
  const [preview, setPreview]                   = useState<InvoicePreview | null>(null)
  const [loadingPreview, setLoadingPreview]     = useState(false)
  const [confirming, setConfirming]             = useState(false)
  const [message, setMessage]                   = useState<{ type: 'ok' | 'err'; text: string } | null>(null)

  useEffect(() => {
    fetchClientOptions().then(res => {
      if (!res.error) setClientOptions(res.data ?? [])
    })
  }, [])

  const handlePreview = async () => {
    if (!selectedClientId) return
    setLoadingPreview(true)
    setMessage(null)
    const res = await computeInvoicePreview(selectedClientId, targetMonth)
    if (res.error) setMessage({ type: 'err', text: res.error })
    else setPreview(res.data)
    setLoadingPreview(false)
  }

  const handleConfirm = async () => {
    if (!selectedClientId) return
    setConfirming(true)
    setMessage(null)
    const res = await upsertInvoice(selectedClientId, targetMonth)
    if (res.error) {
      setMessage({ type: 'err', text: res.error })
    } else {
      setMessage({ type: 'ok', text: '請求書をDBに保存しました。' })
      // プレビューを再取得してステータスを反映
      const refreshed = await computeInvoicePreview(selectedClientId, targetMonth)
      if (!refreshed.error) setPreview(refreshed.data)
    }
    setConfirming(false)
  }

  const handlePrint = () => {
    if (!selectedClientId || !targetMonth) return
    window.open(
      `/api/hibiki/invoice/html?clientId=${encodeURIComponent(selectedClientId)}&month=${encodeURIComponent(targetMonth)}`,
      '_blank',
    )
  }

  return (
    <div className="space-y-5">
      {/* 選択フォーム */}
      <div className="rounded-xl border border-zinc-200 bg-white p-5">
        <p className="text-sm font-medium text-zinc-700 mb-4">請求書を生成する荷主と対象月を選択してください</p>
        <div className="flex flex-wrap items-end gap-3">
          <div className="flex-1 min-w-40">
            <label className="block text-xs text-zinc-500 mb-1">荷主</label>
            <select
              value={selectedClientId}
              onChange={e => { setSelectedClientId(e.target.value); setPreview(null) }}
              className="w-full rounded-md border border-zinc-300 bg-white px-3 py-2 text-sm text-zinc-900 outline-none focus:border-zinc-500 focus:ring-1 focus:ring-zinc-300"
            >
              <option value="">荷主を選択...</option>
              {clientOptions.map(c => (
                <option key={c.id} value={c.id}>{c.company_name}</option>
              ))}
            </select>
          </div>
          <div>
            <label className="block text-xs text-zinc-500 mb-1">対象月</label>
            <input
              type="month"
              value={targetMonth}
              onChange={e => { setTargetMonth(e.target.value); setPreview(null) }}
              className="rounded-md border border-zinc-300 bg-white px-3 py-2 text-sm text-zinc-900 outline-none focus:border-zinc-500 focus:ring-1 focus:ring-zinc-300"
            />
          </div>
          <button
            onClick={handlePreview}
            disabled={!selectedClientId || loadingPreview}
            className="rounded-lg bg-zinc-900 px-5 py-2 text-sm font-medium text-white hover:bg-zinc-700 disabled:opacity-50 disabled:cursor-not-allowed transition"
          >
            {loadingPreview ? '計算中...' : 'プレビュー'}
          </button>
        </div>
      </div>

      {message && (
        <p className={`rounded-lg px-4 py-3 text-sm ${
          message.type === 'ok'
            ? 'bg-green-50 text-green-700 border border-green-200'
            : 'bg-red-50 text-red-600'
        }`}>
          {message.text}
        </p>
      )}

      {preview && (
        <InvoicePreviewCard
          data={preview}
          onConfirm={handleConfirm}
          confirming={confirming}
          onPrint={handlePrint}
        />
      )}
    </div>
  )
}

// ── 画面③：入金管理 ──────────────────────────────────────

function PaymentStatusTab({ yearMonth }: { yearMonth: string }) {
  const [rows, setRows]       = useState<SalesListRow[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError]     = useState<string | null>(null)
  const [updating, setUpdating] = useState<string | null>(null)
  const [message, setMessage] = useState<{ type: 'ok' | 'err'; text: string } | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    const res = await fetchSalesList(yearMonth)
    if (res.error) setError(res.error)
    else setRows((res.data ?? []).filter(r => r.invoiceId !== null))
    setLoading(false)
  }, [yearMonth])

  useEffect(() => { load() }, [load])

  const handleUpdateStatus = async (invoiceId: string, newStatus: 'issued' | 'paid') => {
    setUpdating(invoiceId)
    setMessage(null)
    const res = await updateInvoiceStatus(invoiceId, newStatus)
    if (res.error) {
      setMessage({ type: 'err', text: res.error })
    } else {
      setMessage({
        type: 'ok',
        text: newStatus === 'paid' ? '入金済に更新しました。' : '未入金（請求済）に戻しました。',
      })
      await load()
    }
    setUpdating(null)
  }

  if (loading) return <div className="py-20 text-center text-sm text-zinc-400">読み込み中...</div>
  if (error)   return <p className="text-sm text-red-600 bg-red-50 rounded-lg px-4 py-3">{error}</p>

  const issuedCount = rows.filter(r => r.status === 'issued').length
  const paidCount   = rows.filter(r => r.status === 'paid').length
  const paidAmount  = rows.filter(r => r.status === 'paid').reduce((s, r) => s + r.totalAmount, 0)
  const pendingAmount = rows.filter(r => r.status === 'issued').reduce((s, r) => s + r.totalAmount, 0)

  return (
    <div className="space-y-5">
      {message && (
        <p className={`rounded-lg px-4 py-3 text-sm ${
          message.type === 'ok'
            ? 'bg-green-50 text-green-700 border border-green-200'
            : 'bg-red-50 text-red-600'
        }`}>
          {message.text}
        </p>
      )}

      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <SummaryCard label="請求書あり"   value={`${rows.length} 件`} />
        <SummaryCard label="未入金"        value={`${issuedCount} 件`} sub={yen(pendingAmount)} />
        <SummaryCard label="入金済"        value={`${paidCount} 件`}   sub={yen(paidAmount)} />
        <SummaryCard label="入金率"        value={rows.length > 0 ? `${Math.round((paidCount / rows.length) * 100)}%` : '—'} />
      </div>

      {rows.length === 0 ? (
        <div className="py-16 text-center text-sm text-zinc-400">
          請求書がありません。「請求書生成」タブから請求書を確定してください。
        </div>
      ) : (
        <div className="overflow-x-auto rounded-lg border border-zinc-200">
          <table className="w-full">
            <thead className="bg-zinc-50 border-b border-zinc-200">
              <tr>
                <Th>荷主名</Th>
                <Th>入金予定日</Th>
                <Th>ステータス</Th>
                <Th right>請求金額（税込）</Th>
                <Th>操作</Th>
              </tr>
            </thead>
            <tbody className="divide-y divide-zinc-100">
              {rows.map(r => (
                <tr key={r.invoiceId} className="hover:bg-zinc-50">
                  <Td bold>{r.companyName}</Td>
                  <Td muted>{r.dueDate || '—'}</Td>
                  <Td><StatusBadge status={r.status} /></Td>
                  <Td right bold>{yen(r.totalAmount)}</Td>
                  <td className="px-4 py-3">
                    {r.status === 'issued' && (
                      <button
                        onClick={() => handleUpdateStatus(r.invoiceId!, 'paid')}
                        disabled={updating === r.invoiceId}
                        className="rounded-lg bg-green-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-green-500 disabled:opacity-50 transition"
                      >
                        {updating === r.invoiceId ? '更新中...' : '✅ 入金済にする'}
                      </button>
                    )}
                    {r.status === 'paid' && (
                      <button
                        onClick={() => handleUpdateStatus(r.invoiceId!, 'issued')}
                        disabled={updating === r.invoiceId}
                        className="rounded-lg border border-zinc-300 px-3 py-1.5 text-xs font-medium text-zinc-600 hover:bg-zinc-50 disabled:opacity-50 transition"
                      >
                        {updating === r.invoiceId ? '更新中...' : '取り消す'}
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}

// ── 確定・ロック管理タブ ──────────────────────────────────

const NOTICE_STATUS_META: Record<string, { label: string; cls: string }> = {
  pending:  { label: '未確定',   cls: 'bg-zinc-100 text-zinc-500' },
  approved: { label: '承認済',   cls: 'bg-blue-50 text-blue-700' },
  locked:   { label: 'ロック済', cls: 'bg-red-50 text-red-700' },
}

const INVOICE_TYPE_LABEL: Record<string, string> = {
  registered:   'インボイス登録済',
  unregistered: '未登録（経過措置）',
}

function Toast({ msg, onClose }: { msg: { type: 'ok' | 'err'; text: string }; onClose: () => void }) {
  return (
    <div
      className={`fixed bottom-6 right-6 z-50 flex items-start gap-3 rounded-xl px-5 py-4 shadow-lg text-sm max-w-md ${
        msg.type === 'ok'
          ? 'bg-green-50 border border-green-200 text-green-800'
          : 'bg-red-50 border border-red-200 text-red-800'
      }`}
    >
      <span className="flex-1">{msg.text}</span>
      <button onClick={onClose} className="text-current opacity-50 hover:opacity-100 shrink-0">✕</button>
    </div>
  )
}

function FinalizeTab({ yearMonth }: { yearMonth: string }) {
  const [invoiceRows,   setInvoiceRows]   = useState<SalesListRow[]>([])
  const [noticeRows,    setNoticeRows]    = useState<PaymentNoticeSummaryRow[]>([])
  const [loading,       setLoading]       = useState(true)
  const [processing,    setProcessing]    = useState<string | null>(null)
  const [toast,         setToast]         = useState<{ type: 'ok' | 'err'; text: string } | null>(null)
  // per-row unlock UI state: key = clientId or contractorId
  const [unlockOpen,    setUnlockOpen]    = useState<Record<string, boolean>>({})
  const [unlockReasons, setUnlockReasons] = useState<Record<string, string>>({})

  const showToast = (type: 'ok' | 'err', text: string) => {
    setToast({ type, text })
    setTimeout(() => setToast(null), 5000)
  }

  const load = useCallback(async () => {
    setLoading(true)
    const [invRes, noticeRes] = await Promise.all([
      fetchSalesList(yearMonth),
      fetchPaymentNoticeSummary(yearMonth),
    ])
    if (!invRes.error)    setInvoiceRows(invRes.data ?? [])
    if (!noticeRes.error) setNoticeRows(noticeRes.data ?? [])
    setLoading(false)
  }, [yearMonth])

  useEffect(() => { load() }, [load])

  // ── 請求書確定 ───────────────────────────────────────────
  const handleFinalizeInvoice = async (
    clientId: string,
    opts?: { isDeveloperUnlock: boolean; unlockReason: string },
  ) => {
    setProcessing(clientId)
    const res = await finalizeInvoiceAndNotice({
      type:     'invoice',
      yearMonth,
      clientId,
      ...opts,
    })
    if (res.error) {
      showToast('err', res.error)
    } else {
      showToast('ok', '請求書を確定しました。')
      setUnlockOpen(p => ({ ...p, [clientId]: false }))
      await load()
    }
    setProcessing(null)
  }

  // ── 支払通知書確定ロック ─────────────────────────────────
  const handleFinalizeNotice = async (
    contractorId: string,
    opts?: { isDeveloperUnlock: boolean; unlockReason: string },
  ) => {
    setProcessing(contractorId)
    const res = await finalizeInvoiceAndNotice({
      type: 'payment_notice',
      yearMonth,
      contractorId,
      ...opts,
    })
    if (res.error) {
      showToast('err', res.error)
    } else {
      showToast('ok', '支払通知書を確定ロックしました。')
      setUnlockOpen(p => ({ ...p, [contractorId]: false }))
      await load()
    }
    setProcessing(null)
  }

  if (loading) return <div className="py-20 text-center text-sm text-zinc-400">読み込み中...</div>

  return (
    <div className="space-y-8">
      {toast && <Toast msg={toast} onClose={() => setToast(null)} />}

      {/* ── 請求書確定セクション ─────────────────────────── */}
      <section>
        <h2 className="text-sm font-semibold text-zinc-700 mb-3">請求書の確定（荷主向け）</h2>
        <div className="rounded-lg border border-zinc-200 overflow-x-auto">
          <table className="w-full">
            <thead className="bg-zinc-50 border-b border-zinc-200">
              <tr>
                <Th>荷主名</Th>
                <Th>ステータス</Th>
                <Th right>税抜金額</Th>
                <Th right>消費税</Th>
                <Th right>請求金額</Th>
                <Th>操作</Th>
              </tr>
            </thead>
            <tbody className="divide-y divide-zinc-100">
              {invoiceRows.length === 0 && (
                <tr>
                  <td colSpan={6} className="px-4 py-10 text-center text-sm text-zinc-400">
                    対象データがありません
                  </td>
                </tr>
              )}
              {invoiceRows.map(r => {
                const isLocked = r.status === 'issued' || r.status === 'paid'
                const isOpen   = unlockOpen[r.clientId] ?? false
                const reason   = unlockReasons[r.clientId] ?? ''
                const busy     = processing === r.clientId

                return (
                  <tr key={r.clientId} className="hover:bg-zinc-50">
                    <Td bold>{r.companyName}</Td>
                    <Td><StatusBadge status={r.status} /></Td>
                    <Td right>{yen(r.netAmount)}</Td>
                    <Td right muted>{yen(r.taxAmount)}</Td>
                    <Td right bold>{yen(r.totalAmount)}</Td>
                    <td className="px-4 py-3 space-y-2">
                      {!isLocked ? (
                        <button
                          onClick={() => handleFinalizeInvoice(r.clientId)}
                          disabled={busy}
                          className="rounded-lg bg-zinc-900 px-3 py-1.5 text-xs font-medium text-white hover:bg-zinc-700 disabled:opacity-50 transition"
                        >
                          {busy ? '処理中...' : '請求書を確定する'}
                        </button>
                      ) : (
                        <div className="space-y-1.5">
                          <span className="inline-block rounded-full bg-red-50 px-2.5 py-1 text-xs font-medium text-red-700">
                            🔒 ロック済み
                          </span>
                          <button
                            onClick={() => setUnlockOpen(p => ({ ...p, [r.clientId]: !isOpen }))}
                            className="block text-xs text-zinc-400 hover:text-zinc-700 underline"
                          >
                            {isOpen ? '▲ 閉じる' : '▼ 強制アンロック'}
                          </button>
                          {isOpen && (
                            <div className="flex items-center gap-2 mt-1">
                              <input
                                type="text"
                                placeholder="アンロック理由を入力（必須）"
                                value={reason}
                                onChange={e => setUnlockReasons(p => ({ ...p, [r.clientId]: e.target.value }))}
                                className="rounded-md border border-zinc-300 px-2.5 py-1.5 text-xs w-52 outline-none focus:border-zinc-500 focus:ring-1 focus:ring-zinc-300"
                              />
                              <button
                                onClick={() => handleFinalizeInvoice(r.clientId, { isDeveloperUnlock: true, unlockReason: reason })}
                                disabled={!reason.trim() || busy}
                                className="rounded-lg bg-red-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-red-500 disabled:opacity-40 transition whitespace-nowrap"
                              >
                                {busy ? '処理中...' : '強制アンロック再確定'}
                              </button>
                            </div>
                          )}
                        </div>
                      )}
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      </section>

      {/* ── 支払通知書確定セクション ─────────────────────── */}
      <section>
        <h2 className="text-sm font-semibold text-zinc-700 mb-3">支払通知書の確定ロック（委託先向け）</h2>
        <div className="rounded-lg border border-zinc-200 overflow-x-auto">
          <table className="w-full">
            <thead className="bg-zinc-50 border-b border-zinc-200">
              <tr>
                <Th>委託先名</Th>
                <Th>インボイス区分</Th>
                <Th right>労務報酬（税抜）</Th>
                <Th right>立替金（税抜）</Th>
                <Th right>経過措置控除</Th>
                <Th right>最終支払額</Th>
                <Th>ステータス</Th>
                <Th>操作</Th>
              </tr>
            </thead>
            <tbody className="divide-y divide-zinc-100">
              {noticeRows.length === 0 && (
                <tr>
                  <td colSpan={8} className="px-4 py-10 text-center text-sm text-zinc-400">
                    対象データがありません
                  </td>
                </tr>
              )}
              {noticeRows.map(r => {
                const isLocked = r.approvalStatus === 'approved' || r.locked
                const statusKey = r.locked ? 'locked' : r.approvalStatus
                const statusMeta = NOTICE_STATUS_META[statusKey] ?? NOTICE_STATUS_META.pending
                const isOpen = unlockOpen[r.contractorId] ?? false
                const reason = unlockReasons[r.contractorId] ?? ''
                const busy   = processing === r.contractorId

                return (
                  <tr key={r.contractorId} className="hover:bg-zinc-50">
                    <Td bold>{r.name}</Td>
                    <Td>
                      <span className="text-xs text-zinc-500">
                        {INVOICE_TYPE_LABEL[r.invoiceType] ?? r.invoiceType}
                      </span>
                    </Td>
                    <Td right>{yen(r.laborNet)}</Td>
                    <Td right muted>{yen(r.expenseNet)}</Td>
                    <Td right>
                      {r.deduction > 0 ? (
                        <span className="text-amber-700">▲{yen(r.deduction)}</span>
                      ) : (
                        <span className="text-zinc-300">—</span>
                      )}
                    </Td>
                    <Td right bold>{yen(r.totalAmount)}</Td>
                    <td className="px-4 py-3">
                      <span className={`inline-block rounded-full px-2 py-0.5 text-xs font-medium ${statusMeta.cls}`}>
                        {statusMeta.label}
                      </span>
                    </td>
                    <td className="px-4 py-3 space-y-2">
                      {!isLocked ? (
                        <button
                          onClick={() => handleFinalizeNotice(r.contractorId)}
                          disabled={busy}
                          className="rounded-lg bg-zinc-900 px-3 py-1.5 text-xs font-medium text-white hover:bg-zinc-700 disabled:opacity-50 transition"
                        >
                          {busy ? '処理中...' : '支払通知書を確定ロック'}
                        </button>
                      ) : (
                        <div className="space-y-1.5">
                          <span className="inline-block rounded-full bg-red-50 px-2.5 py-1 text-xs font-medium text-red-700">
                            🔒 ロック済み
                          </span>
                          <button
                            onClick={() => setUnlockOpen(p => ({ ...p, [r.contractorId]: !isOpen }))}
                            className="block text-xs text-zinc-400 hover:text-zinc-700 underline"
                          >
                            {isOpen ? '▲ 閉じる' : '▼ 強制アンロック'}
                          </button>
                          {isOpen && (
                            <div className="flex items-center gap-2 mt-1">
                              <input
                                type="text"
                                placeholder="アンロック理由を入力（必須）"
                                value={reason}
                                onChange={e => setUnlockReasons(p => ({ ...p, [r.contractorId]: e.target.value }))}
                                className="rounded-md border border-zinc-300 px-2.5 py-1.5 text-xs w-52 outline-none focus:border-zinc-500 focus:ring-1 focus:ring-zinc-300"
                              />
                              <button
                                onClick={() => handleFinalizeNotice(r.contractorId, { isDeveloperUnlock: true, unlockReason: reason })}
                                disabled={!reason.trim() || busy}
                                className="rounded-lg bg-red-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-red-500 disabled:opacity-40 transition whitespace-nowrap"
                              >
                                {busy ? '処理中...' : '強制アンロック再確定'}
                              </button>
                            </div>
                          )}
                        </div>
                      )}
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
        <p className="mt-2 text-xs text-zinc-400">
          ※ 経過措置控除: インボイス未登録業者への支払額から差し引く金額（現在フェーズ: 2%）
        </p>
      </section>
    </div>
  )
}

// ── ⑤ スポット案件ガードレール ────────────────────────────

const UNIT_TYPE_OPTIONS = [
  { value: 'per_trip', label: '1件単位' },
  { value: 'per_day',  label: '1日単位' },
  { value: 'per_km',   label: 'km単価' },
]

type PromoteForm = {
  clientId:    string
  projectName: string
  saleAmount:  string
  buyAmount:   string
  unitType:    string
}

function SpotGuardrailTab() {
  const [spots, setSpots]     = useState<SpotGroup[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError]     = useState<string | null>(null)
  const [toast, setToast]     = useState<{ message: string; type: 'success' | 'error' } | null>(null)

  // 荷主オプション
  const [clientOpts, setClientOpts] = useState<{ id: string; company_name: string }[]>([])

  // インラインフォームの開閉：key = spotGenericId
  const [openForm, setOpenForm] = useState<Record<string, boolean>>({})
  const [forms, setForms] = useState<Record<string, PromoteForm>>({})
  const [promoting, setPromoting] = useState<Record<string, boolean>>({})

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    const [spotRes, clientRes] = await Promise.all([
      fetchUnassignedSpots(),
      fetchClientOptions(),
    ])
    if (spotRes.error)   setError(spotRes.error)
    else                 setSpots(spotRes.data ?? [])
    if (!clientRes.error) setClientOpts(clientRes.data ?? [])
    setLoading(false)
  }, [])

  useEffect(() => { load() }, [load])

  useEffect(() => {
    if (toast) {
      const t = setTimeout(() => setToast(null), 5000)
      return () => clearTimeout(t)
    }
  }, [toast])

  function toggleForm(id: string) {
    setOpenForm(prev => ({ ...prev, [id]: !prev[id] }))
    setForms(prev => ({
      ...prev,
      [id]: prev[id] ?? { clientId: '', projectName: id, saleAmount: '', buyAmount: '', unitType: 'per_trip' },
    }))
  }

  function updateForm(id: string, patch: Partial<PromoteForm>) {
    setForms(prev => ({ ...prev, [id]: { ...prev[id], ...patch } }))
  }

  async function handlePromote(spot: SpotGroup) {
    const form = forms[spot.spotGenericId]
    if (!form?.clientId || !form.projectName || !form.saleAmount || !form.buyAmount) {
      setToast({ message: '荷主・案件名・売値・買値は必須です', type: 'error' })
      return
    }
    setPromoting(prev => ({ ...prev, [spot.spotGenericId]: true }))
    const res = await promoteSpotToOfficialProject({
      spotGenericId: spot.spotGenericId,
      clientId:      form.clientId,
      projectName:   form.projectName,
      saleAmount:    Number(form.saleAmount),
      buyAmount:     Number(form.buyAmount),
      unitType:      form.unitType,
    })
    setPromoting(prev => ({ ...prev, [spot.spotGenericId]: false }))

    if (res.error) {
      setToast({ message: res.error, type: 'error' })
    } else {
      setToast({
        message: `「${form.projectName}」として昇格完了（${res.data?.updatedCount ?? 0}件の記録を紐付け）`,
        type: 'success',
      })
      setOpenForm(prev => ({ ...prev, [spot.spotGenericId]: false }))
      await load()
    }
  }

  return (
    <div>
      <div className="mb-6">
        <h2 className="text-base font-bold text-zinc-900 mb-1">スポット案件ガードレール</h2>
        <p className="text-sm text-zinc-500">
          案件マスタ未紐付けのスポット記録を検知します。ボタン一発で正式案件マスタへ昇格・過去実績を一括紐付けします。
        </p>
      </div>

      {error && (
        <div className="mb-4 rounded-lg bg-red-50 border border-red-200 px-4 py-3 text-sm text-red-700">{error}</div>
      )}

      {loading ? (
        <div className="py-20 text-center text-sm text-zinc-400">読み込み中...</div>
      ) : spots.length === 0 ? (
        <div className="py-20 text-center rounded-xl border border-dashed border-zinc-200 bg-white">
          <p className="text-zinc-400 text-sm">未紐付けのスポット案件はありません ✅</p>
        </div>
      ) : (
        <div className="space-y-4">
          {spots.map(spot => {
            const isOpen     = !!openForm[spot.spotGenericId]
            const form       = forms[spot.spotGenericId] ?? { clientId: '', projectName: spot.spotGenericId, saleAmount: '', buyAmount: '', unitType: 'per_trip' }
            const isPromoting = !!promoting[spot.spotGenericId]
            const canSubmit  = form.clientId && form.projectName && form.saleAmount && form.buyAmount

            return (
              <div key={spot.spotGenericId} className="rounded-xl border border-amber-200 bg-amber-50 overflow-hidden">
                {/* 概要行 */}
                <div className="flex items-start justify-between gap-4 px-5 py-4">
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2 mb-1.5">
                      <span className="inline-block rounded-full bg-amber-200 text-amber-800 text-xs font-semibold px-2 py-0.5">
                        未紐付け
                      </span>
                      <code className="text-sm font-mono text-zinc-700 truncate">{spot.spotGenericId}</code>
                    </div>
                    <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-zinc-500">
                      <span>{spot.recordCount}件の記録</span>
                      <span>{spot.earliestDate} 〜 {spot.latestDate}</span>
                      <span>担当: {spot.contractorNames.join('、') || '—'}</span>
                    </div>
                    <div className="flex gap-4 mt-1.5 text-xs font-medium">
                      <span className="text-zinc-600">売上合計 <span className="text-zinc-900">{yen(spot.totalSales)}</span></span>
                      <span className="text-zinc-600">支払合計 <span className="text-zinc-900">{yen(spot.totalPayment)}</span></span>
                    </div>
                  </div>
                  <button
                    onClick={() => toggleForm(spot.spotGenericId)}
                    className={`shrink-0 rounded-lg px-4 py-2 text-sm font-medium transition ${
                      isOpen
                        ? 'bg-zinc-200 text-zinc-700 hover:bg-zinc-300'
                        : 'bg-amber-600 text-white hover:bg-amber-500'
                    }`}
                  >
                    {isOpen ? 'キャンセル' : 'マスタへ昇格'}
                  </button>
                </div>

                {/* インラインフォーム */}
                {isOpen && (
                  <div className="border-t border-amber-200 bg-white px-5 py-5">
                    <h3 className="text-sm font-semibold text-zinc-800 mb-4">正式案件マスタの情報を入力</h3>
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 mb-4">
                      {/* 荷主 */}
                      <div>
                        <label className="block text-xs font-medium text-zinc-600 mb-1">荷主 <span className="text-red-500">*</span></label>
                        <select
                          value={form.clientId}
                          onChange={e => updateForm(spot.spotGenericId, { clientId: e.target.value })}
                          className="w-full rounded-md border border-zinc-300 bg-white px-3 py-2 text-sm outline-none focus:border-zinc-500"
                        >
                          <option value="">選択してください</option>
                          {clientOpts.map(c => (
                            <option key={c.id} value={c.id}>{c.company_name}</option>
                          ))}
                        </select>
                      </div>
                      {/* 案件名 */}
                      <div>
                        <label className="block text-xs font-medium text-zinc-600 mb-1">案件名 <span className="text-red-500">*</span></label>
                        <input
                          type="text"
                          value={form.projectName}
                          onChange={e => updateForm(spot.spotGenericId, { projectName: e.target.value })}
                          placeholder="例：○○倉庫→△△港 定期便"
                          className="w-full rounded-md border border-zinc-300 px-3 py-2 text-sm outline-none focus:border-zinc-500"
                        />
                      </div>
                      {/* 売値 */}
                      <div>
                        <label className="block text-xs font-medium text-zinc-600 mb-1">売値（税抜） <span className="text-red-500">*</span></label>
                        <input
                          type="number"
                          min={0}
                          value={form.saleAmount}
                          onChange={e => updateForm(spot.spotGenericId, { saleAmount: e.target.value })}
                          placeholder="30000"
                          className="w-full rounded-md border border-zinc-300 px-3 py-2 text-sm outline-none focus:border-zinc-500"
                        />
                      </div>
                      {/* 買値 */}
                      <div>
                        <label className="block text-xs font-medium text-zinc-600 mb-1">買値（税抜） <span className="text-red-500">*</span></label>
                        <input
                          type="number"
                          min={0}
                          value={form.buyAmount}
                          onChange={e => updateForm(spot.spotGenericId, { buyAmount: e.target.value })}
                          placeholder="25000"
                          className="w-full rounded-md border border-zinc-300 px-3 py-2 text-sm outline-none focus:border-zinc-500"
                        />
                      </div>
                      {/* 計算方式 */}
                      <div>
                        <label className="block text-xs font-medium text-zinc-600 mb-1">計算方式</label>
                        <select
                          value={form.unitType}
                          onChange={e => updateForm(spot.spotGenericId, { unitType: e.target.value })}
                          className="w-full rounded-md border border-zinc-300 bg-white px-3 py-2 text-sm outline-none focus:border-zinc-500"
                        >
                          {UNIT_TYPE_OPTIONS.map(o => (
                            <option key={o.value} value={o.value}>{o.label}</option>
                          ))}
                        </select>
                      </div>
                    </div>

                    <div className="flex items-center justify-between gap-3">
                      <p className="text-xs text-zinc-400">
                        確定後、{spot.recordCount}件の記録が新しい案件マスタへ自動紐付けされます
                      </p>
                      <button
                        onClick={() => handlePromote(spot)}
                        disabled={!canSubmit || isPromoting}
                        className="rounded-lg bg-zinc-900 px-5 py-2 text-sm font-semibold text-white hover:bg-zinc-700 disabled:opacity-40 disabled:cursor-not-allowed transition"
                      >
                        {isPromoting ? '処理中...' : '昇格を確定する'}
                      </button>
                    </div>
                  </div>
                )}
              </div>
            )
          })}
        </div>
      )}

      {/* トースト */}
      {toast && (
        <div
          className={`fixed bottom-6 right-6 z-50 flex items-start gap-3 rounded-xl px-4 py-3 shadow-lg text-sm font-medium max-w-sm
            ${toast.type === 'success' ? 'bg-green-600 text-white' : 'bg-red-600 text-white'}`}
        >
          <span className="flex-1">{toast.message}</span>
          <button onClick={() => setToast(null)} className="opacity-75 hover:opacity-100 text-lg leading-none">×</button>
        </div>
      )}
    </div>
  )
}

// ── メインページ ──────────────────────────────────────────

type Tab = 'list' | 'generate' | 'payment' | 'finalize' | 'spot'

const TABS: { key: Tab; label: string }[] = [
  { key: 'list',     label: '① 売上一覧' },
  { key: 'generate', label: '② 請求書生成' },
  { key: 'payment',  label: '③ 入金管理' },
  { key: 'finalize', label: '④ 確定・ロック' },
  { key: 'spot',     label: '⑤ スポット昇格' },
]

export default function SalesPage() {
  const [tab, setTab]           = useState<Tab>('list')
  const [yearMonth, setYearMonth] = useState(currentYearMonth)

  return (
    <div className="min-h-screen bg-zinc-50">
      <div className="mx-auto max-w-6xl px-6 py-8">

        {/* ヘッダー */}
        <div className="flex flex-wrap items-center justify-between gap-4 mb-6">
          <h1 className="text-xl font-semibold text-zinc-900">売上管理</h1>
          <div className="flex items-center gap-2">
            <label className="text-sm text-zinc-600">対象年月</label>
            <input
              type="month"
              value={yearMonth}
              onChange={e => setYearMonth(e.target.value)}
              className="rounded-md border border-zinc-300 bg-white px-3 py-1.5 text-sm text-zinc-900 outline-none focus:border-zinc-500 focus:ring-1 focus:ring-zinc-300"
            />
          </div>
        </div>

        {/* タブ */}
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

        {tab === 'list'     && <SalesListTab       yearMonth={yearMonth} />}
        {tab === 'generate' && <InvoiceGenerateTab  yearMonth={yearMonth} />}
        {tab === 'payment'  && <PaymentStatusTab    yearMonth={yearMonth} />}
        {tab === 'finalize' && <FinalizeTab         yearMonth={yearMonth} />}
        {tab === 'spot'     && <SpotGuardrailTab />}
      </div>
    </div>
  )
}
