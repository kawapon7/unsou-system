/**
 * 支払通知書の差引支給額の組み立て（純粋計算）。
 *
 * 実物の支払明細書の構造に合わせてある:
 *   10%対象小計【①】＝ 労務(税抜) + 立替(税抜)
 *   消費税額【②】
 *   相殺額合計【③】＝ 経過措置 + 運送保険（非課税）
 *   差引支給額 ＝ ① + ② − ③ + 調整
 *
 * ⚠️ 金額の組み立てはここ1本に集約する。以前は payment-notice-calc.ts の中に
 *    インラインで書かれており、項目が増えるたびに計算式が枝分かれする状態だった。
 */
export type PaymentTotalsInput = {
  /** 労務報酬（税抜） */
  laborTaxExcluded: number
  /** 労務報酬の消費税 */
  laborTax: number
  /** 立替金（税抜） */
  expenseTaxExcluded: number
  /** 立替金の消費税 */
  expenseTax: number
  /** 経過措置による差し引き額 */
  deduction: number
  /** 税込思考業者の端数補正（calcPayeeAmount）。税込の差分なので消費税計算後に足す */
  adjustment: number
  /**
   * 運送保険料（委託先負担・全社一律）。
   * ⚠️ 非課税項目なので消費税の対象にしない。相殺額合計にだけ積む。
   */
  insuranceDeduction: number
}

export type PaymentTotals = {
  totalExcludingTax: number
  totalTax: number
  /** 相殺額合計【③】＝ 経過措置 + 運送保険 */
  totalDeduction: number
  totalAmount: number
}

export function assemblePaymentTotals(input: PaymentTotalsInput): PaymentTotals {
  const totalExcludingTax = input.laborTaxExcluded + input.expenseTaxExcluded
  const totalTax          = input.laborTax + input.expenseTax
  const totalDeduction    = input.deduction + input.insuranceDeduction

  return {
    totalExcludingTax,
    totalTax,
    totalDeduction,
    totalAmount: totalExcludingTax + totalTax - totalDeduction + input.adjustment,
  }
}
