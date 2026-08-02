'use server'

import { createClient } from '@/utils/supabase/server'
import { createServiceClient } from '@/utils/supabase/service'
import { calculateInvoiceTax, type TaxItem } from '@/utils/billing/taxCalculator'
import { getCurrentTenantId } from '@/utils/tenant'
import { requireOwner } from '@/utils/auth'
import { writeInvoice } from '@/utils/invoice-writer'
import { invoiceLockError } from '@/utils/invoice-lock'
import {
  calcWorkAmount,
  buildPriceRuleMap,
  WORK_RECORD_AMOUNT_COLUMNS,
  PRICE_RULE_COLUMNS,
  type PriceRuleRecord,
  type RawWorkRecord,
} from '@/utils/work-amount'
import { closingRange, computeDueDate, parseLocalDate } from '@/utils/closing-period'
import { isQualifiedInvoiceIssuer } from '@/utils/invoice-registration'
import { getDeductionRate } from '@/utils/transitional-deduction'

type ActionResult<T = void> =
  | { data: T; error: null }
  | { data: null; error: string }

// ── 日付ユーティリティ ────────────────────────────────────────
// new Date() はローカル時刻ベースのため JST 環境でタイムゾーンずれが生じる。
// YYYY-MM-DD 形式の文字列を直接組み立てて UTC 解釈ずれを回避する。

/** '2026-06' → '2026-06-01' */
function monthStartStr(yearMonth: string): string {
  return `${yearMonth}-01`
}

/** '2026-06' → '2026-06-30' (月末日) */
function monthEndStr(yearMonth: string): string {
  const [y, m] = yearMonth.split('-').map(Number)
  const lastDay = new Date(Date.UTC(y, m, 0)).getUTCDate()
  return `${yearMonth}-${String(lastDay).padStart(2, '0')}`
}

// ⚠️ 締め日ベースの期間算出（closingRange）と支払期日計算はこのファイルにも
//    admin/sales/actions.ts にも同じものが重複実装されていた。
//    2026-08-02 に utils/closing-period.ts へ集約した。上部の import を参照。

// ── 監査ログ挿入（approval_history は UPDATE/DELETE 禁止テーブル） ─
// approval_history のカラム: payment_notice_id / action_by / action_type / unlock_reason

async function insertPaymentNoticeAuditLog(
  service: ReturnType<typeof createServiceClient>,
  params: {
    paymentNoticeId: string
    actionType:      string
    actionBy:        string
    unlockReason?:   string | null
  },
): Promise<void> {
  const { error } = await service
    .from('approval_history')
    .insert({
      payment_notice_id: params.paymentNoticeId,
      action_type:       params.actionType,
      action_by:         params.actionBy,
      unlock_reason:     params.unlockReason ?? null,
    })

  if (error) {
    throw new Error(`監査ログの記録に失敗しました: ${error.message}`)
  }
}

// ── 請求書確定（invoices テーブルへのスナップショット書き込み） ─

async function finalizeInvoice(
  service: ReturnType<typeof createServiceClient>,
  yearMonth: string,
  clientId: string,
  opts: { userId: string; isDeveloperUnlock?: boolean; unlockReason?: string },
): Promise<ActionResult> {
  const tenantId = await getCurrentTenantId()
  // 荷主情報取得
  const { data: client, error: clientErr } = await service
    .from('clients')
    .select('id, company_name, tax_type, invoice_registered, closing_day, payment_site')
    .eq('id', clientId)
    .eq('tenant_id', tenantId)
    .single()

  if (clientErr || !client) {
    return { data: null, error: clientErr?.message ?? '荷主が見つかりません' }
  }

  // 既存請求書のロックチェック（issued / paid は変更禁止）
  // ⚠️ 判定は utils/invoice-lock.ts に集約した。upsertInvoice（請求書プレビュータブの再確定）と
  //    同じ関数を共有する。片方だけに砦がある状態が 2026-07-31 の上書き事故を生んだ。
  // ⚠️ tenant を掛けるのは共通ライタが既存行を探す条件と揃えるため（ズレると別行を掴む）。
  const invoiceMonthDate = monthStartStr(yearMonth)
  const { data: existing } = await service
    .from('invoices')
    .select('status')
    .eq('client_id', clientId)
    .eq('invoice_month', invoiceMonthDate)
    .eq('tenant_id', tenantId)
    .maybeSingle()

  const lockErr = invoiceLockError(existing, opts)
  // invoices は approval_history に FK がないため、アンロック時も監査ログは記録しない
  if (lockErr) return { data: null, error: lockErr }

  // 締め日ベースの対象期間（2026-08-02 ボス判断で全経路この基準に統一）
  const { from, to } = closingRange(yearMonth, client.closing_day)

  // 対象 work_records を取得
  // ⚠️ 2026-08-02 まで存在しない列 `tax_excluded_sales` を select しており、
  //    PostgREST が 42703 を返してこの関数は常に早期リターンしていた
  //    （＝「請求書を確定する」が何も書き込まないまま成功したように見えていた）。
  //    金額は price_rules から都度計算する。詳細は utils/work-amount.ts。
  const { data: workRows, error: wrErr } = await service
    .from('work_records')
    .select(`${WORK_RECORD_AMOUNT_COLUMNS}, work_date, projects!inner( client_id )`)
    .eq('projects.client_id', clientId)
    .eq('tenant_id', tenantId)
    .gte('work_date', from)
    .lte('work_date', to)

  if (wrErr) return { data: null, error: wrErr.message }

  const rawRows = (workRows ?? []) as unknown as RawWorkRecord[]

  // price_rules には tenant_id が無いため、テナント確認済みの案件IDだけを引く
  const projectIds = [...new Set(rawRows.map(r => r.project_id).filter((id): id is string => !!id))]
  let ruleMap = new Map<string, PriceRuleRecord>()
  if (projectIds.length > 0) {
    const { data: rules, error: ruleErr } = await service
      .from('price_rules')
      .select(PRICE_RULE_COLUMNS)
      .in('project_id', projectIds)
    if (ruleErr) return { data: null, error: ruleErr.message }
    ruleMap = buildPriceRuleMap(rules as unknown as PriceRuleRecord[])
  }

  const isTaxable = client.tax_type !== 'exempt'
  const items: TaxItem[] = rawRows.map((r) => ({
    amount: calcWorkAmount(r, r.project_id ? ruleMap.get(r.project_id) : undefined, 'selling'),
    isTaxable,
  }))

  // ⚠️ 売上請求書に経過措置を適用するのは制度上おかしい（判定の主語が取引相手になっている）。
  //    実請求書にも差し引き行は無い。ただし税務判断を伴うため顧問税理士の確認待ちとし、
  //    ここでは既存の挙動を変えない。詳細は HANDOVER §5-4 の 2026-07-31「論点B」。
  const result = calculateInvoiceTax(items, client.invoice_registered, parseLocalDate(to))
  const dueDate = computeDueDate(yearMonth, client.closing_day, client.payment_site)

  const newTotalAmount = result.finalAmount

  // ⚠️ 従来は upsert で競合キーに (client_id, invoice_month) を指定していた。
  //    Task 7 で一意性を部分ユニークインデックス 2 本に張り替えると競合対象を指定できないため、
  //    共通ライタの SELECT→UPDATE/INSERT へ移行する。
  //    ⚠️ 確定済み（issued/paid）のロック判定は上部（104-122行）に残してある。
  //       共通ライタはロックを守らない。
  // ⚠️ 共通ライタは yearMonth（'YYYY-MM'）を受け取る。
  //    invoiceMonthDate（'YYYY-MM-01'）を渡すと形式チェックで例外になる。
  const { error: writeErr } = await writeInvoice(service, {
    clientId:     clientId,
    departmentId: null,          // Task 11 で部署対応を入れる
    yearMonth:    yearMonth,
    subtotal:     result.subtotal,
    taxAmount:    result.taxAmount,
    totalAmount:  newTotalAmount,
    // ⚠️ 2026-08-02 ボス判断: 「確定・ロック」タブの確定は issued にする。
    //    従来は draft を書いており、タブ名に反してロックがかからなかった
    //    （invoice-lock.ts のロック対象は issued / paid のみ）。
    //    これにより draft→issued の遷移経路がようやく存在するようになる。
    status:       'issued',
    dueDate:      dueDate,
    issuedAt:     new Date().toISOString(),
    tenantId:     tenantId,
  })

  if (writeErr) return { data: null, error: writeErr }

  return { data: undefined, error: null }
}

// ── 支払通知書確定（payment_notices テーブルへのスナップショット書き込み） ─

async function finalizePaymentNotice(
  service: ReturnType<typeof createServiceClient>,
  yearMonth: string,
  contractorId: string,
  opts: { userId: string; isDeveloperUnlock?: boolean; unlockReason?: string },
): Promise<ActionResult> {
  const tenantId = await getCurrentTenantId()
  // 委託先情報取得
  const { data: contractor, error: ctErr } = await service
    .from('contractors')
    .select('id, tax_category, invoice_registration_type')
    .eq('id', contractorId)
    .eq('tenant_id', tenantId)
    .single()

  if (ctErr || !contractor) {
    return { data: null, error: ctErr?.message ?? '委託先が見つかりません' }
  }

  const noticeMonthDate = monthStartStr(yearMonth)

  // ── 3段構えのロックチェック ────────────────────────────────
  // 段1: 既存レコードの存在確認
  const { data: existingNotice } = await service
    .from('payment_notices')
    .select('id, approval_status, locked, total_amount')
    .eq('contractor_id', contractorId)
    .eq('notice_month', noticeMonthDate)
    .maybeSingle()

  // 段2: 承認済み or ロック確認
  const isLocked =
    existingNotice &&
    (existingNotice.approval_status === 'approved' || existingNotice.locked === true)

  if (isLocked) {
    // 段3: 開発者アンロックの意志と理由が揃っていない場合は拒否
    if (!opts.isDeveloperUnlock || !opts.unlockReason) {
      return {
        data: null,
        error:
          '支払通知書はロック済みのため変更できません。' +
          'isDeveloperUnlock=true および unlockReason の入力が必要です。',
      }
    }

    // 開発者アンロックが有効 → 逃げられない証跡を approval_history に刻む
    await insertPaymentNoticeAuditLog(service, {
      paymentNoticeId: existingNotice.id,
      actionType:      'developer_unlock',
      actionBy:        opts.userId,
      unlockReason:    opts.unlockReason,
    })
  }

  // ── データ集計（billing/actions.ts の generatePaymentNotice と同じ方式） ──
  const from = monthStartStr(yearMonth)
  const to   = monthEndStr(yearMonth)
  const contractorRow = contractor as Record<string, unknown>
  const taxCategory   = String(contractorRow.tax_category ?? 'exclusive')
  const invoiceType   = String(contractorRow.invoice_registration_type ?? '')

  const { data: workData, error: wrErr } = await service
    .from('work_records')
    .select('projects(price_rules(buying_price))')
    .eq('contractor_id', contractorId)
    .eq('tenant_id', tenantId)
    .gte('work_date', from)
    .lte('work_date', to)

  if (wrErr) return { data: null, error: wrErr.message }

  let laborTaxExcluded = 0
  for (const w of (workData ?? []) as any[]) {
    laborTaxExcluded += Number(w.projects?.price_rules?.[0]?.buying_price ?? 0)
  }

  const calcTax = (amount: number, cat: string) => {
    if (cat === 'exclusive') return Math.floor(amount * 0.1)
    if (cat === 'inclusive') return Math.floor(amount - amount / 1.1)
    return 0
  }
  const laborTax = calcTax(laborTaxExcluded, taxCategory)

  const { data: expenseRows, error: exErr } = await service
    .from('expense_records')
    .select('amount_actual, amount_tax_excluded, tax_category, expense_date')
    .eq('contractor_id', contractorId)
    .eq('tenant_id', tenantId)
    .eq('approval_status', 'approved')
    .gte('expense_date', from)
    .lte('expense_date', to)

  if (exErr) return { data: null, error: exErr.message }

  let expenseTaxExcluded = 0
  let expenseTax = 0
  for (const e of (expenseRows ?? []) as any[]) {
    expenseTaxExcluded += Number(e.amount_tax_excluded ?? 0)
    expenseTax         += Number(e.amount_actual ?? 0) - Number(e.amount_tax_excluded ?? 0)
  }

  // ⚠️ ここには経過措置の率表の**5本目の複製**があり、4つとも誤っていた（2026-08-02 修正）:
  //    ①令和8年度改正の 3% 区分が無く 2029年10月以降は 0 を返していた
  //    ②`=== '適格'` 直書きのため `registered` の委託先を未登録扱いにして控除していた
  //    ③基準額が税抜の消費税額（laborTax）だった
  //    ④端数が切り捨て（他経路は四捨五入）
  //    率の正本は utils/transitional-deduction.ts。ここで率表を再び書かないこと。
  // ⚠️ 未対応: 率は本来「稼働日ごと」に判定する（消基通 11-3-1）が、この関数は
  //    稼働日を保持しない集計をしているため対象期間末の率で一括判定している。
  //    2026-09-21〜10-20 のような率が混在する締め期間では admin/billing/actions.ts の
  //    generatePaymentNotice と結果が食い違う。集計方式ごと一本化する別タスクが必要。
  const isRegisteredContractor = isQualifiedInvoiceIssuer(invoiceType)
  const [dedY, dedM] = yearMonth.split('-').map(Number)
  const deductionRate = getDeductionRate(new Date(dedY, dedM, 0), isRegisteredContractor)
  const deduction     = Math.round((laborTaxExcluded + laborTax) * deductionRate)

  const totalAmount = laborTaxExcluded + laborTax + expenseTaxExcluded + expenseTax - deduction

  const { error: upsertErr } = await (service as any)
    .from('payment_notices')
    .upsert(
      {
        contractor_id:          contractorId,
        notice_month:           noticeMonthDate,
        target_month:           noticeMonthDate,
        status:                 'approved',
        total_excluding_tax:    laborTaxExcluded + expenseTaxExcluded,
        total_tax:              laborTax + expenseTax,
        total_deduction:        deduction,
        approval_status:        'approved',
        locked:                 false,
      },
      { onConflict: 'contractor_id,notice_month' },
    )

  if (upsertErr) return { data: null, error: upsertErr.message }

  // アンロック後の上書き完了ログ
  if (isLocked && existingNotice) {
    await insertPaymentNoticeAuditLog(service, {
      paymentNoticeId: existingNotice.id,
      actionType:      'overwrite_after_unlock',
      actionBy:        opts.userId,
      unlockReason:    opts.unlockReason ?? null,
    })
  }

  return { data: undefined, error: null }
}

// ── 公開 Server Action ────────────────────────────────────────

export type FinalizeTarget =
  | {
      type: 'invoice'
      yearMonth: string
      clientId:  string
      isDeveloperUnlock?: boolean
      unlockReason?:      string
    }
  | {
      type: 'payment_notice'
      yearMonth:     string
      contractorId:  string
      isDeveloperUnlock?: boolean
      unlockReason?:      string
    }

/**
 * 請求書または支払通知書を確定しスナップショットをDBに書き込む。
 *
 * 3段構えの保護ロジック:
 *   段1 既存レコードの有無確認
 *   段2 approved / locked 状態チェック → ロック中は通常更新を拒否
 *   段3 isDeveloperUnlock=true + unlockReason 必須 → 通過時は approval_history に証跡を記録
 */
export async function finalizeInvoiceAndNotice(
  target: FinalizeTarget,
): Promise<ActionResult> {
  // 認証チェック（dev専用バイパスは ALLOW_DEV_AUTH_BYPASS=true のときのみ。本番では設定しない）
  const supabase = await createClient()
  const { data: { user }, error: authErr } = await supabase.auth.getUser()
  const isDev = process.env.ALLOW_DEV_AUTH_BYPASS === 'true'
  if ((authErr || !user) && !isDev) return { data: null, error: '認証が必要です' }
  if (!isDev) {
    const __owner = await requireOwner()
    if (!__owner.ok) return { data: null, error: __owner.error }
  }
  // dev環境のフォールバック: admin@hibiki.com のUUID（approval_history.action_by はUUID型）
  const DEV_ADMIN_UUID = '33259c12-e46b-4ebd-a87c-cf50682729c4'
  const userId = user?.id ?? DEV_ADMIN_UUID

  const service = createServiceClient()
  const opts = {
    userId:            userId,
    isDeveloperUnlock: target.isDeveloperUnlock,
    unlockReason:      target.unlockReason,
  }

  if (target.type === 'invoice') {
    return finalizeInvoice(service, target.yearMonth, target.clientId, opts)
  } else {
    return finalizePaymentNotice(service, target.yearMonth, target.contractorId, opts)
  }
}
