'use client'

import type { AdminScheduleEntry } from '@/app/_actions/scheduleActions'
import { DriverCard } from './DriverCard'
import type { ScheduleSelectHandler } from './types'
import { fmtDate } from './utils'

type DayViewProps = {
  date:     string
  entries:  AdminScheduleEntry[]
  onSelect: ScheduleSelectHandler
}

function DaySection({
  title,
  items,
  accent,
  onSelect,
}: {
  title:    string
  items:    AdminScheduleEntry[]
  accent?:  string
  onSelect: ScheduleSelectHandler
}) {
  if (!items.length) return null

  return (
    <section className="space-y-3">
      <h3 className={`text-sm font-semibold ${accent ?? 'text-zinc-700'}`}>
        {title}（{items.length}）
      </h3>
      <div className="space-y-2">
        {items.map(e => (
          <DriverCard key={e.scheduleId} entry={e} onSelect={onSelect} />
        ))}
      </div>
    </section>
  )
}

export function DayView({ date, entries, onSelect }: DayViewProps) {
  const missing   = entries.filter(e => e.isMissingInput)
  const scheduled = entries.filter(e => e.displayStatus === 'scheduled' && !e.isMissingInput)
  const absent    = entries.filter(e => e.displayStatus === 'absent')
  const worked    = entries.filter(e => e.displayStatus === 'worked')

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
          <DaySection title="🔴 入力遅延（未入力）" items={missing} accent="text-rose-700" onSelect={onSelect} />
          <DaySection title="予定（未実績）" items={scheduled} onSelect={onSelect} />
          <DaySection title="休み" items={absent} onSelect={onSelect} />
          <DaySection title="実績済" items={worked} onSelect={onSelect} />
        </div>
      )}
    </div>
  )
}
