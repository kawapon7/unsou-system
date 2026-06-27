'use server'

import { createClient } from '@/utils/supabase/server'
import { createServiceClient } from '@/utils/supabase/service'
import type { Database } from '@/types/supabase'
import { getCurrentTenantId } from '@/utils/tenant'
import { requireOwner } from '@/utils/auth'

type ProjectRow    = Database['public']['Tables']['projects']['Row']
type ProjectInsert = Database['public']['Tables']['projects']['Insert']
type ProjectUpdate = Database['public']['Tables']['projects']['Update']
export type ClientRow     = Database['public']['Tables']['clients']['Row']
export type ContractorRow = Database['public']['Tables']['contractors']['Row']

// projects + joined client.company_name + auto-status inputs
export type ProjectWithRelations = ProjectRow & {
  client_name: string | null
  selling_price: number
  work_record_count: number
}

type ActionResult<T> = { data: T; error: null } | { data: null; error: string }

// ── Projects ───────────────────────────────────────────────

export async function fetchProjects(): Promise<ActionResult<ProjectWithRelations[]>> {
  const auth = await requireOwner()
  if (!auth.ok) return { data: null, error: auth.error }
  const tenantId = await getCurrentTenantId()
  const supabase = createServiceClient()

  const [projectsRes, workRes] = await Promise.all([
    supabase
      .from('projects')
      .select('*, clients ( company_name ), price_rules ( selling_price )')
      .eq('tenant_id', tenantId)
      .order('created_at', { ascending: false }),
    supabase
      .from('work_records')
      .select('project_id')
      .eq('tenant_id', tenantId),
  ])

  if (projectsRes.error) return { data: null, error: projectsRes.error.message }

  const workCountMap = new Map<string, number>()
  for (const w of workRes.data ?? []) {
    if (w.project_id) workCountMap.set(w.project_id, (workCountMap.get(w.project_id) ?? 0) + 1)
  }

  const rows: ProjectWithRelations[] = (projectsRes.data ?? []).map((r) => {
    const raw = r as typeof r & {
      clients: { company_name: string } | null
      price_rules: { selling_price: number }[]
      status?: string
    }
    const { clients, price_rules, ...rest } = raw
    return {
      ...rest,
      status: raw.status ?? 'accepted',
      client_name: clients?.company_name ?? null,
      selling_price: price_rules?.[0]?.selling_price ?? 0,
      work_record_count: workCountMap.get(r.id) ?? 0,
    }
  })

  return { data: rows, error: null }
}

export async function createProject(payload: ProjectInsert): Promise<ActionResult<ProjectRow>> {
  const auth = await requireOwner()
  if (!auth.ok) return { data: null, error: auth.error }
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
  const auth = await requireOwner()
  if (!auth.ok) return { data: null, error: auth.error }
  const tenantId = await getCurrentTenantId()
  const supabase = createServiceClient()
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
  const auth = await requireOwner()
  if (!auth.ok) return { data: null, error: auth.error }
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
  const auth = await requireOwner()
  if (!auth.ok) return { data: null, error: auth.error }
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

// ── Project Payees ─────────────────────────────────────────

export type ProjectPayee = {
  id:                        string
  contractor_id:             string
  contractor_name:           string
  payment_type:              string
  unit_price:                number | null
  tax_method:                string
  rounding_rule:             string
  adjustment_enabled:        boolean
  work_source_contractor_id: string | null
  work_source_name:          string | null
  payee_tier:                string
}

export type PayeeUpsertOpts = {
  payment_type:              string
  unit_price:                number | null
  tax_method:                string
  rounding_rule:             string
  adjustment_enabled:        boolean
  work_source_contractor_id: string | null
  payee_tier:                string
}

export async function fetchProjectPayees(projectId: string): Promise<ActionResult<ProjectPayee[]>> {
  const auth = await requireOwner()
  if (!auth.ok) return { data: null, error: auth.error }
  const supabase = createServiceClient()

  const { data, error } = await supabase
    .from('project_payees')
    .select('id, contractor_id, payment_type, unit_price, tax_method, rounding_rule, adjustment_enabled, work_source_contractor_id, payee_tier')
    .eq('project_id', projectId)
    .order('created_at', { ascending: true }) as any

  if (error) return { data: null, error: error.message }

  // payee と work_source の名前を一括解決
  const rows = data ?? []
  const contractorIds = [
    ...rows.map((r: any) => r.contractor_id),
    ...rows.map((r: any) => r.work_source_contractor_id).filter(Boolean),
  ].filter((id, i, a) => id && a.indexOf(id) === i) as string[]

  const nameMap = new Map<string, string>()
  if (contractorIds.length > 0) {
    const { data: cData } = await supabase
      .from('contractors')
      .select('id, name')
      .in('id', contractorIds)
    for (const c of cData ?? []) {
      nameMap.set((c as any).id, (c as any).name)
    }
  }

  return {
    data: rows.map((r: any) => ({
      id:                        r.id,
      contractor_id:             r.contractor_id,
      contractor_name:           nameMap.get(r.contractor_id) ?? r.contractor_id,
      payment_type:              r.payment_type ?? 'per_unit',
      unit_price:                r.unit_price ?? null,
      tax_method:                r.tax_method ?? 'exclusive',
      rounding_rule:             r.rounding_rule ?? 'round',
      adjustment_enabled:        r.adjustment_enabled ?? false,
      work_source_contractor_id: r.work_source_contractor_id ?? null,
      work_source_name:          r.work_source_contractor_id ? (nameMap.get(r.work_source_contractor_id) ?? null) : null,
      payee_tier:                r.payee_tier ?? 'primary',
    })),
    error: null,
  }
}

export async function upsertProjectPayee(
  projectId:    string,
  contractorId: string,
  opts:         PayeeUpsertOpts,
  existingId?:  string,
): Promise<ActionResult<void>> {
  const auth = await requireOwner()
  if (!auth.ok) return { data: null, error: auth.error }
  const supabase = createServiceClient()

  const payload = {
    project_id:                projectId,
    contractor_id:             contractorId,
    payment_type:              opts.payment_type,
    unit_price:                opts.unit_price,
    tax_method:                opts.tax_method,
    rounding_rule:             opts.rounding_rule,
    adjustment_enabled:        opts.adjustment_enabled,
    work_source_contractor_id: opts.work_source_contractor_id || null,
    payee_tier:                opts.payee_tier,
  }

  if (existingId) {
    const { error } = await (supabase as any)
      .from('project_payees')
      .update(payload)
      .eq('id', existingId)
    if (error) return { data: null, error: error.message }
  } else {
    const { error } = await (supabase as any)
      .from('project_payees')
      .insert(payload)
    if (error) return { data: null, error: error.message }
  }

  return { data: undefined, error: null }
}

export async function deleteProjectPayee(payeeId: string): Promise<ActionResult<void>> {
  const auth = await requireOwner()
  if (!auth.ok) return { data: null, error: auth.error }
  const supabase = createServiceClient()
  const { error } = await (supabase as any)
    .from('project_payees')
    .delete()
    .eq('id', payeeId)
  if (error) return { data: null, error: error.message }
  return { data: undefined, error: null }
}
