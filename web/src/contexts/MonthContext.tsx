'use client'

import { createContext, useContext, useState, useCallback, type ReactNode } from 'react'
import { todayYearMonthJST } from '@/utils/date'

function addMonths(ym: string, delta: number): string {
  const [y, m] = ym.split('-').map(Number)
  const date = new Date(y, m - 1 + delta, 1)
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`
}

function formatLabel(ym: string): string {
  const [y, m] = ym.split('-')
  return `${y}年${m}月`
}

type MonthContextValue = {
  yearMonth: string
  setYearMonth: (ym: string) => void
  prevMonth: () => void
  nextMonth: () => void
  label: string
}

const MonthContext = createContext<MonthContextValue | null>(null)

export function MonthProvider({ children }: { children: ReactNode }) {
  const [yearMonth, setYearMonth] = useState(todayYearMonthJST)

  const prevMonth = useCallback(() => setYearMonth(ym => addMonths(ym, -1)), [])
  const nextMonth = useCallback(() => setYearMonth(ym => addMonths(ym,  1)), [])

  return (
    <MonthContext.Provider value={{ yearMonth, setYearMonth, prevMonth, nextMonth, label: formatLabel(yearMonth) }}>
      {children}
    </MonthContext.Provider>
  )
}

export function useMonth(): MonthContextValue {
  const ctx = useContext(MonthContext)
  if (!ctx) throw new Error('useMonth must be used within MonthProvider')
  return ctx
}
