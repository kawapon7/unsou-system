'use client'

import { useState, useEffect, useCallback } from 'react'
import { fetchMyContractor, fetchMyExpenses, type ExpenseRow } from '../dashboard/actions'
import {
  fetchMyPaymentNotices,
  approvePaymentNotice,
  fetchMyPaymentHistory,
  fetchMyAvailableYears,
  type MyPaymentNotice,
} from '@/app/_actions/driver-actions'
import type { PaymentHistoryRow, AnnualSummary } from '@/utils/driver-summary'
import { PaymentNoticePdfModal } from '@/components/pdf/PaymentNoticePdfModal'
import type { Database } from '@/types/supabase'

type ContractorRow = Database['public']['Tables']['contractors']['Row']

function Toast({ message, type, onDismiss }: { message: string; type: 'success' | 'error'; onDismiss: () => void }) {
  useEffect(() => {
    const t = setTimeout(onDismiss, 5000)
    return () => clearTimeout(t)
  }, [onDismiss])
  return (
    <div className={`fixed bottom-24 right-4 left-4 sm:left-auto sm:w-80 z-50 flex items-start gap-3 rounded-xl px-4 py-3 shadow-lg text-sm font-medium
      ${type === 'success' ? 'bg-green-600 text-white' : 'bg-red-600 text-white'}`}>
      <span className="flex-1">{message}</span>
      <button onClick={onDismiss} className="shrink-0 opacity-75 hover:opacity-100 text-lg leading-none">×</button>
    </div>
  )
}

function yen(n: number) { return `¥${n.toLocaleString('ja-JP')}` }
function monthLabel(iso: string) {
  const d = new Date(iso)
  return `${d.getFullYear()}年${d.getMonth() + 1}月分`
}

function PaymentNoticeCard({
  notice, contractorId, onApprove,
}: {
  notice: MyPaymentNotice; contractorId: string; onApprove: (id: string) => Promise<void>
}) {
  const [approving, setApproving] = useState(false)
  const [pdfOpen,   setPdfOpen]   = useState(false)
  const isApproved = notice.approvalStatus === 'approved'
  const yearMonth  = notice.noticeMonth.slice(0, 7)

  async function handleApprove() {
    setApproving(true)
    await onApprove(notice.id)
    setApproving(false)
  }

  return (
    <div className={`rounded-2xl border bg-white p-5 shadow-sm ${isApproved ? 'border-green-300' : 'border-zinc-200'}`}>
      <div className="flex items-center justify-between mb-4">
        <h3 className="font-bold text-zinc-900 text-base">{monthLabel(notice.noticeMonth)}</h3>
        {isApproved && (
          <span className="inline-flex items-center gap-1 rounded-full bg-green-100 text-green-700 text-xs font-semibold px-3 py-1">
            ✅ 承認済み
          </span>
        )}
      </div>

      <div className="space-y-2 text-sm mb-4">
        <div className="flex justify-between text-zinc-600">
          <span>労務報酬（税抜）</span>
          <span className="tabular-nums font-medium text-zinc-900">{yen(notice.laborNet)}</span>
        </div>
        {notice.laborTax > 0 && (
          <div className="flex justify-between text-zinc-400">
            <span className="pl-4">うち消費税</span>
            <span className="tabular-nums">{yen(notice.laborTax)}</span>
          </div>
        )}
        {(notice.expenseNet > 0 || notice.expenseTax > 0) && (
          <>
            <div className="flex justify-between text-zinc-600">
              <span>立替経費（税抜）</span>
              <span className="tabular-nums font-medium text-zinc-900">{yen(notice.expenseNet)}</span>
            </div>
            {notice.expenseTax > 0 && (
              <div className="flex justify-between text-zinc-400">
                <span className="pl-4">うち消費税</span>
                <span className="tabular-nums">{yen(notice.expenseTax)}</span>
              </div>
            )}
          </>
        )}
        {notice.deduction > 0 && (
          <div className="flex justify-between text-amber-600">
            <span>経過措置控除（{(notice.deductionRate * 100).toFixed(0)}%）</span>
            <span className="tabular-nums">−{yen(notice.deduction)}</span>
          </div>
        )}
        <div className="border-t border-zinc-100 pt-2 flex justify-between font-bold text-zinc-900">
          <span>差引支払額</span>
          <span className="tabular-nums text-lg">{yen(notice.totalAmount)}</span>
        </div>
      </div>

      <button
        onClick={() => setPdfOpen(true)}
        className="w-full py-2.5 rounded-xl border border-blue-200 bg-blue-50 text-sm font-medium text-blue-700 hover:bg-blue-100 transition mb-3"
      >
        📄 支払明細PDF
      </button>

      <button
        onClick={handleApprove}
        disabled={isApproved || approving || notice.locked}
        className={`w-full py-4 rounded-xl text-base font-bold transition
          ${isApproved
            ? 'bg-green-100 text-green-600 cursor-not-allowed'
            : notice.locked
              ? 'bg-zinc-100 text-zinc-400 cursor-not-allowed'
              : approving
                ? 'bg-blue-400 text-white cursor-not-allowed'
                : 'bg-blue-600 hover:bg-blue-500 active:bg-blue-700 text-white'}`}
      >
        {isApproved ? '✅ 承認済み'
          : notice.locked ? '🔒 ロック中（親分に確認）'
          : approving ? '処理中...'
          : 'この金額で合ってます'}
      </button>

      {pdfOpen && (
        <PaymentNoticePdfModal
          contractorId={contractorId}
          yearMonth={yearMonth}
          contractorName="（自分）"
          showSaveHint
          onClose={() => setPdfOpen(false)}
        />
      )}
    </div>
  )
}

const EXPENSE_TYPES = [
  { value: 'toll',    label: '高速道路料金' },
  { value: 'parking', label: '駐車場代' },
  { value: 'fuel',    label: '燃料費' },
  { value: 'other',   label: 'その他' },
] as const

const EXPENSE_STATUS_STYLE: Record<string, { label: string; cls: string }> = {
  pending:  { label: '未承認', cls: 'bg-amber-100 text-amber-700' },
  approved: { label: '承認済', cls: 'bg-emerald-100 text-emerald-700' },
  rejected: { label: '却下',   cls: 'bg-rose-100 text-rose-600' },
}

function currentYearMonth() {
  const now = new Date()
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`
}

// ── 過去の支払履歴（年別・確定申告用） ─────────────────────
//
// ⚠️ 年の区切りは暦年。締め日ベースにしない（確定申告が暦年のため）。
// ⚠️ 年の選択肢は通知書が存在する年だけ。データの無い年を選べると
//    「0円」の画面が出て、ドライバーには不具合と区別がつかない。

function PaymentHistorySection({ contractorId }: { contractorId: string }) {
  const [years,   setYears]   = useState<number[]>([])
  const [year,    setYear]    = useState<number | null>(null)
  const [rows,    setRows]    = useState<PaymentHistoryRow[]>([])
  const [summary, setSummary] = useState<AnnualSummary | null>(null)
  const [error,   setError]   = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [pdfMonth, setPdfMonth] = useState<string | null>(null)

  useEffect(() => {
    let alive = true
    fetchMyAvailableYears().then(res => {
      if (!alive) return
      if (res.error) { setError(res.error); setLoading(false); return }
      const list = res.data ?? []
      setYears(list)
      setYear(list[0] ?? null)
      if (list.length === 0) setLoading(false)
    })
    return () => { alive = false }
  }, [])

  useEffect(() => {
    if (year === null) return
    let alive = true
    fetchMyPaymentHistory(year).then(res => {
      if (!alive) return
      if (res.error || !res.data) { setError(res.error ?? '取得できませんでした'); setRows([]); setSummary(null) }
      else { setRows(res.data.rows); setSummary(res.data.summary); setError(null) }
      setLoading(false)
    })
    return () => { alive = false }
  }, [year])

  return (
    <section>
      <div className="flex items-center justify-between mb-3">
        <h2 className="text-sm font-bold text-zinc-900">過去の支払履歴</h2>
        {years.length > 0 && (
          <select
            value={year ?? ''}
            onChange={e => { setLoading(true); setYear(Number(e.target.value)) }}
            className="rounded-md border border-zinc-300 bg-white px-3 py-1.5 text-sm text-zinc-900 outline-none focus:border-zinc-500"
          >
            {years.map(y => <option key={y} value={y}>{y}年</option>)}
          </select>
        )}
      </div>

      {error ? (
        <div className="rounded-lg bg-red-50 border border-red-200 px-4 py-3 text-sm text-red-700">{error}</div>
      ) : loading ? (
        <div className="py-8 text-center text-sm text-zinc-400">読み込み中...</div>
      ) : years.length === 0 ? (
        <div className="py-10 text-center text-sm text-zinc-400 rounded-xl border border-dashed border-zinc-200 bg-white">
          まだ支払通知書がありません
        </div>
      ) : (
        <>
          {/* 年間サマリー（確定申告用） */}
          {summary && (
            <div className="rounded-2xl border border-zinc-200 bg-white p-5 mb-3">
              <p className="text-xs text-zinc-500">{summary.year}年の合計（{summary.monthCount}ヶ月分）</p>
              <p className="mt-1 text-3xl font-bold tracking-tight text-zinc-900 tabular-nums">{yen(summary.paidTotal)}</p>
              <dl className="mt-4 space-y-2 border-t border-zinc-100 pt-4 text-sm">
                <Line label="労務報酬（税抜）" value={yen(summary.laborNetTotal)} />
                <Line label="立替経費（税抜）" value={yen(summary.expenseNetTotal)} />
                <Line label="消費税" value={yen(summary.taxTotal)} />
                {summary.deductionTotal > 0 && <Line label="経過措置控除" value={`−${yen(summary.deductionTotal)}`} amber />}
                {summary.insuranceTotal > 0 && <Line label="運送保険" value={`−${yen(summary.insuranceTotal)}`} amber />}
              </dl>
              <p className="mt-3 text-[11px] leading-relaxed text-zinc-400">
                ※ 未承認の月も含みます。確定申告にお使いの際は、各月のPDFをご自身の端末に保存してください。
              </p>
            </div>
          )}

          {/* 月別 */}
          <ul className="rounded-2xl border border-zinc-200 bg-white divide-y divide-zinc-100 overflow-hidden">
            {rows.map(r => (
              <li key={r.noticeMonth} className="flex items-center justify-between gap-3 px-4 py-4">
                <div className="min-w-0">
                  <p className="text-base font-medium text-zinc-900">{monthLabel(r.noticeMonth)}</p>
                  <p className="text-xs text-zinc-500">
                    {r.approvalStatus === 'approved' ? '✅ 承認済み' : '未承認'}
                  </p>
                </div>
                <div className="flex items-center gap-3 shrink-0">
                  <span className="text-lg font-bold text-zinc-900 tabular-nums">{yen(r.totalAmount)}</span>
                  <button
                    onClick={() => setPdfMonth(r.noticeMonth.slice(0, 7))}
                    className="rounded-lg border border-blue-200 bg-blue-50 px-3 py-2.5 text-xs font-medium text-blue-700 active:bg-blue-100"
                  >
                    PDF
                  </button>
                </div>
              </li>
            ))}
          </ul>
        </>
      )}

      {pdfMonth && (
        <PaymentNoticePdfModal
          contractorId={contractorId}
          yearMonth={pdfMonth}
          contractorName="（自分）"
          showSaveHint
          onClose={() => setPdfMonth(null)}
        />
      )}
    </section>
  )
}

function Line({ label, value, amber = false }: { label: string; value: string; amber?: boolean }) {
  return (
    <div className={`flex justify-between ${amber ? 'text-amber-600' : 'text-zinc-600'}`}>
      <dt>{label}</dt>
      <dd className="tabular-nums font-medium text-zinc-900">{value}</dd>
    </div>
  )
}

export default function DriverBillingPage() {
  const [contractor, setContractor] = useState<Pick<ContractorRow, 'id'> | null>(null)
  const [loading,    setLoading]    = useState(true)
  const [error,      setError]      = useState<string | null>(null)
  const [toast, setToast] = useState<{ message: string; type: 'success' | 'error' } | null>(null)

  const [notices,    setNotices]    = useState<MyPaymentNotice[]>([])
  const [noticeLoad, setNoticeLoad] = useState(true)
  const [noticeErr,  setNoticeErr]  = useState<string | null>(null)

  const [yearMonth,   setYearMonth]   = useState(currentYearMonth)
  const [expenses,    setExpenses]    = useState<ExpenseRow[]>([])
  const [expenseLoad, setExpenseLoad] = useState(true)
  const [expenseErr,  setExpenseErr]  = useState<string | null>(null)

  const loadContractor = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const cRes = await fetchMyContractor()
      if (cRes.error || !cRes.data) {
        setError(cRes.error ?? '委託先が見つかりません')
        return
      }
      setContractor(cRes.data)
    } catch (e) {
      setError(e instanceof Error ? e.message : '委託先の取得に失敗しました')
    } finally {
      setLoading(false)
    }
  }, [])

  const loadNotices = useCallback(async () => {
    setNoticeLoad(true)
    setNoticeErr(null)
    try {
      const res = await fetchMyPaymentNotices()
      if (res.error) setNoticeErr(res.error)
      else setNotices(res.data ?? [])
    } catch (e) {
      setNoticeErr(e instanceof Error ? e.message : '支払通知書の取得に失敗しました')
    } finally {
      setNoticeLoad(false)
    }
  }, [])

  const loadExpenses = useCallback(async () => {
    if (!contractor) {
      setExpenseLoad(false)
      return
    }
    setExpenseLoad(true)
    setExpenseErr(null)
    try {
      const res = await fetchMyExpenses(contractor.id, yearMonth)
      if (res.error) setExpenseErr(res.error)
      else setExpenses(res.data ?? [])
    } catch (e) {
      setExpenseErr(e instanceof Error ? e.message : '立替金履歴の取得に失敗しました')
    } finally {
      setExpenseLoad(false)
    }
  }, [contractor, yearMonth])

  useEffect(() => { loadContractor() }, [loadContractor])
  useEffect(() => { loadNotices() }, [loadNotices])
  useEffect(() => { loadExpenses() }, [loadExpenses])

  async function handleApprove(noticeId: string) {
    const res = await approvePaymentNotice(noticeId)
    if (res.error) {
      setToast({ message: res.error, type: 'error' })
    } else {
      setToast({ message: '支払通知書を承認しました', type: 'success' })
      setNotices(prev => prev.map(n => n.id === noticeId ? { ...n, approvalStatus: 'approved' } : n))
    }
  }

  const pending  = notices.filter(n => n.approvalStatus !== 'approved')
  const approved = notices.filter(n => n.approvalStatus === 'approved')

  return (
    <div className="min-h-screen bg-zinc-50">
      <div className="mx-auto max-w-2xl px-4 py-6">
        {error && (
          <div className="mb-4 rounded-lg bg-red-50 border border-red-200 px-4 py-3 text-sm text-red-700">
            {error}
          </div>
        )}

        {loading ? (
          <div className="py-24 text-center text-sm text-zinc-400">読み込み中...</div>
        ) : contractor && (
          <div className="space-y-8">
            <section>
              <h2 className="text-sm font-bold text-zinc-900 mb-3">支払通知書の確認・承認</h2>
              {noticeLoad ? (
                <div className="py-8 text-center text-sm text-zinc-400">読み込み中...</div>
              ) : noticeErr ? (
                <div className="rounded-lg bg-red-50 border border-red-200 px-4 py-3 text-sm text-red-700">{noticeErr}</div>
              ) : notices.length === 0 ? (
                <div className="py-10 text-center text-sm text-zinc-400 rounded-xl border border-dashed border-zinc-200 bg-white">
                  支払通知書はありません
                </div>
              ) : (
                <div className="space-y-4">
                  {pending.map(n => (
                    <PaymentNoticeCard key={n.id} notice={n} contractorId={contractor.id} onApprove={handleApprove} />
                  ))}
                  {approved.slice(0, 3).map(n => (
                    <PaymentNoticeCard key={n.id} notice={n} contractorId={contractor.id} onApprove={handleApprove} />
                  ))}
                  {approved.length > 3 && (
                    <p className="text-center text-xs text-zinc-400">他 {approved.length - 3} 件の承認済み通知書は省略</p>
                  )}
                </div>
              )}
            </section>

            <PaymentHistorySection contractorId={contractor.id} />

            <section>
              <div className="flex items-center justify-between mb-3">
                <h2 className="text-sm font-bold text-zinc-900">立替金の申請履歴</h2>
                <div className="flex items-center gap-2">
                  <label className="text-xs text-zinc-500">立替金の対象月</label>
                  <input
                    type="month"
                    value={yearMonth}
                    onChange={e => setYearMonth(e.target.value)}
                    className="rounded-md border border-zinc-300 bg-white px-2 py-1 text-xs text-zinc-900 outline-none focus:border-zinc-500"
                  />
                </div>
              </div>
              {expenseErr && <p className="text-xs text-red-600 mb-2">{expenseErr}</p>}
              {expenseLoad ? (
                <div className="py-6 text-center text-sm text-zinc-400">読み込み中...</div>
              ) : expenses.length === 0 ? (
                <div className="py-8 text-center text-sm text-zinc-400 rounded-xl border border-dashed border-zinc-200 bg-white">
                  対象月の申請データがありません
                </div>
              ) : (
                <div className="rounded-2xl border border-zinc-200 bg-white overflow-hidden">
                  <table className="w-full text-sm">
                    <thead className="bg-zinc-50 border-b border-zinc-100">
                      <tr>
                        <th className="px-4 py-2.5 text-left text-xs font-medium text-zinc-500">日付</th>
                        <th className="px-4 py-2.5 text-left text-xs font-medium text-zinc-500">種別</th>
                        <th className="px-4 py-2.5 text-right text-xs font-medium text-zinc-500">金額</th>
                        <th className="px-4 py-2.5 text-left text-xs font-medium text-zinc-500">備考</th>
                        <th className="px-4 py-2.5 text-center text-xs font-medium text-zinc-500">状態</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-zinc-100">
                      {expenses.map(r => {
                        const st = EXPENSE_STATUS_STYLE[r.approvalStatus] ?? EXPENSE_STATUS_STYLE.pending
                        const typeLabel = EXPENSE_TYPES.find(t => t.value === r.expenseType)?.label ?? r.expenseType
                        return (
                          <tr key={r.id} className="hover:bg-zinc-50">
                            <td className="px-4 py-2.5 tabular-nums text-zinc-600 whitespace-nowrap">
                              {r.expenseDate.slice(5).replace('-', '/')}
                            </td>
                            <td className="px-4 py-2.5 text-zinc-700">{typeLabel}</td>
                            <td className="px-4 py-2.5 text-right font-semibold text-zinc-900 tabular-nums">
                              ¥{r.amountActual.toLocaleString('ja-JP')}
                            </td>
                            <td className="px-4 py-2.5 text-zinc-500 max-w-[120px] truncate">{r.remarks ?? '—'}</td>
                            <td className="px-4 py-2.5 text-center">
                              <span className={`inline-flex rounded-full px-2 py-0.5 text-xs font-medium ${st.cls}`}>
                                {st.label}
                              </span>
                            </td>
                          </tr>
                        )
                      })}
                    </tbody>
                  </table>
                </div>
              )}
            </section>
          </div>
        )}
      </div>

      {toast && (
        <Toast message={toast.message} type={toast.type} onDismiss={() => setToast(null)} />
      )}
    </div>
  )
}
