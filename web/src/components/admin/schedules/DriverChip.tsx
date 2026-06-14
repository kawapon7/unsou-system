'use client'

import type { AdminScheduleEntry } from '@/app/_actions/scheduleActions'
import { STATUS_LABEL } from './constants'
import type { ScheduleSelectHandler } from './types'

type DriverChipProps = {
  entry:    AdminScheduleEntry
  onSelect: ScheduleSelectHandler
  size?:    'sm' | 'md'
}

export function DriverChip({ entry, onSelect, size = 'sm' }: DriverChipProps) {
  const st = STATUS_LABEL[entry.displayStatus]
  const textSize  = size === 'md' ? 'text-sm' : 'text-[11px]'
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
