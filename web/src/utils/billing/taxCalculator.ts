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
  deductionRate: number     // 経過措置差し引き率（0.00〜0.10）
  deductionAmount: number   // 経過措置差し引き額
  finalAmount: number       // 最終支払金額
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
 * インボイス区分ごとの消費税・経過措置を計算する。
 *
 * @param items      明細行リスト（税抜き金額 + 課税フラグ）
 * @param isRegistered  インボイス登録事業者かどうか
 * @param targetDate 取引対象日（経過措置フェーズ判定に使用）
 */
export function calculateInvoiceTax(
  items: TaxItem[],
  isRegistered: boolean,
  targetDate: Date = new Date(),
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

  // 3. 経過措置差し引き額の算出
  const deductionRate = getTransitionalDeductionRate(isRegistered, targetDate)
  let deductionAmount = 0

  if (!isRegistered && taxableSubtotal > 0) {
    const totalWithTax = taxableSubtotal + taxAmount
    deductionAmount = Math.round(totalWithTax * deductionRate)
  }

  const subtotal = taxableSubtotal + nonTaxableSubtotal
  const finalAmount = subtotal + taxAmount - deductionAmount

  return {
    subtotal,
    taxableSubtotal,
    nonTaxableSubtotal,
    taxAmount,
    deductionRate,
    deductionAmount,
    finalAmount,
  }
}
