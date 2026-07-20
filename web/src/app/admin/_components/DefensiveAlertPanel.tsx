'use client'

import { useState, useEffect, useCallback, useTransition } from 'react'
import {
  getDefensiveAlerts,
  reviewThresholdRecord,
  deleteAlertRecord,
  type DefensiveAlerts,
  type ThresholdAlertRow,
  type InvoiceWarningRow,
  type PendingNoticeRow,
  type OverdueInvoiceRow,
} from '@/app/_actions/defensiveAlertActions'
import {
  updateScheduleStatus,
  type MissingInputRow,
} from '@/app/_actions/scheduleActions'
import {
  keepDuplicateRecord,
  type DuplicateGroup,
  type WorkRecordRow,
} from '@/app/_actions/workRecordActions'
import { sendDefensiveAlertEmail } from '@/app/_actions/emailActions'

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

// ── アコーディオン ────────────────────────────────────────

function AlertSection({
  icon, title, count, color, children,
}: {
  icon: string; title: string; count: number; color: 'red' | 'amber'; children: React.ReactNode
}) {
  const [open, setOpen] = useState(true)
  if (count === 0) return null

  const borderCls = color === 'red'
    ? 'border-rose-200 bg-rose-50'
    : 'border-amber-200 bg-amber-50'
  const headerCls = color === 'red' ? 'text-rose-800' : 'text-amber-800'

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

// ── 3アクション共通ボタン行 ───────────────────────────────

/**
 * アラート操作は以下の3つのみ（req 7）:
 * 1. 手動確認（完了）: アラートを消す
 * 2. 削除: その場で一発削除
 * 3. ドライバーへ連絡: tel: / sms: リンク起動のみ（自動送信なし）
 */
function ActionRow({
  phone,
  contactName,
  onConfirm,
  onDelete,
  confirmLabel = '手動確認（完了）',
}: {
  phone?:        string | null
  contactName?:  string
  onConfirm?:   () => void
  onDelete?:    () => void
  confirmLabel?: string
}) {
  return (
    <div className="flex flex-wrap items-center gap-2 mt-2">
      {onConfirm && (
        <button
          type="button"
          onClick={onConfirm}
          className="inline-flex rounded-md bg-emerald-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-emerald-700"
        >
          ✅ {confirmLabel}
        </button>
      )}
      {onDelete && (
        <button
          type="button"
          onClick={onDelete}
          className="inline-flex rounded-md bg-rose-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-rose-700"
        >
          🗑 削除
        </button>
      )}
      {phone ? (
        <div className="flex items-center gap-1.5">
          <a
            href={`tel:${phone}`}
            className="inline-flex rounded-md border border-zinc-300 bg-white px-3 py-1.5 text-xs font-medium text-zinc-700 hover:bg-zinc-50"
          >
            📞 電話
          </a>
          <a
            href={`sms:${phone}`}
            className="inline-flex rounded-md border border-zinc-300 bg-white px-3 py-1.5 text-xs font-medium text-zinc-700 hover:bg-zinc-50"
          >
            💬 SMS
          </a>
        </div>
      ) : (
        contactName && (
          <span className="text-xs text-zinc-400">電話番号未登録（{contactName}）</span>
        )
      )}
    </div>
  )
}

// ── ① 入力遅延 ────────────────────────────────────────────

function MissingInputSection({
  rows,
  onMarkAbsent,
  onResendEmail,
}: {
  rows: MissingInputRow[]
  onMarkAbsent: (scheduleId: string, name: string) => void
  onResendEmail: (row: MissingInputRow) => void
}) {
  return (
    <AlertSection icon="🔴" title="入力遅延（未入力検知）" count={rows.length} color="red">
      <div className="space-y-2">
        {rows.map(r => (
          <div
            key={r.scheduleId}
            className="rounded-lg border border-zinc-100 bg-zinc-50 px-3 py-2 text-sm"
          >
            <div>
              <span className="font-medium text-zinc-900">{r.contractorName}</span>
              <span className="mx-1.5 text-zinc-400">|</span>
              <span className="text-zinc-600">{r.projectName}</span>
              <span className="mx-1.5 text-zinc-400">|</span>
              <span className="tabular-nums text-zinc-500">{r.date}</span>
              {r.emailStatus === 'failed' && (
                <span className="ml-2 inline-flex rounded-full bg-rose-100 px-1.5 py-0.5 text-[10px] font-medium text-rose-700">
                  ⚠️ 自動送信失敗
                </span>
              )}
            </div>
            <ActionRow
              phone={r.contractorPhone}
              contactName={r.contractorName}
              onConfirm={() => onMarkAbsent(r.scheduleId, r.contractorName)}
              confirmLabel="本日休みとして完了"
            />
            <div className="mt-2">
              <button
                type="button"
                onClick={() => onResendEmail(r)}
                className="inline-flex rounded-md border border-zinc-300 bg-white px-3 py-1.5 text-xs font-medium text-zinc-700 hover:bg-zinc-50"
              >
                📧 メール再送信
              </button>
            </div>
          </div>
        ))}
      </div>
    </AlertSection>
  )
}

// ── ② 重複の疑い ──────────────────────────────────────────

function isIdentical(a: WorkRecordRow, b: WorkRecordRow): boolean {
  return (
    a.startTime    === b.startTime   &&
    a.endTime      === b.endTime     &&
    a.pieceCount   === b.pieceCount  &&
    a.breakMinutes === b.breakMinutes
  )
}

function DuplicateSection({
  groups,
  onKeep,
}: {
  groups: DuplicateGroup[]
  onKeep: (keepId: string, deleteIds: string[]) => void
}) {
  return (
    <AlertSection icon="🔴" title="重複の疑い（二重登録検知）" count={groups.length} color="red">
      <div className="space-y-4">
        {groups.map((g, gi) => {
          const sorted = [...g.records].sort(
            (a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime()
          )
          const allIdentical = sorted.length >= 2 && sorted.every(r => isIdentical(r, sorted[0]))

          return (
            <div key={gi} className="rounded-lg border border-zinc-200 overflow-hidden">
              <div className="bg-zinc-50 px-3 py-2 text-xs font-semibold text-zinc-600 border-b border-zinc-200 flex items-center justify-between">
                <span>{g.contractorName} ／ {g.projectName} ／ {g.date}</span>
                {allIdentical && (
                  <span className="text-[10px] font-medium text-rose-600 bg-rose-50 border border-rose-200 rounded-full px-2 py-0.5">
                    内容が完全一致 → 後着削除を推奨
                  </span>
                )}
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 divide-y sm:divide-y-0 sm:divide-x divide-zinc-100">
                {sorted.map((rec, i) => {
                  const label = i === 0 ? '先着（正）' : '後着（削除候補）'
                  const labelCls = i === 0
                    ? 'text-emerald-700 bg-emerald-50 border-emerald-200'
                    : 'text-rose-700 bg-rose-50 border-rose-200'
                  return (
                    <div key={rec.id} className="px-3 py-3 text-sm space-y-2">
                      <span className={`inline-flex rounded-full border px-2 py-0.5 text-[10px] font-semibold ${labelCls}`}>
                        {label}
                      </span>
                      <div className="text-xs text-zinc-500">
                        登録: {new Date(rec.createdAt).toLocaleString('ja-JP', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' })}
                      </div>
                      {(rec.startTime || rec.endTime) && (
                        <div className="text-xs text-zinc-600">
                          {rec.startTime ?? '−'} 〜 {rec.endTime ?? '−'}
                          {rec.breakMinutes != null && ` 休憩 ${rec.breakMinutes}分`}
                        </div>
                      )}
                      {rec.pieceCount != null && (
                        <div className="text-xs text-zinc-600">{rec.pieceCount} 個</div>
                      )}
                      <ActionRow
                        onConfirm={() => onKeep(rec.id, sorted.filter(r => r.id !== rec.id).map(r => r.id))}
                        confirmLabel="このデータを残す"
                      />
                    </div>
                  )
                })}
              </div>
            </div>
          )
        })}
      </div>
    </AlertSection>
  )
}

// ── ③ 業務しきい値 ────────────────────────────────────────

function ThresholdSection({
  rows,
  onConfirm,
  onDelete,
}: {
  rows: ThresholdAlertRow[]
  onConfirm: (id: string) => void
  onDelete:  (id: string) => void
}) {
  return (
    <AlertSection icon="⚠️" title="業務しきい値（異常値警告）" count={rows.length} color="amber">
      <div className="space-y-2">
        {rows.map(r => (
          <div
            key={r.id}
            className="rounded-lg border border-zinc-100 bg-zinc-50 px-3 py-2 text-sm"
          >
            <div>
              <span className="font-medium text-zinc-900">{r.contractorName}</span>
              <span className="mx-1.5 text-zinc-400">|</span>
              <span className="text-zinc-600">{r.date}</span>
              <span className="mx-1.5 text-zinc-400">|</span>
              <span className="font-semibold text-amber-700">{r.reason}</span>
              <span className="ml-1.5 text-zinc-500">（{r.value}個）</span>
            </div>
            <ActionRow
              onConfirm={() => onConfirm(r.id)}
              onDelete={() => onDelete(r.id)}
            />
          </div>
        ))}
      </div>
    </AlertSection>
  )
}

// ── ④ インボイス警告 ─────────────────────────────────────

function InvoiceWarningSection({ rows }: { rows: InvoiceWarningRow[] }) {
  return (
    <AlertSection icon="⚠️" title="インボイス登録番号 要確認" count={rows.length} color="amber">
      <div className="space-y-2">
        {rows.map(r => (
          <div
            key={r.contractorId}
            className="rounded-lg border border-zinc-100 bg-zinc-50 px-3 py-2 text-sm"
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
            <p className="text-xs text-zinc-500 mt-1">
              取引先マスタ（/admin/partners）で登録番号を確認・修正してください。
            </p>
          </div>
        ))}
      </div>
    </AlertSection>
  )
}

// ── ⑤ 長期未承認通知書 ───────────────────────────────────

function PendingNoticeCard({
  r,
  onResendEmail,
}: {
  r: PendingNoticeRow
  onResendEmail: (row: PendingNoticeRow) => void
}) {
  const [open, setOpen] = useState(false)

  return (
    <div className="rounded-lg border border-zinc-200 overflow-hidden text-sm">
      {/* サマリー行（クリックで展開） */}
      <button
        type="button"
        onClick={() => setOpen(o => !o)}
        className="w-full flex items-center justify-between px-3 py-2 bg-zinc-50 hover:bg-zinc-100 transition-colors text-left"
      >
        <span className="flex items-center gap-2 flex-wrap">
          <span className="font-medium text-zinc-900">{r.contractorName}</span>
          <span className="text-zinc-400">|</span>
          <span className="text-zinc-600">{r.targetMonth}</span>
          <span className="text-zinc-400">|</span>
          <span className="font-semibold text-amber-700">{r.hoursElapsed}時間経過</span>
          {r.emailStatus === 'failed' && (
            <span className="inline-flex rounded-full bg-rose-100 px-1.5 py-0.5 text-[10px] font-medium text-rose-700">
              ⚠️ 自動送信失敗
            </span>
          )}
        </span>
        <span className="text-xs text-zinc-400 ml-2 shrink-0">{open ? '▲' : '▼'}</span>
      </button>

      {/* 展開詳細 */}
      {open && (
        <div className="border-t border-zinc-200 bg-white px-3 py-3 space-y-2">
          <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-xs">
            <dt className="text-zinc-400">ドライバー</dt>
            <dd className="font-medium text-zinc-900">{r.contractorName}</dd>
            <dt className="text-zinc-400">対象月</dt>
            <dd className="text-zinc-700">{r.targetMonth.slice(0, 7).replace('-', '年')}月</dd>
            <dt className="text-zinc-400">案件</dt>
            <dd className="text-zinc-700">
              {r.projectNames.length > 0 ? r.projectNames.join('・') : '－'}
            </dd>
            {r.email && (
              <>
                <dt className="text-zinc-400">メール</dt>
                <dd className="text-zinc-600 break-all">{r.email}</dd>
              </>
            )}
          </dl>
          <div className="flex flex-wrap items-center gap-2 pt-1">
            <a
              href={`/admin/billing?tab=payment&month=${r.targetMonth.slice(0, 7)}`}
              className="inline-flex rounded-md bg-amber-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-amber-700"
            >
              確認する →
            </a>
            {r.phone && (
              <>
                <a href={`tel:${r.phone}`} className="inline-flex rounded-md border border-zinc-300 bg-white px-3 py-1.5 text-xs font-medium text-zinc-700 hover:bg-zinc-50">
                  📞 電話
                </a>
                <a href={`sms:${r.phone}`} className="inline-flex rounded-md border border-zinc-300 bg-white px-3 py-1.5 text-xs font-medium text-zinc-700 hover:bg-zinc-50">
                  💬 SMS
                </a>
              </>
            )}
            {!r.phone && (
              <span className="text-xs text-zinc-400">電話番号未登録（{r.contractorName}）</span>
            )}
            <button
              type="button"
              onClick={() => onResendEmail(r)}
              className="inline-flex rounded-md border border-zinc-300 bg-white px-3 py-1.5 text-xs font-medium text-zinc-700 hover:bg-zinc-50"
            >
              📧 メール再送信
            </button>
          </div>
        </div>
      )}
    </div>
  )
}

function PendingNoticeSection({
  rows,
  onResendEmail,
}: {
  rows: PendingNoticeRow[]
  onResendEmail: (row: PendingNoticeRow) => void
}) {
  return (
    <AlertSection icon="⚠️" title="長期未承認（48時間超・支払通知書）" count={rows.length} color="amber">
      <div className="space-y-2">
        {rows.map(r => <PendingNoticeCard key={r.noticeId} r={r} onResendEmail={onResendEmail} />)}
      </div>
    </AlertSection>
  )
}

// ── 延滞請求書（督促・延滞管理） ────────────────────────
// ⚠️ コード内コメントの丸数字は既存の「⑥突発案件アラート」まで使用済みのため、
// 本セクションには丸数字を付けない（UIのtitle文言自体には元々丸数字は無いため実害なし）。

const yenAmount = (n: number) => `¥${n.toLocaleString('ja-JP')}`

function OverdueInvoiceSection({ rows }: { rows: OverdueInvoiceRow[] }) {
  return (
    <AlertSection icon="🔴" title="延滞請求書（入金予定日超過）" count={rows.length} color="red">
      <div className="space-y-2">
        {rows.map(r => (
          <div
            key={r.invoiceId}
            className="rounded-lg border border-zinc-100 bg-zinc-50 px-3 py-2 text-sm"
          >
            <div>
              <span className="font-medium text-zinc-900">{r.companyName}</span>
              <span className="mx-1.5 text-zinc-400">|</span>
              <span className="text-zinc-600">入金予定日 {r.dueDate}</span>
              <span className="mx-1.5 text-zinc-400">|</span>
              <span className="font-semibold text-rose-700">{r.daysOverdue}日超過</span>
              <span className="ml-1.5 text-zinc-500">（{yenAmount(r.totalAmount)}）</span>
              {r.emailStatus === 'failed' && (
                <span className="ml-2 inline-flex rounded-full bg-rose-100 px-1.5 py-0.5 text-[10px] font-medium text-rose-700">
                  ⚠️ 自動送信失敗
                </span>
              )}
            </div>
            <p className="text-xs text-zinc-500 mt-1">
              入金管理画面（/admin/sales）で入金状況を確認してください。
            </p>
          </div>
        ))}
      </div>
    </AlertSection>
  )
}

// ── ⑥ 突発案件アラート ──────────────────────────────────

function OffMasterSection({
  rows,
  onConfirm,
  onDelete,
}: {
  rows: Array<{ id: string; contractorName: string; date: string; jobName: string; phone?: string | null }>
  onConfirm: (id: string) => void
  onDelete:  (id: string) => void
}) {
  if (rows.length === 0) return null
  return (
    <AlertSection icon="🔴" title="突発案件（マスタ外報告）" count={rows.length} color="red">
      <div className="space-y-2">
        {rows.map(r => (
          <div
            key={r.id}
            className="rounded-lg border border-zinc-100 bg-zinc-50 px-3 py-2 text-sm"
          >
            <div>
              <span className="font-medium text-zinc-900">{r.contractorName}</span>
              <span className="mx-1.5 text-zinc-400">|</span>
              <span className="font-semibold text-rose-700">「{r.jobName}」</span>
              <span className="mx-1.5 text-zinc-400">|</span>
              <span className="tabular-nums text-zinc-500">{r.date}</span>
            </div>
            <p className="text-xs text-zinc-400 mt-0.5">
              マスタ未登録の案件です。内容確認後、正式登録またはマスタ追加を行ってください。
            </p>
            <ActionRow
              phone={r.phone}
              contactName={r.contractorName}
              onConfirm={() => onConfirm(r.id)}
              onDelete={() => onDelete(r.id)}
              confirmLabel="確認済み・完了"
            />
          </div>
        ))}
      </div>
    </AlertSection>
  )
}

// ================================================================
// DefensiveAlertPanel
// ================================================================

export default function DefensiveAlertPanel() {
  const [alerts,    setAlerts]    = useState<DefensiveAlerts | null>(null)
  const [loadErr,   setLoadErr]   = useState<string | null>(null)
  const [toast,     setToast]     = useState<{ msg: string; ok: boolean } | null>(null)
  const [isPending, startTransition] = useTransition()

  const showToast = useCallback((msg: string, ok: boolean) => {
    setToast({ msg, ok })
    setTimeout(() => setToast(null), 4000)
  }, [])

  const load = useCallback(async () => {
    const res = await getDefensiveAlerts()
    if (res.error) { setLoadErr(res.error); return }
    setAlerts(res.data)
    setLoadErr(null)
  }, [])

  useEffect(() => { void load() }, [load])

  if (!alerts || alerts.totalCount === 0) return null

  // ── ハンドラ ────────────────────────────────────────────

  function handleMarkAbsent(scheduleId: string, name: string) {
    if (!window.confirm(`「${name}」を「本日休み」に変更しますか？`)) return
    startTransition(async () => {
      const res = await updateScheduleStatus(scheduleId, 'absent')
      if (res.error) { setLoadErr(res.error); return }
      showToast('休みとして記録しました', true)
      await load()
    })
  }

  function handleKeepDuplicate(keepId: string, deleteIds: string[]) {
    const msg = deleteIds.length === 1
      ? 'このデータを残し、もう一方を削除しますか？'
      : `このデータを残し、他 ${deleteIds.length} 件を削除しますか？`
    if (!window.confirm(msg)) return
    startTransition(async () => {
      const res = await keepDuplicateRecord(keepId, deleteIds)
      if (res.error) { setLoadErr(res.error); return }
      showToast('重複データを解消しました', true)
      await load()
    })
  }

  function handleConfirmThreshold(id: string) {
    if (!window.confirm('目視確認のうえ、このレコードを承認しますか？')) return
    startTransition(async () => {
      const res = await reviewThresholdRecord('work_records', id)
      if (res.error) { setLoadErr(res.error); return }
      showToast('承認しました', true)
      await load()
    })
  }

  function handleDeleteRecord(id: string) {
    if (!window.confirm('このレコードを削除しますか？この操作は取り消せません。')) return
    startTransition(async () => {
      const res = await deleteAlertRecord('work_records', id)
      if (res.error) { setLoadErr(res.error); return }
      showToast('削除しました', true)
      await load()
    })
  }

  function handleResendMissingInputEmail(row: MissingInputRow) {
    if (!window.confirm(`「${row.contractorName}」へ入力依頼メールを送信しますか？`)) return
    startTransition(async () => {
      const res = await sendDefensiveAlertEmail({
        alertType:      'missing_input',
        contractorId:   row.contractorId,
        scheduleId:     row.scheduleId,
        contractorName: row.contractorName,
        projectName:    row.projectName,
        date:           row.date,
      })
      if (res.error) { setLoadErr(res.error); return }
      showToast('メールを送信しました', true)
      await load()
    })
  }

  function handleResendPendingNoticeEmail(row: PendingNoticeRow) {
    if (!window.confirm(`「${row.contractorName}」へ承認依頼メールを送信しますか？`)) return
    startTransition(async () => {
      const res = await sendDefensiveAlertEmail({
        alertType:      'pending_notice',
        contractorId:   row.contractorId,
        noticeId:       row.noticeId,
        contractorName: row.contractorName,
        targetMonth:    row.targetMonth,
      })
      if (res.error) { setLoadErr(res.error); return }
      showToast('メールを送信しました', true)
      await load()
    })
  }

  // 突発案件は threshold と同じ work_records なので同ハンドラを流用
  const offMasterRows = (alerts.thresholds ?? [])
    .filter((r: any) => r.isOffMaster)
    .map((r: any) => ({
      id:             r.id,
      contractorName: r.contractorName,
      date:           r.date,
      jobName:        r.offMasterJobName ?? '（案件名未入力）',
      phone:          r.phone ?? null,
    }))

  return (
    <div
      className="sticky top-0 z-20 rounded-xl border border-rose-200 bg-gradient-to-b from-rose-50 to-white p-4 space-y-3 shadow-md"
      role="alert"
      aria-live="polite"
    >
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-semibold text-rose-900 flex items-center gap-2">
          <span aria-hidden>🛡️</span>
          要対応アラート
          <span className="inline-flex items-center justify-center rounded-full bg-rose-600 px-2 py-0.5 text-xs font-bold text-white tabular-nums">
            {alerts.totalCount}
          </span>
        </h2>
        <button
          type="button"
          onClick={() => void load()}
          disabled={isPending}
          className="text-xs text-zinc-500 hover:text-zinc-700 disabled:opacity-40"
        >
          {isPending ? '更新中…' : '↺ 更新'}
        </button>
      </div>

      {toast && (
        <div className={`flex items-center justify-between rounded-lg px-3 py-2 text-xs font-medium ${
          toast.ok
            ? 'bg-emerald-50 text-emerald-700 border border-emerald-200'
            : 'bg-red-50 text-red-600 border border-red-200'
        }`}>
          <span>{toast.ok ? '✓ ' : '✗ '}{toast.msg}</span>
          <button type="button" onClick={() => setToast(null)} className="ml-3 opacity-60 hover:opacity-100">×</button>
        </div>
      )}

      {loadErr && (
        <p className="rounded-lg bg-red-50 px-3 py-2 text-xs text-red-600">{loadErr}</p>
      )}

      <OffMasterSection
        rows={offMasterRows}
        onConfirm={handleConfirmThreshold}
        onDelete={handleDeleteRecord}
      />

      <MissingInputSection
        rows={alerts.missingInputs}
        onMarkAbsent={handleMarkAbsent}
        onResendEmail={handleResendMissingInputEmail}
      />

      <DuplicateSection
        groups={alerts.duplicates}
        onKeep={handleKeepDuplicate}
      />

      <ThresholdSection
        rows={(alerts.thresholds ?? []).filter((r: any) => !r.isOffMaster)}
        onConfirm={handleConfirmThreshold}
        onDelete={handleDeleteRecord}
      />

      <InvoiceWarningSection rows={alerts.invoiceWarnings} />

      <PendingNoticeSection rows={alerts.pendingNotices} onResendEmail={handleResendPendingNoticeEmail} />

      <OverdueInvoiceSection rows={alerts.overdueInvoices} />
    </div>
  )
}
