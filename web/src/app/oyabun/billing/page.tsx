'use client'

import { useState, useEffect, useCallback } from 'react'
import { useSearchParams, useRouter, usePathname } from 'next/navigation'
import {
  fetchBillingByClient,
  fetchPaymentByContractor,
  type BillingRow,
  type PaymentRow,
} from './actions'

// ── ユーティリティ ────────────────────────────────────────

const yen = (n: number) => `¥${n.toLocaleString('ja-JP')}`

function currentYearMonth() {
  const now = new Date()
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`
}

const TAX_LABEL: Record<string, string> = {
  exclusive: '外税',
  inclusive: '内税',
  exempt:    '非課税',
}

// ── 共通 UI ───────────────────────────────────────────────

function Th({ children, right }: { children: React.ReactNode; right?: boolean }) {
  return (
    <th className={`px-4 py-3 text-xs font-medium text-zinc-500 ${right ? 'text-right' : 'text-left'}`}>
      {children}
    </th>
  )
}

function Td({ children, right, bold, muted }: {
  children: React.ReactNode; right?: boolean; bold?: boolean; muted?: boolean
}) {
  return (
    <td className={`px-4 py-3 text-sm ${right ? 'text-right' : ''} ${bold ? 'font-semibold text-zinc-900' : ''} ${muted ? 'text-zinc-400' : 'text-zinc-700'}`}>
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

// ── 荷主請求タブ ──────────────────────────────────────────

function BillingTab({ yearMonth }: { yearMonth: string }) {
  const [rows, setRows]     = useState<BillingRow[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError]   = useState<string | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    const res = await fetchBillingByClient(yearMonth)
    if (res.error) setError(res.error)
    else setRows(res.data ?? [])
    setLoading(false)
  }, [yearMonth])

  useEffect(() => { load() }, [load])

  const totals = rows.reduce(
    (acc, r) => ({
      net:   acc.net   + r.saleAmountNet,
      tax:   acc.tax   + r.taxAmount,
      gross: acc.gross + r.totalGross,
      count: acc.count + r.projectCount,
    }),
    { net: 0, tax: 0, gross: 0, count: 0 },
  )

  if (loading) return <div className="py-20 text-center text-sm text-zinc-400">読み込み中...</div>
  if (error)   return <p className="text-sm text-red-600 bg-red-50 rounded-lg px-4 py-3">{error}</p>

  return (
    <div>
      {/* サマリー */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-6">
        <SummaryCard label="請求先数"     value={`${rows.length} 社`}   sub={`案件 ${totals.count} 件`} />
        <SummaryCard label="受託運賃合計（税抜）" value={yen(totals.net)}   />
        <SummaryCard label="消費税合計"   value={yen(totals.tax)}   />
        <SummaryCard label="税込請求合計" value={yen(totals.gross)} />
      </div>

      {rows.length === 0 ? (
        <div className="py-16 text-center text-sm text-zinc-400">対象データがありません</div>
      ) : (
        <div className="overflow-x-auto rounded-lg border border-zinc-200">
          <table className="w-full">
            <thead className="bg-zinc-50 border-b border-zinc-200">
              <tr>
                <Th>荷主</Th>
                <Th>締め日</Th>
                <Th>消費税区分</Th>
                <Th>インボイス</Th>
                <Th right>案件数</Th>
                <Th right>受託運賃（税抜）</Th>
                <Th right>消費税額</Th>
                <Th right>税込請求金額</Th>
                <Th right>入金サイト</Th>
              </tr>
            </thead>
            <tbody className="divide-y divide-zinc-100">
              {rows.map(r => (
                <tr key={r.clientId} className="hover:bg-zinc-50">
                  <Td bold>{r.companyName}</Td>
                  <Td>{r.closingDay === '月末' || r.closingDay === '末日' ? '月末締め' : `${r.closingDay}日締め`}</Td>
                  <Td>
                    <span className="rounded-full bg-zinc-100 px-2 py-0.5 text-xs text-zinc-600">
                      {TAX_LABEL[r.taxType] ?? r.taxType}
                    </span>
                  </Td>
                  <Td>
                    {r.invoiceRegistered
                      ? <span className="rounded-full bg-blue-50 text-blue-700 px-2 py-0.5 text-xs">登録済</span>
                      : <span className="rounded-full bg-zinc-100 text-zinc-500 px-2 py-0.5 text-xs">未登録</span>}
                  </Td>
                  <Td right>{r.projectCount}</Td>
                  <Td right>{yen(r.saleAmountNet)}</Td>
                  <Td right muted={r.taxType === 'exempt'}>{yen(r.taxAmount)}</Td>
                  <Td right bold>{yen(r.totalGross)}</Td>
                  <Td right muted>{r.paymentSite}日後</Td>
                </tr>
              ))}
            </tbody>
            <tfoot className="border-t-2 border-zinc-200 bg-zinc-50">
              <tr>
                <td colSpan={4} className="px-4 py-3 text-xs font-semibold text-zinc-500">合計</td>
                <Td right bold>{totals.count}</Td>
                <Td right bold>{yen(totals.net)}</Td>
                <Td right bold>{yen(totals.tax)}</Td>
                <Td right bold>{yen(totals.gross)}</Td>
                <td />
              </tr>
            </tfoot>
          </table>
        </div>
      )}
    </div>
  )
}

// ── 委託先支払タブ ────────────────────────────────────────

function PaymentTab({ yearMonth }: { yearMonth: string }) {
  const [rows, setRows]       = useState<PaymentRow[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError]     = useState<string | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    const res = await fetchPaymentByContractor(yearMonth)
    if (res.error) setError(res.error)
    else setRows(res.data ?? [])
    setLoading(false)
  }, [yearMonth])

  useEffect(() => { load() }, [load])

  const totals = rows.reduce(
    (acc, r) => ({
      buy:        acc.buy        + r.buyAmountNet,
      tax:        acc.tax        + r.taxAmount,
      withholding: acc.withholding + r.withholdingTax,
      net:        acc.net        + r.netPayment,
      count:      acc.count      + r.projectCount,
    }),
    { buy: 0, tax: 0, withholding: 0, net: 0, count: 0 },
  )

  if (loading) return <div className="py-20 text-center text-sm text-zinc-400">読み込み中...</div>
  if (error)   return <p className="text-sm text-red-600 bg-red-50 rounded-lg px-4 py-3">{error}</p>

  return (
    <div>
      {/* サマリー */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-6">
        <SummaryCard label="支払先数"         value={`${rows.length} 名`}    sub={`案件 ${totals.count} 件`} />
        <SummaryCard label="支払運賃合計（税抜）" value={yen(totals.buy)}   />
        <SummaryCard label="源泉徴収合計"     value={yen(totals.withholding)} />
        <SummaryCard label="差引支払合計"     value={yen(totals.net)}         />
      </div>

      {rows.length === 0 ? (
        <div className="py-16 text-center text-sm text-zinc-400">対象データがありません</div>
      ) : (
        <div className="overflow-x-auto rounded-lg border border-zinc-200">
          <table className="w-full">
            <thead className="bg-zinc-50 border-b border-zinc-200">
              <tr>
                <Th>委託先</Th>
                <Th>インボイス区分</Th>
                <Th>登録番号</Th>
                <Th>消費税</Th>
                <Th right>案件数</Th>
                <Th right>支払運賃（税抜）</Th>
                <Th right>消費税額</Th>
                <Th right>源泉徴収額</Th>
                <Th right>差引支払額</Th>
                <Th right>支払サイト</Th>
              </tr>
            </thead>
            <tbody className="divide-y divide-zinc-100">
              {rows.map(r => (
                <tr key={r.contractorId} className="hover:bg-zinc-50">
                  <Td bold>{r.name}</Td>
                  <Td>
                    {r.invoiceType === '適格'
                      ? <span className="rounded-full bg-blue-50 text-blue-700 px-2 py-0.5 text-xs">適格事業者</span>
                      : <span className="rounded-full bg-zinc-100 text-zinc-500 px-2 py-0.5 text-xs">免税事業者</span>}
                  </Td>
                  <Td>
                    {r.invoiceNumber
                      ? <span className="font-mono text-xs text-zinc-600">{r.invoiceNumber}</span>
                      : <span className="text-zinc-400 text-xs">—</span>}
                  </Td>
                  <Td>
                    <span className="rounded-full bg-zinc-100 px-2 py-0.5 text-xs text-zinc-600">
                      {TAX_LABEL[r.taxType] ?? r.taxType}
                    </span>
                  </Td>
                  <Td right>{r.projectCount}</Td>
                  <Td right>{yen(r.buyAmountNet)}</Td>
                  <Td right muted={r.taxType === 'exempt'}>{yen(r.taxAmount)}</Td>
                  <Td right muted={!r.withholdingTaxFlag}>
                    {r.withholdingTaxFlag
                      ? <span className="text-red-600">{yen(r.withholdingTax)}</span>
                      : '—'}
                  </Td>
                  <Td right bold>{yen(r.netPayment)}</Td>
                  <Td right muted>{r.paymentSite}日後</Td>
                </tr>
              ))}
            </tbody>
            <tfoot className="border-t-2 border-zinc-200 bg-zinc-50">
              <tr>
                <td colSpan={4} className="px-4 py-3 text-xs font-semibold text-zinc-500">合計</td>
                <Td right bold>{totals.count}</Td>
                <Td right bold>{yen(totals.buy)}</Td>
                <Td right bold>{yen(totals.tax)}</Td>
                <Td right bold>
                  <span className="text-red-600">{yen(totals.withholding)}</span>
                </Td>
                <Td right bold>{yen(totals.net)}</Td>
                <td />
              </tr>
            </tfoot>
          </table>
        </div>
      )}

      {/* 源泉徴収注記 */}
      <p className="mt-3 text-xs text-zinc-400">
        ※ 源泉徴収税額は支払運賃の 10.21%（2026年税制準拠）。1円未満切り捨て。
      </p>
    </div>
  )
}

// ── メインページ ──────────────────────────────────────────

type Tab = 'billing' | 'payment'

export default function BillingPage() {
  const searchParams = useSearchParams()
  const router       = useRouter()
  const pathname     = usePathname()
  const tab          = (searchParams.get('tab') as Tab | null) ?? 'billing'
  const setTab       = (t: Tab) => router.replace(`${pathname}?tab=${t}`)
  const [yearMonth, setYearMonth] = useState(currentYearMonth)

  return (
    <div className="min-h-screen bg-zinc-50">
      <div className="mx-auto max-w-6xl px-6 py-8">

        {/* ヘッダ */}
        <div className="flex flex-wrap items-center justify-between gap-4 mb-6">
          <h1 className="text-xl font-semibold text-zinc-900">請求・支払管理</h1>

          {/* 年月セレクタ */}
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
          {(
            [
              { key: 'billing' as Tab, label: '荷主向け請求管理' },
              { key: 'payment' as Tab, label: '委託先向け支払管理' },
            ] as const
          ).map(({ key, label }) => (
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

        {tab === 'billing'
          ? <BillingTab yearMonth={yearMonth} />
          : <PaymentTab yearMonth={yearMonth} />}
      </div>
    </div>
  )
}
