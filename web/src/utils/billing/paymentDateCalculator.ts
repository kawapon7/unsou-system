/**
 * 入金予定日・出金予定日の自動計算
 *
 * 例: 締め日20日・支払月翌月・支払日末日 で 7/21 稼働
 *   → 7/21 > 7/20（締め超過）→ 8月締め → 翌月 = 9月 → 月末 = 9/30
 */

export interface BillingSettings {
  closingDay: number | 'last'     // 締め日（1-28 or 'last'）
  paymentMonthOffset: number      // 支払月オフセット（0=当月, 1=翌月, 2=翌々月, 3=3ヶ月後）
  paymentDay: number | 'last'     // 支払日（1-28 or 'last'）
}

/** DB の TEXT カラム値（"20" | "月末"）を BillingSettings の型に変換 */
export function parseClosingDay(value: string): number | 'last' {
  if (value === '月末') return 'last'
  const n = parseInt(value, 10)
  return isNaN(n) ? 'last' : n
}

export function parsePaymentDay(value: string): number | 'last' {
  return parseClosingDay(value)
}

/**
 * 取引日（稼働日・請求日）から入金予定日 / 出金予定日を計算する。
 *
 * @param transactionDate 取引日（YYYY-MM-DD）
 * @param settings        締め日・支払月オフセット・支払日
 * @returns               予定日（Date）
 */
export function calcPaymentDueDate(
  transactionDate: string,
  settings: BillingSettings,
): Date {
  const txDate = new Date(transactionDate)
  const txYear  = txDate.getFullYear()
  const txMonth = txDate.getMonth()  // 0-indexed
  const txDay   = txDate.getDate()

  // ── ① 締め日を超えているか判定 ─────────────────────────
  const closingDayNum =
    settings.closingDay === 'last'
      ? new Date(txYear, txMonth + 1, 0).getDate()
      : settings.closingDay

  // 取引日 ≤ 締め日 → 今月の締め。取引日 > 締め日 → 翌月の締め。
  let billedYear  = txYear
  let billedMonth = txMonth   // 0-indexed（締めが属する月）
  if (txDay > closingDayNum) {
    // 翌月締めに繰り越し
    const next = new Date(txYear, txMonth + 1, 1)
    billedYear  = next.getFullYear()
    billedMonth = next.getMonth()
  }

  // ── ② 支払月を決定 ────────────────────────────────────
  const payMonth = new Date(billedYear, billedMonth + settings.paymentMonthOffset, 1)

  // ── ③ 支払日を決定 ────────────────────────────────────
  if (settings.paymentDay === 'last') {
    // 月末（nextの1日 - 1日）
    return new Date(payMonth.getFullYear(), payMonth.getMonth() + 1, 0)
  }

  const lastDayOfPayMonth = new Date(payMonth.getFullYear(), payMonth.getMonth() + 1, 0).getDate()
  const payDay = Math.min(settings.paymentDay, lastDayOfPayMonth)
  return new Date(payMonth.getFullYear(), payMonth.getMonth(), payDay)
}

/** Date を 'YYYY-MM-DD' 文字列に変換 */
export function formatDateISO(date: Date): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`
}
