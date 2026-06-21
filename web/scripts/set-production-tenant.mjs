/**
 * 本番 tenant_id 設定スクリプト
 *
 * ⚠️ SUPABASE_SERVICE_ROLE_KEY を使用するため取り扱い注意。
 *    RLS を完全バイパスし、本番環境の Auth ユーザーに直接影響を与える。
 *    未検証・未確認のまま実行しないこと。
 *
 * 使い方:
 *   SUPABASE_URL=https://xxx.supabase.co \
 *   SUPABASE_SERVICE_ROLE_KEY=eyJ... \
 *   node web/scripts/set-production-tenant.mjs <email> <tenant_id>
 *
 * 例:
 *   node web/scripts/set-production-tenant.mjs admin@example.com tenant-abc123
 *
 * 確認のみ（変更なし）:
 *   node web/scripts/set-production-tenant.mjs --check admin@example.com
 */

import { createClient } from '@supabase/supabase-js'
import * as readline from 'readline'

// ── 定数 ────────────────────────────────────────────────────────

const green  = s => `\x1b[32m${s}\x1b[0m`
const red    = s => `\x1b[31m${s}\x1b[0m`
const yellow = s => `\x1b[33m${s}\x1b[0m`
const bold   = s => `\x1b[1m${s}\x1b[0m`
const cyan   = s => `\x1b[36m${s}\x1b[0m`

// ── 引数パース ───────────────────────────────────────────────────

const args = process.argv.slice(2)
const isCheckOnly = args[0] === '--check'

/** @type {string} */
const email    = isCheckOnly ? args[1] : args[0]
/** @type {string | undefined} */
const tenantId = isCheckOnly ? undefined : args[1]

// ── バリデーション ────────────────────────────────────────────────

function printUsage() {
  console.error(bold('\n使い方:'))
  console.error('  設定:   node web/scripts/set-production-tenant.mjs <email> <tenant_id>')
  console.error('  確認:   node web/scripts/set-production-tenant.mjs --check <email>\n')
  console.error(bold('必須環境変数:'))
  console.error('  SUPABASE_URL             本番 Supabase プロジェクト URL')
  console.error('  SUPABASE_SERVICE_ROLE_KEY 本番 service_role キー\n')
}

if (!email) {
  console.error(red('エラー: email が指定されていません。'))
  printUsage()
  process.exit(1)
}

if (!isCheckOnly && !tenantId) {
  console.error(red('エラー: tenant_id が指定されていません。'))
  printUsage()
  process.exit(1)
}

const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
if (!emailRegex.test(email)) {
  console.error(red(`エラー: "${email}" は有効なメールアドレスではありません。`))
  process.exit(1)
}

// ── Supabase クライアント初期化 ──────────────────────────────────

const supabaseUrl = process.env.SUPABASE_URL
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY

if (!supabaseUrl) {
  console.error(red('エラー: 環境変数 SUPABASE_URL が設定されていません。'))
  printUsage()
  process.exit(1)
}

if (!serviceRoleKey) {
  console.error(red('エラー: 環境変数 SUPABASE_SERVICE_ROLE_KEY が設定されていません。'))
  printUsage()
  process.exit(1)
}

// ⚠️ service_role クライアント: RLS を完全バイパスする
const supabase = createClient(supabaseUrl, serviceRoleKey, {
  auth: { persistSession: false, autoRefreshToken: false },
})

// ── ユーザー検索 ────────────────────────────────────────────────

/**
 * メールアドレスからユーザーを検索する
 * @param {string} targetEmail
 * @returns {Promise<import('@supabase/supabase-js').User>}
 */
async function findUserByEmail(targetEmail) {
  // ⚠️ listUsers はページネーション対応が必要な場合があるが、
  //    本番ユーザー数が少ない想定のため per_page=1000 で対応
  const { data, error } = await supabase.auth.admin.listUsers({ perPage: 1000 })

  if (error) {
    throw new Error(`ユーザー一覧取得エラー: ${error.message}`)
  }

  const user = data.users.find(u => u.email === targetEmail)
  if (!user) {
    throw new Error(`ユーザーが見つかりません: ${targetEmail}`)
  }
  return user
}

// ── 確認プロンプト ────────────────────────────────────────────────

/**
 * @param {string} message
 * @returns {Promise<boolean>}
 */
function confirm(message) {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout })
  return new Promise(resolve => {
    rl.question(`${yellow('?')} ${message} ${bold('(yes/no): ')}`, answer => {
      rl.close()
      resolve(answer.trim().toLowerCase() === 'yes')
    })
  })
}

// ── メイン処理 ───────────────────────────────────────────────────

async function main() {
  console.log(bold(cyan('\n=== Hibiki 本番 tenant_id 設定スクリプト ===')))
  console.log(yellow('⚠️  このスクリプトは本番 Auth ユーザーのメタデータを直接変更します\n'))

  try {
    // 1. ユーザー検索
    console.log(`対象ユーザーを検索中: ${email}`)
    const user = await findUserByEmail(email)

    const currentTenantId = user.user_metadata?.tenant_id ?? '(未設定)'
    console.log(`\n${bold('ユーザー情報:')}`)
    console.log(`  ID         : ${user.id}`)
    console.log(`  Email      : ${user.email}`)
    console.log(`  現在の tenant_id: ${currentTenantId}`)
    console.log(`  user_metadata   :`, JSON.stringify(user.user_metadata, null, 4))

    // --check モード: 確認のみで終了
    if (isCheckOnly) {
      console.log(green('\n✓ 確認完了（変更は行いませんでした）\n'))
      return
    }

    // 2. 変更内容を表示して確認
    console.log(`\n${bold('変更内容:')}`)
    console.log(`  tenant_id: ${red(String(currentTenantId))} → ${green(tenantId)}`)

    const ok = await confirm('この変更を実行しますか？')
    if (!ok) {
      console.log(yellow('\n中止しました。\n'))
      process.exit(0)
    }

    // 3. user_metadata を更新
    // ⚠️ updateUserById は user_metadata をマージするため、既存のキーは保持される
    const { data: updated, error: updateError } = await supabase.auth.admin.updateUserById(
      user.id,
      { user_metadata: { tenant_id: tenantId } },
    )

    if (updateError) {
      throw new Error(`user_metadata 更新エラー: ${updateError.message}`)
    }

    // 4. 結果を出力
    console.log(green('\n✓ 更新成功'))
    console.log(`\n${bold('更新後の user_metadata:')}`)
    console.log(JSON.stringify(updated.user.user_metadata, null, 4))
    console.log()

  } catch (err) {
    console.error(red(`\nエラー: ${err.message}\n`))
    process.exit(1)
  }
}

main()
