'use server'

import { createServiceClient } from '@/utils/supabase/service'
import { calculateInvoiceTax, type TaxItem } from '@/utils/billing/taxCalculator'
import { getCurrentTenantId } from '@/utils/tenant'
import { getPaymentNoticeResponseDays, lockableAtFrom } from '@/utils/company'
import { requireOwner, DEV_BYPASS_USER_ID } from '@/utils/auth'
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
import {
  CONFIRMATION_METHODS,
  CONFIRMED_PARTIES,
  type ProxyApprovalParams,
} from '@/utils/proxy-approval'
// ⚠️ 支払通知書の金額算出は utils/payment-notice-calc.ts が正本。
//    以前ここに admin/billing/actions.ts の劣化コピーがあり、同じ委託先・同じ月でも
//    生成経路と確定経路で金額が食い違っていた（2026-08-02 に一本化）。
import { computePaymentNoticeAmounts } from '@/utils/payment-notice-calc'

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

// ⚠️ monthEndStr（対象月の末日）はここで支払通知書の集計期間を作るために使っていたが、
//    正しい期間は委託先ごとの締め期間（closingRange）。共通モジュールが算出するため削除した。

// ⚠️ 締め日ベースの期間算出（closingRange）と支払期日計算はこのファイルにも
//    admin/sales/actions.ts にも同じものが重複実装されていた。
//    2026-08-02 に utils/closing-period.ts へ集約した。上部の import を参照。

// ── 監査ログ挿入（approval_history は UPDATE/DELETE 禁止テーブル） ─
// approval_history のカラム: payment_notice_id / action_by / action_type / unlock_reason

async function insertPaymentNoticeAuditLog(
  service: ReturnType<typeof createServiceClient>,
  params: {
    /** ⚠️ F0で tenant_id の DEFAULT を撤去したため必須。省略すると NOT NULL 違反になる */
    tenantId:        string
    paymentNoticeId: string
    actionType:      string
    actionBy:        string
    unlockReason?:   string | null
    /** 代理承認の確認記録（action_type='proxy_approval' のときだけ使う） */
    confirmationMethod?: string | null
    confirmedParty?:     string | null
    note?:               string | null
  },
): Promise<void> {
  const { error } = await service
    .from('approval_history')
    .insert({
      tenant_id:         params.tenantId,
      payment_notice_id: params.paymentNoticeId,
      action_type:       params.actionType,
      action_by:         params.actionBy,
      unlock_reason:     params.unlockReason ?? null,
      confirmation_method: params.confirmationMethod ?? null,
      confirmed_party:     params.confirmedParty ?? null,
      note:                params.note ?? null,
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
  // ⚠️ 検索条件は writeInvoice が既存行を探す条件と必ず揃えること。
  //    ズレると「別の行のロックを見て、違う行に書く」ことになる。
  //    department_id を落としていると、Task 11 で部署ごとの行が増えた瞬間に
  //    maybeSingle() が複数行でエラーになり、下の fail-closed で止まる（黙って通さない）。
  const { data: existing, error: existErr } = await service
    .from('invoices')
    .select('status')
    .eq('client_id', clientId)
    .eq('invoice_month', invoiceMonthDate)
    .eq('tenant_id', tenantId)
    .is('department_id', null)   // Task 11 で部署対応を入れる
    .maybeSingle()

  // ⚠️ fail-open 厳禁: エラーを握り潰すと確定済み請求書がロックをすり抜けて上書きされる
  if (existErr) {
    return { data: null, error: `既存請求書の確認に失敗しました: ${existErr.message}` }
  }

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

  // ⚠️ 売上請求書（IN）に経過措置は適用しない。判定の主語は自社であって荷主ではない。
  //    2026-08-16 に client.invoice_registered を渡すのをやめた（論点B）。
  //    詳細は calculateInvoiceTax の注記と HANDOVER §5-4 の 2026-07-31。
  const result = calculateInvoiceTax(items)
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
  // ⚠️ 委託先マスタの取得は共通モジュール側で行う（tenant 確認・存在確認も含む）。
  //    ここで先に引くと同じクエリが 2 回走るだけなので持たない。
  const noticeMonthDate = monthStartStr(yearMonth)

  // ── 3段構えのロックチェック ────────────────────────────────
  // 段1: 既存レコードの存在確認
  const { data: existingNotice } = await service
    .from('payment_notices')
    .select('id, approval_status, locked, total_amount, created_at')
    // ⚠️ 一意制約は (contractor_id, notice_month) で tenant_id を含まない。
    //    contractor_id は他テナントの値も指定できてしまうため、tenant_id で必ず絞る
    //    （service クライアントは RLS を通らない）。
    .eq('tenant_id', tenantId)
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
      tenantId,
      paymentNoticeId: existingNotice.id,
      actionType:      'developer_unlock',
      actionBy:        opts.userId,
      unlockReason:    opts.unlockReason,
    })
  }

  // ── 金額算出は共通モジュールへ集約（utils/payment-notice-calc.ts） ──
  // ⚠️ ここには admin/billing/actions.ts の劣化コピーがあり、以下 4 点で食い違っていた
  //    （2026-08-02 に一本化して解消）:
  //      ①稼働金額が buying_price の単純合算で、個数(piece_count)も
  //        calculation_type も無視していた（piece 制の委託先で桁が落ちる）
  //      ②project_payees の単価ルール・調整金・再委託を一切見ていなかった
  //      ③経過措置の率を対象月末で一括判定していた（正しくは稼働日ごと。消基通 11-3-1）
  //      ④集計期間が月初〜月末で、委託先ごとの締め日を無視していた
  //    率の正本は utils/transitional-deduction.ts。ここで率表を再び書かないこと。
  const { data: a, error: calcErr } = await computePaymentNoticeAmounts(
    service,
    { tenantId, contractorId, yearMonth },
  )
  if (calcErr || !a) return { data: null, error: calcErr ?? '支払通知書の金額算出に失敗しました' }

  // ── 合意状態と確定状態を分けて書く（2026-08-02 ボス判断で設計書どおりに是正） ──
  //
  // 設計書 §2-3-9: 支払通知書の承認者は「子分（委託先）」、目的は「支払金額の合意証跡」。
  // ⚠️ 以前ここは approval_status='approved' を書いており、**子分の承認なしに合意証跡が
  //    作られていた**。親分側のコードから 'approved' を書いてはならない。
  // ⚠️ 以前は locked:false も書いており、開発者アンロック後の上書きで
  //    **一度かけたロックが解除される**副作用があった。
  //
  // この操作は「タイムリミット後の確定ロック」（設計書 §2-3-9 備考）であって承認ではない。
  //   - 既に子分が承認済み（approved / approved_by_proxy）→ その合意状態を保ったまま確定
  //   - まだ返事がない（pending）→ 'no_response'（連絡がつかないまま締めた）として記録
  // 口頭確認して親分が代わりに承認する場合は、この関数ではなく
  // proxyApprovePaymentNotice（確認記録の入力が必須）を使うこと。
  const prevApproval = existingNotice?.approval_status
  const hasAgreement = prevApproval === 'approved' || prevApproval === 'approved_by_proxy'
  const nextApprovalStatus = hasAgreement ? prevApproval : 'no_response'

  // ⚠️ タイムリミット判定（設計書 §2-3-9 備考「タイムリミット後は確定ロック」）。
  //    合意が無いまま「未応答」の証跡を立てるには、子分に返事の機会が要る。
  //    生成直後に確定できると「返事がなかった」が嘘になるため、待機日数を過ぎるまで止める。
  //    ⚠️ 待機日数は会社ごとの設定（companies.payment_notice_response_days）。
  //       ここに日数をベタ書きしないこと。
  //    合意済み（本人承認・代理承認）は待つ理由が無いので即ロックできる。
  if (!hasAgreement) {
    const daysRes = await getPaymentNoticeResponseDays(tenantId)
    if (daysRes.error !== null) return { data: null, error: daysRes.error }
    const responseDays = daysRes.days

    const lockableAt = lockableAtFrom(existingNotice?.created_at ?? null, responseDays)
    if (lockableAt === null) {
      // 通知書がまだ無い＝子分は一度も見ていない。「未応答」とは言えない
      if (responseDays > 0) {
        return {
          data: null,
          error: '支払通知書がまだ作成されていません。先に「全員分を一括生成」で作成し、'
            + `本人の返事を ${responseDays} 日待ってから確定してください。`
            + '急ぐ場合は口頭確認のうえ「代理承認」を使ってください。',
        }
      }
    } else if (Date.now() < lockableAt.getTime()) {
      const restDays = Math.ceil((lockableAt.getTime() - Date.now()) / (24 * 60 * 60 * 1000))
      return {
        data: null,
        error: `本人の返事を待つ期間中です（あと ${restDays} 日）。`
          + '期間を過ぎると「未応答のまま確定」できます。'
          + '急ぐ場合は口頭確認のうえ「代理承認」を使ってください。',
      }
    }
  }

  const { error: upsertErr } = await (service as any)
    .from('payment_notices')
    .upsert(
      {
        // ⚠️ F0で tenant_id の DEFAULT を撤去したため、明示的に渡さないと NOT NULL 違反になる
        tenant_id:              tenantId,
        contractor_id:          contractorId,
        notice_month:           noticeMonthDate,
        target_month:           noticeMonthDate,
        // ⚠️ status は廃止予定の派生値（正本は approval_status + locked）。読む側は無い。
        //    DEFAULT 追加マイグレーション適用まで互換で書く（billing/actions.ts の生成側と同じ）。
        status:                 'locked',
        subtotal_registered:    a.subtotalRegistered,
        tax_registered:         a.taxRegistered,
        subtotal_unregistered:  a.subtotalUnregistered,
        tax_unregistered:       a.taxUnregistered,
        deduction_unregistered: a.deductionUnregistered,
        subtotal_exempt:        a.subtotalExempt,
        // ⚠️ 内訳列（labor_* / expense_* / deduction_rate）を書かないと、支払通知書PDFの
        //    労務内訳が 0 になり、fetchContractorFiscalTotals の年度累計にも乗らない。
        labor_tax_excluded:     a.laborTaxExcluded,
        labor_tax:              a.laborTax,
        expense_tax_excluded:   a.expenseTaxExcluded,
        expense_tax:            a.expenseTax,
        deduction_rate:         a.deductionRate,
        deduction:              a.deduction,
        adjustment_amount:      a.adjustment,
        total_excluding_tax:    a.totalExcludingTax,
        total_tax:              a.totalTax,
        total_deduction:        a.totalDeduction,
        insurance_deduction:    a.insuranceDeduction,
        total_amount:           a.totalAmount,
        approval_status:        nextApprovalStatus,
        locked:                 true,
        locked_at:              new Date().toISOString(),
      },
      { onConflict: 'contractor_id,notice_month' },
    )

  if (upsertErr) return { data: null, error: upsertErr.message }

  // アンロック後の上書き完了ログ
  if (isLocked && existingNotice) {
    await insertPaymentNoticeAuditLog(service, {
      tenantId,
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
  // ⚠️ dev バイパス（ALLOW_DEV_AUTH_BYPASS=true）でも requireOwner は飛ばさない。
  //    バイパスは「未ログイン時に合成 owner を返す」だけで、ログイン済みの非オーナーは拒否される。
  const __owner = await requireOwner()
  if (!__owner.ok) return { data: null, error: __owner.error }
  // dev バイパスの合成IDは UUID ではないため、approval_history.action_by（UUID型）用に admin@hibiki.com のUUIDへ写す
  const DEV_ADMIN_UUID = '33259c12-e46b-4ebd-a87c-cf50682729c4'
  const userId = __owner.ctx.userId === DEV_BYPASS_USER_ID ? DEV_ADMIN_UUID : __owner.ctx.userId

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

// ── 代理承認（口頭確認による親分の代理承認） ──────────────────
//
// 設計書 §2-3-9 は支払通知書の承認者を「子分（委託先）」と定めている。
// ただし実運用では「電話で口頭確認し、親分が代わりに承認する」ケースが多い。
// これは正当な業務なので、無かったことにせず**別の状態**として記録する。
//
// ⚠️ この操作は本人承認（approval_status='approved'）とは別物。
//    approved を書けるのは子分の承認経路（driver-actions.ts）だけ。ここでは書かない。
// ⚠️ 確認記録（方法・相手・メモ）は必須。無記名の代理承認を作らせないこと。
//    記録が無い代理承認は、揉めたときに証跡として何の役にも立たない。
//    記録先は approval_history（UPDATE/DELETE 禁止の不変ログ）。

// ⚠️ 定数・型は utils/proxy-approval.ts に置く。'use server' ファイルは async 関数しか
//    export できず、配列や型を混ぜると実行時に "found object" で画面が丸ごと落ちる。
export async function proxyApprovePaymentNotice(
  params: ProxyApprovalParams,
): Promise<ActionResult> {
  // ⚠️ dev バイパスでも requireOwner は飛ばさない（finalizeInvoiceAndNotice と同じ理由）
  const __owner = await requireOwner()
  if (!__owner.ok) return { data: null, error: __owner.error }
  const DEV_ADMIN_UUID = '33259c12-e46b-4ebd-a87c-cf50682729c4'
  const userId = __owner.ctx.userId === DEV_BYPASS_USER_ID ? DEV_ADMIN_UUID : __owner.ctx.userId

  // 入力検証: 3項目とも必須。空メモの代理承認は受け付けない
  if (!CONFIRMATION_METHODS.includes(params.confirmationMethod)) {
    return { data: null, error: '確認方法を選んでください' }
  }
  if (!CONFIRMED_PARTIES.includes(params.confirmedParty)) {
    return { data: null, error: '確認した相手を選んでください' }
  }
  const note = params.note?.trim() ?? ''
  if (!note) {
    return { data: null, error: 'いつ・どのように確認したかのメモは必須です' }
  }

  const tenantId = await getCurrentTenantId()
  const service  = createServiceClient()

  // テナント越えの操作を防ぐ。payment_notices 自身が tenant_id を持つのでそれで絞る
  // （以前ここに「payment_notices に tenant_id 列は無い」と誤ったコメントを書いていた。
  //   列は実在する。条件を足す前に必ず information_schema で列を確認すること）
  const { data: notice, error: fetchErr } = await (service as any)
    .from('payment_notices')
    .select('id, contractor_id, approval_status')
    .eq('id', params.noticeId)
    .eq('tenant_id', tenantId)
    .maybeSingle()

  if (fetchErr) return { data: null, error: `支払通知書の取得に失敗しました: ${fetchErr.message}` }
  if (!notice)  return { data: null, error: '対象の支払通知書が見つかりません' }

  // 本人が既にアプリで承認済みなら、格下げになるので拒否する。
  // （no_response からの格上げは認める＝あとから連絡がついたケース）
  if (notice.approval_status === 'approved') {
    return { data: null, error: 'すでに本人が承認済みです。代理承認は不要です' }
  }

  const { error: updateErr } = await (service as any)
    .from('payment_notices')
    .update({
      approval_status: 'approved_by_proxy',
      // ⚠️ status は廃止予定の派生値。UPDATE 経路は DEFAULT が付いても値が変わらないため、
      //    列 DROP（Phase 3）まで同期を続ける（読む側は無い）。
      status:          'locked',
      locked:          true,
      locked_at:       new Date().toISOString(),
    })
    .eq('id', params.noticeId)

  if (updateErr) return { data: null, error: updateErr.message }

  // ⚠️ 証跡が本体。ここが失敗したら throw して気づけるようにする（握り潰さない）
  await insertPaymentNoticeAuditLog(service, {
    tenantId,
    paymentNoticeId:    params.noticeId,
    actionType:         'proxy_approval',
    actionBy:           userId,
    confirmationMethod: params.confirmationMethod,
    confirmedParty:     params.confirmedParty,
    note,
  })

  return { data: undefined, error: null }
}
