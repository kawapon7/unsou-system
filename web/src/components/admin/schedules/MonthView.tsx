'use client'

import { WEEKDAYS } from './constants'
import { DayCell } from './DayCell'
import type { SchedulesByDate, ScheduleSelectHandler } from './types'
import { buildMonthGrid } from './utils'

type MonthViewProps = {
  yearMonth: string
  byDate:    SchedulesByDate
  today:     string
  onSelect:  ScheduleSelectHandler
}

export function MonthView({ yearMonth, byDate, today, onSelect }: MonthViewProps) {
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
