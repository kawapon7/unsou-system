import { Suspense } from 'react'
import { redirect } from 'next/navigation'
import OyabunShell from './shell'
import { getAuthContext } from '@/utils/auth'

// ⚠️ 認証ガードを毎リクエスト実行させるため動的レンダリングを強制する。
// 無いと admin 配下が静的プリレンダリング(○ Static)され、Workers の
// ASSETS が middleware/レイアウト認証を経由せず静的HTMLを直接配信し、
// 未ログインでも管理画面の殻が露出する（認証ガードのバイパス）。
export const dynamic = 'force-dynamic'

// 配下ページの多くが useSearchParams() を使う。プリレンダリング時は
// Suspense 境界が必須で、無いと next build がそのページのエクスポートで
// 失敗し、OpenNext が _worker.js を生成できずデプロイが静的サイト化
// （= 全ルート404）する。ここで children を一括ラップして担保する。
function AdminBody({ children }: { children: React.ReactNode }) {
  return <Suspense fallback={<div className="min-h-screen bg-zinc-50" />}>{children}</Suspense>
}

export default async function OyabunLayout({
  children,
}: {
  children: React.ReactNode
}) {
  // ⚠️ dev専用バイパスは ALLOW_DEV_AUTH_BYPASS=true のときのみ（本番では設定しない）
  if (process.env.ALLOW_DEV_AUTH_BYPASS === 'true') {
    return <OyabunShell email="dev@local"><AdminBody>{children}</AdminBody></OyabunShell>
  }

  const auth = await getAuthContext()
  if (!auth.ok) redirect('/login')
  // 親分(owner)以外は管理画面に入れない（子分は自分の画面へ）
  if (!auth.ctx.isOwner) redirect('/driver/schedule')

  return <OyabunShell email={auth.ctx.email ?? ''}><AdminBody>{children}</AdminBody></OyabunShell>
}
