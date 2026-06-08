'use server'

import { redirect } from 'next/navigation'
import { createClient } from '@/utils/supabase/server'

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

  const { data: userData } = await supabase
    .from('users')
    .select('role')
    .eq('id', user.id)
    .single()

  const TEMP_OWNER_EMAILS = ['admin@hibiki.com']
  const role = TEMP_OWNER_EMAILS.includes(user.email ?? '')
    ? 'master'
    : (userData?.role ?? user.user_metadata?.role)

  if (role === 'master') {
    redirect('/oyabun/dashboard')
  } else {
    redirect('/kobun/dashboard')
  }
}
