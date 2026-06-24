/**
 * setup-ui-test-data.mjs
 *
 * 案件カレンダー・売上請求管理 UI確認用テストデータ投入スクリプト。
 * TEST-01 案件に対して 2026-06-24〜26 の予定（schedules）と実績（work_records）を永続挿入。
 * クリーンアップ処理なし。手動削除が必要な場合は管理画面または Supabase ダッシュボードから。
 *
 * 実行方法:
 *   cd web
 *   SUPABASE_URL=$(grep NEXT_PUBLIC_SUPABASE_URL .env.local | cut -d= -f2) \
 *   SUPABASE_SERVICE_ROLE_KEY=$(grep SUPABASE_SERVICE_ROLE_KEY .env.local | cut -d= -f2) \
 *   node scripts/setup-ui-test-data.mjs
 */

import https from 'https'

const BASE_URL    = process.env.SUPABASE_URL?.trim()
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim()
const TENANT      = 'local-dev'

if (!BASE_URL || !SERVICE_KEY) {
  console.error('❌ 環境変数 SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY が未設定です')
  process.exit(1)
}

const agent = new https.Agent({ rejectUnauthorized: false })

async function request(method, path, body) {
  const res = await fetch(`${BASE_URL}/rest/v1/${path}`, {
    method,
    headers: {
      'apikey':        SERVICE_KEY,
      'Authorization': `Bearer ${SERVICE_KEY}`,
      'Content-Type':  'application/json',
      'Prefer':        'return=representation',
    },
    body: body !== undefined ? JSON.stringify(body) : undefined,
    agent,
  })
  const text = await res.text()
  if (!res.ok && res.status !== 204) {
    let detail = text
    try { detail = JSON.stringify(JSON.parse(text), null, 2) } catch {}
    throw new Error(`HTTP ${res.status} [${method} ${path}]\n${detail}`)
  }
  return text ? JSON.parse(text) : null
}

const get  = (path)        => request('GET', path)
const post = (path, body)  => request('POST', path, body)

async function main() {
  const DATES = ['2026-06-24', '2026-06-25', '2026-06-26']

  console.log('═══════════════════════════════════════════════════════')
  console.log('  UI確認用テストデータ永続投入スクリプト')
  console.log('═══════════════════════════════════════════════════════\n')

  // ── Step 1: マスタ情報取得 ────────────────────────────────────────────

  console.log('【Step 1】マスタ情報を取得...')

  const projects = await get(
    `projects?project_code=eq.TEST-01&tenant_id=eq.${TENANT}&select=id,project_name,contractor_id,buy_amount`
  )
  if (!projects?.length) throw new Error('TEST-01 案件が見つかりません')
  const project = projects[0]

  const payees = await get(
    `project_payees?project_id=eq.${project.id}&select=contractor_id,unit_price`
  )
  if (!payees?.length) throw new Error('TEST-01 の project_payees が見つかりません')
  const contractorId = payees[0].contractor_id
  const unitPrice    = payees[0].unit_price ?? project.buy_amount

  const contractors = await get(
    `contractors?id=eq.${contractorId}&tenant_id=eq.${TENANT}&select=id,name`
  )
  if (!contractors?.length) throw new Error('委託先が見つかりません')
  const contractor = contractors[0]

  console.log(`  ✅ 案件: ${project.project_name} (id: ${project.id})`)
  console.log(`  ✅ 委託先: ${contractor.name} (id: ${contractor.id})`)
  console.log(`  ✅ 単価: ¥${unitPrice.toLocaleString()}`)
  console.log()

  // ── Step 2: schedules 投入 ────────────────────────────────────────────

  console.log('【Step 2】schedules（予定）を投入...')

  const scheduleIds = []
  for (const date of DATES) {
    const rec = await post('schedules', {
      contractor_id: contractor.id,
      project_id:    project.id,
      date,
      status:        'scheduled',
      tenant_id:     TENANT,
    })
    const id = Array.isArray(rec) ? rec[0].id : rec.id
    scheduleIds.push(id)
    console.log(`  ✅ schedules: ${date} → ${id}`)
  }
  console.log()

  // ── Step 3: work_records 投入 ─────────────────────────────────────────

  console.log('【Step 3】work_records（実績）を投入...')

  const workIds = []
  for (const date of DATES) {
    const rec = await post('work_records', {
      contractor_id: contractor.id,
      project_id:    project.id,
      work_date:     date,
      tenant_id:     TENANT,
      status:        'confirmed',
      piece_count:   1,
    })
    const id = Array.isArray(rec) ? rec[0].id : rec.id
    workIds.push(id)
    console.log(`  ✅ work_records: ${date} → ${id}`)
  }
  console.log()

  // ── Step 4: 投入サマリー ──────────────────────────────────────────────

  const totalNet = unitPrice * DATES.length
  const totalTax = Math.floor(totalNet * 0.1)

  console.log('【投入完了サマリー】')
  console.log('┌────────────────────────────────────────────────────┐')
  console.log(`│ 案件      : ${project.project_name.padEnd(36)} │`)
  console.log(`│ 委託先    : ${contractor.name.padEnd(36)} │`)
  console.log(`│ 対象日    : ${DATES.join(' / ').padEnd(36)} │`)
  console.log(`│ 単価      : ¥${String(unitPrice.toLocaleString()).padEnd(35)} │`)
  console.log(`│ 稼働件数  : ${String(DATES.length + '件').padEnd(36)} │`)
  console.log('├────────────────────────────────────────────────────┤')
  console.log(`│ 税抜合計  : ¥${String(totalNet.toLocaleString()).padEnd(35)} │`)
  console.log(`│ 消費税    : ¥${String(totalTax.toLocaleString()).padEnd(35)} │`)
  console.log(`│ 支払合計  : ¥${String((totalNet + totalTax).toLocaleString()).padEnd(35)} │`)
  console.log('└────────────────────────────────────────────────────┘')
  console.log()
  console.log('📌 データはDBに残存します。削除は管理画面または以下SQLで実行:')
  console.log(`   DELETE FROM schedules WHERE id IN ('${scheduleIds.join("','")}');`)
  console.log(`   DELETE FROM work_records WHERE id IN ('${workIds.join("','")}');`)
  console.log()
  console.log('═══════════════════════════════════════════════════════')
  console.log('  ✅ UI確認用データ投入完了')
  console.log('═══════════════════════════════════════════════════════')
}

main().catch(err => {
  console.error('\n❌ エラー:', err.message)
  process.exit(1)
})
