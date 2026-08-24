import Link from 'next/link'
import { NAV_GROUPS, CATEGORY_STYLES } from './nav'
import { requireOperator } from '@/utils/operator'

// トップ画面（メニューハブ）。配色ルールは docs/UI_REDESIGN_PLAN.md §3 を正とする。
// operatorOnly 項目の出し分けは shell.tsx のサイドバーと同じ方針:
// サーバー側で判定した boolean のみ使い、OPERATOR_USER_IDS の値自体はクライアントへ渡さない。
export default async function AdminHome() {
  const operatorAuth = await requireOperator()
  const isOperator = operatorAuth.ok

  return (
    <div className="mx-auto max-w-5xl px-6 py-10 lg:py-16">
      <header className="mb-10">
        <h1 className="text-2xl font-semibold tracking-tight text-zinc-900">ホーム</h1>
        <p className="mt-1.5 text-sm text-zinc-500">メニューを選んで業務を始めてください</p>
      </header>

      <div className="grid gap-5 md:grid-cols-2 lg:grid-cols-3">
        {NAV_GROUPS.map(group => {
          const s = CATEGORY_STYLES[group.accent]
          const visibleItems = group.items.filter(item => !item.operatorOnly || isOperator)
          if (visibleItems.length === 0) return null
          return (
            <section
              key={group.groupLabel}
              className="rounded-2xl border border-zinc-200 bg-white p-5"
            >
              <div className="flex items-center gap-2">
                <span className={`h-2.5 w-2.5 rounded-full ${s.dot}`} />
                <h2 className="text-sm font-semibold tracking-tight text-zinc-900">
                  {group.cardTitle}
                </h2>
              </div>
              <p className="mt-1 mb-4 text-xs leading-relaxed text-zinc-500">
                {group.description}
              </p>
              <ul className="space-y-0.5">
                {visibleItems.map(item => (
                  <li key={item.href}>
                    <Link
                      href={item.href}
                      className={`flex items-center gap-3 rounded-lg px-2.5 py-2 text-sm font-medium text-zinc-700 transition-colors ${s.itemHover}`}
                    >
                      <span className={s.iconText}>{item.icon}</span>
                      {item.label}
                    </Link>
                  </li>
                ))}
              </ul>
            </section>
          )
        })}
      </div>
    </div>
  )
}
