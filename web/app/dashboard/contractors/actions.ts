'use server'

import { createClient } from '@/utils/supabase/server'
import { encryptText } from '@/utils/crypto'
import { revalidatePath } from 'next/cache'
import { redirect } from 'next/navigation'

export async function createContractorMaster(formData: FormData) {
  const supabase = await createClient()

  // 認証チェック
  const { data: { user }, error: authError } = await supabase.auth.getUser()
  if (authError || !user) {
    redirect('/login')
  }

  const name = formData.get('name') as string
  const email = formData.get('email') as string // ログインID兼用
  const phone = formData.get('phone') as string

  const payment_method = formData.get('payment_method') as string
  const payment_site = parseInt(formData.get('payment_site') as string, 10)
  const tax_type = formData.get('tax_type') as string
  
  // 拡張用・凍結中ルール
  const contractor_type = formData.get('contractor_type') as string
  const has_withholding = formData.get('has_withholding') === 'true'
  
  // インボイス情報
  const invoice_status = formData.get('invoice_status') as string
  const invoice_number = formData.get('invoice_number') as string
  
  // v1.6/v1.8追加: 詳細入力切り替えスイッチ
  const show_detail_switch = formData.get('show_detail_switch') === 'true'

  // 口座情報（平文で受け取り、DB保存前に暗号化する）
  // 注意：環境変数 ENCRYPTION_KEY が未設定、または32バイト未満の場合は暗号化に失敗し例外がスローされます。
  const bank_name = encryptText(formData.get('bank_name') as string)
  const branch_name = encryptText(formData.get('branch_name') as string)
  const account_type = encryptText(formData.get('account_type') as string)
  const account_number = encryptText(formData.get('account_number') as string)
  const account_holder = encryptText(formData.get('account_holder') as string)

  // contractorsテーブルへのインサート
  const { error } = await supabase.from('contractors').insert([
    {
      name,
      email,
      phone,
      payment_method,
      payment_site,
      tax_type,
      contractor_type,
      has_withholding,
      invoice_status,
      invoice_number,
      show_detail_switch,
      bank_name,
      branch_name,
      account_type,
      account_number,
      account_holder,
    },
  ])

  if (error) {
    console.error(error)
    redirect('/dashboard/contractors/new?error=登録に失敗しました')
  }

  revalidatePath('/dashboard')
  redirect('/dashboard?success=委託先を登録しました')
}

/**
 * 委託先マスタの詳細入力切り替えスイッチを更新する
 * （多段階委託における再委託先「個人Y」などの詳細入力制御用）
 * 注意：非同期処理の待機中にユーザーが画面を遷移した場合のハンドリングは呼出側で行ってください。
 */
export async function updateDetailSwitch(contractorId: string, showDetailed: boolean) {
  const supabase = await createClient()

  const { data: { user }, error: authError } = await supabase.auth.getUser()
  if (authError || !user) redirect('/login')

  const { error } = await supabase
    .from('contractors')
    .update({
      show_detail_switch: showDetailed,
      updated_at: new Date().toISOString(),
    })
    .eq('id', contractorId)

  if (error) {
    console.error(error)
    return { success: false, error: error.message }
  }

  revalidatePath('/dashboard/contractors')
  return { success: true }
}
