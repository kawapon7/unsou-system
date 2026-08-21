'use client'

import { usePathname } from 'next/navigation'
import { NAV_GROUPS, CATEGORY_STYLES } from '@/app/admin/nav'

// 画面内タブの共通コンポーネント（ステップ③）。
// 現在のパスから所属カテゴリを自動判定し、アクティブタブをカテゴリ色で表示する。
// 配色ルールは docs/UI_REDESIGN_PLAN.md §3 を正とする。
export default function TabNav<K extends string>({
  tabs,
  active,
  onSelect,
}: {
  tabs: ReadonlyArray<{ key: K; label: string }>
  active: K
  onSelect: (key: K) => void
}) {
  const pathname = usePathname()
  const group = NAV_GROUPS.find(g =>
    g.items.some(item => pathname.startsWith(item.href.split('?')[0]))
  )
  // 管理画面ページは必ずいずれかのグループに属する。念のためのフォールバックは slate
  const s = CATEGORY_STYLES[group?.accent ?? 'slate']

  return (
    <div className="flex gap-1 border-b border-zinc-200 mb-6 overflow-x-auto">
      {tabs.map(({ key, label }) => (
        <button
          key={key}
          type="button"
          onClick={() => onSelect(key)}
          className={`px-5 py-2.5 text-sm font-medium border-b-2 -mb-px whitespace-nowrap transition ${
            active === key
              ? s.tabActive
              : 'border-transparent text-zinc-500 hover:text-zinc-700'
          }`}
        >
          {label}
        </button>
      ))}
    </div>
  )
}
