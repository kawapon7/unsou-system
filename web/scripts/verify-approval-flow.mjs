/**
 * TODO 8: 承認フロー3段構え保護の検証スクリプト
 *
 * シナリオ(a): 'unapproved' 状態 → 通常操作が通ること（ガードレール未作動）
 * シナリオ(b): 'approved' 状態  → 再編集ブロック＋approval_historyへの不変ログ記録
 * シナリオ(c): 'locked' 状態    → developer_unlock時にunlock_reasonが欠損なく記録される
 *
 * 環境変数:
 *   SUPABASE_URL             省略時 http://127.0.0.1:54321 (ローカル)
 *   SUPABASE_SERVICE_ROLE_KEY 省略時 ローカルデフォルトキー
 */

import { createClient } from '@supabase/supabase-js'

const LOCAL_URL = 'http://127.0.0.1:54321'
const LOCAL_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImV4cCI6MTk4MzgxMjk5Nn0.EGIM96RAZx35lJzdJsyH-qQwv8Hdp7fsn3W0YpN81IU'

const url = process.env.SUPABASE_URL             || LOCAL_URL
const key = process.env.SUPABASE_SERVICE_ROLE_KEY || LOCAL_KEY

const db = createClient(url, key, { auth: { persistSession: false } })

const TENANT_ID    = 'local-dev'
const NOTICE_MONTH = '2026-01-01'

// ── カラー出力 ──────────────────────────────────────────────────

const green = s => `\x1b[32m${s}\x1b[0m`
const red   = s => `\x1b[31m${s}\x1b[0m`
const bold  = s => `\x1b[1m${s}\x1b[0m`
const cyan  = s => `\x1b[36m${s}\x1b[0m`

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

// ── マスタデータ準備 ────────────────────────────────────────────

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

async function findAnyUserId() {
  const { data } = await db.from('users').select('id').limit(1).maybeSingle()
  return data?.id ?? null
}

// ── 支払通知書の3段構えロジック（billing-actions.ts と同ロジック） ───

async function tryFinalizeNotice(contractorId, userId, opts = {}) {
  const { isDeveloperUnlock = false, unlockReason = null } = opts

  const { data: existing } = await db
    .from('payment_notices')
    .select('id, approval_status, locked, total_amount')
    .eq('contractor_id', contractorId)
    .eq('notice_month', NOTICE_MONTH)
    .maybeSingle()

  const isLocked =
    existing &&
    (existing.approval_status === 'approved' || existing.locked === true)

  if (isLocked) {
    if (!isDeveloperUnlock || !unlockReason) {
      return {
        ok:    false,
        error: '支払通知書はロック済みのため変更できません。isDeveloperUnlock=true および unlockReason の入力が必要です。',
      }
    }

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

// ── シード: payment_notice を指定 approval_status で作成 ────────

async function seedNotice(contractorId, approvalStatus, locked = false) {
  // approval_history の ON DELETE RESTRICT があるため DELETE は使わず upsert で状態を上書き
  const { data, error } = await db
    .from('payment_notices')
    .upsert(
      {
        contractor_id:   contractorId,
        notice_month:    NOTICE_MONTH,
        target_month:    NOTICE_MONTH,
        status:          'locked',
        total_amount:    10000,
        approval_status: approvalStatus,
        locked,
      },
      { onConflict: 'contractor_id,notice_month' },
    )
    .select('id')
    .single()
  if (error) throw new Error(`seed notice (${approvalStatus}): ${error.message}`)
  return data.id
}

// ── メイン ──────────────────────────────────────────────────────

async function main() {
  console.log(bold('\n=== approval_history 不変性 + 3段構え保護 検証スクリプト ==='))
  console.log(`Target: ${url}\n`)

  const contractorId = await ensureContractor()
  const userId = await findAnyUserId()
  if (!userId) {
    console.error(red('[FATAL] users テーブルにレコードがありません。ローカルDBにログインユーザーを先に作成してください。'))
    process.exit(1)
  }

  // ── グループ1: approval_history の不変性（共通前提） ──────────

  console.log(bold('[グループ1] approval_history トリガー検証'))

  const g1NoticeId = await seedNotice(contractorId, 'unapproved', false)

  // [T1] INSERT は成功するはず
  const { data: inserted, error: insertErr } = await db
    .from('approval_history')
    .insert({
      payment_notice_id: g1NoticeId,
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

  // [T2] UPDATE はトリガーで弾かれるはず
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

  // [T3] DELETE はトリガーで弾かれるはず
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

  // ════════════════════════════════════════════════════════════════
  // シナリオ(a): 'unapproved' 状態 — ガードレール未作動を確認
  // ════════════════════════════════════════════════════════════════

  console.log(cyan(bold('\n[シナリオ(a)] unapproved 状態 — 通常操作が通ること')))

  await seedNotice(contractorId, 'unapproved', false)

  // [T4] unapproved 状態 → 3段ロックは作動せず通過するはず
  const r4 = await tryFinalizeNotice(contractorId, userId)
  if (r4.ok) {
    ok('[T4] unapproved 状態 → ロックなし、通常操作が通過')
  } else {
    ng('[T4] unapproved 状態なのに拒否された', r4.error)
  }

  // ════════════════════════════════════════════════════════════════
  // シナリオ(b): 'approved' 状態 — 再編集ブロック＋不変ログ記録
  // ════════════════════════════════════════════════════════════════

  console.log(cyan(bold('\n[シナリオ(b)] approved 状態 — 再編集ブロック＋approval_history記録')))

  await seedNotice(contractorId, 'approved', false)

  // [T5] approved 状態 → ロックエラーが返るはず
  const r5 = await tryFinalizeNotice(contractorId, userId)
  if (!r5.ok && r5.error.includes('ロック済み')) {
    ok('[T5] approval_status=approved → 正しくロックエラー')
  } else {
    ng('[T5] approved 状態なのにロックされなかった', r5.error ?? '通過')
  }

  // [T7-b] approved 状態で isDeveloperUnlock=true → approval_history に証跡が記録されること
  const r7b = await tryFinalizeNotice(contractorId, userId, {
    isDeveloperUnlock: true,
    unlockReason:      '[T7-b] approved状態からの developer unlock 検証',
  })
  if (r7b.ok) {
    const { data: logs } = await db
      .from('approval_history')
      .select('id, action_type, unlock_reason')
      .eq('payment_notice_id', r7b.unlockedId)
      .eq('action_type', 'developer_unlock')

    if (logs && logs.length > 0 && logs[0].unlock_reason) {
      ok('[T7-b] developer_unlock → 証跡ログが approval_history に記録された',
        `log_id=${logs[0].id.slice(0, 8)}... unlock_reason="${logs[0].unlock_reason.slice(0, 20)}"`)
    } else {
      ng('[T7-b] developer_unlock は通過したがログが見つからない、またはunlock_reasonが欠損')
    }
  } else {
    ng('[T7-b] developer_unlock が拒否された', r7b.error)
  }

  // [T8] developer_unlock ログ自体も UPDATE 不可（不変性の連鎖）
  const { data: devLogB } = await db
    .from('approval_history')
    .select('id')
    .eq('action_type', 'developer_unlock')
    .eq('action_by', userId)
    .limit(1)
    .maybeSingle()

  if (devLogB?.id) {
    const { error: t8Err } = await db
      .from('approval_history')
      .update({ unlock_reason: '改ざん試行' })
      .eq('id', devLogB.id)

    if (t8Err && (t8Err.message.includes('変更・削除は禁止') || t8Err.message.includes('禁止'))) {
      ok('[T8] developer_unlock ログ自体も UPDATE 不可（不変性の連鎖を確認）')
    } else if (t8Err) {
      ng('[T8] developer_unlock ログ UPDATE が別エラー', t8Err.message)
    } else {
      ng('[T8] developer_unlock ログが UPDATE できてしまった')
    }
  } else {
    ng('[T8] developer_unlock ログが見つからず（T7-b が失敗している可能性）')
  }

  // ════════════════════════════════════════════════════════════════
  // シナリオ(c): 'locked' 状態 — developer_unlock時のunlock_reason記録
  // ════════════════════════════════════════════════════════════════

  console.log(cyan(bold('\n[シナリオ(c)] locked 状態 — developer_unlockのunlock_reason欠損なし確認')))

  await seedNotice(contractorId, 'unapproved', true) // locked=true

  // [T6] locked=true → ロックエラーが返るはず
  const r6 = await tryFinalizeNotice(contractorId, userId)
  if (!r6.ok && r6.error.includes('ロック済み')) {
    ok('[T6] locked=true → 正しくロックエラー')
  } else {
    ng('[T6] locked=true なのにロックされなかった', r6.error ?? '通過')
  }

  // [T7-c] locked 状態で isDeveloperUnlock=true + unlockReason → unlock_reason が欠損なく記録されること
  const r7c = await tryFinalizeNotice(contractorId, userId, {
    isDeveloperUnlock: true,
    unlockReason:      '[T7-c] locked状態からの developer unlock 検証',
  })
  if (r7c.ok) {
    const { data: logs } = await db
      .from('approval_history')
      .select('id, action_type, unlock_reason')
      .eq('payment_notice_id', r7c.unlockedId)
      .eq('action_type', 'developer_unlock')
      .order('created_at', { ascending: false })
      .limit(1)

    const log = logs?.[0]
    if (log?.unlock_reason) {
      ok('[T7-c] developer_unlock → unlock_reason が欠損なく approval_history に記録された',
        `unlock_reason="${log.unlock_reason.slice(0, 30)}"`)
    } else if (log) {
      ng('[T7-c] ログは記録されたが unlock_reason が NULL または空')
    } else {
      ng('[T7-c] developer_unlock は通過したがログが見つからない')
    }
  } else {
    ng('[T7-c] locked状態での developer_unlock が拒否された', r7c.error)
  }

  // ── クリーンアップ ──────────────────────────────────────────
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

  // ── 結果サマリー ────────────────────────────────────────────
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
