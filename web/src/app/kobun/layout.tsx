import { redirect } from 'next/navigation'
import { createClient } from '@/utils/supabase/server'
import KobunShell from './shell'

export default async function KobunLayout({
  children,
}: {
  children: React.ReactNode
}) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()

  if (!user) redirect('/login')

  return <KobunShell email={user.email ?? ''}>{children}</KobunShell>
}
