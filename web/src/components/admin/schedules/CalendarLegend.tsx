'use client'

import { STATUS_LABEL } from './constants'

export function CalendarLegend() {
  return (
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
  )
}
