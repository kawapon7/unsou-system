import { createClient } from '@/utils/supabase/server'

export const DEV_TENANT_ID = 'local-dev'

/**
 * 現在のログインユーザーの tenant_id を返す。
 * 優先順: user_metadata.tenant_id → 'local-dev' フォールバック
 * 開発環境(NODE_ENV=development)は常に 'local-dev' を返す。
 */
export async function getCurrentTenantId(): Promise<string> {
  if (process.env.NODE_ENV === 'development') {
    return DEV_TENANT_ID
  }
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  const tenantId = user?.user_metadata?.tenant_id
  return typeof tenantId === 'string' && tenantId ? tenantId : DEV_TENANT_ID
}
