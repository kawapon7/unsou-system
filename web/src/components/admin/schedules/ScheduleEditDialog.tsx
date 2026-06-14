'use client'

import { useState } from 'react'
import { updateScheduleStatus, type AdminScheduleEntry } from '@/app/_actions/scheduleActions'
import { STATUS_LABEL } from './constants'

type ScheduleEditDialogProps = {
  entry:     AdminScheduleEntry
  onClose:   () => void
  onUpdated: () => void
}

export function ScheduleEditDialog({ entry, onClose, onUpdated }: ScheduleEditDialogProps) {
  const [isPending, setIsPending] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function handleStatusChange(status: 'scheduled' | 'absent') {
    const label = status === 'absent' ? '本日休み（absent）' : '稼働予定（scheduled）'
    if (!window.confirm(`${entry.contractorName} の ${entry.date} を「${label}」に変更しますか？`)) return

    setIsPending(true)
    const res = await updateScheduleStatus(entry.scheduleId, status)
    setIsPending(false)
    if (res.error) {
      setError(res.error)
      return
    }
    onUpdated()
    onClose()
  }

  const st = STATUS_LABEL[entry.displayStatus]

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/40 px-4">
      <div className="w-full max-w-sm rounded-2xl bg-white shadow-2xl overflow-hidden">
        <div className="px-5 pt-6 pb-4 space-y-3">
          <h3 className="font-bold text-zinc-900 text-base">予定ステータス変更</h3>
          <div className="text-sm text-zinc-600 space-y-1">
            <p><span className="text-zinc-400">ドライバー</span> {entry.contractorName}</p>
            <p><span className="text-zinc-400">案件</span> {entry.projectName}</p>
            <p><span className="text-zinc-400">日付</span> {entry.date}</p>
            <p className="flex items-center gap-2">
              <span className="text-zinc-400">現在</span>
              <span className={`inline-flex rounded-full px-2 py-0.5 text-xs font-medium ${st.cls}`}>
                {st.label}
              </span>
              {entry.isMissingInput && (
                <span className="inline-flex rounded-full bg-rose-100 px-2 py-0.5 text-xs font-bold text-rose-700">
                  未入力
                </span>
              )}
            </p>
          </div>
          {error && <p className="text-xs text-red-600">{error}</p>}
        </div>
        <div className="grid grid-cols-2 border-t border-zinc-100">
          <button
            type="button"
            disabled={isPending || entry.status === 'absent'}
            onClick={() => void handleStatusChange('absent')}
            className="py-3.5 text-sm font-medium text-zinc-700 hover:bg-zinc-50 disabled:opacity-40 border-r border-zinc-100"
          >
            本日休み
          </button>
          <button
            type="button"
            disabled={isPending || entry.status === 'scheduled'}
            onClick={() => void handleStatusChange('scheduled')}
            className="py-3.5 text-sm font-medium text-blue-700 hover:bg-blue-50 disabled:opacity-40"
          >
            稼働予定に戻す
          </button>
        </div>
        <button
          type="button"
          onClick={onClose}
          className="w-full py-3 text-sm text-zinc-500 border-t border-zinc-100 hover:bg-zinc-50"
        >
          キャンセル
        </button>
      </div>
    </div>
  )
}
