/**
 * reset-user-password.mjs
 * 既存ユーザーのパスワードを Supabase Admin API（service_role）で再設定する。
 *
 * 2026-07-02 に admin@hibiki.com のパスワード不明を解消したのと同じ手順を、
 * 毎回書き捨てにせず1本のスクリプトにしたもの（HANDOVER §5-4 2026-07-02 その4 参照）。
 *
 * 実行:
 *   node web/scripts/reset-user-password.mjs <email>
 *
 * パスワードは引数では渡さない。実行後に**非表示のプロンプト**で入力する。
 * ⚠️ 引数や環境変数で渡すとシェル履歴・プロセス一覧（ps）に残るため、この形にしている。
 *
 * ⚠️ このスクリプトは service_role キーを使う（RLSバイパス・管理者権限）。
 *    ローカルの web/.env.local からのみ読み、値は一切出力しない。
 * ⚠️ 対象は**本番Supabase**（.env.local が本番を指しているため）。実行前に表示される
 *    確認プロンプトで、対象URL・メール・ロールを必ず目視すること。
 */

import { readFileSync } from 'fs'
import { resolve, dirname } from 'path'
import { fileURLToPath } from 'url'
import { createInterface } from 'readline'
import { stdin, stdout } from 'process'
import { createClient } from '@supabase/supabase-js'

// ── 環境変数読み込み ──────────────────────────────────────────────────────────

const __dirname = dirname(fileURLToPath(import.meta.url))
const env = Object.fromEntries(
  readFileSync(resolve(__dirname, '../.env.local'), 'utf8')
    .split('\n')
    .filter(l => l && !l.startsWith('#') && l.includes('='))
    .map(l => { const i = l.indexOf('='); return [l.slice(0, i), l.slice(i + 1)] }),
)

const SUPABASE_URL = env.NEXT_PUBLIC_SUPABASE_URL
const SERVICE_KEY  = env.SUPABASE_SERVICE_ROLE_KEY

if (!SUPABASE_URL || !SERVICE_KEY) {
  console.error('❌ NEXT_PUBLIC_SUPABASE_URL または SUPABASE_SERVICE_ROLE_KEY が未設定（web/.env.local）')
  process.exit(1)
}

const email = process.argv[2]
if (!email) {
  console.error('使い方: node web/scripts/reset-user-password.mjs <email>')
  process.exit(1)
}

const db = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false } })

// ── 入力ヘルパ ────────────────────────────────────────────────────────────────

function ask(question) {
  const rl = createInterface({ input: stdin, output: stdout })
  return new Promise(res => rl.question(question, a => { rl.close(); res(a) }))
}

/**
 * パスワードを画面に出さずに読む。
 * ⚠️ raw mode が使えない環境（パイプ経由・一部CI）では stdin.isTTY が false になる。
 *    その場合は握りつぶさずエラーにする（黙って平文エコーにすると肩越しに見られる）。
 */
function askHidden(question) {
  if (!stdin.isTTY) {
    console.error('❌ 対話端末ではないためパスワードを安全に読めません。ターミナルから直接実行してください。')
    process.exit(1)
  }
  return new Promise(res => {
    stdout.write(question)
    stdin.setRawMode(true)
    stdin.resume()
    stdin.setEncoding('utf8')
    let buf = ''
    const onData = ch => {
      // Ctrl-C / Enter / Backspace の最低限だけ扱う
      if (ch === '\u0003') { stdout.write('\n'); process.exit(130) }
      if (ch === '\r' || ch === '\n') {
        stdin.setRawMode(false); stdin.pause(); stdin.removeListener('data', onData)
        stdout.write('\n'); return res(buf)
      }
      if (ch === '\u007f' || ch === '\b') { buf = buf.slice(0, -1); return }
      buf += ch
    }
    stdin.on('data', onData)
  })
}

// ── 本体 ──────────────────────────────────────────────────────────────────────

// 1. 対象ユーザーを特定する。listUsers はページングされるため、
//    ⚠️ 1ページ目だけ見て「居ない」と判断しないこと（ユーザーが増えると取りこぼす）。
async function findUserByEmail(target) {
  const wanted = target.toLowerCase()
  for (let page = 1; page <= 20; page++) {
    const { data, error } = await db.auth.admin.listUsers({ page, perPage: 200 })
    if (error) throw new Error(`ユーザー一覧の取得に失敗: ${error.message}`)
    const hit = (data?.users ?? []).find(u => (u.email ?? '').toLowerCase() === wanted)
    if (hit) return hit
    if (!data?.users?.length || data.users.length < 200) return null
  }
  return null
}

const user = await findUserByEmail(email)
if (!user) {
  console.error(`❌ 該当ユーザーが見つかりません: ${email}`)
  process.exit(1)
}

// 2. public.users のロールも見せる（driver のつもりで master を触る事故を防ぐ）
const { data: row } = await db.from('users').select('role, contractor_id').eq('id', user.id).maybeSingle()

console.log('')
console.log('── 対象の確認 ─────────────────────────────')
console.log(`  Supabase : ${SUPABASE_URL}`)
console.log(`  email    : ${user.email}`)
console.log(`  user id  : ${user.id}`)
console.log(`  role     : ${row?.role ?? '(public.users に行なし)'}`)
console.log(`  tenant   : ${user.app_metadata?.tenant_id ?? '(app_metadata 未設定)'}`)
console.log(`  最終ログイン: ${user.last_sign_in_at ?? '(なし)'}`)
console.log('───────────────────────────────────────────')
console.log('')

const ok = await ask('このユーザーのパスワードを再設定します。よければ yes と入力: ')
if (ok.trim() !== 'yes') {
  console.log('中止しました。')
  process.exit(0)
}

const pw1 = await askHidden('新しいパスワード（表示されません）: ')
const pw2 = await askHidden('もう一度入力            : ')

if (pw1 !== pw2) {
  console.error('❌ 2回の入力が一致しません。中止しました。')
  process.exit(1)
}
// Supabase Auth の既定の下限は6文字。短いと updateUserById が 422 を返す。
if (pw1.length < 8) {
  console.error('❌ 8文字以上にしてください。中止しました。')
  process.exit(1)
}

const { error } = await db.auth.admin.updateUserById(user.id, { password: pw1 })
if (error) {
  console.error(`❌ 更新に失敗: ${error.message}`)
  process.exit(1)
}

console.log('')
console.log(`✅ ${user.email} のパスワードを更新しました。`)
console.log('   ログイン: https://unsou-system.hibiki-app.workers.dev/login')
if (row?.role && row.role !== 'master' && row.role !== 'owner') {
  console.log('   ログイン後は /driver/schedule に自動遷移します（支払通知書PDFの確認は /driver/billing）。')
}
// ⚠️ 入力されたパスワードはどこにも書き出さない（ログ・ファイル・環境変数のいずれにも残さない）。
