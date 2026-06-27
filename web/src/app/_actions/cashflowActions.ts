'use server'

import { createServiceClient } from '@/utils/supabase/service'
import { getCurrentTenantId } from '@/utils/tenant'
import { requireOwner } from '@/utils/auth'

type ActionResult<T> = { data: T; error: null } | { data: null; error: string }

function todayJST(): string {
  return new Date().toLocaleDateString('sv-SE', { timeZone: 'Asia/Tokyo' })
}

// ── 型定義 ────────────────────────────────────────────────

export type DailyCashflow = {
  date:            string
  confirmedSales:  number
  projectedSales:  number
  confirmedCost:   number
  projectedCost:   number
  confirmedProfit: number
  projectedProfit: number
}

export type DailyDetail = {
  date:        string
  projectId:   string
  projectName: string
  clientName:  string
  saleAmount:  number
  buyAmount:   number
  confirmed:   boolean
}

export type DailyCashflowCalendarResult = {
  daily:   DailyCashflow[]
  details: DailyDetail[]
}

// ── 日別キャッシュフローカレンダー集計 ───────────────────
// schedules × projects を月単位で一括取得し、JS側で日付ごとにReduce。
// N+1 クエリ厳禁：DB アクセスは1回のみ。

export async function fetchDailyCashflowCalendar(
  month: string,
): Promise<ActionResult<DailyCashflowCalendarResult>> {
  const auth = await requireOwner()
  if (!auth.ok) return { data: null, error: auth.error }
  const tenantId = await getCurrentTenantId()
  const db       = createServiceClient() as any
  const today    = todayJST()

  const [y, m] = month.split('-').map(Number)
  const from   = `${month}-01`
  const to     = new Date(y, m, 0).toISOString().slice(0, 10)

  const { data, error } = await db
    .from('schedules')
    .select('date, status, projects(id, project_name, sale_amount, buy_amount, clients(company_name))')
    .eq('tenant_id', tenantId)
    .gte('date', from)
    .lte('date', to)
    .neq('status', 'absent')

  if (error) return { data: null, error: error.message }

  const dayMap  = new Map<string, DailyCashflow>()
  const details: DailyDetail[] = []

  for (const s of (data ?? [])) {
    const p = s.projects as any
    if (!p) continue

    const sale        = p.sale_amount ?? 0
    const cost        = p.buy_amount  ?? 0
    const isConfirmed = (s.date as string) <= today
    const isProjected = !isConfirmed && s.status === 'scheduled'
    if (!isConfirmed && !isProjected) continue

    const date = s.date as string
    if (!dayMap.has(date)) {
      dayMap.set(date, {
        date,
        confirmedSales:  0,
        projectedSales:  0,
        confirmedCost:   0,
        projectedCost:   0,
        confirmedProfit: 0,
        projectedProfit: 0,
      })
    }

    const day = dayMap.get(date)!
    if (isConfirmed) {
      day.confirmedSales += sale
      day.confirmedCost  += cost
    } else {
      day.projectedSales += sale
      day.projectedCost  += cost
    }

    details.push({
      date,
      projectId:   p.id,
      projectName: p.project_name,
      clientName:  p.clients?.company_name ?? '—',
      saleAmount:  sale,
      buyAmount:   cost,
      confirmed:   isConfirmed,
    })
  }

  for (const day of dayMap.values()) {
    day.confirmedProfit = day.confirmedSales - day.confirmedCost
    day.projectedProfit = day.projectedSales - day.projectedCost
  }

  return {
    data: {
      daily:   [...dayMap.values()].sort((a, b) => a.date.localeCompare(b.date)),
      details,
    },
    error: null,
  }
}
