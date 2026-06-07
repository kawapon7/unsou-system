'use server'

import { createClient } from '@/utils/supabase/server'
import { revalidatePath } from 'next/cache'
import { redirect } from 'next/navigation'

export async function createClientMaster(formData: FormData) {
  const supabase = await createClient()

  // 認証チェック
  const { data: { user }, error: authError } = await supabase.auth.getUser()
  if (authError || !user) {
    redirect('/login')
  }

  const name = formData.get('name') as string
  const textFields = {
    contact_name: formData.get('contact_name') as string,
    phone: formData.get('phone') as string,
    email: formData.get('email') as string,
    bank_name: formData.get('bank_name') as string,
    branch_name: formData.get('branch_name') as string,
    account_type: formData.get('account_type') as string,
    account_number: formData.get('account_number') as string,
    account_holder: formData.get('account_holder') as string,
  }

  const closing_day = parseInt(formData.get('closing_day') as string, 10)
  const payment_site = parseInt(formData.get('payment_site') as string, 10)
  const tax_treatment = formData.get('tax_treatment') as string
  const has_invoice = formData.get('has_invoice') === 'true'

  // clientsテーブルへのインサート（RLSにより、authenticatedロールのみ許可される想定）
  const { error } = await supabase.from('clients').insert([
    {
      name,
      ...textFields,
      closing_day,
      payment_site,
      tax_treatment,
      has_invoice,
    },
  ])

  if (error) {
    console.error(error)
    redirect('/dashboard/clients/new?error=登録に失敗しました')
  }

  revalidatePath('/dashboard')
  redirect('/dashboard?success=荷主を登録しました')
}
