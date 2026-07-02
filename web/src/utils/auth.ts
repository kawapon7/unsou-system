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
function devBypassContext(): AuthContext {
  return {
    userId:       'dev-bypass',
    email:        'dev@local',
    role:         'master',
    contractorId: null,
    isOwner:      true,
  }
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

  return {
    ok: true,
    ctx: {
      userId:       user.id,
      email:        user.email ?? null,
      role,
      contractorId: row?.contractor_id ?? null,
      isOwner:      role === 'master' || role === 'owner',
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
