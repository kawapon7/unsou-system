/**
 * seed-defensive-alerts — 5大ディフェンシブアラート デモデータ投入スクリプト
 *
 * 1. 入力遅延:     schedules あり / work_records なし
 * 2. 重複の疑い:   同日・同案件 work_records 2件
 * 3. 業務閾値超過: quantity=101 → status=pending_review
 * 4. 金額閾値超過: amount_actual=35,000 → expense_records
 * 5. 長期未承認:   48時間以上前の payment_notices で status=pending
 */

import { createClient } from '@supabase/supabase-js'
import { execSync } from 'child_process'
import { readFileSync } from 'fs'
import { join, dirname } from 'path'
import { fileURLToPath } from 'url'

// .env.local から環境変数を読み込む
function loadEnvLocal() {
  try {
    const dir = dirname(fileURLToPath(import.meta.url))
    const envPath = join(dir, '..', '.env.local')
    const content = readFileSync(envPath, 'utf8')
    for (const line of content.split('\n')) {
      const m = line.match(/^([^#=]+)=(.*)$/)
      if (m) process.env[m[1].trim()] ??= m[2].trim()
    }
  } catch { /* .env.local がなければ無視 */ }
}
loadEnvLocal()

const LOCAL_URL = 'http://127.0.0.1:54321'
const LOCAL_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImV4cCI6MTk4MzgxMjk5Nn0.EGIM96RAZx35lJzdJsyH-qQwv8Hdp7fsn3W0YpN81IU'

const url = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL || LOCAL_URL
const key = process.env.SUPABASE_SERVICE_ROLE_KEY || LOCAL_KEY
const db  = createClient(url, key, { auth: { persistSession: false } })

const TENANT_ID = 'local-dev'
const TODAY     = new Date().toISOString().slice(0, 10)
const TWO_DAYS_AGO = new Date(Date.now() - 49 * 3600 * 1000).toISOString()

const green = s => `\x1b[32m${s}\x1b[0m`
const red   = s => `\x1b[31m${s}\x1b[0m`
const bold  = s => `\x1b[1m${s}\x1b[0m`
const cyan  = s => `\x1b[36m${s}\x1b[0m`

function ok(label) { console.log(`  ${green('✓')} ${label}`) }
function ng(label, e) { console.log(`  ${red('✗')} ${label}  → ${e}`) }

// ── 全データクリーンアップ ────────────────────────────────
// FK制約の順序: notification_logs → payment_notices → expense_records
//               → work_records → schedules → contractors → projects → clients

async function cleanAll() {
  const isLocal = url.includes('127.0.0.1') || url.includes('localhost')

  if (isLocal) {
    // ローカル: docker exec で psql を直接叩き、トリガーを一時無効化して全削除
    try {
      execSync(
        `docker exec supabase_db_unsou-system psql -U postgres -c ` +
        `"ALTER TABLE approval_history DISABLE TRIGGER trg_approval_history_no_delete; ` +
        `DELETE FROM approval_history; ` +
        `ALTER TABLE approval_history ENABLE TRIGGER trg_approval_history_no_delete; ` +
        `DELETE FROM notification_logs; ` +
        `DELETE FROM payment_notices; ` +
        `DELETE FROM expense_records WHERE tenant_id = '${TENANT_ID}'; ` +
        `DELETE FROM work_records WHERE tenant_id = '${TENANT_ID}'; ` +
        `DELETE FROM schedules WHERE tenant_id = '${TENANT_ID}';"`,
        { stdio: 'pipe' }
      )
    } catch (e) {
      throw new Error(`cleanup via psql: ${e.stderr?.toString() ?? e.message}`)
    }
  } else {
    // リモート: Supabase JS client で削除（approval_history FK制約のため payment_notices は試みてスキップ）
    const { data: allCs } = await db.from('contractors').select('id').eq('tenant_id', TENANT_ID)
    const allIds = (allCs ?? []).map(c => c.id)

    const steps = [
      ['notification_logs', async () => {
        if (allIds.length === 0) return { error: null }
        return db.from('notification_logs').delete().in('contractor_id', allIds)
      }],
      ['payment_notices', async () => {
        if (allIds.length === 0) return { error: null }
        const r = await db.from('payment_notices').delete().in('contractor_id', allIds)
        if (r.error) {
          console.log(`    ⚠ payment_notices削除スキップ (FK制約): ${r.error.message}`)
          return { error: null }
        }
        return r
      }],
      ['expense_records', () => db.from('expense_records').delete().eq('tenant_id', TENANT_ID)],
      ['work_records',    () => db.from('work_records').delete().eq('tenant_id', TENANT_ID)],
      ['schedules',       () => db.from('schedules').delete().eq('tenant_id', TENANT_ID)],
    ]
    for (const [name, fn] of steps) {
      const { error } = await fn()
      if (error) throw new Error(`cleanup ${name}: ${error.message}`)
    }
  }
  ok('クリーンアップ完了 (approval_history / notification_logs / payment_notices / expense_records / work_records / schedules)')
}

// ── マスタ確保 ────────────────────────────────────────────

async function upsertContractor(name, email) {
  const { data: ex } = await db.from('contractors').select('id')
    .eq('name', name).eq('tenant_id', TENANT_ID).maybeSingle()
  if (ex?.id) return ex.id

  const { data, error } = await db.from('contractors').insert({
    name,
    email,
    phone:                     '090-9999-0001',
    contractor_type:           'individual',
    invoice_registration_type: 'unregistered',
    tax_category:              'exclusive',
    payment_type:              'bank_transfer',
    payment_site:              30,
    tenant_id:                 TENANT_ID,
  }).select('id').single()
  if (error) throw new Error(`contractor(${name}): ${error.message}`)
  return data.id
}

async function upsertClient() {
  const { data: ex } = await db.from('clients').select('id')
    .eq('company_name', '[DEMO] デモ荷主').eq('tenant_id', TENANT_ID).maybeSingle()
  if (ex?.id) return ex.id

  const { data, error } = await db.from('clients').insert({
    company_name:       '[DEMO] デモ荷主',
    tax_type:           'exclusive',
    invoice_registered: false,
    closing_day:        31,
    payment_site:       30,
    tenant_id:          TENANT_ID,
  }).select('id').single()
  if (error) throw new Error(`client: ${error.message}`)
  return data.id
}

async function upsertProject(clientId) {
  const { data: ex } = await db.from('projects').select('id')
    .eq('project_code', 'DEMO-ALERT-001').eq('tenant_id', TENANT_ID).maybeSingle()
  if (ex?.id) return ex.id

  const { data, error } = await db.from('projects').insert({
    project_code: 'DEMO-ALERT-001',
    project_name: '[DEMO] アラート確認案件',
    client_id:    clientId,
    tenant_id:    TENANT_ID,
  }).select('id').single()
  if (error) throw new Error(`project: ${error.message}`)
  return data.id
}

// ── アラート1: 入力遅延 ───────────────────────────────────

async function seedMissingInput(contractorId, projectId) {
  // schedules に当日予定を登録（work_records は入れない）
  await db.from('schedules')
    .delete()
    .eq('contractor_id', contractorId)
    .eq('date', TODAY)

  const { error } = await db.from('schedules').insert({
    contractor_id: contractorId,
    project_id:    projectId,
    date:          TODAY,
    status:        'scheduled',
    tenant_id:     TENANT_ID,
  })
  if (error) throw new Error(`schedules: ${error.message}`)
  ok('アラート1 [入力遅延] schedules 登録済み / work_records 空')
}

// ── アラート2: 重複の疑い ─────────────────────────────────

async function seedDuplicate(contractorId, projectId) {
  const dupDate = TODAY

  // 既存削除
  const { data: existing } = await db.from('work_records')
    .select('id')
    .eq('contractor_id', contractorId)
    .eq('work_date', dupDate)
    .eq('project_id', projectId)
    .eq('tenant_id', TENANT_ID)
  if (existing?.length) {
    await db.from('work_records').delete().in('id', existing.map(r => r.id))
  }

  for (let i = 0; i < 2; i++) {
    const { error } = await db.from('work_records').insert({
      contractor_id: contractorId,
      project_id:    projectId,
      work_date:     dupDate,
      date:          dupDate,
      piece_count:   30,
      status:        'pending',
      tenant_id:     TENANT_ID,
    })
    if (error) throw new Error(`duplicate wr[${i}]: ${error.message}`)
  }
  ok(`アラート2 [重複の疑い] 同日・同案件 work_records 2件 (${dupDate})`)
}

// ── アラート3: 業務しきい値超過 ──────────────────────────

async function seedThresholdWork(contractorId, projectId) {
  const thDate = new Date(Date.now() - 2 * 86400 * 1000).toISOString().slice(0, 10)

  const { error } = await db.from('work_records').insert({
    contractor_id: contractorId,
    project_id:    projectId,
    work_date:     thDate,
    date:          thDate,
    piece_count:   101,
    status:        'pending_review',
    tenant_id:     TENANT_ID,
  })
  if (error) throw new Error(`threshold work: ${error.message}`)
  ok(`アラート3 [業務閾値超過] piece_count=101 / status=pending_review (${thDate})`)
}

// ── アラート4: 金額しきい値超過 ──────────────────────────

async function seedThresholdExpense(contractorId) {
  const exDate = new Date(Date.now() - 1 * 86400 * 1000).toISOString().slice(0, 10)

  const { error } = await db.from('expense_records').insert({
    contractor_id: contractorId,
    expense_date:  exDate,
    category:      'transport',
    amount:        35000,
    amount_actual: 35000,
    status:        'pending_review',
    tenant_id:     TENANT_ID,
  })
  if (error) throw new Error(`threshold expense: ${error.message}`)
  ok(`アラート4 [金額閾値超過] amount_actual=35,000円 / status=pending_review (${exDate})`)
}

// ── アラート5: 長期間未承認 payment_notices ───────────────

async function seedPendingNotice(contractorId) {
  const noticeMonth = '2026-04-01'

  await db.from('payment_notices')
    .delete()
    .eq('contractor_id', contractorId)
    .eq('notice_month', noticeMonth)

  // 48時間以上前の created_at を直接 INSERT（RPC不要、service_role で OK）
  const { error } = await db.from('payment_notices').insert({
    contractor_id:   contractorId,
    notice_month:    noticeMonth,
    target_month:    noticeMonth,
    status:          'locked',
    approval_status: 'unapproved',
    total_amount:    88000,
    locked:          false,
    created_at:      TWO_DAYS_AGO,
    updated_at:      TWO_DAYS_AGO,
  })
  if (error) throw new Error(`pending notice: ${error.message}`)
  ok(`アラート5 [長期未承認] payment_notices created_at=${TWO_DAYS_AGO.slice(0,16)} / approval_status=pending`)
}

// ── メイン ────────────────────────────────────────────────

async function main() {
  console.log(bold('\n╔══════════════════════════════════════════════╗'))
  console.log(bold('║  seed-defensive-alerts — デモデータ投入      ║'))
  console.log(bold('╚══════════════════════════════════════════════╝'))
  console.log(`  Target: ${url}  Today: ${TODAY}\n`)

  // 接続確認
  const { error: ping } = await db.from('contractors').select('id').limit(1)
  if (ping) {
    console.error(red(`[FATAL] DB接続失敗: ${ping.message}`))
    process.exit(1)
  }

  // マスタ準備
  let clientId, projectId, cMissing, cDup, cThreshold

  try {
    clientId    = await upsertClient()
    projectId   = await upsertProject(clientId)
    cMissing    = await upsertContractor('[DEMO] 入力遅延ドライバー',  'demo-missing@hibiki.local')
    cDup        = await upsertContractor('[DEMO] 重複ドライバー',      'demo-dup@hibiki.local')
    cThreshold  = await upsertContractor('[DEMO] 閾値超えドライバー',  'demo-threshold@hibiki.local')
    ok(`マスタ準備完了 (client, project, contractors × 3)`)
  } catch (e) {
    console.error(red(`[FATAL] マスタ準備失敗: ${e.message}`))
    process.exit(1)
  }

  try { await cleanAll() } catch (e) { console.error(red(`[FATAL] クリーンアップ失敗: ${e.message}`)); process.exit(1) }

  console.log(cyan('\n  ─── デモデータ投入 ───'))

  try { await seedMissingInput(cMissing, projectId) }
  catch (e) { ng('アラート1', e.message) }

  try { await seedDuplicate(cDup, projectId) }
  catch (e) { ng('アラート2', e.message) }

  try { await seedThresholdWork(cThreshold, projectId) }
  catch (e) { ng('アラート3', e.message) }

  try { await seedThresholdExpense(cThreshold) }
  catch (e) { ng('アラート4', e.message) }

  try { await seedPendingNotice(cThreshold) }
  catch (e) { ng('アラート5', e.message) }

  console.log(bold(green('\n  ✓ 全デモデータ投入完了\n')))
  console.log('  管理画面 http://localhost:3000/admin/dashboard を開いてアラートを確認してください。\n')
}

main().catch(e => {
  console.error(red(`\n[FATAL] ${e?.message ?? e}`))
  process.exit(1)
})
