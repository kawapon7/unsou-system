import { createClient } from '@/utils/supabase/server'
import { createServiceClient } from '@/utils/supabase/service'

// F0でtenant_idをUUID統一したため、dev/bypass時もUUIDを返す（A社=既存の単一テナント）。
// ⚠️ この値は tenants テーブルに実在する id でなければならない。
//    存在しない値にすると全書き込みがFK違反で失敗する。
export const DEV_TENANT_ID = '00000000-0000-0000-0000-0000000000a1'

/**
 * 現在のログインユーザーの tenant_id を返す。
 * - ALLOW_DEV_AUTH_BYPASS=true のときのみ DEV_TENANT_ID(A社UUID) を返す（dev専用フラグ）。
 * - 本番では app_metadata.tenant_id を必須とし、未解決なら例外を投げる
 *   （静かにフォールバックすると全社データ混在の重大事故になるため）。
 */
export async function getCurrentTenantId(): Promise<string> {
  if (process.env.ALLOW_DEV_AUTH_BYPASS === 'true') {
    return DEV_TENANT_ID
  }
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  // app_metadata（service_roleのみ設定可・本人改変不能）を一次ソースにする。
  // ⚠️ user_metadata へのフォールバックは移行期間中の保険。F1のRLS導入前に必ず撤去すること
  //    （残すと利用者が自分で tenant_id を書き換えられ、テナント分離が破れる）。
  const tenantId =
    (user?.app_metadata as { tenant_id?: string } | undefined)?.tenant_id
    ?? user?.user_metadata?.tenant_id
  if (typeof tenantId === 'string' && tenantId) return tenantId
  // ⚠️ フォールバック禁止: 本番ではテナント未解決を明示エラーにして fail-closed。
  throw new Error('テナントが解決できません（app_metadata.tenant_id が未設定です）。')
}

/**
 * 全テナントIDの一覧を返す（service_role・セッション不要）。
 * GitHub Actions等、ログインセッションを持たない定期実行処理専用。
 * ⚠️ 管理画面や通常のServer Actionからは絶対に呼ばないこと
 *    （テナント横断アクセスになるため。呼び出しはcronルートに限定する）。
 */
export async function getAllTenantIds(): Promise<string[]> {
  const db = createServiceClient() as any
  // F0以降 tenants がテナントの正本。
  // ⚠️ 旧実装は contractors の DISTINCT を取っていたため、
  //    委託先が0件のテナントを取りこぼし、そのテナントにアラートが飛ばなかった。
  const { data, error } = await db.from('tenants').select('id')
  if (error) throw new Error(error.message)
  return (data ?? [])
    .map((r: any) => r.id as string | null)
    .filter((id: string | null): id is string => Boolean(id))
}
