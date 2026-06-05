'use server'

import { createClient } from '@/utils/supabase/server'
import type { Database } from '@/types/supabase'

type ProjectRow    = Database['public']['Tables']['projects']['Row']
type ClientRow     = Database['public']['Tables']['clients']['Row']
type ContractorRow = Database['public']['Tables']['contractors']['Row']

export type AssignedProject = ProjectRow & {
  client_name: string | null
}

type ActionResult<T> = { data: T; error: null } | { data: null; error: string }

export async function fetchMyContractor(): Promise<ActionResult<ContractorRow>> {
  const supabase = await createClient()

  const { data: { user }, error: authErr } = await supabase.auth.getUser()
  if (authErr || !user) return { data: null, error: '未ログインです' }

  // users テーブル経由で contractor_id を取得
  const { data: userRow, error: userErr } = await supabase
    .from('users')
    .select('contractor_id')
    .eq('id', user.id)
    .single()

  if (userErr || !userRow?.contractor_id) {
    // フォールバック: login_email または email で contractors を直接検索
    const { data: contractor, error: cErr } = await supabase
      .from('contractors')
      .select('*')
      .or(`login_email.eq.${user.email},email.eq.${user.email}`)
      .single()
    if (cErr || !contractor) return { data: null, error: '委託先レコードが見つかりません' }
    return { data: contractor, error: null }
  }

  const { data: contractor, error: cErr } = await supabase
    .from('contractors')
    .select('*')
    .eq('id', userRow.contractor_id)
    .single()

  if (cErr || !contractor) return { data: null, error: '委託先レコードが見つかりません' }
  return { data: contractor, error: null }
}

export async function fetchMyProjects(contractorId: string): Promise<ActionResult<AssignedProject[]>> {
  const supabase = await createClient()

  const { data, error } = await supabase
    .from('projects')
    .select(`
      *,
      clients ( company_name )
    `)
    .eq('contractor_id', contractorId)
    .order('operation_start', { ascending: true })

  if (error) return { data: null, error: error.message }

  const rows: AssignedProject[] = (data ?? []).map((r) => {
    const { clients, ...rest } = r as typeof r & {
      clients: Pick<ClientRow, 'company_name'> | null
    }
    return { ...rest, client_name: clients?.company_name ?? null }
  })

  return { data: rows, error: null }
}

export async function updateProjectStatus(
  projectId: string,
  status: string,
): Promise<ActionResult<ProjectRow>> {
  const supabase = await createClient()

  const { data: { user }, error: authErr } = await supabase.auth.getUser()
  if (authErr || !user) return { data: null, error: '未ログインです' }

  // 自分の案件かどうか確認してから更新
  const myContractor = await fetchMyContractor()
  if (myContractor.error || !myContractor.data) {
    return { data: null, error: myContractor.error ?? '委託先が見つかりません' }
  }

  const { data, error } = await supabase
    .from('projects')
    .update({ status })
    .eq('id', projectId)
    .eq('contractor_id', myContractor.data.id)
    .select()
    .single()

  if (error) return { data: null, error: error.message }
  return { data, error: null }
}
