'use server'

import { createClient } from '@/utils/supabase/server'
import type { Database } from '@/types/supabase'

type ProjectRow    = Database['public']['Tables']['projects']['Row']
type ProjectInsert = Database['public']['Tables']['projects']['Insert']
type ProjectUpdate = Database['public']['Tables']['projects']['Update']
type ClientRow     = Database['public']['Tables']['clients']['Row']
type ContractorRow = Database['public']['Tables']['contractors']['Row']

export type { ProjectRow, ClientRow, ContractorRow }

// projects + joined client.company_name + contractor.name
export type ProjectWithRelations = ProjectRow & {
  client_name: string | null
  contractor_name: string | null
}

type ActionResult<T> = { data: T; error: null } | { data: null; error: string }

// ── Projects ───────────────────────────────────────────────

export async function fetchProjects(): Promise<ActionResult<ProjectWithRelations[]>> {
  const supabase = await createClient()
  const { data, error } = await supabase
    .from('projects')
    .select(`
      *,
      clients ( company_name ),
      contractors ( name )
    `)
    .order('created_at', { ascending: false })

  if (error) return { data: null, error: error.message }

  const rows: ProjectWithRelations[] = (data ?? []).map((r) => {
    const { clients, contractors, ...rest } = r as typeof r & {
      clients: { company_name: string } | null
      contractors: { name: string } | null
    }
    return {
      ...rest,
      client_name: clients?.company_name ?? null,
      contractor_name: contractors?.name ?? null,
    }
  })

  return { data: rows, error: null }
}

export async function createProject(payload: ProjectInsert): Promise<ActionResult<ProjectRow>> {
  const supabase = await createClient()
  const { data, error } = await supabase
    .from('projects')
    .insert(payload)
    .select()
    .single()
  if (error) return { data: null, error: error.message }
  return { data, error: null }
}

export async function updateProject(id: string, payload: ProjectUpdate): Promise<ActionResult<ProjectRow>> {
  const supabase = await createClient()
  const { data, error } = await supabase
    .from('projects')
    .update(payload)
    .eq('id', id)
    .select()
    .single()
  if (error) return { data: null, error: error.message }
  return { data, error: null }
}

// ── Master lookups ─────────────────────────────────────────

export async function fetchClientOptions(): Promise<ActionResult<Pick<ClientRow, 'id' | 'company_name'>[]>> {
  const supabase = await createClient()
  const { data, error } = await supabase
    .from('clients')
    .select('id, company_name')
    .order('company_name')
  if (error) return { data: null, error: error.message }
  return { data: data ?? [], error: null }
}

export async function fetchContractorOptions(): Promise<ActionResult<Pick<ContractorRow, 'id' | 'name'>[]>> {
  const supabase = await createClient()
  const { data, error } = await supabase
    .from('contractors')
    .select('id, name')
    .order('name')
  if (error) return { data: null, error: error.message }
  return { data: data ?? [], error: null }
}
