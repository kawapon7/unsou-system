/**
 * 立替金（expense_records）の税内訳の唯一の正本。
 *
 * ⚠️ 支払総額は常に実費（amount_actual）。ここで決めるのは内訳（amount_tax_excluded / tax_category）だけ。
 * ⚠️ tax_category の値は initial_schema の定義どおり 'taxable_10' | 'exempt' を使う。
 *    （旧コードが 'exclusive' を入れていたため、既存行には 'exclusive' が残る。
 *      税額を読む側は tax_category ではなく amount_actual - amount_tax_excluded を使うこと）
 */
export type ExpenseTaxCategory = 'taxable_10' | 'exempt'

export function splitExpenseTax(amountActual: number, taxExempt = false): {
  amountTaxExcluded: number
  taxAmount: number
  taxCategory: ExpenseTaxCategory
} {
  if (taxExempt) return { amountTaxExcluded: amountActual, taxAmount: 0, taxCategory: 'exempt' }
  // 従来の Math.round(実費 / 1.1) と同じ丸め（既存データとの整合を優先）
  const amountTaxExcluded = Math.round(amountActual / 1.1)
  return { amountTaxExcluded, taxAmount: amountActual - amountTaxExcluded, taxCategory: 'taxable_10' }
}
