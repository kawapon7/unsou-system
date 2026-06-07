/**
 * インボイス制度準拠の消費税計算ユーティリティ
 * 仕様書 3-5「消費税・インボイス計算ロジック」準拠
 */

export type InvoiceCategory = 'registered' | 'unregistered' | 'exempt'

export interface TaxLineItem {
  amount: number           // 税抜き金額
  invoiceCategory: InvoiceCategory
}

export interface TaxSummary {
  registeredSubtotal: number      // インボイス登録あり：税抜き合計
  registeredTax: number           // インボイス登録あり：消費税額（四捨五入済）
  unregisteredSubtotal: number    // 未登録：税抜き合計
  unregisteredTax: number         // 未登録：消費税額（四捨五入済）
  unregisteredDeduction: number   // 未登録：経過措置による控除不可分差し引き額
  exemptSubtotal: number          // 非課税：税抜き合計
  totalExcludingTax: number       // 税抜き総合計
  totalTax: number                // 消費税総合計
  totalDeduction: number          // 経過措置控除総合計
  totalAmount: number             // 最終支払/請求総額
}

/**
 * 取引日から経過措置の控除不可割合（差し引き率）を自動判定する
 * 仕様書 3-5「インボイス未登録業者への支払い計算」準拠
 */
export function getTransitionalDeductionRate(transactionDate: Date): number {
  const d = transactionDate
  // ～2026年9月30日：差し引き率2%（消費税10% × 控除不可20%）
  if (d <= new Date('2026-09-30')) return 0.02
  // 2026年10月1日～2029年9月30日：差し引き率5%（消費税10% × 控除不可50%）
  if (d <= new Date('2029-09-30')) return 0.05
  // 2029年10月1日～：差し引き率10%（消費税10% × 控除不可100%）
  return 0.10
}

/**
 * インボイス制度準拠の消費税集計
 *
 * 注意：明細ごとに端数処理をするとインボイス制度の合計値と1円単位のズレが発生するため、
 * 必ずカテゴリごとの総額に対して1回のみ四捨五入を行います。
 */
export function calculateTax(items: TaxLineItem[], transactionDate: Date): TaxSummary {
  // ① カテゴリごとに税抜き金額を合計（明細ごとの端数処理は行わない）
  let registeredSubtotal = 0
  let unregisteredSubtotal = 0
  let exemptSubtotal = 0

  for (const item of items) {
    if (item.invoiceCategory === 'registered') {
      registeredSubtotal += item.amount
    } else if (item.invoiceCategory === 'unregistered') {
      unregisteredSubtotal += item.amount
    } else {
      exemptSubtotal += item.amount
    }
  }

  // ③ カテゴリごとの税抜き合計に対して消費税10%を掛け、ここで初めて四捨五入（1回のみ）
  const registeredTax = Math.round(registeredSubtotal * 0.10)
  const unregisteredTax = Math.round(unregisteredSubtotal * 0.10)

  // ④ 未登録（免税事業者）からの仕入：経過措置による控除不可分を差し引き
  const deductionRate = getTransitionalDeductionRate(transactionDate)
  const unregisteredDeduction = Math.round(unregisteredSubtotal * deductionRate)

  const totalExcludingTax = registeredSubtotal + unregisteredSubtotal + exemptSubtotal
  const totalTax = registeredTax + unregisteredTax
  const totalDeduction = unregisteredDeduction
  const totalAmount = totalExcludingTax + totalTax - totalDeduction

  return {
    registeredSubtotal,
    registeredTax,
    unregisteredSubtotal,
    unregisteredTax,
    unregisteredDeduction,
    exemptSubtotal,
    totalExcludingTax,
    totalTax,
    totalDeduction,
    totalAmount,
  }
}
