/**
 * seed-test-data.mjs
 * 検証用テストデータ一括投入スクリプト
 *
 * 対象テーブル: clients(5), contractors(10), projects(10), price_rules(10)
 * 口座情報は AES-256-GCM (crypto.ts 準拠) で暗号化して保存
 * テストデータは company_name prefix '【テスト】' / email suffix '@seed.hibiki.local' で識別
 *
 * 実行方法:
 *   node web/scripts/seed-test-data.mjs
 */

import { readFileSync } from 'fs'
import { resolve, dirname } from 'path'
import { fileURLToPath } from 'url'
import { createClient } from '@supabase/supabase-js'
import crypto from 'crypto'

// ── 環境変数読み込み ──────────────────────────────────────────────────────────

const __dirname = dirname(fileURLToPath(import.meta.url))
const envPath   = resolve(__dirname, '../.env.local')
const env = Object.fromEntries(
  readFileSync(envPath, 'utf8')
    .split('\n')
    .filter(l => l && !l.startsWith('#') && l.includes('='))
    .map(l => { const i = l.indexOf('='); return [l.slice(0, i), l.slice(i + 1)] }),
)

const SUPABASE_URL   = env.NEXT_PUBLIC_SUPABASE_URL
const SERVICE_KEY    = env.SUPABASE_SERVICE_ROLE_KEY
const ENCRYPTION_KEY = env.ENCRYPTION_KEY
const TENANT_ID      = 'local-dev'

if (!SUPABASE_URL || !SERVICE_KEY) {
  console.error('❌ NEXT_PUBLIC_SUPABASE_URL または SUPABASE_SERVICE_ROLE_KEY が未設定')
  process.exit(1)
}
if (!ENCRYPTION_KEY || ENCRYPTION_KEY.length !== 32) {
  console.error(`❌ ENCRYPTION_KEY が不正 (現在 ${ENCRYPTION_KEY?.length ?? 0} 文字, 32文字必要)`)
  process.exit(1)
}

const db = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false } })

// ── AES-256-GCM 暗号化 (crypto.ts と同一ロジック: iv:authTag:ciphertext) ──────

function encryptText(text) {
  const iv      = crypto.randomBytes(12)
  const cipher  = crypto.createCipheriv('aes-256-gcm', Buffer.from(ENCRYPTION_KEY), iv)
  let encrypted = cipher.update(text, 'utf8', 'hex')
  encrypted    += cipher.final('hex')
  const authTag = cipher.getAuthTag().toString('hex')
  return `${iv.toString('hex')}:${authTag}:${encrypted}`
}

// null/空文字はそのまま返す
const enc = (text) => text ? encryptText(text) : null

function abort(label, error) {
  console.error(`❌ ${label}:`, error.message ?? error)
  process.exit(1)
}

// ── クリーンアップ ────────────────────────────────────────────────────────────

async function cleanup() {
  console.log('🧹 既存テストデータのクリーンアップ中...')

  // projects（SEED-P*）→ price_rules と project_payees は CASCADE
  const { data: seedProjects } = await db
    .from('projects')
    .select('id')
    .eq('tenant_id', TENANT_ID)
    .like('project_code', 'SEED-%')
  if (seedProjects?.length) {
    const ids = seedProjects.map(p => p.id)
    await db.from('price_rules').delete().in('project_id', ids)
    await db.from('project_payees').delete().in('project_id', ids)
    await db.from('projects').delete().in('id', ids)
    console.log(`  projects/price_rules/payees: ${ids.length} 件削除`)
  }

  // contractors（email が @seed.hibiki.local）
  const { data: seedContractors } = await db
    .from('contractors')
    .select('id')
    .eq('tenant_id', TENANT_ID)
    .like('email', '%@seed.hibiki.local')
  if (seedContractors?.length) {
    const ids = seedContractors.map(c => c.id)
    await db.from('contractors').delete().in('id', ids)
    console.log(`  contractors: ${ids.length} 件削除`)
  }

  // clients（company_name が 【テスト】 で始まる）
  const { data: seedClients } = await db
    .from('clients')
    .select('id')
    .eq('tenant_id', TENANT_ID)
    .like('company_name', '【テスト】%')
  if (seedClients?.length) {
    const ids = seedClients.map(c => c.id)
    await db.from('clients').delete().in('id', ids)
    console.log(`  clients: ${ids.length} 件削除`)
  }
}

// ── ① 荷主マスタ（5社） ───────────────────────────────────────────────────────
// 実DBカラム: closing_day(integer), is_invoice_registered(bool), has_invoice(bool),
//             tax_type(text), payment_site(int), bank_*(enc)

async function seedClients() {
  console.log('\n📦 荷主マスタ（clients）5件を投入中...')

  const rows = [
    {
      // 荷主1: インボイスあり・月末締め(31)・翌月末払い(30)・外税
      company_name:         '【テスト】株式会社ヤマト物産',
      contact_name:         '山本 浩二',
      phone:                '03-1234-5001',
      email:                'yamato@seed.test',
      closing_day:          31,
      closing_day_int:      31,
      payment_site:         30,
      tax_type:             'exclusive',
      is_invoice_registered: true,
      invoice_registered:   true,
      has_invoice:          true,
      bank_name:            enc('三菱UFJ銀行'),
      bank_branch:          enc('新宿支店'),
      account_type:         enc('普通'),
      account_number:       enc('1234567'),
      account_holder:       enc('ヤマトブッサン'),
      tenant_id:            TENANT_ID,
    },
    {
      // 荷主2: インボイスあり・20日締め・翌月末払い(30)・内税
      company_name:         '【テスト】関西流通センター株式会社',
      contact_name:         '西村 康子',
      phone:                '06-2345-5002',
      email:                'kansai@seed.test',
      closing_day:          20,
      closing_day_int:      20,
      payment_site:         30,
      tax_type:             'inclusive',
      is_invoice_registered: true,
      invoice_registered:   true,
      has_invoice:          true,
      bank_name:            enc('りそな銀行'),
      bank_branch:          enc('梅田支店'),
      account_type:         enc('普通'),
      account_number:       enc('2345678'),
      account_holder:       enc('カンサイリュウツウセンター'),
      tenant_id:            TENANT_ID,
    },
    {
      // 荷主3: インボイスなし（免税）・月末締め・翌月末払い(30)・外税
      company_name:         '【テスト】九州農産物輸送',
      contact_name:         '黒木 剛',
      phone:                '092-3456-5003',
      email:                'kyushu@seed.test',
      closing_day:          31,
      closing_day_int:      31,
      payment_site:         30,
      tax_type:             'exclusive',
      is_invoice_registered: false,
      invoice_registered:   false,
      has_invoice:          false,
      bank_name:            enc('福岡銀行'),
      bank_branch:          enc('博多支店'),
      account_type:         enc('普通'),
      account_number:       enc('3456789'),
      account_holder:       enc('キュウシュウノウサンブツユソウ'),
      tenant_id:            TENANT_ID,
    },
    {
      // 荷主4: インボイスあり・月末締め・翌々月末払い(60)・非課税
      company_name:         '【テスト】首都圏デリバリー株式会社',
      contact_name:         '田村 誠',
      phone:                '03-4567-5004',
      email:                'shutoken@seed.test',
      closing_day:          31,
      closing_day_int:      31,
      payment_site:         60,
      tax_type:             'tax_exempt',
      is_invoice_registered: true,
      invoice_registered:   true,
      has_invoice:          true,
      bank_name:            enc('みずほ銀行'),
      bank_branch:          enc('渋谷支店'),
      account_type:         enc('普通'),
      account_number:       enc('4567890'),
      account_holder:       enc('シュトケンデリバリー'),
      tenant_id:            TENANT_ID,
    },
    {
      // 荷主5: スポット案件用・都度締め(0)・都度払い(0)・外税
      company_name:         '【テスト】スポット配送サービス合同会社',
      contact_name:         '大野 亮',
      phone:                '03-5678-5005',
      email:                'spot@seed.test',
      closing_day:          0,
      closing_day_int:      0,
      payment_site:         0,
      tax_type:             'exclusive',
      is_invoice_registered: true,
      invoice_registered:   true,
      has_invoice:          true,
      bank_name:            enc('PayPay銀行'),
      bank_branch:          enc('本店'),
      account_type:         enc('普通'),
      account_number:       enc('5678901'),
      account_holder:       enc('スポットハイソウサービス'),
      tenant_id:            TENANT_ID,
    },
  ]

  const ids = []
  for (const row of rows) {
    const { data: ex } = await db.from('clients').select('id')
      .eq('company_name', row.company_name).eq('tenant_id', TENANT_ID).maybeSingle()
    if (ex) {
      console.log(`  ✓ スキップ (既存): ${row.company_name}`)
      ids.push(ex.id); continue
    }
    const { data, error } = await db.from('clients').insert(row).select('id').single()
    if (error) abort(`INSERT clients: ${row.company_name}`, error)
    ids.push(data.id)
    console.log(`  ✅ 登録: ${row.company_name}`)
  }
  return ids
}

// ── ② 委託先マスタ（10人） ────────────────────────────────────────────────────
// 実DBカラム: name, phone, email, payment_type, payment_site, tax_category,
//             invoice_registration_type, invoice_number, contractor_type,
//             show_detail_switch, has_withholding, invoice_status, bank_*(enc), tenant_id

async function seedContractors() {
  console.log('\n👷 委託先マスタ（contractors）10件を投入中...')

  const base = {
    payment_type:  'bank_transfer',
    payment_site:  30,
    tax_category:  'exclusive',
    has_withholding: false,
    show_detail_switch: false,
    tenant_id: TENANT_ID,
  }

  const rows = [
    {
      ...base,
      // 委託先1: インボイス登録あり・法人（時給制対応）
      name:                     '田中 一郎',
      phone:                    '090-1001-0001',
      email:                    'tanaka@seed.hibiki.local',
      contractor_type:          'corporation',
      invoice_registration_type:'registered',
      invoice_number:           'T1234567890101',
      invoice_status:           'registered',
      bank_name:                enc('三井住友銀行'),
      bank_branch:              enc('池袋支店'),
      account_type:             enc('普通'),
      account_number:           enc('1001001'),
      account_holder:           enc('タナカイチロウ'),
    },
    {
      ...base,
      // 委託先2: インボイス登録あり・個人事業主（個数制対応）
      name:                     '佐藤 花子',
      phone:                    '090-1002-0002',
      email:                    'sato@seed.hibiki.local',
      contractor_type:          'sole_proprietor',
      invoice_registration_type:'registered',
      invoice_number:           'T1234567890102',
      invoice_status:           'registered',
      bank_name:                enc('ゆうちょ銀行'),
      bank_branch:              enc('〇一八支店'),
      account_type:             enc('普通'),
      account_number:           enc('1002002'),
      account_holder:           enc('サトウハナコ'),
    },
    {
      ...base,
      // 委託先3: インボイス登録あり・個人事業主（固定制対応）
      name:                     '鈴木 太郎',
      phone:                    '090-1003-0003',
      email:                    'suzuki@seed.hibiki.local',
      contractor_type:          'sole_proprietor',
      invoice_registration_type:'registered',
      invoice_number:           'T1234567890103',
      invoice_status:           'registered',
      bank_name:                enc('三菱UFJ銀行'),
      bank_branch:              enc('横浜支店'),
      account_type:             enc('普通'),
      account_number:           enc('1003003'),
      account_holder:           enc('スズキタロウ'),
    },
    {
      ...base,
      // 委託先4: インボイス登録あり・個人事業主（混合制対応）
      name:                     '高橋 美咲',
      phone:                    '090-1004-0004',
      email:                    'takahashi@seed.hibiki.local',
      contractor_type:          'sole_proprietor',
      invoice_registration_type:'registered',
      invoice_number:           'T1234567890104',
      invoice_status:           'registered',
      bank_name:                enc('りそな銀行'),
      bank_branch:              enc('川崎支店'),
      account_type:             enc('普通'),
      account_number:           enc('1004004'),
      account_holder:           enc('タカハシミサキ'),
    },
    {
      ...base,
      // 委託先5: インボイス未登録・経過措置対象（控除80%・差し引き率2%）
      name:                     '渡辺 健二',
      phone:                    '090-1005-0005',
      email:                    'watanabe@seed.hibiki.local',
      contractor_type:          'sole_proprietor',
      invoice_registration_type:'unregistered',
      invoice_number:           null,
      invoice_status:           'unregistered',
      bank_name:                enc('みずほ銀行'),
      bank_branch:              enc('千葉支店'),
      account_type:             enc('普通'),
      account_number:           enc('1005005'),
      account_holder:           enc('ワタナベケンジ'),
    },
    {
      ...base,
      // 委託先6: インボイス未登録・経過措置対象
      name:                     '伊藤 さくら',
      phone:                    '090-1006-0006',
      email:                    'ito@seed.hibiki.local',
      contractor_type:          'sole_proprietor',
      invoice_registration_type:'unregistered',
      invoice_number:           null,
      invoice_status:           'unregistered',
      bank_name:                enc('PayPay銀行'),
      bank_branch:              enc('本店'),
      account_type:             enc('普通'),
      account_number:           enc('1006006'),
      account_holder:           enc('イトウサクラ'),
    },
    {
      ...base,
      // 委託先7: インボイス未登録・経過措置対象
      name:                     '中村 勝',
      phone:                    '090-1007-0007',
      email:                    'nakamura@seed.hibiki.local',
      contractor_type:          'sole_proprietor',
      invoice_registration_type:'unregistered',
      invoice_number:           null,
      invoice_status:           'unregistered',
      bank_name:                enc('楽天銀行'),
      bank_branch:              enc('第一営業支店'),
      account_type:             enc('普通'),
      account_number:           enc('1007007'),
      account_holder:           enc('ナカムラマサル'),
    },
    {
      ...base,
      // 委託先8: 多段階委託（show_detail_switch=true）
      name:                     '小林 誠司',
      phone:                    '090-1008-0008',
      email:                    'kobayashi@seed.hibiki.local',
      contractor_type:          'sole_proprietor',
      invoice_registration_type:'registered',
      invoice_number:           'T1234567890108',
      invoice_status:           'registered',
      show_detail_switch:       true,
      bank_name:                enc('三井住友銀行'),
      bank_branch:              enc('名古屋支店'),
      account_type:             enc('普通'),
      account_number:           enc('1008008'),
      account_holder:           enc('コバヤシセイジ'),
    },
    {
      ...base,
      // 委託先9: 業務しきい値検証用（個数100超テスト）
      name:                     '加藤 りょう',
      phone:                    '090-1009-0009',
      email:                    'kato@seed.hibiki.local',
      contractor_type:          'sole_proprietor',
      invoice_registration_type:'unregistered',
      invoice_number:           null,
      invoice_status:           'unregistered',
      bank_name:                enc('auじぶん銀行'),
      bank_branch:              enc('本店'),
      account_type:             enc('普通'),
      account_number:           enc('1009009'),
      account_holder:           enc('カトウリョウ'),
    },
    {
      ...base,
      // 委託先10: 業務しきい値検証用（立替金3万超テスト）
      name:                     '吉田 まさお',
      phone:                    '090-1010-0010',
      email:                    'yoshida@seed.hibiki.local',
      contractor_type:          'sole_proprietor',
      invoice_registration_type:'unregistered',
      invoice_number:           null,
      invoice_status:           'unregistered',
      bank_name:                enc('SBI新生銀行'),
      bank_branch:              enc('本店'),
      account_type:             enc('普通'),
      account_number:           enc('1010010'),
      account_holder:           enc('ヨシダマサオ'),
    },
  ]

  const ids = []
  for (const row of rows) {
    const { data: ex } = await db.from('contractors').select('id')
      .eq('email', row.email).eq('tenant_id', TENANT_ID).maybeSingle()
    if (ex) {
      console.log(`  ✓ スキップ (既存): ${row.name}`)
      ids.push(ex.id); continue
    }
    const { data, error } = await db.from('contractors').insert(row).select('id').single()
    if (error) abort(`INSERT contractors: ${row.name}`, error)
    ids.push(data.id)
    const label = row.invoice_registration_type === 'registered' ? 'インボイス登録済' : '未登録(経過措置)'
    console.log(`  ✅ 登録: ${row.name} (${label})${row.show_detail_switch ? ' [多段階委託ON]' : ''}`)
  }
  return ids
}

// ── ③ 案件マスタ（10件）＋ price_rules ───────────────────────────────────────
// projects実DBカラム: client_id, project_name, name, project_code, contractor_id,
//                     origin, destination, sale_amount, buy_amount, status,
//                     unit_type, default_margin_rate, tenant_id
// price_rules実DBカラム: project_id, calculation_type, selling_price, buying_price,
//                         sales_price, margin_rate, margin_fixed

async function seedProjectsAndRules(clientIds, contractorIds) {
  console.log('\n📋 案件マスタ（projects）＋ 単価ルール（price_rules）を投入中...')

  // [ci=荷主idx, xi=委託先idx, code, name, calcType, sellPrice, buyPrice, note]
  const defs = [
    [0, 0, 'SEED-P001', '城南エリア宅配便（時給制）',      'hourly',    1500, 1200],
    [0, 1, 'SEED-P002', '城北エリア食品配送（個数制）',    'piece',   200,  160],
    [1, 2, 'SEED-P003', '関西幹線ルート（固定月額）',      'fixed',   180000,150000],
    [1, 3, 'SEED-P004', '大阪市内スポット便（混合制）',    'hybrid',      250,  200],
    [2, 4, 'SEED-P005', '九州農産物輸送A（経過措置）',     'piece',   180,  140],
    [2, 5, 'SEED-P006', '九州農産物輸送B（経過措置）',     'piece',   190,  150],
    [3, 6, 'SEED-P007', '首都圏医療物資輸送（非課税）',    'piece',   300,  240],
    [3, 7, 'SEED-P008', '首都圏複合物流ルート（多段階）',  'fixed',   250000,200000],
    [4, 8, 'SEED-P009', 'スポット便A（個数100超テスト）',  'piece',   150,  120],
    [4, 9, 'SEED-P010', 'スポット便B（立替3万超テスト）',  'piece',   160,  130],
  ]

  let projectCount = 0
  let ruleCount    = 0
  const projectIds = []

  for (const [ci, xi, code, pname, calcType, sellPrice, buyPrice] of defs) {
    const clientId     = clientIds[ci]
    const contractorId = contractorIds[xi]
    const unitType     = calcType === 'fixed' ? 'fixed' : calcType === 'hourly' ? 'hourly' : 'piece'

    const { data: ex } = await db.from('projects').select('id')
      .eq('project_code', code).eq('tenant_id', TENANT_ID).maybeSingle()

    let projectId
    if (ex) {
      console.log(`  ✓ スキップ (既存): ${code} ${pname}`)
      projectId = ex.id
    } else {
      const { data, error } = await db.from('projects').insert({
        project_code:      code,
        project_name:      pname,
        name:              pname,
        client_id:         clientId,
        contractor_id:     contractorId,
        unit_type:         unitType,
        status:            'accepted',
        sale_amount:       calcType === 'fixed' ? sellPrice : 0,
        buy_amount:        calcType === 'fixed' ? buyPrice  : 0,
        default_margin_rate: calcType === 'mixed' ? 20 : 10,
        origin:            '東京都',
        destination:       ci <= 1 ? '東京都' : ci === 2 ? '福岡県' : '東京都',
        tenant_id:         TENANT_ID,
      }).select('id').single()
      if (error) abort(`INSERT projects: ${code}`, error)
      projectId = data.id
      projectCount++
      console.log(`  ✅ 案件: ${code} ${pname} [${calcType}]`)
    }
    projectIds.push(projectId)

    // price_rules
    const { data: exRule } = await db.from('price_rules').select('id')
      .eq('project_id', projectId).maybeSingle()
    if (!exRule) {
      const { error: re } = await db.from('price_rules').insert({
        project_id:       projectId,
        calculation_type: calcType,
        selling_price:    sellPrice,
        buying_price:     buyPrice,
        sales_price:      sellPrice,
        margin_rate:      calcType === 'mixed' ? 20 : 10,
        margin_fixed:     calcType === 'mixed' ? 5000 : 0,
      })
      if (re) abort(`INSERT price_rules: ${code}`, re)
      ruleCount++
      console.log(`     ✅ 単価ルール: 売¥${sellPrice} 買¥${buyPrice} [${calcType}]`)
    } else {
      console.log(`     ✓ price_rule スキップ (既存): ${code}`)
    }

    // 多段階委託: SEED-P008（小林誠司）に佐藤花子を再委託先として登録
    if (code === 'SEED-P008') {
      const { data: exPayee } = await db.from('project_payees').select('id')
        .eq('project_id', projectId).maybeSingle()
      if (!exPayee) {
        const { error: pe } = await db.from('project_payees').insert({
          project_id:   projectId,
          contractor_id: contractorIds[1],  // 佐藤花子（再委託先）
          share_rate:   80,                 // 80% 分配
        })
        if (pe) abort('INSERT project_payees: SEED-P008', pe)
        console.log(`     ✅ 多段階委託: 佐藤花子へ share_rate=80%`)
      }
    }
  }

  return { projectCount, ruleCount, projectIds }
}

// ── メイン ────────────────────────────────────────────────────────────────────

async function main() {
  console.log('🌱 HIBIKI 検証用テストデータ投入スクリプト')
  console.log(`   テナント : ${TENANT_ID}`)
  console.log(`   DB URL   : ${SUPABASE_URL}`)
  console.log(`   暗号化   : AES-256-GCM (キー長 ${ENCRYPTION_KEY.length} 文字)\n`)

  await cleanup()
  const clientIds     = await seedClients()
  const contractorIds = await seedContractors()
  const { projectCount, ruleCount } = await seedProjectsAndRules(clientIds, contractorIds)

  // DB確認カウント
  const { count: cCnt } = await db.from('clients').select('*', { count: 'exact', head: true })
    .like('company_name', '【テスト】%').eq('tenant_id', TENANT_ID)
  const { count: xCnt } = await db.from('contractors').select('*', { count: 'exact', head: true })
    .like('email', '%@seed.hibiki.local').eq('tenant_id', TENANT_ID)
  const { count: pCnt } = await db.from('projects').select('*', { count: 'exact', head: true })
    .like('project_code', 'SEED-%').eq('tenant_id', TENANT_ID)
  const seedProjIds = (await db.from('projects').select('id').like('project_code', 'SEED-%').eq('tenant_id', TENANT_ID)).data?.map(p => p.id) ?? []
  const { count: rCnt } = await db.from('price_rules').select('*', { count: 'exact', head: true })
    .in('project_id', seedProjIds.length ? seedProjIds : ['00000000-0000-0000-0000-000000000000'])

  console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━')
  console.log('✅ 検証用テストデータ投入完了')
  console.log(`   clients     (荷主マスタ)  : ${cCnt} 件`)
  console.log(`   contractors (委託先マスタ): ${xCnt} 件`)
  console.log(`   projects    (案件マスタ)  : ${pCnt} 件`)
  console.log(`   price_rules (単価ルール)  : ${rCnt} 件`)
  console.log(`   口座情報暗号化            : AES-256-GCM 適用済み (iv:authTag:ciphertext)`)
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━')
}

main().catch(e => { console.error('❌ 予期しないエラー:', e); process.exit(1) })
