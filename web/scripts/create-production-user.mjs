/**
 * 本番 Auth ユーザー作成スクリプト
 *
 * ⚠️ SUPABASE_SERVICE_ROLE_KEY を使用するため取り扱い注意。
 *    RLS を完全バイパスし、本番環境に実データ（Authユーザー + usersテーブル行）を作成する。
 *
 * ⚠️ tenant_id は現状 user_metadata に文字列 'local-dev' で設定する。
 *    テナント分離F0（app_metadata + UUID化）は未実装のため、
 *    既存データ（tenant_id='local-dev'）と一致させないと画面にデータが出ない。
 *    F0実装後はこのスクリプトの tenant_id 設定箇所を要更新。
 *
 * 使い方:
 *   NEXT_PUBLIC_SUPABASE_URL=https://xxx.supabase.co \
 *   SUPABASE_SERVICE_ROLE_KEY=eyJ... \
 *   node web/scripts/create-production-user.mjs <email> <password> [role]
 *
 *   role省略時は 'master'（親分/admin）。ドライバーアカウントの場合は 'contractor' を指定。
 */

import { createClient } from '@supabase/supabase-js'

const url = process.env.NEXT_PUBLIC_SUPABASE_URL
const key = process.env.SUPABASE_SERVICE_ROLE_KEY
const email = process.argv[2]
const password = process.argv[3]
const role = process.argv[4] ?? 'master'

if (!url || !key) throw new Error('NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY が未設定です')
if (!email || !password) throw new Error('使い方: node create-production-user.mjs <email> <password> [role]')

const supabase = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } })

const { data, error } = await supabase.auth.admin.createUser({
  email,
  password,
  email_confirm: true,
  user_metadata: { tenant_id: 'local-dev' },
})
if (error) throw error
console.log('auth.users 作成成功: id =', data.user.id)

const { error: insErr } = await supabase.from('users').insert({
  id: data.user.id,
  email,
  role,
})
if (insErr) throw insErr
console.log(`users テーブルに role=${role} で登録完了`)
