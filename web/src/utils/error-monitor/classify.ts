import type { Severity, Source } from './types'
import { CRITICAL_ACTIONS } from './critical-actions'

/**
 * 戻り値 {error} の文字列がシステム由来（DB/PostgREST/接続/認証基盤）かを判定する。
 * 一致しないものは業務メッセージ（「委託先が見つかりません」等）として記録しない。spec §3。
 * ⚠️ パターン追加時はテストに一致例・不一致例を両方足す。
 */
export const SYSTEM_ERROR_PATTERNS: readonly RegExp[] = [
  /PGRST\d+/,
  /duplicate key/i,
  /violates .*(constraint|policy)/i,
  /connection|ECONN|timeout|timed out/i,
  /fetch failed|Failed to fetch/i,
  /permission denied/i,
  /(relation|column) .* does not exist/i,
  /JWT|invalid token/i,
  /Internal Server Error|^5\d\d\b/,
]

export function isSystemError(message: string): boolean {
  if (!message) return false
  return SYSTEM_ERROR_PATTERNS.some((re) => re.test(message))
}

export function severityFor(source: Source, actionName: string): Severity {
  if (source === 'cron') return 'critical'
  if (source === 'action' && CRITICAL_ACTIONS.has(actionName)) return 'critical'
  return 'normal'
}
