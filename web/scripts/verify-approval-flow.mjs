/**
 * TODO 8: 承認フロー3段構え保護の検証スクリプト
 *
 * 検証項目:
 *   [T1] approval_history への INSERT は成功する
 *   [T2] approval_history への UPDATE はトリガーで弾かれる
 *   [T3] approval_history への DELETE はトリガーで弾かれる
 *   [T4] 未ロック payment_notice は通常更新を通す
 *   [T5] approval_status='approved' の notice はロックエラーを返す
 *   [T6] locked=true の notice はロックエラーを返す
 *   [T7] isDeveloperUnlock=true + unlockReason で developer_unlock ログが approval_history に記録される
 *   [T8] developer_unlock ログ自体は UPDATE 不可（不変性の連鎖）
 *
 * 実際のDBスキーマ:
 *   approval_history: { id, payment_notice_id, action_by, action_type, unlock_reason, created_at }
 *   payment_notices:  { id, contractor_id, notice_month, target_month, status, approval_status, locked, ... }
 */

import { readFileSync } from 'fs'
import { resolve, dirname } from 'path'
import { fileURLToPath } from 'url'
import { createClient } from '@supabase/supabase-js'

const __dirname = dirname(fileURLToPath(import.meta.url))
const envPath = resolve(__dirname, '../.env.local')
const env = Object.fromEntries(
  readFileSync(envPath, 'utf8')
    .split('\n')
    .filter(l => l && !l.startsWith('#') && l.includes('='))
    .map(l => { const i = l.indexOf('='); return [l.slice(0, i), l.slice(i + 1)] }),
)

const url = env.NEXT_PUBLIC_SUPABASE_URL
const key = env.SUPABASE_SERVICE_ROLE_KEY
if (!url || !key) {
  console.error('Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY')
  process.exit(1)
}

const db = createClient(url, key, { auth: { persistSession: false } })

const TENANT_ID    = 'local-dev'
const NOTICE_MONTH = '2026-01-01'

// ── カラー出力 ────────────────────────────────────────────────

const green = s => `\x1b[32m${s}\x1b[0m`
const red   = s => `\x1b[31m${s}\x1b[0m`
const bold  = s => `\x1b[1m${s}\x1b[0m`

let passed = 0
let failed = 0

function ok(label, detail = '') {
  passed++
  console.log(`  ${green('✓')} ${label}${detail ? `  (${detail})` : ''}`)
}

function ng(label, detail = '') {
  failed++
  console.log(`  ${red('✗')} ${label}${detail ? `  → ${detail}` : ''}`)
}

// ── テスト用マスタデータの準備 ────────────────────────────────

async function ensureContractor() {
  const { data: ex } = await db
    .from('contractors')
    .select('id')
    .eq('name', '[TEST] 検証用委託先')
    .eq('tenant_id', TENANT_ID)
    .maybeSingle()
  if (ex?.id) return ex.id

  const { data, error } = await db
    .from('contractors')
    .insert({
      name:                      '[TEST] 検証用委託先',
      email:                     'verify-test@hibiki.local',
      phone:                     '000-0000-0000',
      contractor_type:           'individual',
      invoice_registration_type: 'unregistered',
      tax_category:              'exclusive',
      payment_type:              'bank_transfer',
      payment_site:              30,
      tenant_id:                 TENANT_ID,
    })
    .select('id')
    .single()
  if (error) throw new Error(`contractor insert: ${error.message}`)
  return data.id
}

/** users テーブルから実在するユーザーIDを取得（approval_history.action_by FK 用） */
async function findAnyUserId() {
  const { data } = await db.from('users').select('id').limit(1).maybeSingle()
  return data?.id ?? null
}

// ── 3段構えロジックの再現（billing-actions.ts と同ロジック） ─────

async function tryFinalizeNotice(contractorId, userId, opts = {}) {
  const { isDeveloperUnlock = false, unlockReason = null } = opts

  const { data: existing } = await db
    .from('payment_notices')
    .select('id, approval_status, locked, total_amount')
    .eq('contractor_id', contractorId)
    .eq('notice_month', NOTICE_MONTH)
    .maybeSingle()

  // 段1: 存在確認
  // 段2: ロックチェック
  const isLocked =
    existing &&
    (existing.approval_status === 'approved' || existing.locked === true)

  if (isLocked) {
    // 段3: 開発者アンロック確認
    if (!isDeveloperUnlock || !unlockReason) {
      return {
        ok:    false,
        error: '支払通知書はロック済みのため変更できません。isDeveloperUnlock=true および unlockReason の入力が必要です。',
      }
    }

    // 証跡を approval_history に記録（実際のDBスキーマ列名を使用）
    const { error: logErr } = await db
      .from('approval_history')
      .insert({
        payment_notice_id: existing.id,
        action_type:       'developer_unlock',
        action_by:         userId,
        unlock_reason:     unlockReason,
      })
    if (logErr) return { ok: false, error: `audit log: ${logErr.message}` }

    return { ok: true, unlockedId: existing.id }
  }

  return { ok: true, unlockedId: null }
}

// ── テスト実行 ────────────────────────────────────────────────

async function main() {
  console.log(bold('\n=== approval_history 不変性 + 3段構え保護 検証スクリプト ==='))
  console.log(`Target: ${url}\n`)

  const contractorId = await ensureContractor()
  const userId = await findAnyUserId()
  if (!userId) {
    console.error(red('[FATAL] users テーブルにレコードがありません。ログインユーザーを先に作成してください。'))
    process.exit(1)
  }

  // ── グループ1: approval_history の不変性 ──────────────────

  console.log(bold('[グループ1] approval_history トリガー検証'))

  // approval_history は payment_notice_id FK が必須なので先に notice を作成
  await db
    .from('payment_notices')
    .delete()
    .eq('contractor_id', contractorId)
    .eq('notice_month', NOTICE_MONTH)

  const { data: seedNotice, error: seedErr } = await db
    .from('payment_notices')
    .insert({
      contractor_id:   contractorId,
      notice_month:    NOTICE_MONTH,
      target_month:    NOTICE_MONTH,
      status:          'locked',
      total_amount:    10000,
      approval_status: 'pending',
      locked:          false,
    })
    .select('id')
    .single()
  if (seedErr) throw new Error(`seed notice: ${seedErr.message}`)

  // [T1] INSERT は成功するはず
  const { data: inserted, error: insertErr } = await db
    .from('approval_history')
    .insert({
      payment_notice_id: seedNotice.id,
      action_type:       'test_insert',
      action_by:         userId,
      unlock_reason:     '[T1] トリガー検証用INSERT',
    })
    .select('id')
    .single()

  if (!insertErr && inserted?.id) {
    ok('[T1] approval_history INSERT 成功')
  } else {
    ng('[T1] approval_history INSERT 失敗', insertErr?.message)
    process.exit(1)
  }

  const testLogId = inserted.id

  // [T2] UPDATE は禁止トリガーで弾かれるはず
  const { error: updateErr } = await db
    .from('approval_history')
    .update({ unlock_reason: '改ざん試行' })
    .eq('id', testLogId)

  if (updateErr) {
    if (updateErr.message.includes('変更・削除は禁止') || updateErr.message.includes('禁止')) {
      ok('[T2] approval_history UPDATE → トリガーで正しく拒否', updateErr.message.slice(0, 60))
    } else {
      ng('[T2] approval_history UPDATE が別エラーで拒否', updateErr.message)
    }
  } else {
    ng('[T2] approval_history UPDATE が通ってしまった（トリガー未適用の可能性）')
  }

  // [T3] DELETE は禁止トリガーで弾かれるはず
  const { error: deleteErr } = await db
    .from('approval_history')
    .delete()
    .eq('id', testLogId)

  if (deleteErr) {
    if (deleteErr.message.includes('変更・削除は禁止') || deleteErr.message.includes('禁止')) {
      ok('[T3] approval_history DELETE → トリガーで正しく拒否', deleteErr.message.slice(0, 60))
    } else {
      ng('[T3] approval_history DELETE が別エラーで拒否', deleteErr.message)
    }
  } else {
    ng('[T3] approval_history DELETE が通ってしまった（トリガー未適用の可能性）')
  }

  // ── グループ2: 支払通知書の3段構えロックチェック ─────────

  console.log(bold('\n[グループ2] 支払通知書 3段構えロック検証'))

  // [T4] 未ロック（pending 状態）→ 通常更新を通す
  const r4 = await tryFinalizeNotice(contractorId, userId)
  if (r4.ok) {
    ok('[T4] notice が pending 状態 → ロックなし、通過')
  } else {
    ng('[T4] pending 状態なのに拒否された', r4.error)
  }

  // approval_status='approved' に更新
  await db
    .from('payment_notices')
    .update({ approval_status: 'approved', locked: false })
    .eq('contractor_id', contractorId)
    .eq('notice_month', NOTICE_MONTH)

  // [T5] approved 状態 → ロックエラー
  const r5 = await tryFinalizeNotice(contractorId, userId)
  if (!r5.ok && r5.error.includes('ロック済み')) {
    ok('[T5] approval_status=approved → 正しくロックエラー')
  } else {
    ng('[T5] approved 状態なのにロックされなかった', r5.error ?? '通過')
  }

  // locked=true に更新（approval_status は pending に戻す）
  await db
    .from('payment_notices')
    .update({ approval_status: 'pending', locked: true })
    .eq('contractor_id', contractorId)
    .eq('notice_month', NOTICE_MONTH)

  // [T6] locked=true → ロックエラー
  const r6 = await tryFinalizeNotice(contractorId, userId)
  if (!r6.ok && r6.error.includes('ロック済み')) {
    ok('[T6] locked=true → 正しくロックエラー')
  } else {
    ng('[T6] locked=true なのにロックされなかった', r6.error ?? '通過')
  }

  // [T7] isDeveloperUnlock=true + unlockReason → approval_history に証跡が記録されること
  const r7 = await tryFinalizeNotice(contractorId, userId, {
    isDeveloperUnlock: true,
    unlockReason:      '[T7] 検証用 developer unlock',
  })
  if (r7.ok) {
    const { data: logs } = await db
      .from('approval_history')
      .select('id, action_type, unlock_reason')
      .eq('payment_notice_id', r7.unlockedId)
      .eq('action_type', 'developer_unlock')

    if (logs && logs.length > 0) {
      ok('[T7] developer_unlock → 証跡ログが approval_history に記録された',
        `log_id=${logs[0].id.slice(0, 8)}...`)
    } else {
      ng('[T7] developer_unlock は通過したがログが見つからない')
    }
  } else {
    ng('[T7] developer_unlock が拒否された', r7.error)
  }

  // [T8] developer_unlock ログ自体も UPDATE 不可（不変性の連鎖）
  const { data: devLog } = await db
    .from('approval_history')
    .select('id')
    .eq('action_type', 'developer_unlock')
    .eq('action_by', userId)
    .limit(1)
    .maybeSingle()

  if (devLog?.id) {
    const { error: t8Err } = await db
      .from('approval_history')
      .update({ unlock_reason: '改ざん試行' })
      .eq('id', devLog.id)

    if (t8Err) {
      if (t8Err.message.includes('変更・削除は禁止') || t8Err.message.includes('禁止')) {
        ok('[T8] developer_unlock ログ自体も UPDATE 不可（不変性の連鎖を確認）')
      } else {
        ng('[T8] developer_unlock ログ UPDATE が別エラー', t8Err.message)
      }
    } else {
      ng('[T8] developer_unlock ログが UPDATE できてしまった')
    }
  } else {
    ng('[T8] developer_unlock ログが見つからず（T7 が失敗している可能性）')
  }

  // ── クリーンアップ ────────────────────────────────────────
  // approval_history は不変ログのため削除不可（テスト用ログは残る）
  await db
    .from('payment_notices')
    .delete()
    .eq('contractor_id', contractorId)
    .eq('notice_month', NOTICE_MONTH)

  await db
    .from('contractors')
    .delete()
    .eq('name', '[TEST] 検証用委託先')
    .eq('tenant_id', TENANT_ID)

  // ── 結果サマリー ──────────────────────────────────────────
  console.log(bold('\n=== 結果サマリー ==='))
  console.log(`  ${green('PASS')}: ${passed} / ${passed + failed}`)
  if (failed > 0) {
    console.log(`  ${red('FAIL')}: ${failed}`)
    process.exit(1)
  } else {
    console.log(bold('\n  全テスト通過 ✓'))
  }
}

main().catch(err => {
  console.error(red('\n[FATAL] ' + (err.message ?? err)))
  process.exit(1)
})
