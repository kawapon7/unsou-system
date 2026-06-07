'use server'

import { createClient } from '@/utils/supabase/server'
import { revalidatePath } from 'next/cache'
import { redirect } from 'next/navigation'

// 1. 今日の記録（勤務記録）の保存
export async function recordWork(formData: FormData) {
  const supabase = await createClient()

  const { data: { user }, error: authError } = await supabase.auth.getUser()
  if (authError || !user) redirect('/login')

  // ログイン中のユーザーのemailに紐づくcontractor_idを取得
  const { data: contractor } = await supabase
    .from('contractors')
    .select('id')
    .eq('email', user.email)
    .single()

  if (!contractor) {
    redirect('/login?error=委託先マスタに登録がありません')
  }

  const date = formData.get('date') as string
  const project_id = formData.get('project_id') as string
  const start_time = formData.get('start_time') as string
  const end_time = formData.get('end_time') as string
  const break_minutes = parseInt(formData.get('break_minutes') as string || '0', 10)
  const quantity = parseInt(formData.get('quantity') as string || '0', 10)
  const note = formData.get('note') as string

  const { error } = await supabase.from('work_records').insert([
    {
      contractor_id: contractor.id,
      project_id: project_id || null,
      date,
      start_time: start_time || null,
      end_time: end_time || null,
      break_minutes,
      quantity,
      note,
      status: 'pending',
    },
  ])

  if (error) {
    console.error(error)
    redirect('/driver?error=勤務記録の保存に失敗しました')
  }

  revalidatePath('/driver')
  redirect('/driver?success=勤務記録を登録しました')
}

// 2. 立替金の入力
export async function recordExpense(formData: FormData) {
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
  const expense_type = formData.get('expense_type') as string
  const amount = parseFloat(formData.get('amount') as string || '0')
  const note = formData.get('note') as string

  const { error } = await supabase.from('expense_records').insert([
    {
      contractor_id: contractor.id,
      date,
      expense_type,
      amount,
      note,
      status: 'pending',
    },
  ])

  if (error) {
    console.error(error)
    redirect('/driver?error=立替金の保存に失敗しました')
  }

  revalidatePath('/driver')
  redirect('/driver?success=立替金を登録しました')
}
