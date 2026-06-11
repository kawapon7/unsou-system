'use client'

import { useState } from 'react'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { handleLogout } from '@/app/auth/actions'
import { useFavorites } from '@/hooks/useFavorites'

// ── ナビアイテム定義 ──────────────────────────────────────

const NAV_ITEMS = [
  {
    href:  '/oyabun/projects',
    label: '案件・配車管理',
    icon:  (
      <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" strokeWidth={1.6} stroke="currentColor">
        <path strokeLinecap="round" strokeLinejoin="round" d="M9 6.75V15m6-6v8.25m.503 3.498 4.875-2.437c.381-.19.622-.58.622-1.006V4.82c0-.836-.88-1.38-1.628-1.006l-3.869 1.934c-.317.159-.69.159-1.006 0L9.503 3.252a1.125 1.125 0 0 0-1.006 0L3.622 5.689C3.24 5.88 3 6.27 3 6.695V19.18c0 .836.88 1.38 1.628 1.006l3.869-1.934c-.317-.159.69-.159 1.006 0l4.994 2.497c.317.158.69.158 1.006 0Z" />
      </svg>
    ),
  },
  {
    href:  '/oyabun/sales',
    label: '売上管理',
    icon:  (
      <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" strokeWidth={1.6} stroke="currentColor">
        <path strokeLinecap="round" strokeLinejoin="round" d="M3 13.125C3 12.504 3.504 12 4.125 12h2.25c.621 0 1.125.504 1.125 1.125v6.75C7.5 20.496 6.996 21 6.375 21h-2.25A1.125 1.125 0 0 1 3 19.875v-6.75ZM9.75 8.625c0-.621.504-1.125 1.125-1.125h2.25c.621 0 1.125.504 1.125 1.125v11.25c0 .621-.504 1.125-1.125 1.125h-2.25a1.125 1.125 0 0 1-1.125-1.125V8.625ZM16.5 4.125c0-.621.504-1.125 1.125-1.125h2.25C20.496 3 21 3.504 21 4.125v15.75c0 .621-.504 1.125-1.125 1.125h-2.25a1.125 1.125 0 0 1-1.125-1.125V4.125Z" />
      </svg>
    ),
  },
  {
    href:  '/oyabun/partners',
    label: '取引先管理',
    icon:  (
      <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" strokeWidth={1.6} stroke="currentColor">
        <path strokeLinecap="round" strokeLinejoin="round" d="M18 18.72a9.094 9.094 0 0 0 3.741-.479 3 3 0 0 0-4.682-2.72m.94 3.198.001.031c0 .225-.012.447-.037.666A11.944 11.944 0 0 1 12 21c-2.17 0-4.207-.576-5.963-1.584A6.062 6.062 0 0 1 6 18.719m12 0a5.971 5.971 0 0 0-.941-3.197m0 0A5.995 5.995 0 0 0 12 12.75a5.995 5.995 0 0 0-5.058 2.772m0 0a3 3 0 0 0-4.681 2.72 8.986 8.986 0 0 0 3.74.477m.94-3.197a5.971 5.971 0 0 0-.94 3.197M15 6.75a3 3 0 1 1-6 0 3 3 0 0 1 6 0Zm6 3a2.25 2.25 0 1 1-4.5 0 2.25 2.25 0 0 1 4.5 0Zm-13.5 0a2.25 2.25 0 1 1-4.5 0 2.25 2.25 0 0 1 4.5 0Z" />
      </svg>
    ),
  },
  {
    href:  '/oyabun/billing',
    label: '請求・支払管理',
    icon:  (
      <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" strokeWidth={1.6} stroke="currentColor">
        <path strokeLinecap="round" strokeLinejoin="round" d="M2.25 18.75a60.07 60.07 0 0 1 15.797 2.101c.727.198 1.453-.342 1.453-1.096V18.75M3.75 4.5v.75A.75.75 0 0 1 3 6h-.75m0 0v-.375c0-.621.504-1.125 1.125-1.125H20.25M2.25 6v9m18-10.5v.75c0 .414.336.75.75.75h.75m-1.5-1.5h.375c.621 0 1.125.504 1.125 1.125v9.75c0 .621-.504 1.125-1.125 1.125h-.375m1.5-1.5H21a.75.75 0 0 0-.75.75v.75m0 0H3.75m0 0h-.375a1.125 1.125 0 0 1-1.125-1.125V15m1.5 1.5v-.75A.75.75 0 0 0 3 15h-.75M15 10.5a3 3 0 1 1-6 0 3 3 0 0 1 6 0Zm3 0h.008v.008H18V10.5Zm-12 0h.008v.008H6V10.5Z" />
      </svg>
    ),
  },
] as const

// ── NavLink ───────────────────────────────────────────────

function NavLink({
  href,
  label,
  icon,
  active,
  onClick,
}: {
  href: string
  label: string
  icon: React.ReactNode
  active: boolean
  onClick?: () => void
}) {
  return (
    <Link
      href={href}
      onClick={onClick}
      className={`flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium transition-colors ${
        active
          ? 'bg-zinc-900 text-white'
          : 'text-zinc-600 hover:bg-zinc-100 hover:text-zinc-900'
      }`}
    >
      {icon}
      {label}
    </Link>
  )
}

// ── ロゴ ─────────────────────────────────────────────────

function Logo() {
  return (
    <div className="flex items-center gap-2 px-3 py-1">
      <div className="h-7 w-7 rounded-lg bg-zinc-900 flex items-center justify-center">
        <span className="text-white text-xs font-bold">響</span>
      </div>
      <span className="font-semibold text-zinc-900 tracking-tight">HIBIKI</span>
    </div>
  )
}

// ── お気に入りセクション ──────────────────────────────────

function FavoritesSection({ onNavClick }: { onNavClick?: () => void }) {
  const { favorites, remove } = useFavorites()

  if (favorites.length === 0) return null

  return (
    <div className="mb-3">
      <p className="px-3 mb-1.5 text-[10px] font-semibold uppercase tracking-widest text-amber-500">
        ⭐ マイショートカット
      </p>
      {favorites.map(fav => (
        <div
          key={fav.id}
          className="flex items-center group rounded-lg hover:bg-amber-50 transition-colors"
        >
          <Link
            href={fav.url}
            onClick={onNavClick}
            className="flex flex-1 items-center gap-2.5 px-3 py-2 text-sm font-medium text-zinc-700 hover:text-zinc-900 min-w-0"
          >
            <span className="text-amber-400 text-sm leading-none shrink-0">⭐</span>
            <span className="truncate">{fav.label}</span>
          </Link>
          <button
            onClick={() => remove(fav.id)}
            aria-label={`${fav.label} をショートカットから削除`}
            className="pr-3 text-zinc-300 hover:text-red-400 opacity-0 group-hover:opacity-100 transition-all text-xs shrink-0"
          >
            ✕
          </button>
        </div>
      ))}
      <div className="mx-3 mt-2 border-t border-zinc-100" />
    </div>
  )
}

// ── サイドバー内容 ────────────────────────────────────────

function SidebarContent({
  pathname,
  email,
  onNavClick,
}: {
  pathname: string
  email: string
  onNavClick?: () => void
}) {
  return (
    <div className="flex h-full flex-col">
      {/* ロゴ */}
      <div className="px-4 py-5 border-b border-zinc-100">
        <Logo />
      </div>

      {/* ナビゲーション */}
      <nav className="flex-1 overflow-y-auto px-3 py-4">
        {/* ⭐ マイショートカット（お気に入りがある場合のみ表示） */}
        <FavoritesSection onNavClick={onNavClick} />

        <p className="px-3 mb-2 text-[10px] font-semibold uppercase tracking-widest text-zinc-400">
          管理メニュー
        </p>
        <div className="space-y-1">
          {NAV_ITEMS.map(item => (
            <NavLink
              key={item.href}
              href={item.href}
              label={item.label}
              icon={item.icon}
              active={pathname.startsWith(item.href)}
              onClick={onNavClick}
            />
          ))}
        </div>
      </nav>

      {/* ユーザー情報・ログアウト */}
      <div className="border-t border-zinc-100 px-4 py-4">
        <p className="text-xs text-zinc-400 truncate mb-2">{email}</p>
        <form action={handleLogout}>
          <button
            type="submit"
            className="w-full rounded-lg border border-zinc-200 px-3 py-2 text-sm text-zinc-600 hover:bg-zinc-50 hover:text-zinc-900 transition text-left"
          >
            ログアウト
          </button>
        </form>
      </div>
    </div>
  )
}

// ── Shell ─────────────────────────────────────────────────

export default function OyabunShell({
  email,
  children,
}: {
  email: string
  children: React.ReactNode
}) {
  const pathname = usePathname()
  const [drawerOpen, setDrawerOpen] = useState(false)

  return (
    <div className="flex h-screen bg-zinc-50 overflow-hidden">

      {/* ── デスクトップ サイドバー ─────────────────────── */}
      <aside className="hidden lg:flex w-60 shrink-0 flex-col border-r border-zinc-200 bg-white">
        <SidebarContent pathname={pathname} email={email} />
      </aside>

      {/* ── モバイル ドロワー オーバーレイ ─────────────── */}
      {drawerOpen && (
        <div
          className="fixed inset-0 z-40 bg-black/40 lg:hidden"
          onClick={() => setDrawerOpen(false)}
        />
      )}

      {/* ── モバイル ドロワー ────────────────────────── */}
      <aside
        className={`fixed inset-y-0 left-0 z-50 w-64 bg-white border-r border-zinc-200 transform transition-transform duration-200 lg:hidden ${
          drawerOpen ? 'translate-x-0' : '-translate-x-full'
        }`}
      >
        <SidebarContent
          pathname={pathname}
          email={email}
          onNavClick={() => setDrawerOpen(false)}
        />
      </aside>

      {/* ── メインエリア ───────────────────────────────── */}
      <div className="flex flex-1 flex-col min-w-0 overflow-hidden">

        {/* モバイル ヘッダー */}
        <header className="lg:hidden flex items-center justify-between border-b border-zinc-200 bg-white px-4 py-3">
          <button
            onClick={() => setDrawerOpen(true)}
            className="rounded-md p-1.5 text-zinc-500 hover:bg-zinc-100 hover:text-zinc-900"
            aria-label="メニューを開く"
          >
            <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" strokeWidth={1.8} stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" d="M3.75 6.75h16.5M3.75 12h16.5m-16.5 5.25h16.5" />
            </svg>
          </button>
          <Logo />
          <form action={handleLogout}>
            <button type="submit" className="text-xs text-zinc-500 hover:text-zinc-900 transition">
              ログアウト
            </button>
          </form>
        </header>

        {/* ページコンテンツ */}
        <main className="flex-1 overflow-y-auto">
          {children}
        </main>
      </div>
    </div>
  )
}
