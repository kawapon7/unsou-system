'use server'

// 注意：立替金は消費税を個別に計算せず実費金額で保存し、支払通知書・請求書の確定時に一括集計して別行合算します。

import { createClient } from '@/utils/supabase/server'
import { revalidatePath } from 'next/cache'
import { redirect } from 'next/navigation'

export type ExpenseType = 'toll' | 'parking' | 'fuel' | 'other'

export interface ExpenseSummary {
  total: number
  byType: Record<ExpenseType, number>
  records: {
    id: string
    date: string
    expense_type: ExpenseType
    amount: number
    note: string
    receipt_url: string | null
  }[]
}

// ① 【子分アプリ用：申請】
export async function applyExpense(formData: FormData) {
  const supabase = await createClient()

  const { data: { user }, error: authError } = await supabase.auth.getUser()
  if (authError || !user) redirect('/login')

  const { data: contractor } = await supabase
    .from('contractors')
    .select('id')
    .eq('email', user.email)
    .single()

  if (!contractor) redirect('/login?error=委託先マスタに登録がありません')

  const date = formData.get('date') as string
  const expense_type = formData.get('expense_type') as ExpenseType
  const amount = parseFloat(formData.get('amount') as string || '0')
  const note = formData.get('note') as string
  const receipt_url = (formData.get('receipt_url') as string) || null

  if (amount <= 0) {
    redirect('/driver?error=金額は0より大きい値を入力してください')
  }

  const { error } = await supabase.from('expense_records').insert([
    {
      contractor_id: contractor.id,
      date,
      expense_type,
      amount,
      note,
      receipt_url,
      status: 'pending',
    },
  ])

  if (error) {
    console.error(error)
    redirect('/driver?error=立替金の申請に失敗しました')
  }

  revalidatePath('/driver')
  redirect('/driver?success=立替金を申請しました')
}

// ② 【親分アプリ用：承認】
export async function approveExpense(formData: FormData) {
  const supabase = await createClient()

  const { data: { user }, error: authError } = await supabase.auth.getUser()
  if (authError || !user) redirect('/login')

  const expense_id = formData.get('expense_id') as string

  const { error } = await supabase
    .from('expense_records')
    .update({
      status: 'approved',
      approved_at: new Date().toISOString(),
    })
    .eq('id', expense_id)

  if (error) {
    console.error(error)
    redirect('/dashboard?error=立替金の承認に失敗しました')
  }

  revalidatePath('/dashboard')
  redirect('/dashboard?success=立替金を承認しました')
}

// ③ 【集計用ユーティリティ】承認済み立替金の月次集計
export async function getApprovedExpenseSummary(
  contractor_id: string,
  target_month: string // YYYY-MM形式
): Promise<ExpenseSummary> {
  const supabase = await createClient()

  const { data: records, error } = await supabase
    .from('expense_records')
    .select('id, date, expense_type, amount, note, receipt_url')
    .eq('contractor_id', contractor_id)
    .eq('status', 'approved')
    .gte('date', `${target_month}-01`)
    .lte('date', `${target_month}-31`)
    .order('date', { ascending: true })

  if (error || !records) {
    return { total: 0, byType: { toll: 0, parking: 0, fuel: 0, other: 0 }, records: [] }
  }

  const byType: Record<ExpenseType, number> = { toll: 0, parking: 0, fuel: 0, other: 0 }
  let total = 0

  for (const rec of records) {
    const type = rec.expense_type as ExpenseType
    const amt = rec.amount ?? 0
    byType[type] = (byType[type] ?? 0) + amt
    total += amt
  }

  return {
    total,
    byType,
    records: records.map((r) => ({
      id: r.id,
      date: r.date,
      expense_type: r.expense_type as ExpenseType,
      amount: r.amount,
      note: r.note,
      receipt_url: r.receipt_url,
    })),
  }
}
