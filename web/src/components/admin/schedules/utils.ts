import { WEEKDAYS } from './constants'
import type { DateRange, ViewMode } from './types'

export function toISO(d: Date) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

export function todayISO() {
  return toISO(new Date())
}

export function parseISO(date: string) {
  const [y, m, d] = date.split('-').map(Number)
  return new Date(y, m - 1, d)
}

export function addDays(date: string, delta: number) {
  const d = parseISO(date)
  d.setDate(d.getDate() + delta)
  return toISO(d)
}

export function addMonths(date: string, delta: number) {
  const d = parseISO(date)
  d.setMonth(d.getMonth() + delta)
  return toISO(d)
}

export function yearMonthOf(date: string) {
  return date.slice(0, 7)
}

export function fmtMonth(ym: string) {
  const [y, m] = ym.split('-')
  return `${y}年${Number(m)}月`
}

export function fmtDate(date: string, withWeekday = false) {
  const d = parseISO(date)
  const base = `${d.getFullYear()}年${d.getMonth() + 1}月${d.getDate()}日`
  return withWeekday ? `${base}（${WEEKDAYS[d.getDay()]}）` : base
}

export function fmtShortDate(date: string) {
  const d = parseISO(date)
  return `${d.getMonth() + 1}/${d.getDate()}`
}

export function startOfWeek(date: string) {
  const d = parseISO(date)
  d.setDate(d.getDate() - d.getDay())
  return toISO(d)
}

export function endOfWeek(date: string) {
  return addDays(startOfWeek(date), 6)
}

export function buildMonthGrid(yearMonth: string): (string | null)[] {
  const [y, m] = yearMonth.split('-').map(Number)
  const firstDay = new Date(y, m - 1, 1).getDay()
  const daysInMonth = new Date(y, m, 0).getDate()
  const cells: (string | null)[] = Array(firstDay).fill(null)
  for (let d = 1; d <= daysInMonth; d++) {
    cells.push(`${yearMonth}-${String(d).padStart(2, '0')}`)
  }
  while (cells.length % 7 !== 0) cells.push(null)
  return cells
}

export function yearMonthsInRange(from: string, to: string): string[] {
  return [...new Set([yearMonthOf(from), yearMonthOf(to)])]
}

export function navigateDate(date: string, viewMode: ViewMode, delta: -1 | 1): string {
  if (viewMode === 'month') return addMonths(date, delta)
  if (viewMode === 'week')  return addDays(date, delta * 7)
  return addDays(date, delta)
}

export function navLabel(date: string, viewMode: ViewMode): string {
  if (viewMode === 'month') return fmtMonth(yearMonthOf(date))
  if (viewMode === 'week') {
    const from = startOfWeek(date)
    const to   = endOfWeek(date)
    if (yearMonthOf(from) === yearMonthOf(to)) {
      return `${fmtMonth(yearMonthOf(from))} ${fmtShortDate(from)} 〜 ${fmtShortDate(to)}`
    }
    return `${fmtShortDate(from)} 〜 ${fmtShortDate(to)}`
  }
  return fmtDate(date, true)
}

export function visibleRange(date: string, viewMode: ViewMode): DateRange {
  if (viewMode === 'month') {
    const ym = yearMonthOf(date)
    const [y, m] = ym.split('-').map(Number)
    const from = `${ym}-01`
    const to   = toISO(new Date(y, m, 0))
    const dates = buildMonthGrid(ym).filter((d): d is string => d != null)
    return { from, to, dates }
  }
  if (viewMode === 'week') {
    const from  = startOfWeek(date)
    const dates = Array.from({ length: 7 }, (_, i) => addDays(from, i))
    return { from, to: dates[6], dates }
  }
  return { from: date, to: date, dates: [date] }
}

export function groupEntriesByDate<T extends { date: string }>(entries: T[]): Map<string, T[]> {
  const map = new Map<string, T[]>()
  for (const e of entries) {
    const list = map.get(e.date) ?? []
    list.push(e)
    map.set(e.date, list)
  }
  return map
}
