// インボイス計算ロジック（仕様書 3-5 準拠）
// 純粋関数のみ。Server Actions / API Route 双方から利用可。

import { getDeductionRate } from '@/utils/transitional-deduction'

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
 *
 * @deprecated 率の正本は utils/transitional-deduction.ts。新しい経路ではそちらを直接使う。
 *   ⚠️ この関数は互換のために残している。以前は独自の率表（2%→5%→10%）を持っており、
 *      令和8年度改正で新設された 70%控除（差し引き3%）の区分が欠けていた。
 *      同じ判定が3ファイルに重複して3本とも古いまま放置されていた（2026-08-02に統合）。
 */
export function getTransitionDeductionRate(targetDate: Date): number {
  return getDeductionRate(targetDate)
}
