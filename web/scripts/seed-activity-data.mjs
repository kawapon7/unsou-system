/**
 * seed-activity-data.mjs
 * 2026年6月1日〜15日の稼働実績・配車予定テストデータ一括投入
 *
 * 検証パターン:
 *   - 4大単価計算 (hourly/piece/fixed/hybrid)
 *   - インボイス未登録・経過措置2% (委託先5-7)
 *   - 多段階委託 (委託先8)
 *   - 業務しきい値: 個数120超(委託先9) / 立替金3万超(委託先10)
 *   - 5大アラート: 入力遅延 / 重複疑い
 *
 * 実行: node web/scripts/seed-activity-data.mjs
 */

import { readFileSync } from 'fs'
import { resolve, dirname } from 'path'
import { fileURLToPath } from 'url'
import { createClient } from '@supabase/supabase-js'

const __dirname = dirname(fileURLToPath(import.meta.url))
const envPath   = resolve(__dirname, '../.env.local')
const env = Object.fromEntries(
  readFileSync(envPath, 'utf8')
    .split('\n')
    .filter(l => l && !l.startsWith('#') && l.includes('='))
    .map(l => { const i = l.indexOf('='); return [l.slice(0, i), l.slice(i + 1)] }),
)

const db = createClient(
  env.NEXT_PUBLIC_SUPABASE_URL,
  env.SUPABASE_SERVICE_ROLE_KEY,
  { auth: { persistSession: false } },
)
const TENANT_ID = 'local-dev'
const TODAY = '2026-06-15'

// ── 日付ユーティリティ ────────────────────────────────────────────────────────

// 2026年6月の稼働日（月〜金）: 1,2,3,4,5,8,9,10,11,12,15=今日
const WEEKDAYS_ALL  = ['2026-06-01','2026-06-02','2026-06-03','2026-06-04','2026-06-05',
                       '2026-06-08','2026-06-09','2026-06-10','2026-06-11','2026-06-12',
                       '2026-06-15']
// 1〜14日の記録済み期間（今日=15日を除く）
const WEEKDAYS_PAST = WEEKDAYS_ALL.filter(d => d < TODAY)
// 全日程（1〜15日）
const ALL_DATES = Array.from({ length: 15 }, (_, i) => {
  const d = String(i + 1).padStart(2, '0')
  return `2026-06-${d}`
})
// 週末（土日）June 1-15
const WEEKENDS = ALL_DATES.filter(d => {
  const dow = new Date(d).getDay()   // 0=Sun, 6=Sat
  return dow === 0 || dow === 6
})

// 時刻 timestamptz 生成 (JST)
const ts = (date, hhmm) => `${date}T${hhmm}:00+09:00`

// ── マスタデータ取得 ──────────────────────────────────────────────────────────

async function loadMaster() {
  console.log('🔍 マスタデータ取得中...')

  // 委託先10人: email で取得（seed-test-data.mjs 準拠）
  const emails = [
    'tanaka@seed.hibiki.local',      // 0: 田中一郎 (hourly)
    'sato@seed.hibiki.local',        // 1: 佐藤花子 (piece)
    'suzuki@seed.hibiki.local',      // 2: 鈴木太郎 (fixed)
    'takahashi@seed.hibiki.local',   // 3: 高橋美咲 (hybrid)
    'watanabe@seed.hibiki.local',    // 4: 渡辺健二 (未登録)
    'ito@seed.hibiki.local',         // 5: 伊藤さくら (未登録)
    'nakamura@seed.hibiki.local',    // 6: 中村勝 (未登録)
    'kobayashi@seed.hibiki.local',   // 7: 小林誠司 (多段階)
    'kato@seed.hibiki.local',        // 8: 加藤りょう (しきい値・個数)
    'yoshida@seed.hibiki.local',     // 9: 吉田まさお (しきい値・立替)
  ]

  const contractors = []
  for (const email of emails) {
    const { data } = await db.from('contractors').select('id, name, invoice_registration_type')
      .eq('email', email).eq('tenant_id', TENANT_ID).maybeSingle()
    if (!data) { console.error(`❌ 委託先が見つかりません: ${email}`); process.exit(1) }
    contractors.push(data)
  }

  // 案件10件: project_code で取得
  const codes = ['SEED-P001','SEED-P002','SEED-P003','SEED-P004','SEED-P005',
                 'SEED-P006','SEED-P007','SEED-P008','SEED-P009','SEED-P010']
  const projects = []
  for (const code of codes) {
    const { data } = await db.from('projects').select('id, project_code, project_name')
      .eq('project_code', code).eq('tenant_id', TENANT_ID).maybeSingle()
    if (!data) { console.error(`❌ 案件が見つかりません: ${code}`); process.exit(1) }
    projects.push(data)
  }

  // 単価ルール取得
  const rules = []
  for (const proj of projects) {
    const { data } = await db.from('price_rules').select('calculation_type, selling_price, buying_price')
      .eq('project_id', proj.id).maybeSingle()
    rules.push(data)
  }

  console.log(`  委託先: ${contractors.map(c => c.name).join(', ')}`)
  console.log(`  案件  : ${projects.map(p => p.project_code).join(', ')}`)
  return { contractors, projects, rules }
}

// ── クリーンアップ（2026年6月1-15日の既存テストデータ） ─────────────────────

async function cleanup(contractors, projects) {
  console.log('\n🧹 既存 6月1-15日テストデータのクリーンアップ...')
  const contractorIds = contractors.map(c => c.id)

  // simulate-workflow.mjs が入れた June15 work_record もここでは削除しない
  // (simulate のものは 田中一郎のみ、このスクリプトは再実行を想定してすべて削除)
  const { count: wc } = await db.from('work_records')
    .delete()
    .in('contractor_id', contractorIds)
    .eq('tenant_id', TENANT_ID)
    .gte('work_date', '2026-06-01')
    .lte('work_date', '2026-06-15')
    .select('*', { count: 'exact', head: true })

  const { count: ec } = await db.from('expense_records')
    .delete()
    .in('contractor_id', contractorIds)
    .eq('tenant_id', TENANT_ID)
    .gte('expense_date', '2026-06-01')
    .lte('expense_date', '2026-06-15')
    .select('*', { count: 'exact', head: true })

  const { count: sc } = await db.from('schedules')
    .delete()
    .in('contractor_id', contractorIds)
    .eq('tenant_id', TENANT_ID)
    .gte('date', '2026-06-01')
    .lte('date', '2026-06-15')
    .select('*', { count: 'exact', head: true })

  // 実際の削除数は Supabase の .delete() では count が返らないため件数は参考値
  console.log('  クリーンアップ完了（schedules / work_records / expense_records）')
}

// ── 配車予定（schedules）一括投入 ────────────────────────────────────────────

async function seedSchedules(contractors, projects) {
  console.log('\n📅 配車予定（schedules）投入中...')
  const rows = []

  // 全委託先：平日=scheduled, 週末=absent でスケジュール投入
  for (let xi = 0; xi < contractors.length; xi++) {
    const c = contractors[xi]
    const p = projects[xi]   // 委託先ixに対応する案件（SEED-P001〜P010）

    for (const date of ALL_DATES) {
      const dow = new Date(date).getDay()
      const isWeekend = (dow === 0 || dow === 6)
      rows.push({
        contractor_id: c.id,
        project_id:    p.id,
        date,
        status:        isWeekend ? 'absent' : 'scheduled',
        tenant_id:     TENANT_ID,
      })
    }
  }

  // バッチ INSERT
  const BATCH = 50
  let total = 0
  for (let i = 0; i < rows.length; i += BATCH) {
    const { error } = await db.from('schedules').insert(rows.slice(i, i + BATCH))
    if (error) { console.error('schedules INSERT エラー:', error.message); process.exit(1) }
    total += Math.min(BATCH, rows.length - i)
  }
  console.log(`  ✅ schedules: ${total} 件投入（平日=scheduled・週末=absent）`)
  return total
}

// ── 勤務実績（work_records）投入 ─────────────────────────────────────────────

async function seedWorkRecords(contractors, projects, rules) {
  console.log('\n📝 勤務実績（work_records）投入中...')
  const rows = []
  let dupRows = []   // 重複アラート用

  for (let xi = 0; xi < contractors.length; xi++) {
    const c = contractors[xi]
    const p = projects[xi]
    const r = rules[xi]
    const calcType = r?.calculation_type ?? 'piece'

    // ── 委託先1 (田中一郎・hourly): June 1-14 稼働日
    if (xi === 0) {
      for (const date of WEEKDAYS_PAST) {
        // 8時間勤務 60分休憩 → 実働7h
        rows.push({
          contractor_id:        c.id, project_id: p.id,
          work_date: date, date,
          start_time: ts(date, '08:00'), end_time: ts(date, '17:00'),
          break_minutes: 60, piece_count: 0,
          status: 'approved', is_approved_by_master: true,
          note: '時給制: 城南エリア宅配（シード）',
          metadata: { seed: true, hours: 7, calc_type: 'hourly' },
          tenant_id: TENANT_ID,
        })
      }
      // June 15 は simulate-workflow.mjs で登録済みのため省略（アラートなし）
    }

    // ── 委託先2 (佐藤花子・piece): June 1-14 稼働日
    else if (xi === 1) {
      for (const date of WEEKDAYS_PAST) {
        // 30〜50個をランダム風（日付の日数で決定）
        const dayNum  = parseInt(date.slice(-2), 10)
        const pieces  = 30 + (dayNum % 3) * 10   // 30 or 40 or 50
        rows.push({
          contractor_id:        c.id, project_id: p.id,
          work_date: date, date,
          start_time: ts(date, '09:00'), end_time: ts(date, '18:00'),
          break_minutes: 60, piece_count: pieces,
          status: 'approved', is_approved_by_master: true,
          note: `個数制: ${pieces}個（シード）`,
          metadata: { seed: true, pieces, calc_type: 'piece' },
          tenant_id: TENANT_ID,
        })
      }
      // ★ 重複アラート: June 5 に同じプロジェクトで2件挿入
      dupRows = [
        {
          contractor_id: c.id, project_id: p.id,
          work_date: '2026-06-05', date: '2026-06-05',
          start_time: ts('2026-06-05', '09:00'), end_time: ts('2026-06-05', '17:00'),
          break_minutes: 60, piece_count: 40,
          status: 'pending',   // わざと pending のままにして重複検知アラートを発生させる
          is_approved_by_master: false,
          note: '★重複アラートテスト: 1件目',
          metadata: { seed: true, duplicate_test: true, seq: 1 },
          tenant_id: TENANT_ID,
        },
        {
          contractor_id: c.id, project_id: p.id,
          work_date: '2026-06-05', date: '2026-06-05',
          start_time: ts('2026-06-05', '10:00'), end_time: ts('2026-06-05', '18:00'),
          break_minutes: 60, piece_count: 35,
          status: 'pending',
          is_approved_by_master: false,
          note: '★重複アラートテスト: 2件目（同一日・同一案件）',
          metadata: { seed: true, duplicate_test: true, seq: 2 },
          tenant_id: TENANT_ID,
        },
      ]
      // June 15: scheduled あり・work_records なし → 入力遅延アラート発生
    }

    // ── 委託先3 (鈴木太郎・fixed): June 1-14 平日
    else if (xi === 2) {
      for (const date of WEEKDAYS_PAST) {
        rows.push({
          contractor_id:        c.id, project_id: p.id,
          work_date: date, date,
          start_time: ts(date, '08:30'), end_time: ts(date, '17:30'),
          break_minutes: 60, piece_count: 0,
          status: 'approved', is_approved_by_master: true,
          note: '固定制: 関西幹線ルート（シード）',
          metadata: { seed: true, calc_type: 'fixed' },
          tenant_id: TENANT_ID,
        })
      }
      // June 15: 入力遅延アラート発生（work_record なし）
    }

    // ── 委託先4 (高橋美咲・hybrid): June 1-14 平日
    else if (xi === 3) {
      for (const date of WEEKDAYS_PAST) {
        const dayNum = parseInt(date.slice(-2), 10)
        const pieces = 15 + (dayNum % 4) * 5   // 15,20,25,30
        rows.push({
          contractor_id:        c.id, project_id: p.id,
          work_date: date, date,
          start_time: ts(date, '08:00'), end_time: ts(date, '17:00'),
          break_minutes: 60, piece_count: pieces,
          status: 'approved', is_approved_by_master: true,
          note: `混合制: 固定日当+${pieces}個歩合（シード）`,
          metadata: { seed: true, pieces, calc_type: 'hybrid' },
          tenant_id: TENANT_ID,
        })
      }
    }

    // ── 委託先5〜7 (経過措置): 通常稼働（委託先5=xi4, 6=xi5, 7=xi6）
    else if (xi >= 4 && xi <= 6) {
      const piecesBase = [25, 30, 20][xi - 4]
      for (const date of WEEKDAYS_PAST) {
        rows.push({
          contractor_id:        c.id, project_id: p.id,
          work_date: date, date,
          start_time: ts(date, '08:00'), end_time: ts(date, '17:00'),
          break_minutes: 60, piece_count: piecesBase,
          status: 'approved', is_approved_by_master: true,
          note: `免税経過措置: ${c.name}（シード）`,
          metadata: { seed: true, invoice_type: 'unregistered', deduction_rate: 0.02 },
          tenant_id: TENANT_ID,
        })
      }
    }

    // ── 委託先8 (小林誠司・多段階委託)
    else if (xi === 7) {
      for (const date of WEEKDAYS_PAST) {
        rows.push({
          contractor_id:        c.id, project_id: p.id,
          work_date: date, date,
          start_time: ts(date, '08:00'), end_time: ts(date, '17:00'),
          break_minutes: 60, piece_count: 0,
          status: 'approved', is_approved_by_master: true,
          note: '多段階委託: 再委託先への支払代行（シード）',
          metadata: { seed: true, multi_level: true, share_rate: 80 },
          tenant_id: TENANT_ID,
        })
      }
    }

    // ── 委託先9 (加藤りょう・しきい値・個数超過)
    else if (xi === 8) {
      for (const date of WEEKDAYS_PAST) {
        const dayNum = parseInt(date.slice(-2), 10)
        // June 10 に個数 120超（アラート対象）
        const isThresholdDay = date === '2026-06-10'
        const pieces = isThresholdDay ? 120 : 35
        rows.push({
          contractor_id:        c.id, project_id: p.id,
          work_date: date, date,
          start_time: ts(date, '08:00'), end_time: ts(date, '17:00'),
          break_minutes: 60, piece_count: pieces,
          // しきい値超過日は pending_review で未承認のままにしてアラート表示
          status:               isThresholdDay ? 'pending_review' : 'approved',
          is_approved_by_master: !isThresholdDay,
          note:                 isThresholdDay
            ? `★業務しきい値超過: 個数${pieces}個（100超）→ 要確認`
            : `個数制: ${pieces}個（シード）`,
          metadata: { seed: true, threshold_test: isThresholdDay, pieces },
          tenant_id: TENANT_ID,
        })
      }
    }

    // ── 委託先10 (吉田まさお・しきい値・立替金超過)
    else if (xi === 9) {
      for (const date of WEEKDAYS_PAST) {
        rows.push({
          contractor_id:        c.id, project_id: p.id,
          work_date: date, date,
          start_time: ts(date, '08:00'), end_time: ts(date, '17:00'),
          break_minutes: 60, piece_count: 30,
          status: 'approved', is_approved_by_master: true,
          note: '個数制（シード）',
          metadata: { seed: true },
          tenant_id: TENANT_ID,
        })
      }
    }
  }

  // 通常 work_records INSERT
  const BATCH = 50
  let total = 0
  for (let i = 0; i < rows.length; i += BATCH) {
    const { error } = await db.from('work_records').insert(rows.slice(i, i + BATCH))
    if (error) { console.error('work_records INSERT エラー:', error.message); process.exit(1) }
    total += Math.min(BATCH, rows.length - i)
  }

  // ★ 重複アラート用 2件を追加 INSERT（佐藤花子 June 5）
  if (dupRows.length > 0) {
    const { error } = await db.from('work_records').insert(dupRows)
    if (error) { console.error('重複テスト INSERT エラー:', error.message); process.exit(1) }
    total += dupRows.length
    console.log(`  ⚠️ 重複アラートテスト: 佐藤花子 2026-06-05 に ${dupRows.length} 件挿入（同一日・同一案件）`)
  }

  console.log(`  ✅ work_records: ${total} 件投入`)
  return total
}

// ── 立替金・経費（expense_records）投入 ──────────────────────────────────────

async function seedExpenses(contractors, projects) {
  console.log('\n💴 立替金・経費（expense_records）投入中...')
  const rows = []

  // 委託先1 (田中一郎): 高速代を週2回（June 2, 4, 9, 11）
  const c0 = contractors[0]
  for (const date of ['2026-06-02','2026-06-04','2026-06-09','2026-06-11']) {
    const amt = 1200
    rows.push({
      contractor_id:       c0.id,
      expense_date:        date, date,
      expense_type:        'tollway',
      category:            'tollway',
      amount_actual:       amt,
      amount_tax_excluded: Math.round(amt / 1.1),
      amount:              amt,
      tax_category:        'taxable_10',
      approval_status:     'approved',
      status:              'approved',
      is_approved_by_master: true,
      note:                '高速代（東名・シード）',
      metadata:            { seed: true },
      tenant_id:           TENANT_ID,
    })
  }

  // 委託先3 (鈴木太郎): ガソリン代（June 3, 10）
  const c2 = contractors[2]
  for (const date of ['2026-06-03','2026-06-10']) {
    const amt = 5000
    rows.push({
      contractor_id:       c2.id,
      expense_date:        date, date,
      expense_type:        'fuel',
      category:            'fuel',
      amount_actual:       amt,
      amount_tax_excluded: Math.round(amt / 1.1),
      amount:              amt,
      tax_category:        'taxable_10',
      approval_status:     'approved',
      status:              'approved',
      is_approved_by_master: true,
      note:                'ガソリン代（シード）',
      metadata:            { seed: true },
      tenant_id:           TENANT_ID,
    })
  }

  // ★ 委託先10 (吉田まさお): 業務しきい値（立替金 ¥35,000 超過）June 12
  const c9 = contractors[9]
  {
    const amt = 35000
    rows.push({
      contractor_id:       c9.id,
      expense_date:        '2026-06-12', date: '2026-06-12',
      expense_type:        'vehicle_repair',
      category:            'vehicle_repair',
      amount_actual:       amt,
      amount_tax_excluded: Math.round(amt / 1.1),
      amount:              amt,
      tax_category:        'taxable_10',
      approval_status:     'pending',           // 未承認のまま
      status:              'pending_review',    // しきい値超過ステータス
      is_approved_by_master: false,
      note:                `★業務しきい値超過: 立替金¥${amt.toLocaleString()}（3万超）→ 要確認`,
      metadata:            { seed: true, threshold_test: true, amount: amt },
      tenant_id:           TENANT_ID,
    })
    console.log(`  ⚠️ 業務しきい値テスト: 吉田まさお 立替金¥${amt.toLocaleString()} (June 12) → status=pending_review`)
  }

  // その他委託先: 小林誠司（多段階）の燃料代（June 5, 12）
  const c7 = contractors[7]
  for (const date of ['2026-06-05','2026-06-12']) {
    const amt = 3500
    rows.push({
      contractor_id:       c7.id,
      expense_date:        date, date,
      expense_type:        'fuel',
      category:            'fuel',
      amount_actual:       amt,
      amount_tax_excluded: Math.round(amt / 1.1),
      amount:              amt,
      tax_category:        'taxable_10',
      approval_status:     'approved',
      status:              'approved',
      is_approved_by_master: true,
      note:                '燃料代（多段階委託・シード）',
      metadata:            { seed: true, multi_level: true },
      tenant_id:           TENANT_ID,
    })
  }

  const { error } = await db.from('expense_records').insert(rows)
  if (error) { console.error('expense_records INSERT エラー:', error.message); process.exit(1) }

  console.log(`  ✅ expense_records: ${rows.length} 件投入`)
  return rows.length
}

// ── 投入後サマリー確認 ────────────────────────────────────────────────────────

async function verify(contractors) {
  console.log('\n🔎 投入後サマリー確認...')
  const ids = contractors.map(c => c.id)

  const { count: sc } = await db.from('schedules').select('*', { count: 'exact', head: true })
    .in('contractor_id', ids).eq('tenant_id', TENANT_ID)
    .gte('date', '2026-06-01').lte('date', '2026-06-15')

  const { count: wc } = await db.from('work_records').select('*', { count: 'exact', head: true })
    .in('contractor_id', ids).eq('tenant_id', TENANT_ID)
    .gte('work_date', '2026-06-01').lte('work_date', '2026-06-15')

  const { count: ec } = await db.from('expense_records').select('*', { count: 'exact', head: true })
    .in('contractor_id', ids).eq('tenant_id', TENANT_ID)
    .gte('expense_date', '2026-06-01').lte('expense_date', '2026-06-15')

  // 重複確認 (同一 contractor_id + work_date + project_id で複数件)
  const { data: dupCheck } = await db.from('work_records')
    .select('contractor_id, work_date, project_id')
    .in('contractor_id', ids).eq('tenant_id', TENANT_ID)
    .gte('work_date', '2026-06-01').lte('work_date', '2026-06-15')

  const dupMap = {}
  for (const row of dupCheck ?? []) {
    const key = `${row.contractor_id}:${row.work_date}:${row.project_id}`
    dupMap[key] = (dupMap[key] ?? 0) + 1
  }
  const dupCount = Object.values(dupMap).filter(v => v > 1).length

  // 個数しきい値超過確認
  const { count: threshPiece } = await db.from('work_records')
    .select('*', { count: 'exact', head: true })
    .in('contractor_id', ids).eq('tenant_id', TENANT_ID).eq('status', 'pending_review')

  // 立替金しきい値超過確認
  const { count: threshExp } = await db.from('expense_records')
    .select('*', { count: 'exact', head: true })
    .in('contractor_id', ids).eq('tenant_id', TENANT_ID).eq('status', 'pending_review')

  // 入力遅延アラート候補 (今日 scheduled で work_record なし)
  const { data: todaySchedules } = await db.from('schedules').select('contractor_id')
    .in('contractor_id', ids).eq('tenant_id', TENANT_ID)
    .eq('date', TODAY).eq('status', 'scheduled')

  let missingCount = 0
  for (const s of todaySchedules ?? []) {
    const { count } = await db.from('work_records').select('*', { count: 'exact', head: true })
      .eq('contractor_id', s.contractor_id).eq('work_date', TODAY).eq('tenant_id', TENANT_ID)
    if (!count || count === 0) missingCount++
  }

  console.log(`\n  📊 DB確認`)
  console.log(`    schedules     : ${sc ?? 0} 件`)
  console.log(`    work_records  : ${wc ?? 0} 件`)
  console.log(`    expense_records: ${ec ?? 0} 件`)
  console.log(`\n  🚨 アラート発生予定`)
  console.log(`    入力遅延 (${TODAY} scheduled・実績なし): ${missingCount} 件`)
  console.log(`    重複疑い (同日同案件 2件以上):            ${dupCount} 件`)
  console.log(`    業務しきい値・個数超過 (pending_review): ${threshPiece ?? 0} 件`)
  console.log(`    業務しきい値・立替金超過 (pending_review): ${threshExp ?? 0} 件`)

  return { sc, wc, ec, missingCount, dupCount, threshPiece, threshExp }
}

// ── メイン ────────────────────────────────────────────────────────────────────

async function main() {
  console.log('🌱 HIBIKI 稼働実績テストデータ投入スクリプト（2026年6月1〜15日）')
  console.log(`   DB URL: ${env.NEXT_PUBLIC_SUPABASE_URL}`)

  const { contractors, projects, rules } = await loadMaster()
  await cleanup(contractors, projects)

  const sCnt = await seedSchedules(contractors, projects)
  const wCnt = await seedWorkRecords(contractors, projects, rules)
  const eCnt = await seedExpenses(contractors, projects)
  const stats = await verify(contractors)

  console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━')
  console.log('✅ 稼働実績テストデータ投入完了')
  console.log(`   schedules      : ${stats.sc ?? sCnt} 件`)
  console.log(`   work_records   : ${stats.wc ?? wCnt} 件（4大単価・異常値・重複混入済）`)
  console.log(`   expense_records: ${stats.ec ?? eCnt} 件`)
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━')
}

main().catch(e => { console.error('❌ 予期しないエラー:', e); process.exit(1) })
