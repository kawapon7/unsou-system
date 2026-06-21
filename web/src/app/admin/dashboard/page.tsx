'use client'

import { useState, useEffect, useCallback } from 'react'
import {
  fetchCashflowSummary,
  fetchTimelineIn,
  fetchTimelineOut,
  fetchAlerts,
  fetchMonthlyTrend,
  type PeriodType,
  type CashflowSummary,
  type TimelineInRow,
  type TimelineOutRow,
  type AlertData,
  type MonthlyTrendRow,
} from './actions'

// ── ユーティリティ ────────────────────────────────────────

const yen = (n: number) => `¥${n.toLocaleString('ja-JP')}`

function todayISO() {
  return new Date().toLocaleDateString('sv-SE', { timeZone: 'Asia/Tokyo' })
}

function currentYearMonth() {
  return todayISO().slice(0, 7)
}

function fmtDate(iso: string | null) {
  if (!iso) return '未設定'
  const [, m, d] = iso.split('-')
  return `${Number(m)}/${Number(d)}`
}

function addDays(iso: string, n: number) {
  const d = new Date(iso)
  d.setDate(d.getDate() + n)
  return d.toLocaleDateString('sv-SE', { timeZone: 'Asia/Tokyo' })
}

function weekLabel(iso: string) {
  const d = new Date(iso)
  const dow = d.getDay()
  const mon = new Date(d); mon.setDate(d.getDate() - ((dow + 6) % 7))
  const sun = new Date(mon); sun.setDate(mon.getDate() + 6)
  return `${mon.getMonth() + 1}/${mon.getDate()} 〜 ${sun.getMonth() + 1}/${sun.getDate()}`
}

// ── 期間ナビゲーションヘルパー ────────────────────────────

function prevPeriod(period: PeriodType, ref: string): string {
  if (period === 'month') {
    const [y, m] = ref.split('-').map(Number)
    const d = new Date(y, m - 2, 1)
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
  }
  if (period === 'week') return addDays(ref, -7)
  return addDays(ref, -1)
}

function nextPeriod(period: PeriodType, ref: string): string {
  if (period === 'month') {
    const [y, m] = ref.split('-').map(Number)
    const d = new Date(y, m, 1)
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
  }
  if (period === 'week') return addDays(ref, 7)
  return addDays(ref, 1)
}

function periodLabel(period: PeriodType, ref: string): string {
  if (period === 'month') {
    const [y, m] = ref.split('-')
    return `${y}年${Number(m)}月`
  }
  if (period === 'week') return weekLabel(ref)
  const [, m, d] = ref.split('-')
  return `${Number(m)}月${Number(d)}日`
}

// ── KPIカード ─────────────────────────────────────────────

function KpiBlock({
  label, confirmed, projected, accent,
}: {
  label: string; confirmed: number; projected: number; accent: 'green' | 'red'
}) {
  const accentCls = accent === 'green'
    ? 'border-l-4 border-l-emerald-400'
    : 'border-l-4 border-l-rose-400'
  return (
    <div className={`rounded-xl bg-white border border-zinc-200 px-5 py-4 ${accentCls}`}>
      <p className="text-xs text-zinc-500 mb-2">{label}</p>
      <div className="flex items-end gap-3 flex-wrap">
        <div>
          <p className="text-[10px] text-zinc-400 mb-0.5">確定</p>
          <p className="text-xl font-bold text-zinc-900 tabular-nums">{yen(confirmed)}</p>
        </div>
        <div className="pb-0.5">
          <p className="text-[10px] text-zinc-400 mb-0.5">予定</p>
          <p className="text-sm font-semibold text-zinc-500 tabular-nums">{yen(projected)}</p>
        </div>
      </div>
    </div>
  )
}

function GrossProfitCard({ value }: { value: number }) {
  const color = value >= 0 ? 'text-emerald-700' : 'text-rose-700'
  return (
    <div className="rounded-xl bg-white border border-zinc-200 px-5 py-4 border-l-4 border-l-zinc-300">
      <p className="text-xs text-zinc-500 mb-1">粗利概算（イン合計 − アウト合計）</p>
      <p className={`text-xl font-bold tabular-nums ${color}`}>{yen(value)}</p>
    </div>
  )
}

// ── タイムライン：イン ────────────────────────────────────

const IN_STATUS: Record<string, { label: string; cls: string; confirmed: boolean }> = {
  paid:       { label: '入金済', cls: 'bg-emerald-100 text-emerald-700', confirmed: true },
  issued:     { label: '未入金', cls: 'bg-rose-100 text-rose-700',       confirmed: false },
  draft:      { label: '未確定', cls: 'bg-zinc-100 text-zinc-500',        confirmed: false },
  no_invoice: { label: '未請求', cls: 'bg-amber-100 text-amber-700',      confirmed: false },
}

function TimelineInCard({ rows }: { rows: TimelineInRow[] }) {
  const confirmed  = rows.filter(r => r.confirmed)
  const projected  = rows.filter(r => !r.confirmed)

  if (rows.length === 0)
    return <EmptyCard>今期の請求データはありません</EmptyCard>

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
          {confirmed.map(r => <InRow key={r.id} r={r} />)}
          {confirmed.length > 0 && projected.length > 0 && (
            <tr>
              <td colSpan={4} className="px-4 py-1 text-[10px] text-zinc-400 bg-zinc-50">
                ↓ 予定（未入金）
              </td>
            </tr>
          )}
          {projected.map(r => <InRow key={r.id} r={r} muted />)}
        </tbody>
        <tfoot className="bg-zinc-50 border-t border-zinc-200">
          <tr>
            <td colSpan={2} className="px-4 py-2 text-xs text-zinc-500">合計</td>
            <td className="px-4 py-2 text-right font-bold text-zinc-900 tabular-nums">
              {yen(rows.reduce((s, r) => s + r.amount, 0))}
            </td>
            <td />
          </tr>
        </tfoot>
      </table>
    </div>
  )
}

function InRow({ r, muted }: { r: TimelineInRow; muted?: boolean }) {
  const st = IN_STATUS[r.status] ?? { label: r.status, cls: 'bg-zinc-100 text-zinc-500', confirmed: false }
  return (
    <tr className={`hover:bg-zinc-50 ${muted ? 'opacity-70' : ''}`}>
      <td className="px-4 py-3 font-medium text-zinc-900">{r.companyName}</td>
      <td className="px-4 py-3 text-zinc-600 tabular-nums">{fmtDate(r.dueDate)}</td>
      <td className="px-4 py-3 text-right font-semibold text-zinc-900 tabular-nums">{yen(r.amount)}</td>
      <td className="px-4 py-3 text-center">
        <span className={`inline-flex rounded-full px-2 py-0.5 text-xs font-medium ${st.cls}`}>
          {st.label}
        </span>
      </td>
    </tr>
  )
}

// ── タイムライン：アウト ──────────────────────────────────

function TimelineOutCard({ rows }: { rows: TimelineOutRow[] }) {
  const confirmed = rows.filter(r => r.approved)
  const projected = rows.filter(r => !r.approved)

  if (rows.length === 0)
    return <EmptyCard>今期の支払データはありません</EmptyCard>

  return (
    <div className="rounded-xl bg-white border border-zinc-200 overflow-hidden">
      <table className="w-full text-sm">
        <thead className="bg-zinc-50">
          <tr>
            <th className="px-4 py-2.5 text-left text-xs font-medium text-zinc-500">委託先</th>
            <th className="px-4 py-2.5 text-right text-xs font-medium text-zinc-500">支払額</th>
            <th className="px-4 py-2.5 text-right text-xs font-medium text-zinc-500">調整金</th>
            <th className="px-4 py-2.5 text-center text-xs font-medium text-zinc-500">状態</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-zinc-100">
          {confirmed.map(r => <OutRow key={r.id} r={r} />)}
          {confirmed.length > 0 && projected.length > 0 && (
            <tr>
              <td colSpan={4} className="px-4 py-1 text-[10px] text-zinc-400 bg-zinc-50">
                ↓ 予定（未承認）
              </td>
            </tr>
          )}
          {projected.map(r => <OutRow key={r.id} r={r} muted />)}
        </tbody>
        <tfoot className="bg-zinc-50 border-t border-zinc-200">
          <tr>
            <td className="px-4 py-2 text-xs text-zinc-500">合計</td>
            <td className="px-4 py-2 text-right font-bold text-zinc-900 tabular-nums">
              {yen(rows.reduce((s, r) => s + r.amount, 0))}
            </td>
            <td colSpan={2} />
          </tr>
        </tfoot>
      </table>
    </div>
  )
}

function OutRow({ r, muted }: { r: TimelineOutRow; muted?: boolean }) {
  return (
    <tr className={`hover:bg-zinc-50 ${muted ? 'opacity-70' : ''}`}>
      <td className="px-4 py-3 font-medium text-zinc-900">{r.contractorName}</td>
      <td className="px-4 py-3 text-right font-semibold text-zinc-900 tabular-nums">{yen(r.amount)}</td>
      <td className="px-4 py-3 text-right text-zinc-500 tabular-nums text-xs">
        {r.adjustmentAmount !== 0 ? (r.adjustmentAmount > 0 ? '+' : '') + yen(r.adjustmentAmount) : '—'}
      </td>
      <td className="px-4 py-3 text-center">
        {r.approved
          ? <span className="inline-flex rounded-full px-2 py-0.5 text-xs font-medium bg-emerald-100 text-emerald-700">確定</span>
          : <span className="inline-flex rounded-full px-2 py-0.5 text-xs font-medium bg-amber-100 text-amber-700">予定</span>
        }
      </td>
    </tr>
  )
}

// ── 月別棒グラフ ──────────────────────────────────────────

function MonthlyBarChart({ rows }: { rows: MonthlyTrendRow[] }) {
  const max = Math.max(...rows.map(r => Math.max(r.confirmedIn + r.projectedIn, r.confirmedOut)), 1)
  const BAR_H = 140

  return (
    <div className="rounded-xl bg-white border border-zinc-200 px-5 pt-4 pb-3">
      <p className="text-xs font-semibold text-zinc-500 mb-4 uppercase tracking-widest">
        月別イン・アウト（過去12ヶ月）
      </p>
      <div className="flex items-end gap-1 pb-1">
        {rows.map(r => {
          const inH     = Math.round(((r.confirmedIn + r.projectedIn) / max) * BAR_H)
          const confH   = Math.round((r.confirmedIn / max) * BAR_H)
          const outH    = Math.round((r.confirmedOut / max) * BAR_H)
          const label   = r.month.slice(5).replace(/^0/, '') + '月'
          return (
            <div key={r.month} className="flex flex-col items-center gap-0.5 flex-1 min-w-0">
              <div className="relative w-full rounded-sm bg-zinc-100" style={{ height: BAR_H }}>
                {/* イン：薄（予定） */}
                {inH > 0 && (
                  <div className="absolute bottom-0 w-full bg-emerald-200 rounded-sm" style={{ height: inH }} />
                )}
                {/* イン：濃（確定） */}
                {confH > 0 && (
                  <div className="absolute bottom-0 w-full bg-emerald-600 rounded-sm" style={{ height: confH }} />
                )}
                {/* アウト（右半分に重ねて表示） */}
                {outH > 0 && (
                  <div className="absolute bottom-0 right-0 w-1/2 bg-rose-400 rounded-sm opacity-80" style={{ height: outH }} />
                )}
              </div>
              <span className="text-[9px] text-zinc-400 tabular-nums">{label}</span>
            </div>
          )
        })}
      </div>
      <div className="flex items-center gap-4 mt-2">
        <span className="flex items-center gap-1 text-[10px] text-zinc-500">
          <span className="inline-block w-3 h-3 rounded-sm bg-emerald-600" />確定イン
        </span>
        <span className="flex items-center gap-1 text-[10px] text-zinc-500">
          <span className="inline-block w-3 h-3 rounded-sm bg-emerald-200" />予定イン
        </span>
        <span className="flex items-center gap-1 text-[10px] text-zinc-500">
          <span className="inline-block w-3 h-3 rounded-sm bg-rose-400" />アウト
        </span>
      </div>
    </div>
  )
}

// ── 共通 ─────────────────────────────────────────────────

function EmptyCard({ children }: { children: React.ReactNode }) {
  return (
    <div className="rounded-xl bg-white border border-zinc-200 px-5 py-8 text-center text-sm text-zinc-400">
      {children}
    </div>
  )
}

// ── 期間タブ ──────────────────────────────────────────────

const PERIOD_TABS: { key: PeriodType; label: string }[] = [
  { key: 'month', label: '月次' },
  { key: 'week',  label: '週次' },
  { key: 'day',   label: '日次' },
]

// ================================================================
// メインページ
// ================================================================

export default function OyabunDashboard() {
  const today = todayISO()

  const [period,   setPeriod]   = useState<PeriodType>('month')
  const [refDate,  setRefDate]  = useState(currentYearMonth())   // 月次='YYYY-MM', 週/日='YYYY-MM-DD'

  const [summary,  setSummary]  = useState<CashflowSummary | null>(null)
  const [inRows,   setInRows]   = useState<TimelineInRow[]>([])
  const [outRows,  setOutRows]  = useState<TimelineOutRow[]>([])
  const [alerts,   setAlerts]   = useState<AlertData | null>(null)
  const [trend,    setTrend]    = useState<MonthlyTrendRow[]>([])
  const [loading,  setLoading]  = useState(true)
  const [error,    setError]    = useState<string | null>(null)

  // 期間切り替え時に refDate をリセット
  function handlePeriodChange(p: PeriodType) {
    setPeriod(p)
    setRefDate(p === 'month' ? currentYearMonth() : today)
  }

  const load = useCallback(async (p: PeriodType, ref: string) => {
    setLoading(true)
    setError(null)
    const [summaryRes, inRes, outRes, alertRes, trendRes] = await Promise.all([
      fetchCashflowSummary(p, ref),
      fetchTimelineIn(p, ref),
      fetchTimelineOut(p, ref),
      fetchAlerts(p === 'month' ? ref.slice(0, 7) : ref.slice(0, 7)),
      fetchMonthlyTrend(),
    ])
    const firstErr = [summaryRes, inRes, outRes, alertRes, trendRes]
      .map(r => r.error).find(Boolean)
    if (firstErr) setError(firstErr)
    if (summaryRes.data) setSummary(summaryRes.data)
    if (inRes.data)      setInRows(inRes.data)
    if (outRes.data)     setOutRows(outRes.data)
    if (alertRes.data)   setAlerts(alertRes.data)
    if (trendRes.data)   setTrend(trendRes.data)
    setLoading(false)
  }, [])

  useEffect(() => { load(period, refDate) }, [load, period, refDate])

  return (
    <div className="min-h-screen bg-zinc-50">
      <div className="mx-auto max-w-6xl px-4 sm:px-6 py-8 space-y-6">

        {/* 期間タブ + ナビゲーション */}
        <div className="flex flex-wrap items-center gap-3">
          {/* タブ */}
          <div className="flex rounded-xl border border-zinc-200 bg-white overflow-hidden text-sm font-medium">
            {PERIOD_TABS.map(tab => (
              <button
                key={tab.key}
                type="button"
                onClick={() => handlePeriodChange(tab.key)}
                className={`px-5 py-2 transition ${
                  period === tab.key
                    ? 'bg-zinc-900 text-white'
                    : 'text-zinc-600 hover:bg-zinc-50'
                }`}
              >
                {tab.label}
              </button>
            ))}
          </div>

          {/* 期間ナビゲーター */}
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => setRefDate(r => prevPeriod(period, r))}
              className="h-8 w-8 flex items-center justify-center rounded-full border border-zinc-200 bg-white text-zinc-500 hover:bg-zinc-50 text-sm"
            >‹</button>
            <span className="text-sm font-semibold text-zinc-900 tabular-nums min-w-[140px] text-center">
              {periodLabel(period, refDate)}
            </span>
            <button
              type="button"
              onClick={() => setRefDate(r => nextPeriod(period, r))}
              className="h-8 w-8 flex items-center justify-center rounded-full border border-zinc-200 bg-white text-zinc-500 hover:bg-zinc-50 text-sm"
            >›</button>
          </div>

          {/* 今日/今月に戻る */}
          <button
            type="button"
            onClick={() => setRefDate(period === 'month' ? currentYearMonth() : today)}
            className="rounded-lg border border-zinc-200 bg-white px-3 py-1.5 text-xs text-zinc-600 hover:bg-zinc-50"
          >
            今{period === 'month' ? '月' : period === 'week' ? '週' : '日'}
          </button>
        </div>

        {error && (
          <p className="rounded-lg bg-red-50 px-4 py-2 text-sm text-red-600">{error}</p>
        )}

        {alerts && alerts.pendingInvoices > 0 && (
          <div className="rounded-xl bg-amber-50 border border-amber-200 px-4 py-3">
            <p className="text-xs font-semibold text-amber-700">
              ⚠ 未確定の請求書が {alerts.pendingInvoices} 件あります
            </p>
          </div>
        )}

        {loading ? (
          <div className="py-24 text-center text-sm text-zinc-400">読み込み中…</div>
        ) : (
          <div className="space-y-6">

            {/* KPI：確定 / 予定 の2カラム */}
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
              <KpiBlock
                label="イン（売上）"
                confirmed={summary?.confirmedIn ?? 0}
                projected={summary?.projectedIn ?? 0}
                accent="green"
              />
              <KpiBlock
                label="アウト（支払）"
                confirmed={summary?.confirmedOut ?? 0}
                projected={summary?.projectedOut ?? 0}
                accent="red"
              />
              <GrossProfitCard value={summary?.grossProfit ?? 0} />
            </div>

            {/* タイムライン：イン / アウト 並列 */}
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
              <section>
                <h2 className="text-sm font-semibold text-zinc-700 mb-2 flex items-center gap-2">
                  <span className="inline-block w-2 h-2 rounded-full bg-emerald-500" />
                  イン（売上・入金）
                </h2>
                <TimelineInCard rows={inRows} />
              </section>
              <section>
                <h2 className="text-sm font-semibold text-zinc-700 mb-2 flex items-center gap-2">
                  <span className="inline-block w-2 h-2 rounded-full bg-rose-500" />
                  アウト（外注費・支払）
                </h2>
                <TimelineOutCard rows={outRows} />
              </section>
            </div>

            {/* 月次グラフ（月次表示のときのみ） */}
            {period === 'month' && trend.length > 0 && (
              <MonthlyBarChart rows={trend} />
            )}

          </div>
        )}
      </div>
    </div>
  )
}
