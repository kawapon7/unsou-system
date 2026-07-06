import { createServerClient } from '@supabase/ssr'
import { NextResponse, type NextRequest } from 'next/server'
import { createServiceClient } from '@/utils/supabase/service'

export async function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl

  let supabaseResponse = NextResponse.next({ request })

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll()
        },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value }) => request.cookies.set(name, value))
          supabaseResponse = NextResponse.next({ request })
          cookiesToSet.forEach(({ name, value, options }) =>
            supabaseResponse.cookies.set(name, value, options)
          )
        },
      },
    }
  )

  const { data: { user } } = await supabase.auth.getUser()

  const isAdminPath  = pathname.startsWith('/admin')
  const isDriverPath = pathname.startsWith('/driver')
  const isProtected  = isAdminPath || isDriverPath
  const isLoginPage  = pathname === '/login'

  // ⚠️ 認証バイパス: 明示的に ALLOW_DEV_AUTH_BYPASS=true を設定した場合のみ有効。
  // 本番環境ではこの環境変数を絶対に設定しないこと（NODE_ENV 依存をやめ、誤発火を防止）。
  const authBypass = process.env.ALLOW_DEV_AUTH_BYPASS === 'true'
  if (authBypass && isProtected && !user) {
    return supabaseResponse
  }

  if (isProtected && !user) {
    const url = request.nextUrl.clone()
    url.pathname = '/login'
    return NextResponse.redirect(url)
  }

  // ── ロール解決（master/owner = 親分、それ以外 = 子分） ──
  // バイパス時（user 無し）はロール判定をスキップ。
  // ⚠️ anonキー(RLS経由)ではなく service_role で直接引く。
  //    RLSバイパスのため cookie/セッションの状態に左右されず role.ts の getAuthContext() と同じ結果になる。
  let role: string | null = null
  if (user) {
    const service = createServiceClient()
    const { data: userData } = await service
      .from('users')
      .select('role')
      .eq('id', user.id)
      .maybeSingle()

    role = userData?.role ?? user.user_metadata?.role ?? 'contractor'
  }

  const isOwner = role === 'master' || role === 'owner'

  // 子分が管理画面(/admin)へ到達するのをブロック（権限昇格防止）
  if (isAdminPath && user && !isOwner) {
    const url = request.nextUrl.clone()
    url.pathname = '/driver/schedule'
    return NextResponse.redirect(url)
  }

  // ログイン済みでログインページに来たらロール別ダッシュボードへ
  if (isLoginPage && user) {
    const url = request.nextUrl.clone()
    url.pathname = isOwner ? '/admin/dashboard' : '/driver/schedule'
    return NextResponse.redirect(url)
  }

  return supabaseResponse
}

export const config = {
  matcher: [
    '/login',
    '/admin/:path*',
    '/driver/:path*',
  ],
}
