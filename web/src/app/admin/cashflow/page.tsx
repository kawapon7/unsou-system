'use client'

import { useState, useEffect, useCallback } from 'react'
import { useSearchParams, useRouter, usePathname } from 'next/navigation'
import { useMonth } from '@/contexts/MonthContext'
import { fetchSalesList } from '@/app/admin/sales/actions'
import { fetchPaymentByContractor } from '@/app/admin/billing/actions'
import { fetchMonthlyTrend, type MonthlyTrendRow } from '@/app/admin/dashboard/actions'

// ── ユーティリティ ────────────────────────────────────────

type CashflowTab = 'pnl' | 'client' | 'trend'

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

// ── メインページ ──────────────────────────────────────────

const TABS: { key: CashflowTab; label: string }[] = [
  { key: 'pnl',    label: '月次損益' },
  { key: 'client', label: '荷主別粗利' },
  { key: 'trend',  label: '推移グラフ' },
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

        {tab === 'pnl'    && <PnlTab yearMonth={yearMonth} />}
        {tab === 'client' && <ClientProfitTab yearMonth={yearMonth} />}
        {tab === 'trend'  && <TrendTab />}
      </div>
    </div>
  )
}
