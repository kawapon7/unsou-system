'use server'

import { createClient } from '@/utils/supabase/server'
import { createServiceClient } from '@/utils/supabase/service'
import { getCurrentTenantId } from '@/utils/tenant'
import {
  resolveContractorId as sharedResolveContractorId,
  type ContractorLookupClient,
} from '@/utils/auth'
import { computePaymentNoticeAmounts } from '@/utils/payment-notice-calc'
import { closingRange } from '@/utils/closing-period'
import { getDeductionRate } from '@/utils/transitional-deduction'
import { parseAlertKey, isDriverFacing, buildDriverNotice } from '@/utils/driver-notice'
import { isQualifiedInvoiceIssuer } from '@/utils/invoice-registration'
import {
  describeWorkAmount,
  buildPriceRuleMap,
  WORK_RECORD_AMOUNT_COLUMNS,
  PRICE_RULE_COLUMNS,
  type PriceRuleRecord,
  type RawWorkRecord,
} from '@/utils/work-amount'
import {
  summarizeAnnual,
  availableYearsOf,
  type PaymentHistoryRow,
  type AnnualSummary,
} from '@/utils/driver-summary'

type ActionResult<T = void> =
  | { data: T; error: null }
  | { data: null; error: string }

/**
 * ⚠️ 生成SDKの型は列の増減に追従していないため、DB呼び出しは緩い型で扱う。
 *    any をこの1箇所に閉じ込め、各所に散らさないこと。
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type LooseDb = any
const looseDb = (): LooseDb => createServiceClient()

/** 素の行（列の型は呼び出し側で絞る） */
type Row = Record<string, unknown>

// dev bypass 用テスト委託先ID（鈴木次郎・免税）
const DEV_CONTRACTOR_ID = 'cc31ee16-660a-42db-acb4-05f148a3fce8'

// ── ログイン中の子分に紐づく contractor_id を取得 ─────────

// ⚠️ 解決ロジックの正本は utils/auth.ts の resolveContractorId。
//    ここは userId から users 行を引いて正本に渡すだけの薄いラッパー。
//    独自実装に戻さないこと（同じ解決が3箇所に散っていたのが 2026-08-17 の不具合の温床）。
async function resolveContractorId(userId: string, userEmail: string | undefined): Promise<string | null> {
  const service = createServiceClient()

  const { data: userRow } = await service
    .from('users')
    .select('contractor_id')
    .eq('id', userId)
    .maybeSingle()

  return sharedResolveContractorId(
    service as unknown as ContractorLookupClient,
    userRow?.contractor_id,
    userEmail ?? null,
  )
}

// ── 支払通知書一覧取得（自分のものだけ） ─────────────────

export type MyPaymentNotice = {
  id:             string
  noticeMonth:    string   // 'YYYY-MM-DD' (月初日)
  laborNet:       number
  laborTax:       number
  expenseNet:     number
  expenseTax:     number
  deductionRate:  number
  deduction:      number
  totalAmount:    number
  approvalStatus: string   // 'unapproved' | 'approved' | 'locked'
  locked:         boolean
}

export async function fetchMyPaymentNotices(): Promise<ActionResult<MyPaymentNotice[]>> {
  let contractorId: string | null

  if (process.env.ALLOW_DEV_AUTH_BYPASS === 'true') {
    contractorId = DEV_CONTRACTOR_ID
  } else {
    const supabase = await createClient()
    const { data: { user }, error: authErr } = await supabase.auth.getUser()
    if (authErr || !user) return { data: null, error: '未ログインです' }
    contractorId = await resolveContractorId(user.id, user.email ?? undefined)
    if (!contractorId) return { data: null, error: '委託先レコードが見つかりません' }
  }

  const db = looseDb()

  const { data, error } = await db
    .from('payment_notices')
    .select(
      'id, notice_month, subtotal_registered, tax_registered, subtotal_unregistered, tax_unregistered, deduction_unregistered, subtotal_exempt, total_excluding_tax, total_tax, total_deduction, approval_status',
    )
    .eq('contractor_id', contractorId)
    // ⚠️ limit を付けないこと。確定申告・税務調査で過去を遡る必要があり、
    //    直近12件で切ると古い年が見えなくなる（1人あたり月1行なので件数は問題にならない）。
    .order('notice_month', { ascending: false })

  if (error) return { data: null, error: error.message }

  const rows: MyPaymentNotice[] = (data ?? []).map((r: Row) => {
    const laborNet  = Number(r.subtotal_registered ?? 0) + Number(r.subtotal_unregistered ?? 0) + Number(r.subtotal_exempt ?? 0)
    const laborTax  = Number(r.tax_registered ?? 0) + Number(r.tax_unregistered ?? 0)
    const totalEx   = Number(r.total_excluding_tax ?? 0)
    const totalTax  = Number(r.total_tax ?? 0)
    const deduction = Number(r.total_deduction ?? 0)
    // ⚠️ 率を deduction / laborTax から逆算しないこと。それは「消費税額に対する割合」で、
    //    2% の月でも 22% と表示されてしまう（ドライバーには「22%も引かれた」と読める）。
    //    制度上の率＝**税込額に対する差し引き率**なので、PDF と同じく正本から対象月の率を引く。
    //    同型の誤りは 2026-08-02 に PDF 側で修正済み（HANDOVER §5-4）。
    const [ny, nm] = String(r.notice_month ?? '').split('-').map(Number)
    const deductionRate = (ny && nm)
      ? getDeductionRate(new Date(ny, nm, 0), false)
      : 0

    return {
      id:             r.id,
      noticeMonth:    r.notice_month,
      laborNet,
      laborTax,
      expenseNet:     Math.max(0, totalEx  - laborNet),
      expenseTax:     Math.max(0, totalTax - laborTax),
      deductionRate,
      deduction,
      totalAmount:    totalEx + totalTax - deduction,
      approvalStatus: r.approval_status ?? 'unapproved', // デフォルトは未承認状態
      locked:         r.approval_status === 'approved',
    }
  })

  return { data: rows, error: null }
}

// ── 支払通知書の承認 ─────────────────────────────────────

/**
 * 子分が自分の支払通知書に合意・承認する。
 * - contractor_id の一致を確認（他人の notice を承認不可）
 * - status を 'locked' に更新（承認確定）
 * - approval_history に監査ログを INSERT（ベストエフォート）
 */
export async function approvePaymentNotice(noticeId: string): Promise<ActionResult> {
  let contractorId: string | null
  let userId: string

  if (process.env.ALLOW_DEV_AUTH_BYPASS === 'true') {
    contractorId = DEV_CONTRACTOR_ID
    userId = '00000000-0000-0000-0000-000000000000'  // dev dummy user ID
  } else {
    const supabase = await createClient()
    const { data: { user }, error: authErr } = await supabase.auth.getUser()
    if (authErr || !user) return { data: null, error: '未ログインです' }
    contractorId = await resolveContractorId(user.id, user.email ?? undefined)
    if (!contractorId) return { data: null, error: '委託先レコードが見つかりません' }
    userId = user.id
  }

  const db = looseDb()

  // 所有権バリデーション（自分の notice だけ操作可能）
  const { data: notice, error: fetchErr } = await db
    .from('payment_notices')
    .select('id, contractor_id, status, approval_status')
    .eq('id', noticeId)
    .eq('contractor_id', contractorId)
    .single()

  if (fetchErr || !notice) {
    return { data: null, error: '対象の支払通知書が見つかりません' }
  }
  // ⚠️ status='locked' で弾かない。親分の代理承認（approved_by_proxy）や
  //    未応答での確定（no_response）でも locked になるため、それだと本人が
  //    あとから承認できなくなる。本人承認は代理承認より強い証跡なので、
  //    approved 以外からの格上げは常に認める（2026-08-02）。
  if (notice.approval_status === 'approved') {
    return { data: null, error: 'すでに承認済みです' }
  }

  // ⚠️ fail-closed で例外を投げ得るため、更新前に解決しておく
  //    （更新後に投げると「承認は済んだのにエラー表示」になる）
  const tenantId = await getCurrentTenantId()

  // driver 承認確定: 正本は approval_status + locked。
  // ⚠️ status は廃止予定の派生値（読む側は無い）。列 DROP（Phase 3）まで同期を続ける。
  const { error: updateErr } = await db
    .from('payment_notices')
    .update({
      status:          'locked',
      approval_status: 'approved',
      locked:          true,
      // ⚠️ locked_at は上書きしない。代理承認や未応答確定で既に立っている
      //    「最初に確定した時刻」を消してしまうため（監査証跡の後退）。
      //    本人がいつ承認したかは approval_history 側の記録で追う。
    })
    .eq('id', noticeId)
    .eq('contractor_id', contractorId)

  if (updateErr) return { data: null, error: updateErr.message }

  // 監査ログ（ベストエフォート: 失敗しても承認自体は成功扱い）
  // ⚠️ F0で tenant_id の DEFAULT を撤去したため、明示的に渡さないと NOT NULL 違反になる
  await db
    .from('approval_history')
    .insert({
      tenant_id:         tenantId,
      payment_notice_id: noticeId,
      action_type:       'driver_approval',
      action_by:         userId,
    })

  return { data: undefined, error: null }
}

// ── ドライバー画面の読み取り系 ─────────────────────────────
//
// ⚠️ 金額は例外なく computePaymentNoticeAmounts（正本）を通す。
//    ここで独自計算を書かないこと。2026-08-10 に支払通知書一覧が独自計算
//    （暦月固定）を持っていたために、親分の一覧とPDFで金額が食い違う事故が起きている。
// ⚠️ 集計期間は暦月ではなく委託先ごとの締め期間（closingRange）。
//    実績リストと見込み金額で期間がずれると、明細を足しても合計に一致しない。

/** ログイン中のドライバーの委託先ID・テナントIDをまとめて解決する */
type DriverContext =
  | { ok: true;  contractorId: string; tenantId: string }
  | { ok: false; error: string }

async function currentDriverContext(): Promise<DriverContext> {
  try {
    if (process.env.ALLOW_DEV_AUTH_BYPASS === 'true') {
      return { ok: true, contractorId: DEV_CONTRACTOR_ID, tenantId: await getCurrentTenantId() }
    }
    const supabase = await createClient()
    const { data: { user }, error: authErr } = await supabase.auth.getUser()
    if (authErr || !user) return { ok: false, error: '未ログインです' }

    const contractorId = await resolveContractorId(user.id, user.email ?? undefined)
    if (!contractorId) return { ok: false, error: '委託先レコードが見つかりません' }

    return { ok: true, contractorId, tenantId: await getCurrentTenantId() }
  } catch (e) {
    // getCurrentTenantId は本番で fail-closed に throw する
    return { ok: false, error: e instanceof Error ? e.message : 'テナントが解決できません' }
  }
}

/** 委託先の締め日から対象月の集計期間を出す */
async function periodOf(db: LooseDb, contractorId: string, yearMonth: string): Promise<{ from: string; to: string }> {
  const { data } = await db.from('contractors').select('closing_day').eq('id', contractorId).maybeSingle()
  return closingRange(yearMonth, data?.closing_day ?? null)
}

export type MonthSummary = {
  yearMonth:  string
  workDays:   number
  pieceTotal: number
  /** 差引支給額の見込み。⚠️ null は「取得できなかった」。0 と区別すること */
  estimatedAmount: number | null
  /** true = 支払通知書が生成済み（＝確定値） */
  isConfirmed: boolean
  period: { from: string; to: string }
}

export async function fetchMyMonthSummary(yearMonth: string): Promise<ActionResult<MonthSummary>> {
  const ctx = await currentDriverContext()
  if (!ctx.ok) return { data: null, error: ctx.error }

  const db = looseDb()
  const period = await periodOf(db, ctx.contractorId, yearMonth)

  const [workRes, noticeRes, calc] = await Promise.all([
    db.from('work_records')
      .select('work_date, piece_count')
      .eq('contractor_id', ctx.contractorId)
      .gte('work_date', period.from).lte('work_date', period.to),
    db.from('payment_notices')
      .select('id')
      .eq('contractor_id', ctx.contractorId)
      .eq('notice_month', `${yearMonth}-01`)
      .maybeSingle(),
    computePaymentNoticeAmounts(looseDb(), {
      tenantId:     ctx.tenantId,
      contractorId: ctx.contractorId,
      yearMonth,
    }),
  ])

  const rows = (workRes.data ?? []) as { work_date: string; piece_count: number | null }[]

  return {
    data: {
      yearMonth,
      workDays:   new Set(rows.map(r => r.work_date)).size,
      pieceTotal: rows.reduce((s, r) => s + (r.piece_count ?? 0), 0),
      // ⚠️ 算出に失敗したら null。ここで 0 を返すと「働いたのに報酬0」と読めてしまう
      estimatedAmount: calc.data ? calc.data.totalAmount : null,
      isConfirmed:     Boolean(noticeRes.data),
      period,
    },
    error: null,
  }
}

export type MyWorkRecordRow = {
  id:          string
  workDate:    string
  projectName: string
  pieceCount:  number
  amount:      number
  /** 金額の根拠（例: '380個 × ¥85'） */
  formula:     string
}

export async function fetchMyWorkRecords(yearMonth: string): Promise<ActionResult<MyWorkRecordRow[]>> {
  const ctx = await currentDriverContext()
  if (!ctx.ok) return { data: null, error: ctx.error }

  const db = looseDb()
  const period = await periodOf(db, ctx.contractorId, yearMonth)

  const { data: works, error: workErr } = await db
    .from('work_records')
    .select(`id, work_date, ${WORK_RECORD_AMOUNT_COLUMNS}`)
    .eq('contractor_id', ctx.contractorId)
    .gte('work_date', period.from).lte('work_date', period.to)
    .order('work_date')
  if (workErr) return { data: null, error: workErr.message }

  const rows = (works ?? []) as (RawWorkRecord & { id: string; work_date: string })[]
  const projIds = Array.from(new Set(rows.map(r => r.project_id).filter((v): v is string => !!v)))

  // price_rules には tenant_id 列が無いため、出てきた案件IDだけを引く
  const [{ data: rules }, { data: projects }] = await Promise.all([
    projIds.length
      ? db.from('price_rules').select(PRICE_RULE_COLUMNS).in('project_id', projIds)
      : Promise.resolve({ data: [] }),
    projIds.length
      ? db.from('projects').select('id, project_name').in('id', projIds)
      : Promise.resolve({ data: [] }),
  ])

  const ruleMap = buildPriceRuleMap(rules as PriceRuleRecord[])
  const projMap = new Map<string, string>((projects ?? []).map((p: Row) => [p.id as string, p.project_name as string]))

  return {
    data: rows.map(r => {
      // 支払通知書は「買値」side。請求書（selling）と取り違えないこと
      const b = describeWorkAmount(r, r.project_id ? ruleMap.get(r.project_id) : undefined, 'buying')
      return {
        id:          r.id,
        workDate:    r.work_date,
        projectName: r.project_id ? (projMap.get(r.project_id) ?? '（案件なし）') : '（案件なし）',
        pieceCount:  r.piece_count ?? 0,
        amount:      b.amount,
        formula:     b.formula,
      }
    }),
    error: null,
  }
}

export type UpcomingSchedule = {
  date:        string
  projectName: string
  status:      string
}

export async function fetchMyUpcomingSchedules(limit = 5): Promise<ActionResult<UpcomingSchedule[]>> {
  const ctx = await currentDriverContext()
  if (!ctx.ok) return { data: null, error: ctx.error }

  const db = looseDb()
  // 今日を含む以降。JSTのローカル日付で比較する（UTC変換すると日付が1日ずれる）
  const today = new Date()
  const iso = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`

  const { data, error } = await db
    .from('schedules')
    .select('date, status, project_id')
    .eq('contractor_id', ctx.contractorId)
    .gte('date', iso)
    .order('date')
    .limit(limit)
  if (error) return { data: null, error: error.message }

  const rows = (data ?? []) as { date: string; status: string; project_id: string | null }[]
  const projIds = Array.from(new Set(rows.map(r => r.project_id).filter((v): v is string => !!v)))
  const { data: projects } = projIds.length
    ? await db.from('projects').select('id, project_name').in('id', projIds)
    : { data: [] }
  const projMap = new Map<string, string>((projects ?? []).map((p: Row) => [p.id as string, p.project_name as string]))

  return {
    data: rows.map(r => ({
      date:        r.date,
      status:      r.status,
      projectName: r.status === 'absent'
        ? '休み'
        : (r.project_id ? (projMap.get(r.project_id) ?? '（案件未設定）') : '（案件未設定）'),
    })),
    error: null,
  }
}

/** 支払通知書の行を年でまとめて返す（確定申告用の年計つき） */
export async function fetchMyPaymentHistory(
  year: number,
): Promise<ActionResult<{ rows: PaymentHistoryRow[]; summary: AnnualSummary }>> {
  const ctx = await currentDriverContext()
  if (!ctx.ok) return { data: null, error: ctx.error }

  const db = looseDb()
  const { data, error } = await db
    .from('payment_notices')
    .select('notice_month, subtotal_registered, subtotal_unregistered, subtotal_exempt, total_excluding_tax, total_tax, total_deduction, insurance_deduction, total_amount, approval_status')
    .eq('contractor_id', ctx.contractorId)
    .gte('notice_month', `${year}-01-01`)
    .lte('notice_month', `${year}-12-01`)
    .order('notice_month', { ascending: false })
  if (error) return { data: null, error: error.message }

  const rows: PaymentHistoryRow[] = (data ?? []).map((r: Row) => {
    const laborNet = Number(r.subtotal_registered ?? 0) + Number(r.subtotal_unregistered ?? 0) + Number(r.subtotal_exempt ?? 0)
    const totalEx  = Number(r.total_excluding_tax ?? 0)
    const insurance = Number(r.insurance_deduction ?? 0)
    return {
      noticeMonth:    r.notice_month,
      laborNet,
      // 立替経費 = 税抜合計 − 労務報酬（マイナスにはしない）
      expenseNet:     Math.max(0, totalEx - laborNet),
      totalTax:       Number(r.total_tax ?? 0),
      // ⚠️ total_deduction は経過措置＋運送保険の合計。経過措置だけを取り出す
      deduction:      Math.max(0, Number(r.total_deduction ?? 0) - insurance),
      insurance,
      totalAmount:    Number(r.total_amount ?? 0),
      approvalStatus: r.approval_status ?? 'unapproved',
    }
  })

  return { data: { rows, summary: summarizeAnnual(year, rows) }, error: null }
}

/** 年セレクタの選択肢（通知書が存在する年だけ・新しい順） */
export async function fetchMyAvailableYears(): Promise<ActionResult<number[]>> {
  const ctx = await currentDriverContext()
  if (!ctx.ok) return { data: null, error: ctx.error }

  const db = looseDb()
  const { data, error } = await db
    .from('payment_notices')
    .select('notice_month')
    .eq('contractor_id', ctx.contractorId)
  if (error) return { data: null, error: error.message }

  return { data: availableYearsOf((data ?? []).map((r: Row) => r.notice_month as string)), error: null }
}

export type MyProfile = {
  name:  string
  email: string | null
  /** 'registered' | 'unregistered' | 'exempt' などの生値 */
  invoiceRegistrationType: string | null
  /** 画面に出す日本語ラベル */
  invoiceRegistrationLabel: string
}

/**
 * マイページ用の自分の登録情報。
 *
 * ⚠️ 口座情報は返さないこと。復号してブラウザへ送る必要が生じ、
 *    暗号化保存（AES-256-GCM）の意味を薄める。変更は親分側で行う運用。
 */
export async function fetchMyProfile(): Promise<ActionResult<MyProfile>> {
  const ctx = await currentDriverContext()
  if (!ctx.ok) return { data: null, error: ctx.error }

  const db = looseDb()
  const { data, error } = await db
    .from('contractors')
    .select('name, email, invoice_registration_type')
    .eq('id', ctx.contractorId)
    .maybeSingle()
  if (error) return { data: null, error: error.message }
  if (!data) return { data: null, error: '委託先レコードが見つかりません' }

  const type = (data.invoice_registration_type ?? null) as string | null
  return {
    data: {
      name:  (data.name as string) ?? '',
      email: (data.email as string) ?? null,
      invoiceRegistrationType: type,
      invoiceRegistrationLabel: isQualifiedInvoiceIssuer(type) ? '適格請求書発行事業者（登録済み）' : '免税事業者（経過措置の対象）',
    },
    error: null,
  }
}

// ── アプリ内お知らせ ───────────────────────────────────────
//
// ⚠️ notification_logs は「メールを送った記録」で本文の列を持たない。文面は
//    utils/driver-notice.ts で組み立てる（親分の自由入力の連絡は現状扱えない）。
// ⚠️ 送信 status が failed の記録も出す。メールが届かなかった分こそアプリで見せる意味がある。
// ⚠️ 既読は notification_reads（別表）。notification_logs は不変ログなので更新できない。

export type MyNotice = {
  id:      string
  title:   string
  body:    string
  href:    string
  /** 'YYYY-MM-DD' */
  date:    string
  isRead:  boolean
}

export async function fetchMyNotices(): Promise<ActionResult<MyNotice[]>> {
  const ctx = await currentDriverContext()
  if (!ctx.ok) return { data: null, error: ctx.error }

  const db = looseDb()
  const { data: logs, error } = await db
    .from('notification_logs')
    .select('id, alert_key, created_at')
    .eq('contractor_id', ctx.contractorId)
    .order('created_at', { ascending: false })
    .limit(50)
  if (error) return { data: null, error: error.message }

  const rows = (logs ?? []) as { id: string; alert_key: string | null; created_at: string }[]
  const refs = rows.map(r => ({ row: r, ref: parseAlertKey(r.alert_key) }))
    .filter(x => isDriverFacing(x.ref.kind))

  // 未入力の催促は対象の予定を引いて日付・案件名を出す（無ければ日付なしの文面になる）
  const scheduleIds = refs.filter(x => x.ref.kind === 'missing_input').map(x => x.ref.targetId).filter(Boolean)
  const detailByTarget = new Map<string, { date?: string; projectName?: string }>()
  if (scheduleIds.length > 0) {
    const { data: schedules } = await db
      .from('schedules').select('id, date, project_id').in('id', scheduleIds)
    const projIds = [...new Set(((schedules ?? []) as Row[]).map(s => s.project_id as string).filter(Boolean))]
    const { data: projects } = projIds.length
      ? await db.from('projects').select('id, project_name').in('id', projIds)
      : { data: [] }
    const pm = new Map<string, string>(((projects ?? []) as Row[]).map(p => [p.id as string, p.project_name as string]))
    for (const s of ((schedules ?? []) as Row[])) {
      detailByTarget.set(s.id as string, {
        date: s.date as string,
        projectName: s.project_id ? pm.get(s.project_id as string) : undefined,
      })
    }
  }

  // ⚠️ 既読表が本番未適用のあいだはクエリが失敗する。そのときは全件を未読として出す
  //    （お知らせ自体を消すと、催促が届かないまま気づけない状態に戻ってしまう）。
  const readIds = new Set<string>()
  const { data: reads, error: readErr } = await db
    .from('notification_reads').select('notification_id').eq('contractor_id', ctx.contractorId)
  if (readErr) console.warn('[fetchMyNotices] 既読表を読めません（未適用の可能性）:', readErr.message)
  else for (const r of ((reads ?? []) as Row[])) readIds.add(r.notification_id as string)

  return {
    data: refs.map(({ row, ref }) => {
      const n = buildDriverNotice(ref.kind, detailByTarget.get(ref.targetId) ?? {})
      return {
        id:     row.id,
        title:  n.title,
        body:   n.body,
        href:   n.href,
        date:   String(row.created_at).slice(0, 10),
        isRead: readIds.has(row.id),
      }
    }),
    error: null,
  }
}

/** お知らせを既読にする。⚠️ notification_logs 側は一切更新しない（不変ログ） */
export async function markNoticeRead(notificationId: string): Promise<ActionResult> {
  const ctx = await currentDriverContext()
  if (!ctx.ok) return { data: null, error: ctx.error }

  const db = looseDb()
  // 他人の通知を既読にできないよう、自分宛であることを確認してから入れる
  const { data: own } = await db
    .from('notification_logs').select('id')
    .eq('id', notificationId).eq('contractor_id', ctx.contractorId).maybeSingle()
  if (!own) return { data: null, error: '対象のお知らせが見つかりません' }

  // ⚠️ F0 で tenant_id の DEFAULT を撤去済み。明示的に渡さないと NOT NULL 違反になる
  const { error } = await db.from('notification_reads').insert({
    tenant_id:       ctx.tenantId,
    notification_id: notificationId,
    contractor_id:   ctx.contractorId,
  })
  // 二重タップは UNIQUE 違反になるが、利用者にとっては成功と同じ
  if (error && !String(error.message).includes('duplicate')) return { data: null, error: error.message }
  return { data: undefined, error: null }
}
