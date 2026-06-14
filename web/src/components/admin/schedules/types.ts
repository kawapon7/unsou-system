import type { AdminScheduleEntry } from '@/app/_actions/scheduleActions'

export type ViewMode = 'month' | 'week' | 'day'

export type DateRange = {
  from:  string
  to:    string
  dates: string[]
}

export type SchedulesByDate = Map<string, AdminScheduleEntry[]>

export type ScheduleSelectHandler = (entry: AdminScheduleEntry) => void
