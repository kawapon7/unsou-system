'use client'

import { useEffect } from 'react'
import { useRouter } from 'next/navigation'

// 2026-08-05障害の回避策（応急・全画面共通）:
// 本ビルドのNext 16.2.7では、初回ページロード時にルーターのアクションキュー先頭へ
// 未解決の内部アクションが残り、以後の全Server Action（読み取り・書き込みとも）が
// 送信されないまま無言で滞留する。ナビゲーションだけは詰まった先頭を破棄して
// 割り込める仕様のため、マウント直後に同一URLへのreplaceを1回発行してキューを流す。
// 真因（キュー先頭に何が居座るか）はNext内部起動処理で未特定。解消されたら本コンポーネントごと削除する。
export default function ActionQueueUnblock() {
  const router = useRouter()
  useEffect(() => {
    router.replace(
      window.location.pathname + window.location.search + window.location.hash,
      { scroll: false },
    )
  }, [router])
  return null
}
