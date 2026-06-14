/**
 * 承認フロー 3段構え保護ロジック 検証スクリプト
 *
 * 実行: node scripts/test-approval-protection.mjs
 *
 * 検証対象:
 *   Suite 1: 自動ロック       — status='locked' の notice は通常承認を拒否する
 *   Suite 2: アンロック制限   — isDeveloperUnlock + unlockReason が揃わなければ弾かれる
 *   Suite 3: ログ不変性       — approval_history の UPDATE / DELETE がトリガーで拒否される
 *
 * 実スキーマ（リモートDB）:
 *   contractors     : id, user_id, name, payment_type, payment_site, tax_category,
 *                     invoice_registration_type, contractor_type, ...
 *   payment_notices : id, contractor_id, target_month, status ('pending'|'locked'|'approved'),
 *                     subtotal_registered, tax_registered, subtotal_unregistered,
 *                     tax_unregistered, deduction_unregistered, subtotal_exempt,
 *                     total_excluding_tax, total_tax, total_deduction, created_at
 *   approval_history: id, payment_notice_id (NOT NULL FK), action_by, action_type, created_at
 */

import { createClient } from '../node_modules/@supabase/supabase-js/dist/index.mjs'

// ── 接続設定 ──────────────────────────────────────────────────────
const SUPABASE_URL     = 'https://hbpnhbsmsuhjyrohpluu.supabase.co'
const SERVICE_ROLE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImhicG5oYnNtc3Voanlyb2hwbHV1Iiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc4MDY4ODY5MSwiZXhwIjoyMDk2MjY0NjkxfQ.3-tCc-t7NWbBGH2oSd7k08iHWgeSGvMdLcK2sGGmmY8'
const ANON_KEY         = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImhicG5oYnNtc3Voanlyb2hwbHV1Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODA2ODg2OTEsImV4cCI6MjA5NjI2NDY5MX0.p1WyMnvm-CsFq15VOCNcXePl6SeASUrcxZFb67EOl68'

const service = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, { auth: { persistSession: false } })
const anon    = createClient(SUPABASE_URL, ANON_KEY,         { auth: { persistSession: false } })

// ── カウンタ / レポート ───────────────────────────────────────────
let passed = 0
let failed = 0
const TEST_RUN_ID = `test-${Date.now()}`

function pass(label) { console.log(`  ✅ PASS  ${label}`); passed++ }
function fail(label, detail) { console.error(`  ❌ FAIL  ${label}${detail ? `\n         → ${detail}` : ''}`); failed++ }
function assert(label, condition, detail) { condition ? pass(label) : fail(label, detail) }
function section(title) { console.log(`\n${'─'.repeat(62)}\n  ${title}\n${'─'.repeat(62)}`) }

// ================================================================
// 3段構えロックチェック（driver-actions.ts / billing-actions.ts のロジック再現）
//
// 実DBの status 値:
//   'pending'  … 未承認（通常更新可）
//   'locked'   … 子分承認済み（自動ロック）
//   'approved' … 親分確定済み（自動ロック）
// ================================================================
function checkLock(noticeStatus, opts) {
  const isLocked = noticeStatus === 'locked' || noticeStatus === 'approved'
  if (!isLocked) return { blocked: false, error: null }

  if (!opts.isDeveloperUnlock || !opts.unlockReason) {
    return {
      blocked: true,
      error: '支払通知書はロック済みのため変更できません。' +
             'isDeveloperUnlock=true および unlockReason の入力が必要です。',
    }
  }
  return { blocked: false, error: null }  // 開発者アンロック通過
}

// ================================================================
// セットアップ: テスト用 contractor + payment_notice を作成
// ================================================================
async function setup() {
  const testName = `[AUTOTEST] ${TEST_RUN_ID}`

  // contractor INSERT（実カラム名に合わせる）
  const { data: contractor, error: cErr } = await service
    .from('contractors')
    .insert({
      name:                      testName,
      email:                     `autotest-${TEST_RUN_ID}@test.invalid`,
      payment_type:              'bank_transfer',
      payment_site:              30,
      tax_category:              'exclusive',
      invoice_registration_type: 'unregistered',
      contractor_type:           'sole_proprietor',
    })
    .select('id')
    .single()

  if (cErr || !contractor) throw new Error(`contractor INSERT 失敗 — ${cErr?.message}`)

  return { contractorId: contractor.id, contractorName: testName }
}

// ================================================================
// クリーンアップ: テストデータを削除
// approval_history はトリガー保護のため消去しない（証跡として残す）
// ================================================================
async function cleanup(contractorId) {
  await service.from('payment_notices').delete().eq('contractor_id', contractorId)
  await service.from('contractors').delete().eq('id', contractorId)
}

// ================================================================
// Suite 1: 自動ロック検証
// ================================================================
async function suite1_AutoLock(contractorId) {
  section('Suite 1: 自動ロック検証')

  // 1-A: status='pending' → ロックなし（更新許可）
  assert(
    '1-A: status=pending → ロックなし（更新許可）',
    checkLock('pending', { isDeveloperUnlock: false }).blocked === false,
  )

  // 1-B: status='locked' → 自動ロック発動
  {
    const r = checkLock('locked', { isDeveloperUnlock: false })
    assert('1-B: status=locked → ロック発動・更新拒否', r.blocked === true)
    assert(
      '1-B: エラーメッセージに「ロック済み」が含まれる',
      r.error?.includes('ロック済み') ?? false,
      `error="${r.error}"`,
    )
  }

  // 1-C: status='approved' → 親分確定後もロック
  assert(
    '1-C: status=approved → ロック発動・更新拒否',
    checkLock('approved', { isDeveloperUnlock: false }).blocked === true,
  )

  // 1-D: DBに status='locked' の notice を INSERT → SELECT してロック検知確認
  const { data: notice, error: nErr } = await service
    .from('payment_notices')
    .insert({
      contractor_id:          contractorId,
      target_month:           '2099-01-01',
      status:                 'locked',
      subtotal_registered:    0,
      tax_registered:         0,
      subtotal_unregistered:  80000,
      tax_unregistered:       8000,
      deduction_unregistered: 0,
      subtotal_exempt:        0,
      total_excluding_tax:    80000,
      total_tax:              8000,
      total_deduction:        0,
    })
    .select('id, status')
    .single()

  if (nErr || !notice) {
    fail('1-D: DB INSERT locked notice', nErr?.message)
    return null  // 後続 suiteが依存するため early return
  }

  assert(
    '1-D: DB取得した status=locked の notice → ロック検知',
    checkLock(notice.status, { isDeveloperUnlock: false }).blocked === true,
    `DB status=${notice.status}`,
  )

  return notice.id  // Suite 2/3 で使用
}

// ================================================================
// Suite 2: 開発者アンロック制限検証
// ================================================================
async function suite2_DeveloperUnlock(noticeId) {
  section('Suite 2: 開発者アンロック制限検証')

  if (!noticeId) { fail('2-前提: noticeId が取得できないためスキップ'); return }

  // 2-A: isDeveloperUnlock=false → 拒否
  assert(
    '2-A: isDeveloperUnlock=false → 拒否',
    checkLock('locked', { isDeveloperUnlock: false, unlockReason: undefined }).blocked === true,
  )

  // 2-B: isDeveloperUnlock=true + unlockReason='' → 拒否（空文字は falsy）
  assert(
    '2-B: isDeveloperUnlock=true + unlockReason="" → 拒否',
    checkLock('locked', { isDeveloperUnlock: true, unlockReason: '' }).blocked === true,
  )

  // 2-C: isDeveloperUnlock=undefined + unlockReason有り → 拒否
  assert(
    '2-C: isDeveloperUnlock=undefined + unlockReason有り → 拒否',
    checkLock('locked', { isDeveloperUnlock: undefined, unlockReason: '誤入力修正' }).blocked === true,
  )

  // 2-D: isDeveloperUnlock=true + unlockReason有り → 通過
  assert(
    '2-D: isDeveloperUnlock=true + unlockReason有り → 通過',
    checkLock('locked', { isDeveloperUnlock: true, unlockReason: '請求金額の誤入力修正のため' }).blocked === false,
  )

  // 2-E: 開発者アンロック通過後、approval_history に証跡を INSERT できる
  const DEV_OPERATOR = '33259c12-e46b-4ebd-a87c-cf50682729c4'  // admin@hibiki.com (master)
  const { error: logErr } = await service
    .from('approval_history')
    .insert({
      payment_notice_id: noticeId,
      action_type:       'developer_unlock',
      action_by:         DEV_OPERATOR,
    })

  assert(
    '2-E: 開発者アンロック証跡を approval_history に INSERT できる',
    logErr === null,
    logErr?.message,
  )

  // 2-F: INSERT した証跡が SELECT で確認できる
  if (!logErr) {
    const { data: logRow } = await service
      .from('approval_history')
      .select('id, action_type, action_by')
      .eq('payment_notice_id', noticeId)
      .eq('action_type', 'developer_unlock')
      .single()

    assert(
      '2-F: 挿入した証跡が SELECT で取得できる',
      logRow?.action_type === 'developer_unlock',
      `row=${JSON.stringify(logRow)}`,
    )
  }
}

// ================================================================
// Suite 3: ログ不変性検証（approval_history トリガー）
// ================================================================
async function suite3_LogImmutability(noticeId) {
  section('Suite 3: ログ不変性検証（approval_historyトリガー）')

  if (!noticeId) { fail('3-前提: noticeId が取得できないためスキップ'); return }

  // 3-0: テスト用ログ行を INSERT
  const MASTER_USER_ID = '33259c12-e46b-4ebd-a87c-cf50682729c4'
  const { data: logRow, error: insErr } = await service
    .from('approval_history')
    .insert({
      payment_notice_id: noticeId,
      action_type:       'immutability_test',
      action_by:         MASTER_USER_ID,
    })
    .select('id')
    .single()

  assert(
    '3-0: approval_history への INSERT は成功する',
    insErr === null,
    insErr?.message,
  )

  if (!logRow?.id) {
    fail('3-前提: INSERT した行の ID を取得できない')
    return
  }

  const logId = logRow.id

  // 3-A: UPDATE を試みる → トリガーで拒否
  const { error: updateErr } = await service
    .from('approval_history')
    .update({ action_type: 'TAMPERED' })
    .eq('id', logId)

  assert(
    '3-A: approval_history の UPDATE はトリガーで拒否される',
    updateErr !== null,
    updateErr ? undefined : 'ERROR: UPDATEが成功した（不変性破綻）',
  )
  if (updateErr) {
    assert(
      '3-A: エラーメッセージに「承認履歴」または「禁止」が含まれる',
      updateErr.message.includes('承認履歴') || updateErr.message.includes('禁止'),
      `error="${updateErr.message}"`,
    )
  }

  // 3-B: DELETE を試みる → トリガーで拒否
  const { error: deleteErr } = await service
    .from('approval_history')
    .delete()
    .eq('id', logId)

  assert(
    '3-B: approval_history の DELETE はトリガーで拒否される',
    deleteErr !== null,
    deleteErr ? undefined : 'ERROR: DELETEが成功した（不変性破綻）',
  )
  if (deleteErr) {
    assert(
      '3-B: エラーメッセージに「承認履歴」または「禁止」が含まれる',
      deleteErr.message.includes('承認履歴') || deleteErr.message.includes('禁止'),
      `error="${deleteErr.message}"`,
    )
  }

  // 3-C: UPDATE/DELETE 試行後もレコードが原文のまま存在する
  const { data: afterRow } = await service
    .from('approval_history')
    .select('id, action_type')
    .eq('id', logId)
    .single()

  assert(
    '3-C: UPDATE試行後もレコードが原文のまま残存する',
    afterRow?.action_type === 'immutability_test',
    `action_type="${afterRow?.action_type}"`,
  )

  // 3-D: anon（未認証）からの INSERT は RLS で拒否される
  const { error: anonErr } = await anon
    .from('approval_history')
    .insert({
      payment_notice_id: noticeId,
      action_type:       'unauthorized_insert',
      action_by:         'attacker',
    })

  assert(
    '3-D: anon クライアントからの INSERT は RLS で拒否される',
    anonErr !== null,
    anonErr ? undefined : 'ERROR: 未認証INSERTが通過した',
  )
}

// ================================================================
// メイン
// ================================================================
async function main() {
  console.log('='.repeat(62))
  console.log('  承認フロー 3段構え保護ロジック 検証スクリプト')
  console.log(`  Run ID : ${TEST_RUN_ID}`)
  console.log(`  DB URL : ${SUPABASE_URL}`)
  console.log('='.repeat(62))

  let contractorId = null
  let noticeId     = null

  try {
    const s = await setup()
    contractorId = s.contractorId
    console.log(`\n  テスト用 contractor 作成 : ${s.contractorName}`)
    console.log(`  contractor_id           : ${contractorId}`)

    noticeId = await suite1_AutoLock(contractorId)
    await suite2_DeveloperUnlock(noticeId)
    await suite3_LogImmutability(noticeId)

  } catch (err) {
    console.error('\n  [FATAL]', err)
    failed++
  } finally {
    if (contractorId) {
      process.stdout.write('\n  クリーンアップ中 … ')
      await cleanup(contractorId)
      console.log('完了（approval_historyは証跡として残留）')
    }
  }

  const total = passed + failed
  console.log('\n' + '='.repeat(62))
  console.log(`  結果  : ${passed}/${total} PASSED  /  ${failed} FAILED`)
  console.log('='.repeat(62))

  if (failed > 0) process.exit(1)
}

main()
