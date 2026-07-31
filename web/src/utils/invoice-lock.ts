/**
 * 確定済み請求書（issued / paid）の上書きを止める判定。
 *
 * ⚠️ 共通ライタ `invoice-writer.ts` は意図的にロックを守らない
 *    （スキャン取込・手動入力など、ロック概念を持たない経路も同じライタを使うため）。
 *    したがって invoices を書く経路は、書く前に自分でこの関数を通す責任がある。
 *
 * 2026-07-31 の事故: `/admin/sales`「請求書プレビュー」タブの再確定（`upsertInvoice`）が
 * この判定を持たず、issued の請求書を無警告で上書きした（税抜 134,500 → 130,510）。
 * 「確定・ロック」タブ側にしか砦が無い状態だったため、両経路で同じ判定を共有する。
 *
 * 'use server' ファイルからは非async関数を export できないため、ここは純粋関数の置き場
 * （`utils/` 配下・`'use server'` を付けない）に置いてある。
 */

/** 上書きを禁止するステータス */
const LOCKED_STATUSES = ['issued', 'paid'] as const

export type InvoiceLockState = { status: string | null } | null

export type InvoiceUnlockOptions = {
  isDeveloperUnlock?: boolean
  unlockReason?: string
}

/**
 * 上書きしてよければ null、止めるべきならユーザー向けエラーメッセージを返す。
 *
 * @param existing 既存請求書の行（無ければ null）
 * @param opts     開発者アンロックの指定。理由が空白だけの場合は理由なしとして扱う
 */
export function invoiceLockError(
  existing: InvoiceLockState,
  opts?: InvoiceUnlockOptions,
): string | null {
  const status = existing?.status
  if (!status) return null
  if (!LOCKED_STATUSES.includes(status as (typeof LOCKED_STATUSES)[number])) return null

  const hasReason = (opts?.unlockReason ?? '').trim().length > 0
  if (opts?.isDeveloperUnlock && hasReason) return null

  return `請求書はすでに「${status}」状態のため変更できません。開発者アンロックが必要です。`
}
