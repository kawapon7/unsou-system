import { requireOwner, type AuthResult } from '@/utils/auth'

/** OPERATOR_USER_IDS（カンマ区切りUUID）をパースする。未設定・空は空配列＝全員拒否（fail-closed）。 */
export function parseOperatorIds(raw: string | undefined): string[] {
  return (raw ?? '').split(',').map(s => s.trim()).filter(Boolean)
}

export function isOperatorId(userId: string, ids: string[]): boolean {
  return ids.includes(userId)
}

/**
 * 運営者（HIBIKI側）専用ガード。owner であることに加え、
 * OPERATOR_USER_IDS に userId が含まれることを要求する。
 * ⚠️ B社前のRLS見直しで正式ロール `operator` に昇格予定。ゲート判定はこの関数に集約しておくこと。
 */
export async function requireOperator(): Promise<AuthResult> {
  const res = await requireOwner()
  if (!res.ok) return res
  const ids = parseOperatorIds(process.env.OPERATOR_USER_IDS)
  if (!isOperatorId(res.ctx.userId, ids)) {
    return { ok: false, error: '権限がありません（運営者専用の操作です）。' }
  }
  return res
}
