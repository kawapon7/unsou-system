// インボイス計算ロジック（仕様書 3-5 準拠）
// 純粋関数のみ。Server Actions / API Route 双方から利用可。

/**
 * 消費税計算
 * 合計額に対して一括計算・四捨五入1回（明細行ごとではない）
 */
export function calcInvoiceTax(netTotal: number, taxType: string): number {
  if (taxType === 'exclusive') return Math.round(netTotal * 0.1)
  if (taxType === 'inclusive') return Math.round((netTotal * 0.1) / 1.1)
  return 0 // exempt
}

/**
 * インボイス未登録業者への経過措置控除率（仕様書 3-5）
 * 支払金額から差し引く率を取引日から自動判定
 * - 〜2026-09-30 : 2%（80%控除可能）
 * - 2026-10-01〜2029-09-30 : 5%（50%控除可能）
 * - 2029-10-01〜 : 10%（0%控除可能）
 */
export function getTransitionDeductionRate(targetDate: Date): number {
  if (targetDate < new Date('2026-10-01')) return 0.02
  if (targetDate < new Date('2029-10-01')) return 0.05
  return 0.10
}
