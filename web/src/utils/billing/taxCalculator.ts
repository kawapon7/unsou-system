/**
 * インボイス制度準拠の消費税・経過措置計算
 *
 * 端数処理方針:「1請求・税率ごとに1回、四捨五入」
 * 明細行ごとの丸めは行わず、カテゴリ別の合計値に対して一括で Math.round する。
 */

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

const TRANSITIONAL_PHASE_1_END = new Date('2026-09-30T23:59:59')
const TRANSITIONAL_PHASE_2_END = new Date('2029-09-30T23:59:59')

/**
 * 取引日に対応する経過措置差し引き率を返す。
 * isRegistered=true の場合は常に 0。
 *
 * フェーズ1 (〜2026/9/30): 控除不可20% → 差し引き率2%
 * フェーズ2 (〜2029/9/30): 控除不可50% → 差し引き率5%
 * 完全不可  (2029/10/1〜): 控除不可100% → 差し引き率10%
 */
export function getTransitionalDeductionRate(
  isRegistered: boolean,
  targetDate: Date,
): number {
  if (isRegistered) return 0
  if (targetDate <= TRANSITIONAL_PHASE_1_END) return 0.02
  if (targetDate <= TRANSITIONAL_PHASE_2_END) return 0.05
  return 0.10
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
