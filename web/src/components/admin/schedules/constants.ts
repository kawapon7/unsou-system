import type { AdminScheduleDisplayStatus } from '@/app/_actions/scheduleActions'
import type { ViewMode } from './types'

export const WEEKDAYS = ['日', '月', '火', '水', '木', '金', '土'] as const

export const VIEW_MODES: { id: ViewMode; label: string }[] = [
  { id: 'month', label: '月' },
  { id: 'week',  label: '週' },
  { id: 'day',   label: '日' },
]

export const STATUS_LABEL: Record<AdminScheduleDisplayStatus, { label: string; cls: string }> = {
  scheduled: { label: '予定', cls: 'bg-blue-100 text-blue-800' },
  absent:    { label: '休み', cls: 'bg-zinc-200 text-zinc-600' },
  worked:    { label: '実績済', cls: 'bg-emerald-100 text-emerald-800' },
}

export const NAV_LABELS: Record<ViewMode, { prev: string; next: string }> = {
  month: { prev: '前月', next: '次月' },
  week:  { prev: '前週', next: '次週' },
  day:   { prev: '前日', next: '次日' },
}
