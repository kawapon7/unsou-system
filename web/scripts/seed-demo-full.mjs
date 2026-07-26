/**
 * seed-demo-full.mjs
 * HIBIKI 総合テスト用デモデータ一括投入スクリプト
 *
 * 設計書: docs/superpowers/specs/2026-07-26-demo-data-integration-test-design.md
 *
 * 投入内容:
 *   荷主 5 / 委託先 8 / 案件 10（単価方式4種）
 *   前月＝締め済み（承認済・ロック済の支払通知書あり）
 *   今月＝進行中（実績＋予定＋5大アラート発火状態）
 *
 * 識別印（削除時の唯一の対象条件）:
 *   会社名・案件名  : 【デモ】プレフィックス
 *   メールアドレス  : @demo.hibiki.local サフィックス
 *   案件コード      : DEMO-P0xx
 *   work_records    : metadata.demo = true
 *   expense_records : remarks が 【デモ】 で始まる
 *
 * ⚠️ approval_history は一切 INSERT しない。
 *    payment_notice_id の FK が ON DELETE RESTRICT かつ DELETE がトリガーで
 *    全ロール禁止のため、履歴を1件でも作ると対象の支払通知書が永久に削除できなくなる。
 *
 * ⚠️ 保護対象: kawapon7+driver@gmail.com に紐づく委託先（ボスのドライバー実アカウント）。
 *    このレコード自体は作成も削除も更新もしない。稼働データの割り当て先としてのみ使う。
 *
 * 実行: node web/scripts/seed-demo-full.mjs
 */

import { readFileSync } from 'fs'
import { resolve, dirname } from 'path'
import { fileURLToPath } from 'url'
import { createClient } from '@supabase/supabase-js'
import crypto from 'crypto'

// ── 環境変数読み込み ──────────────────────────────────────────────────────────

const __dirname = dirname(fileURLToPath(import.meta.url))
const env = Object.fromEntries(
  readFileSync(resolve(__dirname, '../.env.local'), 'utf8')
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
// ⚠️ ENCRYPTION_KEY は 32バイト固定。長さが違うと createCipheriv が実行時に throw する。
if (!ENCRYPTION_KEY || ENCRYPTION_KEY.length !== 32) {
  console.error(`❌ ENCRYPTION_KEY が不正 (現在 ${ENCRYPTION_KEY?.length ?? 0} 文字, 32文字必要)`)
  process.exit(1)
}

const db = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false } })

// ── 定数 ──────────────────────────────────────────────────────────────────────

const DEMO_PREFIX       = '【デモ】'
const DEMO_EMAIL_SUFFIX = '@demo.hibiki.local'
const DEMO_CODE_PREFIX  = 'DEMO-P'
const PROTECTED_EMAIL   = 'kawapon7+driver@gmail.com'

// ── 日付ユーティリティ ────────────────────────────────────────────────────────

const pad = n => String(n).padStart(2, '0')
const ymd = d => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`

const NOW        = new Date()
const TODAY      = ymd(NOW)
const THIS_MONTH = new Date(NOW.getFullYear(), NOW.getMonth(), 1)
const PREV_MONTH = new Date(NOW.getFullYear(), NOW.getMonth() - 1, 1)
const monthKey   = d => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-01`

/** その月の平日（月〜金）を Date 配列で返す */
function weekdaysOf(monthStart) {
  const out = []
  const d = new Date(monthStart)
  while (d.getMonth() === monthStart.getMonth()) {
    const dow = d.getDay()
    if (dow !== 0 && dow !== 6) out.push(new Date(d))
    d.setDate(d.getDate() + 1)
  }
  return out
}

/** n 日前の ISO 文字列（timestamptz 用） */
const daysAgoISO = n => new Date(Date.now() - n * 86400 * 1000).toISOString()

// ── AES-256-GCM 暗号化（utils/crypto.ts と同一形式: iv:authTag:ciphertext） ────

function encryptText(text) {
  const iv      = crypto.randomBytes(12)
  const cipher  = crypto.createCipheriv('aes-256-gcm', Buffer.from(ENCRYPTION_KEY), iv)
  let encrypted = cipher.update(text, 'utf8', 'hex')
  encrypted    += cipher.final('hex')
  return `${iv.toString('hex')}:${cipher.getAuthTag().toString('hex')}:${encrypted}`
}
const enc = text => (text ? encryptText(text) : null)

function abort(label, error) {
  console.error(`❌ ${label}:`, error?.message ?? error)
  process.exit(1)
}

// ── 再実行時のデモデータ掃除（印付きのみ・冪等性のため） ──────────────────────

async function cleanupDemo() {
  console.log('🧹 既存デモデータ（印付きのみ）を掃除中...')

  const { data: projects } = await db.from('projects').select('id')
    .eq('tenant_id', TENANT_ID).like('project_code', `${DEMO_CODE_PREFIX}%`)
  const projectIds = (projects ?? []).map(p => p.id)

  if (projectIds.length) {
    await db.from('work_records').delete().in('project_id', projectIds)
    await db.from('schedules').delete().in('project_id', projectIds)
    await db.from('driver_project_assignments').delete().in('project_id', projectIds)
    await db.from('price_rules').delete().in('project_id', projectIds)
    await db.from('project_payees').delete().in('project_id', projectIds)
  }
  await db.from('expense_records').delete().like('remarks', `${DEMO_PREFIX}%`)

  // 支払通知書: デモ委託先 × デモ対象月 のみ。承認履歴が付いたものは消せないので触れない。
  // ⚠️ 保護対象ドライバーにもデモの稼働データを割り当てているため、その支払通知書も掃除対象に含める。
  //    含めないと再実行時に UNIQUE(contractor_id, notice_month) で衝突する。
  //    消すのは支払通知書だけで、委託先レコード自体は残す。
  const { data: demoContractors } = await db.from('contractors').select('id')
    .like('email', `%${DEMO_EMAIL_SUFFIX}`)
  const { data: protectedRow } = await db.from('contractors').select('id')
    .eq('email', PROTECTED_EMAIL).maybeSingle()
  const cIds = [
    ...(demoContractors ?? []).map(c => c.id),
    ...(protectedRow ? [protectedRow.id] : []),
  ]
  if (cIds.length) {
    await db.from('payment_notices').delete()
      .in('contractor_id', cIds)
      .in('notice_month', [monthKey(PREV_MONTH), monthKey(THIS_MONTH)])
  }

  if (projectIds.length) await db.from('projects').delete().in('id', projectIds)
  await db.from('contractors').delete()
    .like('email', `%${DEMO_EMAIL_SUFFIX}`).neq('email', PROTECTED_EMAIL)
  await db.from('clients').delete()
    .eq('tenant_id', TENANT_ID).like('company_name', `${DEMO_PREFIX}%`)

  console.log('  ✅ 掃除完了\n')
}

// ── ① 荷主マスタ（5社） ───────────────────────────────────────────────────────

const CLIENT_DEFS = [
  // [社名, 担当, 締め日, 支払サイト, 税区分, インボイス登録, 銀行, 支店, 口座番号, 名義]
  ['株式会社ヤマト物産',         '山本 浩二', 31, 30, 'exclusive', true,  '三菱UFJ銀行', '新宿支店', '1234567', 'ヤマトブッサン'],
  ['関西流通センター株式会社',   '西村 康子', 20, 30, 'inclusive', true,  'りそな銀行',   '梅田支店', '2345678', 'カンサイリュウツウセンター'],
  ['九州農産物輸送',             '黒木 剛',   31, 30, 'exclusive', false, '福岡銀行',     '博多支店', '3456789', 'キュウシュウノウサンブツユソウ'],
  ['首都圏デリバリー株式会社',   '田村 誠',   31, 60, 'exclusive', true,  'みずほ銀行',   '渋谷支店', '4567890', 'シュトケンデリバリー'],
  ['スポット配送サービス合同会社','大野 亮',   20, 60, 'exclusive', true,  'PayPay銀行',   '本店',     '5678901', 'スポットハイソウサービス'],
]

async function seedClients() {
  console.log('📦 荷主マスタ 5件を投入中...')
  const ids = []
  for (const [i, [nm, contact, closing, site, tax, invoice, bank, branch, acct, holder]] of CLIENT_DEFS.entries()) {
    const row = {
      company_name:          `${DEMO_PREFIX}${nm}`,
      name:                  `${DEMO_PREFIX}${nm}`,
      contact_name:          contact,
      phone:                 `03-9000-${pad(i + 1)}00`,
      email:                 `client${i + 1}${DEMO_EMAIL_SUFFIX}`,
      closing_day:           closing,
      closing_day_int:       closing,
      payment_site:          site,
      tax_type:              tax,
      is_invoice_registered: invoice,
      invoice_registered:    invoice,
      has_invoice:           invoice,
      bank_name:             enc(bank),
      bank_branch:           enc(branch),
      // account_type は utils/crypto.ts の BANK_FIELD_KEYS に含まれない＝アプリ側で復号されない。
      // 暗号化すると画面に暗号文がそのまま出るため、平文で保存する。
      account_type:          '普通',
      account_number:        enc(acct),
      account_holder:        enc(holder),
      tenant_id:             TENANT_ID,
    }
    const { data, error } = await db.from('clients').insert(row).select('id').single()
    if (error) abort(`INSERT clients: ${nm}`, error)
    ids.push(data.id)
    console.log(`  ✅ ${DEMO_PREFIX}${nm}（${closing === 31 ? '末日' : closing + '日'}締め / ${site}日サイト / インボイス${invoice ? '登録済' : '未登録'}）`)
  }
  return ids
}

// ── ② 委託先マスタ（8名） ─────────────────────────────────────────────────────

const CONTRACTOR_DEFS = [
  // [氏名, 種別, インボイス, 多段階ON, 銀行, 支店, 口座番号, 名義]
  ['田中 一郎',   'corporation',     'registered',   false, '三井住友銀行', '池袋支店',     '2001001', 'タナカイチロウ'],
  ['佐藤 花子',   'sole_proprietor', 'registered',   false, 'ゆうちょ銀行', '〇一八支店',   '2002002', 'サトウハナコ'],
  ['高橋 美咲',   'sole_proprietor', 'registered',   false, 'りそな銀行',   '川崎支店',     '2003003', 'タカハシミサキ'],
  ['小林 誠司',   'sole_proprietor', 'registered',   true,  '三井住友銀行', '名古屋支店',   '2004004', 'コバヤシセイジ'],
  ['渡辺 健二',   'sole_proprietor', 'unregistered', false, 'みずほ銀行',   '千葉支店',     '2005005', 'ワタナベケンジ'],
  ['伊藤 さくら', 'sole_proprietor', 'unregistered', false, 'PayPay銀行',   '本店',         '2006006', 'イトウサクラ'],
  ['中村 勝',     'sole_proprietor', 'exempt',       false, '楽天銀行',     '第一営業支店', '2007007', 'ナカムラマサル'],
  ['吉田 まさお', 'sole_proprietor', 'exempt',       false, 'SBI新生銀行',  '本店',         '2008008', 'ヨシダマサオ'],
]

async function seedContractors() {
  console.log('\n👷 委託先マスタ 8件を投入中...')
  const ids = []
  for (const [i, [nm, type, invoice, multi, bank, branch, acct, holder]] of CONTRACTOR_DEFS.entries()) {
    const registered = invoice === 'registered'
    const row = {
      name:                      `${DEMO_PREFIX}${nm}`,
      phone:                     `090-9000-${pad(i + 1)}00`,
      email:                     `driver${i + 1}${DEMO_EMAIL_SUFFIX}`,
      contractor_type:           type,
      invoice_registration_type: invoice,
      invoice_status:            invoice,
      invoice_number:            registered ? `T99999999${pad(i + 1)}001` : null,
      payment_type:              'bank_transfer',
      payment_site:              30,
      tax_category:              'exclusive',
      has_withholding:           false,
      show_detail_switch:        multi,
      bank_name:                 enc(bank),
      bank_branch:               enc(branch),
      // account_type は暗号化しない（BANK_FIELD_KEYS 対象外・アプリ側で復号されないため）
      account_type:              '普通',
      account_number:            enc(acct),
      account_holder:            enc(holder),
      tenant_id:                 TENANT_ID,
    }
    const { data, error } = await db.from('contractors').insert(row).select('id').single()
    if (error) abort(`INSERT contractors: ${nm}`, error)
    ids.push(data.id)
    const label = { registered: 'インボイス登録済', unregistered: '未登録(経過措置80%控除)', exempt: '免税' }[invoice]
    console.log(`  ✅ ${DEMO_PREFIX}${nm}（${label}）${multi ? ' [多段階委託ON]' : ''}`)
  }

  // 多段階委託: 小林誠司(idx3) の親を田中一郎(idx0) に設定
  const { error: pe } = await db.from('contractors')
    .update({ parent_contractor_id: ids[0] }).eq('id', ids[3])
  if (pe) abort('UPDATE contractors: parent_contractor_id', pe)
  console.log(`  ✅ 多段階委託の親子関係: 小林 誠司 → 親=田中 一郎`)

  return ids
}

// ── 保護対象ドライバー（ボスの実アカウント）の contractor_id を取得 ───────────

async function findProtectedDriver() {
  const { data } = await db.from('contractors')
    .select('id, name').eq('email', PROTECTED_EMAIL).maybeSingle()
  if (!data) {
    console.warn(`  ⚠️ ${PROTECTED_EMAIL} に紐づく委託先が見つかりません。ドライバー画面用データはスキップします。`)
    return null
  }
  console.log(`\n🔒 保護対象ドライバー: ${data.name}（レコードは変更しません）`)
  return data.id
}

// ── ③ 案件マスタ（10件）＋ 単価ルール ────────────────────────────────────────

const PROJECT_DEFS = [
  // [荷主idx, 委託先idx, 案件名, 計算方式, 売単価, 買単価, 発地, 着地]
  [0, 0, '城南エリア定期ルート便',       'hourly', 2200,   1800,   '東京都', '東京都'],
  [0, 1, '城北エリア食品配送',           'piece',  260,    200,    '東京都', '埼玉県'],
  [1, 2, '関西幹線ルート',               'fixed',  320000, 260000, '大阪府', '兵庫県'],
  [1, 3, '大阪市内スポット便',           'hybrid', 280,    220,    '大阪府', '大阪府'],
  [2, 4, '九州農産物輸送A',              'piece',  210,    165,    '福岡県', '熊本県'],
  [2, 5, '九州農産物輸送B',              'piece',  230,    180,    '福岡県', '大分県'],
  [3, 6, '首都圏医療資材緊急配送',       'piece',  380,    300,    '東京都', '神奈川県'],
  [3, 3, '首都圏複合物流ルート（多段階）','fixed',  450000, 360000, '東京都', '千葉県'],
  [4, 7, '湾岸倉庫間シャトル輸送',       'piece',  190,    150,    '東京都', '東京都'],
  [4, 0, '早朝生鮮市場ピストン輸送',     'hourly', 2600,   2100,   '東京都', '東京都'],
]

async function seedProjects(clientIds, contractorIds) {
  console.log('\n📋 案件マスタ 10件＋単価ルールを投入中...')
  const projects = []

  for (const [i, [ci, xi, nm, calc, sell, buy, origin, dest]] of PROJECT_DEFS.entries()) {
    const code = `${DEMO_CODE_PREFIX}${pad(i + 1)}`
    const unitType = calc === 'fixed' ? 'fixed' : calc === 'hourly' ? 'hourly' : 'piece'

    const { data, error } = await db.from('projects').insert({
      project_code:        code,
      project_name:        `${DEMO_PREFIX}${nm}`,
      name:                `${DEMO_PREFIX}${nm}`,
      client_id:           clientIds[ci],
      contractor_id:       contractorIds[xi],
      unit_type:           unitType,
      status:              'accepted',
      sale_amount:         calc === 'fixed' ? sell : 0,
      buy_amount:          calc === 'fixed' ? buy  : 0,
      default_margin_rate: calc === 'hybrid' ? 20 : 10,
      origin, destination: dest,
      driver_visible:      true,
      tenant_id:           TENANT_ID,
    }).select('id').single()
    if (error) abort(`INSERT projects: ${code}`, error)

    const { error: re } = await db.from('price_rules').insert({
      project_id:       data.id,
      calculation_type: calc,
      selling_price:    sell,
      buying_price:     buy,
      sales_price:      sell,
      margin_rate:      calc === 'hybrid' ? 20 : 10,
      margin_fixed:     calc === 'hybrid' ? 5000 : 0,
    })
    if (re) abort(`INSERT price_rules: ${code}`, re)

    projects.push({ id: data.id, code, name: nm, calc, sell, buy, contractorIdx: xi })
    console.log(`  ✅ ${code} ${DEMO_PREFIX}${nm} [${calc}] 売¥${sell.toLocaleString()} / 買¥${buy.toLocaleString()}`)
  }

  // 多段階委託の支払先設定: DEMO-P08 に再委託先として佐藤花子(idx1) を追加
  const multiProject = projects[7]
  const { error: pe } = await db.from('project_payees').insert([
    {
      project_id: multiProject.id, contractor_id: contractorIds[3],
      payee_tier: 'primary', payment_type: 'fixed_monthly', unit_price: 360000,
      tax_method: 'exclusive', rounding_rule: 'round', adjustment_enabled: false, share_rate: 100,
    },
    {
      project_id: multiProject.id, contractor_id: contractorIds[1],
      payee_tier: 'sub', payment_type: 'per_unit', unit_price: 1800,
      work_source_contractor_id: contractorIds[3],
      tax_method: 'exclusive', rounding_rule: 'floor', adjustment_enabled: true, share_rate: 60,
    },
  ])
  if (pe) abort('INSERT project_payees: 多段階委託', pe)
  console.log(`  ✅ 多段階委託の支払先: ${multiProject.code} に primary=小林 誠司 / sub=佐藤 花子 を設定`)

  return projects
}

// ── ④ 稼働データ（前月＝締め済み / 今月＝進行中） ────────────────────────────

/**
 * 委託先ごとに担当案件を割り当て、平日を間引いて予定＋実績を作る。
 * ⚠️ schedules は UNIQUE(contractor_id, date)。同一委託先に同日2件を作ってはいけない。
 */
function buildAssignments(projects, contractorIds, driverContractorId) {
  const map = new Map()   // contractorId -> project[]
  for (const p of projects) {
    const cid = contractorIds[p.contractorIdx]
    if (!map.has(cid)) map.set(cid, [])
    map.get(cid).push(p)
  }
  // ボスのドライバーアカウントにも案件を割り当てる（ドライバー画面確認用）
  if (driverContractorId) {
    map.set(driverContractorId, [projects[0], projects[1], projects[6]])
  }
  return map
}

async function seedActivity(assignments, monthStart, { closed }) {
  const label = closed ? '前月（締め済み）' : '今月（進行中）'
  console.log(`\n📅 ${label} ${monthStart.getFullYear()}年${monthStart.getMonth() + 1}月の稼働データを投入中...`)

  const days = weekdaysOf(monthStart)
  const schedules = []
  const works = []

  let ci = 0
  for (const [contractorId, projs] of assignments) {
    // 委託先ごとに開始位置をずらし、3平日に1回稼働させる（月あたり約7日）
    for (let d = ci % 3; d < days.length; d += 3) {
      const day  = days[d]
      const date = ymd(day)
      const proj = projs[d % projs.length]

      // 今月は未来日に実績を作らない（予定のみ）
      const isFuture = !closed && date > TODAY

      schedules.push({
        contractor_id: contractorId,
        project_id:    proj.id,
        date,
        status:        isFuture ? 'scheduled' : 'completed',
        tenant_id:     TENANT_ID,
      })

      if (isFuture) continue

      const startDT = new Date(`${date}T08:00:00+09:00`).toISOString()
      const endDT   = new Date(`${date}T17:00:00+09:00`).toISOString()
      works.push({
        contractor_id: contractorId,
        project_id:    proj.id,
        work_date:     date,
        date,
        start_time:    proj.calc === 'hourly' ? startDT : null,
        end_time:      proj.calc === 'hourly' ? endDT   : null,
        break_minutes: proj.calc === 'hourly' ? 60 : 0,
        piece_count:   proj.calc === 'piece' || proj.calc === 'hybrid' ? 20 + ((d * 7) % 45) : 0,
        status:        closed ? 'approved' : 'pending',
        is_approved_by_master: closed,
        note:          `${DEMO_PREFIX}${proj.name}`,
        metadata:      { demo: true },
        tenant_id:     TENANT_ID,
      })
    }
    ci++
  }

  const { error: se } = await db.from('schedules').insert(schedules)
  if (se) abort(`INSERT schedules (${label})`, se)
  const { error: we } = await db.from('work_records').insert(works)
  if (we) abort(`INSERT work_records (${label})`, we)

  console.log(`  ✅ 予定 ${schedules.length} 件 / 実績 ${works.length} 件`)
  return { schedules, works }
}

// ── ⑤ 立替金・経費 ────────────────────────────────────────────────────────────

async function seedExpenses(assignments, monthStart, { closed }) {
  const days = weekdaysOf(monthStart).filter(d => ymd(d) <= TODAY || closed)
  if (!days.length) return 0

  const rows = []
  let i = 0
  for (const [contractorId] of assignments) {
    const day = days[(i * 4) % days.length]
    const date = ymd(day)
    const amount = [3200, 5800, 12000, 4500][i % 4]
    rows.push({
      contractor_id:       contractorId,
      expense_date:        date,
      date,
      category:            'tollway',
      expense_type:        'tollway',
      amount,
      amount_actual:       amount,
      amount_tax_excluded: Math.floor(amount / 1.1),
      tax_category:        'inclusive',
      status:              closed ? 'approved' : 'pending',
      approval_status:     closed ? 'approved' : 'pending',
      is_approved_by_master: closed,
      remarks:             `${DEMO_PREFIX}高速道路通行料`,
      note:                `${DEMO_PREFIX}高速道路通行料`,
      tenant_id:           TENANT_ID,
    })
    i++
  }
  const { error } = await db.from('expense_records').insert(rows)
  if (error) abort('INSERT expense_records', error)
  console.log(`  ✅ 立替金 ${rows.length} 件`)
  return rows.length
}

// ── ⑥ 前月の支払通知書（承認済み・ロック済み / 承認履歴は作らない） ──────────

async function seedPaymentNotices(assignments, works) {
  console.log('\n💴 前月の支払通知書（承認済・ロック済）を投入中...')

  // 委託先ごとに前月実績を集計
  const totals = new Map()
  for (const w of works) {
    const t = totals.get(w.contractor_id) ?? { days: 0, pieces: 0 }
    t.days   += 1
    t.pieces += w.piece_count ?? 0
    totals.set(w.contractor_id, t)
  }

  const rows = []
  for (const [contractorId] of assignments) {
    const t = totals.get(contractorId)
    if (!t) continue

    const laborNet  = t.days * 14400 + t.pieces * 180
    const laborTax  = Math.floor(laborNet * 0.1)
    const expNet    = 8000
    const expTax    = Math.floor(expNet * 0.1)
    const total     = laborNet + laborTax + expNet + expTax

    rows.push({
      contractor_id:          contractorId,
      notice_month:           monthKey(PREV_MONTH),
      target_month:           monthKey(PREV_MONTH),
      status:                 'locked',
      approval_status:        'approved',
      locked:                 true,
      locked_at:              daysAgoISO(5),
      labor_tax_excluded:     laborNet,
      labor_tax:              laborTax,
      deduction_rate:         0,
      deduction:              0,
      expense_tax_excluded:   expNet,
      expense_tax:            expTax,
      total_amount:           total,
      subtotal_registered:    laborNet,
      tax_registered:         laborTax,
      subtotal_unregistered:  0,
      tax_unregistered:       0,
      deduction_unregistered: 0,
      subtotal_exempt:        0,
      total_excluding_tax:    laborNet + expNet,
      total_tax:              laborTax + expTax,
      total_deduction:        0,
      created_at:             daysAgoISO(8),
      updated_at:             daysAgoISO(5),
    })
  }

  const { error } = await db.from('payment_notices').insert(rows)
  if (error) abort('INSERT payment_notices (前月)', error)
  console.log(`  ✅ ${rows.length} 件（approval_history は作成しない → 後で完全に削除できる）`)
  return rows.length
}

// ── ⑦ 5大アラートを「今日の画面で」発火させる ────────────────────────────────

async function seedAlerts(contractorIds, projects) {
  console.log('\n🚨 5大アラートの発火データを投入中...')

  const yesterday = ymd(new Date(Date.now() - 1 * 86400 * 1000))
  const twoDays   = ymd(new Date(Date.now() - 2 * 86400 * 1000))

  // ── ① 入力遅延: 予定はあるが実績が無い（過去日）
  //    UNIQUE(contractor_id, date) を避けるため、稼働割当の無い委託先を使う
  const lateContractor = contractorIds[6]
  const lateDates = [3, 4, 5].map(n => ymd(new Date(Date.now() - n * 86400 * 1000)))
  const lateRows = lateDates.map(date => ({
    contractor_id: lateContractor,
    project_id:    projects[8].id,
    date,
    status:        'scheduled',
    tenant_id:     TENANT_ID,
  }))
  // ⚠️ schedules は UNIQUE(contractor_id, date)。通常稼働と同日になる可能性があるため upsert で吸収する。
  const { error: e1 } = await db.from('schedules')
    .upsert(lateRows, { onConflict: 'contractor_id,date' })
  if (e1) abort('アラート① 入力遅延', e1)

  // 「予定はあるが実績が無い」を確実に成立させるため、同一委託先・同日の実績を消す。
  // 消すのはデモ印(metadata.demo=true)が付いた行のみ。
  const { error: e1b } = await db.from('work_records').delete()
    .eq('contractor_id', lateContractor)
    .in('work_date', lateDates)
    .contains('metadata', { demo: true })
  if (e1b) abort('アラート① 入力遅延（実績の除去）', e1b)
  console.log(`  ✅ ① 入力遅延: 予定あり/実績なし 3日分（${lateDates.join(', ')}）`)

  // ── ② 重複の疑い: 同日・同案件の work_records を2件
  const dupRows = [0, 1].map(() => ({
    contractor_id: contractorIds[1],
    project_id:    projects[1].id,
    work_date:     yesterday,
    date:          yesterday,
    piece_count:   30,
    status:        'pending',
    note:          `${DEMO_PREFIX}重複疑い検証`,
    metadata:      { demo: true },
    tenant_id:     TENANT_ID,
  }))
  const { error: e2 } = await db.from('work_records').insert(dupRows)
  if (e2) abort('アラート② 重複の疑い', e2)
  console.log(`  ✅ ② 重複の疑い: 同日同案件 2件（${yesterday}）`)

  // ── ③ 業務しきい値超過: piece_count = 101
  const { error: e3 } = await db.from('work_records').insert({
    contractor_id: contractorIds[5],
    project_id:    projects[4].id,
    work_date:     twoDays,
    date:          twoDays,
    piece_count:   101,
    status:        'pending_review',
    note:          `${DEMO_PREFIX}業務閾値超過検証`,
    metadata:      { demo: true },
    tenant_id:     TENANT_ID,
  })
  if (e3) abort('アラート③ 業務閾値超過', e3)
  console.log(`  ✅ ③ 業務閾値超過: piece_count=101（${twoDays}）`)

  // ── ④ 金額しきい値超過: 立替金 35,000円
  const { error: e4 } = await db.from('expense_records').insert({
    contractor_id:       contractorIds[7],
    expense_date:        yesterday,
    date:                yesterday,
    category:            'transport',
    expense_type:        'transport',
    amount:              35000,
    amount_actual:       35000,
    amount_tax_excluded: Math.floor(35000 / 1.1),
    tax_category:        'inclusive',
    status:              'pending_review',
    approval_status:     'pending',
    remarks:             `${DEMO_PREFIX}金額閾値超過検証`,
    note:                `${DEMO_PREFIX}金額閾値超過検証`,
    tenant_id:           TENANT_ID,
  })
  if (e4) abort('アラート④ 金額閾値超過', e4)
  console.log(`  ✅ ④ 金額閾値超過: 35,000円（${yesterday}）`)

  // ── ⑤ 長期未承認: 48時間以上前に作った未承認の支払通知書（今月分）
  const { error: e5 } = await db.from('payment_notices').insert({
    contractor_id:   contractorIds[4],
    notice_month:    monthKey(THIS_MONTH),
    target_month:    monthKey(THIS_MONTH),
    status:          'unapproved',
    approval_status: 'pending',
    locked:          false,
    labor_tax_excluded: 96000,
    labor_tax:          9600,
    deduction_rate:     2,
    deduction:          1920,
    expense_tax_excluded: 4000,
    expense_tax:          400,
    total_amount:         108080,
    subtotal_registered:   0,
    tax_registered:        0,
    subtotal_unregistered: 96000,
    tax_unregistered:      9600,
    deduction_unregistered: 1920,
    subtotal_exempt:       0,
    total_excluding_tax:   100000,
    total_tax:             10000,
    total_deduction:       1920,
    created_at:      daysAgoISO(4),
    updated_at:      daysAgoISO(4),
  })
  if (e5) abort('アラート⑤ 長期未承認', e5)
  console.log('  ✅ ⑤ 長期未承認: 4日前作成の未承認支払通知書（インボイス未登録・経過措置2%控除つき）')
}

// ── ⑧ ドライバー別案件フィルター ──────────────────────────────────────────────

async function seedDriverAssignments(driverContractorId, projects) {
  if (!driverContractorId) return
  const rows = [projects[0], projects[1], projects[6]].map(p => ({
    contractor_id: driverContractorId,
    project_id:    p.id,
    tenant_id:     TENANT_ID,
  }))
  const { error } = await db.from('driver_project_assignments').insert(rows)
  if (error) abort('INSERT driver_project_assignments', error)
  console.log(`\n🚚 ドライバー表示案件を ${rows.length} 件割り当て（ボスのドライバーアカウント用）`)
}

// ── メイン ────────────────────────────────────────────────────────────────────

async function main() {
  console.log('🌱 HIBIKI 総合テスト用デモデータ投入')
  console.log(`   DB       : ${SUPABASE_URL}`)
  console.log(`   テナント : ${TENANT_ID}`)
  console.log(`   今日     : ${TODAY}`)
  console.log(`   対象月   : ${monthKey(PREV_MONTH)}（締め済み） / ${monthKey(THIS_MONTH)}（進行中）`)
  console.log(`   暗号化   : AES-256-GCM\n`)

  await cleanupDemo()

  const clientIds     = await seedClients()
  const contractorIds = await seedContractors()
  const driverId      = await findProtectedDriver()
  const projects      = await seedProjects(clientIds, contractorIds)

  const assignments = buildAssignments(projects, contractorIds, driverId)

  const prev = await seedActivity(assignments, PREV_MONTH, { closed: true })
  await seedExpenses(assignments, PREV_MONTH, { closed: true })
  await seedPaymentNotices(assignments, prev.works)

  await seedActivity(assignments, THIS_MONTH, { closed: false })
  await seedExpenses(assignments, THIS_MONTH, { closed: false })

  await seedAlerts(contractorIds, projects)
  await seedDriverAssignments(driverId, projects)

  // ── 投入結果の実測（宣言ではなく DB から数え直す）
  const count = async (table, q) => {
    let query = db.from(table).select('*', { count: 'exact', head: true })
    query = q(query)
    const { count: n } = await query
    return n
  }
  const demoProjIds = projects.map(p => p.id)

  console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━')
  console.log('✅ デモデータ投入完了（DB実測値）')
  console.log(`   clients      : ${await count('clients',      q => q.like('company_name', `${DEMO_PREFIX}%`))} 件`)
  console.log(`   contractors  : ${await count('contractors',  q => q.like('email', `%${DEMO_EMAIL_SUFFIX}`))} 件`)
  console.log(`   projects     : ${await count('projects',     q => q.like('project_code', `${DEMO_CODE_PREFIX}%`))} 件`)
  console.log(`   schedules    : ${await count('schedules',    q => q.in('project_id', demoProjIds))} 件`)
  console.log(`   work_records : ${await count('work_records', q => q.in('project_id', demoProjIds))} 件`)
  console.log(`   expenses     : ${await count('expense_records', q => q.like('remarks', `${DEMO_PREFIX}%`))} 件`)
  console.log(`   支払通知書   : ${await count('payment_notices', q => q.in('notice_month', [monthKey(PREV_MONTH), monthKey(THIS_MONTH)]))} 件`)
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━')
  console.log('\n削除するとき: node web/scripts/clear-demo-data.mjs         （件数表示のみ）')
  console.log('              node web/scripts/clear-demo-data.mjs --execute （実際に削除）')
}

main().catch(e => { console.error('❌ 予期しないエラー:', e); process.exit(1) })
