'use client'

import { useState, useEffect, useCallback } from 'react'
import { useSearchParams, useRouter, usePathname } from 'next/navigation'
import { useMonth } from '@/contexts/MonthContext'
import { fetchSalesList } from '@/app/admin/sales/actions'
import { fetchPaymentByContractor } from '@/app/admin/billing/actions'
import { fetchMonthlyTrend, type MonthlyTrendRow } from '@/app/admin/dashboard/actions'
import {
  fetchDailyCashflowCalendar,
  type DailyDetail,
  type DailyCashflowCalendarResult,
} from '@/app/_actions/cashflowActions'

// ── ユーティリティ ────────────────────────────────────────

type CashflowTab = 'pnl' | 'client' | 'trend' | 'calendar'

// 万単位で丸めてコンパクト表示（カレンダーセル用）
function fmtAmt(n: number): string {
  const abs = Math.abs(n)
  const sign = n < 0 ? '-' : ''
  if (abs >= 10000) return `${sign}${parseFloat((abs / 10000).toFixed(1))}万`
  return `${sign}${abs.toLocaleString('ja-JP')}`
}

const yen = (n: number) => `¥${n.toLocaleString('ja-JP')}`

function pctStr(a: number, b: number) {
  if (b === 0) return '—'
  return `${Math.round((a / b) * 100)}%`
}

// ── 共通 UI ───────────────────────────────────────────────

function KpiCard({
  label,
  value,
  sub,
  accent,
}: {
  label: string
  value: string
  sub?: string
  accent?: 'green' | 'red' | 'blue' | 'default'
}) {
  const colors = {
    green:   'border-green-200 bg-green-50',
    red:     'border-red-200   bg-red-50',
    blue:    'border-blue-200  bg-blue-50',
    default: 'border-zinc-200  bg-white',
  }
  const textColors = {
    green:   'text-green-700',
    red:     'text-red-700',
    blue:    'text-blue-700',
    default: 'text-zinc-900',
  }
  const cls    = colors[accent ?? 'default']
  const txtCls = textColors[accent ?? 'default']
  return (
    <div className={`rounded-xl border px-5 py-4 ${cls}`}>
      <p className="text-xs text-zinc-500 mb-1">{label}</p>
      <p className={`text-2xl font-bold tabular-nums ${txtCls}`}>{value}</p>
      {sub && <p className="text-xs text-zinc-400 mt-0.5">{sub}</p>}
    </div>
  )
}

// ── 月次損益タブ ──────────────────────────────────────────

function PnlTab({ yearMonth }: { yearMonth: string }) {
  const [totalIn,  setTotalIn]  = useState(0)
  const [totalOut, setTotalOut] = useState(0)
  const [loading,  setLoading]  = useState(true)
  const [error,    setError]    = useState<string | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    const [salesRes, payRes] = await Promise.all([
      fetchSalesList(yearMonth),
      fetchPaymentByContractor(yearMonth),
    ])
    if (salesRes.error) { setError(salesRes.error); setLoading(false); return }
    if (payRes.error)   { setError(payRes.error);   setLoading(false); return }

    const inTotal  = (salesRes.data ?? []).reduce((s, r) => s + r.totalAmount, 0)
    // PaymentRow.netPayment = 最終支払額（源泉・インボイス控除適用後）
    const outTotal = (payRes.data  ?? []).reduce((s, r) => s + r.netPayment,  0)
    setTotalIn(inTotal)
    setTotalOut(outTotal)
    setLoading(false)
  }, [yearMonth])

  useEffect(() => { load() }, [load])

  if (loading) return <div className="py-20 text-center text-sm text-zinc-400">読み込み中...</div>
  if (error)   return <p className="text-sm text-red-600 bg-red-50 rounded-lg px-4 py-3">{error}</p>

  const gross     = totalIn - totalOut
  const grossRate = pctStr(gross, totalIn)

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <KpiCard label="総売上（IN）"   value={yen(totalIn)}  accent="blue"    sub={`${yearMonth} 確定分`} />
        <KpiCard label="総支払（OUT）"  value={yen(totalOut)} accent="red"     sub={`${yearMonth} 確定分`} />
        <KpiCard label="粗利"           value={yen(gross)}    accent={gross >= 0 ? 'green' : 'red'} />
        <KpiCard label="粗利益率"       value={grossRate}     accent={gross >= 0 ? 'green' : 'red'} sub="（粗利÷売上）" />
      </div>

      {/* 内訳バー */}
      <div className="rounded-xl border border-zinc-200 bg-white p-5">
        <p className="text-xs font-semibold text-zinc-500 mb-3">売上 vs 支払 構成</p>
        {totalIn > 0 ? (
          <div className="space-y-3">
            <div>
              <div className="flex justify-between text-xs text-zinc-500 mb-1">
                <span>売上（IN）</span>
                <span className="font-medium text-blue-700">{yen(totalIn)}</span>
              </div>
              <div className="h-3 rounded-full bg-zinc-100 overflow-hidden">
                <div className="h-3 rounded-full bg-blue-400" style={{ width: '100%' }} />
              </div>
            </div>
            <div>
              <div className="flex justify-between text-xs text-zinc-500 mb-1">
                <span>支払（OUT）</span>
                <span className="font-medium text-red-600">{yen(totalOut)}</span>
              </div>
              <div className="h-3 rounded-full bg-zinc-100 overflow-hidden">
                <div
                  className="h-3 rounded-full bg-red-400"
                  style={{ width: `${Math.min(100, Math.round((totalOut / totalIn) * 100))}%` }}
                />
              </div>
            </div>
            <div>
              <div className="flex justify-between text-xs text-zinc-500 mb-1">
                <span>粗利</span>
                <span className={`font-medium ${gross >= 0 ? 'text-green-700' : 'text-red-700'}`}>{yen(gross)}</span>
              </div>
              <div className="h-3 rounded-full bg-zinc-100 overflow-hidden">
                <div
                  className={`h-3 rounded-full ${gross >= 0 ? 'bg-green-400' : 'bg-red-600'}`}
                  style={{ width: `${Math.min(100, Math.abs(Math.round((gross / totalIn) * 100)))}%` }}
                />
              </div>
            </div>
          </div>
        ) : (
          <p className="text-sm text-zinc-400 py-6 text-center">対象月のデータがありません</p>
        )}
      </div>
    </div>
  )
}

// ── 荷主別粗利タブ ─────────────────────────────────────────

function ClientProfitTab({ yearMonth }: { yearMonth: string }) {
  const [rows,    setRows]    = useState<{ clientId: string; name: string; sales: number; profit: number }[]>([])
  const [loading, setLoading] = useState(true)
  const [error,   setError]   = useState<string | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    const res = await fetchSalesList(yearMonth)
    if (res.error) { setError(res.error); setLoading(false); return }

    // sales data includes per-client totals
    const mapped = (res.data ?? []).map(r => ({
      clientId: r.clientId,
      name:     r.companyName,
      sales:    r.totalAmount,
      // 粗利は売上のみから計算（支払データとの紐付けは案件マスタが必要なため概算）
      profit:   r.totalAmount,
    })).sort((a, b) => b.sales - a.sales)

    setRows(mapped)
    setLoading(false)
  }, [yearMonth])

  useEffect(() => { load() }, [load])

  if (loading) return <div className="py-20 text-center text-sm text-zinc-400">読み込み中...</div>
  if (error)   return <p className="text-sm text-red-600 bg-red-50 rounded-lg px-4 py-3">{error}</p>

  const totalSales = rows.reduce((s, r) => s + r.sales, 0)

  return (
    <div className="space-y-4">
      <p className="text-xs text-zinc-400">
        ※ 荷主別の売上ランキングを表示します。案件ごとの粗利計算は支払・支出管理（OUT）のデータと連動します。
      </p>
      {rows.length === 0 ? (
        <div className="py-16 text-center text-sm text-zinc-400">対象月のデータがありません</div>
      ) : (
        <div className="rounded-xl border border-zinc-200 bg-white overflow-hidden">
          <table className="w-full">
            <thead className="bg-zinc-50 border-b border-zinc-200">
              <tr>
                <th className="px-4 py-3 text-xs font-medium text-zinc-500 text-left">順位</th>
                <th className="px-4 py-3 text-xs font-medium text-zinc-500 text-left">荷主名</th>
                <th className="px-4 py-3 text-xs font-medium text-zinc-500 text-right">売上（IN）</th>
                <th className="px-4 py-3 text-xs font-medium text-zinc-500 text-right">構成比</th>
                <th className="px-4 py-3 text-xs font-medium text-zinc-500 text-left">比率バー</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-zinc-100">
              {rows.map((r, i) => {
                const ratio = totalSales > 0 ? Math.round((r.sales / totalSales) * 100) : 0
                return (
                  <tr key={r.clientId} className="hover:bg-zinc-50">
                    <td className="px-4 py-3 text-sm text-zinc-400 tabular-nums">{i + 1}</td>
                    <td className="px-4 py-3 text-sm font-medium text-zinc-900">{r.name}</td>
                    <td className="px-4 py-3 text-sm font-semibold text-zinc-900 text-right tabular-nums">{yen(r.sales)}</td>
                    <td className="px-4 py-3 text-sm text-zinc-500 text-right tabular-nums">{ratio}%</td>
                    <td className="px-4 py-3 w-32">
                      <div className="h-2 rounded-full bg-zinc-100 overflow-hidden">
                        <div className="h-2 rounded-full bg-blue-400" style={{ width: `${ratio}%` }} />
                      </div>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}

// ── 推移グラフタブ ────────────────────────────────────────

function TrendTab() {
  const [rows,    setRows]    = useState<MonthlyTrendRow[]>([])
  const [loading, setLoading] = useState(true)
  const [error,   setError]   = useState<string | null>(null)

  useEffect(() => {
    fetchMonthlyTrend().then(res => {
      if (res.error) setError(res.error)
      else setRows(res.data ?? [])
      setLoading(false)
    })
  }, [])

  if (loading) return <div className="py-20 text-center text-sm text-zinc-400">読み込み中...</div>
  if (error)   return <p className="text-sm text-red-600 bg-red-50 rounded-lg px-4 py-3">{error}</p>

  const maxVal = rows.reduce((m, r) => Math.max(m, r.confirmedIn + r.projectedIn, r.confirmedOut), 0)

  return (
    <div className="space-y-4">
      <p className="text-xs text-zinc-400">過去12ヶ月の売上・支払・粗利推移（confirmedIn=入金済, confirmedOut=支払確定）</p>
      {rows.length === 0 ? (
        <div className="py-16 text-center text-sm text-zinc-400">データがありません</div>
      ) : (
        <div className="rounded-xl border border-zinc-200 bg-white overflow-x-auto">
          <table className="w-full min-w-[600px]">
            <thead className="bg-zinc-50 border-b border-zinc-200">
              <tr>
                <th className="px-4 py-3 text-xs font-medium text-zinc-500 text-left">月</th>
                <th className="px-4 py-3 text-xs font-medium text-blue-600 text-right">売上（IN）</th>
                <th className="px-4 py-3 text-xs font-medium text-red-600 text-right">支払（OUT）</th>
                <th className="px-4 py-3 text-xs font-medium text-green-600 text-right">粗利（概算）</th>
                <th className="px-4 py-3 text-xs font-medium text-zinc-500 text-left">グラフ</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-zinc-100">
              {[...rows].reverse().map(r => {
                const inTotal = r.confirmedIn + r.projectedIn
                const gross   = inTotal - r.confirmedOut
                const barIn   = maxVal > 0 ? Math.round((inTotal        / maxVal) * 100) : 0
                const barOut  = maxVal > 0 ? Math.round((r.confirmedOut / maxVal) * 100) : 0
                return (
                  <tr key={r.month} className="hover:bg-zinc-50">
                    <td className="px-4 py-3 text-sm text-zinc-700 font-medium tabular-nums">{r.month}</td>
                    <td className="px-4 py-3 text-sm text-blue-700 text-right tabular-nums">{yen(inTotal)}</td>
                    <td className="px-4 py-3 text-sm text-red-600 text-right tabular-nums">{yen(r.confirmedOut)}</td>
                    <td className={`px-4 py-3 text-sm font-semibold text-right tabular-nums ${gross >= 0 ? 'text-green-700' : 'text-red-700'}`}>
                      {gross >= 0 ? yen(gross) : `-${yen(-gross)}`}
                    </td>
                    <td className="px-4 py-3 w-40">
                      <div className="space-y-1">
                        <div className="h-1.5 rounded-full bg-zinc-100 overflow-hidden">
                          <div className="h-1.5 rounded-full bg-blue-400" style={{ width: `${barIn}%` }} />
                        </div>
                        <div className="h-1.5 rounded-full bg-zinc-100 overflow-hidden">
                          <div className="h-1.5 rounded-full bg-red-400" style={{ width: `${barOut}%` }} />
                        </div>
                      </div>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}

// ── 金額カレンダー：明細モーダル ──────────────────────────

function CalendarDetailModal({
  date,
  details,
  onClose,
}: {
  date:    string
  details: DailyDetail[]
  onClose: () => void
}) {
  const yen = (n: number) => `¥${Math.abs(n).toLocaleString('ja-JP')}`
  const totalSale   = details.reduce((s, d) => s + d.saleAmount, 0)
  const totalBuy    = details.reduce((s, d) => s + d.buyAmount,  0)
  const totalProfit = totalSale - totalBuy

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
      onClick={onClose}
    >
      <div
        className="w-full max-w-lg rounded-xl bg-white shadow-xl"
        onClick={e => e.stopPropagation()}
      >
        <div className="flex items-center justify-between border-b border-zinc-100 px-6 py-4">
          <h2 className="text-base font-semibold text-zinc-900">{date} の明細</h2>
          <button
            onClick={onClose}
            className="rounded-md p-1 text-zinc-400 hover:bg-zinc-100 hover:text-zinc-700"
          >
            ✕
          </button>
        </div>

        <div className="px-6 py-4 max-h-[70vh] overflow-y-auto">
          {details.length === 0 ? (
            <p className="py-8 text-center text-sm text-zinc-400">この日の予定・実績データがありません</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-zinc-50">
                  <tr>
                    <th className="px-3 py-2 text-left text-xs font-medium text-zinc-500">荷主</th>
                    <th className="px-3 py-2 text-left text-xs font-medium text-zinc-500">案件名</th>
                    <th className="px-3 py-2 text-right text-xs font-medium text-zinc-500">売上</th>
                    <th className="px-3 py-2 text-right text-xs font-medium text-zinc-500">仕入</th>
                    <th className="px-3 py-2 text-right text-xs font-medium text-zinc-500">粗利</th>
                    <th className="px-3 py-2 text-center text-xs font-medium text-zinc-500">区分</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-zinc-100">
                  {details.map((d, i) => {
                    const profit = d.saleAmount - d.buyAmount
                    return (
                      <tr key={i} className="hover:bg-zinc-50">
                        <td className="px-3 py-2 text-xs text-zinc-500">{d.clientName}</td>
                        <td className="px-3 py-2 font-medium text-zinc-900">{d.projectName}</td>
                        <td className="px-3 py-2 text-right text-emerald-700 tabular-nums">{yen(d.saleAmount)}</td>
                        <td className="px-3 py-2 text-right text-rose-600 tabular-nums">{yen(d.buyAmount)}</td>
                        <td className={`px-3 py-2 text-right font-semibold tabular-nums ${profit >= 0 ? 'text-violet-700' : 'text-red-700'}`}>
                          {profit < 0 ? '-' : ''}{yen(profit)}
                        </td>
                        <td className="px-3 py-2 text-center">
                          <span className={`inline-block rounded-full px-2 py-0.5 text-[10px] font-medium ${d.confirmed ? 'bg-emerald-100 text-emerald-700' : 'bg-zinc-100 text-zinc-500'}`}>
                            {d.confirmed ? '確定' : '予定'}
                          </span>
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
                <tfoot className="border-t border-zinc-200 bg-zinc-50">
                  <tr>
                    <td colSpan={2} className="px-3 py-2 text-xs font-semibold text-zinc-500">合計</td>
                    <td className="px-3 py-2 text-right font-bold text-emerald-700 tabular-nums">{yen(totalSale)}</td>
                    <td className="px-3 py-2 text-right font-bold text-rose-600 tabular-nums">{yen(totalBuy)}</td>
                    <td className={`px-3 py-2 text-right font-bold tabular-nums ${totalProfit >= 0 ? 'text-violet-700' : 'text-red-700'}`}>
                      {totalProfit < 0 ? '-' : ''}{yen(totalProfit)}
                    </td>
                    <td />
                  </tr>
                </tfoot>
              </table>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

// ── 金額カレンダータブ ────────────────────────────────────

const DOW_LABELS = ['月', '火', '水', '木', '金', '土', '日']

function CalendarTab({ yearMonth }: { yearMonth: string }) {
  const [calData,       setCalData]       = useState<DailyCashflowCalendarResult | null>(null)
  const [loading,       setLoading]       = useState(true)
  const [error,         setError]         = useState<string | null>(null)
  const [selectedDate,  setSelectedDate]  = useState<string | null>(null)

  useEffect(() => {
    setLoading(true)
    setError(null)
    fetchDailyCashflowCalendar(yearMonth).then(res => {
      if (res.error) setError(res.error)
      else           setCalData(res.data)
      setLoading(false)
    })
  }, [yearMonth])

  if (loading) return <div className="py-20 text-center text-sm text-zinc-400">読み込み中...</div>
  if (error)   return <p className="text-sm text-red-600 bg-red-50 rounded-lg px-4 py-3">{error}</p>

  // カレンダーグリッド構築
  const [y, m]   = yearMonth.split('-').map(Number)
  const daysInMonth = new Date(y, m, 0).getDate()
  const firstDow    = new Date(y, m - 1, 1).getDay()   // 0=日
  const startOffset = (firstDow + 6) % 7                // 月=0 に変換
  const cells: (number | null)[] = [
    ...Array<null>(startOffset).fill(null),
    ...Array.from({ length: daysInMonth }, (_, i) => i + 1),
  ]
  while (cells.length % 7 !== 0) cells.push(null)

  const weeks: (number | null)[][] = []
  for (let i = 0; i < cells.length; i += 7) weeks.push(cells.slice(i, i + 7))

  const dayMap = new Map((calData?.daily ?? []).map(d => [d.date, d]))

  return (
    <div className="space-y-3">
      {/* カレンダー本体 */}
      <div className="overflow-x-auto -mx-1">
        <div className="min-w-[480px] rounded-xl border border-zinc-200 bg-white overflow-hidden">
          {/* 曜日ヘッダー */}
          <div className="grid grid-cols-7 border-b border-zinc-200 bg-zinc-50">
            {DOW_LABELS.map((d, i) => (
              <div
                key={d}
                className={`py-2 text-center text-xs font-semibold ${i >= 5 ? 'text-rose-400' : 'text-zinc-500'}`}
              >
                {d}
              </div>
            ))}
          </div>

          {/* 日付セル */}
          {weeks.map((week, wi) => (
            <div key={wi} className="grid grid-cols-7 border-b last:border-b-0 border-zinc-100">
              {week.map((day, di) => {
                if (!day) {
                  return <div key={di} className={`min-h-[80px] ${di >= 5 ? 'bg-rose-50/40' : 'bg-zinc-50/60'}`} />
                }

                const dateStr = `${yearMonth}-${String(day).padStart(2, '0')}`
                const entry   = dayMap.get(dateStr)
                const totalS  = (entry?.confirmedSales ?? 0) + (entry?.projectedSales ?? 0)
                const totalC  = (entry?.confirmedCost  ?? 0) + (entry?.projectedCost  ?? 0)
                const profit  = totalS - totalC
                const hasData = !!entry && totalS > 0

                return (
                  <button
                    key={di}
                    type="button"
                    onClick={() => hasData && setSelectedDate(dateStr)}
                    className={[
                      'min-h-[80px] border-l border-zinc-100 first:border-l-0 p-1.5 text-left align-top transition-colors',
                      di >= 5 ? 'bg-rose-50/30' : '',
                      hasData ? 'hover:bg-zinc-50 cursor-pointer' : 'cursor-default',
                    ].join(' ')}
                  >
                    <p className={`text-[10px] font-semibold mb-1 ${di >= 5 ? 'text-rose-400' : 'text-zinc-500'}`}>
                      {day}
                    </p>
                    {hasData && entry && (
                      <div className="space-y-0.5">
                        {/* 売上 */}
                        <p className="text-[9px] leading-tight">
                          <span className="text-zinc-400">売 </span>
                          {entry.confirmedSales > 0 && (
                            <span className="text-emerald-700 font-semibold">{fmtAmt(entry.confirmedSales)}</span>
                          )}
                          {entry.projectedSales > 0 && (
                            <span className="text-zinc-400">
                              {entry.confirmedSales > 0 ? '+' : ''}{fmtAmt(entry.projectedSales)}
                            </span>
                          )}
                        </p>
                        {/* 仕入 */}
                        <p className="text-[9px] leading-tight">
                          <span className="text-zinc-400">仕 </span>
                          {entry.confirmedCost > 0 && (
                            <span className="text-rose-600 font-semibold">{fmtAmt(entry.confirmedCost)}</span>
                          )}
                          {entry.projectedCost > 0 && (
                            <span className="text-zinc-400">
                              {entry.confirmedCost > 0 ? '+' : ''}{fmtAmt(entry.projectedCost)}
                            </span>
                          )}
                        </p>
                        {/* 粗利 */}
                        <p className={`text-[9px] leading-tight font-bold ${profit >= 0 ? 'text-violet-700' : 'text-red-600'}`}>
                          <span className="font-normal text-zinc-400">粗 </span>
                          {profit < 0 ? '-' : ''}{fmtAmt(profit)}
                        </p>
                      </div>
                    )}
                  </button>
                )
              })}
            </div>
          ))}
        </div>
      </div>

      {/* 凡例 */}
      <div className="flex flex-wrap items-center gap-4 text-[10px] text-zinc-400 px-1">
        <span className="flex items-center gap-1">
          <span className="text-emerald-700 font-bold">●</span> 実績（今日まで）
        </span>
        <span className="flex items-center gap-1">
          <span className="text-zinc-400">●</span> 予定残
        </span>
        <span className="text-zinc-300">| セルをタップで荷主別明細を表示</span>
      </div>

      {/* 明細モーダル */}
      {selectedDate && calData && (
        <CalendarDetailModal
          date={selectedDate}
          details={calData.details.filter(d => d.date === selectedDate)}
          onClose={() => setSelectedDate(null)}
        />
      )}
    </div>
  )
}

// ── メインページ ──────────────────────────────────────────

const TABS: { key: CashflowTab; label: string }[] = [
  { key: 'pnl',      label: '月次損益' },
  { key: 'client',   label: '荷主別粗利' },
  { key: 'trend',    label: '推移グラフ' },
  { key: 'calendar', label: '金額カレンダー' },
]

export default function CashflowPage() {
  const searchParams = useSearchParams()
  const router       = useRouter()
  const pathname     = usePathname()
  const tab          = (searchParams.get('tab') as CashflowTab | null) ?? 'pnl'
  const setTab       = (t: CashflowTab) => router.replace(`${pathname}?tab=${t}`)
  const { yearMonth } = useMonth()

  return (
    <div className="min-h-screen bg-zinc-50">
      <div className="mx-auto max-w-5xl px-6 py-8">

        <div className="flex items-center justify-between gap-4 mb-6">
          <div>
            <h1 className="text-xl font-semibold text-zinc-900">収支管理ビュアー</h1>
            <p className="text-xs text-zinc-400 mt-0.5">閲覧専用 — データの入力・編集は各管理画面から行ってください</p>
          </div>
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

        {tab === 'pnl'      && <PnlTab         yearMonth={yearMonth} />}
        {tab === 'client'   && <ClientProfitTab yearMonth={yearMonth} />}
        {tab === 'trend'    && <TrendTab />}
        {tab === 'calendar' && <CalendarTab     yearMonth={yearMonth} />}
      </div>
    </div>
  )
}
