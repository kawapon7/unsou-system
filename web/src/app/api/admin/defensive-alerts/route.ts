import { NextResponse } from 'next/server'
import { getDefensiveAlerts } from '@/app/_actions/defensiveAlertActions'
import { capturedRoute } from '@/utils/error-monitor/captured'

// ── Route Handler ─────────────────────────────────────────
// 管理画面のアラートパネル用 GET 窓口。
// Server Action のアクションキュー（直列処理）を経由させないための読み取り専用経路。
// 認可は getDefensiveAlerts 内部の requireOwner が fail-closed で実施する。

async function handleGet() {
  const result = await getDefensiveAlerts()
  // 認可エラーもボディの error 文字列で返す（パネル側の既存ハンドリングと同一形状を維持）
  return NextResponse.json(result)
}

export const GET = capturedRoute('admin/defensive-alerts', handleGet)
