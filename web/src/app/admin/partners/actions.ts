'use server'

import { createClient } from '@/utils/supabase/server'
import { createServiceClient } from '@/utils/supabase/service'
import type { Database } from '@/types/supabase'
import { getCurrentTenantId } from '@/utils/tenant'
import { requireOwner } from '@/utils/auth'

type ClientRow = Database['public']['Tables']['clients']['Row']
type ClientInsert = Database['public']['Tables']['clients']['Insert']
type ClientUpdate = Database['public']['Tables']['clients']['Update']
type ContractorRow = Database['public']['Tables']['contractors']['Row']
type ContractorInsert = Database['public']['Tables']['contractors']['Insert']
type ContractorUpdate = Database['public']['Tables']['contractors']['Update']

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
  return { data, error: null }
}

export async function createClient_(payload: ClientInsert): Promise<ActionResult<ClientRow>> {
  const auth = await requireOwner()
  if (!auth.ok) return { data: null, error: auth.error }
  const tenantId = await getCurrentTenantId()
  const supabase = createServiceClient()
  const { data, error } = await supabase
    .from('clients')
    .insert({ ...payload, tenant_id: tenantId })
    .select()
    .single()
  if (error) return { data: null, error: error.message }
  return { data, error: null }
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
    .update(payload)
    .eq('id', id)
    .eq('tenant_id', tenantId)
    .select()
    .single()
  if (error) return { data: null, error: error.message }
  return { data, error: null }
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
  return { data, error: null }
}

export async function createContractor(payload: ContractorInsert): Promise<ActionResult<ContractorRow>> {
  const auth = await requireOwner()
  if (!auth.ok) return { data: null, error: auth.error }
  const tenantId = await getCurrentTenantId()
  const supabase = createServiceClient()
  const { data, error } = await supabase
    .from('contractors')
    .insert({ ...payload, tenant_id: tenantId })
    .select()
    .single()
  if (error) return { data: null, error: error.message }
  return { data, error: null }
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
  const tenantId = await getCurrentTenantId()
  const supabase = createServiceClient()
  const { data, error } = await supabase
    .from('contractors')
    .update(payload)
    .eq('id', id)
    .eq('tenant_id', tenantId)
    .select()
    .single()
  if (error) return { data: null, error: error.message }
  return { data, error: null }
}
