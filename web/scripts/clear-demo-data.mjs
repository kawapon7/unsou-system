/**
 * clear-demo-data.mjs
 * seed-demo-full.mjs が投入したデモデータだけを削除する。
 *
 * 設計書: docs/superpowers/specs/2026-07-26-demo-data-integration-test-design.md
 *
 * 既定は DRY RUN（件数を表示するだけで何も削除しない）。
 *   node web/scripts/clear-demo-data.mjs            → 件数表示のみ
 *   node web/scripts/clear-demo-data.mjs --execute   → 実際に削除
 *
 * 削除対象は「デモ印が付いた行」だけ。印の無い行には一切触れない。
 *   会社名・案件名  : 【デモ】プレフィックス
 *   メールアドレス  : @demo.hibiki.local サフィックス
 *   案件コード      : DEMO-P0xx
 *   work_records    : デモ案件に紐づく行
 *   expense_records : remarks が 【デモ】 で始まる行
 *   payment_notices : デモ委託先 × デモ対象月 の行
 *
 * ⚠️ 絶対に触れないもの
 *   - approval_history / notification_logs（不変ログ。UPDATE/DELETE 全ロール禁止）
 *   - kawapon7+driver@gmail.com に紐づく委託先（ボスのドライバー実アカウント）
 *   - auth.users / public.users（アカウントは削除しない）
 */

import { readFileSync } from 'fs'
import { resolve, dirname } from 'path'
import { fileURLToPath } from 'url'
import { createClient } from '@supabase/supabase-js'

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
  console.error('❌ NEXT_PUBLIC_SUPABASE_URL または SUPABASE_SERVICE_ROLE_KEY が未設定')
  process.exit(1)
}

const db = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false } })

const EXECUTE = process.argv.includes('--execute')

const DEMO_PREFIX       = '【デモ】'
const DEMO_EMAIL_SUFFIX = '@demo.hibiki.local'
const DEMO_CODE_PREFIX  = 'DEMO-P'
// ⚠️ この定数は絶対に消さないこと。ボスのドライバー実ログインアカウントとの紐づけキー。
const PROTECTED_EMAIL   = 'kawapon7+driver@gmail.com'

const pad = n => String(n).padStart(2, '0')
const NOW        = new Date()
const monthKey   = d => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-01`
const DEMO_MONTHS = [
  monthKey(new Date(NOW.getFullYear(), NOW.getMonth() - 1, 1)),
  monthKey(new Date(NOW.getFullYear(), NOW.getMonth(), 1)),
]

function abort(label, error) {
  console.error(`❌ ${label}:`, error?.message ?? error)
  process.exit(1)
}

/** 対象行を数える。実行モードなら削除もする。 */
async function step(label, table, applyFilter) {
  const { count, error: ce } = await applyFilter(
    db.from(table).select('*', { count: 'exact', head: true }))
  if (ce) abort(`COUNT ${table}`, ce)

  if (!count) {
    console.log(`  ・${label.padEnd(22, '　')} : 0 件（対象なし）`)
    return 0
  }
  if (!EXECUTE) {
    console.log(`  ・${label.padEnd(22, '　')} : ${count} 件 ← 削除対象`)
    return count
  }
  const { error: de } = await applyFilter(db.from(table).delete())
  if (de) abort(`DELETE ${table}`, de)
  console.log(`  ・${label.padEnd(22, '　')} : ${count} 件 削除`)
  return count
}

async function main() {
  console.log(EXECUTE
    ? '🗑️  デモデータ削除（--execute: 実際に削除します）'
    : '🔍 デモデータ削除 DRY RUN（何も削除しません）')
  console.log(`   DB       : ${SUPABASE_URL}`)
  console.log(`   対象月   : ${DEMO_MONTHS.join(' / ')}`)
  console.log(`   保護対象 : ${PROTECTED_EMAIL}（この委託先は削除しません）\n`)

  // ── デモ案件 / デモ委託先の ID を先に確定
  const { data: projects } = await db.from('projects').select('id')
    .like('project_code', `${DEMO_CODE_PREFIX}%`)
  const projectIds = (projects ?? []).map(p => p.id)

  const { data: contractors } = await db.from('contractors').select('id, email')
    .like('email', `%${DEMO_EMAIL_SUFFIX}`)
  const contractorIds = (contractors ?? [])
    .filter(c => c.email !== PROTECTED_EMAIL)
    .map(c => c.id)

  // ⚠️ 保護対象ドライバーにもデモの稼働データを割り当てているため、
  //    その支払通知書は削除対象に含める（委託先レコード自体は残す）。
  const { data: protectedRow } = await db.from('contractors').select('id')
    .eq('email', PROTECTED_EMAIL).maybeSingle()
  const noticeContractorIds = [
    ...contractorIds,
    ...(protectedRow ? [protectedRow.id] : []),
  ]

  console.log(`デモ案件 ${projectIds.length} 件 / デモ委託先 ${contractorIds.length} 件を起点に削除します。\n`)

  // ── 支払通知書は承認履歴が付いていると FK(ON DELETE RESTRICT) で削除できない。
  //    履歴が付いた行は対象から外し、警告を出す（不変ログは絶対に消さない）。
  const { data: notices } = await db.from('payment_notices').select('id')
    .in('contractor_id', noticeContractorIds.length ? noticeContractorIds : ['00000000-0000-0000-0000-000000000000'])
    .in('notice_month', DEMO_MONTHS)
  const noticeIds = (notices ?? []).map(n => n.id)

  let lockedNoticeIds = []
  if (noticeIds.length) {
    const { data: hist } = await db.from('approval_history')
      .select('payment_notice_id').in('payment_notice_id', noticeIds)
    lockedNoticeIds = [...new Set((hist ?? []).map(h => h.payment_notice_id))]
  }
  const deletableNoticeIds = noticeIds.filter(id => !lockedNoticeIds.includes(id))

  if (lockedNoticeIds.length) {
    console.log(`⚠️  承認履歴が付いた支払通知書 ${lockedNoticeIds.length} 件は削除できません（不変ログ保護）。`)
    console.log(`   これらはデモ印のまま本番DBに残ります。\n`)
  }

  // ── 削除は外部キーの依存順に実行する
  const noneUuid = ['00000000-0000-0000-0000-000000000000']
  const inProjects = q => q.in('project_id', projectIds.length ? projectIds : noneUuid)

  console.log('削除対象:')
  let total = 0
  total += await step('稼働実績 work_records',     'work_records',               inProjects)
  total += await step('配車予定 schedules',        'schedules',                  inProjects)
  total += await step('立替金 expense_records',    'expense_records',            q => q.like('remarks', `${DEMO_PREFIX}%`))
  total += await step('支払通知書',                'payment_notices',            q => q.in('id', deletableNoticeIds.length ? deletableNoticeIds : noneUuid))
  total += await step('ドライバー表示案件',        'driver_project_assignments', inProjects)
  total += await step('単価ルール price_rules',    'price_rules',                inProjects)
  total += await step('案件別支払先 payees',       'project_payees',             inProjects)
  total += await step('案件 projects',             'projects',                   q => q.like('project_code', `${DEMO_CODE_PREFIX}%`))
  total += await step('委託先 contractors',        'contractors',                q => q.like('email', `%${DEMO_EMAIL_SUFFIX}`).neq('email', PROTECTED_EMAIL))
  total += await step('荷主 clients',              'clients',                    q => q.like('company_name', `${DEMO_PREFIX}%`))

  console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━')
  if (EXECUTE) {
    console.log(`✅ 削除完了: 合計 ${total} 件`)
    const { data: guard } = await db.from('contractors')
      .select('name').eq('email', PROTECTED_EMAIL).maybeSingle()
    console.log(guard
      ? `🔒 保護対象は無事です: ${guard.name}`
      : `⚠️ 保護対象の委託先が見つかりません。手動で確認してください。`)
  } else {
    console.log(`🔍 DRY RUN: 合計 ${total} 件が削除対象です（まだ何も削除していません）`)
    console.log('   実際に削除する: node web/scripts/clear-demo-data.mjs --execute')
  }
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━')
}

main().catch(e => { console.error('❌ 予期しないエラー:', e); process.exit(1) })
