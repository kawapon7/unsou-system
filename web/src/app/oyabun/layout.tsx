import { redirect } from 'next/navigation'
import { createClient } from '@/utils/supabase/server'
import OyabunShell from './shell'

export default async function OyabunLayout({
  children,
}: {
  children: React.ReactNode
}) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()

  if (!user) redirect('/login')

  return <OyabunShell email={user.email ?? ''}>{children}</OyabunShell>
}
