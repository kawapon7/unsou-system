'use server'

import { redirect } from 'next/navigation'
import { createClient } from '@/utils/supabase/server'
import { createServiceClient } from '@/utils/supabase/service'

export async function login(formData: FormData) {
  const supabase = await createClient()

  const { error } = await supabase.auth.signInWithPassword({
    email: formData.get('email') as string,
    password: formData.get('password') as string,
  })

  if (error) {
    const msg = error.message === 'Invalid login credentials'
      ? 'メールアドレスまたはパスワードが正しくありません'
      : error.message
    return { error: msg }
  }

  const { data: { user } } = await supabase.auth.getUser()
  if (!user) {
    return { error: '認証に失敗しました。' }
  }

  // ⚠️ anonキー(RLS経由)ではなく service_role で直接引く（middleware.ts と同じ判定に揃える）
  const service = createServiceClient()
  const { data: userData } = await service
    .from('users')
    .select('role')
    .eq('id', user.id)
    .maybeSingle()

  const role = userData?.role ?? user.user_metadata?.role

  if (role === 'master') {
    redirect('/admin/dashboard')
  } else {
    redirect('/driver/schedule')
  }
}
