'use client'

import { useState, useEffect, useCallback, useMemo } from 'react'
import {
  fetchAdminMonthlySchedules,
  updateScheduleStatus,
  type AdminScheduleEntry,
  type AdminScheduleDisplayStatus,
} from '@/app/_actions/scheduleActions'

// ── 型 ────────────────────────────────────────────────────

type ViewMode = 'month' | 'week' | 'day'

// ── ユーティリティ ────────────────────────────────────────

const WEEKDAYS = ['日', '月', '火', '水', '木', '金', '土'] as const

function toISO(d: Date) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

function todayISO() {
  return toISO(new Date())
}

function parseISO(date: string) {
  const [y, m, d] = date.split('-').map(Number)
  return new Date(y, m - 1, d)
}

function addDays(date: string, delta: number) {
  const d = parseISO(date)
  d.setDate(d.getDate() + delta)
  return toISO(d)
}

function addMonths(date: string, delta: number) {
  const d = parseISO(date)
  d.setMonth(d.getMonth() + delta)
  return toISO(d)
}

function yearMonthOf(date: string) {
  return date.slice(0, 7)
}

function fmtMonth(ym: string) {
  const [y, m] = ym.split('-')
  return `${y}年${Number(m)}月`
}

function fmtDate(date: string, withWeekday = false) {
  const d = parseISO(date)
  const base = `${d.getFullYear()}年${d.getMonth() + 1}月${d.getDate()}日`
  return withWeekday ? `${base}（${WEEKDAYS[d.getDay()]}）` : base
}

function fmtShortDate(date: string) {
  const d = parseISO(date)
  return `${d.getMonth() + 1}/${d.getDate()}`
}

function startOfWeek(date: string) {
  const d = parseISO(date)
  d.setDate(d.getDate() - d.getDay())
  return toISO(d)
}

function endOfWeek(date: string) {
  return addDays(startOfWeek(date), 6)
}

function buildMonthGrid(yearMonth: string): (string | null)[] {
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

function yearMonthsInRange(from: string, to: string): string[] {
  const months = new Set([yearMonthOf(from), yearMonthOf(to)])
  return [...months]
}

function navigateAnchor(date: string, viewMode: ViewMode, delta: -1 | 1): string {
  if (viewMode === 'month') return addMonths(date, delta)
  if (viewMode === 'week')  return addDays(date, delta * 7)
  return addDays(date, delta)
}

function navLabel(date: string, viewMode: ViewMode): string {
  if (viewMode === 'month') return fmtMonth(yearMonthOf(date))
  if (viewMode === 'week') {
    const from = startOfWeek(date)
    const to   = endOfWeek(date)
    if (yearMonthOf(from) === yearMonthOf(to)) {
      return `${fmtMonth(yearMonthOf(from))} ${fmtShortDate(from)} 〜 ${fmtShortDate(to)}`
    }
    return `${fmtShortDate(from)} 〜 ${fmtShortDate(to)}`
  }
  return fmtDate(date, true)
}

function visibleRange(date: string, viewMode: ViewMode): { from: string; to: string; dates: string[] } {
  if (viewMode === 'month') {
    const ym = yearMonthOf(date)
    const [y, m] = ym.split('-').map(Number)
    const from = `${ym}-01`
    const to   = toISO(new Date(y, m, 0))
    const dates = buildMonthGrid(ym).filter((d): d is string => d != null)
    return { from, to, dates }
  }
  if (viewMode === 'week') {
    const from  = startOfWeek(date)
    const dates = Array.from({ length: 7 }, (_, i) => addDays(from, i))
    return { from, to: dates[6], dates }
  }
  return { from: date, to: date, dates: [date] }
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

// ── ドライバー行 ──────────────────────────────────────────

function DriverChip({
  entry,
  onSelect,
  size = 'sm',
}: {
  entry: AdminScheduleEntry
  onSelect: (entry: AdminScheduleEntry) => void
  size?: 'sm' | 'md'
}) {
  const st = STATUS_LABEL[entry.displayStatus]
  const textSize = size === 'md' ? 'text-sm' : 'text-[11px]'
  const badgeSize = size === 'md' ? 'text-xs' : 'text-[10px]'

  return (
    <button
      type="button"
      onClick={() => onSelect(entry)}
      className={`w-full text-left rounded-md px-2 py-1.5 ${textSize} leading-tight border transition hover:ring-1 hover:ring-zinc-300 ${
        entry.isMissingInput
          ? 'border-rose-300 bg-rose-50'
          : 'border-zinc-200 bg-white'
      }`}
    >
      <span className="font-medium text-zinc-800 truncate block">{entry.contractorName}</span>
      {size === 'md' && (
        <span className="text-zinc-500 truncate block text-xs mt-0.5">{entry.projectName}</span>
      )}
      <span className="flex items-center gap-1 mt-0.5 flex-wrap">
        <span className={`inline-flex rounded px-1 py-px ${badgeSize} font-medium ${st.cls}`}>
          {st.label}
        </span>
        {entry.isMissingInput && (
          <span className={`inline-flex rounded bg-rose-600 px-1 py-px ${badgeSize} font-bold text-white`}>
            未入力
          </span>
        )}
      </span>
    </button>
  )
}

function DayCell({
  date,
  entries,
  today,
  onSelect,
  minHeight = 'min-h-[7rem]',
}: {
  date: string
  entries: AdminScheduleEntry[]
  today: string
  onSelect: (entry: AdminScheduleEntry) => void
  minHeight?: string
}) {
  const isToday = date === today
  const dayNum  = parseInt(date.split('-')[2], 10)
  const dow     = parseISO(date).getDay()

  return (
    <div
      className={`${minHeight} p-1.5 bg-white ${isToday ? 'ring-2 ring-inset ring-blue-400' : ''}`}
    >
      <div className={`text-xs font-semibold mb-1 tabular-nums ${
        isToday ? 'text-blue-600' : dow === 0 ? 'text-rose-500' : dow === 6 ? 'text-blue-500' : 'text-zinc-500'
      }`}>
        {dayNum}
      </div>
      <div className="space-y-1">
        {entries.length === 0 ? (
          <p className="text-[10px] text-zinc-300 px-1">—</p>
        ) : (
          entries.map(e => (
            <DriverChip key={e.scheduleId} entry={e} onSelect={onSelect} />
          ))
        )}
      </div>
    </div>
  )
}

// ── 月表示 ────────────────────────────────────────────────

function MonthView({
  yearMonth,
  byDate,
  today,
  onSelect,
}: {
  yearMonth: string
  byDate: Map<string, AdminScheduleEntry[]>
  today: string
  onSelect: (entry: AdminScheduleEntry) => void
}) {
  const cells = buildMonthGrid(yearMonth)

  return (
    <div className="rounded-xl border border-zinc-200 bg-white overflow-hidden shadow-sm">
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
      <div className="grid grid-cols-7 divide-x divide-y divide-zinc-100">
        {cells.map((date, idx) =>
          date ? (
            <DayCell
              key={date}
              date={date}
              entries={byDate.get(date) ?? []}
              today={today}
              onSelect={onSelect}
            />
          ) : (
            <div key={`empty-${idx}`} className="min-h-[7rem] bg-zinc-50/50" />
          ),
        )}
      </div>
    </div>
  )
}

// ── 週表示 ────────────────────────────────────────────────

function WeekView({
  dates,
  byDate,
  today,
  onSelect,
}: {
  dates: string[]
  byDate: Map<string, AdminScheduleEntry[]>
  today: string
  onSelect: (entry: AdminScheduleEntry) => void
}) {
  return (
    <div className="rounded-xl border border-zinc-200 bg-white overflow-hidden shadow-sm">
      <div className="grid grid-cols-7 border-b border-zinc-200 bg-zinc-50">
        {dates.map((date, i) => {
          const dow = parseISO(date).getDay()
          return (
            <div
              key={date}
              className={`py-2 text-center text-xs font-semibold ${
                dow === 0 ? 'text-rose-500' : dow === 6 ? 'text-blue-500' : 'text-zinc-500'
              }`}
            >
              {WEEKDAYS[dow]}
              <span className="block text-[10px] font-normal tabular-nums mt-0.5">
                {fmtShortDate(date)}
              </span>
            </div>
          )
        })}
      </div>
      <div className="grid grid-cols-7 divide-x divide-zinc-100">
        {dates.map(date => (
          <DayCell
            key={date}
            date={date}
            entries={byDate.get(date) ?? []}
            today={today}
            onSelect={onSelect}
            minHeight="min-h-[10rem]"
          />
        ))}
      </div>
    </div>
  )
}

// ── 日表示 ────────────────────────────────────────────────

function DayView({
  date,
  entries,
  onSelect,
}: {
  date: string
  entries: AdminScheduleEntry[]
  onSelect: (entry: AdminScheduleEntry) => void
}) {
  const missing  = entries.filter(e => e.isMissingInput)
  const scheduled = entries.filter(e => e.displayStatus === 'scheduled' && !e.isMissingInput)
  const absent   = entries.filter(e => e.displayStatus === 'absent')
  const worked   = entries.filter(e => e.displayStatus === 'worked')

  function Section({
    title, items, accent,
  }: {
    title: string
    items: AdminScheduleEntry[]
    accent?: string
  }) {
    if (!items.length) return null
    return (
      <section className="space-y-2">
        <h3 className={`text-sm font-semibold ${accent ?? 'text-zinc-700'}`}>
          {title}（{items.length}）
        </h3>
        <div className="space-y-2">
          {items.map(e => (
            <DriverChip key={e.scheduleId} entry={e} onSelect={onSelect} size="md" />
          ))}
        </div>
      </section>
    )
  }

  return (
    <div className="rounded-xl border border-zinc-200 bg-white p-5 shadow-sm space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-zinc-100 pb-4">
        <h2 className="text-lg font-bold text-zinc-900">{fmtDate(date, true)}</h2>
        <div className="flex flex-wrap gap-2 text-xs">
          <span className="rounded-full bg-rose-100 text-rose-700 px-2.5 py-1 font-medium">
            未入力 {missing.length}
          </span>
          <span className="rounded-full bg-blue-100 text-blue-800 px-2.5 py-1 font-medium">
            予定 {scheduled.length}
          </span>
          <span className="rounded-full bg-zinc-200 text-zinc-600 px-2.5 py-1 font-medium">
            休み {absent.length}
          </span>
          <span className="rounded-full bg-emerald-100 text-emerald-800 px-2.5 py-1 font-medium">
            実績済 {worked.length}
          </span>
        </div>
      </div>

      {entries.length === 0 ? (
        <p className="py-12 text-center text-sm text-zinc-400">この日の予定はありません</p>
      ) : (
        <div className="space-y-6">
          <Section title="🔴 入力遅延（未入力）" items={missing} accent="text-rose-700" />
          <Section title="予定（未実績）" items={scheduled} />
          <Section title="休み" items={absent} />
          <Section title="実績済" items={worked} />
        </div>
      )}
    </div>
  )
}

// ── 表示モードタブ ────────────────────────────────────────

const VIEW_MODES: { id: ViewMode; label: string }[] = [
  { id: 'month', label: '月' },
  { id: 'week',  label: '週' },
  { id: 'day',   label: '日' },
]

function ViewModeTabs({
  viewMode,
  onChange,
}: {
  viewMode: ViewMode
  onChange: (mode: ViewMode) => void
}) {
  return (
    <div className="inline-flex rounded-lg border border-zinc-200 bg-zinc-100 p-0.5">
      {VIEW_MODES.map(({ id, label }) => (
        <button
          key={id}
          type="button"
          onClick={() => onChange(id)}
          className={`rounded-md px-4 py-1.5 text-sm font-medium transition ${
            viewMode === id
              ? 'bg-white text-zinc-900 shadow-sm'
              : 'text-zinc-500 hover:text-zinc-700'
          }`}
        >
          {label}
        </button>
      ))}
    </div>
  )
}

// ── メインページ ──────────────────────────────────────────

export default function AdminSchedulesPage() {
  const [viewMode,   setViewMode]   = useState<ViewMode>('month')
  const [anchorDate, setAnchorDate] = useState(todayISO)
  const [entries,    setEntries]    = useState<AdminScheduleEntry[]>([])
  const [loading,    setLoading]    = useState(true)
  const [error,      setError]      = useState<string | null>(null)
  const [selected,   setSelected]   = useState<AdminScheduleEntry | null>(null)

  const today  = todayISO()
  const range  = useMemo(() => visibleRange(anchorDate, viewMode), [anchorDate, viewMode])

  const loadForRange = useCallback(async (from: string, to: string) => {
    setLoading(true)
    setError(null)

    const months = yearMonthsInRange(from, to)
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

  const byDate = useMemo(() => {
    const map = new Map<string, AdminScheduleEntry[]>()
    for (const e of entries) {
      const list = map.get(e.date) ?? []
      list.push(e)
      map.set(e.date, list)
    }
    return map
  }, [entries])

  const visibleEntries = useMemo(
    () => entries.filter(e => e.date >= range.from && e.date <= range.to),
    [entries, range.from, range.to],
  )

  const missingCount = visibleEntries.filter(e => e.isMissingInput).length

  function handleNavigate(delta: -1 | 1) {
    setAnchorDate(d => navigateAnchor(d, viewMode, delta))
  }

  function handleViewModeChange(mode: ViewMode) {
    setViewMode(mode)
  }

  const prevLabel = viewMode === 'month' ? '前月' : viewMode === 'week' ? '前週' : '前日'
  const nextLabel = viewMode === 'month' ? '次月' : viewMode === 'week' ? '次週' : '次日'

  return (
    <div className="min-h-screen bg-zinc-50">
      <div className="mx-auto max-w-6xl px-4 sm:px-6 py-8">

        {/* ヘッダー */}
        <div className="flex flex-wrap items-start justify-between gap-4 mb-4">
          <div>
            <h1 className="text-xl font-semibold text-zinc-900">配車＆予定管理</h1>
            <p className="text-sm text-zinc-500 mt-0.5">全ドライバーの稼働予定を俯瞰・操作</p>
          </div>
          <ViewModeTabs viewMode={viewMode} onChange={handleViewModeChange} />
        </div>

        {/* ナビゲーション */}
        <div className="flex flex-wrap items-center justify-between gap-3 mb-6">
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => handleNavigate(-1)}
              className="rounded-md border border-zinc-300 bg-white px-3 py-1.5 text-sm text-zinc-700 hover:bg-zinc-50"
            >
              ← {prevLabel}
            </button>
            <span className="min-w-[10rem] text-center text-sm font-semibold text-zinc-900 tabular-nums px-2">
              {navLabel(anchorDate, viewMode)}
            </span>
            <button
              type="button"
              onClick={() => handleNavigate(1)}
              className="rounded-md border border-zinc-300 bg-white px-3 py-1.5 text-sm text-zinc-700 hover:bg-zinc-50"
            >
              {nextLabel} →
            </button>
          </div>
          <button
            type="button"
            onClick={() => setAnchorDate(todayISO())}
            className="rounded-md border border-zinc-300 bg-white px-3 py-1.5 text-sm text-zinc-600 hover:bg-zinc-50"
          >
            今日
          </button>
        </div>

        {/* サマリー */}
        <div className="flex flex-wrap gap-3 mb-6">
          <div className="rounded-lg border border-zinc-200 bg-white px-4 py-2 text-sm">
            <span className="text-zinc-500">表示範囲の予定 </span>
            <span className="font-bold text-zinc-900 tabular-nums">{visibleEntries.length}</span>
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
          <>
            {viewMode === 'month' && (
              <MonthView
                yearMonth={yearMonthOf(anchorDate)}
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
                date={anchorDate}
                entries={byDate.get(anchorDate) ?? []}
                onSelect={setSelected}
              />
            )}
          </>
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
          onUpdated={() => void loadForRange(range.from, range.to)}
        />
      )}
    </div>
  )
}
