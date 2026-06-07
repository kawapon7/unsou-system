'use server'

import { createClient } from '@/utils/supabase/server'
import { revalidatePath } from 'next/cache'
import { redirect } from 'next/navigation'

export async function createProjectMaster(formData: FormData) {
  const supabase = await createClient()

  // 認証チェック
  const { data: { user }, error: authError } = await supabase.auth.getUser()
  if (authError || !user) {
    redirect('/login')
  }

  const client_id = formData.get('client_id') as string
  const name = formData.get('name') as string

  // price_rules（単価ルール）用のデータ
  const calculation_type = formData.get('calculation_type') as string
  const sales_price = parseFloat(formData.get('sales_price') as string || '0')
  const buying_price = parseFloat(formData.get('buying_price') as string || '0')
  const margin_setting = formData.get('margin_setting') as string
  const margin_value = parseFloat(formData.get('margin_value') as string || '0')

  let margin_rate = 10 // デフォルト10%
  let margin_fixed = 0

  if (margin_setting === 'percentage') {
    margin_rate = margin_value
  } else if (margin_setting === 'fixed') {
    margin_rate = 0
    margin_fixed = margin_value
  }

  // 1. projectsテーブルへ挿入
  const { data: projectData, error: projectError } = await supabase
    .from('projects')
    .insert([{ client_id, name }])
    .select()
    .single()

  if (projectError || !projectData) {
    console.error(projectError)
    redirect('/dashboard/projects/new?error=案件の登録に失敗しました')
  }

  // 2. 紐づく price_rulesテーブルへ挿入
  const { error: priceError } = await supabase
    .from('price_rules')
    .insert([
      {
        project_id: projectData.id,
        calculation_type,
        sales_price,
        buying_price,
        margin_rate,
        margin_fixed,
      },
    ])

  if (priceError) {
    console.error(priceError)
    redirect('/dashboard/projects/new?error=単価ルールの登録に失敗しました')
  }

  revalidatePath('/dashboard')
  redirect('/dashboard?success=案件マスタを登録しました')
}

/**
 * 汎用スポット案件を正式な案件マスタへ昇格させるガードレールロジック
 * 注意：仮の「汎用スポット」として入力された実績データを、親分の入力により正式な「案件マスタ」へと昇格させ、
 * 過去の実績データの案件IDを一括で書き換えて紐付け直すガードレールロジックです。
 */
export async function promoteSpotToProject(formData: FormData) {
  const supabase = await createClient()

  // 認証チェック
  const { data: { user }, error: authError } = await supabase.auth.getUser()
  if (authError || !user) redirect('/login')

  const spot_note = formData.get('spot_note') as string      // 汎用スポットのメモ文字列（work_records.note と照合）
  const spot_project_id = formData.get('spot_project_id') as string | null  // 仮のproject_id（あれば）
  const client_id = formData.get('client_id') as string
  const name = formData.get('name') as string
  const selling_price = parseFloat(formData.get('selling_price') as string || '0')
  const buying_price = parseFloat(formData.get('buying_price') as string || '0')
  const price_rule_type = formData.get('price_rule_type') as string

  // ① 正式な案件マスタ（projects）へ新規インサートし、生成された project_id を取得
  const { data: projectData, error: projectError } = await supabase
    .from('projects')
    .insert([{ client_id, name }])
    .select()
    .single()

  if (projectError || !projectData) {
    console.error(projectError)
    redirect('/dashboard?error=案件マスタへの昇格に失敗しました')
  }

  // 紐づく price_rules を登録
  const { error: priceError } = await supabase
    .from('price_rules')
    .insert([
      {
        project_id: projectData.id,
        calculation_type: price_rule_type,
        sales_price: selling_price,
        buying_price,
        margin_rate: 10,
        margin_fixed: 0,
      },
    ])

  if (priceError) {
    console.error(priceError)
    redirect('/dashboard?error=単価ルールの登録に失敗しました')
  }

  // ② 過去の勤務実績（work_records）を一括書き換えして正式な project_id へ紐付け直す
  // 仮のproject_idが渡された場合はIDで照合、なければメモテキストで照合
  if (spot_project_id) {
    const { error: updateError } = await supabase
      .from('work_records')
      .update({ project_id: projectData.id })
      .eq('project_id', spot_project_id)

    if (updateError) {
      console.error(updateError)
      redirect('/dashboard?error=実績データの紐付け直しに失敗しました')
    }
  } else if (spot_note) {
    const { error: updateError } = await supabase
      .from('work_records')
      .update({ project_id: projectData.id })
      .is('project_id', null)
      .eq('note', spot_note)

    if (updateError) {
      console.error(updateError)
      redirect('/dashboard?error=実績データの紐付け直しに失敗しました')
    }
  }

  revalidatePath('/dashboard')
  redirect('/dashboard?success=スポット案件を正式な案件マスタへ昇格しました')
}
