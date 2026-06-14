'use server'

import { createClient } from '@/utils/supabase/server'
import { createServiceClient } from '@/utils/supabase/service'
import type { Database } from '@/types/supabase'
import { getCurrentTenantId } from '@/utils/tenant'

type ProjectRow    = Database['public']['Tables']['projects']['Row']
type ProjectInsert = Database['public']['Tables']['projects']['Insert']
type ProjectUpdate = Database['public']['Tables']['projects']['Update']
export type ClientRow     = Database['public']['Tables']['clients']['Row']
export type ContractorRow = Database['public']['Tables']['contractors']['Row']

// projects + joined client.company_name + contractor.name
export type ProjectWithRelations = ProjectRow & {
  client_name: string | null
  contractor_name: string | null
  selling_price: number
}

type ActionResult<T> = { data: T; error: null } | { data: null; error: string }

// ── Projects ───────────────────────────────────────────────

export async function fetchProjects(): Promise<ActionResult<ProjectWithRelations[]>> {
  const tenantId = await getCurrentTenantId()
  const supabase = createServiceClient()

  const [projectsRes, payeesRes, contractorsRes] = await Promise.all([
    supabase
      .from('projects')
      .select('*, clients ( company_name ), price_rules ( selling_price )')
      .eq('tenant_id', tenantId)
      .order('created_at', { ascending: false }),
    supabase
      .from('project_payees')
      .select('project_id, payee_contractor_id'),
    supabase
      .from('contractors')
      .select('id, name'),
  ])

  if (projectsRes.error) return { data: null, error: projectsRes.error.message }

  const contractorMap = new Map<string, string>(
    (contractorsRes.data ?? []).map(c => [c.id, c.name])
  )
  const payeeMap = new Map<string, string>(
    (payeesRes.data ?? []).map(p => [p.project_id, p.payee_contractor_id])
  )

  const rows: ProjectWithRelations[] = (projectsRes.data ?? []).map((r) => {
    const raw = r as typeof r & {
      clients: { company_name: string } | null
      price_rules: { selling_price: number }[]
      status?: string
    }
    const { clients, price_rules, ...rest } = raw
    const payeeId = payeeMap.get(r.id) ?? null
    return {
      ...rest,
      status: raw.status ?? 'accepted',
      client_name: clients?.company_name ?? null,
      contractor_name: payeeId ? (contractorMap.get(payeeId) ?? null) : null,
      selling_price: price_rules?.[0]?.selling_price ?? 0,
    }
  })

  return { data: rows, error: null }
}

export async function createProject(payload: ProjectInsert): Promise<ActionResult<ProjectRow>> {
  const tenantId = await getCurrentTenantId()
  const supabase = await createClient()
  const { data, error } = await supabase
    .from('projects')
    .insert({ ...payload, tenant_id: tenantId })
    .select()
    .single()
  if (error) return { data: null, error: error.message }
  return { data, error: null }
}

export async function updateProject(id: string, payload: ProjectUpdate): Promise<ActionResult<ProjectRow>> {
  const tenantId = await getCurrentTenantId()
  const supabase = await createClient()
  const { data, error } = await supabase
    .from('projects')
    .update(payload)
    .eq('id', id)
    .eq('tenant_id', tenantId)
    .select()
    .single()
  if (error) return { data: null, error: error.message }
  return { data, error: null }
}

// ── Master lookups ─────────────────────────────────────────

export async function fetchClientOptions(): Promise<ActionResult<Pick<ClientRow, 'id' | 'company_name'>[]>> {
  const tenantId = await getCurrentTenantId()
  const supabase = await createClient()
  const { data, error } = await supabase
    .from('clients')
    .select('id, company_name')
    .eq('tenant_id', tenantId)
    .order('company_name')
  if (error) return { data: null, error: error.message }
  return { data: data ?? [], error: null }
}

export async function fetchContractorOptions(): Promise<ActionResult<Pick<ContractorRow, 'id' | 'name'>[]>> {
  const tenantId = await getCurrentTenantId()
  const supabase = createServiceClient()
  const { data, error } = await supabase
    .from('contractors')
    .select('id, name')
    .eq('tenant_id', tenantId)
    .order('name')
  if (error) return { data: null, error: error.message }
  return { data: data ?? [], error: null }
}
