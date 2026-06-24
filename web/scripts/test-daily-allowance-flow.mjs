/**
 * test-daily-allowance-flow.mjs
 *
 * 日当制案件（TEST-01）の実績投入 → 支払通知書計算の一連フロー検証スクリプト。
 * billing/actions.ts の generatePaymentNotice ロジックを移植して計算を再現する。
 *
 * 実行方法:
 *   cd web
 *   SUPABASE_URL=$(grep NEXT_PUBLIC_SUPABASE_URL .env.local | cut -d= -f2) \
 *   SUPABASE_SERVICE_ROLE_KEY=$(grep SUPABASE_SERVICE_ROLE_KEY .env.local | cut -d= -f2) \
 *   node scripts/test-daily-allowance-flow.mjs
 */

import https from 'https'

// ─── Supabase REST クライアント（SSL検証スキップ: 開発ローカル限定） ───

const BASE_URL = process.env.SUPABASE_URL?.trim()
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim()
const TENANT = 'local-dev'

if (!BASE_URL || !SERVICE_KEY) {
  console.error('❌ 環境変数 SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY が未設定です')
  process.exit(1)
}

// Mac ローカル環境の SSL 証明書エラーを回避（開発専用）
const agent = new https.Agent({ rejectUnauthorized: false })

async function request(method, path, body) {
  const url = `${BASE_URL}/rest/v1/${path}`
  const headers = {
    'apikey': SERVICE_KEY,
    'Authorization': `Bearer ${SERVICE_KEY}`,
    'Content-Type': 'application/json',
    'Prefer': 'return=representation',
  }
  const res = await fetch(url, {
    method,
    headers,
    body: body !== undefined ? JSON.stringify(body) : undefined,
    agent,
  })
  const text = await res.text()
  if (!res.ok && res.status !== 204) {
    let detail = text
    try { detail = JSON.stringify(JSON.parse(text), null, 2) } catch {}
    throw new Error(`HTTP ${res.status} [${method} ${path}]\n${detail}`)
  }
  if (!text) return null
  return JSON.parse(text)
}

const get    = (path) => request('GET', path)
const post   = (path, body) => request('POST', path, body)
const delete_ = (path) => request('DELETE', path)

// ─── 計算ロジック（billing/actions.ts から移植） ─────────────────────────

function calcTax(amount, taxCategory) {
  if (taxCategory === 'exclusive') return Math.floor(amount * 0.1)
  if (taxCategory === 'inclusive') return Math.floor(amount - amount / 1.1)
  return 0
}

function calcWithholding(amount) {
  return Math.floor(amount * 0.1021)
}

function calcDeductionRate(invoiceType, yearMonth) {
  if (invoiceType === '適格') return 0
  const [y, m] = yearMonth.split('-').map(Number)
  const ym = y * 100 + m
  if (ym >= 202310 && ym <= 202609) return 0.2
  if (ym >= 202610 && ym <= 202909) return 0.5
  return 0
}

// ─── メインフロー ──────────────────────────────────────────────────────────

async function main() {
  const YEAR_MONTH = '2026-06'
  const TEST_DATES = ['2026-06-10', '2026-06-11', '2026-06-12']
  const EXPECTED_NET = 18000 * TEST_DATES.length // ¥54,000

  console.log('═══════════════════════════════════════════════════════')
  console.log('  日当制案件 実績→支払通知書 シミュレーションテスト')
  console.log('═══════════════════════════════════════════════════════\n')

  // ── Step 1: マスタ情報取得 ─────────────────────────────────────────────

  console.log('【Step 1】マスタ情報を取得...')

  const projects = await get('projects?project_code=eq.TEST-01&select=id,project_name,contractor_id,buy_amount&tenant_id=eq.local-dev')
  if (!projects || projects.length === 0) throw new Error('TEST-01 案件が見つかりません。テスト案件を先に生成してください。')
  const project = projects[0]

  const payeeRules = await get(`project_payees?project_id=eq.${project.id}&select=*`)
  if (!payeeRules || payeeRules.length === 0) throw new Error('TEST-01 の project_payees が見つかりません')
  const payeeRule = payeeRules[0]

  const contractors = await get(`contractors?id=eq.${payeeRule.contractor_id}&select=id,name,tax_category,invoice_registration_type,has_withholding,payment_site&tenant_id=eq.local-dev`)
  if (!contractors || contractors.length === 0) throw new Error('委託先が見つかりません')
  const contractor = contractors[0]

  console.log(`  ✅ 案件: ${project.project_name} (buy_amount: ¥${project.buy_amount.toLocaleString()})`)
  console.log(`  ✅ 委託先: ${contractor.name}`)
  console.log(`  ✅ payee.unit_price: ¥${payeeRule.unit_price?.toLocaleString() ?? 'なし'}, payment_type: ${payeeRule.payment_type}`)
  console.log(`  ✅ tax_category: ${contractor.tax_category}, invoice_type: ${contractor.invoice_registration_type}, withholding: ${contractor.has_withholding}\n`)

  // ── Step 2: テスト実績データの投入 ────────────────────────────────────

  console.log('【Step 2】実績データを投入（3日分: 2026-06-10〜12）...')

  const insertedIds = []
  for (const date of TEST_DATES) {
    const rec = await post('work_records', {
      contractor_id: contractor.id,
      project_id:    project.id,
      work_date:     date,
      tenant_id:     TENANT,
      status:        'confirmed',
      piece_count:   1,
    })
    const id = Array.isArray(rec) ? rec[0].id : rec.id
    insertedIds.push(id)
    console.log(`  ✅ INSERT work_records: ${date} (id: ${id})`)
  }
  console.log()

  // ── Step 3: 支払計算エンジン（generatePaymentNotice ロジック再現） ─────

  console.log('【Step 3】支払通知書計算エンジンを実行...')

  // 稼働記録取得（自身の当月分）
  const workData = await get(
    `work_records?contractor_id=eq.${contractor.id}&tenant_id=eq.${TENANT}` +
    `&work_date=gte.2026-06-01&work_date=lte.2026-06-30` +
    `&select=project_id,projects(price_rules(buying_price))`
  )

  // 案件別集計
  const projectAgg = new Map()
  for (const w of workData ?? []) {
    const pid = w.project_id
    if (!pid) continue
    const buying = Number(w.projects?.price_rules?.[0]?.buying_price ?? 0)
    const cur = projectAgg.get(pid) ?? { count: 0, buyingPriceSum: 0 }
    projectAgg.set(pid, { count: cur.count + 1, buyingPriceSum: cur.buyingPriceSum + buying })
  }

  // payeeRule ごとに計算（payment_type = 'per_unit'）
  let laborTaxExcluded = 0
  const coveredProjects = new Set()

  for (const rule of payeeRules) {
    if (rule.payment_type !== 'per_unit' || rule.unit_price === null) continue
    const workCount = projectAgg.get(rule.project_id)?.count ?? 0
    const net = (rule.unit_price ?? 0) * workCount
    laborTaxExcluded += net
    coveredProjects.add(rule.project_id)
  }

  // ルール未設定案件は buying_price 合算（後方互換）
  for (const [pid, agg] of projectAgg) {
    if (!coveredProjects.has(pid)) laborTaxExcluded += agg.buyingPriceSum
  }

  const laborTax      = calcTax(laborTaxExcluded, contractor.tax_category)
  const withholding   = contractor.has_withholding ? calcWithholding(laborTaxExcluded) : 0
  const deductionRate = calcDeductionRate(contractor.invoice_registration_type, YEAR_MONTH)
  const deduction     = Math.floor(laborTax * deductionRate)
  const totalAmount   = laborTaxExcluded + laborTax - deduction

  console.log()

  // ── Step 4: 結果出力 ──────────────────────────────────────────────────

  console.log('【Step 4】計算結果')
  console.log('┌─────────────────────────────────┬────────────────┐')
  console.log('│ 項目                             │ 金額           │')
  console.log('├─────────────────────────────────┼────────────────┤')
  console.log(`│ 単価                             │ ¥${String(payeeRule.unit_price?.toLocaleString()).padStart(13)} │`)
  console.log(`│ 稼働件数                         │ ${String(TEST_DATES.length + '件').padStart(14)} │`)
  console.log('├─────────────────────────────────┼────────────────┤')
  console.log(`│ 税抜基本額（単価×件数）          │ ¥${String(laborTaxExcluded.toLocaleString()).padStart(13)} │`)
  console.log(`│ 消費税額（${contractor.tax_category}）            │ ¥${String(laborTax.toLocaleString()).padStart(13)} │`)
  console.log(`│ 経過措置控除（${(deductionRate * 100).toFixed(0)}%）             │ ¥${String((-deduction).toLocaleString()).padStart(13)} │`)
  console.log(`│ 源泉徴収税                       │ ¥${String((-withholding).toLocaleString()).padStart(13)} │`)
  console.log('├─────────────────────────────────┼────────────────┤')
  console.log(`│ 支払合計                         │ ¥${String(totalAmount.toLocaleString()).padStart(13)} │`)
  console.log('└─────────────────────────────────┴────────────────┘')
  console.log()

  // ── Step 5: アサーション ──────────────────────────────────────────────

  console.log('【Step 5】検証アサーション')
  const pass = (label, actual, expected) => {
    const ok = actual === expected
    console.log(`  ${ok ? '✅' : '❌'} ${label}: ${actual.toLocaleString()} ${ok ? `=== ¥${expected.toLocaleString()} OK` : `!== 期待値 ¥${expected.toLocaleString()}`}`)
    if (!ok) throw new Error(`アサーション失敗: ${label}`)
  }
  pass('税抜基本額（¥18,000 × 3件）', laborTaxExcluded, EXPECTED_NET)
  console.log()

  // ── Step 6: テストデータクリーンアップ ───────────────────────────────

  console.log('【Step 6】テストデータをクリーンアップ...')
  for (const id of insertedIds) {
    await delete_(`work_records?id=eq.${id}`)
    console.log(`  🗑️  DELETE work_records: ${id}`)
  }

  // 残存件数確認
  const remaining = await get(
    `work_records?contractor_id=eq.${contractor.id}&project_id=eq.${project.id}&tenant_id=eq.${TENANT}&select=id`
  )
  console.log(`  残存件数: ${(remaining ?? []).length}件（0件であれば完全クリーン）`)
  console.log()
  console.log('═══════════════════════════════════════════════════════')
  console.log('  ✅ 全テスト PASS - コアフロー正常動作確認')
  console.log('═══════════════════════════════════════════════════════')
}

main().catch(err => {
  console.error('\n❌ テスト失敗:', err.message)
  process.exit(1)
})
