/**
 * ドライバー(子分)テストアカウント作成スクリプト
 *
 * ⚠️ SUPABASE_SERVICE_ROLE_KEY を使用するため取り扱い注意。本番Authユーザー + usersテーブル行を作成する。
 *
 * 使い方:
 *   NEXT_PUBLIC_SUPABASE_URL=... SUPABASE_SERVICE_ROLE_KEY=... \
 *   node web/scripts/create-driver-test-user.mjs <email> <password> <contractorId>
 */

import { createClient } from '@supabase/supabase-js'

const url = process.env.NEXT_PUBLIC_SUPABASE_URL
const key = process.env.SUPABASE_SERVICE_ROLE_KEY
const email = process.argv[2]
const password = process.argv[3]
const contractorId = process.argv[4]

if (!url || !key) throw new Error('NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY が未設定です')
if (!email || !password || !contractorId) throw new Error('使い方: node create-driver-test-user.mjs <email> <password> <contractorId>')

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
  role: 'sub',
  contractor_id: contractorId,
})
if (insErr) throw insErr
console.log('users テーブルに role=sub, contractor_id 紐付けで登録完了')

const { error: updErr } = await supabase.from('contractors').update({ email }).eq('id', contractorId)
if (updErr) throw updErr
console.log('contractors.email をアカウントに合わせて更新完了')
