import { createClient, type SupabaseClient } from '@supabase/supabase-js'

/** Cloud DB スキーマとレガシー Actions の移行期間中、厳格型より実運用を優先 */
export function createServiceClient(): SupabaseClient {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!url || !key) {
    throw new Error('NEXT_PUBLIC_SUPABASE_URL または SUPABASE_SERVICE_ROLE_KEY が未設定です')
  }
  return createClient(url, key, {
    auth: { persistSession: false },
  })
}
