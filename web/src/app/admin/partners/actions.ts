'use server'

import { createClient } from '@/utils/supabase/server'
import { createServiceClient } from '@/utils/supabase/service'
import type { Database } from '@/types/supabase'
import { getCurrentTenantId } from '@/utils/tenant'
import { requireOwner } from '@/utils/auth'
import { encryptBankFields, decryptBankFields } from '@/utils/crypto'

type ClientRow = Database['public']['Tables']['clients']['Row']
type ClientInsert = Database['public']['Tables']['clients']['Insert']
type ClientUpdate = Database['public']['Tables']['clients']['Update']
type ContractorRow = Database['public']['Tables']['contractors']['Row']
type ContractorInsert = Database['public']['Tables']['contractors']['Insert']
type ContractorUpdate = Database['public']['Tables']['contractors']['Update']
type ClientDepartmentRow = Database['public']['Tables']['client_departments']['Row']
type ClientDepartmentInsert = Database['public']['Tables']['client_departments']['Insert']
type ClientDepartmentUpdate = Database['public']['Tables']['client_departments']['Update']

type ActionResult<T> = { data: T; error: null } | { data: null; error: string }

function translateDbError(msg: string): string {
  if (msg.includes('foreign key constraint')) return '他のデータから参照されているため削除できません'
  if (msg.includes('duplicate key') || msg.includes('unique constraint')) return '同じデータが既に登録されています'
  if (msg.includes('violates not-null constraint')) return '必須項目が入力されていません'
  return msg
}

// ── Clients ────────────────────────────────────────────────

export async function fetchClients(): Promise<ActionResult<ClientRow[]>> {
  const auth = await requireOwner()
  if (!auth.ok) return { data: null, error: auth.error }
  const tenantId = await getCurrentTenantId()
  const supabase = createServiceClient()
  const { data, error } = await supabase
    .from('clients')
    .select('*')
    .eq('tenant_id', tenantId)
    .order('created_at', { ascending: false })
  if (error) return { data: null, error: error.message }
  return { data: (data ?? []).map(decryptBankFields), error: null }
}

export async function createClient_(payload: ClientInsert): Promise<ActionResult<ClientRow>> {
  const auth = await requireOwner()
  if (!auth.ok) return { data: null, error: auth.error }
  const tenantId = await getCurrentTenantId()
  const supabase = createServiceClient()
  const { data, error } = await supabase
    .from('clients')
    .insert({ ...encryptBankFields(payload), tenant_id: tenantId })
    .select()
    .single()
  if (error) return { data: null, error: error.message }
  return { data: decryptBankFields(data), error: null }
}

export async function deleteClient(clientId: string): Promise<ActionResult<null>> {
  const auth = await requireOwner()
  if (!auth.ok) return { data: null, error: auth.error }
  const tenantId = await getCurrentTenantId()
  const supabase = createServiceClient()
  const { count } = await supabase
    .from('projects')
    .select('id', { count: 'exact', head: true })
    .eq('client_id', clientId)
    .eq('tenant_id', tenantId)
  if ((count ?? 0) > 0) {
    return { data: null, error: '案件が登録されているため削除できません' }
  }
  const { error } = await supabase
    .from('clients')
    .delete()
    .eq('id', clientId)
    .eq('tenant_id', tenantId)
  if (error) return { data: null, error: translateDbError(error.message) }
  return { data: null, error: null }
}

export async function updateClient(id: string, payload: ClientUpdate): Promise<ActionResult<ClientRow>> {
  const auth = await requireOwner()
  if (!auth.ok) return { data: null, error: auth.error }
  const tenantId = await getCurrentTenantId()
  const supabase = createServiceClient()
  const { data, error } = await supabase
    .from('clients')
    .update(encryptBankFields(payload))
    .eq('id', id)
    .eq('tenant_id', tenantId)
    .select()
    .single()
  if (error) return { data: null, error: error.message }
  return { data: decryptBankFields(data), error: null }
}

// ── Contractors ────────────────────────────────────────────

export async function fetchContractors(): Promise<ActionResult<ContractorRow[]>> {
  const auth = await requireOwner()
  if (!auth.ok) return { data: null, error: auth.error }
  const tenantId = await getCurrentTenantId()
  const supabase = createServiceClient()
  const { data, error } = await supabase
    .from('contractors')
    .select('*')
    .eq('tenant_id', tenantId)
    .order('created_at', { ascending: false })
  if (error) return { data: null, error: error.message }
  return { data: (data ?? []).map(decryptBankFields), error: null }
}

// ⚠️ 源泉徴収は v1.6 で凍結中（軽貨物の外注報酬は所法204条の列挙外で源泉対象外）。
//    payment_notices に源泉列が無く、ON の委託先を作ると OUT 支払一覧（10.21%控除）と
//    支払通知書で金額が食い違うため、フラグの有効化は fail-closed で拒否する。
//    解凍するときは通知書側の設計（列追加・PDF反映・本番マイグレーション）とセットで行うこと。
function rejectFrozenWithholding(payload: { has_withholding?: boolean }): string | null {
  if (payload.has_withholding === true) {
    return '源泉徴収フラグは凍結中のため有効化できません（軽貨物の外注報酬は源泉対象外）。'
  }
  return null
}

export async function createContractor(payload: ContractorInsert): Promise<ActionResult<ContractorRow>> {
  const auth = await requireOwner()
  if (!auth.ok) return { data: null, error: auth.error }
  const frozenErr = rejectFrozenWithholding(payload)
  if (frozenErr) return { data: null, error: frozenErr }
  const tenantId = await getCurrentTenantId()
  const supabase = createServiceClient()
  const { data, error } = await supabase
    .from('contractors')
    .insert({ ...encryptBankFields(payload), tenant_id: tenantId })
    .select()
    .single()
  if (error) return { data: null, error: error.message }
  return { data: decryptBankFields(data), error: null }
}

export async function deleteContractor(contractorId: string): Promise<ActionResult<null>> {
  const auth = await requireOwner()
  if (!auth.ok) return { data: null, error: auth.error }
  const tenantId = await getCurrentTenantId()
  const supabase = createServiceClient()

  const [{ count: projectCount }, { count: noticeCount }] = await Promise.all([
    supabase.from('projects').select('id', { count: 'exact', head: true })
      .eq('contractor_id', contractorId).eq('tenant_id', tenantId),
    supabase.from('payment_notices').select('id', { count: 'exact', head: true })
      .eq('contractor_id', contractorId),
  ])
  if ((projectCount ?? 0) > 0) return { data: null, error: '案件が登録されているため削除できません' }
  if ((noticeCount ?? 0) > 0) return { data: null, error: '支払通知書が存在するため削除できません' }

  const { error } = await supabase
    .from('contractors')
    .delete()
    .eq('id', contractorId)
    .eq('tenant_id', tenantId)
  if (error) return { data: null, error: translateDbError(error.message) }
  return { data: null, error: null }
}

export async function updateContractor(id: string, payload: ContractorUpdate): Promise<ActionResult<ContractorRow>> {
  const auth = await requireOwner()
  if (!auth.ok) return { data: null, error: auth.error }
  const frozenErr = rejectFrozenWithholding(payload)
  if (frozenErr) return { data: null, error: frozenErr }
  const tenantId = await getCurrentTenantId()
  const supabase = createServiceClient()
  const { data, error } = await supabase
    .from('contractors')
    .update(encryptBankFields(payload))
    .eq('id', id)
    .eq('tenant_id', tenantId)
    .select()
    .single()
  if (error) return { data: null, error: error.message }
  return { data: decryptBankFields(data), error: null }
}

// ── Client Departments（取引先の部署） ──────────────────────

export async function fetchClientDepartments(
  clientId: string,
): Promise<ActionResult<ClientDepartmentRow[]>> {
  const auth = await requireOwner()
  if (!auth.ok) return { data: null, error: auth.error }
  const tenantId = await getCurrentTenantId()
  const supabase = createServiceClient()
  const { data, error } = await supabase
    .from('client_departments')
    .select('*')
    .eq('client_id', clientId)
    .eq('tenant_id', tenantId)
    .order('sort_order', { ascending: true })
    .order('created_at', { ascending: true })
  if (error) return { data: null, error: translateDbError(error.message) }
  return { data: data ?? [], error: null }
}

export async function createClientDepartment(
  payload: ClientDepartmentInsert,
): Promise<ActionResult<ClientDepartmentRow>> {
  const auth = await requireOwner()
  if (!auth.ok) return { data: null, error: auth.error }
  const tenantId = await getCurrentTenantId()
  const supabase = createServiceClient()
  // ⚠️ tenant_id は text。呼び出し側の値を信用せず必ずサーバ側で上書きする
  const { data, error } = await supabase
    .from('client_departments')
    .insert({ ...payload, tenant_id: tenantId })
    .select()
    .single()
  if (error) return { data: null, error: translateDbError(error.message) }
  return { data, error: null }
}

export async function updateClientDepartment(
  id: string,
  payload: ClientDepartmentUpdate,
): Promise<ActionResult<ClientDepartmentRow>> {
  const auth = await requireOwner()
  if (!auth.ok) return { data: null, error: auth.error }
  const tenantId = await getCurrentTenantId()
  const supabase = createServiceClient()
  // tenant_id / client_id はクライアントから変更させない
  const { tenant_id: _t, client_id: _c, ...safe } = payload
  const { data, error } = await supabase
    .from('client_departments')
    .update(safe)
    .eq('id', id)
    .eq('tenant_id', tenantId)
    .select()
    .single()
  if (error) return { data: null, error: translateDbError(error.message) }
  return { data, error: null }
}

export async function deleteClientDepartment(id: string): Promise<ActionResult<null>> {
  const auth = await requireOwner()
  if (!auth.ok) return { data: null, error: auth.error }
  const tenantId = await getCurrentTenantId()
  const supabase = createServiceClient()
  // ⚠️ invoices.department_id は ON DELETE RESTRICT。
  //    確定済み請求書がぶら下がっている部署は削除できず、
  //    translateDbError が「他のデータから参照されているため削除できません」を返す。
  const { error } = await supabase
    .from('client_departments')
    .delete()
    .eq('id', id)
    .eq('tenant_id', tenantId)
  if (error) return { data: null, error: translateDbError(error.message) }
  return { data: null, error: null }
}

/**
 * 部署が未割当の案件件数を返す。
 * use_departments = true の荷主でこれが 0 より大きいと、
 * その案件は「どの請求書にも入らない」＝売上が漏れる状態になる。
 */
export async function countUnassignedProjects(
  clientId: string,
): Promise<ActionResult<number>> {
  const auth = await requireOwner()
  if (!auth.ok) return { data: null, error: auth.error }
  const tenantId = await getCurrentTenantId()
  const supabase = createServiceClient()
  const { count, error } = await supabase
    .from('projects')
    .select('id', { count: 'exact', head: true })
    .eq('client_id', clientId)
    .eq('tenant_id', tenantId)
    .is('department_id', null) // ⚠️ .eq(..., null) は動かない。必ず .is() を使う
  if (error) return { data: null, error: translateDbError(error.message) }
  return { data: count ?? 0, error: null }
}
