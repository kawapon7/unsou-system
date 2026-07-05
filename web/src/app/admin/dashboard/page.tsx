'use client'

import { useState, useEffect, useCallback } from 'react'
import { useSearchParams, useRouter, usePathname } from 'next/navigation'
import { todayYearMonthJST } from '@/utils/date'
import {
  fetchScheduleSummary,
  fetchProjectBreakdown,
  fetchScheduleTrend,
  type ScheduleSummary,
  type ProjectBreakdownRow,
  type ScheduleTrendRow,
} from './actions'

// ── ユーティリティ ────────────────────────────────────────

const yen = (n: number) =>
  `¥${Math.round(n).toLocaleString('ja-JP')}`

function prevYM(ym: string) {
  const [y, m] = ym.split('-').map(Number)
  const d = new Date(y, m - 2, 1)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
}

function nextYM(ym: string) {
  const [y, m] = ym.split('-').map(Number)
  const d = new Date(y, m, 1)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
}

function ymLabel(ym: string) {
  const [y, m] = ym.split('-')
  return `${y}年${Number(m)}月`
}

function grossProfitRate(sales: number, cost: number) {
  if (sales === 0) return null
  return Math.round(((sales - cost) / sales) * 100)
}

// ── タブ定義 ──────────────────────────────────────────────

type Tab = 'summary' | 'projects'
const TABS: { key: Tab; label: string }[] = [
  { key: 'summary',  label: 'サマリー' },
  { key: 'projects', label: '案件別' },
]

// ── KPI カード ────────────────────────────────────────────

function KpiCard({
  label, accent, confirmed, projected, landing, rate,
}: {
  label:     string
  accent:    string
  confirmed: number
  projected: number
  landing:   number
  rate?:     number | null
}) {
  return (
    <div className={`rounded-xl bg-white border border-zinc-200 ${accent} px-5 py-4`}>
      <p className="text-xs text-zinc-500 mb-3">{label}</p>
      <div className="grid grid-cols-3 gap-2">
        <div>
          <p className="text-[10px] text-zinc-500 mb-0.5">実績（今日まで）</p>
          <p className="text-base font-bold text-zinc-900 tabular-nums">{yen(confirmed)}</p>
        </div>
        <div>
          <p className="text-[10px] text-zinc-500 mb-0.5">予定残</p>
          <p className="text-base font-semibold text-zinc-500 tabular-nums">{yen(projected)}</p>
        </div>
        <div>
          <p className="text-[10px] text-zinc-600 mb-0.5 font-semibold">月末着地</p>
          <p className="text-base font-bold text-zinc-900 tabular-nums">{yen(landing)}</p>
          {rate != null && (
            <p className="text-[10px] text-zinc-500 mt-0.5 tabular-nums">{rate}%</p>
          )}
        </div>
      </div>
    </div>
  )
}

// ── 稼働バー ──────────────────────────────────────────────

function WorkBar({ confirmed, projected, absent }: { confirmed: number; projected: number; absent: number }) {
  const total = confirmed + projected + absent
  if (total === 0) return null
  const pct = (n: number) => `${Math.round((n / total) * 100)}%`

  return (
    <div className="rounded-xl bg-white border border-zinc-200 px-5 py-4">
      <p className="text-xs text-zinc-500 mb-3">稼働状況（延べ日数）</p>
      <div className="flex h-2 rounded-full overflow-hidden gap-px mb-3">
        {confirmed > 0 && <div className="bg-emerald-500" style={{ width: pct(confirmed) }} />}
        {projected > 0 && <div className="bg-emerald-200" style={{ width: pct(projected) }} />}
        {absent   > 0 && <div className="bg-rose-300"    style={{ width: pct(absent) }} />}
      </div>
      <div className="flex flex-wrap gap-4 text-xs text-zinc-500">
        <span className="flex items-center gap-1.5">
          <span className="inline-block w-2.5 h-2.5 rounded-sm bg-emerald-500" />
          実績 {confirmed}日
        </span>
        <span className="flex items-center gap-1.5">
          <span className="inline-block w-2.5 h-2.5 rounded-sm bg-emerald-200" />
          予定残 {projected}日
        </span>
        <span className="flex items-center gap-1.5">
          <span className="inline-block w-2.5 h-2.5 rounded-sm bg-rose-300" />
          休み {absent}日
        </span>
      </div>
    </div>
  )
}

// ── 月別推移グラフ ────────────────────────────────────────

function TrendChart({ rows, currentYM }: { rows: ScheduleTrendRow[]; currentYM: string }) {
  const max = Math.max(...rows.map(r => r.confirmedSales + r.projectedSales), 1)
  const BAR_H = 120

  return (
    <div className="rounded-xl bg-white border border-zinc-200 px-5 pt-4 pb-3">
      <p className="text-xs font-semibold text-zinc-500 mb-4 uppercase tracking-widest">
        月別売上推移（過去12ヶ月）
      </p>
      <div className="flex items-end gap-1 pb-1">
        {rows.map(r => {
          const isCurrent = r.month === currentYM
          const confH = Math.round((r.confirmedSales / max) * BAR_H)
          const projH = Math.round((r.projectedSales / max) * BAR_H)
          const totalH = confH + projH
          const label = r.month.slice(5).replace(/^0/, '') + '月'
          return (
            <div key={r.month} className="flex flex-col items-center gap-0.5 flex-1 min-w-0">
              <div className="relative w-full rounded-sm overflow-hidden bg-zinc-100" style={{ height: BAR_H }}>
                <div className="absolute bottom-0 w-full flex flex-col-reverse" style={{ height: totalH }}>
                  {confH > 0 && <div className="bg-emerald-600 w-full" style={{ height: confH }} />}
                  {projH > 0 && <div className="bg-emerald-200 w-full" style={{ height: projH }} />}
                </div>
              </div>
              <span className={`text-[9px] tabular-nums ${isCurrent ? 'text-zinc-900 font-semibold' : 'text-zinc-400'}`}>
                {label}
              </span>
            </div>
          )
        })}
      </div>
      <div className="flex items-center gap-4 mt-2">
        <span className="flex items-center gap-1 text-[10px] text-zinc-500">
          <span className="inline-block w-3 h-3 rounded-sm bg-emerald-600" />実績
        </span>
        <span className="flex items-center gap-1 text-[10px] text-zinc-500">
          <span className="inline-block w-3 h-3 rounded-sm bg-emerald-200" />予定残
        </span>
      </div>
    </div>
  )
}

// ── サマリータブ ──────────────────────────────────────────

function SummaryTab({
  summary, trend, yearMonth,
}: {
  summary:   ScheduleSummary
  trend:     ScheduleTrendRow[]
  yearMonth: string
}) {
  const landingSales = summary.confirmedSales + summary.projectedSales
  const landingCost  = summary.confirmedCost  + summary.projectedCost
  const landingProfit = landingSales - landingCost
  const confirmedProfit = summary.confirmedSales - summary.confirmedCost

  return (
    <div className="space-y-4">
      <KpiCard
        label="売上"
        accent="border-l-4 border-l-emerald-400"
        confirmed={summary.confirmedSales}
        projected={summary.projectedSales}
        landing={landingSales}
      />
      <KpiCard
        label="仕入"
        accent="border-l-4 border-l-rose-400"
        confirmed={summary.confirmedCost}
        projected={summary.projectedCost}
        landing={landingCost}
      />
      <div className="rounded-xl bg-white border border-zinc-200 border-l-4 border-l-violet-400 px-5 py-4">
        <p className="text-xs text-zinc-500 mb-3">粗利</p>
        <div className="grid grid-cols-3 gap-2">
          <div>
            <p className="text-[10px] text-zinc-400 mb-0.5">実績（今日まで）</p>
            <p className={`text-base font-bold tabular-nums ${confirmedProfit >= 0 ? 'text-emerald-700' : 'text-rose-700'}`}>
              {yen(confirmedProfit)}
            </p>
            {grossProfitRate(summary.confirmedSales, summary.confirmedCost) != null && (
              <p className="text-[10px] text-zinc-400 mt-0.5">
                {grossProfitRate(summary.confirmedSales, summary.confirmedCost)}%
              </p>
            )}
          </div>
          <div>
            <p className="text-[10px] text-zinc-400 mb-0.5">予定残</p>
            <p className="text-base font-semibold text-zinc-400 tabular-nums">
              {yen(summary.projectedSales - summary.projectedCost)}
            </p>
          </div>
          <div>
            <p className="text-[10px] text-zinc-400 mb-0.5 font-medium">月末着地</p>
            <p className={`text-base font-bold tabular-nums ${landingProfit >= 0 ? 'text-emerald-700' : 'text-rose-700'}`}>
              {yen(landingProfit)}
            </p>
            {grossProfitRate(landingSales, landingCost) != null && (
              <p className="text-[10px] text-zinc-400 mt-0.5">
                {grossProfitRate(landingSales, landingCost)}%
              </p>
            )}
          </div>
        </div>
      </div>

      <WorkBar
        confirmed={summary.confirmedDays}
        projected={summary.projectedDays}
        absent={summary.absentDays}
      />

      {trend.length > 0 && <TrendChart rows={trend} currentYM={yearMonth} />}
    </div>
  )
}

// ── 案件別タブ ────────────────────────────────────────────

function ProjectsTab({ rows }: { rows: ProjectBreakdownRow[] }) {
  if (rows.length === 0) {
    return (
      <div className="rounded-xl bg-white border border-zinc-200 px-5 py-10 text-center text-sm text-zinc-400">
        この月のスケジュールデータはありません
      </div>
    )
  }

  const totalLanding = rows.reduce((s, r) => s + r.landingSales, 0)

  return (
    <div className="space-y-3">
      <div className="rounded-xl bg-white border border-zinc-200 overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-zinc-50">
            <tr>
              <th className="px-4 py-2.5 text-left text-xs font-medium text-zinc-500">案件名</th>
              <th className="px-4 py-2.5 text-left text-xs font-medium text-zinc-500 hidden sm:table-cell">取引先</th>
              <th className="px-4 py-2.5 text-center text-xs font-medium text-zinc-500">実績</th>
              <th className="px-4 py-2.5 text-center text-xs font-medium text-zinc-500">予定残</th>
              <th className="px-4 py-2.5 text-right text-xs font-medium text-zinc-500">着地売上</th>
              <th className="px-4 py-2.5 text-right text-xs font-medium text-zinc-500">前月比</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-zinc-100">
            {rows.map(r => {
              const momLabel = r.prevDays === 0
                ? r.confirmedDays + r.projectedDays > 0 ? '新規' : '—'
                : null
              const momPct = r.prevDays > 0
                ? Math.round(((r.confirmedDays + r.projectedDays) / r.prevDays) * 100) - 100
                : null
              return (
                <tr key={r.projectId} className="hover:bg-zinc-50">
                  <td className="px-4 py-3 font-medium text-zinc-900 max-w-[140px] truncate">{r.projectName}</td>
                  <td className="px-4 py-3 text-zinc-500 hidden sm:table-cell text-xs">{r.clientName}</td>
                  <td className="px-4 py-3 text-center text-zinc-700 tabular-nums">{r.confirmedDays}日</td>
                  <td className="px-4 py-3 text-center text-zinc-400 tabular-nums">{r.projectedDays}日</td>
                  <td className="px-4 py-3 text-right font-semibold text-zinc-900 tabular-nums">{yen(r.landingSales)}</td>
                  <td className="px-4 py-3 text-right tabular-nums">
                    {momLabel && (
                      <span className={`text-xs font-medium ${momLabel === '新規' ? 'text-blue-600' : 'text-zinc-400'}`}>
                        {momLabel}
                      </span>
                    )}
                    {momPct != null && (
                      <span className={`text-xs font-medium ${momPct < -10 ? 'text-rose-600' : momPct > 10 ? 'text-emerald-600' : 'text-zinc-500'}`}>
                        {momPct > 0 ? `▲ ${momPct}%` : momPct < 0 ? `▼ ${Math.abs(momPct)}%` : '±0%'}
                      </span>
                    )}
                  </td>
                </tr>
              )
            })}
          </tbody>
          <tfoot className="bg-zinc-50 border-t border-zinc-200">
            <tr>
              <td colSpan={4} className="px-4 py-2.5 text-xs text-zinc-500">合計（着地）</td>
              <td className="px-4 py-2.5 text-right font-bold text-zinc-900 tabular-nums">{yen(totalLanding)}</td>
              <td />
            </tr>
          </tfoot>
        </table>
      </div>
      <p className="text-xs text-zinc-400 px-1">
        着地 ＝ 実績（今日まで）＋ 予定残 　前月比はスケジュール日数ベース
      </p>
    </div>
  )
}

// ── メインページ ──────────────────────────────────────────

export default function DashboardPage() {
  const searchParams = useSearchParams()
  const router       = useRouter()
  const pathname     = usePathname()
  const tab          = (searchParams.get('tab') as Tab | null) ?? 'summary'
  const setTab       = (t: Tab) => router.replace(`${pathname}?tab=${t}`)

  const [yearMonth, setYearMonth] = useState(todayYearMonthJST())
  const [summary,   setSummary]   = useState<ScheduleSummary | null>(null)
  const [projects,  setProjects]  = useState<ProjectBreakdownRow[]>([])
  const [trend,     setTrend]     = useState<ScheduleTrendRow[]>([])
  const [loading,   setLoading]   = useState(true)
  const [error,     setError]     = useState<string | null>(null)

  const load = useCallback(async (ym: string) => {
    setLoading(true)
    setError(null)
    const [summaryRes, projectsRes, trendRes] = await Promise.all([
      fetchScheduleSummary(ym),
      fetchProjectBreakdown(ym),
      fetchScheduleTrend(),
    ])
    const firstErr = [summaryRes, projectsRes, trendRes].map(r => r.error).find(Boolean)
    if (firstErr) setError(firstErr)
    if (summaryRes.data)  setSummary(summaryRes.data)
    if (projectsRes.data) setProjects(projectsRes.data)
    if (trendRes.data)    setTrend(trendRes.data)
    setLoading(false)
  }, [])

  useEffect(() => { load(yearMonth) }, [load, yearMonth])

  return (
    <div className="min-h-screen bg-zinc-50">
      <div className="mx-auto max-w-5xl px-6 py-8">

        {/* ヘッダー */}
        <div className="flex flex-wrap items-start justify-between gap-4 mb-6">
          <div>
            <h1 className="text-xl font-semibold text-zinc-900">業績サマリー</h1>
            <p className="text-sm text-zinc-500 mt-0.5">案件ベース・発生主義</p>
          </div>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => setYearMonth(ym => prevYM(ym))}
              className="h-8 w-8 flex items-center justify-center rounded-full border border-zinc-200 bg-white text-zinc-500 hover:bg-zinc-50 text-sm"
            >‹</button>
            <span className="text-sm font-semibold text-zinc-900 tabular-nums min-w-[100px] text-center">
              {ymLabel(yearMonth)}
            </span>
            <button
              type="button"
              onClick={() => setYearMonth(ym => nextYM(ym))}
              className="h-8 w-8 flex items-center justify-center rounded-full border border-zinc-200 bg-white text-zinc-500 hover:bg-zinc-50 text-sm"
            >›</button>
            <button
              type="button"
              onClick={() => setYearMonth(todayYearMonthJST())}
              className="rounded-lg border border-zinc-200 bg-white px-3 py-1.5 text-xs text-zinc-600 hover:bg-zinc-50"
            >今月</button>
          </div>
        </div>

        {/* タブ */}
        <div className="flex gap-1 border-b border-zinc-200 mb-6">
          {TABS.map(({ key, label }) => (
            <button
              key={key}
              type="button"
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

        {error && (
          <p className="rounded-lg bg-red-50 px-4 py-2 text-sm text-red-600 mb-4">{error}</p>
        )}

        {loading ? (
          <div className="py-24 text-center text-sm text-zinc-400">読み込み中…</div>
        ) : (
          tab === 'summary' && summary
            ? <SummaryTab summary={summary} trend={trend} yearMonth={yearMonth} />
            : <ProjectsTab rows={projects} />
        )}
      </div>
    </div>
  )
}
