export type ScheduleTrendRawRow = {
  date: string
  status: string
  projects: { sale_amount: number | null } | null
}

export function buildScheduleTrendMap(
  rows: ScheduleTrendRawRow[],
  today: string,
  months: string[],
): Map<string, { confirmed: number; projected: number }> {
  const trendMap = new Map<string, { confirmed: number; projected: number }>()
  for (const m of months) trendMap.set(m, { confirmed: 0, projected: 0 })

  for (const s of rows) {
    const ym = s.date.slice(0, 7)
    const entry = trendMap.get(ym)
    if (!entry) continue
    const sale = s.projects?.sale_amount ?? 0
    if (s.date <= today) entry.confirmed += sale
    else if (s.status === 'scheduled') entry.projected += sale
  }
  return trendMap
}
