/**
 * インボイス制度準拠の消費税・経過措置計算
 *
 * 端数処理方針:「1請求・税率ごとに1回、四捨五入」
 * 明細行ごとの丸めは行わず、カテゴリ別の合計値に対して一括で Math.round する。
 */

import { getDeductionRate, calcTransitionalDeduction, type TransitionalPurchase } from '../transitional-deduction'

export interface TaxItem {
  amount: number    // 税抜き金額
  isTaxable: boolean
  /**
   * 課税仕入れを行った日（'YYYY-MM-DD'）。支払側（OUT）の経過措置は**稼働日ごと**に
   * 率が決まるため（消基通 11-3-1）、明細ごとに持てるようにしてある。
   * 省略時は calculatePaymentTax の targetDate を使う。
   */
  date?: string
}

export interface TaxCalculationResult {
  subtotal: number          // 税抜き合計（課税 + 非課税）
  taxableSubtotal: number   // 課税対象の税抜き合計
  nonTaxableSubtotal: number
  taxAmount: number         // 消費税額（四捨五入済み）
  finalAmount: number       // 最終請求金額（税込）
}

export interface PaymentTaxCalculationResult extends TaxCalculationResult {
  deductionRate: number     // 経過措置差し引き率（0.00〜0.10）
  deductionAmount: number   // 経過措置差し引き額
}

// ── 経過措置差し引き率判定 ────────────────────────────────────

/**
 * 取引日に対応する経過措置差し引き率を返す。
 * isRegistered=true の場合は常に 0。
 *
 * @deprecated 率の正本は utils/transitional-deduction.ts。新しい経路ではそちらを直接使う。
 *   ⚠️ この関数は互換のために残している。以前は独自の率表（2%→5%→10%）を持っており、
 *      令和8年度改正で新設された 70%控除（差し引き3%）の区分が欠けていた。
 *      同じ判定が3ファイルに重複して3本とも古いまま放置されていた（2026-08-02に統合）。
 */
export function getTransitionalDeductionRate(
  isRegistered: boolean,
  targetDate: Date,
): number {
  return getDeductionRate(targetDate, isRegistered)
}

// ── メイン計算関数 ────────────────────────────────────────────

/**
 * 売上請求書（IN・自社が売り手）の消費税を計算する。
 *
 * ⚠️ ここで経過措置を差し引いてはいけない。
 *    経過措置は「買い手が、インボイス未登録の売り手から仕入れたとき」に**買い手側**で使う制度。
 *    売上請求書で見るべきは自社の登録状況であって、取引相手（荷主）の登録状況ではない。
 *    自社は適格請求書発行事業者（companies.invoice_reg_number）なので差し引きの余地がなく、
 *    実請求書（ooba/ の実データ）にも差し引き行は存在しない。
 *    2026-08-16 以前は荷主の invoice_registered を見て差し引いており、未登録荷主への請求が
 *    過少になる状態だった（本番の実害は0件＝未登録荷主で確定した実績が無かったため）。
 *    詳細は HANDOVER §5-4 の 2026-07-31「論点B」。
 *    経過措置が要るのは支払側（OUT）だけ。正本は utils/transitional-deduction.ts。
 *
 * @param items 明細行リスト（税抜き金額 + 課税フラグ）
 */
export function calculateInvoiceTax(
  items: TaxItem[],
): TaxCalculationResult {
  // 1. カテゴリ分類と税抜き合計
  let taxableSubtotal = 0
  let nonTaxableSubtotal = 0

  for (const item of items) {
    if (item.isTaxable) {
      taxableSubtotal += item.amount
    } else {
      nonTaxableSubtotal += item.amount
    }
  }

  // 2. 1請求ごとに1回のみ消費税計算・四捨五入
  const taxAmount = Math.round(taxableSubtotal * 0.1)

  const subtotal = taxableSubtotal + nonTaxableSubtotal
  const finalAmount = subtotal + taxAmount

  return {
    subtotal,
    taxableSubtotal,
    nonTaxableSubtotal,
    taxAmount,
    finalAmount,
  }
}

/**
 * 支払請求書（OUT・自社が買い手）の消費税・経過措置を計算する。
 *
 * こちらが制度本来の向き。委託先（売り手）がインボイス未登録なら、自社が控除できない分を
 * 支払から差し引く。差し引きの基準額は税込（実物の支払明細書と一致）。
 * 率の正本は utils/transitional-deduction.ts。ここで率表を書かないこと。
 *
 * ⚠️ 売上請求書には使わない。売上側は calculateInvoiceTax（差し引きなし）。
 *
 * @param items        明細行リスト（税抜き金額 + 課税フラグ）
 * @param isRegistered 委託先がインボイス登録事業者かどうか
 * @param targetDate   取引対象日（経過措置フェーズ判定に使用）
 */
export function calculatePaymentTax(
  items: TaxItem[],
  isRegistered: boolean,
  targetDate: Date = new Date(),
): PaymentTaxCalculationResult {
  const base = calculateInvoiceTax(items)

  // ⚠️ 率の判定と按分は utils/transitional-deduction.ts の calcTransitionalDeduction が唯一の正本。
  //    ここで「代表日1つ × 合計額」で計算してはならない。率が切り替わる 2026-10-01 をまたぐ
  //    締め期間（例 2026-09-21〜10-20）で、支払通知書本体（日別バケット）と食い違うため。
  const fallbackDate = toLocalDateString(targetDate)
  const netByDate = new Map<string, number>()
  for (const item of items) {
    if (!item.isTaxable) continue
    const date = item.date ?? fallbackDate
    netByDate.set(date, (netByDate.get(date) ?? 0) + item.amount)
  }

  const purchases: TransitionalPurchase[] = [...netByDate.entries()].map(([date, net]) => ({
    date,
    taxIncludedAmount: net + Math.round(net * 0.1),
  }))

  const { deduction, breakdown } = calcTransitionalDeduction(purchases, isRegistered)
  const deductionBase = breakdown.reduce((s, b) => s + b.taxIncludedAmount, 0)
  // ⚠️ 率が混在する期間は「単一の正しい％」が存在しない。差し引き額と辻褄が合う実効率を返す
  //    （payment-notice-calc.ts と同じ方針）。率が 1 つの通常月はその率と一致する。
  const deductionRate = deductionBase > 0 ? deduction / deductionBase : 0

  return {
    ...base,
    deductionRate,
    deductionAmount: deduction,
    finalAmount: base.finalAmount - deduction,
  }
}

/** Date を TZ に依存せずローカル日付の 'YYYY-MM-DD' にする */
function toLocalDateString(d: Date): string {
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}
