'use server'

import { requireOperator } from '@/utils/operator'
import {
  validateAndConvert,
  departmentKey,
  projectKey,
  buildProjectCodes,
  type ImportFile,
  type RowError,
} from '@/utils/partner-import'
import {
  createClient_,
  createClientDepartment,
  createContractor,
  fetchClientDepartments,
  fetchClients,
  fetchContractors,
} from '@/app/admin/partners/actions'
import { createProject, fetchProjectsForImport } from '@/app/admin/projects/actions'
import type { Database } from '@/types/supabase'

type ClientInsert = Database['public']['Tables']['clients']['Insert']
type ContractorInsert = Database['public']['Tables']['contractors']['Insert']
type ClientDepartmentInsert = Database['public']['Tables']['client_departments']['Insert']

export type ImportResult =
  | { ok: true; inserted: { clients: number; departments: number; contractors: number; projects: number } }
  | { ok: false; errors: RowError[]; fatal?: string }

/**
 * 取引先一括インポート（運営者専用・初期投入用）。
 * 全行の検証が通ってから挿入を開始する。挿入は既存アクション経由のみ
 * （口座4項目の暗号化・tenant_id付与はそちらが行う。ここでDB直挿入しないこと）。
 */
export async function importPartners(file: ImportFile): Promise<ImportResult> {
  const auth = await requireOperator()
  if (!auth.ok) return { ok: false, errors: [], fatal: auth.error }

  // 既存データとの重複検査用セット（復号は不要なので名前・メールのみ使う）
  const [clientsRes, contractorsRes] = await Promise.all([fetchClients(), fetchContractors()])
  if (clientsRes.error) return { ok: false, errors: [], fatal: clientsRes.error }
  if (contractorsRes.error) return { ok: false, errors: [], fatal: contractorsRes.error }

  // 部署の重複検査用: 既存クライアント全件の部署を並列取得する（初期投入用途のため件数は少ない前提）。
  const existingClients = clientsRes.data ?? []
  const departmentResults = await Promise.all(
    existingClients.map(c => fetchClientDepartments(c.id)),
  )
  const departmentsError = departmentResults.find(r => r.error)?.error
  if (departmentsError) return { ok: false, errors: [], fatal: departmentsError }

  const departmentKeys = existingClients.flatMap((c, i) =>
    (departmentResults[i].data ?? []).map(d => departmentKey(c.company_name, d.name)),
  )

  const projectsRes = await fetchProjectsForImport()
  if (projectsRes.error) return { ok: false, errors: [], fatal: projectsRes.error }
  const existingProjects = projectsRes.data ?? []

  const validated = validateAndConvert(file, {
    clientNames: existingClients.map(c => c.company_name),
    contractorNames: (contractorsRes.data ?? []).map(c => c.name),
    contractorEmails: (contractorsRes.data ?? []).map(c => c.email),
    departmentKeys,
    clientUseDepartments: Object.fromEntries(
      existingClients.map(c => [c.company_name, !!(c as { use_departments?: boolean }).use_departments]),
    ),
    projectKeys: existingProjects.map(p => projectKey(p.client_name, p.department_name, p.project_name)),
  })
  if (!validated.data) return { ok: false, errors: validated.errors }

  const { clients, departments, contractors, projects } = validated.data
  const inserted = { clients: 0, departments: 0, contractors: 0, projects: 0 }

  // ⚠️ Supabase Server Action 経由ではトランザクション不可。
  //    途中失敗時は何件目まで入ったかを返し、再実行は重複検査が防波堤になる（設計書参照）。
  const clientIdByName = new Map<string, string>()
  for (const c of clientsRes.data ?? []) clientIdByName.set(c.company_name, c.id)

  // 案件の紐づけ用IDマップ。既存分と今回登録した分の両方を含める
  const departmentIdByKey = new Map<string, string>()
  for (const [i, c] of existingClients.entries()) {
    for (const d of departmentResults[i].data ?? []) {
      departmentIdByKey.set(departmentKey(c.company_name, d.name), d.id)
    }
  }

  for (const payload of clients) {
    const r = await createClient_(payload as ClientInsert)
    if (r.error) return partialFailure('請求先', inserted, r.error)
    clientIdByName.set(r.data!.company_name, r.data!.id)
    inserted.clients++
  }
  for (const d of departments) {
    const clientId = clientIdByName.get(d.clientName)
    if (!clientId) return partialFailure('部署', inserted, `請求先「${d.clientName}」の解決に失敗しました`)
    const r = await createClientDepartment({ ...d.payload, client_id: clientId } as ClientDepartmentInsert)
    if (r.error) return partialFailure('部署', inserted, r.error)
    departmentIdByKey.set(departmentKey(d.clientName, String(d.payload.name)), r.data!.id)
    inserted.departments++
  }
  for (const payload of contractors) {
    const r = await createContractor(payload as ContractorInsert)
    if (r.error) return partialFailure('委託先', inserted, r.error)
    inserted.contractors++
  }

  const contractorIdByName = new Map<string, string>()
  for (const c of contractorsRes.data ?? []) contractorIdByName.set(c.name, c.id)

  const codes = buildProjectCodes(existingProjects.map(p => p.project_code), projects.length)

  for (const [i, p] of projects.entries()) {
    const clientId = clientIdByName.get(p.clientName)
    if (!clientId) return partialFailure('案件', inserted, `荷主「${p.clientName}」の解決に失敗しました`)

    let departmentId: string | null = null
    if (p.departmentName) {
      departmentId = departmentIdByKey.get(departmentKey(p.clientName, p.departmentName)) ?? null
      if (!departmentId) return partialFailure('案件', inserted, `部署「${p.departmentName}」の解決に失敗しました`)
    }

    let contractorId: string | null = null
    if (p.contractorName) {
      contractorId = contractorIdByName.get(p.contractorName) ?? null
      if (!contractorId) return partialFailure('案件', inserted, `委託先「${p.contractorName}」の解決に失敗しました`)
    }

    const r = await createProject({
      ...p.payload,
      project_code: codes[i],
      client_id: clientId,
      department_id: departmentId,
      contractor_id: contractorId,
    } as Parameters<typeof createProject>[0])
    if (r.error) return partialFailure('案件', inserted, r.error)
    inserted.projects++
  }

  return { ok: true, inserted }
}

function partialFailure(
  sheet: string,
  inserted: { clients: number; departments: number; contractors: number; projects: number },
  message: string,
): ImportResult {
  return {
    ok: false,
    errors: [],
    fatal:
      `${sheet}の挿入中にエラー: ${message}\n` +
      `ここまでの登録: 請求先${inserted.clients}件・部署${inserted.departments}件・` +
      `委託先${inserted.contractors}件・案件${inserted.projects}件。` +
      `登録済み分は重複検査で弾かれるため、残りだけのファイルを作り再実行してください。`,
  }
}
