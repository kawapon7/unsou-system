/**
 * テナント（導入先）新規作成スクリプト — 2026-08-23 RLS P0
 *
 * tenants 行 + 初代 master の Auth ユーザー + public.users 行を一括で作る。
 * Auth ユーザーには app_metadata.tenant_id を焼き込む（本人は書き換え不能）。
 *
 * ⚠️ SUPABASE_SERVICE_ROLE_KEY を使う。RLS を完全バイパスし本番に実データを作る。
 * ⚠️ 事前に migration 20260823180000_users_tenant_id.sql が適用済みであること（users.tenant_id 列）。
 *
 * 使い方:
 *   NEXT_PUBLIC_SUPABASE_URL=https://xxx.supabase.co \
 *   SUPABASE_SERVICE_ROLE_KEY=eyJ... \
 *   node web/scripts/create-tenant.mjs "<テナント名>" <master_email> <password>
 *
 * 例:
 *   node web/scripts/create-tenant.mjs "おおば運送" admin@ooba.example.jp 'Str0ngPass!'
 *
 * 出力された tenant_id を控えること。作成後、その master でログインし
 * 設定 > 自社情報 を登録するまで請求書等は fail-closed でエラーになる（仕様）。
 */
import { createClient } from '@supabase/supabase-js'

const url = process.env.NEXT_PUBLIC_SUPABASE_URL
const key = process.env.SUPABASE_SERVICE_ROLE_KEY
const [name, email, password] = process.argv.slice(2)

if (!url || !key) throw new Error('NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY が未設定です')
if (!name || !email || !password) {
  throw new Error('使い方: node web/scripts/create-tenant.mjs "<テナント名>" <master_email> <password>')
}
if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new Error(`"${email}" は有効なメールアドレスではありません`)
if (password.length < 8) throw new Error('パスワードは 8 文字以上にしてください')

const admin = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } })

// 同名テナントの二重作成を防ぐ
const { data: dup } = await admin.from('tenants').select('id').eq('name', name).maybeSingle()
if (dup) throw new Error(`同名のテナントが既に存在します: ${dup.id}`)

const { data: tenant, error: tErr } = await admin.from('tenants').insert({ name }).select('id').single()
if (tErr) throw tErr
console.log('tenants 作成:', tenant.id, name)

const { data: authData, error: aErr } = await admin.auth.admin.createUser({
  email,
  password,
  email_confirm: true,
  app_metadata: { tenant_id: tenant.id },
})
if (aErr) {
  await admin.from('tenants').delete().eq('id', tenant.id)
  throw aErr
}
console.log('auth.users 作成:', authData.user.id)

const { error: uErr } = await admin.from('users').insert({
  id: authData.user.id,
  email,
  role: 'master',
  tenant_id: tenant.id,
})
if (uErr) {
  await admin.auth.admin.deleteUser(authData.user.id)
  await admin.from('tenants').delete().eq('id', tenant.id)
  throw uErr
}
console.log(`完了: tenant_id=${tenant.id} / master=${email}`)
console.log('次: この master でログインし、設定 > 自社情報 を登録してください。')
