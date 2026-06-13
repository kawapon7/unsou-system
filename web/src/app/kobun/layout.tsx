import { redirect } from 'next/navigation'
import { createClient } from '@/utils/supabase/server'
import KobunShell from './shell'

export default async function KobunLayout({
  children,
}: {
  children: React.ReactNode
}) {
  // TODO: UI確認用一時バイパス（本番前に必ず削除すること）
  if (process.env.NODE_ENV === 'development') {
    return <KobunShell email="dev-kobun@local">{children}</KobunShell>
  }

  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()

  if (!user) redirect('/login')

  return <KobunShell email={user.email ?? ''}>{children}</KobunShell>
}
