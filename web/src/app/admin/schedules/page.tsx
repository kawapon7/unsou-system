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
  dateForYearMonth,
  groupEntriesByDate,
  navigateDate,
  todayISO,
  visibleRange,
  yearMonthOf,
  yearMonthsInRange,
  type ViewMode,
} from '@/components/admin/schedules'
import { useMonth } from '@/contexts/MonthContext'

export default function AdminSchedulesPage() {
  // サイドバーの「対象年月」と双方向で同期する（片方向だと画面を移った瞬間に月が戻って見える）。
  const { yearMonth, setYearMonth } = useMonth()
  const [viewMode,    setViewMode]    = useState<ViewMode>('month')
  const [pickedDate,  setPickedDate]  = useState(todayISO)
  const [entries,     setEntries]     = useState<AdminScheduleEntry[]>([])
  const [loading,     setLoading]     = useState(true)
  const [error,       setError]       = useState<string | null>(null)
  const [selected,    setSelected]    = useState<AdminScheduleEntry | null>(null)

  const today = todayISO()

  // 表示日付はサイドバーの対象年月から**派生**させる（stateを2つ持って同期させない）。
  // ⚠️ useEffect でstateを書き換える形にすると、React が警告するカスケード再描画になり、
  //    さらに「押し戻し」と往復して日付が1日に戻る事故が起きる。派生ならその余地が無い。
  //    月が一致していれば pickedDate がそのまま返るので、週・日表示で見ている日は保たれる。
  const currentDate = dateForYearMonth(yearMonth, pickedDate, today)
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

  // カレンダー → サイドバー。日付を動かす経路はすべてここを通す
  // （setPickedDate を直接呼ぶとサイドバーへの押し戻しが漏れ、月表示が食い違う）。
  function goToDate(next: string) {
    setPickedDate(next)
    setYearMonth(yearMonthOf(next))
  }

  function handleNavigate(delta: -1 | 1) {
    goToDate(navigateDate(currentDate, viewMode, delta))
  }

  function handleUpdated() {
    void loadForRange(range.from, range.to)
  }

  return (
    <div className="min-h-screen bg-zinc-50">
      <div className="mx-auto max-w-6xl px-4 sm:px-6 py-8">

        <div className="flex flex-wrap items-start justify-between gap-4 mb-4">
          <div>
            <h1 className="text-xl font-semibold text-zinc-900">案件カレンダー</h1>
            <p className="text-sm text-zinc-500 mt-0.5">全ドライバーの稼働予定を俯瞰・操作</p>
          </div>
          <ViewModeTabs viewMode={viewMode} onChange={setViewMode} />
        </div>

        <CalendarNavigation
          currentDate={currentDate}
          viewMode={viewMode}
          onPrev={() => handleNavigate(-1)}
          onNext={() => handleNavigate(1)}
          onToday={() => goToDate(todayISO())}
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
