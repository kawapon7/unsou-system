import { createClient } from '@/utils/supabase/server'
import { createServiceClient } from '@/utils/supabase/service'

export const DEV_TENANT_ID = 'local-dev'

/**
 * 現在のログインユーザーの tenant_id を返す。
 * - ALLOW_DEV_AUTH_BYPASS=true のときのみ 'local-dev' を返す（dev専用フラグ）。
 * - 本番では user_metadata.tenant_id を必須とし、未解決なら例外を投げる
 *   （静かにフォールバックすると全社データ混在の重大事故になるため）。
 */
export async function getCurrentTenantId(): Promise<string> {
  if (process.env.ALLOW_DEV_AUTH_BYPASS === 'true') {
    return DEV_TENANT_ID
  }
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  const tenantId = user?.user_metadata?.tenant_id
  if (typeof tenantId === 'string' && tenantId) return tenantId
  // ⚠️ フォールバック禁止: 本番ではテナント未解決を明示エラーにして fail-closed。
  throw new Error('テナントが解決できません（user_metadata.tenant_id が未設定です）。')
}

/**
 * 全テナントIDの一覧を返す（service_role・セッション不要）。
 * GitHub Actions等、ログインセッションを持たない定期実行処理専用。
 * ⚠️ 管理画面や通常のServer Actionからは絶対に呼ばないこと
 *    （テナント横断アクセスになるため。呼び出しはcronルートに限定する）。
 */
export async function getAllTenantIds(): Promise<string[]> {
  const db = createServiceClient() as any
  const { data, error } = await db.from('contractors').select('tenant_id')
  if (error) throw new Error(error.message)
  const ids: string[] = (data ?? [])
    .map((r: any) => r.tenant_id as string | null)
    .filter((id: string | null): id is string => Boolean(id))
  return [...new Set(ids)]
}
