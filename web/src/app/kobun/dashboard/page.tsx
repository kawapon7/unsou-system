'use client'

import { useState, useEffect, useCallback } from 'react'
import {
  fetchMyContractor,
  fetchMyProjects,
  updateProjectStatus,
  type AssignedProject,
} from './actions'
import {
  fetchMyPaymentNotices,
  approvePaymentNotice,
  type MyPaymentNotice,
} from '@/app/_actions/driver-actions'
import { PaymentNoticePdfModal } from '@/components/pdf/PaymentNoticePdfModal'
import { VoiceButton }           from '@/components/voice/VoiceButton'
import type { Database } from '@/types/supabase'

type ContractorRow = Database['public']['Tables']['contractors']['Row']

// ── ステータス定義 ─────────────────────────────────────────

const STATUSES = [
  { value: 'accepted',   label: '受託',       color: 'bg-blue-100 text-blue-700',   dot: 'bg-blue-400'   },
  { value: 'dispatched', label: '配車済',     color: 'bg-amber-100 text-amber-700', dot: 'bg-amber-400'  },
  { value: 'in_transit', label: '運行中',     color: 'bg-green-100 text-green-700', dot: 'bg-green-400'  },
  { value: 'completed',  label: '完了',       color: 'bg-zinc-100 text-zinc-500',   dot: 'bg-zinc-300'   },
  { value: 'cancelled',  label: 'キャンセル', color: 'bg-red-100 text-red-500',     dot: 'bg-red-300'    },
] as const

type StatusValue = (typeof STATUSES)[number]['value']

function StatusBadge({ status }: { status: string }) {
  const s = STATUSES.find(s => s.value === status)
  return (
    <span className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-xs font-medium ${s?.color ?? 'bg-zinc-100 text-zinc-500'}`}>
      <span className={`h-1.5 w-1.5 rounded-full ${s?.dot ?? 'bg-zinc-300'}`} />
      {s?.label ?? status}
    </span>
  )
}

// 子分が自分で変えられるステータス遷移
const NEXT_STATUS: Partial<Record<StatusValue, { value: StatusValue; label: string; btnCls: string }>> = {
  dispatched: {
    value: 'in_transit',
    label: '運行開始',
    btnCls: 'bg-green-600 hover:bg-green-500 text-white',
  },
  in_transit: {
    value: 'completed',
    label: '配送完了',
    btnCls: 'bg-zinc-800 hover:bg-zinc-700 text-white',
  },
}

// ── 日時フォーマット ───────────────────────────────────────

function fmt(iso: string | null) {
  if (!iso) return null
  const d = new Date(iso)
  return d.toLocaleDateString('ja-JP', {
    month: 'numeric',
    day: 'numeric',
    weekday: 'short',
    hour: '2-digit',
    minute: '2-digit',
  })
}

function DateRange({ start, end }: { start: string | null; end: string | null }) {
  const s = fmt(start)
  const e = fmt(end)
  if (!s && !e) return <span className="text-zinc-400">日時未定</span>
  return (
    <span className="tabular-nums">
      {s ?? '—'}{e ? <span className="text-zinc-400"> 〜 {e}</span> : ''}
    </span>
  )
}

// ── 案件カード ────────────────────────────────────────────

function ProjectCard({
  project,
  onStatusUpdate,
}: {
  project: AssignedProject
  onStatusUpdate: (id: string, status: StatusValue) => Promise<void>
}) {
  const [updating, setUpdating] = useState(false)
  const next = NEXT_STATUS[project.status as StatusValue]

  async function handleClick() {
    if (!next) return
    setUpdating(true)
    await onStatusUpdate(project.id, next.value)
    setUpdating(false)
  }

  const isActive = project.status === 'in_transit'
  const isDone   = project.status === 'completed' || project.status === 'cancelled'

  return (
    <div className={`rounded-xl border bg-white p-5 shadow-sm transition ${isActive ? 'border-green-300 ring-1 ring-green-200' : 'border-zinc-200'} ${isDone ? 'opacity-60' : ''}`}>
      {/* ヘッダ行 */}
      <div className="flex items-start justify-between gap-3 mb-3">
        <div className="min-w-0">
          <p className="font-mono text-xs text-zinc-400 mb-0.5">{project.project_code}</p>
          <h3 className="font-semibold text-zinc-900 truncate">{project.project_name}</h3>
        </div>
        <StatusBadge status={project.status} />
      </div>

      {/* 荷主 */}
      <p className="text-xs text-zinc-500 mb-3">
        荷主: <span className="text-zinc-700 font-medium">{project.client_name ?? '—'}</span>
      </p>

      {/* ルート */}
      {(project.origin || project.destination) && (
        <div className="flex items-center gap-2 text-sm text-zinc-700 bg-zinc-50 rounded-lg px-3 py-2 mb-3">
          <span className="font-medium truncate">{project.origin ?? '—'}</span>
          <span className="text-zinc-400 shrink-0">→</span>
          <span className="font-medium truncate">{project.destination ?? '—'}</span>
        </div>
      )}

      {/* 日時 */}
      <div className="text-xs text-zinc-500 mb-4">
        <DateRange start={project.operation_start} end={project.operation_end} />
      </div>

      {/* 運賃 */}
      <div className="flex items-center justify-between text-sm mb-4">
        <span className="text-zinc-500">支払運賃</span>
        <span className="font-semibold text-zinc-900">
          {project.buy_amount != null
            ? `¥${project.buy_amount.toLocaleString()}`
            : <span className="text-zinc-400 font-normal">未確定</span>}
        </span>
      </div>

      {/* アクションボタン */}
      {next && (
        <button
          onClick={handleClick}
          disabled={updating}
          className={`w-full rounded-lg py-2 text-sm font-medium transition disabled:opacity-50 ${next.btnCls}`}
        >
          {updating ? '更新中...' : next.label}
        </button>
      )}
    </div>
  )
}

// ── トースト通知 ──────────────────────────────────────────

function Toast({ message, type, onDismiss }: { message: string; type: 'success' | 'error'; onDismiss: () => void }) {
  useEffect(() => {
    const t = setTimeout(onDismiss, 5000)
    return () => clearTimeout(t)
  }, [onDismiss])

  return (
    <div
      className={`fixed bottom-6 right-4 left-4 sm:left-auto sm:w-80 z-50 flex items-start gap-3 rounded-xl px-4 py-3 shadow-lg text-sm font-medium transition-all
        ${type === 'success' ? 'bg-green-600 text-white' : 'bg-red-600 text-white'}`}
    >
      <span className="flex-1">{message}</span>
      <button onClick={onDismiss} className="shrink-0 opacity-75 hover:opacity-100 text-lg leading-none">×</button>
    </div>
  )
}

// ── 金額フォーマット ─────────────────────────────────────

function yen(n: number) {
  return `¥${n.toLocaleString('ja-JP')}`
}

function monthLabel(iso: string) {
  const d = new Date(iso)
  return `${d.getFullYear()}年${d.getMonth() + 1}月分`
}

// ── 支払通知書カード ─────────────────────────────────────

function PaymentNoticeCard({
  notice,
  contractorId,
  onApprove,
}: {
  notice:       MyPaymentNotice
  contractorId: string
  onApprove:    (id: string) => Promise<void>
}) {
  const [approving, setApproving] = useState(false)
  const [pdfOpen,   setPdfOpen]   = useState(false)
  const isApproved = notice.approvalStatus === 'approved'
  const yearMonth  = notice.noticeMonth.slice(0, 7)  // 'YYYY-MM'

  async function handleApprove() {
    setApproving(true)
    await onApprove(notice.id)
    setApproving(false)
  }

  const subtotal = notice.laborNet + notice.laborTax + notice.expenseNet + notice.expenseTax

  return (
    <div className={`rounded-2xl border bg-white p-5 shadow-sm ${isApproved ? 'border-green-300' : 'border-zinc-200'}`}>
      {/* ヘッダ */}
      <div className="flex items-center justify-between mb-4">
        <h3 className="font-bold text-zinc-900 text-base">{monthLabel(notice.noticeMonth)}</h3>
        {isApproved && (
          <span className="inline-flex items-center gap-1 rounded-full bg-green-100 text-green-700 text-xs font-semibold px-3 py-1">
            ✅ 承認済み
          </span>
        )}
      </div>

      {/* 金額明細 */}
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

      {/* 支払明細PDFボタン */}
      <button
        onClick={() => setPdfOpen(true)}
        className="w-full py-2.5 rounded-xl border border-blue-200 bg-blue-50 text-sm font-medium text-blue-700 hover:bg-blue-100 transition mb-3"
      >
        📄 支払明細PDF
      </button>

      {/* 承認ボタン */}
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
                : 'bg-blue-600 hover:bg-blue-500 active:bg-blue-700 text-white'
          }`}
      >
        {isApproved
          ? '✅ 承認済み'
          : notice.locked
            ? '🔒 ロック中（親分に確認)'
            : approving
              ? '処理中...'
              : 'この金額で合ってます'}
      </button>

      {/* PDF モーダル */}
      {pdfOpen && (
        <PaymentNoticePdfModal
          contractorId={contractorId}
          yearMonth={yearMonth}
          contractorName="（自分）"
          onClose={() => setPdfOpen(false)}
        />
      )}
    </div>
  )
}

// ── 支払通知書セクション ─────────────────────────────────

function PaymentNoticeSection({
  contractorId,
  toast,
  setToast,
}: {
  contractorId: string
  toast: { message: string; type: 'success' | 'error' } | null
  setToast: (t: { message: string; type: 'success' | 'error' } | null) => void
}) {
  const [notices, setNotices]   = useState<MyPaymentNotice[]>([])
  const [loading, setLoading]   = useState(true)
  const [sectErr, setSectErr]   = useState<string | null>(null)

  const loadNotices = useCallback(async () => {
    setLoading(true)
    const res = await fetchMyPaymentNotices()
    if (res.error) {
      setSectErr(res.error)
    } else {
      setNotices(res.data ?? [])
    }
    setLoading(false)
  }, [])

  useEffect(() => { loadNotices() }, [loadNotices])

  async function handleApprove(noticeId: string) {
    const res = await approvePaymentNotice(noticeId)
    if (res.error) {
      setToast({ message: res.error, type: 'error' })
    } else {
      setToast({ message: '支払通知書を承認しました', type: 'success' })
      setNotices(prev =>
        prev.map(n => n.id === noticeId ? { ...n, approvalStatus: 'approved' } : n)
      )
    }
  }

  if (loading) {
    return (
      <div className="py-8 text-center text-sm text-zinc-400">支払通知書を読み込み中...</div>
    )
  }

  if (sectErr) {
    return (
      <div className="rounded-lg bg-red-50 border border-red-200 px-4 py-3 text-sm text-red-700">
        {sectErr}
      </div>
    )
  }

  const pending  = notices.filter(n => n.approvalStatus !== 'approved')
  const approved = notices.filter(n => n.approvalStatus === 'approved')

  return (
    <div>
      <h2 className="text-base font-bold text-zinc-900 mb-4">支払通知書の確認・承認</h2>

      {notices.length === 0 ? (
        <div className="py-12 text-center text-sm text-zinc-400 rounded-xl border border-dashed border-zinc-200 bg-white">
          未承認の支払通知書はありません
        </div>
      ) : (
        <div className="space-y-4">
          {/* 未承認を先に表示 */}
          {pending.map(n => (
            <PaymentNoticeCard key={n.id} notice={n} contractorId={contractorId} onApprove={handleApprove} />
          ))}
          {/* 承認済みは折りたたまず一覧表示（最大3件） */}
          {approved.slice(0, 3).map(n => (
            <PaymentNoticeCard key={n.id} notice={n} contractorId={contractorId} onApprove={handleApprove} />
          ))}
          {approved.length > 3 && (
            <p className="text-center text-xs text-zinc-400">
              他 {approved.length - 3} 件の承認済み通知書は省略されています
            </p>
          )}
        </div>
      )}
    </div>
  )
}

// ── メインページ ──────────────────────────────────────────

export default function KobunDashboard() {
  const [contractor, setContractor] = useState<ContractorRow | null>(null)
  const [projects, setProjects]     = useState<AssignedProject[]>([])
  const [loading, setLoading]       = useState(true)
  const [error, setError]           = useState<string | null>(null)
  const [filterStatus, setFilterStatus] = useState<string>('active')
  const [toast, setToast] = useState<{ message: string; type: 'success' | 'error' } | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)

    const cRes = await fetchMyContractor()
    if (cRes.error || !cRes.data) {
      setError(cRes.error ?? '委託先が見つかりません')
      setLoading(false)
      return
    }
    const contractorData = cRes.data
    setContractor(contractorData)

    const pRes = await fetchMyProjects(contractorData.id)
    if (pRes.error) {
      setError(pRes.error)
    } else {
      setProjects(pRes.data ?? [])
    }
    setLoading(false)
  }, [])

  useEffect(() => { load() }, [load])

  async function handleStatusUpdate(id: string, status: StatusValue) {
    const res = await updateProjectStatus(id, status)
    if (res.error) {
      setError(res.error)
    } else {
      setProjects(prev =>
        prev.map(p => p.id === id ? { ...p, status } : p)
      )
    }
  }

  const FILTER_OPTIONS = [
    { key: 'active',    label: '進行中' },
    { key: 'all',       label: 'すべて' },
    { key: 'completed', label: '完了済み' },
  ] as const

  const filtered = (() => {
    if (filterStatus === 'active')
      return projects.filter(p => p.status !== 'completed' && p.status !== 'cancelled')
    if (filterStatus === 'completed')
      return projects.filter(p => p.status === 'completed' || p.status === 'cancelled')
    return projects
  })()

  // 統計
  const stats = {
    total:     projects.length,
    active:    projects.filter(p => p.status === 'in_transit').length,
    dispatched: projects.filter(p => p.status === 'dispatched').length,
    completed: projects.filter(p => p.status === 'completed').length,
  }

  return (
    <div className="min-h-screen bg-zinc-50">
      <div className="mx-auto max-w-5xl px-4 py-8">

        {/* ヘッダ */}
        <div className="mb-6">
          <h1 className="text-xl font-semibold text-zinc-900">
            {contractor ? `${contractor.name} さんのダッシュボード` : 'ダッシュボード'}
          </h1>
          {contractor && (
            <p className="text-sm text-zinc-500 mt-1">{contractor.email ?? contractor.login_email}</p>
          )}
        </div>

        {/* 統計カード */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-6">
          {[
            { label: '担当案件',  value: stats.total,      color: 'text-zinc-900' },
            { label: '運行中',    value: stats.active,     color: 'text-green-600' },
            { label: '配車済',    value: stats.dispatched, color: 'text-amber-600' },
            { label: '完了',      value: stats.completed,  color: 'text-zinc-400' },
          ].map(s => (
            <div key={s.label} className="rounded-xl bg-white border border-zinc-200 px-4 py-3">
              <p className="text-xs text-zinc-500 mb-1">{s.label}</p>
              <p className={`text-2xl font-bold tabular-nums ${s.color}`}>{s.value}</p>
            </div>
          ))}
        </div>

        {/* フィルタ */}
        <div className="flex gap-1 mb-5">
          {FILTER_OPTIONS.map(opt => (
            <button
              key={opt.key}
              onClick={() => setFilterStatus(opt.key)}
              className={`rounded-full px-4 py-1.5 text-xs font-medium transition ${
                filterStatus === opt.key
                  ? 'bg-zinc-900 text-white'
                  : 'bg-white border border-zinc-300 text-zinc-600 hover:bg-zinc-50'
              }`}
            >
              {opt.label}
            </button>
          ))}
        </div>

        {/* エラー */}
        {error && (
          <div className="mb-4 rounded-lg bg-red-50 border border-red-200 px-4 py-3 text-sm text-red-700">
            {error}
          </div>
        )}

        {/* コンテンツ */}
        {loading ? (
          <div className="py-24 text-center text-sm text-zinc-400">読み込み中...</div>
        ) : filtered.length === 0 ? (
          <div className="py-24 text-center text-sm text-zinc-400">
            {filterStatus === 'active' ? '進行中の案件はありません' : 'データがありません'}
          </div>
        ) : (
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {filtered.map(p => (
              <ProjectCard
                key={p.id}
                project={p}
                onStatusUpdate={handleStatusUpdate}
              />
            ))}
          </div>
        )}

        {/* 支払通知書セクション */}
        {contractor && !loading && (
          <div className="mt-10 border-t border-zinc-200 pt-8">
            <PaymentNoticeSection
              contractorId={contractor.id}
              toast={toast}
              setToast={setToast}
            />
          </div>
        )}
      </div>

      {/* トースト */}
      {toast && (
        <Toast
          message={toast.message}
          type={toast.type}
          onDismiss={() => setToast(null)}
        />
      )}

      {/* 音声操作ボタン（子分：経費保存フロー有効） */}
      <VoiceButton contractorId={contractor?.id} />
    </div>
  )
}
