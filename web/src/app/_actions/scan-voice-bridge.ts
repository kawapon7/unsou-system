'use server'

import { createClient } from '@/utils/supabase/server'
import { createServiceClient } from '@/utils/supabase/service'

// metadata 更新を許可するテーブルのみ列挙（口座情報を持つ contractors は対象外）
type MetadataTable = 'clients' | 'work_records' | 'expense_records'

type ActionResult<T = void> =
  | { data: T; error: null }
  | { data: null; error: string }

// JSONB ディープマージ（ネストオブジェクトを再帰的にマージ、配列は上書き）
function deepMerge(
  base: Record<string, unknown>,
  patch: Record<string, unknown>,
): Record<string, unknown> {
  const result = { ...base }
  for (const key of Object.keys(patch)) {
    const pv = patch[key]
    const bv = result[key]
    if (
      pv !== null && typeof pv === 'object' && !Array.isArray(pv) &&
      bv !== null && typeof bv === 'object' && !Array.isArray(bv)
    ) {
      result[key] = deepMerge(
        bv as Record<string, unknown>,
        pv as Record<string, unknown>,
      )
    } else {
      result[key] = pv
    }
  }
  return result
}

async function requireSession() {
  const supabase = await createClient()
  const { data: { user }, error } = await supabase.auth.getUser()
  if (error || !user) return null
  return user
}

/**
 * 指定テーブルの metadata カラムをディープマージで更新する。
 *
 * namespacedPatch のキーは拡張オプション固有の名前空間プレフィックスを
 * 必ず付与すること（例: { "scan::driver_verified": true }）。
 * 既存の他名前空間キーは破壊されない。
 */
export async function mergeMetadata(
  table: MetadataTable,
  id: string,
  namespacedPatch: Record<string, unknown>,
): Promise<ActionResult> {
  const user = await requireSession()
  if (!user) return { data: null, error: '認証が必要です' }

  const service = createServiceClient()

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: current, error: fetchErr } = await (service.from(table) as any)
    .select('metadata')
    .eq('id', id)
    .single()

  if (fetchErr || !current) {
    return { data: null, error: fetchErr?.message ?? 'レコードが見つかりません' }
  }

  const merged = deepMerge(
    (current.metadata as Record<string, unknown>) ?? {},
    namespacedPatch,
  )

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { error: updateErr } = await (service.from(table) as any)
    .update({ metadata: merged })
    .eq('id', id)

  if (updateErr) return { data: null, error: updateErr.message }

  return { data: undefined, error: null }
}

/**
 * 指定テーブルの metadata から特定名前空間のキーをすべて削除する。
 * 拡張オプション無効化時のクリーンアップ用。
 */
export async function clearMetadataNamespace(
  table: MetadataTable,
  id: string,
  namespace: string,
): Promise<ActionResult> {
  const user = await requireSession()
  if (!user) return { data: null, error: '認証が必要です' }

  const service = createServiceClient()

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: current, error: fetchErr } = await (service.from(table) as any)
    .select('metadata')
    .eq('id', id)
    .single()

  if (fetchErr || !current) {
    return { data: null, error: fetchErr?.message ?? 'レコードが見つかりません' }
  }

  const prefix = `${namespace}::`
  const cleaned = Object.fromEntries(
    Object.entries((current.metadata as Record<string, unknown>) ?? {}).filter(
      ([k]) => !k.startsWith(prefix),
    ),
  )

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { error: updateErr } = await (service.from(table) as any)
    .update({ metadata: cleaned })
    .eq('id', id)

  if (updateErr) return { data: null, error: updateErr.message }

  return { data: undefined, error: null }
}
