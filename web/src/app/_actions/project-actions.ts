'use server'

import { createClient } from '@/utils/supabase/server'
import { createServiceClient } from '@/utils/supabase/service'
import { requireOwner } from '@/utils/auth'
import { getCurrentTenantId } from '@/utils/tenant'

type ActionResult<T = void> =
  | { data: T; error: null }
  | { data: null; error: string }

// ── 汎用スポット集計型 ────────────────────────────────────

export type SpotGroup = {
  spotGenericId:    string    // work_records.spot_generic_id の値（テキスト）
  recordCount:      number
  contractorNames:  string[]
  earliestDate:     string   // YYYY-MM-DD
  latestDate:       string   // YYYY-MM-DD
  totalSales:       number   // tax_excluded_sales 合計
  totalPayment:     number   // tax_excluded_payment 合計
  recordIds:        string[] // 対象 work_record id 一覧
}

// ── 未紐付けスポットの一覧取得 ────────────────────────────

/**
 * project_id が未設定かつ spot_generic_id がある work_records を
 * spot_generic_id でグループ化して返す。
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
    .select('id, spot_generic_id, work_date, tax_excluded_sales, tax_excluded_payment, contractors(name)')
    .eq('tenant_id', tenantId)
    .not('spot_generic_id', 'is', null)
    .is('project_id', null)
    .order('work_date', { ascending: true })

  if (error) return { data: null, error: error.message }

  const groupMap = new Map<string, SpotGroup>()

  for (const r of data ?? []) {
    const key = r.spot_generic_id as string
    if (!groupMap.has(key)) {
      groupMap.set(key, {
        spotGenericId:   key,
        recordCount:     0,
        contractorNames: [],
        earliestDate:    r.work_date,
        latestDate:      r.work_date,
        totalSales:      0,
        totalPayment:    0,
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
    g.totalSales   += r.tax_excluded_sales
    g.totalPayment += r.tax_excluded_payment
    g.recordIds.push(r.id)
  }

  return { data: Array.from(groupMap.values()), error: null }
}

// ── スポットを正式案件マスタへ昇格 ───────────────────────

export type PromoteSpotParams = {
  spotGenericId: string
  clientId:      string
  projectName:   string
  saleAmount:    number
  buyAmount:     number
  unitType:      string
}

/**
 * 汎用スポット記録を正式案件マスタへ昇格する。
 *   1. projects に新規 INSERT（project_code を自動生成）
 *   2. 該当 work_records の project_id を新案件 id へ一括 UPDATE
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

  // 対象 work_records を一括 UPDATE（project_id の紐付け直し）
  const { data: updated, error: updateErr } = await service
    .from('work_records')
    .update({ project_id: newProject.id })
    .eq('spot_generic_id', params.spotGenericId)
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
