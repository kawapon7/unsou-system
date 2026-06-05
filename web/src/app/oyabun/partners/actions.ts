'use server'

import { createClient } from '@/utils/supabase/server'
import type { Database } from '@/types/supabase'

type ClientRow = Database['public']['Tables']['clients']['Row']
type ClientInsert = Database['public']['Tables']['clients']['Insert']
type ClientUpdate = Database['public']['Tables']['clients']['Update']
type ContractorRow = Database['public']['Tables']['contractors']['Row']
type ContractorInsert = Database['public']['Tables']['contractors']['Insert']
type ContractorUpdate = Database['public']['Tables']['contractors']['Update']

export type { ClientRow, ContractorRow }

type ActionResult<T> = { data: T; error: null } | { data: null; error: string }

// ── Clients ────────────────────────────────────────────────

export async function fetchClients(): Promise<ActionResult<ClientRow[]>> {
  const supabase = await createClient()
  const { data, error } = await supabase
    .from('clients')
    .select('*')
    .order('created_at', { ascending: false })
  if (error) return { data: null, error: error.message }
  return { data, error: null }
}

export async function createClient_(payload: ClientInsert): Promise<ActionResult<ClientRow>> {
  const supabase = await createClient()
  const { data, error } = await supabase
    .from('clients')
    .insert(payload)
    .select()
    .single()
  if (error) return { data: null, error: error.message }
  return { data, error: null }
}

export async function updateClient(id: string, payload: ClientUpdate): Promise<ActionResult<ClientRow>> {
  const supabase = await createClient()
  const { data, error } = await supabase
    .from('clients')
    .update(payload)
    .eq('id', id)
    .select()
    .single()
  if (error) return { data: null, error: error.message }
  return { data, error: null }
}

// ── Contractors ────────────────────────────────────────────

export async function fetchContractors(): Promise<ActionResult<ContractorRow[]>> {
  const supabase = await createClient()
  const { data, error } = await supabase
    .from('contractors')
    .select('*')
    .order('created_at', { ascending: false })
  if (error) return { data: null, error: error.message }
  return { data, error: null }
}

export async function createContractor(payload: ContractorInsert): Promise<ActionResult<ContractorRow>> {
  const supabase = await createClient()
  const { data, error } = await supabase
    .from('contractors')
    .insert(payload)
    .select()
    .single()
  if (error) return { data: null, error: error.message }
  return { data, error: null }
}

export async function updateContractor(id: string, payload: ContractorUpdate): Promise<ActionResult<ContractorRow>> {
  const supabase = await createClient()
  const { data, error } = await supabase
    .from('contractors')
    .update(payload)
    .eq('id', id)
    .select()
    .single()
  if (error) return { data: null, error: error.message }
  return { data, error: null }
}
