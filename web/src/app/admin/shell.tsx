'use client'

import { useState, Suspense } from 'react'
import DefensiveAlertPanel from '@/app/admin/_components/DefensiveAlertPanel'
import Link from 'next/link'
import { usePathname, useSearchParams } from 'next/navigation'
import { handleLogout } from '@/app/auth/actions'
import { useFavorites } from '@/hooks/useFavorites'
import { MonthProvider, useMonth } from '@/contexts/MonthContext'

import { NAV_GROUPS, ALL_NAV_ITEMS, CATEGORY_STYLES, type CategoryAccent } from './nav'

// ── ページラベル定義（星ボタン用） ───────────────────────
// 新しいメニューを追加したら、ここに1行足すだけで自動対応

type PageDef = {
  label:    string
  paramKey?: string
  tabs?:    Record<string, string>
}

const PAGE_DEFS: Record<string, PageDef> = {
  '/admin': {
    label: 'ホーム',
  },
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
    },
  },
  '/admin/approval': {
    label:    '承認管理',
    paramKey: 'tab',
    tabs: {
      payment: '支払通知書承認',
      work:    '勤務記録承認',
      expense: '立替金承認',
      history: '承認履歴',
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
      approval: '承認進捗',
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
  '/admin/settings/company': {
    label: '自社情報',
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

// ── パンくず（現在地表示: 大メニュー › 画面名 › タブ名） ──
// ラベルは PAGE_DEFS / NAV_GROUPS を再利用（二重管理しない）

function BreadcrumbInner() {
  const pathname     = usePathname()
  const searchParams = useSearchParams()

  const def = PAGE_DEFS[pathname]
  if (!def) return null

  const group = NAV_GROUPS.find(g =>
    g.items.some(item => pathname.startsWith(item.href.split('?')[0]))
  )
  const paramVal = def.paramKey ? (searchParams.get(def.paramKey) ?? null) : null
  const tabLabel = paramVal && def.tabs ? (def.tabs[paramVal] ?? null) : null

  return (
    <div className="flex items-center gap-2 border-b border-zinc-100 bg-white px-4 lg:px-6 py-2.5 text-xs font-medium text-zinc-500">
      {group && (
        <>
          <span className={`h-2 w-2 rounded-full ${CATEGORY_STYLES[group.accent].dot}`} />
          <span>{group.cardTitle}</span>
          <span className="text-zinc-300">›</span>
        </>
      )}
      <span className={tabLabel ? undefined : 'text-zinc-900'}>{def.label}</span>
      {tabLabel && (
        <>
          <span className="text-zinc-300">›</span>
          <span className="text-zinc-900">{tabLabel}</span>
        </>
      )}
    </div>
  )
}

function Breadcrumb() {
  return (
    <Suspense fallback={null}>
      <BreadcrumbInner />
    </Suspense>
  )
}

// ── NavLink ───────────────────────────────────────────────

function NavLink({
  href,
  label,
  icon,
  accent,
  active,
  onClick,
}: {
  href: string
  label: string
  icon: React.ReactNode
  accent: CategoryAccent
  active: boolean
  onClick?: () => void
}) {
  const s = CATEGORY_STYLES[accent]
  return (
    <Link
      href={href}
      onClick={onClick}
      className={`flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium transition-colors ${
        active
          ? `${s.activeBg} ${s.activeText}`
          : 'text-zinc-600 hover:bg-zinc-100 hover:text-zinc-900'
      }`}
    >
      {/* アイコンは常時カテゴリ色（「アイコンのみ色」方式） */}
      <span className={s.iconText}>{icon}</span>
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
  accent,
  onClick,
}: {
  href: string
  label: string
  icon: React.ReactNode
  accent: CategoryAccent
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

  return <NavLink href={href} label={label} icon={icon} accent={accent} active={active} onClick={onClick} />
}

function NavLinkSuspended(props: { href: string; label: string; icon: React.ReactNode; accent: CategoryAccent; onClick?: () => void }) {
  return (
    <Suspense fallback={
      <span className="flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium text-zinc-600">
        <span className={CATEGORY_STYLES[props.accent].iconText}>{props.icon}</span>{props.label}
      </span>
    }>
      <NavLinkInner {...props} />
    </Suspense>
  )
}

// ── ロゴ ─────────────────────────────────────────────────

function Logo() {
  return (
    <Link href="/admin" className="flex items-center gap-2 px-3 py-1 rounded-lg hover:bg-zinc-100 transition-colors" title="ホームへ戻る">
      <div className="h-7 w-7 rounded-lg bg-zinc-900 flex items-center justify-center">
        <span className="text-white text-xs font-bold">響</span>
      </div>
      <span className="font-semibold text-zinc-900 tracking-tight">HIBIKI</span>
    </Link>
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
            <p className={`px-3 mb-1.5 text-[10px] font-semibold uppercase tracking-widest ${CATEGORY_STYLES[group.accent].labelText}`}>
              {group.groupLabel}
            </p>
            <div className="space-y-0.5">
              {group.items.map(item => (
                <NavLinkSuspended
                  key={item.href}
                  href={item.href}
                  label={item.label}
                  icon={item.icon}
                  accent={group.accent}
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
          <div className="flex items-center gap-2">
            <button
              onClick={() => setDrawerOpen(true)}
              className="rounded-md p-1.5 text-zinc-500 hover:bg-zinc-100 hover:text-zinc-900"
              aria-label="メニューを開く"
            >
              <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" strokeWidth={1.8} stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" d="M3.75 6.75h16.5M3.75 12h16.5m-16.5 5.25h16.5" />
              </svg>
            </button>
            <StarButton />
          </div>
          <Logo />
          <form action={handleLogout}>
            <button type="submit" className="text-xs text-zinc-500 hover:text-zinc-900 transition">
              ログアウト
            </button>
          </form>
        </header>

        {/* パンくず（現在地表示） */}
        <Breadcrumb />

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
