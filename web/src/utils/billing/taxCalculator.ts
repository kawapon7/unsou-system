/**
 * インボイス制度準拠の消費税・経過措置計算
 *
 * 端数処理方針:「1請求・税率ごとに1回、四捨五入」
 * 明細行ごとの丸めは行わず、カテゴリ別の合計値に対して一括で Math.round する。
 */

import { getDeductionRate } from '../transitional-deduction'

export interface TaxItem {
  amount: number    // 税抜き金額
  isTaxable: boolean
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

  const deductionRate = getDeductionRate(targetDate, isRegistered)
  const deductionAmount =
    !isRegistered && base.taxableSubtotal > 0
      ? Math.round((base.taxableSubtotal + base.taxAmount) * deductionRate)
      : 0

  return {
    ...base,
    deductionRate,
    deductionAmount,
    finalAmount: base.finalAmount - deductionAmount,
  }
}
