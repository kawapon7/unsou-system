'use server'

import { revalidatePath } from 'next/cache'
import { createClient } from '@/utils/supabase/server'
import { createServiceClient } from '@/utils/supabase/service'
import { getCurrentTenantId } from '@/utils/tenant'

type ActionResult<T = void> =
  | { data: T; error: null }
  | { data: null; error: string }

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
  scheduleId:      string
  contractorId:    string
  contractorName:  string
  contractorPhone: string | null
  contractorEmail: string | null
  projectId:       string
  projectName:     string
  date:            string   // 'YYYY-MM-DD'
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


// ================================================================
// getMissingInputs
// status='scheduled' かつ date<=本日 だが、同一 contractor_id×date の
// work_records が存在しない予定を返す（未入力アラート）
// ================================================================
export async function getMissingInputs(): Promise<ActionResult<MissingInputRow[]>> {
  const tenantId = await getCurrentTenantId()
  const today = new Date().toLocaleDateString('sv-SE', { timeZone: 'Asia/Tokyo' })
  const firstOfMonth = `${today.slice(0, 7)}-01`

  const service = createServiceClient()
  const db = service as any

  const { data: schedules, error: sErr } = await db
    .from('schedules')
    .select(`
      id,
      contractor_id,
      project_id,
      date,
      contractors ( id, name, phone, email ),
      projects    ( id, project_name, name )
    `)
    .eq('status', 'scheduled')
    .gte('date', firstOfMonth)
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
      contractorEmail: s.contractors?.email ?? null,
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

  // work_records 取得失敗は non-fatal: workedSet を空にして schedules を返す
  // この場合 isMissingInput・displayStatus='worked' の精度は落ちるがカレンダー自体は表示される
  if (wErr) {
    console.error('[fetchAdminMonthlySchedules] work_records fetch failed:', wErr.message)
  }

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
// fetchSchedules
// 子分カレンダー画面: 自分の月次スケジュール一覧を取得
// ================================================================
export async function fetchSchedules(
  yearMonth: string,
): Promise<ActionResult<ScheduleRow[]>> {
  const tenantId = await getCurrentTenantId()
  let contractorId: string | null

  const supabase = await createClient()
  const { data: { user }, error: authErr } = await supabase.auth.getUser()
  if (authErr || !user) return { data: null, error: '未ログインです' }
  contractorId = await resolveContractorId(user.id, user.email ?? undefined)
  if (!contractorId) return { data: null, error: '委託先レコードが見つかりません' }

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
  projectId: string | null
  date:      string
  status:    ScheduleStatus
}): Promise<ActionResult<{ id: string }>> {
  const tenantId = await getCurrentTenantId()
  let contractorId: string | null

  const supabase = await createClient()
  const { data: { user }, error: authErr } = await supabase.auth.getUser()
  if (authErr || !user) return { data: null, error: '未ログインです' }
  contractorId = await resolveContractorId(user.id, user.email ?? undefined)
  if (!contractorId) return { data: null, error: '委託先レコードが見つかりません' }

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
// bulkUpsertSchedules
// 複数日付を同一案件・ステータスで一括登録（多選択カレンダー用）
// UNIQUE(contractor_id, date) の upsert — 既存行は上書き
// ================================================================
export async function bulkUpsertSchedules(params: {
  dates:     string[]
  projectId: string | null
  status:    ScheduleStatus
}): Promise<ActionResult<{ ids: string[]; count: number }>> {
  if (!params.dates.length) return { data: { ids: [], count: 0 }, error: null }

  const tenantId = await getCurrentTenantId()
  let contractorId: string | null

  const supabase = await createClient()
  const { data: { user }, error: authErr } = await supabase.auth.getUser()
  if (authErr || !user) return { data: null, error: '未ログインです' }
  contractorId = await resolveContractorId(user.id, user.email ?? undefined)
  if (!contractorId) return { data: null, error: '委託先レコードが見つかりません' }

  const now = new Date().toISOString()
  const rows = params.dates.map(date => ({
    contractor_id: contractorId!,
    project_id:    params.projectId,
    date,
    status:        params.status,
    tenant_id:     tenantId,
    updated_at:    now,
  }))

  const db = createServiceClient() as any
  const { data, error } = await db
    .from('schedules')
    .upsert(rows, { onConflict: 'contractor_id,date', ignoreDuplicates: false })
    .select('id')

  if (error) return { data: null, error: error.message }
  const ids = (data ?? []).map((r: any) => r.id as string)
  return { data: { ids, count: ids.length }, error: null }
}

// ================================================================
// copyPrevMonthSchedules
// 「前月予定の1クリック全コピー」ボタン
// 曜日ベース: 前月の「第N○曜日」→ 今月の「第N○曜日」にマッピング
// 今月に該当する曜日が存在しない場合（第5週など）はスキップ
// ================================================================

/** 'YYYY-MM-DD' の日付から「第N○曜日」を返す (0-indexed weekday, 1-indexed nth) */
function getNthWeekday(dateStr: string): { nth: number; weekday: number } {
  const d       = new Date(dateStr + 'T00:00:00')
  const weekday = d.getDay()                          // 0=日 〜 6=土
  const nth     = Math.ceil(d.getDate() / 7)          // 1〜5
  return { nth, weekday }
}

/** year/month の第 nth・weekday の日付文字列を返す（存在しなければ null） */
function findNthWeekdayDate(year: number, month: number, nth: number, weekday: number): string | null {
  // 月の1日の曜日
  const firstDow = new Date(year, month - 1, 1).getDay()
  // 最初の該当曜日の日
  const firstOccurrence = 1 + ((weekday - firstDow + 7) % 7)
  const day = firstOccurrence + (nth - 1) * 7
  const maxDay = new Date(year, month, 0).getDate()
  if (day > maxDay) return null
  return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`
}

export async function copyPrevMonthSchedules(params: {
  fromYearMonth: string   // 'YYYY-MM' コピー元
  toYearMonth:   string   // 'YYYY-MM' コピー先
}): Promise<ActionResult<{ copied: number; skipped: number }>> {
  const tenantId = await getCurrentTenantId()
  let contractorId: string | null

  const supabase = await createClient()
  const { data: { user }, error: authErr } = await supabase.auth.getUser()
  if (authErr || !user) return { data: null, error: '未ログインです' }
  contractorId = await resolveContractorId(user.id, user.email ?? undefined)
  if (!contractorId) return { data: null, error: '委託先レコードが見つかりません' }

  const db = createServiceClient() as any

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
  if (!source?.length) return { data: { copied: 0, skipped: 0 }, error: null }

  const [ty, tm] = params.toYearMonth.split('-').map(Number)
  const now = new Date().toISOString()

  let skipped = 0
  const rows = (source as any[])
    .map((r: any) => {
      const { nth, weekday } = getNthWeekday(r.date)
      const toDate = findNthWeekdayDate(ty, tm, nth, weekday)
      if (!toDate) { skipped++; return null }   // 今月に対応する曜日が存在しない
      return {
        contractor_id: contractorId!,
        project_id:    r.project_id,
        date:          toDate,
        status:        'scheduled' as const,
        tenant_id:     tenantId,
        updated_at:    now,
      }
    })
    .filter((r): r is NonNullable<typeof r> => r !== null)

  if (!rows.length) return { data: { copied: 0, skipped }, error: null }

  const { error: insertErr } = await db
    .from('schedules')
    .upsert(rows, { onConflict: 'contractor_id,date', ignoreDuplicates: false })

  if (insertErr) return { data: null, error: insertErr.message }
  return { data: { copied: rows.length, skipped }, error: null }
}

// ================================================================
// deleteSchedule
// 子分カレンダー: 日付セルのクリアで予定レコードを削除
// ================================================================
export async function deleteSchedule(
  scheduleId: string,
): Promise<ActionResult> {
  const tenantId = await getCurrentTenantId()
  const db = createServiceClient() as any

  const { error } = await db
    .from('schedules')
    .delete()
    .eq('id', scheduleId)
    .eq('tenant_id', tenantId)

  if (error) return { data: null, error: error.message }

  revalidatePath('/driver/schedule')
  revalidatePath('/admin/schedules')
  revalidatePath('/admin/dashboard')

  return { data: undefined, error: null }
}

// ================================================================
// fetchDriverProjectOptions
// ドライバーカレンダー: 予定登録時の案件プルダウン用リスト
// 表示制御の起点は driver_project_assignments（このドライバーに見せる案件）。
// project_payees は支払い計算レイヤーであり、ここでは参照しない。
// ================================================================
export async function fetchDriverProjectOptions(): Promise<ActionResult<{ id: string; name: string }[]>> {
  const tenantId = await getCurrentTenantId()
  let contractorId: string | null

  const supabase = await createClient()
  const { data: { user }, error: authErr } = await supabase.auth.getUser()
  if (authErr || !user) return { data: null, error: '未ログインです' }
  contractorId = await resolveContractorId(user.id, user.email ?? undefined)
  if (!contractorId) return { data: null, error: '委託先レコードが見つかりません' }

  const db = createServiceClient() as any

  // このドライバーに割り当てられた案件IDを取得
  const { data: assignments, error: assignErr } = await db
    .from('driver_project_assignments')
    .select('project_id')
    .eq('contractor_id', contractorId)

  if (assignErr) return { data: null, error: assignErr.message }
  if (!assignments?.length) return { data: [], error: null }

  const projectIds: string[] = assignments.map((a: any) => a.project_id)

  const { data, error } = await db
    .from('projects')
    .select('id, project_name, name')
    .eq('tenant_id', tenantId)
    .eq('driver_visible', true)
    .in('id', projectIds)
    .order('project_name', { ascending: true })

  if (error) return { data: null, error: error.message }

  return {
    data: (data ?? []).map((p: any) => ({
      id:   p.id,
      name: p.project_name ?? p.name ?? p.id,
    })),
    error: null,
  }
}

// ================================================================
// fetchMyWorkedDates
// 子分カレンダー: 当月の実績入力済み日付一覧（サマリー表示用）
// ================================================================
export async function fetchMyWorkedDates(
  yearMonth: string,
): Promise<ActionResult<string[]>> {
  const tenantId = await getCurrentTenantId()
  let contractorId: string | null

  const supabase = await createClient()
  const { data: { user }, error: authErr } = await supabase.auth.getUser()
  if (authErr || !user) return { data: null, error: '未ログインです' }
  contractorId = await resolveContractorId(user.id, user.email ?? undefined)
  if (!contractorId) return { data: null, error: '委託先レコードが見つかりません' }

  const [y, m] = yearMonth.split('-').map(Number)
  const from = `${yearMonth}-01`
  const to   = new Date(y, m, 0).toISOString().slice(0, 10)

  const db = createServiceClient() as any

  const { data, error } = await db
    .from('work_records')
    .select('work_date, date')
    .eq('contractor_id', contractorId)
    .eq('tenant_id', tenantId)
    .gte('work_date', from)
    .lte('work_date', to)

  if (error) return { data: null, error: error.message }

  const dates = [...new Set((data ?? []).map((r: any) => r.date ?? r.work_date))] as string[]
  return { data: dates, error: null }
}

// ================================================================
// logNotification
// notification_logs への不変ログ INSERT（service_role 経由）
// UPDATE / DELETE は RLS で全ロール禁止 — INSERT のみ許可
// ================================================================

export type NotificationLogType   = 'email' | 'sms' | 'import_log' | 'reminder'
export type NotificationLogStatus = 'sent' | 'failed' | 'delivered'

export async function logNotification(params: {
  contractorId: string
  type:         NotificationLogType
  destination:  string
  status:       NotificationLogStatus
  messageId?:   string | null
}): Promise<ActionResult<{ id: string }>> {
  const db = createServiceClient() as any

  const { data, error } = await db
    .from('notification_logs')
    .insert({
      contractor_id: params.contractorId,
      type:          params.type,
      destination:   params.destination,
      status:        params.status,
      message_id:    params.messageId ?? null,
    })
    .select('id')
    .single()

  if (error) return { data: null, error: error.message }
  return { data: { id: data.id as string }, error: null }
}
