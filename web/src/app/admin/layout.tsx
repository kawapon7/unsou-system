import { redirect } from 'next/navigation'
import OyabunShell from './shell'
import { getAuthContext } from '@/utils/auth'

export default async function OyabunLayout({
  children,
}: {
  children: React.ReactNode
}) {
  // ⚠️ dev専用バイパスは ALLOW_DEV_AUTH_BYPASS=true のときのみ（本番では設定しない）
  if (process.env.ALLOW_DEV_AUTH_BYPASS === 'true') {
    return <OyabunShell email="dev@local">{children}</OyabunShell>
  }

  const auth = await getAuthContext()
  if (!auth.ok) redirect('/login')
  // 親分(owner)以外は管理画面に入れない（子分は自分の画面へ）
  if (!auth.ctx.isOwner) redirect('/driver/schedule')

  return <OyabunShell email={auth.ctx.email ?? ''}>{children}</OyabunShell>
}
