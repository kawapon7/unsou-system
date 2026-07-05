/** 実行環境のタイムゾーンに関わらず、常に Asia/Tokyo での年月 (YYYY-MM) を返す。 */
export function todayYearMonthJST(now: Date = new Date()): string {
  return now.toLocaleDateString('sv-SE', { timeZone: 'Asia/Tokyo' }).slice(0, 7)
}
