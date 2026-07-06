'use server'

import { createClient } from '@/utils/supabase/server'
import { createServiceClient } from '@/utils/supabase/service'
import type { Database } from '@/types/supabase'

type ProjectRow    = Database['public']['Tables']['projects']['Row']
type ClientRow     = Database['public']['Tables']['clients']['Row']
type ContractorRow = Database['public']['Tables']['contractors']['Row']

export type ExpenseRow = {
  id:             string
  expenseDate:    string
  expenseType:    string
  amountActual:   number
  remarks:        string | null
  approvalStatus: string
  createdAt:      string
}

export type SubmitExpenseParams = {
  contractorId: string
  expenseDate:  string
  expenseType:  string
  amountActual: number
  remarks:      string
}

export type AssignedProject = ProjectRow & {
  client_name: string | null
}

type ActionResult<T> = { data: T; error: null } | { data: null; error: string }

export async function fetchMyContractor(): Promise<ActionResult<Pick<ContractorRow, 'id'>>> {
  try {
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
      // フォールバック: email で contractors を直接検索（service_role 必須）
      const service = createServiceClient()
      const { data: contractor, error: cErr } = await service
        .from('contractors')
        .select('id')
        .eq('email', user.email ?? '')
        .single()
      if (cErr || !contractor) return { data: null, error: '委託先レコードが見つかりません' }
      return { data: contractor, error: null }
    }

    const service = createServiceClient()
    const { data: contractor, error: cErr } = await service
      .from('contractors')
      .select('id')
      .eq('id', userRow.contractor_id)
      .single()

    if (cErr || !contractor) return { data: null, error: '委託先レコードが見つかりません' }
    return { data: contractor, error: null }
  } catch (e) {
    const msg = e instanceof Error ? e.message : '委託先の取得に失敗しました'
    console.error('[fetchMyContractor]', msg)
    return { data: null, error: msg }
  }
}

export async function fetchMyProjects(_clientContractorId?: string): Promise<ActionResult<AssignedProject[]>> {
  // ⚠️ IDOR防止: クライアント渡しのIDは信頼せず、ログインセッションから本人の委託先IDを解決する。
  const me = await fetchMyContractor()
  if (me.error || !me.data) return { data: null, error: me.error ?? '委託先が見つかりません' }
  const contractorId = me.data.id

  // データ読取りは service_role 経由に統一（RLS非依存）。所有権は contractor_id で明示担保。
  const supabase = createServiceClient()

  // ドライバーに個別割り当てがあればそのIDのみ取得、なければ全件
  const { data: assignments } = await supabase
    .from('driver_project_assignments')
    .select('project_id')
    .eq('contractor_id', contractorId)

  let query = supabase
    .from('projects')
    .select(`*, clients ( company_name )`)
    .eq('contractor_id', contractorId)
    .eq('driver_visible', true)
    .order('operation_start', { ascending: true })

  if (assignments && assignments.length > 0) {
    query = query.in('id', assignments.map((a: { project_id: string }) => a.project_id))
  }

  const { data, error } = await query

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

// ── 立替金 ────────────────────────────────────────────────

export async function fetchMyExpenses(
  _clientContractorId: string,
  yearMonth: string,
): Promise<ActionResult<ExpenseRow[]>> {
  // ⚠️ IDOR防止: 本人の委託先IDをセッションから解決して使用する。
  const me = await fetchMyContractor()
  if (me.error || !me.data) return { data: null, error: me.error ?? '委託先が見つかりません' }
  const contractorId = me.data.id

  const supabase = createServiceClient()
  const [y, m] = yearMonth.split('-').map(Number)
  const from = `${yearMonth}-01`
  const to   = new Date(y, m, 0).toISOString().slice(0, 10)

  const { data, error } = await supabase
    .from('expense_records')
    .select('id, expense_date, expense_type, amount_actual, remarks, approval_status, created_at')
    .eq('contractor_id', contractorId)
    .gte('expense_date', from)
    .lte('expense_date', to)
    .order('expense_date', { ascending: false })

  if (error) return { data: null, error: error.message }

  return {
    data: (data ?? []).map(r => ({
      id:             r.id,
      expenseDate:    r.expense_date,
      expenseType:    r.expense_type,
      amountActual:   r.amount_actual,
      remarks:        r.remarks,
      approvalStatus: r.approval_status,
      createdAt:      r.created_at,
    })),
    error: null,
  }
}

export async function submitExpense(
  params: SubmitExpenseParams,
): Promise<ActionResult<{ id: string }>> {
  // ⚠️ IDOR防止: 立替金は必ず本人の委託先IDに紐付ける（クライアント値は使わない）。
  const me = await fetchMyContractor()
  if (me.error || !me.data) return { data: null, error: me.error ?? '委託先が見つかりません' }
  const contractorId = me.data.id

  const supabase = createServiceClient()
  const amountTaxExcluded = Math.round(params.amountActual / 1.1)

  const { data, error } = await supabase
    .from('expense_records')
    .insert({
      contractor_id:       contractorId,
      expense_date:        params.expenseDate,
      expense_type:        params.expenseType,
      amount_actual:       params.amountActual,
      amount_tax_excluded: amountTaxExcluded,
      tax_category:        'exclusive',
      approval_status:     'pending',
      remarks:             params.remarks || null,
    })
    .select('id')
    .single()

  if (error) return { data: null, error: error.message }
  return { data: { id: data.id }, error: null }
}
