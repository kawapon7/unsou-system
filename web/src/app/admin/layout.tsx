import { redirect } from 'next/navigation'
import { createClient } from '@/utils/supabase/server'
import OyabunShell from './shell'

export default async function OyabunLayout({
  children,
}: {
  children: React.ReactNode
}) {
  // TODO: UI確認用一時バイパス（本番前に必ず削除すること）
  if (process.env.NODE_ENV === 'development') {
    return <OyabunShell email="dev@local">{children}</OyabunShell>
  }

  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()

  if (!user) redirect('/login')

  return <OyabunShell email={user.email ?? ''}>{children}</OyabunShell>
}
