'use client'

import { useState, useEffect, useCallback, useTransition, useMemo } from 'react'
import {
  fetchAdminMonthlySchedules,
  updateScheduleStatus,
  type AdminScheduleEntry,
  type AdminScheduleDisplayStatus,
} from '@/app/_actions/scheduleActions'

// ── ユーティリティ ────────────────────────────────────────

const WEEKDAYS = ['日', '月', '火', '水', '木', '金', '土'] as const

function currentYearMonth() {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
}

function shiftYearMonth(ym: string, delta: number) {
  const [y, m] = ym.split('-').map(Number)
  const d = new Date(y, m - 1 + delta, 1)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
}

function fmtMonth(ym: string) {
  const [y, m] = ym.split('-')
  return `${y}年${Number(m)}月`
}

function buildCalendarDays(yearMonth: string): (string | null)[] {
  const [y, m] = yearMonth.split('-').map(Number)
  const firstDay = new Date(y, m - 1, 1).getDay()
  const daysInMonth = new Date(y, m, 0).getDate()
  const cells: (string | null)[] = Array(firstDay).fill(null)
  for (let d = 1; d <= daysInMonth; d++) {
    cells.push(`${yearMonth}-${String(d).padStart(2, '0')}`)
  }
  while (cells.length % 7 !== 0) cells.push(null)
  return cells
}

function todayISO() {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

const STATUS_LABEL: Record<AdminScheduleDisplayStatus, { label: string; cls: string }> = {
  scheduled: { label: '予定', cls: 'bg-blue-100 text-blue-800' },
  absent:    { label: '休み', cls: 'bg-zinc-200 text-zinc-600' },
  worked:    { label: '実績済', cls: 'bg-emerald-100 text-emerald-800' },
}

// ── ステータス変更ダイアログ ──────────────────────────────

function ScheduleEditDialog({
  entry,
  onClose,
  onUpdated,
}: {
  entry: AdminScheduleEntry
  onClose: () => void
  onUpdated: () => void
}) {
  const [isPending, startTransition] = useTransition()
  const [error, setError] = useState<string | null>(null)

  function handleStatusChange(status: 'scheduled' | 'absent') {
    const label = status === 'absent' ? '本日休み（absent）' : '稼働予定（scheduled）'
    if (!window.confirm(`${entry.contractorName} の ${entry.date} を「${label}」に変更しますか？`)) return

    startTransition(async () => {
      const res = await updateScheduleStatus(entry.scheduleId, status)
      if (res.error) {
        setError(res.error)
        return
      }
      onUpdated()
      onClose()
    })
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
            onClick={() => handleStatusChange('absent')}
            className="py-3.5 text-sm font-medium text-zinc-700 hover:bg-zinc-50 disabled:opacity-40 border-r border-zinc-100"
          >
            本日休み
          </button>
          <button
            type="button"
            disabled={isPending || entry.status === 'scheduled'}
            onClick={() => handleStatusChange('scheduled')}
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

// ── 1日セル内のドライバー行 ────────────────────────────────

function DriverChip({
  entry,
  onSelect,
}: {
  entry: AdminScheduleEntry
  onSelect: (entry: AdminScheduleEntry) => void
}) {
  const st = STATUS_LABEL[entry.displayStatus]

  return (
    <button
      type="button"
      onClick={() => onSelect(entry)}
      className={`w-full text-left rounded-md px-1.5 py-1 text-[11px] leading-tight border transition hover:ring-1 hover:ring-zinc-300 ${
        entry.isMissingInput
          ? 'border-rose-300 bg-rose-50'
          : 'border-zinc-200 bg-white'
      }`}
    >
      <span className="font-medium text-zinc-800 truncate block">{entry.contractorName}</span>
      <span className="flex items-center gap-1 mt-0.5 flex-wrap">
        <span className={`inline-flex rounded px-1 py-px text-[10px] font-medium ${st.cls}`}>
          {st.label}
        </span>
        {entry.isMissingInput && (
          <span className="inline-flex rounded bg-rose-600 px-1 py-px text-[10px] font-bold text-white">
            未入力
          </span>
        )}
      </span>
    </button>
  )
}

// ── メインページ ──────────────────────────────────────────

export default function AdminSchedulesPage() {
  const [yearMonth, setYearMonth] = useState(currentYearMonth)
  const [entries,   setEntries]   = useState<AdminScheduleEntry[]>([])
  const [loading,   setLoading]   = useState(true)
  const [error,     setError]     = useState<string | null>(null)
  const [selected,  setSelected]  = useState<AdminScheduleEntry | null>(null)

  const today = todayISO()

  const load = useCallback(async (ym: string) => {
    setLoading(true)
    setError(null)
    const res = await fetchAdminMonthlySchedules(ym)
    if (res.error) {
      setError(res.error)
      setEntries([])
    } else {
      setEntries(res.data ?? [])
    }
    setLoading(false)
  }, [])

  useEffect(() => {
    void load(yearMonth)
  }, [load, yearMonth])

  const byDate = useMemo(() => {
    const map = new Map<string, AdminScheduleEntry[]>()
    for (const e of entries) {
      const list = map.get(e.date) ?? []
      list.push(e)
      map.set(e.date, list)
    }
    return map
  }, [entries])

  const missingCount = entries.filter(e => e.isMissingInput).length
  const calendarDays = buildCalendarDays(yearMonth)

  return (
    <div className="min-h-screen bg-zinc-50">
      <div className="mx-auto max-w-6xl px-4 sm:px-6 py-8">

        {/* ヘッダー */}
        <div className="flex flex-wrap items-center justify-between gap-4 mb-6">
          <div>
            <h1 className="text-xl font-semibold text-zinc-900">配車＆予定管理</h1>
            <p className="text-sm text-zinc-500 mt-0.5">全ドライバーの稼働予定を俯瞰・操作</p>
          </div>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => setYearMonth(ym => shiftYearMonth(ym, -1))}
              className="rounded-md border border-zinc-300 bg-white px-3 py-1.5 text-sm text-zinc-700 hover:bg-zinc-50"
            >
              ← 前月
            </button>
            <span className="min-w-[7rem] text-center text-sm font-semibold text-zinc-900 tabular-nums">
              {fmtMonth(yearMonth)}
            </span>
            <button
              type="button"
              onClick={() => setYearMonth(ym => shiftYearMonth(ym, 1))}
              className="rounded-md border border-zinc-300 bg-white px-3 py-1.5 text-sm text-zinc-700 hover:bg-zinc-50"
            >
              次月 →
            </button>
          </div>
        </div>

        {/* サマリー */}
        <div className="flex flex-wrap gap-3 mb-6">
          <div className="rounded-lg border border-zinc-200 bg-white px-4 py-2 text-sm">
            <span className="text-zinc-500">予定件数 </span>
            <span className="font-bold text-zinc-900 tabular-nums">{entries.length}</span>
          </div>
          {missingCount > 0 && (
            <div className="rounded-lg border border-rose-200 bg-rose-50 px-4 py-2 text-sm">
              <span className="text-rose-700 font-semibold">未入力 {missingCount} 件</span>
              <span className="text-rose-600 ml-2 text-xs">（DefensiveAlertPanel と同期）</span>
            </div>
          )}
        </div>

        {error && (
          <p className="mb-4 rounded-lg bg-red-50 px-4 py-2 text-sm text-red-600">{error}</p>
        )}

        {loading ? (
          <div className="py-24 text-center text-sm text-zinc-400">読み込み中...</div>
        ) : (
          <div className="rounded-xl border border-zinc-200 bg-white overflow-hidden shadow-sm">
            {/* 曜日ヘッダー */}
            <div className="grid grid-cols-7 border-b border-zinc-200 bg-zinc-50">
              {WEEKDAYS.map((wd, i) => (
                <div
                  key={wd}
                  className={`py-2 text-center text-xs font-semibold ${
                    i === 0 ? 'text-rose-500' : i === 6 ? 'text-blue-500' : 'text-zinc-500'
                  }`}
                >
                  {wd}
                </div>
              ))}
            </div>

            {/* カレンダーグリッド */}
            <div className="grid grid-cols-7 divide-x divide-y divide-zinc-100">
              {calendarDays.map((date, idx) => {
                const dayEntries = date ? (byDate.get(date) ?? []) : []
                const isToday = date === today
                const dayNum = date ? parseInt(date.split('-')[2], 10) : null

                return (
                  <div
                    key={idx}
                    className={`min-h-[7rem] p-1.5 ${
                      date ? 'bg-white' : 'bg-zinc-50/50'
                    } ${isToday ? 'ring-2 ring-inset ring-blue-400' : ''}`}
                  >
                    {date && dayNum != null && (
                      <>
                        <div className={`text-xs font-semibold mb-1 tabular-nums ${
                          isToday ? 'text-blue-600' : 'text-zinc-500'
                        }`}>
                          {dayNum}
                        </div>
                        <div className="space-y-1">
                          {dayEntries.length === 0 ? (
                            <p className="text-[10px] text-zinc-300 px-1">—</p>
                          ) : (
                            dayEntries.map(e => (
                              <DriverChip
                                key={e.scheduleId}
                                entry={e}
                                onSelect={setSelected}
                              />
                            ))
                          )}
                        </div>
                      </>
                    )}
                  </div>
                )
              })}
            </div>
          </div>
        )}

        {/* 凡例 */}
        <div className="mt-4 flex flex-wrap items-center gap-4 text-xs text-zinc-500">
          {Object.entries(STATUS_LABEL).map(([key, { label, cls }]) => (
            <span key={key} className="flex items-center gap-1.5">
              <span className={`inline-flex rounded px-1.5 py-0.5 font-medium ${cls}`}>{label}</span>
            </span>
          ))}
          <span className="flex items-center gap-1.5">
            <span className="inline-flex rounded bg-rose-600 px-1.5 py-0.5 font-bold text-white">未入力</span>
            <span>予定あり・実績なし（本日以前）</span>
          </span>
        </div>
      </div>

      {selected && (
        <ScheduleEditDialog
          entry={selected}
          onClose={() => setSelected(null)}
          onUpdated={() => void load(yearMonth)}
        />
      )}
    </div>
  )
}
