'use server'

import { revalidatePath } from 'next/cache'
import { createClient } from '@/utils/supabase/server'
import { createServiceClient } from '@/utils/supabase/service'
import { getCurrentTenantId } from '@/utils/tenant'

type ActionResult<T = void> =
  | { data: T; error: null }
  | { data: null; error: string }

const DEV_CONTRACTOR_ID = 'cc31ee16-660a-42db-acb4-05f148a3fce8'

// ── 認証ヘルパー ────────────────────────────────────────────

async function resolveContractorId(userId: string, email?: string): Promise<string | null> {
  const db = createServiceClient() as any

  const { data: row } = await db
    .from('contractors')
    .select('id')
    .eq('user_id', userId)
    .maybeSingle()
  if (row?.id) return row.id

  if (email) {
    const { data: byEmail } = await db
      .from('contractors')
      .select('id')
      .eq('email', email)
      .maybeSingle()
    if (byEmail?.id) return byEmail.id
  }
  return null
}

// ── 型定義 ──────────────────────────────────────────────────

export type MissingInputRow = {
  scheduleId:     string
  contractorId:   string
  contractorName: string
  contractorPhone: string | null
  projectId:      string
  projectName:    string
  date:           string   // 'YYYY-MM-DD'
}

export type ScheduleRow = {
  id:           string
  contractorId: string
  projectId:    string
  date:         string
  status:       'scheduled' | 'absent' | 'completed'
  createdAt:    string
  updatedAt:    string
}

export type ScheduleStatus = 'scheduled' | 'absent' | 'completed'
export type UpdatableScheduleStatus = 'scheduled' | 'absent'

export type NotificationLogPayload = {
  contractor_id: string
  type:          string
  destination:   string
  status:        string
  message_id?:   string | null
}

// ================================================================
// getMissingInputs
// status='scheduled' かつ date<=本日 だが、同一 contractor_id×date の
// work_records が存在しない予定を返す（未入力アラート）
// ================================================================
export async function getMissingInputs(): Promise<ActionResult<MissingInputRow[]>> {
  const tenantId = await getCurrentTenantId()
  const today = new Date().toLocaleDateString('sv-SE', { timeZone: 'Asia/Tokyo' })

  const service = createServiceClient()
  const db = service as any

  const { data: schedules, error: sErr } = await db
    .from('schedules')
    .select(`
      id,
      contractor_id,
      project_id,
      date,
      contractors ( id, name, phone ),
      projects    ( id, project_name, name )
    `)
    .eq('status', 'scheduled')
    .lte('date', today)
    .eq('tenant_id', tenantId)
    .order('date', { ascending: false })

  if (sErr) return { data: null, error: sErr.message }
  if (!schedules?.length) return { data: [], error: null }

  const contractorIds: string[] = [...new Set((schedules as any[]).map((s: any) => s.contractor_id))]

  const { data: workRecords, error: wErr } = await db
    .from('work_records')
    .select('contractor_id, date, work_date')
    .in('contractor_id', contractorIds)
    .eq('tenant_id', tenantId)
    .lte('work_date', today)

  if (wErr) return { data: null, error: wErr.message }

  const workedSet = new Set(
    (workRecords ?? []).map((w: any) => {
      const recordDate = w.date ?? w.work_date
      return `${w.contractor_id}:${recordDate}`
    }),
  )

  const missing: MissingInputRow[] = (schedules as any[])
    .filter((s: any) => !workedSet.has(`${s.contractor_id}:${s.date}`))
    .map((s: any) => ({
      scheduleId:     s.id,
      contractorId:   s.contractor_id,
      contractorName: s.contractors?.name ?? s.contractor_id,
      contractorPhone: s.contractors?.phone ?? null,
      projectId:      s.project_id,
      projectName:    s.projects?.project_name ?? s.projects?.name ?? s.project_id,
      date:           s.date,
    }))

  return { data: missing, error: null }
}

// ================================================================
// updateScheduleStatus
// 親分が特定の schedule の status を変更する
// 主用途: 「本日休み（absent）」への変更
// ================================================================
export async function updateScheduleStatus(
  scheduleId: string,
  status: UpdatableScheduleStatus,
): Promise<ActionResult> {
  const tenantId = await getCurrentTenantId()
  const service = createServiceClient()
  const db = service as any

  const { error } = await db
    .from('schedules')
    .update({ status, updated_at: new Date().toISOString() })
    .eq('id', scheduleId)
    .eq('tenant_id', tenantId)

  if (error) return { data: null, error: error.message }

  revalidatePath('/admin/dashboard')
  revalidatePath('/admin/schedules')
  revalidatePath('/driver/schedule')

  return { data: undefined, error: null }
}

// ================================================================
// fetchAdminMonthlySchedules
// 管理者用カレンダー: 指定月の全ドライバー予定 + 実績突合
// ================================================================

export type AdminScheduleDisplayStatus = 'scheduled' | 'absent' | 'worked'

export type AdminScheduleEntry = {
  scheduleId:      string
  contractorId:    string
  contractorName:  string
  projectId:       string
  projectName:     string
  date:            string
  status:          ScheduleStatus
  displayStatus:   AdminScheduleDisplayStatus
  isMissingInput:  boolean
}

export async function fetchAdminMonthlySchedules(
  yearMonth: string,
): Promise<ActionResult<AdminScheduleEntry[]>> {
  const tenantId = await getCurrentTenantId()
  const today = new Date().toLocaleDateString('sv-SE', { timeZone: 'Asia/Tokyo' })
  const [y, m] = yearMonth.split('-').map(Number)
  const from = `${yearMonth}-01`
  const to   = new Date(y, m, 0).toISOString().slice(0, 10)

  const db = createServiceClient() as any

  const { data: schedules, error: sErr } = await db
    .from('schedules')
    .select(`
      id,
      contractor_id,
      project_id,
      date,
      status,
      contractors ( id, name ),
      projects    ( id, project_name, name )
    `)
    .eq('tenant_id', tenantId)
    .gte('date', from)
    .lte('date', to)
    .order('date', { ascending: true })

  if (sErr) return { data: null, error: sErr.message }
  if (!schedules?.length) return { data: [], error: null }

  const contractorIds: string[] = [...new Set((schedules as any[]).map((s: any) => s.contractor_id))]

  const { data: workRecords, error: wErr } = await db
    .from('work_records')
    .select('contractor_id, date, work_date')
    .in('contractor_id', contractorIds)
    .eq('tenant_id', tenantId)
    .gte('work_date', from)
    .lte('work_date', to)

  if (wErr) return { data: null, error: wErr.message }

  const workedSet = new Set(
    (workRecords ?? []).map((w: any) => {
      const recordDate = w.date ?? w.work_date
      return `${w.contractor_id}:${recordDate}`
    }),
  )

  const entries: AdminScheduleEntry[] = (schedules as any[]).map((s: any) => {
    const hasWork = workedSet.has(`${s.contractor_id}:${s.date}`)
    const isMissingInput =
      s.status === 'scheduled' &&
      s.date <= today &&
      !hasWork

    let displayStatus: AdminScheduleDisplayStatus
    if (s.status === 'absent') {
      displayStatus = 'absent'
    } else if (hasWork) {
      displayStatus = 'worked'
    } else {
      displayStatus = 'scheduled'
    }

    return {
      scheduleId:     s.id,
      contractorId:   s.contractor_id,
      contractorName: s.contractors?.name ?? s.contractor_id,
      projectId:      s.project_id,
      projectName:    s.projects?.project_name ?? s.projects?.name ?? s.project_id,
      date:           s.date,
      status:         s.status,
      displayStatus,
      isMissingInput,
    }
  })

  return { data: entries, error: null }
}

// ================================================================
// logNotification
// 催促・監査履歴を notification_logs へ記録（不変ログ）
// ================================================================
export async function logNotification(
  payload: NotificationLogPayload,
): Promise<ActionResult<{ id: string }>> {
  const db = createServiceClient() as any

  const { data, error } = await db
    .from('notification_logs')
    .insert({
      contractor_id: payload.contractor_id,
      type:          payload.type,
      destination:   payload.destination,
      status:        payload.status,
      message_id:    payload.message_id ?? null,
    })
    .select('id')
    .single()

  if (error || !data) return { data: null, error: error?.message ?? 'ログ記録に失敗しました' }
  return { data: { id: data.id }, error: null }
}

// ================================================================
// fetchSchedules
// 子分カレンダー画面: 自分の月次スケジュール一覧を取得
// ================================================================
export async function fetchSchedules(
  yearMonth: string,
): Promise<ActionResult<ScheduleRow[]>> {
  const tenantId = await getCurrentTenantId()
  let contractorId: string | null

  if (process.env.NODE_ENV === 'development') {
    contractorId = DEV_CONTRACTOR_ID
  } else {
    const supabase = await createClient()
    const { data: { user }, error: authErr } = await supabase.auth.getUser()
    if (authErr || !user) return { data: null, error: '未ログインです' }
    contractorId = await resolveContractorId(user.id, user.email ?? undefined)
    if (!contractorId) return { data: null, error: '委託先レコードが見つかりません' }
  }

  const [y, m] = yearMonth.split('-').map(Number)
  const from = `${yearMonth}-01`
  const to   = new Date(y, m, 0).toISOString().slice(0, 10)

  const service = createServiceClient()
  const db = service as any

  const { data, error } = await db
    .from('schedules')
    .select('id, contractor_id, project_id, date, status, created_at, updated_at')
    .eq('contractor_id', contractorId)
    .eq('tenant_id', tenantId)
    .gte('date', from)
    .lte('date', to)
    .order('date', { ascending: true })

  if (error) return { data: null, error: error.message }

  return {
    data: (data ?? []).map((r: any) => ({
      id:           r.id,
      contractorId: r.contractor_id,
      projectId:    r.project_id,
      date:         r.date,
      status:       r.status,
      createdAt:    r.created_at,
      updatedAt:    r.updated_at,
    })),
    error: null,
  }
}

// ================================================================
// upsertSchedule
// 子分カレンダー: 日付セルのタップで予定を登録／ステータス切り替え
// UNIQUE(contractor_id, date) の upsert
// ================================================================
export async function upsertSchedule(params: {
  projectId: string
  date:      string
  status:    ScheduleStatus
}): Promise<ActionResult<{ id: string }>> {
  const tenantId = await getCurrentTenantId()
  let contractorId: string | null

  if (process.env.NODE_ENV === 'development') {
    contractorId = DEV_CONTRACTOR_ID
  } else {
    const supabase = await createClient()
    const { data: { user }, error: authErr } = await supabase.auth.getUser()
    if (authErr || !user) return { data: null, error: '未ログインです' }
    contractorId = await resolveContractorId(user.id, user.email ?? undefined)
    if (!contractorId) return { data: null, error: '委託先レコードが見つかりません' }
  }

  const service = createServiceClient()
  const db = service as any

  const { data, error } = await db
    .from('schedules')
    .upsert(
      {
        contractor_id: contractorId,
        project_id:    params.projectId,
        date:          params.date,
        status:        params.status,
        tenant_id:     tenantId,
        updated_at:    new Date().toISOString(),
      },
      { onConflict: 'contractor_id,date', ignoreDuplicates: false },
    )
    .select('id')
    .single()

  if (error) return { data: null, error: error.message }
  return { data: { id: data.id }, error: null }
}

// ================================================================
// copyPrevMonthSchedules
// 「前月予定の1クリック全コピー」ボタン
// fromYearMonth の scheduled 行を toYearMonth に一括コピー
// 既存行は upsert で上書き（ignoreDuplicates: false）
// ================================================================
export async function copyPrevMonthSchedules(params: {
  fromYearMonth: string   // 'YYYY-MM' コピー元
  toYearMonth:   string   // 'YYYY-MM' コピー先
}): Promise<ActionResult<{ copied: number }>> {
  const tenantId = await getCurrentTenantId()
  let contractorId: string | null

  if (process.env.NODE_ENV === 'development') {
    contractorId = DEV_CONTRACTOR_ID
  } else {
    const supabase = await createClient()
    const { data: { user }, error: authErr } = await supabase.auth.getUser()
    if (authErr || !user) return { data: null, error: '未ログインです' }
    contractorId = await resolveContractorId(user.id, user.email ?? undefined)
    if (!contractorId) return { data: null, error: '委託先レコードが見つかりません' }
  }

  const service = createServiceClient()
  const db = service as any

  // コピー元の scheduled 行を全件取得
  const [fy, fm] = params.fromYearMonth.split('-').map(Number)
  const fromStart = `${params.fromYearMonth}-01`
  const fromEnd   = new Date(fy, fm, 0).toISOString().slice(0, 10)

  const { data: source, error: fetchErr } = await db
    .from('schedules')
    .select('project_id, date, status')
    .eq('contractor_id', contractorId)
    .eq('tenant_id', tenantId)
    .eq('status', 'scheduled')
    .gte('date', fromStart)
    .lte('date', fromEnd)

  if (fetchErr) return { data: null, error: fetchErr.message }
  if (!source?.length) return { data: { copied: 0 }, error: null }

  // 日付を翌月（toYearMonth）に変換してコピー行を生成
  const fromMonthNum = fm
  const toMonthNum   = parseInt(params.toYearMonth.split('-')[1], 10)
  const toYear       = parseInt(params.toYearMonth.split('-')[0], 10)

  const rows = (source as any[])
    .map((r: any) => {
      const srcDay = parseInt(r.date.split('-')[2], 10)
      const maxDay = new Date(toYear, toMonthNum, 0).getDate()
      if (srcDay > maxDay) return null   // コピー先月に存在しない日は除外
      return {
        contractor_id: contractorId!,
        project_id:    r.project_id,
        date:          `${params.toYearMonth}-${String(srcDay).padStart(2, '0')}`,
        status:        'scheduled' as const,
        tenant_id:     tenantId,
        updated_at:    new Date().toISOString(),
      }
    })
    .filter((r): r is NonNullable<typeof r> => r !== null)

  if (!rows.length) return { data: { copied: 0 }, error: null }

  const { error: insertErr } = await db
    .from('schedules')
    .upsert(rows, { onConflict: 'contractor_id,date', ignoreDuplicates: false })

  if (insertErr) return { data: null, error: insertErr.message }
  return { data: { copied: rows.length }, error: null }
}
