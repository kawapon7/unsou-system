import { createClient } from '@/utils/supabase/server'
import { createServiceClient } from '@/utils/supabase/service'

/**
 * Server Action 用 認可ガード。
 * すべての Server Action は service_role（RLSバイパス）で動くため、
 * ここでアプリ層の権限チェックを必ず通すこと。
 */

// ⚠️ HIBIKI_OWNER_EMAILS 未設定時は特権メールなし（fail-closed）。.env.local に設定すること。
const TEMP_OWNER_EMAILS = (process.env.HIBIKI_OWNER_EMAILS ?? '')
  .split(',').map(e => e.trim()).filter(Boolean)

export type AuthContext = {
  userId:       string
  email:        string | null
  role:         string
  contractorId: string | null
  isOwner:      boolean
}

export type AuthResult =
  | { ok: true;  ctx: AuthContext }
  | { ok: false; error: string }

/**
 * ⚠️ 認証バイパス（dev専用）: ALLOW_DEV_AUTH_BYPASS=true のときのみ合成 owner を返す。
 * 本番ではこの環境変数を絶対に設定しないこと。proxy.ts のバイパスと挙動を揃えている。
 */
/** dev バイパス時の合成ユーザーID（UUIDではない。UUID列に書く際は呼び出し側で写像すること） */
export const DEV_BYPASS_USER_ID = 'dev-bypass'

function devBypassContext(): AuthContext {
  return {
    userId:       DEV_BYPASS_USER_ID,
    email:        'dev@local',
    role:         'master',
    contractorId: null,
    isOwner:      true,
  }
}

/** contractors を email で引くだけの最小インターフェース（テストで差し替えるため） */
export type ContractorLookupClient = {
  from: (table: 'contractors') => {
    select: (cols: 'id') => {
      eq: (col: 'email', value: string) => {
        limit: (n: number) => PromiseLike<{ data: { id: string }[] | null; error: unknown }>
      }
    }
  }
}

/**
 * ログインユーザーに対応する委託先IDを解決する。
 * 一次ソースは `users.contractor_id`。ただし**この列を書く経路が存在しない**時期があり、
 * 実データはほぼNULLのため、未設定なら `contractors.email` 一致で解決する
 * （driver 側 `fetchMyContractor` が元から採っていた解決方法に合わせた）。
 *
 * ⚠️ email が複数の委託先にヒットした場合は fail-closed で null を返す。
 *    どれが本人か決められない状態で1件目を採ると、他人の支払通知書を開かせる事故になる
 *    （テナントを跨いだ同一メールも同様に弾かれる）。
 * ⚠️ email 未設定（null/空）でも解決しない。空文字で全件マッチさせないこと。
 */
export async function resolveContractorId(
  service:           ContractorLookupClient,
  usersContractorId: string | null | undefined,
  email:             string | null,
): Promise<string | null> {
  if (usersContractorId) return usersContractorId
  if (!email) return null

  const { data, error } = await service.from('contractors').select('id').eq('email', email).limit(2)
  if (error || !data || data.length !== 1) return null
  return data[0].id ?? null
}

/** ログインユーザーの認可コンテキストを取得（role は users テーブルから service_role で確定） */
export async function getAuthContext(): Promise<AuthResult> {
  const supabase = await createClient()
  const { data: { user }, error } = await supabase.auth.getUser()

  if (error || !user) {
    if (process.env.ALLOW_DEV_AUTH_BYPASS === 'true') {
      return { ok: true, ctx: devBypassContext() }
    }
    return { ok: false, error: '未ログインです' }
  }

  const service = createServiceClient()
  const { data: row } = await (service as any)
    .from('users')
    .select('role, contractor_id')
    .eq('id', user.id)
    .maybeSingle()

  const role: string = TEMP_OWNER_EMAILS.includes(user.email ?? '')
    ? 'master'
    : (row?.role ?? user.user_metadata?.role ?? 'contractor')

  const isOwner = role === 'master' || role === 'owner'

  // owner は委託先IDを持たない前提のため、余計なクエリを打たない。
  const contractorId = isOwner
    ? (row?.contractor_id ?? null)
    : await resolveContractorId(service as unknown as ContractorLookupClient, row?.contractor_id, user.email ?? null)

  return {
    ok: true,
    ctx: {
      userId:       user.id,
      email:        user.email ?? null,
      role,
      contractorId,
      isOwner,
    },
  }
}

/** 管理者（親分）専用アクション用ガード。owner 以外は拒否。 */
export async function requireOwner(): Promise<AuthResult> {
  const res = await getAuthContext()
  if (!res.ok) return res
  if (!res.ctx.isOwner) return { ok: false, error: '権限がありません（管理者専用の操作です）。' }
  return res
}

/** ログイン必須（ロール不問）アクション用ガード。 */
export async function requireAuth(): Promise<AuthResult> {
  return getAuthContext()
}
