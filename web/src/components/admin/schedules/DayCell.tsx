'use client'

import type { AdminScheduleEntry } from '@/app/_actions/scheduleActions'
import { DriverChip } from './DriverChip'
import type { ScheduleSelectHandler } from './types'
import { parseISO } from './utils'

type DayCellProps = {
  date:       string
  entries:    AdminScheduleEntry[]
  today:      string
  onSelect:   ScheduleSelectHandler
  minHeight?: string
}

export function DayCell({
  date,
  entries,
  today,
  onSelect,
  minHeight = 'min-h-[7rem]',
}: DayCellProps) {
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
