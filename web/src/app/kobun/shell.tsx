'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { handleLogout } from '@/app/auth/actions'

// ── ボトムナビアイテム ────────────────────────────────────

const BOTTOM_NAV = [
  {
    href:  '/kobun/dashboard',
    label: '案件',
    icon:  (active: boolean) => (
      <svg className="w-6 h-6" fill={active ? 'currentColor' : 'none'} viewBox="0 0 24 24" strokeWidth={1.6} stroke="currentColor">
        <path strokeLinecap="round" strokeLinejoin="round" d="M9 6.75V15m6-6v8.25m.503 3.498 4.875-2.437c.381-.19.622-.58.622-1.006V4.82c0-.836-.88-1.38-1.628-1.006l-3.869 1.934c-.317.159-.69.159-1.006 0L9.503 3.252a1.125 1.125 0 0 0-1.006 0L3.622 5.689C3.24 5.88 3 6.27 3 6.695V19.18c0 .836.88 1.38 1.628 1.006l3.869-1.934c.317-.159.69-.159 1.006 0l4.994 2.497c.317.158.69.158 1.006 0Z" />
      </svg>
    ),
  },
] as const

export default function KobunShell({
  email,
  children,
}: {
  email: string
  children: React.ReactNode
}) {
  const pathname = usePathname()

  return (
    <div className="flex flex-col min-h-screen bg-zinc-50">

      {/* ── トップバー ──────────────────────────────────── */}
      <header className="sticky top-0 z-30 bg-white border-b border-zinc-200 safe-area-top">
        <div className="flex items-center justify-between px-4 h-14">
          {/* ロゴ */}
          <div className="flex items-center gap-2">
            <div className="h-7 w-7 rounded-lg bg-zinc-900 flex items-center justify-center">
              <span className="text-white text-xs font-bold">響</span>
            </div>
            <span className="font-semibold text-zinc-900 tracking-tight text-sm">HIBIKI</span>
          </div>

          {/* ユーザー情報・ログアウト */}
          <div className="flex items-center gap-3">
            <span className="text-xs text-zinc-400 hidden sm:block truncate max-w-[160px]">{email}</span>
            <form action={handleLogout}>
              <button
                type="submit"
                className="rounded-full bg-zinc-100 px-3 py-1.5 text-xs font-medium text-zinc-600 hover:bg-zinc-200 active:bg-zinc-300 transition"
              >
                ログアウト
              </button>
            </form>
          </div>
        </div>
      </header>

      {/* ── メインコンテンツ ────────────────────────────── */}
      <main className="flex-1 overflow-y-auto pb-20">
        {children}
      </main>

      {/* ── ボトムナビゲーションバー ─────────────────────── */}
      <nav className="fixed bottom-0 inset-x-0 z-30 bg-white border-t border-zinc-200 safe-area-bottom">
        <div className="flex items-stretch h-16">
          {BOTTOM_NAV.map(item => {
            const active = pathname.startsWith(item.href)
            return (
              <Link
                key={item.href}
                href={item.href}
                className={`flex flex-1 flex-col items-center justify-center gap-0.5 transition-colors ${
                  active ? 'text-zinc-900' : 'text-zinc-400 hover:text-zinc-600'
                }`}
              >
                {item.icon(active)}
                <span className={`text-[10px] font-medium ${active ? 'text-zinc-900' : 'text-zinc-400'}`}>
                  {item.label}
                </span>
              </Link>
            )
          })}

          {/* プロフィール（メール表示） */}
          <div className="flex flex-1 flex-col items-center justify-center gap-0.5 text-zinc-400">
            <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" strokeWidth={1.6} stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" d="M15.75 6a3.75 3.75 0 1 1-7.5 0 3.75 3.75 0 0 1 7.5 0ZM4.501 20.118a7.5 7.5 0 0 1 14.998 0A17.933 17.933 0 0 1 12 21.75c-2.676 0-5.216-.584-7.499-1.632Z" />
            </svg>
            <span className="text-[10px] font-medium text-zinc-400 max-w-[72px] truncate px-1">
              {email.split('@')[0]}
            </span>
          </div>
        </div>
      </nav>
    </div>
  )
}
