'use client'

import { useState, useEffect, useCallback, useTransition } from 'react'
import { useSearchParams, useRouter, usePathname } from 'next/navigation'
import { useMonth } from '@/contexts/MonthContext'
import {
  fetchPendingPaymentNotices,
  fetchPendingWorkRecords,
  fetchApprovalHistory,
  approvePaymentNotice,
  rejectPaymentNotice,
  type PendingPaymentNoticeRow,
  type PendingWorkRecordRow,
  type ApprovalHistoryRow,
} from '@/app/_actions/approvalActions'
import {
  fetchExpensesForApproval,
  approveExpense,
  rejectExpense,
  type ExpenseApprovalRow,
} from '@/app/admin/billing/actions'
import {
  reviewThresholdRecord,
  deleteAlertRecord,
} from '@/app/_actions/defensiveAlertActions'

// ── ユーティリティ ────────────────────────────────────────

const yen = (n: number) => `¥${n.toLocaleString('ja-JP')}`

const EXPENSE_TYPE_LABEL: Record<string, string> = {
  toll:    '高速道路料金',
  parking: '駐車場代',
  fuel:    '燃料費',
  other:   'その他',
}

const ACTION_TYPE_LABEL: Record<string, { label: string; cls: string }> = {
  approve:           { label: '承認',           cls: 'bg-emerald-100 text-emerald-700' },
  reject:            { label: '却下',           cls: 'bg-rose-100 text-rose-600'     },
  unlock:            { label: '開発者アンロック', cls: 'bg-amber-100 text-amber-700'   },
  generate:          { label: '通知書生成',      cls: 'bg-blue-100 text-blue-700'     },
  developer_unlock:  { label: '開発者アンロック', cls: 'bg-amber-100 text-amber-700'   },
}

function SummaryCard({ label, value, sub, accent }: {
  label: string; value: string; sub?: string; accent?: 'amber' | 'emerald' | 'rose'
}) {
  const borderCls = accent === 'amber'   ? 'border-l-4 border-l-amber-400'
                  : accent === 'emerald' ? 'border-l-4 border-l-emerald-400'
                  : accent === 'rose'    ? 'border-l-4 border-l-rose-400'
                  : ''
  return (
    <div className={`rounded-xl bg-white border border-zinc-200 px-5 py-4 ${borderCls}`}>
      <p className="text-xs text-zinc-500 mb-1">{label}</p>
      <p className="text-xl font-bold text-zinc-900 tabular-nums">{value}</p>
      {sub && <p className="text-xs text-zinc-400 mt-0.5">{sub}</p>}
    </div>
  )
}

// ================================================================
// ① 支払通知書承認タブ
// ================================================================

function PendingPaymentNoticesTab() {
  const [rows,      setRows]      = useState<PendingPaymentNoticeRow[]>([])
  const [loading,   setLoading]   = useState(true)
  const [error,     setError]     = useState<string | null>(null)
  const [isPending, startTransition] = useTransition()

  const load = useCallback(async () => {
    setLoading(true)
    const res = await fetchPendingPaymentNotices()
    if (res.error) setError(res.error)
    else setRows(res.data ?? [])
    setLoading(false)
  }, [])

  useEffect(() => { void load() }, [load])

  function handleApprove(noticeId: string, name: string) {
    if (!window.confirm(`「${name}」の支払通知書を承認しますか？`)) return
    startTransition(async () => {
      const res = await approvePaymentNotice(noticeId)
      if (res.error) { setError(res.error); return }
      setRows(prev => prev.filter(r => r.noticeId !== noticeId))
    })
  }

  function handleReject(noticeId: string, name: string) {
    if (!window.confirm(`「${name}」の支払通知書を却下しますか？`)) return
    startTransition(async () => {
      const res = await rejectPaymentNotice(noticeId)
      if (res.error) { setError(res.error); return }
      setRows(prev => prev.filter(r => r.noticeId !== noticeId))
    })
  }

  const pending  = rows.filter(r => r.approvalStatus === 'pending' || r.approvalStatus === 'unapproved')
  const over48h  = pending.filter(r => r.hoursElapsed >= 48)

  if (loading) return <div className="py-20 text-center text-sm text-zinc-400">読み込み中...</div>

  return (
    <div className="space-y-6">
      {error && <p className="text-sm text-red-600 bg-red-50 rounded-lg px-3 py-2">{error}</p>}

      <div className="grid grid-cols-3 gap-3">
        <SummaryCard label="承認待ち"        value={`${pending.length} 件`}  accent="amber" />
        <SummaryCard label="48時間超 未承認"  value={`${over48h.length} 件`} accent="rose" />
        <SummaryCard label="合計金額"         value={yen(rows.reduce((s, r) => s + r.totalAmount, 0))} />
      </div>

      {rows.length === 0 ? (
        <div className="py-16 text-center text-sm text-zinc-400">承認待ちの支払通知書はありません</div>
      ) : (
        <div className="rounded-xl bg-white border border-zinc-200 overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-zinc-50 border-b border-zinc-200">
              <tr>
                <th className="px-4 py-3 text-left text-xs font-medium text-zinc-500">委託先</th>
                <th className="px-4 py-3 text-left text-xs font-medium text-zinc-500">対象月</th>
                <th className="px-4 py-3 text-right text-xs font-medium text-zinc-500">金額</th>
                <th className="px-4 py-3 text-left text-xs font-medium text-zinc-500">送信日時</th>
                <th className="px-4 py-3 text-left text-xs font-medium text-zinc-500">経過</th>
                <th className="px-4 py-3 text-left text-xs font-medium text-zinc-500">連絡先</th>
                <th className="px-4 py-3" />
              </tr>
            </thead>
            <tbody className="divide-y divide-zinc-100">
              {rows.map(r => (
                <tr key={r.noticeId} className={`hover:bg-zinc-50 ${r.hoursElapsed >= 48 ? 'bg-rose-50/40' : ''}`}>
                  <td className="px-4 py-3 font-medium text-zinc-900">{r.contractorName}</td>
                  <td className="px-4 py-3 text-zinc-600 tabular-nums">
                    {r.targetMonth.slice(0, 7).replace('-', '年')}月
                  </td>
                  <td className="px-4 py-3 text-right font-semibold text-zinc-900 tabular-nums">
                    {yen(r.totalAmount)}
                  </td>
                  <td className="px-4 py-3 text-zinc-500 tabular-nums text-xs">
                    {new Date(r.createdAt).toLocaleString('ja-JP', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' })}
                  </td>
                  <td className="px-4 py-3">
                    <span className={`text-xs font-semibold ${r.hoursElapsed >= 48 ? 'text-rose-600' : 'text-zinc-500'}`}>
                      {r.hoursElapsed}h
                    </span>
                  </td>
                  <td className="px-4 py-3">
                    {r.phone ? (
                      <div className="flex gap-1">
                        <a href={`tel:${r.phone}`} className="text-xs text-zinc-500 hover:text-zinc-700">📞</a>
                        <a href={`sms:${r.phone}`} className="text-xs text-zinc-500 hover:text-zinc-700">💬</a>
                      </div>
                    ) : (
                      <span className="text-xs text-zinc-300">—</span>
                    )}
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex gap-1 justify-end">
                      <button
                        onClick={() => handleApprove(r.noticeId, r.contractorName)}
                        disabled={isPending}
                        className="rounded-md bg-emerald-600 px-3 py-1 text-xs font-medium text-white hover:bg-emerald-700 disabled:opacity-50 transition whitespace-nowrap"
                      >
                        承認
                      </button>
                      <button
                        onClick={() => handleReject(r.noticeId, r.contractorName)}
                        disabled={isPending}
                        className="rounded-md border border-zinc-300 px-3 py-1 text-xs font-medium text-zinc-600 hover:bg-zinc-50 disabled:opacity-50 transition"
                      >
                        却下
                      </button>
                    </div>
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

// ================================================================
// ② 勤務記録承認タブ
// ================================================================

function PendingWorkRecordsTab() {
  const [rows,      setRows]      = useState<PendingWorkRecordRow[]>([])
  const [loading,   setLoading]   = useState(true)
  const [error,     setError]     = useState<string | null>(null)
  const [isPending, startTransition] = useTransition()

  const load = useCallback(async () => {
    setLoading(true)
    const res = await fetchPendingWorkRecords()
    if (res.error) setError(res.error)
    else setRows(res.data ?? [])
    setLoading(false)
  }, [])

  useEffect(() => { void load() }, [load])

  function handleApprove(id: string) {
    if (!window.confirm('このレコードを承認しますか？')) return
    startTransition(async () => {
      const res = await reviewThresholdRecord('work_records', id)
      if (res.error) { setError(res.error); return }
      setRows(prev => prev.filter(r => r.id !== id))
    })
  }

  function handleDelete(id: string) {
    if (!window.confirm('このレコードを削除しますか？この操作は取り消せません。')) return
    startTransition(async () => {
      const res = await deleteAlertRecord('work_records', id)
      if (res.error) { setError(res.error); return }
      setRows(prev => prev.filter(r => r.id !== id))
    })
  }

  if (loading) return <div className="py-20 text-center text-sm text-zinc-400">読み込み中...</div>

  return (
    <div className="space-y-6">
      {error && <p className="text-sm text-red-600 bg-red-50 rounded-lg px-3 py-2">{error}</p>}

      <div className="grid grid-cols-2 gap-3">
        <SummaryCard label="確認待ち件数" value={`${rows.length} 件`} accent="amber" />
        <SummaryCard label="合計個数"     value={`${rows.reduce((s, r) => s + r.value, 0).toLocaleString()} 個`} />
      </div>

      {rows.length === 0 ? (
        <div className="py-16 text-center text-sm text-zinc-400">確認待ちの勤務記録はありません</div>
      ) : (
        <div className="rounded-xl bg-white border border-zinc-200 overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-zinc-50 border-b border-zinc-200">
              <tr>
                <th className="px-4 py-3 text-left text-xs font-medium text-zinc-500">委託先</th>
                <th className="px-4 py-3 text-left text-xs font-medium text-zinc-500">案件</th>
                <th className="px-4 py-3 text-left text-xs font-medium text-zinc-500">日付</th>
                <th className="px-4 py-3 text-left text-xs font-medium text-zinc-500">異常内容</th>
                <th className="px-4 py-3 text-right text-xs font-medium text-zinc-500">値</th>
                <th className="px-4 py-3" />
              </tr>
            </thead>
            <tbody className="divide-y divide-zinc-100">
              {rows.map(r => (
                <tr key={r.id} className="hover:bg-zinc-50">
                  <td className="px-4 py-3 font-medium text-zinc-900">{r.contractorName}</td>
                  <td className="px-4 py-3 text-zinc-600">{r.projectName}</td>
                  <td className="px-4 py-3 text-zinc-500 tabular-nums">{r.date}</td>
                  <td className="px-4 py-3">
                    <span className="inline-flex rounded-full bg-amber-100 px-2 py-0.5 text-xs font-medium text-amber-700">
                      {r.reason}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-right font-semibold text-amber-700 tabular-nums">
                    {r.value.toLocaleString()} 個
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex gap-1 justify-end">
                      <button
                        onClick={() => handleApprove(r.id)}
                        disabled={isPending}
                        className="rounded-md bg-emerald-600 px-3 py-1 text-xs font-medium text-white hover:bg-emerald-700 disabled:opacity-50 transition whitespace-nowrap"
                      >
                        ✅ 承認
                      </button>
                      <button
                        onClick={() => handleDelete(r.id)}
                        disabled={isPending}
                        className="rounded-md bg-rose-600 px-3 py-1 text-xs font-medium text-white hover:bg-rose-700 disabled:opacity-50 transition"
                      >
                        🗑 削除
                      </button>
                    </div>
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

// ================================================================
// ③ 立替金承認タブ（billing から移植）
// ================================================================

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

  useEffect(() => { void load() }, [load])

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

  if (loading) return <div className="py-20 text-center text-sm text-zinc-400">読み込み中...</div>

  return (
    <div className="space-y-6">
      {error && <p className="text-sm text-red-600 bg-red-50 rounded-lg px-3 py-2">{error}</p>}

      <div className="grid grid-cols-3 gap-3">
        {[
          { label: '未承認', count: pending.length,  total: pending.reduce((s,r)=>s+r.amountActual,0),  accent: 'amber'   as const },
          { label: '承認済', count: approved.length, total: approved.reduce((s,r)=>s+r.amountActual,0), accent: 'emerald' as const },
          { label: '却下',   count: rejected.length, total: rejected.reduce((s,r)=>s+r.amountActual,0), accent: 'rose'    as const },
        ].map(s => (
          <SummaryCard key={s.label} label={s.label} value={yen(s.total)} sub={`${s.count} 件`} accent={s.accent} />
        ))}
      </div>

      {rows.length === 0 ? (
        <div className="py-16 text-center text-sm text-zinc-400">対象月の立替金データがありません</div>
      ) : (
        <div className="rounded-xl bg-white border border-zinc-200 overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-zinc-50 border-b border-zinc-200">
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
                const st = APPROVAL_STYLE[r.approvalStatus] ?? APPROVAL_STYLE.pending
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
                    <td className="px-4 py-3 text-zinc-500 max-w-[160px] truncate">{r.remarks ?? '—'}</td>
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

// ================================================================
// ④ 承認履歴タブ
// ================================================================

function ApprovalHistoryTab() {
  const [rows,    setRows]    = useState<ApprovalHistoryRow[]>([])
  const [loading, setLoading] = useState(true)
  const [error,   setError]   = useState<string | null>(null)

  useEffect(() => {
    fetchApprovalHistory().then(res => {
      if (res.error) setError(res.error)
      else setRows(res.data ?? [])
      setLoading(false)
    })
  }, [])

  if (loading) return <div className="py-20 text-center text-sm text-zinc-400">読み込み中...</div>

  return (
    <div className="space-y-4">
      {error && <p className="text-sm text-red-600 bg-red-50 rounded-lg px-3 py-2">{error}</p>}

      {rows.length === 0 ? (
        <div className="py-16 text-center text-sm text-zinc-400">承認履歴がありません</div>
      ) : (
        <div className="rounded-xl bg-white border border-zinc-200 overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-zinc-50 border-b border-zinc-200">
              <tr>
                <th className="px-4 py-3 text-left text-xs font-medium text-zinc-500">日時</th>
                <th className="px-4 py-3 text-left text-xs font-medium text-zinc-500">委託先</th>
                <th className="px-4 py-3 text-left text-xs font-medium text-zinc-500">対象月</th>
                <th className="px-4 py-3 text-left text-xs font-medium text-zinc-500">操作</th>
                <th className="px-4 py-3 text-left text-xs font-medium text-zinc-500">実行者</th>
                <th className="px-4 py-3 text-left text-xs font-medium text-zinc-500">理由</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-zinc-100">
              {rows.map(r => {
                const style = ACTION_TYPE_LABEL[r.actionType] ?? { label: r.actionType, cls: 'bg-zinc-100 text-zinc-600' }
                return (
                  <tr key={r.id} className="hover:bg-zinc-50">
                    <td className="px-4 py-3 tabular-nums text-xs text-zinc-500">
                      {new Date(r.createdAt).toLocaleString('ja-JP', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' })}
                    </td>
                    <td className="px-4 py-3 font-medium text-zinc-900">{r.contractorName}</td>
                    <td className="px-4 py-3 text-zinc-600 tabular-nums">{r.targetMonth}</td>
                    <td className="px-4 py-3">
                      <span className={`inline-flex rounded-full px-2 py-0.5 text-xs font-medium ${style.cls}`}>
                        {style.label}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-zinc-500 text-xs">{r.actionBy}</td>
                    <td className="px-4 py-3 text-zinc-400 text-xs max-w-[200px] truncate">
                      {r.unlockReason ?? '—'}
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

// ================================================================
// メインページ
// ================================================================

type Tab = 'payment' | 'work' | 'expense' | 'history'

const TABS: { key: Tab; label: string }[] = [
  { key: 'payment', label: '支払通知書承認' },
  { key: 'work',    label: '勤務記録承認'   },
  { key: 'expense', label: '立替金承認'     },
  { key: 'history', label: '承認履歴'       },
]

export default function ApprovalPage() {
  const searchParams = useSearchParams()
  const router       = useRouter()
  const pathname     = usePathname()
  const tab          = (searchParams.get('tab') as Tab | null) ?? 'payment'
  const setTab       = (t: Tab) => router.replace(`${pathname}?tab=${t}`)
  const { yearMonth } = useMonth()

  return (
    <div className="min-h-screen bg-zinc-50">
      <div className="mx-auto max-w-6xl px-6 py-8">

        <div className="flex flex-wrap items-center justify-between gap-4 mb-6">
          <div>
            <h1 className="text-xl font-semibold text-zinc-900">承認管理</h1>
            <p className="mt-1 text-sm text-zinc-500">
              <span className="font-medium text-zinc-700">
                {yearMonth.replace(/^(\d{4})-(\d{2})$/, '$1年$2月分')}
              </span>
              <span className="mx-2 text-zinc-300">|</span>
              支払通知書・勤務記録・立替金の承認を一元管理
            </p>
          </div>
        </div>

        <div className="flex gap-1 border-b border-zinc-200 mb-6 overflow-x-auto">
          {TABS.map(({ key, label }) => (
            <button
              key={key}
              onClick={() => setTab(key)}
              className={`px-5 py-2.5 text-sm font-medium border-b-2 -mb-px transition whitespace-nowrap ${
                tab === key
                  ? 'border-zinc-900 text-zinc-900'
                  : 'border-transparent text-zinc-500 hover:text-zinc-700'
              }`}
            >
              {label}
            </button>
          ))}
        </div>

        {tab === 'payment' && <PendingPaymentNoticesTab />}
        {tab === 'work'    && <PendingWorkRecordsTab />}
        {tab === 'expense' && <ExpenseApprovalTab yearMonth={yearMonth} />}
        {tab === 'history' && <ApprovalHistoryTab />}
      </div>
    </div>
  )
}
