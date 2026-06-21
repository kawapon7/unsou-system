'use client'

import { useState, useEffect, useCallback, useMemo } from 'react'
import {
  fetchAdminMonthlySchedules,
  type AdminScheduleEntry,
} from '@/app/_actions/scheduleActions'
import {
  CalendarLegend,
  CalendarNavigation,
  DayView,
  MonthView,
  ScheduleEditDialog,
  ViewModeTabs,
  WeekView,
  groupEntriesByDate,
  navigateDate,
  todayISO,
  visibleRange,
  yearMonthOf,
  yearMonthsInRange,
  type ViewMode,
} from '@/components/admin/schedules'

export default function AdminSchedulesPage() {
  const [viewMode,    setViewMode]    = useState<ViewMode>('month')
  const [currentDate, setCurrentDate] = useState(todayISO)
  const [entries,     setEntries]     = useState<AdminScheduleEntry[]>([])
  const [loading,     setLoading]     = useState(true)
  const [error,       setError]       = useState<string | null>(null)
  const [selected,    setSelected]    = useState<AdminScheduleEntry | null>(null)

  const today = todayISO()
  const range = useMemo(
    () => visibleRange(currentDate, viewMode),
    [currentDate, viewMode],
  )

  const loadForRange = useCallback(async (from: string, to: string) => {
    setLoading(true)
    setError(null)

    const months  = yearMonthsInRange(from, to)
    const results = await Promise.all(months.map(m => fetchAdminMonthlySchedules(m)))

    const firstErr = results.find(r => r.error)?.error
    if (firstErr) {
      setError(firstErr)
      setEntries([])
      setLoading(false)
      return
    }

    const merged = new Map<string, AdminScheduleEntry>()
    for (const res of results) {
      for (const e of res.data ?? []) {
        merged.set(e.scheduleId, e)
      }
    }
    setEntries([...merged.values()])
    setLoading(false)
  }, [])

  useEffect(() => {
    void loadForRange(range.from, range.to)
  }, [loadForRange, range.from, range.to])

  const byDate = useMemo(() => groupEntriesByDate(entries), [entries])

  const visibleEntries = useMemo(
    () => entries.filter(e => e.date >= range.from && e.date <= range.to),
    [entries, range.from, range.to],
  )

  const missingCount = visibleEntries.filter(e => e.isMissingInput).length

  function handleNavigate(delta: -1 | 1) {
    setCurrentDate(d => navigateDate(d, viewMode, delta))
  }

  function handleUpdated() {
    void loadForRange(range.from, range.to)
  }

  return (
    <div className="min-h-screen bg-zinc-50">
      <div className="mx-auto max-w-6xl px-4 sm:px-6 py-8">

        <div className="flex flex-wrap items-start justify-between gap-4 mb-4">
          <div>
            <h1 className="text-xl font-semibold text-zinc-900">配車＆予定管理</h1>
            <p className="text-sm text-zinc-500 mt-0.5">全ドライバーの稼働予定を俯瞰・操作</p>
          </div>
          <ViewModeTabs viewMode={viewMode} onChange={setViewMode} />
        </div>

        <CalendarNavigation
          currentDate={currentDate}
          viewMode={viewMode}
          onPrev={() => handleNavigate(-1)}
          onNext={() => handleNavigate(1)}
          onToday={() => setCurrentDate(todayISO())}
        />

        <div className="flex flex-wrap gap-3 mb-6">
          <div className="rounded-lg border border-zinc-200 bg-white px-4 py-2 text-sm">
            <span className="text-zinc-500">表示範囲の予定 </span>
            <span className="font-bold text-zinc-900 tabular-nums">{visibleEntries.length}</span>
          </div>
          {missingCount > 0 && (
            <div className="rounded-lg border border-rose-200 bg-rose-50 px-4 py-2 text-sm">
              <span className="text-rose-700 font-semibold">未入力 {missingCount} 件</span>
            </div>
          )}
        </div>

        {error && (
          <p className="mb-4 rounded-lg bg-red-50 px-4 py-2 text-sm text-red-600">{error}</p>
        )}

        {loading ? (
          <div className="py-24 text-center text-sm text-zinc-400">読み込み中...</div>
        ) : (
          <>
            {viewMode === 'month' && (
              <MonthView
                yearMonth={yearMonthOf(currentDate)}
                byDate={byDate}
                today={today}
                onSelect={setSelected}
              />
            )}
            {viewMode === 'week' && (
              <WeekView
                dates={range.dates}
                byDate={byDate}
                today={today}
                onSelect={setSelected}
              />
            )}
            {viewMode === 'day' && (
              <DayView
                date={currentDate}
                entries={byDate.get(currentDate) ?? []}
                onSelect={setSelected}
              />
            )}
          </>
        )}

        <CalendarLegend />
      </div>

      {selected && (
        <ScheduleEditDialog
          entry={selected}
          onClose={() => setSelected(null)}
          onUpdated={handleUpdated}
        />
      )}
    </div>
  )
}
