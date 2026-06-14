'use client'

import type { AdminScheduleEntry } from '@/app/_actions/scheduleActions'
import { STATUS_LABEL } from './constants'
import type { ScheduleSelectHandler } from './types'

type DriverCardProps = {
  entry:    AdminScheduleEntry
  onSelect: ScheduleSelectHandler
}

export function DriverCard({ entry, onSelect }: DriverCardProps) {
  const st = STATUS_LABEL[entry.displayStatus]

  return (
    <button
      type="button"
      onClick={() => onSelect(entry)}
      className={`w-full text-left rounded-xl border p-4 transition hover:shadow-md ${
        entry.isMissingInput
          ? 'border-rose-300 bg-rose-50/60 hover:bg-rose-50'
          : 'border-zinc-200 bg-white hover:border-zinc-300'
      }`}
    >
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="font-semibold text-zinc-900 truncate">{entry.contractorName}</p>
          <p className="text-sm text-zinc-500 mt-0.5 truncate">{entry.projectName}</p>
        </div>
        <div className="flex items-center gap-1.5 shrink-0">
          <span className={`inline-flex rounded-full px-2.5 py-0.5 text-xs font-medium ${st.cls}`}>
            {st.label}
          </span>
          {entry.isMissingInput && (
            <span className="inline-flex rounded-full bg-rose-600 px-2.5 py-0.5 text-xs font-bold text-white">
              未入力
            </span>
          )}
        </div>
      </div>
    </button>
  )
}
