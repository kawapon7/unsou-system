'use client'

import { useState, useEffect, useCallback, useTransition } from 'react'
import {
  getDefensiveAlerts,
  reviewThresholdRecord,
  type DefensiveAlerts,
  type ThresholdAlertRow,
  type InvoiceWarningRow,
  type PendingNoticeRow,
} from '@/app/_actions/defensiveAlertActions'
import { resolveDuplicateRecord } from '@/app/_actions/workRecordActions'
import { updateScheduleStatus } from '@/app/_actions/scheduleActions'
import type { MissingInputRow } from '@/app/_actions/scheduleActions'
import type { DuplicateGroup, WorkRecordRow } from '@/app/_actions/workRecordActions'

// ── ユーティリティ ────────────────────────────────────────

const yen = (n: number) => `¥${n.toLocaleString('ja-JP')}`

function Badge({ count, color }: { count: number; color: 'red' | 'amber' }) {
  const cls = color === 'red'
    ? 'bg-rose-100 text-rose-700 border border-rose-200'
    : 'bg-amber-100 text-amber-700 border border-amber-200'
  return (
    <span className={`inline-flex items-center justify-center rounded-full px-2 py-0.5 text-xs font-bold tabular-nums ${cls}`}>
      {count}
    </span>
  )
}

// ── アコーディオン行 ──────────────────────────────────────

function AlertSection({
  icon, title, count, color, children,
}: {
  icon: string
  title: string
  count: number
  color: 'red' | 'amber'
  children: React.ReactNode
}) {
  const [open, setOpen] = useState(true)
  if (count === 0) return null

  const borderCls = color === 'red'
    ? 'border-rose-200 bg-rose-50'
    : 'border-amber-200 bg-amber-50'
  const headerCls = color === 'red'
    ? 'text-rose-800'
    : 'text-amber-800'

  return (
    <div className={`rounded-xl border ${borderCls} overflow-hidden`}>
      <button
        type="button"
        onClick={() => setOpen(o => !o)}
        className={`w-full flex items-center justify-between px-4 py-3 text-sm font-semibold ${headerCls} hover:opacity-80 transition-opacity`}
      >
        <span className="flex items-center gap-2">
          <span>{icon}</span>
          <span>{title}</span>
          <Badge count={count} color={color} />
        </span>
        <span className="text-xs opacity-60">{open ? '▲' : '▼'}</span>
      </button>
      {open && (
        <div className="border-t border-inherit bg-white px-4 pb-4 pt-3 space-y-3">
          {children}
        </div>
      )}
    </div>
  )
}

// ── ① 入力遅延セクション ──────────────────────────────────

function MissingInputSection({
  rows, onMarkAbsent,
}: {
  rows: MissingInputRow[]
  onMarkAbsent: (scheduleId: string, name: string) => void
}) {
  return (
    <AlertSection icon="🔴" title="入力遅延（未入力検知）" count={rows.length} color="red">
      <div className="space-y-2">
        {rows.map(r => (
          <div
            key={r.scheduleId}
            className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-zinc-100 bg-zinc-50 px-3 py-2 text-sm"
          >
            <div>
              <span className="font-medium text-zinc-900">{r.contractorName}</span>
              <span className="mx-1.5 text-zinc-400">|</span>
              <span className="text-zinc-600">{r.projectName}</span>
              <span className="mx-1.5 text-zinc-400">|</span>
              <span className="tabular-nums text-zinc-500">{r.date}</span>
            </div>
            <div className="flex items-center gap-2">
              {/* SMS催促 */}
              <a
                href={`sms:${encodeURIComponent(r.contractorId)}`}
                className="inline-flex rounded-md bg-zinc-800 px-2.5 py-1 text-xs font-medium text-white hover:bg-zinc-700"
              >
                SMS催促
              </a>
              {/* 本日休み */}
              <button
                type="button"
                onClick={() => onMarkAbsent(r.scheduleId, r.contractorName)}
                className="inline-flex rounded-md border border-zinc-300 bg-white px-2.5 py-1 text-xs font-medium text-zinc-700 hover:bg-zinc-50"
              >
                本日休み
              </button>
            </div>
          </div>
        ))}
      </div>
    </AlertSection>
  )
}

// ── ② 重複の疑いセクション ────────────────────────────────

function DuplicateSection({
  groups, onDelete,
}: {
  groups: DuplicateGroup[]
  onDelete: (id: string, label: string) => void
}) {
  return (
    <AlertSection icon="🔴" title="重複の疑い（二重登録検知）" count={groups.length} color="red">
      <div className="space-y-4">
        {groups.map((g, gi) => (
          <div key={gi} className="rounded-lg border border-zinc-200 overflow-hidden">
            <div className="bg-zinc-50 px-3 py-2 text-xs font-semibold text-zinc-600 border-b border-zinc-200">
              {g.contractorName} ／ {g.projectName} ／ {g.date}
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 divide-y sm:divide-y-0 sm:divide-x divide-zinc-100">
              {g.records.map((rec: WorkRecordRow, i: number) => (
                <div key={rec.id} className="px-3 py-2 text-sm space-y-1">
                  <p className="text-xs font-medium text-zinc-400">レコード {i + 1}</p>
                  <p className="text-zinc-700">
                    {rec.startTime ?? '−'} 〜 {rec.endTime ?? '−'}
                    {rec.pieceCount != null && <span className="ml-2">{rec.pieceCount} 個</span>}
                  </p>
                  <p className="text-xs text-zinc-400">登録: {new Date(rec.createdAt).toLocaleString('ja-JP')}</p>
                  <button
                    type="button"
                    onClick={() => onDelete(rec.id, `${g.contractorName} ${g.date} (${i + 1})`)}
                    className="mt-1 inline-flex rounded-md bg-rose-600 px-2.5 py-1 text-xs font-medium text-white hover:bg-rose-700"
                  >
                    このレコードを削除
                  </button>
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>
    </AlertSection>
  )
}

// ── ③ 業務しきい値セクション ──────────────────────────────

function ThresholdSection({
  rows, onReview,
}: {
  rows: ThresholdAlertRow[]
  onReview: (table: 'work_records' | 'expense_records', id: string) => void
}) {
  return (
    <AlertSection icon="⚠️" title="業務しきい値（異常値警告）" count={rows.length} color="amber">
      <div className="space-y-2">
        {rows.map(r => (
          <div
            key={r.id}
            className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-zinc-100 bg-zinc-50 px-3 py-2 text-sm"
          >
            <div>
              <span className="font-medium text-zinc-900">{r.contractorName}</span>
              <span className="mx-1.5 text-zinc-400">|</span>
              <span className="text-zinc-600">{r.date}</span>
              <span className="mx-1.5 text-zinc-400">|</span>
              <span className="font-semibold text-amber-700">{r.reason}</span>
              <span className="ml-1.5 text-zinc-500">
                ({r.table === 'work_records' ? `${r.value}個` : yen(r.value)})
              </span>
              <span className="ml-2 inline-flex rounded-full bg-amber-100 px-1.5 py-0.5 text-[10px] font-medium text-amber-700">
                ロック中
              </span>
            </div>
            <button
              type="button"
              onClick={() => onReview(r.table, r.id)}
              className="inline-flex rounded-md bg-amber-600 px-2.5 py-1 text-xs font-medium text-white hover:bg-amber-700"
            >
              確認済み（承認）
            </button>
          </div>
        ))}
      </div>
    </AlertSection>
  )
}

// ── ④ インボイス警告セクション ────────────────────────────

function InvoiceWarningSection({ rows }: { rows: InvoiceWarningRow[] }) {
  return (
    <AlertSection icon="⚠️" title="インボイス公表サイト警告" count={rows.length} color="amber">
      <div className="space-y-2">
        {rows.map(r => (
          <div
            key={r.contractorId}
            className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-zinc-100 bg-zinc-50 px-3 py-2 text-sm"
          >
            <div>
              <span className="font-medium text-zinc-900">{r.contractorName}</span>
              <span className="mx-1.5 text-zinc-400">|</span>
              <span className="text-zinc-600">
                {r.invoiceNumber ? `T${r.invoiceNumber}` : '番号未登録'}
              </span>
              <span className="ml-2 inline-flex rounded-full bg-rose-100 px-1.5 py-0.5 text-[10px] font-medium text-rose-700">
                要確認
              </span>
            </div>
            <p className="text-xs text-zinc-500">
              {r.invoiceStatus === 'expired'
                ? '登録番号が失効しています。経過措置控除率に自動移行してください。'
                : '登録番号が未設定です。取引先マスタを確認してください。'}
            </p>
          </div>
        ))}
      </div>
    </AlertSection>
  )
}

// ── ⑤ 長期未承認セクション ───────────────────────────────

function PendingNoticeSection({ rows }: { rows: PendingNoticeRow[] }) {
  return (
    <AlertSection icon="🔴" title="長期間未承認（48時間超）" count={rows.length} color="red">
      <div className="space-y-2">
        {rows.map(r => (
          <div
            key={r.noticeId}
            className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-zinc-100 bg-zinc-50 px-3 py-2 text-sm"
          >
            <div>
              <span className="font-medium text-zinc-900">{r.contractorName}</span>
              <span className="mx-1.5 text-zinc-400">|</span>
              <span className="text-zinc-600">{r.targetMonth} 分</span>
              <span className="ml-2 text-rose-700 font-semibold">{r.hoursElapsed}時間 未承認</span>
            </div>
            <div className="flex items-center gap-2">
              {r.phone && (
                <a
                  href={`sms:${r.phone}`}
                  className="inline-flex rounded-md bg-zinc-800 px-2.5 py-1 text-xs font-medium text-white hover:bg-zinc-700"
                >
                  SMS催促
                </a>
              )}
              {r.email && (
                <a
                  href={`mailto:${r.email}?subject=${encodeURIComponent('支払通知書の確認をお願いします')}`}
                  className="inline-flex rounded-md border border-zinc-300 bg-white px-2.5 py-1 text-xs font-medium text-zinc-700 hover:bg-zinc-50"
                >
                  メール催促
                </a>
              )}
            </div>
          </div>
        ))}
      </div>
    </AlertSection>
  )
}

// ================================================================
// DefensiveAlertPanel（メインコンポーネント）
// ================================================================

export default function DefensiveAlertPanel() {
  const [alerts,   setAlerts]   = useState<DefensiveAlerts | null>(null)
  const [loadErr,  setLoadErr]  = useState<string | null>(null)
  const [isPending, startTransition] = useTransition()

  const load = useCallback(async () => {
    const res = await getDefensiveAlerts()
    if (res.error) { setLoadErr(res.error); return }
    setAlerts(res.data)
    setLoadErr(null)
  }, [])

  useEffect(() => { load() }, [load])

  // 総件数0なら完全非表示
  if (!alerts || alerts.totalCount === 0) return null

  // ── アクションハンドラー ────────────────────────────────

  function handleMarkAbsent(scheduleId: string, name: string) {
    if (!window.confirm(`「${name}」を「本日休み」に変更しますか？`)) return
    startTransition(async () => {
      await updateScheduleStatus(scheduleId, 'absent')
      await load()
    })
  }

  function handleDeleteDuplicate(id: string, label: string) {
    if (!window.confirm(`「${label}」の勤務記録を削除しますか？\nこの操作は取り消せません。`)) return
    startTransition(async () => {
      await resolveDuplicateRecord(id)
      await load()
    })
  }

  function handleReviewThreshold(table: 'work_records' | 'expense_records', id: string) {
    if (!window.confirm('このレコードを確認済みとして承認しますか？\nロックが解除されます。')) return
    startTransition(async () => {
      await reviewThresholdRecord(table, id)
      await load()
    })
  }

  return (
    <div className="rounded-xl border border-zinc-200 bg-white p-4 space-y-3 shadow-sm">

      {/* ヘッダー */}
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-semibold text-zinc-800 flex items-center gap-2">
          ディフェンシブアラート
          <span className="inline-flex items-center justify-center rounded-full bg-rose-600 px-2 py-0.5 text-xs font-bold text-white tabular-nums">
            {alerts.totalCount}
          </span>
        </h2>
        <button
          type="button"
          onClick={load}
          disabled={isPending}
          className="text-xs text-zinc-400 hover:text-zinc-600 disabled:opacity-40"
        >
          {isPending ? '更新中…' : '↺ 更新'}
        </button>
      </div>

      {loadErr && (
        <p className="rounded-lg bg-red-50 px-3 py-2 text-xs text-red-600">{loadErr}</p>
      )}

      {/* ① 入力遅延 */}
      <MissingInputSection
        rows={alerts.missingInputs}
        onMarkAbsent={handleMarkAbsent}
      />

      {/* ② 重複の疑い */}
      <DuplicateSection
        groups={alerts.duplicates}
        onDelete={handleDeleteDuplicate}
      />

      {/* ③ 業務しきい値 */}
      <ThresholdSection
        rows={alerts.thresholds}
        onReview={handleReviewThreshold}
      />

      {/* ④ インボイス警告 */}
      <InvoiceWarningSection rows={alerts.invoiceWarnings} />

      {/* ⑤ 長期未承認 */}
      <PendingNoticeSection rows={alerts.pendingNotices} />

    </div>
  )
}
