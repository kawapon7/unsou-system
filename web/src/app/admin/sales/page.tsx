'use client'

import { useState, useEffect, useCallback } from 'react'
import { useSearchParams, useRouter, usePathname } from 'next/navigation'
import { useMonth } from '@/contexts/MonthContext'
import {
  fetchSalesList,
  fetchClientOptions,
  computeInvoicePreview,
  upsertInvoice,
  updateInvoiceStatus,
  fetchPaymentNoticeSummary,
  fetchExistingInvoices,
  type SalesListRow,
  type InvoicePreview,
  type PaymentNoticeSummaryRow,
  type ExistingInvoiceSummary,
} from './actions'
import { fetchClientDepartments } from '@/app/admin/partners/actions'
import type { Database } from '@/types/supabase'

type ClientDepartmentRow = Database['public']['Tables']['client_departments']['Row']
import {
  finalizeInvoiceAndNotice,
  proxyApprovePaymentNotice,
} from '@/app/_actions/billing-actions'
import { getDeductionRate } from '@/utils/transitional-deduction'
import {
  fetchUnassignedSpots,
  promoteSpotToOfficialProject,
  type SpotGroup,
} from '@/app/_actions/project-actions'
import { InvoicePdfModal }       from '@/components/pdf/InvoicePdfModal'
import { PaymentNoticePdfModal } from '@/components/pdf/PaymentNoticePdfModal'
import { ScanTab }               from './ScanTab'
import { EmergencyImportTab }    from './EmergencyImportTab'
import { ManualInvoiceTab }      from './ManualInvoiceTab'
import { VoiceButton }           from '@/components/voice/VoiceButton'
import { invoiceRegistrationLabel } from '@/utils/invoice-registration'
import {
  CONFIRMATION_METHODS,
  CONFIRMED_PARTIES,
  CONFIRMATION_METHOD_LABELS,
  CONFIRMED_PARTY_LABELS,
} from '@/utils/proxy-approval'

// ── ユーティリティ ────────────────────────────────────────

const yen = (n: number) => `¥${n.toLocaleString('ja-JP')}`

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
  const router                  = useRouter()
  const pathname                = usePathname()

  // 荷主名クリックで請求書プレビューへ。タブは URL 駆動、サブセクションの既定が
  // 'invoice'（請求書プレビュー）なので tab と client を渡すだけで目的の画面に着地する。
  const openInvoicePreview = (clientId: string) =>
    router.replace(`${pathname}?tab=generate&client=${encodeURIComponent(clientId)}`)

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

  function exportCsv() {
    const BOM = '﻿'
    const header = ['荷主名', '消費税区分', '締め日', '入金予定日', 'ステータス', '税抜金額', '消費税', '請求金額（税込）']
    const statusLabel: Record<string, string> = { draft: '未発行', issued: '請求済', paid: '入金済' }
    const body = rows.map(r => [
      r.companyName,
      TAX_TYPE_LABEL[r.taxType] ?? r.taxType,
      r.closingDay === '月末' || r.closingDay === '末日' || r.closingDay === '99' ? '月末締め' : `${r.closingDay}日締め`,
      r.dueDate || '',
      statusLabel[r.status] ?? r.status,
      r.netAmount,
      r.taxAmount,
      r.totalAmount,
    ])
    const csv = BOM + [header, ...body].map(row => row.map(v => `"${String(v).replace(/"/g, '""')}"`).join(',')).join('\r\n')
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' })
    const a = document.createElement('a')
    a.href = URL.createObjectURL(blob)
    a.download = `売上一覧_${yearMonth}.csv`
    a.click()
  }

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
        <div>
        <div className="flex justify-end mb-3">
          <button
            type="button"
            onClick={exportCsv}
            className="inline-flex items-center gap-1.5 rounded-md border border-zinc-300 bg-white px-3 py-1.5 text-xs font-medium text-zinc-700 hover:bg-zinc-50 transition-colors"
          >
            &#128229; CSV出力
          </button>
        </div>
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
                  <Td bold>
                    <button
                      type="button"
                      onClick={() => openInvoicePreview(r.clientId)}
                      className="text-left text-blue-700 underline decoration-blue-200 underline-offset-2 hover:decoration-blue-500 transition"
                      title="請求書プレビューを開く"
                    >
                      {r.companyName}
                    </button>
                  </Td>
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
  // 売上一覧で荷主名をクリックして飛んできた場合、その荷主が ?client= で渡ってくる
  const initialClientId = useSearchParams().get('client') ?? ''

  const [clientOptions, setClientOptions] = useState<{ id: string; company_name: string; use_departments: boolean }[]>([])
  const [selectedClientId, setSelectedClientId] = useState(initialClientId)
  const [targetMonth, setTargetMonth]           = useState(yearMonth)
  const [preview, setPreview]                   = useState<InvoicePreview | null>(null)
  // 自動プレビューが走る場合は最初から計算中にしておく（effect 内で同期 setState しないため）
  const [loadingPreview, setLoadingPreview]     = useState(Boolean(initialClientId))
  const [confirming, setConfirming]             = useState(false)
  const [message, setMessage]                   = useState<{ type: 'ok' | 'err'; text: string } | null>(null)

  const [departments, setDepartments]     = useState<ClientDepartmentRow[]>([])
  const [departmentId, setDepartmentId]   = useState<string>('')
  const [existingInvoices, setExistingInvoices] = useState<ExistingInvoiceSummary[]>([])

  const selectedClient = clientOptions.find(c => c.id === selectedClientId) ?? null

  useEffect(() => {
    fetchClientOptions().then(res => {
      if (!res.error) setClientOptions(res.data ?? [])
    })
  }, [])

  // 荷主を変えたら部署一覧を取り直す。選択のリセット自体は荷主セレクトの onChange 側で行う
  // （effect 内で setState を同期的に呼ぶと cascading render になるため、
  //  ここでは非同期コールバック内の setState のみに留める）。
  useEffect(() => {
    if (!selectedClient?.use_departments) return
    let cancelled = false
    fetchClientDepartments(selectedClient.id).then(res => {
      if (cancelled) return
      if (res.data) setDepartments(res.data)
    })
    return () => { cancelled = true }
  }, [selectedClient?.id, selectedClient?.use_departments])

  // 荷主・対象月が決まったら既存請求書の一覧を取り直す（二重請求防止のガード）
  useEffect(() => {
    if (!selectedClientId || !targetMonth) return
    let cancelled = false
    fetchExistingInvoices(selectedClientId, targetMonth).then(res => {
      if (cancelled) return
      if (!res.error) setExistingInvoices(res.data ?? [])
    })
    return () => { cancelled = true }
  }, [selectedClientId, targetMonth])

  // 売上一覧から飛んできたときだけプレビューを自動実行する。
  // ⚠️ setState を effect 内で同期的に呼ぶと cascading render になる（react-hooks/set-state-in-effect）。
  //    状態更新は必ず await 後だけに置き、loading の初期値は useState 側で立てておくこと。
  useEffect(() => {
    if (!initialClientId) return
    let cancelled = false
    computeInvoicePreview(initialClientId, yearMonth, null).then(res => {
      if (cancelled) return
      if (res.error) setMessage({ type: 'err', text: res.error })
      else setPreview(res.data)
      setLoadingPreview(false)
    })
    return () => { cancelled = true }
  }, [initialClientId, yearMonth])

  const handlePreview = async () => {
    if (!selectedClientId) return
    setLoadingPreview(true)
    setMessage(null)
    const res = await computeInvoicePreview(
      selectedClientId,
      targetMonth,
      selectedClient?.use_departments ? departmentId : null,
    )
    if (res.error) setMessage({ type: 'err', text: res.error })
    else setPreview(res.data)
    setLoadingPreview(false)
  }

  const handleConfirm = async () => {
    if (!selectedClientId) return
    setConfirming(true)
    setMessage(null)
    const res = await upsertInvoice(
      selectedClientId,
      targetMonth,
      selectedClient?.use_departments ? departmentId : null,
    )
    if (res.error) {
      setMessage({ type: 'err', text: res.error })
    } else {
      setMessage({ type: 'ok', text: '請求書をDBに保存しました。' })
      // プレビューを再取得してステータスを反映
      const refreshed = await computeInvoicePreview(
        selectedClientId,
        targetMonth,
        selectedClient?.use_departments ? departmentId : null,
      )
      if (!refreshed.error) setPreview(refreshed.data)
      const refreshedList = await fetchExistingInvoices(selectedClientId, targetMonth)
      if (!refreshedList.error) setExistingInvoices(refreshedList.data ?? [])
    }
    setConfirming(false)
  }

  const generateDisabled =
    !selectedClientId || loadingPreview || (!!selectedClient?.use_departments && !departmentId)

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
              onChange={e => {
                setSelectedClientId(e.target.value)
                setPreview(null)
                setDepartmentId('')
                setDepartments([])
                setExistingInvoices([])
              }}
              className="w-full rounded-md border border-zinc-300 bg-white px-3 py-2 text-sm text-zinc-900 outline-none focus:border-zinc-500 focus:ring-1 focus:ring-zinc-300"
            >
              <option value="">荷主を選択...</option>
              {clientOptions.map(c => (
                <option key={c.id} value={c.id}>{c.company_name}</option>
              ))}
            </select>
          </div>
          {selectedClient?.use_departments && (
            <div className="flex-1 min-w-40">
              <label className="block text-xs text-zinc-500 mb-1">部署</label>
              <select
                value={departmentId}
                onChange={e => { setDepartmentId(e.target.value); setPreview(null) }}
                required
                className="w-full rounded-md border border-zinc-300 bg-white px-3 py-2 text-sm text-zinc-900 outline-none focus:border-zinc-500 focus:ring-1 focus:ring-zinc-300"
              >
                <option value="">部署を選択</option>
                {departments.map(d => (
                  <option key={d.id} value={d.id}>{d.name}</option>
                ))}
              </select>
            </div>
          )}
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
            disabled={generateDisabled}
            className="rounded-lg bg-zinc-900 px-5 py-2 text-sm font-medium text-white hover:bg-zinc-700 disabled:opacity-50 disabled:cursor-not-allowed transition"
          >
            {loadingPreview ? '計算中...' : 'プレビュー'}
          </button>
        </div>
      </div>

      {/* 既存請求書一覧：荷主・対象月が決まった時点で生成前に見せる。
          二重請求は取引先に直接迷惑がかかるため、部署機能と独立に価値のあるガード */}
      {selectedClientId && existingInvoices.length > 0 && (
        <div className="rounded-xl border border-zinc-300 bg-white p-4">
          <div className="mb-2 text-sm font-medium text-zinc-700">
            この荷主・この月には既に {existingInvoices.length} 件の請求書があります
          </div>
          <ul className="text-sm text-zinc-600 space-y-0.5">
            {existingInvoices.map(inv => (
              <li key={inv.id}>
                {inv.departmentName ?? '（部署なし）'} — <StatusBadge status={inv.status} /> — {yen(inv.totalAmount)}
              </li>
            ))}
          </ul>
        </div>
      )}

      {message && (
        <p className={`rounded-lg px-4 py-3 text-sm ${
          message.type === 'ok'
            ? 'bg-green-50 text-green-700 border border-green-200'
            : 'bg-red-50 text-red-600'
        }`}>
          {message.text}
        </p>
      )}

      {/* 未割当案件の警告。⚠️ 生成をブロックしない。止めると業務が回らないため警告のみに留める（設計書 §8-2） */}
      {preview && preview.unassignedProjectCount > 0 && (
        <p className="rounded-lg bg-amber-50 border border-amber-200 px-4 py-3 text-sm text-amber-800">
          ⚠️ 部署が未割当の案件が {preview.unassignedProjectCount} 件あります。
          この請求書には含まれません。案件管理画面で部署を割り当ててください。
        </p>
      )}

      {/* 自動プレビュー中はボタンを押していないため、ボタンのラベル（計算中...）が
          目に入らない。プレビュー領域自体に計算中を出さないと「移動したのに無反応」に見える。
          リモートDBへの往復で 0.5〜1秒かかるので、この表示は省略できない。 */}
      {loadingPreview && !preview && (
        <div className="rounded-xl border border-zinc-200 bg-white py-16 text-center text-sm text-zinc-400">
          請求内容を計算中...
        </div>
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

// 支払通知書の承認状態4種（DBのCHECK制約で保証済み）。設計書 §2-3-9 参照。
// ⚠️ locked（確定ロック）とは別軸。ロック後も承認状態は approval_status のまま保持される。
const NOTICE_STATUS_META: Record<string, { label: string; cls: string }> = {
  pending:            { label: '🟡 承認待ち',             cls: 'bg-amber-50 text-amber-700' },
  approved:           { label: '🟢 本人承認',             cls: 'bg-green-50 text-green-700' },
  approved_by_proxy:  { label: '🔵 代理承認（口頭確認）', cls: 'bg-blue-50 text-blue-700' },
  no_response:        { label: '🟠 未応答のまま確定',     cls: 'bg-orange-50 text-orange-700' },
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

type PdfTarget =
  | { type: 'invoice';  clientId:     string; name: string }
  | { type: 'notice';   contractorId: string; name: string }

function FinalizeTab({ yearMonth }: { yearMonth: string }) {
  const [invoiceRows,   setInvoiceRows]   = useState<SalesListRow[]>([])
  const [noticeRows,    setNoticeRows]    = useState<PaymentNoticeSummaryRow[]>([])
  const [loadError,     setLoadError]     = useState<string | null>(null)
  const [loading,       setLoading]       = useState(true)
  const [processing,    setProcessing]    = useState<string | null>(null)
  const [toast,         setToast]         = useState<{ type: 'ok' | 'err'; text: string } | null>(null)
  const [pdfTarget,     setPdfTarget]     = useState<PdfTarget | null>(null)
  // per-row unlock UI state: key = clientId or contractorId
  const [unlockOpen,    setUnlockOpen]    = useState<Record<string, boolean>>({})
  const [unlockReasons, setUnlockReasons] = useState<Record<string, string>>({})
  // per-row 代理承認 UI state: key = contractorId
  const [proxyOpen, setProxyOpen] = useState<Record<string, boolean>>({})
  const [proxyForm, setProxyForm] = useState<Record<string, {
    confirmationMethod: (typeof CONFIRMATION_METHODS)[number] | ''
    confirmedParty:     (typeof CONFIRMED_PARTIES)[number] | ''
    note:                string
  }>>({})

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
    // ⚠️ fail-open 厳禁: 取得エラーを握り潰すと、表が「対象データがありません」に見えてしまう。
    //    実際に `contractors.tax_type`（存在しない列）の 42703 がこれで隠れていた（2026-08-02）
    setLoadError(invRes.error ?? noticeRes.error ?? null)
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

  // ── 支払通知書 代理承認（口頭確認等） ─────────────────────
  const handleProxyApprove = async (contractorId: string, noticeId: string) => {
    const form = proxyForm[contractorId]
    // ⚠️ 3項目とも必須。サーバー側でも検証されるが、ここで先に弾いて往復を無駄にしない
    if (!form?.confirmationMethod || !form?.confirmedParty || !form?.note.trim()) return
    setProcessing(contractorId)
    const res = await proxyApprovePaymentNotice({
      noticeId,
      confirmationMethod: form.confirmationMethod,
      confirmedParty:     form.confirmedParty,
      note:                form.note,
    })
    if (res.error) {
      showToast('err', res.error)
    } else {
      showToast('ok', '代理承認を記録しました。')
      setProxyOpen(p => ({ ...p, [contractorId]: false }))
      await load()
    }
    setProcessing(null)
  }

  if (loading) return <div className="py-20 text-center text-sm text-zinc-400">読み込み中...</div>

  return (
    <div className="space-y-8">
      {toast && <Toast msg={toast} onClose={() => setToast(null)} />}

      {/* 取得に失敗したら必ず表に出す。空表と区別がつかないと異常が正常に見える */}
      {loadError && (
        <div className="rounded-lg bg-red-50 border border-red-200 px-4 py-3 text-sm text-red-700">
          <p className="font-semibold mb-1">データを取得できませんでした</p>
          <p className="text-red-600">{loadError}</p>
          <p className="mt-2 text-xs text-red-500">
            下の表が空でも「対象が無い」とは限りません。復旧後に開き直してください。
          </p>
        </div>
      )}

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
                      {/* プレビュー・出力ボタン（常時表示） */}
                      <button
                        onClick={() => setPdfTarget({ type: 'invoice', clientId: r.clientId, name: r.companyName })}
                        className="rounded-lg border border-blue-300 bg-blue-50 px-3 py-1.5 text-xs font-medium text-blue-700 hover:bg-blue-100 transition"
                      >
                        📄 プレビュー・出力
                      </button>
                      {!isLocked ? (
                        <button
                          onClick={() => handleFinalizeInvoice(r.clientId)}
                          disabled={busy}
                          className="block rounded-lg bg-zinc-900 px-3 py-1.5 text-xs font-medium text-white hover:bg-zinc-700 disabled:opacity-50 transition"
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
                // ⚠️ locked と approval_status は別軸。ロック後も承認状態（本人/代理/未応答）を出し分ける
                const statusMeta = NOTICE_STATUS_META[r.approvalStatus] ?? NOTICE_STATUS_META.pending
                const isOpen = unlockOpen[r.contractorId] ?? false
                const reason = unlockReasons[r.contractorId] ?? ''
                const busy   = processing === r.contractorId
                // 代理承認は本人承認済み以外なら常に出す（no_response からの格上げも想定内）。
                // notice がまだ存在しない行（noticeId null）は承認対象が無いので出さない
                const proxyIsOpen = proxyOpen[r.contractorId] ?? false
                const proxyPf = proxyForm[r.contractorId] ?? { confirmationMethod: '', confirmedParty: '', note: '' }
                const proxyValid = !!proxyPf.confirmationMethod && !!proxyPf.confirmedParty && !!proxyPf.note.trim()
                const canProxyApprove = !!r.noticeId && r.approvalStatus !== 'approved'

                return (
                  <tr key={r.contractorId} className="hover:bg-zinc-50">
                    <Td bold>{r.name}</Td>
                    <Td>
                      <span className="text-xs text-zinc-500">
                        {invoiceRegistrationLabel(r.invoiceType)}
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
                      {/* プレビュー・出力ボタン（常時表示） */}
                      <button
                        onClick={() => setPdfTarget({ type: 'notice', contractorId: r.contractorId, name: r.name })}
                        className="rounded-lg border border-blue-300 bg-blue-50 px-3 py-1.5 text-xs font-medium text-blue-700 hover:bg-blue-100 transition"
                      >
                        📄 プレビュー・出力
                      </button>
                      {canProxyApprove && (
                        <div className="space-y-1.5">
                          <button
                            onClick={() => setProxyOpen(p => ({ ...p, [r.contractorId]: !proxyIsOpen }))}
                            className="block text-xs text-zinc-400 hover:text-zinc-700 underline"
                          >
                            {proxyIsOpen ? '▲ 閉じる' : '▼ 代理承認（口頭確認）'}
                          </button>
                          {proxyIsOpen && (
                            <div className="space-y-1.5 mt-1">
                              <select
                                value={proxyPf.confirmationMethod}
                                onChange={e => setProxyForm(p => ({
                                  ...p,
                                  [r.contractorId]: { ...proxyPf, confirmationMethod: e.target.value as (typeof CONFIRMATION_METHODS)[number] },
                                }))}
                                className="block rounded-md border border-zinc-300 bg-white px-2.5 py-1.5 text-xs w-52 outline-none focus:border-zinc-500 focus:ring-1 focus:ring-zinc-300"
                              >
                                <option value="">確認方法を選択</option>
                                {CONFIRMATION_METHODS.map(m => (
                                  <option key={m} value={m}>{CONFIRMATION_METHOD_LABELS[m]}</option>
                                ))}
                              </select>
                              <select
                                value={proxyPf.confirmedParty}
                                onChange={e => setProxyForm(p => ({
                                  ...p,
                                  [r.contractorId]: { ...proxyPf, confirmedParty: e.target.value as (typeof CONFIRMED_PARTIES)[number] },
                                }))}
                                className="block rounded-md border border-zinc-300 bg-white px-2.5 py-1.5 text-xs w-52 outline-none focus:border-zinc-500 focus:ring-1 focus:ring-zinc-300"
                              >
                                <option value="">確認した相手を選択</option>
                                {CONFIRMED_PARTIES.map(p => (
                                  <option key={p} value={p}>{CONFIRMED_PARTY_LABELS[p]}</option>
                                ))}
                              </select>
                              <input
                                type="text"
                                placeholder="8/2 15時 本人に架電、金額合意"
                                value={proxyPf.note}
                                onChange={e => setProxyForm(p => ({
                                  ...p,
                                  [r.contractorId]: { ...proxyPf, note: e.target.value },
                                }))}
                                className="block rounded-md border border-zinc-300 px-2.5 py-1.5 text-xs w-52 outline-none focus:border-zinc-500 focus:ring-1 focus:ring-zinc-300"
                              />
                              <button
                                onClick={() => handleProxyApprove(r.contractorId, r.noticeId as string)}
                                disabled={!proxyValid || busy}
                                className="rounded-lg bg-blue-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-blue-500 disabled:opacity-40 transition whitespace-nowrap"
                              >
                                {busy ? '処理中...' : '代理承認する'}
                              </button>
                            </div>
                          )}
                        </div>
                      )}
                      {!isLocked ? (
                        <button
                          onClick={() => handleFinalizeNotice(r.contractorId)}
                          disabled={busy}
                          className="block rounded-lg bg-zinc-900 px-3 py-1.5 text-xs font-medium text-white hover:bg-zinc-700 disabled:opacity-50 transition"
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
          {/* ⚠️ 率をベタ書きしない。2026-10-01 に 2% → 3% へ切り替わるため、
              ベタ書きすると画面だけ古い率を表示し続ける。正本から算出する。 */}
          ※ 経過措置控除: インボイス未登録業者への支払額から差し引く金額（現在フェーズ:{' '}
          {(getDeductionRate(new Date(`${yearMonth}-01T00:00:00`)) * 100).toFixed(0)}%）
        </p>
        <p className="mt-1 text-xs text-zinc-400">
          ※ 代理承認は口頭確認等の記録を残したうえで親分が代わりに承認する操作です。確認記録は承認履歴に保存されます（支払通知書PDFには印字されません）。
        </p>
      </section>

      {/* PDF モーダル */}
      {pdfTarget?.type === 'invoice' && (
        <InvoicePdfModal
          clientId={pdfTarget.clientId}
          yearMonth={yearMonth}
          clientName={pdfTarget.name}
          onClose={() => setPdfTarget(null)}
        />
      )}
      {pdfTarget?.type === 'notice' && (
        <PaymentNoticePdfModal
          contractorId={pdfTarget.contractorId}
          yearMonth={yearMonth}
          contractorName={pdfTarget.name}
          onClose={() => setPdfTarget(null)}
        />
      )}
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

  // インラインフォームの開閉：key = SpotGroup.groupKey
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

  function toggleForm(spot: SpotGroup) {
    const id = spot.groupKey
    setOpenForm(prev => ({ ...prev, [id]: !prev[id] }))
    setForms(prev => ({
      ...prev,
      [id]: prev[id] ?? { clientId: '', projectName: spot.jobName ?? '', saleAmount: '', buyAmount: '', unitType: 'per_trip' },
    }))
  }

  function updateForm(id: string, patch: Partial<PromoteForm>) {
    setForms(prev => ({ ...prev, [id]: { ...prev[id], ...patch } }))
  }

  async function handlePromote(spot: SpotGroup) {
    const form = forms[spot.groupKey]
    if (!form?.clientId || !form.projectName || !form.saleAmount || !form.buyAmount) {
      setToast({ message: '荷主・案件名・売値・買値は必須です', type: 'error' })
      return
    }
    setPromoting(prev => ({ ...prev, [spot.groupKey]: true }))
    const res = await promoteSpotToOfficialProject({
      recordIds:     spot.recordIds,
      clientId:      form.clientId,
      projectName:   form.projectName,
      saleAmount:    Number(form.saleAmount),
      buyAmount:     Number(form.buyAmount),
      unitType:      form.unitType,
    })
    setPromoting(prev => ({ ...prev, [spot.groupKey]: false }))

    if (res.error) {
      setToast({ message: res.error, type: 'error' })
    } else {
      setToast({
        message: `「${form.projectName}」として昇格完了（${res.data?.updatedCount ?? 0}件の記録を紐付け）`,
        type: 'success',
      })
      setOpenForm(prev => ({ ...prev, [spot.groupKey]: false }))
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

      {/* ⚠️ fail-open 厳禁: 取得に失敗したときは「ありません ✅」を絶対に出さない。
          異常を正常に見せる壊れ方になるため、エラー時はここで打ち切る（2026-08-02 修正） */}
      {loading ? (
        <div className="py-20 text-center text-sm text-zinc-400">読み込み中...</div>
      ) : error ? (
        <div className="rounded-lg bg-red-50 border border-red-200 px-4 py-3 text-sm text-red-700">
          <p className="font-semibold mb-1">スポット案件を確認できませんでした</p>
          <p className="text-red-600">{error}</p>
          <p className="mt-2 text-xs text-red-500">
            未紐付けの案件が「無い」とは判断できません。復旧後にもう一度開いてください。
          </p>
        </div>
      ) : spots.length === 0 ? (
        <div className="py-20 text-center rounded-xl border border-dashed border-zinc-200 bg-white">
          <p className="text-zinc-400 text-sm">未紐付けのスポット案件はありません ✅</p>
        </div>
      ) : (
        <div className="space-y-4">
          {spots.map(spot => {
            const isOpen     = !!openForm[spot.groupKey]
            const form       = forms[spot.groupKey] ?? { clientId: '', projectName: spot.jobName ?? '', saleAmount: '', buyAmount: '', unitType: 'per_trip' }
            const isPromoting = !!promoting[spot.groupKey]
            const canSubmit  = form.clientId && form.projectName && form.saleAmount && form.buyAmount

            return (
              <div key={spot.groupKey} className="rounded-xl border border-amber-200 bg-amber-50 overflow-hidden">
                {/* 概要行 */}
                <div className="flex items-start justify-between gap-4 px-5 py-4">
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2 mb-1.5">
                      <span className="inline-block rounded-full bg-amber-200 text-amber-800 text-xs font-semibold px-2 py-0.5">
                        未紐付け
                      </span>
                      <span className="text-sm font-medium text-zinc-800 truncate">
                        {spot.jobName ?? '（案件名の入力なし）'}
                      </span>
                    </div>
                    <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-zinc-500">
                      <span>{spot.recordCount}件の記録</span>
                      <span>{spot.earliestDate} 〜 {spot.latestDate}</span>
                      <span>担当: {spot.contractorNames.join('、') || '—'}</span>
                    </div>
                    {/* 金額は出さない: 未紐付け＝単価（price_rules）が無く算出できない。
                        ¥0 と表示すると「売上ゼロの案件」に見えるため文言で明示する */}
                    <div className="mt-1.5 text-xs text-zinc-500">
                      金額は未算出（単価が未登録のため、昇格後に確定します）
                    </div>
                  </div>
                  <button
                    onClick={() => toggleForm(spot)}
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
                          onChange={e => updateForm(spot.groupKey, { clientId: e.target.value })}
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
                          onChange={e => updateForm(spot.groupKey, { projectName: e.target.value })}
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
                          onChange={e => updateForm(spot.groupKey, { saleAmount: e.target.value })}
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
                          onChange={e => updateForm(spot.groupKey, { buyAmount: e.target.value })}
                          placeholder="25000"
                          className="w-full rounded-md border border-zinc-300 px-3 py-2 text-sm outline-none focus:border-zinc-500"
                        />
                      </div>
                      {/* 計算方式 */}
                      <div>
                        <label className="block text-xs font-medium text-zinc-600 mb-1">計算方式</label>
                        <select
                          value={form.unitType}
                          onChange={e => updateForm(spot.groupKey, { unitType: e.target.value })}
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
// タブは最大3個（認知負荷軽減ルール）
// 確定・ロック / スポット昇格 / 手動入力 は「請求書生成」タブ内の追加セクションとして提供
// AIスキャン / 緊急インポート は /admin/scan へ移動

type Tab = 'list' | 'generate' | 'payment'

const TABS: { key: Tab; label: string }[] = [
  { key: 'list',     label: '売上一覧' },
  { key: 'generate', label: '請求書生成' },
  { key: 'payment',  label: '入金管理' },
]

// 「請求書生成」タブ内のサブセクション切り替え
type GenerateSection = 'invoice' | 'finalize' | 'spot' | 'manual'

function InvoiceGenerateTabWithSections({ yearMonth }: { yearMonth: string }) {
  const [section, setSection] = useState<GenerateSection>('invoice')

  const sectionTabs: { key: GenerateSection; label: string }[] = [
    { key: 'invoice',  label: '請求書プレビュー' },
    { key: 'finalize', label: '確定・ロック' },
    { key: 'spot',     label: 'スポット昇格' },
    { key: 'manual',   label: '手動入力' },
  ]

  return (
    <div>
      {/* サブナビ */}
      <div className="flex gap-2 mb-5 flex-wrap">
        {sectionTabs.map(s => (
          <button
            key={s.key}
            onClick={() => setSection(s.key)}
            className={`rounded-full px-3 py-1 text-xs font-medium transition ${
              section === s.key
                ? 'bg-zinc-900 text-white'
                : 'bg-zinc-100 text-zinc-600 hover:bg-zinc-200'
            }`}
          >
            {s.label}
          </button>
        ))}
      </div>

      {/* ⚠️ key に yearMonth を渡して月が変わったらタブごと作り直す。
          InvoiceGenerateTab の targetMonth は useState(yearMonth) で初回しか初期化されず、
          サイドバーで月を移動しても追従しないうえ前月のプレビューが残るため、
          「サイドバーは7月・メイン画面は6月」という読み違えを招く状態が作れてしまう。
          effect で個別に setState すると cascading render を招く（react-hooks/set-state-in-effect）ので、
          React の作法どおり key によるリセットで state をまとめて捨てる。 */}
      {section === 'invoice'  && <InvoiceGenerateTab  key={yearMonth} yearMonth={yearMonth} />}
      {section === 'finalize' && <FinalizeTab          yearMonth={yearMonth} />}
      {section === 'spot'     && <SpotGuardrailTab />}
      {section === 'manual'   && <ManualInvoiceTab     yearMonth={yearMonth} />}
    </div>
  )
}

export default function SalesPage() {
  const searchParams    = useSearchParams()
  const router          = useRouter()
  const pathname        = usePathname()
  const tab             = (searchParams.get('tab') as Tab | null) ?? 'list'
  const setTab          = (t: Tab) => router.replace(`${pathname}?tab=${t}`)
  const { yearMonth }   = useMonth()

  return (
    <div className="min-h-screen bg-zinc-50">
      <div className="mx-auto max-w-6xl px-6 py-8">

        {/* ヘッダー */}
        <div className="flex flex-wrap items-center justify-between gap-4 mb-6">
          <h1 className="text-xl font-semibold text-zinc-900">売上・請求管理（IN）</h1>
          <a
            href="/admin/scan"
            className="inline-flex items-center gap-1.5 rounded-lg border border-zinc-300 bg-white px-3 py-1.5 text-xs font-medium text-zinc-700 hover:bg-zinc-50 transition"
          >
            <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" strokeWidth={1.6} stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" d="M7.5 3.75H6A2.25 2.25 0 0 0 3.75 6v1.5M16.5 3.75H18A2.25 2.25 0 0 1 20.25 6v1.5m0 9V18A2.25 2.25 0 0 1 18 20.25h-1.5m-9 0H6A2.25 2.25 0 0 1 3.75 18v-1.5M15 12a3 3 0 1 1-6 0 3 3 0 0 1 6 0Z" />
            </svg>
            AIスキャン
          </a>
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

        {tab === 'list'     && <SalesListTab                 yearMonth={yearMonth} />}
        {tab === 'generate' && <InvoiceGenerateTabWithSections yearMonth={yearMonth} />}
        {tab === 'payment'  && <PaymentStatusTab              yearMonth={yearMonth} />}
      </div>

      {/* 音声操作ボタン（親分：画面遷移のみ） */}
      <VoiceButton />
    </div>
  )
}
