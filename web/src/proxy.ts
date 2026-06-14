import { createServerClient } from '@supabase/ssr'
import { NextResponse, type NextRequest } from 'next/server'

export async function proxy(request: NextRequest) {
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

  const isProtected = pathname.startsWith('/admin') || pathname.startsWith('/driver')
  const isLoginPage = pathname === '/login'

  // TODO: UI確認用一時バイパス（本番前に必ず削除すること）
  if (process.env.NODE_ENV === 'development' && isProtected && !user) {
    return supabaseResponse
  }

  if (isProtected && !user) {
    const url = request.nextUrl.clone()
    url.pathname = '/login'
    return NextResponse.redirect(url)
  }

  if (isLoginPage && user) {
    const { data: userData } = await supabase
      .from('users')
      .select('role')
      .eq('id', user.id)
      .single()

    const TEMP_OWNER_EMAILS = ['admin@hibiki.com']
    const role = TEMP_OWNER_EMAILS.includes(user.email ?? '')
      ? 'master'
      : (userData?.role ?? user.user_metadata?.role)

    const url = request.nextUrl.clone()
    url.pathname = role === 'master' ? '/admin/dashboard' : '/driver/dashboard'
    return NextResponse.redirect(url)
  }

  return supabaseResponse
}

export const config = {
  matcher: ['/login', '/admin/:path*', '/driver/:path*'],
}
