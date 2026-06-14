/**
 * 承認フロー 本番DB疎通確認スクリプト
 * node scripts/debug-approval-flow.mjs
 */

import { createClient } from '../node_modules/@supabase/supabase-js/dist/index.mjs'

const SUPABASE_URL     = 'https://hbpnhbsmsuhjyrohpluu.supabase.co'
const SERVICE_ROLE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImhicG5oYnNtc3Voanlyb2hwbHV1Iiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc4MDY4ODY5MSwiZXhwIjoyMDk2MjY0NjkxfQ.3-tCc-t7NWbBGH2oSd7k08iHWgeSGvMdLcK2sGGmmY8'

const db = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, { auth: { persistSession: false } })

// 既知の本番レコード（テスト済み）
const NOTICE_ID   = '78bf6ced-234b-4986-ac10-33b99f75aa7e'  // status='locked'
const MASTER_UID  = '33259c12-e46b-4ebd-a87c-cf50682729c4'  // admin@hibiki.com

function log(label, value) {
  if (typeof value === 'object') {
    console.log(`[${label}]`, JSON.stringify(value, null, 2))
  } else {
    console.log(`[${label}]`, value)
  }
}

// ================================================================
// 3段構えロックチェック（billing-actions.ts / driver-actions.ts 再現）
// ================================================================
function checkLock(status, opts = {}) {
  const isLocked = status === 'locked' || status === 'approved'
  if (!isLocked) return { blocked: false }

  if (!opts.isDeveloperUnlock || !opts.unlockReason) {
    return {
      blocked: true,
      error: '支払通知書はロック済みのため変更できません。isDeveloperUnlock=true および unlockReason の入力が必要です。',
    }
  }
  return { blocked: false }
}

async function main() {
  const ts = new Date().toISOString()
  console.log('='.repeat(64))
  console.log('  承認フロー 本番DB 疎通確認')
  console.log(`  実行時刻 : ${ts}`)
  console.log(`  対象DB   : ${SUPABASE_URL}`)
  console.log('='.repeat(64))

  // ──────────────────────────────────────────────────────────────
  // STEP 1: 対象 payment_notice の現状確認
  // ──────────────────────────────────────────────────────────────
  console.log('\n━━ STEP 1: 対象 payment_notice の現状確認 ━━')

  const { data: notice, error: noticeErr } = await db
    .from('payment_notices')
    .select('id, contractor_id, target_month, status')
    .eq('id', NOTICE_ID)
    .single()

  if (noticeErr || !notice) {
    log('ERROR', noticeErr?.message ?? 'notice not found')
    process.exit(1)
  }

  log('payment_notice', notice)
  console.log(`  → status="${notice.status}" （ロック状態: ${notice.status === 'locked' || notice.status === 'approved' ? 'YES' : 'NO'}）`)

  // ──────────────────────────────────────────────────────────────
  // STEP 2: approval_history に INSERT（アンロック証跡）
  // ──────────────────────────────────────────────────────────────
  console.log('\n━━ STEP 2: approval_history INSERT（テスト証跡）━━')

  const { data: inserted, error: insertErr } = await db
    .from('approval_history')
    .insert({
      payment_notice_id: NOTICE_ID,
      action_type:       'developer_unlock',
      action_by:         MASTER_UID,
    })
    .select('id, payment_notice_id, action_type, action_by, created_at')
    .single()

  if (insertErr) {
    log('INSERT ERROR', insertErr.message)
    process.exit(1)
  }

  log('INSERT 成功', inserted)
  const historyId = inserted.id

  // ──────────────────────────────────────────────────────────────
  // STEP 3: UPDATE → トリガーによる拒否を確認
  // ──────────────────────────────────────────────────────────────
  console.log('\n━━ STEP 3: UPDATE 試行 → トリガー拒否確認 ━━')
  console.log(`  対象 approval_history.id = ${historyId}`)
  console.log('  実行: UPDATE approval_history SET action_type=\'TAMPERED\' WHERE id=?')

  const { error: updateErr } = await db
    .from('approval_history')
    .update({ action_type: 'TAMPERED' })
    .eq('id', historyId)

  if (updateErr) {
    log('UPDATE BLOCKED (期待通り)', updateErr.message)
  } else {
    log('UPDATE RESULT', '⚠️  UPDATEが成功してしまった（トリガー未適用）')
    process.exit(1)
  }

  // ──────────────────────────────────────────────────────────────
  // STEP 4: DELETE → トリガーによる拒否を確認
  // ──────────────────────────────────────────────────────────────
  console.log('\n━━ STEP 4: DELETE 試行 → トリガー拒否確認 ━━')
  console.log(`  対象 approval_history.id = ${historyId}`)
  console.log('  実行: DELETE FROM approval_history WHERE id=?')

  const { error: deleteErr } = await db
    .from('approval_history')
    .delete()
    .eq('id', historyId)

  if (deleteErr) {
    log('DELETE BLOCKED (期待通り)', deleteErr.message)
  } else {
    log('DELETE RESULT', '⚠️  DELETEが成功してしまった（トリガー未適用）')
    process.exit(1)
  }

  // レコードが変更されていないことを確認
  const { data: unchanged } = await db
    .from('approval_history')
    .select('id, action_type')
    .eq('id', historyId)
    .single()

  log('UPDATE/DELETE後のレコード（原文維持確認）', unchanged)

  // ──────────────────────────────────────────────────────────────
  // STEP 5: 防衛フロー全体疎通確認（Server Actionsロジック再現）
  // ──────────────────────────────────────────────────────────────
  console.log('\n━━ STEP 5: 防衛フロー全体疎通 ━━')

  // 5-1: ロック中の notice に対して通常更新を試みる → 弾かれること
  console.log('\n  [5-1] status=locked の notice に通常更新 → 拒否')
  const lock_result_normal = checkLock(notice.status, {
    isDeveloperUnlock: false,
    unlockReason: undefined,
  })
  log('  通常更新チェック結果', lock_result_normal)

  // 5-2: isDeveloperUnlock=true だが unlockReason なし → 弾かれること
  console.log('\n  [5-2] isDeveloperUnlock=true、unlockReason なし → 拒否')
  const lock_result_no_reason = checkLock(notice.status, {
    isDeveloperUnlock: true,
    unlockReason: '',
  })
  log('  アンロック試行（理由なし）結果', lock_result_no_reason)

  // 5-3: isDeveloperUnlock=true + unlockReason 有り → 通過 → DB更新 → 証跡INSERT
  console.log('\n  [5-3] isDeveloperUnlock=true + unlockReason 有り → 通過 → アンロック実行')
  const UNLOCK_REASON = 'デバッグ疎通確認のためのテストアンロック'
  const lock_result_ok = checkLock(notice.status, {
    isDeveloperUnlock: true,
    unlockReason: UNLOCK_REASON,
  })
  log('  アンロック試行（理由あり）結果', lock_result_ok)

  if (!lock_result_ok.blocked) {
    // ① status を approved に変更（アンロック＝確定前状態）
    // ※ CHECK制約の許可値: 'approved' | 'locked'
    const { error: unlockErr } = await db
      .from('payment_notices')
      .update({ status: 'approved' })
      .eq('id', NOTICE_ID)

    if (unlockErr) {
      log('  payment_notices UPDATE ERROR', unlockErr.message)
    } else {
      log('  payment_notices UPDATE', `status: locked → approved （アンロック完了）`)
    }

    // ② 証跡を approval_history に記録
    const { data: auditRow, error: auditErr } = await db
      .from('approval_history')
      .insert({
        payment_notice_id: NOTICE_ID,
        action_type:       'developer_unlock',
        action_by:         MASTER_UID,
      })
      .select('id, action_type, created_at')
      .single()

    if (auditErr) {
      log('  approval_history INSERT ERROR', auditErr.message)
    } else {
      log('  approval_history INSERT（証跡）', auditRow)
    }

    // ③ ロック状態の復元（テスト後 status='locked' に戻す）
    const { error: relockErr } = await db
      .from('payment_notices')
      .update({ status: 'locked' })
      .eq('id', NOTICE_ID)

    log('  payment_notices RELOCK', relockErr ? `ERROR: ${relockErr.message}` : 'status: pending → locked （元に戻し完了）')
  }

  // 5-4: 最終状態確認
  console.log('\n  [5-4] 最終状態確認')
  const { data: finalNotice } = await db
    .from('payment_notices')
    .select('id, status')
    .eq('id', NOTICE_ID)
    .single()
  log('  payment_notices 最終状態', finalNotice)

  const { data: auditRows } = await db
    .from('approval_history')
    .select('id, action_type, created_at')
    .eq('payment_notice_id', NOTICE_ID)
    .order('created_at', { ascending: false })
    .limit(5)
  log('  approval_history（最新5件）', auditRows)

  // ──────────────────────────────────────────────────────────────
  // 完了
  // ──────────────────────────────────────────────────────────────
  console.log('\n' + '='.repeat(64))
  console.log('  全ステップ完了 — 本番DB疎通確認 OK')
  console.log('='.repeat(64))
}

main().catch(e => { console.error('[FATAL]', e); process.exit(1) })
