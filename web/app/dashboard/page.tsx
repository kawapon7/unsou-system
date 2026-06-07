import { createClient } from '@/utils/supabase/server'
import { redirect } from 'next/navigation'

export default async function DashboardPage() {
  const supabase = await createClient()
  const { data: { user }, error } = await supabase.auth.getUser()

  if (error || !user) {
    redirect('/login')
  }

  return (
    <div className="p-8">
      <h1 className="text-2xl font-bold mb-4 text-black">親分ダッシュボード（仮）</h1>
      <p className="text-gray-700">ログインに成功しました。ユーザー: {user.email}</p>
    </div>
  )
}
