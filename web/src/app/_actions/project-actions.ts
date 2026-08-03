'use server'

import { createClient } from '@/utils/supabase/server'
import { createServiceClient } from '@/utils/supabase/service'
import { requireOwner } from '@/utils/auth'
import { getCurrentTenantId } from '@/utils/tenant'

type ActionResult<T = void> =
  | { data: T; error: null }
  | { data: null; error: string }

// ── 突発案件（マスタ未紐付け）集計型 ──────────────────────

/**
 * ⚠️ 金額は持たない。
 * `work_records` に `tax_excluded_sales` / `tax_excluded_payment` は存在せず
 * （2026-08-02 に判明。§5-4 参照）、金額は `price_rules` から都度計算する仕組みだが、
 * 未紐付けスポットは `project_id` が null ＝ price_rules を引けない。
 * ¥0 と表示すると「売上ゼロの案件」に見えて誤解を生むため、金額そのものを返さない。
 */
export type SpotGroup = {
  groupKey:         string   // 画面上の一意キー（案件名 or 記録IDフォールバック）
  jobName:          string | null  // off_master_job_name（ドライバー入力の突発案件名）
  recordCount:      number
  contractorNames:  string[]
  earliestDate:     string   // YYYY-MM-DD
  latestDate:       string   // YYYY-MM-DD
  recordIds:        string[] // 対象 work_record id 一覧
}

// ── 未紐付けスポットの一覧取得 ────────────────────────────

/**
 * 突発案件（`is_off_master = true`）かつ案件マスタ未紐付け（`project_id IS NULL`）の
 * work_records を、突発案件名でグループ化して返す。
 *
 * ⚠️ 検知条件は `workRecordActions.ts` の突発案件登録（is_off_master / off_master_job_name を
 * 書き込む経路）と対になっている。片方だけ変えないこと。
 */
export async function fetchUnassignedSpots(): Promise<ActionResult<SpotGroup[]>> {
  const tenantId = await getCurrentTenantId()
  const supabase = await createClient()
  const { data: { user }, error: authErr } = await supabase.auth.getUser()
  if (authErr || !user) return { data: null, error: '認証が必要です' }
  const __owner = await requireOwner()
  if (!__owner.ok) return { data: null, error: __owner.error }

  const service = createServiceClient()

  const { data, error } = await service
    .from('work_records')
    .select('id, off_master_job_name, raw_spot_text, work_date, contractors(name)')
    .eq('tenant_id', tenantId)
    .eq('is_off_master', true)
    .is('project_id', null)
    .order('work_date', { ascending: true })

  if (error) return { data: null, error: error.message }

  const groupMap = new Map<string, SpotGroup>()

  for (const r of data ?? []) {
    const jobName = (r.off_master_job_name ?? r.raw_spot_text) || null
    // 名称が無い記録は他とまとめず1件ずつ独立させる（別々の仕事を誤って合体させないため）
    const key = jobName ?? `__unnamed__:${r.id}`
    if (!groupMap.has(key)) {
      groupMap.set(key, {
        groupKey:        key,
        jobName,
        recordCount:     0,
        contractorNames: [],
        earliestDate:    r.work_date,
        latestDate:      r.work_date,
        recordIds:       [],
      })
    }
    const g = groupMap.get(key)!
    g.recordCount++
    const cRaw = r.contractors as { name: string } | { name: string }[] | null
    const cName = Array.isArray(cRaw) ? cRaw[0]?.name : cRaw?.name
    if (cName && !g.contractorNames.includes(cName)) g.contractorNames.push(cName)
    if (r.work_date < g.earliestDate) g.earliestDate = r.work_date
    if (r.work_date > g.latestDate)   g.latestDate   = r.work_date
    g.recordIds.push(r.id)
  }

  return { data: Array.from(groupMap.values()), error: null }
}

// ── スポットを正式案件マスタへ昇格 ───────────────────────

export type PromoteSpotParams = {
  recordIds:     string[]   // fetchUnassignedSpots が返した対象 work_record id
  clientId:      string
  projectName:   string
  saleAmount:    number
  buyAmount:     number
  unitType:      string
}

/**
 * 突発案件の記録を正式案件マスタへ昇格する。
 *   1. projects に新規 INSERT（project_code を自動生成）
 *   2. 該当 work_records の project_id を新案件 id へ一括 UPDATE ＋ is_off_master を降ろす
 *
 * ⚠️ 対象は「一覧で表示した record id」で指定する。案件名で引き直すと、
 *    名称が空の記録や同名の別グループを巻き込む恐れがあるため。
 */
export async function promoteSpotToOfficialProject(
  params: PromoteSpotParams,
): Promise<ActionResult<{ projectId: string; updatedCount: number }>> {
  const tenantId = await getCurrentTenantId()
  const supabase = await createClient()
  const { data: { user }, error: authErr } = await supabase.auth.getUser()
  if (authErr || !user) return { data: null, error: '認証が必要です' }
  const __owner = await requireOwner()
  if (!__owner.ok) return { data: null, error: __owner.error }

  const recordIds = Array.from(new Set(params.recordIds ?? []))
  if (recordIds.length === 0) {
    return { data: null, error: '昇格対象の記録がありません' }
  }

  const service = createServiceClient()

  // 自動採番: SP-YYYYMMDD-XXXXX
  const now      = new Date()
  const datePart = `${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, '0')}${String(now.getDate()).padStart(2, '0')}`
  const randPart = Math.random().toString(36).slice(2, 7).toUpperCase()
  const projectCode = `SP-${datePart}-${randPart}`

  // 新規案件マスタを INSERT
  const { data: newProject, error: insertErr } = await service
    .from('projects')
    .insert({
      client_id:    params.clientId,
      project_code: projectCode,
      project_name: params.projectName,
      sale_amount:  params.saleAmount,
      buy_amount:   params.buyAmount,
      unit_type:    params.unitType,
      status:       'active',
      tenant_id:    tenantId,
    })
    .select('id')
    .single()

  if (insertErr || !newProject) {
    return { data: null, error: insertErr?.message ?? '案件マスタの作成に失敗しました' }
  }

  // 対象 work_records を一括 UPDATE（project_id の紐付け＋突発フラグを降ろす）
  // ⚠️ tenant_id と project_id IS NULL の条件は必ず残すこと（他テナント・紐付け済みの巻き添え防止）
  // off_master_job_name は消さない（元がどの突発案件だったかを追えるようにするため）
  const { data: updated, error: updateErr } = await service
    .from('work_records')
    .update({ project_id: newProject.id, is_off_master: false })
    .in('id', recordIds)
    .eq('tenant_id', tenantId)
    .is('project_id', null)
    .select('id')

  if (updateErr) {
    return {
      data: null,
      error: `案件マスタは作成しましたが紐付けに失敗しました: ${updateErr.message}`,
    }
  }

  return {
    data: { projectId: newProject.id, updatedCount: updated?.length ?? 0 },
    error: null,
  }
}
