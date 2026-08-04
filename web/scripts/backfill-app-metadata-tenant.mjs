// web/scripts/backfill-app-metadata-tenant.mjs
// 既存ユーザー全員の app_metadata.tenant_id を A社UUIDに設定する一度きりのスクリプト。
//
// 実行: node web/scripts/backfill-app-metadata-tenant.mjs
// 必要env: NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY
//
// ⚠️ 実行後、対象ユーザーは再ログインが必要（JWTに新しい app_metadata を載せるため）。
//    再ログインするまでは古いJWTのままなので getCurrentTenantId が
//    user_metadata フォールバック（'local-dev'）を返し、uuid化したDBと不整合になる。
import { createClient } from '@supabase/supabase-js'

const TENANT_A_UUID = '00000000-0000-0000-0000-0000000000a1'

const url = process.env.NEXT_PUBLIC_SUPABASE_URL
const key = process.env.SUPABASE_SERVICE_ROLE_KEY
if (!url || !key) {
  throw new Error('env未設定: NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY')
}

const admin = createClient(url, key, { auth: { persistSession: false } })

let page = 1
let updated = 0
let skipped = 0

for (;;) {
  const { data, error } = await admin.auth.admin.listUsers({ page, perPage: 200 })
  if (error) throw error

  const users = data.users
  if (users.length === 0) break

  for (const u of users) {
    if (u.app_metadata?.tenant_id === TENANT_A_UUID) {
      skipped++
      continue
    }
    // 既存の app_metadata（provider 等）を保持したまま tenant_id だけ足す。
    // ⚠️ スプレッドを外すと provider/providers が消えてログインが壊れる。
    const { error: upErr } = await admin.auth.admin.updateUserById(u.id, {
      app_metadata: { ...u.app_metadata, tenant_id: TENANT_A_UUID },
    })
    if (upErr) {
      console.error('更新失敗', u.email, upErr.message)
      continue
    }
    updated++
    console.log('更新', u.email)
  }
  page++
}

console.log(`完了: 更新 ${updated} 件 / 設定済みスキップ ${skipped} 件`)
