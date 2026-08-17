/**
 * ドライバー画面の集計（純関数）。
 *
 * ⚠️ ここに金額の「算出」を書かないこと。金額の正本は
 *    utils/payment-notice-calc.ts の computePaymentNoticeAmounts。
 *    このファイルがやるのは、すでに算出済みの月次の値を年単位で足すことだけ。
 *    独自計算を持たせると、親分の一覧・PDFと数字が食い違う（2026-08-10 の事故と同型）。
 */

/** 支払通知書1ヶ月分（ドライバー画面用に整形したもの） */
export type PaymentHistoryRow = {
  /** 'YYYY-MM-DD'（月初日） */
  noticeMonth:    string
  laborNet:       number
  expenseNet:     number
  totalTax:       number
  /** 経過措置による差し引き */
  deduction:      number
  /** 運送保険の相殺（非課税） */
  insurance:      number
  /** 差引支給額 */
  totalAmount:    number
  approvalStatus: string
}

export type AnnualSummary = {
  year:            number
  laborNetTotal:   number
  expenseNetTotal: number
  taxTotal:        number
  deductionTotal:  number
  insuranceTotal:  number
  paidTotal:       number
  /** 集計対象になった月数（0なら「この年のデータはありません」と出す） */
  monthCount:      number
}

/**
 * 確定申告用の年間サマリー。
 *
 * ⚠️ 年の区切りは暦年（1〜12月）。締め日ベースにしないこと（申告が暦年のため）。
 * ⚠️ 未承認の月も含める。含めないと、ドライバーは自分の年収を過少に見積もる。
 *    画面側で「未承認を含む」旨を添えること。
 */
export function summarizeAnnual(
  year: number,
  rows: readonly PaymentHistoryRow[],
): AnnualSummary {
  const target = rows.filter(r => Number(r.noticeMonth.slice(0, 4)) === year)
  const sum = (pick: (r: PaymentHistoryRow) => number) =>
    target.reduce((s, r) => s + pick(r), 0)

  return {
    year,
    laborNetTotal:   sum(r => r.laborNet),
    expenseNetTotal: sum(r => r.expenseNet),
    taxTotal:        sum(r => r.totalTax),
    deductionTotal:  sum(r => r.deduction),
    insuranceTotal:  sum(r => r.insurance),
    paidTotal:       sum(r => r.totalAmount),
    monthCount:      target.length,
  }
}

/**
 * 年セレクタの選択肢。通知書が存在する年だけを新しい順で返す。
 *
 * ⚠️ 当年を勝手に足さない。データが無い年を選べると「0円」の画面が出て、
 *    ドライバーには不具合と区別がつかない。
 */
export function availableYearsOf(noticeMonths: readonly string[]): number[] {
  const years = new Set(noticeMonths.map(m => Number(m.slice(0, 4))).filter(Number.isFinite))
  return Array.from(years).sort((a, b) => b - a)
}
