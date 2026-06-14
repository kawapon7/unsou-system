import { createClient } from '@supabase/supabase-js'
import { readFileSync } from 'fs'
import { resolve } from 'path'

// .env.local を手動ロード（コマンドライン環境変数が既に設定されている場合は上書きしない）
try {
  const content = readFileSync(resolve(process.cwd(), '.env.local'), 'utf8')
  for (const line of content.split('\n')) {
    const t = line.trim()
    if (!t || t.startsWith('#')) continue
    const idx = t.indexOf('=')
    if (idx === -1) continue
    const key = t.slice(0, idx).trim()
    if (!process.env[key]) process.env[key] = t.slice(idx + 1).trim()
  }
} catch {}

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL ?? ''
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY ?? ''

if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
  console.error('❌ 環境変数（URLまたはSERVICE_ROLE_KEY）が不足しています。')
  process.exit(1)
}

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false },
})

// billing/actions.ts の集計関数をインポート（'use server' は Node.js では無害）
import { fetchBillingByClient, fetchPaymentByContractor } from '../app/admin/billing/actions'

async function runTest() {
  console.log('🚀 結合動作確認（導通テスト）を開始します（源泉徴収：凍結仕様）...')

  try {
    // 1. テスト用荷主（clients）
    const { data: client, error: clientErr } = await supabase
      .from('clients')
      .insert([{
        company_name: 'テスト荷主（シミュレーション）',
        closing_day:  '31',
        payment_site: 30,
        tax_type:     'exclusive',
      }])
      .select()
      .single()
    if (clientErr) throw clientErr
    console.log(`✅ 荷主作成完了: ${client.id}`)

    // 2. テスト用委託先（contractors）
    const { data: contractor, error: contractorErr } = await supabase
      .from('contractors')
      .insert([{
        name:            'テスト子分（源泉なし・インボイスあり）',
        email:           `test-contractor-${Date.now()}@test.internal`,
        tax_category:    'exclusive',
        payment_type:    'bank_transfer',
        payment_site:    30,
        invoice_registration_type: 'registered',
        has_withholding: false,
        invoice_number:  'T1234567890123',
      }])
      .select()
      .single()
    if (contractorErr) throw contractorErr
    console.log(`✅ 委託先作成完了: ${contractor.id}`)

    // 3. 案件（projects）
    // status カラムの存在確認（extend_projects migration 適用済み確認）
    const { data: projectCols } = await supabase.from('projects').select('status').limit(0)
    const statusColExists = projectCols !== null
    if (!statusColExists) {
      console.warn('⚠️ projects.status カラムが存在しません。')
      console.warn('   以下のマイグレーションを Supabase Dashboard > SQL Editor で実行してください:')
      console.warn('   supabase/migrations/20260607000003_add_projects_extend_columns.sql')
    }

    const projectInsert: Record<string, unknown> = {
      project_code: `TEST-${Date.now()}`,
      project_name: '城南エリア定期便（テスト）',
      client_id:    client.id,
    }
    if (statusColExists) projectInsert.status = 'dispatched'

    const { data: project, error: projectErr } = await supabase
      .from('projects')
      .insert([projectInsert])
      .select()
      .single()
    if (projectErr) throw projectErr
    const statusVal = (project as any).status
    console.log(`✅ 案件作成完了: ${project.id}  status=${statusVal ?? '(カラム未存在)'}`)
    if (statusColExists && statusVal !== 'dispatched') {
      console.warn(`⚠️ status 値が期待値 "dispatched" と一致しません: "${statusVal}"`)
    } else if (statusColExists) {
      console.log('✅ status カラム正常: "dispatched" が保存・取得できました')
    }

    // 3-a. 単価ルール（price_rules）
    const { error: priceErr } = await supabase
      .from('price_rules')
      .insert([{
        project_id:       project.id,
        selling_price:    50000,
        buying_price:     40000,
        calculation_type: 'fixed',
      }])
    if (priceErr) console.warn(`⚠️ price_rules 挿入エラー: ${priceErr.message}`)
    else console.log('✅ 単価ルール（売50,000 / 買40,000）作成完了')

    // 3-b. 案件支払先（project_payees）
    const { error: payeeErr } = await supabase
      .from('project_payees')
      .insert([{
        project_id:          project.id,
        payee_contractor_id: contractor.id,
      }])
    if (payeeErr) console.warn(`⚠️ project_payees 挿入エラー: ${payeeErr.message}`)
    else console.log('✅ 案件支払先紐付け完了')

    // 4. 稼働実績（work_records）2件
    const { error: workErr } = await supabase
      .from('work_records')
      .insert([
        { project_id: project.id, contractor_id: contractor.id, work_date: '2026-06-01' },
        { project_id: project.id, contractor_id: contractor.id, work_date: '2026-06-15' },
      ])
    if (workErr) throw workErr
    console.log('✅ work_records（2件）作成完了')

    // 5. 集計アクション実行
    console.log('\n📊 fetchBillingByClient("2026-06") 実行中...')
    const billingResult = await fetchBillingByClient('2026-06')
    console.log('--- 荷主向け請求集計 ---')
    console.dir(billingResult, { depth: null })

    console.log('\n📊 fetchPaymentByContractor("2026-06") 実行中...')
    const paymentResult = await fetchPaymentByContractor('2026-06')
    console.log('--- 委託先向け支払集計 ---')
    console.dir(paymentResult, { depth: null })

    console.log('\n💡 確認ポイント: 売価・買価が集計され、源泉徴収税が 0 であること')

    // 6. テストデータを削除（FK制約に従い子→親の順で削除）
    await supabase.from('work_records').delete().eq('project_id', project.id)
    await supabase.from('project_payees').delete().eq('project_id', project.id)
    await supabase.from('price_rules').delete().eq('project_id', project.id)
    await supabase.from('projects').delete().eq('id', project.id)
    await supabase.from('clients').delete().eq('id', client.id)
    await supabase.from('contractors').delete().eq('id', contractor.id)
    console.log('\n🧹 テストデータをすべて削除しました')
  } catch (err) {
    console.error('❌ テスト実行中にエラーが発生しました:', err)
    process.exit(1)
  }
}

runTest()
