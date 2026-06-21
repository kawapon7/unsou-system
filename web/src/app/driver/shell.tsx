'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { handleLogout } from '@/app/auth/actions'

// ── ボトムナビアイテム ────────────────────────────────────

const BOTTOM_NAV = [
  {
    href:  '/driver/schedule',
    label: '予定・実績',
    icon:  (active: boolean) => (
      <svg className="w-6 h-6" fill={active ? 'currentColor' : 'none'} viewBox="0 0 24 24" strokeWidth={1.6} stroke="currentColor">
        <path strokeLinecap="round" strokeLinejoin="round" d="M6.75 3v2.25M17.25 3v2.25M3 18.75V7.5a2.25 2.25 0 0 1 2.25-2.25h13.5A2.25 2.25 0 0 1 21 7.5v11.25m-18 0A2.25 2.25 0 0 0 5.25 21h13.5A2.25 2.25 0 0 0 21 18.75m-18 0v-7.5A2.25 2.25 0 0 1 5.25 9h13.5A2.25 2.25 0 0 1 21 11.25v7.5m-9-6h.008v.008H12v-.008ZM12 15h.008v.008H12V15Zm0 2.25h.008v.008H12v-.008ZM9.75 15h.008v.008H9.75V15Zm0 2.25h.008v.008H9.75v-.008ZM7.5 15h.008v.008H7.5V15Zm0 2.25h.008v.008H7.5v-.008Zm6.75-4.5h.008v.008h-.008v-.008Zm0 2.25h.008v.008h-.008V15Zm0 2.25h.008v.008h-.008v-.008Zm2.25-4.5h.008v.008H16.5v-.008Zm0 2.25h.008v.008H16.5V15Z" />
      </svg>
    ),
  },
  {
    href:  '/driver/billing',
    label: '支払通知書',
    icon:  (active: boolean) => (
      <svg className="w-6 h-6" fill={active ? 'currentColor' : 'none'} viewBox="0 0 24 24" strokeWidth={1.6} stroke="currentColor">
        <path strokeLinecap="round" strokeLinejoin="round" d="M19.5 14.25v-2.625a3.375 3.375 0 0 0-3.375-3.375h-1.5A1.125 1.125 0 0 1 13.5 7.125v-1.5a3.375 3.375 0 0 0-3.375-3.375H8.25m0 12.75h7.5m-7.5 3H12M10.5 2.25H5.625c-.621 0-1.125.504-1.125 1.125v17.25c0 .621.504 1.125 1.125 1.125h12.75c.621 0 1.125-.504 1.125-1.125V11.25a9 9 0 0 0-9-9Z" />
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

          {/* マイページ（ログイン中表示） */}
          <div className="flex flex-1 flex-col items-center justify-center gap-0.5 text-zinc-400">
            <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" strokeWidth={1.6} stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" d="M15.75 6a3.75 3.75 0 1 1-7.5 0 3.75 3.75 0 0 1 7.5 0ZM4.501 20.118a7.5 7.5 0 0 1 14.998 0A17.933 17.933 0 0 1 12 21.75c-2.676 0-5.216-.584-7.499-1.632Z" />
            </svg>
            <span className="text-[10px] font-medium text-zinc-400 leading-none">
              マイページ
            </span>
            <span className="text-[9px] text-zinc-400 max-w-[80px] truncate px-1 leading-none text-center">
              {email.split('@')[0]}
            </span>
          </div>
        </div>
      </nav>
    </div>
  )
}
