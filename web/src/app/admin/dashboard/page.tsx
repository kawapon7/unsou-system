'use client'

import { useState, useEffect, useCallback } from 'react'
import DefensiveAlertPanel from '@/app/admin/_components/DefensiveAlertPanel'
import {
  fetchDashboardSummary,
  fetchInvoiceSchedule,
  fetchPaymentSchedule,
  fetchAlerts,
  fetchMonthlyTrend,
  fetchClientPie,
  type DashboardSummary,
  type InvoiceScheduleRow,
  type PaymentScheduleRow,
  type AlertData,
  type MonthlyTrendRow,
  type ClientPieRow,
} from './actions'

// ── ユーティリティ ────────────────────────────────────────

const yen = (n: number) => `¥${n.toLocaleString('ja-JP')}`

function currentYearMonth() {
  const now = new Date()
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`
}

function fmtMonth(ym: string) {
  const [y, m] = ym.split('-')
  return `${y}年${Number(m)}月`
}

function fmtDate(iso: string | null) {
  if (!iso) return '未設定'
  const d = new Date(iso)
  return `${d.getMonth() + 1}/${d.getDate()}`
}

// ── KPIカード ─────────────────────────────────────────────

function KpiCard({
  label, value, sub, accent,
}: {
  label: string; value: string; sub?: string; accent?: 'green' | 'red' | 'blue' | 'zinc'
}) {
  const border = {
    green: 'border-l-4 border-l-emerald-400',
    red:   'border-l-4 border-l-rose-400',
    blue:  'border-l-4 border-l-blue-400',
    zinc:  'border-l-4 border-l-zinc-300',
  }
  return (
    <div className={`rounded-xl bg-white border border-zinc-200 px-5 py-4 ${accent ? border[accent] : ''}`}>
      <p className="text-xs text-zinc-500 mb-1">{label}</p>
      <p className="text-xl font-bold text-zinc-900 tabular-nums">{value}</p>
      {sub && <p className="text-xs text-zinc-400 mt-0.5">{sub}</p>}
    </div>
  )
}

// ── アラートバナー ────────────────────────────────────────

function AlertBanner({ alerts }: { alerts: AlertData }) {
  const items: string[] = []
  if (alerts.pendingApprovals > 0)
    items.push(`支払通知書の未承認が ${alerts.pendingApprovals} 件あります`)
  if (alerts.pendingCount > 0)
    items.push(`未確定の請求書が ${alerts.pendingCount} 件あります`)
  if (items.length === 0) return null
  return (
    <div className="rounded-xl bg-amber-50 border border-amber-200 px-4 py-3">
      <p className="text-xs font-semibold text-amber-700 mb-1.5">⚠ 要対応</p>
      <ul className="space-y-0.5">
        {items.map((item, i) => (
          <li key={i} className="text-sm text-amber-800">・{item}</li>
        ))}
      </ul>
    </div>
  )
}

// ── 入金スケジュール ──────────────────────────────────────

const STATUS_LABEL: Record<string, { label: string; cls: string }> = {
  issued:     { label: '未入金', cls: 'bg-rose-100 text-rose-700' },
  paid:       { label: '入金済', cls: 'bg-emerald-100 text-emerald-700' },
  draft:      { label: '未確定', cls: 'bg-zinc-100 text-zinc-500' },
  no_invoice: { label: '未請求', cls: 'bg-amber-100 text-amber-700' },
}

function InvoiceScheduleCard({ rows }: { rows: InvoiceScheduleRow[] }) {
  if (rows.length === 0)
    return (
      <div className="rounded-xl bg-white border border-zinc-200 px-5 py-8 text-center text-sm text-zinc-400">
        今月の請求データはありません
      </div>
    )
  return (
    <div className="rounded-xl bg-white border border-zinc-200 overflow-hidden">
      <table className="w-full text-sm">
        <thead className="bg-zinc-50">
          <tr>
            <th className="px-4 py-2.5 text-left text-xs font-medium text-zinc-500">荷主</th>
            <th className="px-4 py-2.5 text-left text-xs font-medium text-zinc-500">入金予定日</th>
            <th className="px-4 py-2.5 text-right text-xs font-medium text-zinc-500">金額</th>
            <th className="px-4 py-2.5 text-center text-xs font-medium text-zinc-500">状態</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-zinc-100">
          {rows.map(r => {
            const st = STATUS_LABEL[r.status] ?? { label: r.status, cls: 'bg-zinc-100 text-zinc-500' }
            return (
              <tr key={r.invoiceId} className="hover:bg-zinc-50">
                <td className="px-4 py-3 font-medium text-zinc-900">{r.companyName}</td>
                <td className="px-4 py-3 text-zinc-600 tabular-nums">{fmtDate(r.dueDate)}</td>
                <td className="px-4 py-3 text-right font-semibold text-zinc-900 tabular-nums">
                  {yen(r.totalAmount)}
                </td>
                <td className="px-4 py-3 text-center">
                  <span className={`inline-flex rounded-full px-2 py-0.5 text-xs font-medium ${st.cls}`}>
                    {st.label}
                  </span>
                </td>
              </tr>
            )
          })}
        </tbody>
        <tfoot className="bg-zinc-50 border-t border-zinc-200">
          <tr>
            <td colSpan={2} className="px-4 py-2 text-xs text-zinc-500">合計</td>
            <td className="px-4 py-2 text-right font-bold text-zinc-900 tabular-nums">
              {yen(rows.reduce((s, r) => s + r.totalAmount, 0))}
            </td>
            <td />
          </tr>
        </tfoot>
      </table>
    </div>
  )
}

// ── 支払スケジュール ──────────────────────────────────────

function PaymentScheduleCard({ rows }: { rows: PaymentScheduleRow[] }) {
  if (rows.length === 0)
    return (
      <div className="rounded-xl bg-white border border-zinc-200 px-5 py-8 text-center text-sm text-zinc-400">
        今月の支払通知書はありません
      </div>
    )
  return (
    <div className="rounded-xl bg-white border border-zinc-200 overflow-hidden">
      <table className="w-full text-sm">
        <thead className="bg-zinc-50">
          <tr>
            <th className="px-4 py-2.5 text-left text-xs font-medium text-zinc-500">委託先</th>
            <th className="px-4 py-2.5 text-right text-xs font-medium text-zinc-500">支払額</th>
            <th className="px-4 py-2.5 text-center text-xs font-medium text-zinc-500">承認</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-zinc-100">
          {rows.map(r => (
            <tr key={r.noticeId} className="hover:bg-zinc-50">
              <td className="px-4 py-3 font-medium text-zinc-900">{r.contractorName}</td>
              <td className="px-4 py-3 text-right font-semibold text-zinc-900 tabular-nums">
                {yen(r.totalAmount)}
              </td>
              <td className="px-4 py-3 text-center">
                {r.approvalStatus === 'approved' ? (
                  <span className="inline-flex rounded-full px-2 py-0.5 text-xs font-medium bg-emerald-100 text-emerald-700">
                    ✅ 承認済
                  </span>
                ) : (
                  <span className="inline-flex rounded-full px-2 py-0.5 text-xs font-medium bg-amber-100 text-amber-700">
                    未承認
                  </span>
                )}
              </td>
            </tr>
          ))}
        </tbody>
        <tfoot className="bg-zinc-50 border-t border-zinc-200">
          <tr>
            <td className="px-4 py-2 text-xs text-zinc-500">合計</td>
            <td className="px-4 py-2 text-right font-bold text-zinc-900 tabular-nums">
              {yen(rows.reduce((s, r) => s + r.totalAmount, 0))}
            </td>
            <td />
          </tr>
        </tfoot>
      </table>
    </div>
  )
}

// ── 月別売上グラフ（CSS棒グラフ） ────────────────────────

function MonthlyBarChart({ rows }: { rows: MonthlyTrendRow[] }) {
  const max = Math.max(...rows.map(r => r.totalAmount), 1)
  const BAR_H = 160

  return (
    <div className="rounded-xl bg-white border border-zinc-200 px-5 pt-4 pb-3">
      <p className="text-xs font-semibold text-zinc-500 mb-4 uppercase tracking-widest">
        月別売上（過去12ヶ月）
      </p>
      <div className="flex items-end gap-1 pb-1">
        {rows.map(r => {
          const totalH = Math.round((r.totalAmount / max) * BAR_H)
          const paidH  = Math.round((r.paidAmount  / max) * BAR_H)
          const label  = r.month.slice(5).replace(/^0/, '') + '月'
          return (
            <div key={r.month} className="flex flex-col items-center gap-1 flex-1 min-w-0">
              <div
                className="relative w-full rounded-sm bg-zinc-100"
                style={{ height: BAR_H }}
                title={`${fmtMonth(r.month)}\n請求: ${yen(r.totalAmount)}\n入金済: ${yen(r.paidAmount)}`}
              >
                {totalH > 0 && (
                  <div className="absolute bottom-0 w-full bg-zinc-300 rounded-sm"
                    style={{ height: totalH }} />
                )}
                {paidH > 0 && (
                  <div className="absolute bottom-0 w-full bg-zinc-700 rounded-sm"
                    style={{ height: paidH }} />
                )}
              </div>
              <span className="text-[9px] text-zinc-400 tabular-nums">{label}</span>
            </div>
          )
        })}
      </div>
      <div className="flex items-center gap-4 mt-1">
        <span className="flex items-center gap-1 text-[10px] text-zinc-500">
          <span className="inline-block w-3 h-3 rounded-sm bg-zinc-300" />請求額
        </span>
        <span className="flex items-center gap-1 text-[10px] text-zinc-500">
          <span className="inline-block w-3 h-3 rounded-sm bg-zinc-700" />入金済
        </span>
      </div>
    </div>
  )
}

// ── 荷主別売上構成 ────────────────────────────────────────

const PALETTE = ['bg-zinc-800', 'bg-zinc-500', 'bg-zinc-400', 'bg-zinc-300', 'bg-zinc-200']

function ClientPieCard({ rows }: { rows: ClientPieRow[] }) {
  const total = rows.reduce((s, r) => s + r.totalAmount, 0)
  if (total === 0)
    return (
      <div className="rounded-xl bg-white border border-zinc-200 px-5 py-8 text-center text-sm text-zinc-400">
        今月の請求データはありません
      </div>
    )
  return (
    <div className="rounded-xl bg-white border border-zinc-200 px-5 pt-4 pb-5">
      <p className="text-xs font-semibold text-zinc-500 mb-4 uppercase tracking-widest">
        荷主別売上構成
      </p>
      <div className="flex h-3 rounded-full overflow-hidden mb-4">
        {rows.slice(0, 5).map((r, i) => (
          <div
            key={r.companyName}
            className={PALETTE[i] ?? 'bg-zinc-100'}
            style={{ width: `${(r.totalAmount / total) * 100}%` }}
          />
        ))}
      </div>
      <ul className="space-y-2">
        {rows.slice(0, 5).map((r, i) => (
          <li key={r.companyName} className="flex items-center justify-between gap-2">
            <span className="flex items-center gap-2 min-w-0">
              <span className={`inline-block w-2.5 h-2.5 rounded-sm shrink-0 ${PALETTE[i] ?? 'bg-zinc-100'}`} />
              <span className="text-sm text-zinc-700 truncate">{r.companyName}</span>
            </span>
            <span className="text-sm font-medium text-zinc-900 tabular-nums shrink-0">
              {Math.round((r.totalAmount / total) * 100)}%
            </span>
          </li>
        ))}
      </ul>
    </div>
  )
}

// ── メインページ ──────────────────────────────────────────

export default function OyabunDashboard() {
  const [yearMonth, setYearMonth] = useState(currentYearMonth)
  const [summary,   setSummary]   = useState<DashboardSummary | null>(null)
  const [invoices,  setInvoices]  = useState<InvoiceScheduleRow[]>([])
  const [payments,  setPayments]  = useState<PaymentScheduleRow[]>([])
  const [alerts,    setAlerts]    = useState<AlertData | null>(null)
  const [trend,     setTrend]     = useState<MonthlyTrendRow[]>([])
  const [pie,       setPie]       = useState<ClientPieRow[]>([])
  const [loading,   setLoading]   = useState(true)
  const [error,     setError]     = useState<string | null>(null)

  const load = useCallback(async (ym: string) => {
    setLoading(true)
    setError(null)
    const [summaryRes, invoiceRes, paymentRes, alertRes, trendRes, pieRes] =
      await Promise.all([
        fetchDashboardSummary(ym),
        fetchInvoiceSchedule(ym),
        fetchPaymentSchedule(ym),
        fetchAlerts(ym),
        fetchMonthlyTrend(),
        fetchClientPie(ym),
      ])
    const firstErr = [summaryRes, invoiceRes, paymentRes, alertRes, trendRes, pieRes]
      .map(r => r.error).find(Boolean)
    if (firstErr) setError(firstErr)
    if (summaryRes.data) setSummary(summaryRes.data)
    if (invoiceRes.data) setInvoices(invoiceRes.data)
    if (paymentRes.data) setPayments(paymentRes.data)
    if (alertRes.data)   setAlerts(alertRes.data)
    if (trendRes.data)   setTrend(trendRes.data)
    if (pieRes.data)     setPie(pieRes.data)
    setLoading(false)
  }, [])

  useEffect(() => { load(yearMonth) }, [load, yearMonth])

  return (
    <div className="min-h-screen bg-zinc-50">
      <div className="mx-auto max-w-6xl px-4 sm:px-6 py-8">

        {/* ヘッダー */}
        <div className="flex flex-wrap items-center justify-between gap-4 mb-6">
          <h1 className="text-xl font-semibold text-zinc-900">ダッシュボード</h1>
          <div className="flex items-center gap-2">
            <label className="text-sm text-zinc-500">対象年月</label>
            <input
              type="month"
              value={yearMonth}
              onChange={e => setYearMonth(e.target.value)}
              className="rounded-md border border-zinc-300 bg-white px-3 py-1.5 text-sm text-zinc-900 outline-none focus:border-zinc-500 focus:ring-1 focus:ring-zinc-300"
            />
          </div>
        </div>

        {error && (
          <p className="mb-4 rounded-lg bg-red-50 px-4 py-2 text-sm text-red-600">{error}</p>
        )}

        {loading ? (
          <div className="py-24 text-center text-sm text-zinc-400">読み込み中...</div>
        ) : (
          <div className="space-y-6">

            {/* 5大ディフェンシブ・アラート（最上部・常駐） */}
            <DefensiveAlertPanel />

            {/* KPIカード（2列 → 4列） */}
            <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
              <KpiCard
                label="入金予定総額"
                value={yen(summary?.totalReceivable ?? 0)}
                sub={`${fmtMonth(yearMonth)} 未入金`}
                accent="blue"
              />
              <KpiCard
                label="入金済額"
                value={yen(summary?.totalReceived ?? 0)}
                sub={`${fmtMonth(yearMonth)} 確認済`}
                accent="green"
              />
              <KpiCard
                label="支払予定総額"
                value={yen(summary?.totalPayable ?? 0)}
                sub="委託先への支払"
                accent="red"
              />
              <KpiCard
                label="粗利（概算）"
                value={yen(summary?.grossProfit ?? 0)}
                sub="入金予定 − 支払予定"
                accent="zinc"
              />
            </div>

            {/* 既存アラート */}
            {alerts && <AlertBanner alerts={alerts} />}

            {/* スケジュール（左） + グラフ（右） */}
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
              <div className="space-y-6">
                <section>
                  <h2 className="text-sm font-semibold text-zinc-700 mb-2">入金スケジュール</h2>
                  <InvoiceScheduleCard rows={invoices} />
                </section>
                <section>
                  <h2 className="text-sm font-semibold text-zinc-700 mb-2">支払スケジュール</h2>
                  <PaymentScheduleCard rows={payments} />
                </section>
              </div>
              <div className="space-y-6">
                {trend.length > 0 && <MonthlyBarChart rows={trend} />}
                {pie.length   > 0 && <ClientPieCard  rows={pie} />}
                {trend.length === 0 && pie.length === 0 && (
                  <div className="rounded-xl bg-white border border-zinc-200 px-5 py-8 text-center text-sm text-zinc-400">
                    グラフ表示には請求データが必要です
                  </div>
                )}
              </div>
            </div>

          </div>
        )}
      </div>
    </div>
  )
}
