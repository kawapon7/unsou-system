'use client'

import { useState, useEffect, useCallback } from 'react'
import { useSearchParams, useRouter, usePathname } from 'next/navigation'
import {
  fetchBillingByClient,
  fetchPaymentByContractor,
  fetchExpensesForApproval,
  fetchPaymentNoticeStatuses,
  generatePaymentNotice,
  generateAllPaymentNotices,
  approveExpense,
  rejectExpense,
  type BillingRow,
  type PaymentRow,
  type PaymentNoticeStatus,
  type ExpenseApprovalRow,
} from './actions'

// ── ユーティリティ ────────────────────────────────────────

const yen = (n: number) => `¥${n.toLocaleString('ja-JP')}`

function currentYearMonth() {
  const now = new Date()
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`
}

const EXPENSE_TYPE_LABEL: Record<string, string> = {
  toll:    '高速道路料金',
  parking: '駐車場代',
  fuel:    '燃料費',
  other:   'その他',
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

const NOTICE_STYLE: Record<string, { label: string; cls: string }> = {
  pending:  { label: '承認待ち', cls: 'bg-amber-100 text-amber-700' },
  approved: { label: '承認済',   cls: 'bg-emerald-100 text-emerald-700' },
  rejected: { label: '却下',     cls: 'bg-rose-100 text-rose-600' },
}

function PaymentTab({ yearMonth }: { yearMonth: string }) {
  const [rows,    setRows]    = useState<PaymentRow[]>([])
  const [statuses, setStatuses] = useState<Map<string, PaymentNoticeStatus>>(new Map())
  const [loading,  setLoading]  = useState(true)
  const [error,    setError]    = useState<string | null>(null)
  const [generating, setGenerating] = useState<string | null>(null) // contractorId or 'all'
  const [message,  setMessage]  = useState<{ text: string; ok: boolean } | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    const [payRes, stRes] = await Promise.all([
      fetchPaymentByContractor(yearMonth),
      fetchPaymentNoticeStatuses(yearMonth),
    ])
    if (payRes.error) { setError(payRes.error); setLoading(false); return }
    setRows(payRes.data ?? [])
    const map = new Map<string, PaymentNoticeStatus>()
    for (const s of stRes.data ?? []) map.set(s.contractorId, s)
    setStatuses(map)
    setLoading(false)
  }, [yearMonth])

  useEffect(() => { load() }, [load])

  async function handleGenerate(contractorId: string) {
    setGenerating(contractorId)
    setMessage(null)
    const res = await generatePaymentNotice(contractorId, yearMonth)
    if (res.error) {
      setMessage({ text: res.error, ok: false })
    } else if (res.data) {
      setMessage({ text: '支払通知書を生成しました', ok: true })
      const { id, totalAmount } = res.data
      setStatuses(prev => {
        const next = new Map(prev)
        next.set(contractorId, {
          contractorId,
          noticeId:       id,
          approvalStatus: 'pending',
          locked:         false,
          totalAmount,
        })
        return next
      })
    }
    setGenerating(null)
  }

  async function handleGenerateAll() {
    setGenerating('all')
    setMessage(null)
    const res = await generateAllPaymentNotices(yearMonth)
    if (res.error) {
      setMessage({ text: res.error, ok: false })
    } else if (res.data) {
      const { generated, errors } = res.data
      if (errors.length > 0) {
        setMessage({ text: `${generated} 件生成（${errors.length} 件エラー: ${errors[0]}）`, ok: false })
      } else {
        setMessage({ text: `${generated} 件の支払通知書を生成しました`, ok: true })
      }
      await load()
    }
    setGenerating(null)
  }

  const totals = rows.reduce(
    (acc, r) => ({
      buy:         acc.buy         + r.buyAmountNet,
      tax:         acc.tax         + r.taxAmount,
      withholding: acc.withholding + r.withholdingTax,
      net:         acc.net         + r.netPayment,
      count:       acc.count       + r.projectCount,
    }),
    { buy: 0, tax: 0, withholding: 0, net: 0, count: 0 },
  )

  if (loading) return <div className="py-20 text-center text-sm text-zinc-400">読み込み中...</div>
  if (error)   return <p className="text-sm text-red-600 bg-red-50 rounded-lg px-4 py-3">{error}</p>

  const generatedCount = statuses.size
  const allBulkGenerating = generating === 'all'

  return (
    <div>
      {/* サマリー + 一括生成ボタン */}
      <div className="flex flex-wrap items-start justify-between gap-4 mb-6">
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 flex-1 min-w-0">
          <SummaryCard label="支払先数"            value={`${rows.length} 名`}      sub={`案件 ${totals.count} 件`} />
          <SummaryCard label="支払運賃合計（税抜）" value={yen(totals.buy)}          />
          <SummaryCard label="源泉徴収合計"        value={yen(totals.withholding)}  />
          <SummaryCard label="差引支払合計"        value={yen(totals.net)}          />
        </div>

        {rows.length > 0 && (
          <div className="flex flex-col items-end gap-2 shrink-0">
            <button
              onClick={handleGenerateAll}
              disabled={allBulkGenerating || generating !== null}
              className="rounded-lg bg-zinc-900 hover:bg-zinc-700 px-4 py-2 text-sm font-medium text-white transition disabled:opacity-50 whitespace-nowrap"
            >
              {allBulkGenerating ? '生成中...' : '全員分を一括生成'}
            </button>
            {generatedCount > 0 && (
              <p className="text-xs text-zinc-500">{generatedCount} / {rows.length} 件生成済み</p>
            )}
          </div>
        )}
      </div>

      {/* メッセージ */}
      {message && (
        <div className={`mb-4 rounded-lg px-4 py-2.5 text-sm ${message.ok ? 'bg-emerald-50 text-emerald-700' : 'bg-red-50 text-red-600'}`}>
          {message.text}
        </div>
      )}

      {rows.length === 0 ? (
        <div className="py-16 text-center text-sm text-zinc-400">対象データがありません</div>
      ) : (
        <div className="overflow-x-auto rounded-lg border border-zinc-200">
          <table className="w-full">
            <thead className="bg-zinc-50 border-b border-zinc-200">
              <tr>
                <Th>委託先</Th>
                <Th>インボイス区分</Th>
                <Th>消費税</Th>
                <Th right>案件数</Th>
                <Th right>支払運賃（税抜）</Th>
                <Th right>消費税額</Th>
                <Th right>源泉徴収額</Th>
                <Th right>差引支払額</Th>
                <Th>通知書</Th>
              </tr>
            </thead>
            <tbody className="divide-y divide-zinc-100">
              {rows.map(r => {
                const st       = statuses.get(r.contractorId)
                const isLocked = st?.locked ?? false
                const isBusy   = generating === r.contractorId || allBulkGenerating
                const nStyle   = st ? (NOTICE_STYLE[st.approvalStatus] ?? NOTICE_STYLE.pending) : null

                return (
                  <tr key={r.contractorId} className="hover:bg-zinc-50">
                    <Td bold>{r.name}</Td>
                    <Td>
                      {r.invoiceType === '適格'
                        ? <span className="rounded-full bg-blue-50 text-blue-700 px-2 py-0.5 text-xs">適格事業者</span>
                        : <span className="rounded-full bg-zinc-100 text-zinc-500 px-2 py-0.5 text-xs">免税事業者</span>}
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
                    <td className="px-4 py-3">
                      <div className="flex flex-col items-start gap-1.5 min-w-[100px]">
                        {st && nStyle && (
                          <span className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium ${nStyle.cls}`}>
                            {isLocked && <span>🔒</span>}
                            {nStyle.label}
                          </span>
                        )}
                        {isLocked ? (
                          <span className="text-xs text-zinc-400">ロック中</span>
                        ) : (
                          <button
                            onClick={() => handleGenerate(r.contractorId)}
                            disabled={isBusy}
                            className="rounded-md border border-zinc-300 bg-white px-2.5 py-1 text-xs font-medium text-zinc-700 hover:bg-zinc-50 disabled:opacity-40 transition whitespace-nowrap"
                          >
                            {isBusy ? '生成中...' : st ? '再生成' : '生成'}
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                )
              })}
            </tbody>
            <tfoot className="border-t-2 border-zinc-200 bg-zinc-50">
              <tr>
                <td colSpan={3} className="px-4 py-3 text-xs font-semibold text-zinc-500">合計</td>
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

      <p className="mt-3 text-xs text-zinc-400">
        ※ 源泉徴収税額は支払運賃の 10.21%（2026年税制準拠）。経過措置控除は免税事業者への支払運賃消費税に適用。
      </p>
    </div>
  )
}

// ── メインページ ──────────────────────────────────────────

// ── 立替金承認タブ ────────────────────────────────────────

const APPROVAL_STYLE: Record<string, { label: string; cls: string }> = {
  pending:  { label: '未承認', cls: 'bg-amber-100 text-amber-700' },
  approved: { label: '承認済', cls: 'bg-emerald-100 text-emerald-700' },
  rejected: { label: '却下',   cls: 'bg-rose-100 text-rose-600' },
}

function ExpenseApprovalTab({ yearMonth }: { yearMonth: string }) {
  const [rows,    setRows]    = useState<ExpenseApprovalRow[]>([])
  const [loading, setLoading] = useState(true)
  const [error,   setError]   = useState<string | null>(null)
  const [saving,  setSaving]  = useState<string | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    const res = await fetchExpensesForApproval(yearMonth)
    if (res.error) setError(res.error)
    else setRows(res.data ?? [])
    setLoading(false)
  }, [yearMonth])

  useEffect(() => { load() }, [load])

  async function handleApprove(id: string) {
    setSaving(id)
    const res = await approveExpense(id)
    if (res.error) setError(res.error)
    else setRows(prev => prev.map(r => r.id === id ? { ...r, approvalStatus: 'approved' } : r))
    setSaving(null)
  }

  async function handleReject(id: string) {
    if (!window.confirm('この立替金を却下しますか？')) return
    setSaving(id)
    const res = await rejectExpense(id)
    if (res.error) setError(res.error)
    else setRows(prev => prev.map(r => r.id === id ? { ...r, approvalStatus: 'rejected' } : r))
    setSaving(null)
  }

  const pending  = rows.filter(r => r.approvalStatus === 'pending')
  const approved = rows.filter(r => r.approvalStatus === 'approved')
  const rejected = rows.filter(r => r.approvalStatus === 'rejected')
  const yen = (n: number) => `¥${n.toLocaleString('ja-JP')}`

  if (loading) return <div className="py-20 text-center text-sm text-zinc-400">読み込み中...</div>

  return (
    <div className="space-y-6">
      {error && <p className="text-sm text-red-600 bg-red-50 rounded-lg px-3 py-2">{error}</p>}

      {/* サマリー */}
      <div className="grid grid-cols-3 gap-3">
        {[
          { label: '未承認', count: pending.length,  total: pending.reduce((s,r)=>s+r.amountActual,0),  cls: 'border-l-4 border-l-amber-400' },
          { label: '承認済', count: approved.length, total: approved.reduce((s,r)=>s+r.amountActual,0), cls: 'border-l-4 border-l-emerald-400' },
          { label: '却下',   count: rejected.length, total: rejected.reduce((s,r)=>s+r.amountActual,0), cls: 'border-l-4 border-l-rose-400' },
        ].map(s => (
          <div key={s.label} className={`rounded-xl bg-white border border-zinc-200 px-4 py-3 ${s.cls}`}>
            <p className="text-xs text-zinc-500">{s.label}</p>
            <p className="text-lg font-bold text-zinc-900 tabular-nums mt-0.5">{yen(s.total)}</p>
            <p className="text-xs text-zinc-400">{s.count} 件</p>
          </div>
        ))}
      </div>

      {rows.length === 0 ? (
        <div className="py-16 text-center text-sm text-zinc-400">
          対象月の立替金データがありません
        </div>
      ) : (
        <div className="rounded-xl bg-white border border-zinc-200 overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-zinc-50">
              <tr>
                <th className="px-4 py-3 text-left text-xs font-medium text-zinc-500">日付</th>
                <th className="px-4 py-3 text-left text-xs font-medium text-zinc-500">委託先</th>
                <th className="px-4 py-3 text-left text-xs font-medium text-zinc-500">種別</th>
                <th className="px-4 py-3 text-right text-xs font-medium text-zinc-500">金額</th>
                <th className="px-4 py-3 text-left text-xs font-medium text-zinc-500">備考</th>
                <th className="px-4 py-3 text-center text-xs font-medium text-zinc-500">状態</th>
                <th className="px-4 py-3" />
              </tr>
            </thead>
            <tbody className="divide-y divide-zinc-100">
              {rows.map(r => {
                const st  = APPROVAL_STYLE[r.approvalStatus] ?? APPROVAL_STYLE.pending
                const isSaving = saving === r.id
                return (
                  <tr key={r.id} className="hover:bg-zinc-50">
                    <td className="px-4 py-3 tabular-nums text-zinc-600">
                      {r.expenseDate.slice(5).replace('-', '/')}
                    </td>
                    <td className="px-4 py-3 font-medium text-zinc-900">{r.contractorName}</td>
                    <td className="px-4 py-3 text-zinc-600">
                      {EXPENSE_TYPE_LABEL[r.expenseType] ?? r.expenseType}
                    </td>
                    <td className="px-4 py-3 text-right font-semibold text-zinc-900 tabular-nums">
                      {yen(r.amountActual)}
                    </td>
                    <td className="px-4 py-3 text-zinc-500 max-w-[160px] truncate">
                      {r.remarks ?? '—'}
                    </td>
                    <td className="px-4 py-3 text-center">
                      <span className={`inline-flex rounded-full px-2 py-0.5 text-xs font-medium ${st.cls}`}>
                        {st.label}
                      </span>
                    </td>
                    <td className="px-4 py-3">
                      {r.approvalStatus === 'pending' && (
                        <div className="flex gap-1 justify-end">
                          <button
                            onClick={() => handleApprove(r.id)}
                            disabled={isSaving}
                            className="rounded-md bg-emerald-600 px-3 py-1 text-xs font-medium text-white hover:bg-emerald-700 disabled:opacity-50 transition"
                          >
                            {isSaving ? '…' : '承認'}
                          </button>
                          <button
                            onClick={() => handleReject(r.id)}
                            disabled={isSaving}
                            className="rounded-md border border-zinc-300 px-3 py-1 text-xs font-medium text-zinc-600 hover:bg-zinc-50 disabled:opacity-50 transition"
                          >
                            却下
                          </button>
                        </div>
                      )}
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

type Tab = 'billing' | 'payment' | 'expense'

const TABS: { key: Tab; label: string }[] = [
  { key: 'billing', label: '① 荷主向け請求管理' },
  { key: 'payment', label: '② 委託先向け支払管理' },
  { key: 'expense', label: '③ 立替金承認' },
]

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

        {tab === 'billing' && <BillingTab  yearMonth={yearMonth} />}
        {tab === 'payment' && <PaymentTab  yearMonth={yearMonth} />}
        {tab === 'expense' && <ExpenseApprovalTab yearMonth={yearMonth} />}
      </div>
    </div>
  )
}
