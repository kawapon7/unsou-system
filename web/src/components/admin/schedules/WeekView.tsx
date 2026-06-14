'use client'

import { WEEKDAYS } from './constants'
import { DayCell } from './DayCell'
import type { SchedulesByDate, ScheduleSelectHandler } from './types'
import { fmtShortDate, parseISO } from './utils'

type WeekViewProps = {
  dates:    string[]
  byDate:   SchedulesByDate
  today:    string
  onSelect: ScheduleSelectHandler
}

export function WeekView({ dates, byDate, today, onSelect }: WeekViewProps) {
  return (
    <div className="rounded-xl border border-zinc-200 bg-white overflow-hidden shadow-sm">
      <div className="grid grid-cols-7 border-b border-zinc-200 bg-zinc-50">
        {dates.map(date => {
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
