'use client'

import { useState, useEffect, useCallback } from 'react'
import {
  fetchSalesList,
  fetchClientOptions,
  computeInvoicePreview,
  upsertInvoice,
  updateInvoiceStatus,
  type SalesListRow,
  type InvoicePreview,
} from './actions'

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

// ── メインページ ──────────────────────────────────────────

type Tab = 'list' | 'generate' | 'payment'

const TABS: { key: Tab; label: string }[] = [
  { key: 'list',     label: '① 売上一覧' },
  { key: 'generate', label: '② 請求書生成' },
  { key: 'payment',  label: '③ 入金管理' },
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

        {tab === 'list'     && <SalesListTab     yearMonth={yearMonth} />}
        {tab === 'generate' && <InvoiceGenerateTab yearMonth={yearMonth} />}
        {tab === 'payment'  && <PaymentStatusTab  yearMonth={yearMonth} />}
      </div>
    </div>
  )
}
