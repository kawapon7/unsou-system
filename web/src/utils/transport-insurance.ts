// 運送保険（荷物保険）の相殺額を決める。
// ⚠️ 委託先ごとに「適用する/しない」がある（作業系の委託先は荷物を運ばないので保険なし）。
//    金額は自社設定（companies.transport_insurance_amount）で一括。
export function decideInsuranceDeduction(input: {
  /** 稼働または立替がその月にあるか。無い月は保険だけ引いてマイナス支給にしない */
  hasActivity: boolean
  /** contractors.apply_transport_insurance */
  applies: boolean
  /** companies.transport_insurance_amount */
  amount: number
}): number {
  if (!input.hasActivity || !input.applies) return 0
  return Math.max(0, input.amount)
}
