// ── 管理画面ナビゲーション定義（サイドバー・トップ画面で共用） ──
// カテゴリ配色ルールは docs/UI_REDESIGN_PLAN.md §3 を正とする。
// ⚠️ Tailwind は動的クラス生成（`bg-${color}-50` 等）をスキャンできないため、
//    色クラスは必ず CATEGORY_STYLES の完全な文字列リテラルで持つこと。

export type CategoryAccent = 'blue' | 'emerald' | 'slate'

export type CategoryStyle = {
  /** カテゴリ識別ドット（大メニュー = 600） */
  dot: string
  /** メニューアイコンの色（600・常時。「アイコンのみ色」方式 2026-08-21確定） */
  iconText: string
  /** リンクホバー（背景50・文字700） */
  itemHover: string
  /** サイドバーのグループ見出し色（600） */
  labelText: string
  /** 選択中メニューの背景（50） */
  activeBg: string
  /** 選択中メニューの文字色（700） */
  activeText: string
  /** アクティブタブ（下線600・文字700） */
  tabActive: string
  /** アクティブなピル（背景600・白文字） */
  pillActive: string
}

export const CATEGORY_STYLES: Record<CategoryAccent, CategoryStyle> = {
  blue: {
    dot:       'bg-blue-600',
    iconText:  'text-blue-600',
    itemHover: 'hover:bg-blue-50 hover:text-blue-700',
    labelText: 'text-blue-600',
    activeBg:  'bg-blue-50',
    activeText: 'text-blue-700',
    tabActive: 'border-blue-600 text-blue-700',
    pillActive: 'bg-blue-600 text-white',
  },
  emerald: {
    dot:       'bg-emerald-600',
    iconText:  'text-emerald-600',
    itemHover: 'hover:bg-emerald-50 hover:text-emerald-700',
    labelText: 'text-emerald-600',
    activeBg:  'bg-emerald-50',
    activeText: 'text-emerald-700',
    tabActive: 'border-emerald-600 text-emerald-700',
    pillActive: 'bg-emerald-600 text-white',
  },
  slate: {
    dot:       'bg-slate-600',
    iconText:  'text-slate-600',
    itemHover: 'hover:bg-slate-100 hover:text-slate-700',
    labelText: 'text-slate-600',
    activeBg:  'bg-slate-100',
    activeText: 'text-slate-700',
    tabActive: 'border-slate-600 text-slate-700',
    pillActive: 'bg-slate-600 text-white',
  },
}

export type NavItem = {
  href:  string
  label: string
  icon:  React.ReactNode
}

export type NavGroup = {
  groupLabel: string
  /** トップ画面カード用の短い名称（頻度注記なし） */
  cardTitle: string
  /** トップ画面カード用の説明文 */
  description: string
  accent: CategoryAccent
  items: NavItem[]
}

export const NAV_GROUPS: NavGroup[] = [
  {
    groupLabel: '日常業務（高頻度）',
    cardTitle: '日常業務',
    description: '毎日の業績確認と案件・配車カレンダー',
    accent: 'blue',
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
    cardTitle: '月次・締め業務',
    description: '売上・支払・承認・収支のお金まわり',
    accent: 'emerald',
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
        href:  '/admin/approval',
        label: '承認管理',
        icon:  (
          <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" strokeWidth={1.6} stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" d="M9 12.75 11.25 15 15 9.75M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0Z" />
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
    cardTitle: 'マスタ・設定',
    description: '取引先・案件・アカウントなどの基礎情報',
    accent: 'slate',
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
      {
        href:  '/admin/settings/company',
        label: '自社情報',
        icon:  (
          <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" strokeWidth={1.6} stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" d="M3.75 21h16.5M4.5 3h15M5.25 3v18m13.5-18v18M9 6.75h1.5m-1.5 3h1.5m-1.5 3h1.5m3-6H15m-1.5 3H15m-1.5 3H15M9 21v-3.375c0-.621.504-1.125 1.125-1.125h3.75c.621 0 1.125.504 1.125 1.125V21" />
          </svg>
        ),
      },
    ],
  },
]

// フラットリスト（active 判定用）
export const ALL_NAV_ITEMS: NavItem[] = NAV_GROUPS.flatMap(g => g.items)
