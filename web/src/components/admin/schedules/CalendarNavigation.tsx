'use client'

import { NAV_LABELS } from './constants'
import type { ViewMode } from './types'
import { navLabel } from './utils'

type CalendarNavigationProps = {
  currentDate: string
  viewMode:    ViewMode
  onPrev:      () => void
  onNext:      () => void
  onToday:     () => void
}

export function CalendarNavigation({
  currentDate,
  viewMode,
  onPrev,
  onNext,
  onToday,
}: CalendarNavigationProps) {
  const labels = NAV_LABELS[viewMode]

  return (
    <div className="flex flex-wrap items-center justify-between gap-3 mb-6">
      <div className="flex items-center gap-2">
        <button
          type="button"
          onClick={onPrev}
          className="rounded-md border border-zinc-300 bg-white px-3 py-1.5 text-sm text-zinc-700 hover:bg-zinc-50"
        >
          ← {labels.prev}
        </button>
        <span className="min-w-[10rem] text-center text-sm font-semibold text-zinc-900 tabular-nums px-2">
          {navLabel(currentDate, viewMode)}
        </span>
        <button
          type="button"
          onClick={onNext}
          className="rounded-md border border-zinc-300 bg-white px-3 py-1.5 text-sm text-zinc-700 hover:bg-zinc-50"
        >
          {labels.next} →
        </button>
      </div>
      <button
        type="button"
        onClick={onToday}
        className="rounded-md border border-zinc-300 bg-white px-3 py-1.5 text-sm text-zinc-600 hover:bg-zinc-50"
      >
        今日
      </button>
    </div>
  )
}
