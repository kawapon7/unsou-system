'use server'

import { revalidatePath } from 'next/cache'
import { createClient } from '@/utils/supabase/server'
import { createServiceClient } from '@/utils/supabase/service'
import { getCurrentTenantId } from '@/utils/tenant'
import { requireOwner } from '@/utils/auth'
import {
  parseGoogleFormCsv,
  parseGoogleSheetRows,
  matchMasterData,
  type MasterRecord,
} from '@/utils/scan/fileConverter'

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

export type WorkRecordParams = {
  projectId:    string
  date:         string   // 'YYYY-MM-DD'
  startTime?:   string   // 'HH:MM'
  endTime?:     string   // 'HH:MM'
  breakMinutes?: number
  pieceCount?:  number
  note?:        string
  rawSpotText?: string   // 汎用スポット時のテキスト
}

export type CreateWorkRecordPayload = {
  contractor_id: string
  project_id:    string
  date:          string   // 'YYYY-MM-DD'
  quantity:      number
}

export type ImportEmergencyResult = {
  imported: number
  skipped:  number
  errors:   string[]
}

export type WorkRecordRow = {
  id:              string
  contractorId:    string
  projectId:       string | null
  date:            string
  startTime:       string | null
  endTime:         string | null
  breakMinutes:    number
  pieceCount:      number | null
  note:            string | null
  status:          string
  createdAt:       string
}

export type DuplicateGroup = {
  contractorId:   string
  contractorName: string
  projectId:      string
  projectName:    string
  date:           string
  records:        WorkRecordRow[]
}

// ── 重複検知ヘルパー（内部用） ──────────────────────────────

async function findDuplicates(
  db: any,
  contractorId: string,
  projectId: string,
  date: string,
  tenantId: string,
): Promise<WorkRecordRow[]> {
  const { data, error } = await db
    .from('work_records')
    .select('id, contractor_id, project_id, work_date, date, start_time, end_time, break_minutes, piece_count, note, status, created_at')
    .eq('contractor_id', contractorId)
    .eq('project_id', projectId)
    .eq('work_date', date)
    .eq('tenant_id', tenantId)
    .order('created_at', { ascending: true })

  if (error || !data?.length) return []

  return (data as any[]).map((r: any) => ({
    id:           r.id,
    contractorId: r.contractor_id,
    projectId:    r.project_id,
    date:         r.date ?? r.work_date,
    startTime:    r.start_time ?? null,
    endTime:      r.end_time ?? null,
    breakMinutes: r.break_minutes ?? 0,
    pieceCount:   r.piece_count ?? null,
    note:         r.note ?? null,
    status:       r.status ?? 'pending',
    createdAt:    r.created_at,
  }))
}

// ── しきい値ガード ──────────────────────────────────────────

function resolveWorkRecordStatus(quantity: number | null | undefined): string {
  return quantity != null && quantity > 100 ? 'pending_review' : 'pending'
}

// ================================================================
// createWorkRecord
// 管理画面・緊急インポート経由の実績登録（個数100超は pending_review）
// ================================================================
export async function createWorkRecord(
  payload: CreateWorkRecordPayload,
): Promise<ActionResult<{ id: string }>> {
  // 管理者専用（他人の委託先IDを指定して登録できるため owner 必須）
  const auth = await requireOwner()
  if (!auth.ok) return { data: null, error: auth.error }
  const todayJST = new Date().toLocaleDateString('sv-SE', { timeZone: 'Asia/Tokyo' })
  if (payload.date > todayJST) {
    return { data: null, error: '完了報告は当日までしか登録できません' }
  }

  const tenantId = await getCurrentTenantId()
  const db = createServiceClient() as any
  const status = resolveWorkRecordStatus(payload.quantity)

  const { data: inserted, error: insertErr } = await db
    .from('work_records')
    .insert({
      contractor_id: payload.contractor_id,
      project_id:    payload.project_id,
      work_date:     payload.date,
      date:          payload.date,
      piece_count:   payload.quantity,
      quantity:      payload.quantity,
      status,
      tenant_id:     tenantId,
    })
    .select('id')
    .single()

  if (insertErr || !inserted) {
    return { data: null, error: insertErr?.message ?? '登録に失敗しました' }
  }

  revalidatePath('/admin/dashboard')
  revalidatePath('/admin/sales')
  revalidatePath('/driver')

  return { data: { id: inserted.id }, error: null }
}

// ================================================================
// importEmergencyRecords
// Googleフォーム等のテキストをパースし createWorkRecord で一括登録
// ================================================================
export async function importEmergencyRecords(
  fileData: string,
  fileType: 'csv' | 'spreadsheet',
): Promise<ActionResult<ImportEmergencyResult>> {
  const tenantId = await getCurrentTenantId()
  const db = createServiceClient() as any

  const { data: contractorsRaw, error: cErr } = await db
    .from('contractors')
    .select('id, name')
    .eq('tenant_id', tenantId)

  if (cErr) return { data: null, error: cErr.message }

  const { data: projectsRaw, error: pErr } = await db
    .from('projects')
    .select('id, project_name, name')
    .eq('tenant_id', tenantId)

  if (pErr) return { data: null, error: pErr.message }

  const contractors: MasterRecord[] = (contractorsRaw ?? []).map((c: any) => ({
    id:   c.id,
    name: c.name,
  }))

  const projects: MasterRecord[] = (projectsRaw ?? []).map((p: any) => ({
    id:   p.id,
    name: p.project_name ?? p.name ?? p.id,
  }))

  let parseResult
  if (fileType === 'csv') {
    parseResult = parseGoogleFormCsv(fileData)
  } else {
    let rows: string[][]
    try {
      rows = JSON.parse(fileData) as string[][]
    } catch {
      rows = fileData
        .split(/\r?\n/)
        .filter((line) => line.trim())
        .map((line) => line.split('\t'))
    }
    parseResult = parseGoogleSheetRows(rows)
  }

  const errors = [...parseResult.parseErrors]
  const matched = matchMasterData(parseResult.records, contractors, projects)
  errors.push(...matched.matchErrors)

  let imported = 0
  let skipped = 0

  for (const rec of matched.records) {
    if (
      rec.needsManualReview ||
      !rec.contractorId ||
      !rec.projectId ||
      !rec.date ||
      rec.quantity == null
    ) {
      skipped++
      continue
    }

    const result = await createWorkRecord({
      contractor_id: rec.contractorId,
      project_id:    rec.projectId,
      date:          rec.date,
      quantity:      rec.quantity,
    })

    if (result.error) {
      errors.push(`行 ${rec.sourceRow ?? '?'}: ${result.error}`)
      skipped++
    } else {
      imported++
    }
  }

  revalidatePath('/admin/dashboard')
  revalidatePath('/admin/sales')

  return { data: { imported, skipped, errors }, error: null }
}

// ================================================================
// submitWorkRecord
// 子分アプリ「記録する」ボタンの送信先
//
// force=false（デフォルト）:
//   同一 contractor_id × date × project_id の重複を検知したら
//   { data: null, error: 'DUPLICATE_EXISTS' } を返し、
//   フロントエンドに確認モーダルを表示させる。
//
// force=true（ユーザーがモーダルで「登録する」を選択後）:
//   重複レコードを全件 DELETE してから新規 INSERT する。
// ================================================================
export async function submitWorkRecord(
  params: WorkRecordParams,
  options: { force?: boolean } = {},
): Promise<ActionResult<{ id: string; replaced: boolean }>> {
  const tenantId = await getCurrentTenantId()
  let contractorId: string | null

  const supabase = await createClient()
  const { data: { user }, error: authErr } = await supabase.auth.getUser()
  if (authErr || !user) return { data: null, error: '未ログインです' }
  contractorId = await resolveContractorId(user.id, user.email ?? undefined)
  if (!contractorId) return { data: null, error: '委託先レコードが見つかりません' }

  const todayJST = new Date().toLocaleDateString('sv-SE', { timeZone: 'Asia/Tokyo' })
  if (params.date > todayJST) {
    return { data: null, error: '完了報告は当日までしか登録できません' }
  }

  const db = createServiceClient() as any
  const existing = await findDuplicates(db, contractorId, params.projectId, params.date, tenantId)

  // 重複あり × force=false → フロントに確認モーダルを促す
  if (existing.length > 0 && !options.force) {
    return { data: null, error: 'DUPLICATE_EXISTS' }
  }

  // 重複あり × force=true → 古いレコードを全件削除
  let replaced = false
  if (existing.length > 0 && options.force) {
    const deleteIds = existing.map((r) => r.id)
    const { error: delErr } = await db
      .from('work_records')
      .delete()
      .in('id', deleteIds)
    if (delErr) return { data: null, error: `重複削除に失敗しました: ${delErr.message}` }
    replaced = true
  }

  // 新規 INSERT
  const pieceCount = params.pieceCount ?? null
  const status = resolveWorkRecordStatus(pieceCount)

  const { data: inserted, error: insertErr } = await db
    .from('work_records')
    .insert({
      contractor_id:  contractorId,
      project_id:     params.projectId,
      work_date:      params.date,
      date:           params.date,
      start_time:     params.startTime   ?? null,
      end_time:       params.endTime     ?? null,
      break_minutes:  params.breakMinutes ?? 0,
      piece_count:    pieceCount,
      note:           params.note        ?? null,
      raw_spot_text:  params.rawSpotText ?? null,
      status,
      tenant_id:      tenantId,
    })
    .select('id')
    .single()

  if (insertErr || !inserted) {
    return { data: null, error: insertErr?.message ?? '登録に失敗しました' }
  }

  revalidatePath('/driver')
  revalidatePath('/admin/sales')
  revalidatePath('/admin/dashboard')

  return { data: { id: inserted.id, replaced }, error: null }
}

// ================================================================
// getDuplicateInputs
// 親分ダッシュボード「🔴重複の疑い（二重登録検知）」アラート
// 同一 contractor_id × date × project_id が 2件以上の組み合わせを返す
// ================================================================
export async function getDuplicateInputs(): Promise<ActionResult<DuplicateGroup[]>> {
  const tenantId = await getCurrentTenantId()
  const db = createServiceClient() as any

  // 全 work_records を contractor_id + date(or work_date) + project_id で集計
  // Supabase REST では GROUP BY が直接使えないため、全件取得してサーバーサイドで集約する
  const { data, error } = await db
    .from('work_records')
    .select(`
      id,
      contractor_id,
      project_id,
      work_date,
      date,
      start_time,
      end_time,
      break_minutes,
      piece_count,
      note,
      status,
      created_at,
      contractors ( id, name ),
      projects    ( id, project_name, name )
    `)
    .eq('tenant_id', tenantId)
    .order('contractor_id', { ascending: true })
    .order('created_at',    { ascending: true })

  if (error) return { data: null, error: error.message }

  // contractor_id:date:project_id をキーにグループ化
  const groupMap = new Map<string, DuplicateGroup>()

  for (const r of (data ?? []) as any[]) {
    const recordDate   = r.date ?? r.work_date
    const key          = `${r.contractor_id}:${recordDate}:${r.project_id}`
    const row: WorkRecordRow = {
      id:           r.id,
      contractorId: r.contractor_id,
      projectId:    r.project_id,
      date:         recordDate,
      startTime:    r.start_time ?? null,
      endTime:      r.end_time   ?? null,
      breakMinutes: r.break_minutes ?? 0,
      pieceCount:   r.piece_count   ?? null,
      note:         r.note          ?? null,
      status:       r.status        ?? 'pending',
      createdAt:    r.created_at,
    }

    if (!groupMap.has(key)) {
      groupMap.set(key, {
        contractorId:   r.contractor_id,
        contractorName: r.contractors?.name ?? r.contractor_id,
        projectId:      r.project_id ?? '',
        projectName:    r.projects?.project_name ?? r.projects?.name ?? r.project_id ?? '',
        date:           recordDate,
        records:        [],
      })
    }
    groupMap.get(key)!.records.push(row)
  }

  // 2件以上あるグループだけを返す
  const duplicates = Array.from(groupMap.values()).filter((g) => g.records.length >= 2)

  return { data: duplicates, error: null }
}

// ================================================================
// resolveDuplicateRecord
// 親分ダッシュボードの左右比較UI: 指定 ID のレコードを DELETE
// ================================================================
export async function resolveDuplicateRecord(
  recordId: string,
): Promise<ActionResult> {
  const db = createServiceClient() as any

  const { error } = await db
    .from('work_records')
    .delete()
    .eq('id', recordId)

  if (error) return { data: null, error: error.message }

  revalidatePath('/admin/sales')
  revalidatePath('/admin/dashboard')

  return { data: undefined, error: null }
}

// ================================================================
// keepDuplicateRecord
// 指定 keepId のレコードを残し、deleteIds を全て DELETE
// ================================================================
export async function keepDuplicateRecord(
  keepId: string,
  deleteIds: string[],
): Promise<ActionResult> {
  if (deleteIds.length === 0) return { data: undefined, error: null }

  const db = createServiceClient() as any

  const { error } = await db
    .from('work_records')
    .delete()
    .in('id', deleteIds)

  if (error) return { data: null, error: error.message }

  revalidatePath('/admin/sales')
  revalidatePath('/admin/dashboard')

  return { data: undefined, error: null }
}

// ================================================================
// fetchWorkRecords
// 子分の月次実績一覧取得（明細画面用）
// ================================================================
export async function fetchWorkRecords(
  yearMonth: string,
): Promise<ActionResult<WorkRecordRow[]>> {
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
    .select('id, contractor_id, project_id, work_date, date, start_time, end_time, break_minutes, piece_count, note, status, created_at')
    .eq('contractor_id', contractorId)
    .eq('tenant_id', tenantId)
    .gte('work_date', from)
    .lte('work_date', to)
    .order('work_date', { ascending: false })

  if (error) return { data: null, error: error.message }

  return {
    data: (data ?? []).map((r: any) => ({
      id:           r.id,
      contractorId: r.contractor_id,
      projectId:    r.project_id,
      date:         r.date ?? r.work_date,
      startTime:    r.start_time ?? null,
      endTime:      r.end_time   ?? null,
      breakMinutes: r.break_minutes ?? 0,
      pieceCount:   r.piece_count   ?? null,
      note:         r.note          ?? null,
      status:       r.status        ?? 'pending',
      createdAt:    r.created_at,
    })),
    error: null,
  }
}

// ================================================================
// submitOffMasterReport
// 子分アプリ「突発案件」報告
// マスタにない急な仕事を案件名のみで報告する。
// project_id は null（マイグレーションで nullable 化済み）
// status = 'pending_review' でアドミンアラートに浮上する。
// ================================================================
export async function submitOffMasterReport(params: {
  date:    string   // 'YYYY-MM-DD'
  jobName: string   // 案件名テキスト（必須）
}): Promise<ActionResult<{ id: string }>> {
  const tenantId = await getCurrentTenantId()
  let contractorId: string | null

  const supabase = await createClient()
  const { data: { user }, error: authErr } = await supabase.auth.getUser()
  if (authErr || !user) return { data: null, error: '未ログインです' }
  contractorId = await resolveContractorId(user.id, user.email ?? undefined)
  if (!contractorId) return { data: null, error: '委託先レコードが見つかりません' }

  const todayJST = new Date().toLocaleDateString('sv-SE', { timeZone: 'Asia/Tokyo' })
  if (params.date > todayJST) {
    return { data: null, error: '完了報告は当日までしか登録できません' }
  }

  // NOTE: project_id を null で INSERT するため、migration で DROP NOT NULL 済みであること
  const db = createServiceClient() as any
  const { data, error } = await db
    .from('work_records')
    .insert({
      contractor_id:      contractorId,
      project_id:         null,
      work_date:          params.date,
      date:               params.date,
      is_off_master:      true,
      off_master_job_name: params.jobName,
      status:             'pending_review',  // アドミンアラートに浮上
      tenant_id:          tenantId,
    })
    .select('id')
    .single()

  if (error || !data) return { data: null, error: error?.message ?? '登録に失敗しました' }

  revalidatePath('/driver')
  revalidatePath('/admin/dashboard')

  return { data: { id: data.id }, error: null }
}
