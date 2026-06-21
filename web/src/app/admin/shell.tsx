'use client'

import { useState, Suspense } from 'react'
import DefensiveAlertPanel from '@/app/admin/_components/DefensiveAlertPanel'
import Link from 'next/link'
import { usePathname, useSearchParams } from 'next/navigation'
import { handleLogout } from '@/app/auth/actions'
import { useFavorites } from '@/hooks/useFavorites'
import { MonthProvider, useMonth } from '@/contexts/MonthContext'

// ── ナビグループ定義 ──────────────────────────────────────

type NavItem = {
  href:  string
  label: string
  icon:  React.ReactNode
}

type NavGroup = {
  groupLabel: string
  items: NavItem[]
}

const NAV_GROUPS: NavGroup[] = [
  {
    groupLabel: '日常業務（高頻度）',
    items: [
      {
        href:  '/admin/dashboard',
        label: '業績サマリー',
        icon:  (
          <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" strokeWidth={1.6} stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" d="M8.25 18.75a1.5 1.5 0 0 1-3 0m3 0a1.5 1.5 0 0 0-3 0m3 0h6m-9 0H3.375a1.125 1.125 0 0 1-1.125-1.125V14.25m17.25 4.5a1.5 1.5 0 0 1-3 0m3 0a1.5 1.5 0 0 0-3 0m3 0h1.125c.621 0 1.129-.504 1.09-1.124a17.902 17.902 0 0 0-3.213-9.193 2.056 2.056 0 0 0-1.58-.86H14.25M16.5 18.75h-2.25m0-11.177v-.958c0-.568-.422-1.048-.987-1.106a48.554 48.554 0 0 0-10.026 0 1.106 1.106 0 0 0-.987 1.106v7.635m12-6.677v6.677m0 4.5v-4.5m0 0h-12" />
          </svg>
        ),
      },
      {
        href:  '/admin/schedules',
        label: '案件カレンダー',
        icon:  (
          <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" strokeWidth={1.6} stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" d="M6.75 3v2.25M17.25 3v2.25M3 18.75V7.5a2.25 2.25 0 0 1 2.25-2.25h13.5A2.25 2.25 0 0 1 21 7.5v11.25m-18 0A2.25 2.25 0 0 0 5.25 21h13.5A2.25 2.25 0 0 0 21 18.75m-18 0v-7.5A2.25 2.25 0 0 1 5.25 9h13.5A2.25 2.25 0 0 1 21 11.25v7.5m-9-6h.008v.008H12v-.008ZM12 15h.008v.008H12V15Zm0 2.25h.008v.008H12v-.008ZM9.75 15h.008v.008H9.75V15Zm0 2.25h.008v.008H9.75v-.008ZM7.5 15h.008v.008H7.5V15Zm0 2.25h.008v.008H7.5v-.008Zm6.75-4.5h.008v.008h-.008v-.008Zm0 2.25h.008v.008h-.008V15Zm0 2.25h.008v.008h-.008v-.008Zm2.25-4.5h.008v.008H16.5v-.008Zm0 2.25h.008v.008H16.5V15Z" />
          </svg>
        ),
      },
    ],
  },
  {
    groupLabel: '月次・締め業務（中頻度）',
    items: [
      {
        href:  '/admin/scan',
        label: 'AIスキャン',
        icon:  (
          <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" strokeWidth={1.6} stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" d="M7.5 3.75H6A2.25 2.25 0 0 0 3.75 6v1.5M16.5 3.75H18A2.25 2.25 0 0 1 20.25 6v1.5m0 9V18A2.25 2.25 0 0 1 18 20.25h-1.5m-9 0H6A2.25 2.25 0 0 1 3.75 18v-1.5M15 12a3 3 0 1 1-6 0 3 3 0 0 1 6 0Z" />
          </svg>
        ),
      },
      {
        href:  '/admin/sales',
        label: '売上・請求管理（IN）',
        icon:  (
          <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" strokeWidth={1.6} stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" d="M3 13.125C3 12.504 3.504 12 4.125 12h2.25c.621 0 1.125.504 1.125 1.125v6.75C7.5 20.496 6.996 21 6.375 21h-2.25A1.125 1.125 0 0 1 3 19.875v-6.75ZM9.75 8.625c0-.621.504-1.125 1.125-1.125h2.25c.621 0 1.125.504 1.125 1.125v11.25c0 .621-.504 1.125-1.125 1.125h-2.25a1.125 1.125 0 0 1-1.125-1.125V8.625ZM16.5 4.125c0-.621.504-1.125 1.125-1.125h2.25C20.496 3 21 3.504 21 4.125v15.75c0 .621-.504 1.125-1.125 1.125h-2.25a1.125 1.125 0 0 1-1.125-1.125V4.125Z" />
          </svg>
        ),
      },
      {
        href:  '/admin/billing',
        label: '請求・支払管理(OUT)',
        icon:  (
          <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" strokeWidth={1.6} stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" d="M2.25 18.75a60.07 60.07 0 0 1 15.797 2.101c.727.198 1.453-.342 1.453-1.096V18.75M3.75 4.5v.75A.75.75 0 0 1 3 6h-.75m0 0v-.375c0-.621.504-1.125 1.125-1.125H20.25M2.25 6v9m18-10.5v.75c0 .414.336.75.75.75h.75m-1.5-1.5h.375c.621 0 1.125.504 1.125 1.125v9.75c0 .621-.504 1.125-1.125 1.125h-.375m1.5-1.5H21a.75.75 0 0 0-.75.75v.75m0 0H3.75m0 0h-.375a1.125 1.125 0 0 1-1.125-1.125V15m1.5 1.5v-.75A.75.75 0 0 0 3 15h-.75M15 10.5a3 3 0 1 1-6 0 3 3 0 0 1 6 0Zm3 0h.008v.008H18V10.5Zm-12 0h.008v.008H6V10.5Z" />
          </svg>
        ),
      },
      {
        href:  '/admin/cashflow',
        label: '収支管理ビュアー',
        icon:  (
          <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" strokeWidth={1.6} stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" d="M7.5 14.25v2.25m3-4.5v4.5m3-6.75v6.75m3-9v9M6 20.25h12A2.25 2.25 0 0 0 20.25 18V6A2.25 2.25 0 0 0 18 3.75H6A2.25 2.25 0 0 0 3.75 6v12A2.25 2.25 0 0 0 6 20.25Z" />
          </svg>
        ),
      },
    ],
  },
  {
    groupLabel: 'マスタ・設定（低頻度）',
    items: [
      {
        href:  '/admin/partners',
        label: '取引先マスタ',
        icon:  (
          <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" strokeWidth={1.6} stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" d="M18 18.72a9.094 9.094 0 0 0 3.741-.479 3 3 0 0 0-4.682-2.72m.94 3.198.001.031c0 .225-.012.447-.037.666A11.944 11.944 0 0 1 12 21c-2.17 0-4.207-.576-5.963-1.584A6.062 6.062 0 0 1 6 18.719m12 0a5.971 5.971 0 0 0-.941-3.197m0 0A5.995 5.995 0 0 0 12 12.75a5.995 5.995 0 0 0-5.058 2.772m0 0a3 3 0 0 0-4.681 2.72 8.986 8.986 0 0 0 3.74.477m.94-3.197a5.971 5.971 0 0 0-.94 3.197M15 6.75a3 3 0 1 1-6 0 3 3 0 0 1 6 0Zm6 3a2.25 2.25 0 1 1-4.5 0 2.25 2.25 0 0 1 4.5 0Zm-13.5 0a2.25 2.25 0 1 1-4.5 0 2.25 2.25 0 0 1 4.5 0Z" />
          </svg>
        ),
      },
      {
        href:  '/admin/projects',
        label: '案件管理',
        icon:  (
          <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" strokeWidth={1.6} stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" d="M9 6.75V15m6-6v8.25m.503 3.498 4.875-2.437c.381-.19.622-.58.622-1.006V4.82c0-.836-.88-1.38-1.628-1.006l-3.869 1.934c-.317.159-.69.159-1.006 0L9.503 3.252a1.125 1.125 0 0 0-1.006 0L3.622 5.689C3.24 5.88 3 6.27 3 6.695V19.18c0 .836.88 1.38 1.628 1.006l3.869-1.934c-.317-.159.69-.159 1.006 0l4.994 2.497c.317.158.69.158 1.006 0Z" />
          </svg>
        ),
      },
      {
        href:  '/admin/users',
        label: 'アカウント管理',
        icon:  (
          <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" strokeWidth={1.6} stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" d="M15.75 6a3.75 3.75 0 1 1-7.5 0 3.75 3.75 0 0 1 7.5 0ZM4.501 20.118a7.5 7.5 0 0 1 14.998 0A17.933 17.933 0 0 1 12 21.75c-2.676 0-5.216-.584-7.499-1.632Z" />
          </svg>
        ),
      },
    ],
  },
]

// フラットリスト（active 判定用）
const ALL_NAV_ITEMS: NavItem[] = NAV_GROUPS.flatMap(g => g.items)

// ── ページラベル定義（星ボタン用） ───────────────────────
// 新しいメニューを追加したら、ここに1行足すだけで自動対応

type PageDef = {
  label:    string
  paramKey?: string
  tabs?:    Record<string, string>
}

const PAGE_DEFS: Record<string, PageDef> = {
  '/admin/dashboard': {
    label:    '業績サマリー',
    paramKey: 'tab',
    tabs: {
      summary:  'サマリー',
      projects: '案件別',
    },
  },
  '/admin/schedules': {
    label: '案件カレンダー',
  },
  '/admin/scan': {
    label:    'AIスキャン',
    paramKey: 'tab',
    tabs: {
      in:      '売上書類取込（IN）',
      out:     '支払書類取込（OUT）',
      history: '取り込み履歴',
    },
  },
  '/admin/sales': {
    label:    '売上・請求管理（IN）',
    paramKey: 'tab',
    tabs: {
      list:     '売上一覧',
      generate: '請求書生成',
      payment:  '入金管理',
    },
  },
  '/admin/billing': {
    label:    '請求・支払管理(OUT)',
    paramKey: 'tab',
    tabs: {
      payment: '委託先向け支払管理',
      expense: '立替金承認',
    },
  },
  '/admin/cashflow': {
    label:    '収支管理ビュアー',
    paramKey: 'tab',
    tabs: {
      pnl:      '月次損益',
      client:   '荷主別粗利',
      trend:    '推移グラフ',
      calendar: '金額カレンダー',
    },
  },
  '/admin/partners': {
    label:    '取引先一覧',
    paramKey: 'tab',
    tabs: {
      clients:     '荷主マスタ',
      contractors: '委託先マスタ',
    },
  },
  '/admin/projects': {
    label:    '案件管理',
    paramKey: 'status',
    tabs: {
      accepted:  '受託',
      completed: '完了',
      cancelled: 'キャンセル',
    },
  },
  '/admin/users': {
    label: 'アカウント管理',
  },
}

// ── 星ボタン（useSearchParams を使うので Suspense で包む） ─

function StarButtonInner() {
  const pathname     = usePathname()
  const searchParams = useSearchParams()
  const { isFav, toggle } = useFavorites()

  const def = PAGE_DEFS[pathname]
  if (!def) return null

  const paramVal = def.paramKey ? (searchParams.get(def.paramKey) ?? null) : null
  const tabLabel = paramVal && def.tabs ? (def.tabs[paramVal] ?? null) : null
  const label    = tabLabel ? `${def.label}（${tabLabel}）` : def.label
  const url      = paramVal && def.paramKey
    ? `${pathname}?${def.paramKey}=${paramVal}`
    : pathname
  const starred  = isFav(url)

  return (
    <button
      onClick={() => toggle({ id: url, label, url })}
      aria-label={starred ? 'ショートカットから削除' : 'ショートカットに追加'}
      title={starred ? `「${label}」をショートカットから削除` : `「${label}」をサイドバーにピン留め`}
      className={`text-lg leading-none transition-transform duration-150 hover:scale-125 active:scale-95 select-none ${!starred ? 'text-gray-500' : ''}`}
    >
      {starred ? '⭐' : '☆'}
    </button>
  )
}

function StarButton() {
  return (
    <Suspense fallback={<span className="inline-block w-6" />}>
      <StarButtonInner />
    </Suspense>
  )
}

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

// active判定: クエリパラメータを含めて正確に判定する
// useSearchParams が必要なため Suspense でラップして使う
function NavLinkInner({
  href,
  label,
  icon,
  onClick,
}: {
  href: string
  label: string
  icon: React.ReactNode
  onClick?: () => void
}) {
  const pathname    = usePathname()
  const searchParams = useSearchParams()

  const [itemPath, itemQuery] = href.split('?')
  const pathMatch = pathname.startsWith(itemPath)

  let active: boolean
  if (!pathMatch) {
    active = false
  } else if (itemQuery) {
    // クエリあり → 現在URLにそのクエリが一致する場合のみactive
    const [key, val] = itemQuery.split('=')
    active = searchParams.get(key) === val
  } else {
    // クエリなし → 同じパスを持つ他のアイテムのクエリが現在URLに一致しない場合のみactive
    const hasMoreSpecific = ALL_NAV_ITEMS.some(other => {
      const [otherPath, otherQuery] = other.href.split('?')
      if (otherPath !== itemPath || !otherQuery) return false
      const [k, v] = otherQuery.split('=')
      return searchParams.get(k) === v
    })
    active = !hasMoreSpecific
  }

  return <NavLink href={href} label={label} icon={icon} active={active} onClick={onClick} />
}

function NavLinkSuspended(props: { href: string; label: string; icon: React.ReactNode; onClick?: () => void }) {
  return (
    <Suspense fallback={
      <span className="flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium text-zinc-600">
        {props.icon}{props.label}
      </span>
    }>
      <NavLinkInner {...props} />
    </Suspense>
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
            onClick={() => {
              if (window.confirm(`「${fav.label}」をお気に入りから削除しますか？`)) {
                remove(fav.id)
              }
            }}
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

// ── 月セレクター ──────────────────────────────────────────

function MonthPicker() {
  const { yearMonth, setYearMonth, prevMonth, nextMonth, label } = useMonth()
  return (
    <div className="px-3 py-3 border-b border-zinc-100">
      <p className="text-[10px] font-semibold uppercase tracking-widest text-zinc-400 mb-2">対象年月</p>
      <div className="flex items-center gap-1">
        <button
          type="button"
          onClick={prevMonth}
          className="rounded-md border border-zinc-200 px-2 py-1 text-xs text-zinc-500 hover:bg-zinc-100 transition-colors"
          aria-label="前月"
        >
          ←
        </button>
        <input
          type="month"
          value={yearMonth}
          onChange={e => setYearMonth(e.target.value)}
          className="flex-1 min-w-0 rounded-md border border-zinc-200 bg-white px-2 py-1 text-xs text-zinc-900 outline-none focus:border-zinc-400 focus:ring-1 focus:ring-zinc-200 text-center"
          aria-label={label}
        />
        <button
          type="button"
          onClick={nextMonth}
          className="rounded-md border border-zinc-200 px-2 py-1 text-xs text-zinc-500 hover:bg-zinc-100 transition-colors"
          aria-label="翌月"
        >
          →
        </button>
      </div>
    </div>
  )
}

// ── サイドバー内容 ────────────────────────────────────────

function SidebarContent({
  email,
  onNavClick,
}: {
  email: string
  onNavClick?: () => void
}) {
  return (
    <div className="flex h-full flex-col">
      {/* ロゴ + 星ボタン（デスクトップ） */}
      <div className="flex items-center justify-between px-4 py-5 border-b border-zinc-100">
        <Logo />
        <StarButton />
      </div>

      {/* 月セレクター */}
      <MonthPicker />

      {/* ナビゲーション */}
      <nav className="flex-1 overflow-y-auto px-3 py-4">
        {/* ⭐ マイショートカット（お気に入りがある場合のみ表示） */}
        <FavoritesSection onNavClick={onNavClick} />

        {NAV_GROUPS.map((group, gi) => (
          <div key={group.groupLabel} className={gi > 0 ? 'mt-4' : undefined}>
            <p className="px-3 mb-1.5 text-[10px] font-semibold uppercase tracking-widest text-zinc-400">
              {group.groupLabel}
            </p>
            <div className="space-y-0.5">
              {group.items.map(item => (
                <NavLinkSuspended
                  key={item.href}
                  href={item.href}
                  label={item.label}
                  icon={item.icon}
                  onClick={onNavClick}
                />
              ))}
            </div>
            {gi < NAV_GROUPS.length - 1 && (
              <div className="mx-3 mt-3 border-t border-zinc-100" />
            )}
          </div>
        ))}
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
  const [drawerOpen, setDrawerOpen] = useState(false)

  return (
    <MonthProvider>
    <div className="flex h-screen bg-zinc-50 overflow-hidden">

      {/* ── デスクトップ サイドバー ─────────────────────── */}
      <aside className="hidden lg:flex w-60 shrink-0 flex-col border-r border-zinc-200 bg-white">
        <SidebarContent email={email} />
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
          email={email}
          onNavClick={() => setDrawerOpen(false)}
        />
      </aside>

      {/* ── メインエリア ───────────────────────────────── */}
      <div className="flex flex-1 flex-col min-w-0 overflow-hidden">

        {/* モバイル ヘッダー（星ボタン含む） */}
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
          <div className="flex items-center gap-3">
            <StarButton />
            <form action={handleLogout}>
              <button type="submit" className="text-xs text-zinc-500 hover:text-zinc-900 transition">
                ログアウト
              </button>
            </form>
          </div>
        </header>

        {/* ページコンテンツ */}
        <main className="flex-1 overflow-y-auto">
          <div className="px-4 pt-4">
            <DefensiveAlertPanel />
          </div>
          {children}
        </main>
      </div>
    </div>
    </MonthProvider>
  )
}
