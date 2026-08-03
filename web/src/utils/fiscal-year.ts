// ── 自社の事業年度を算出する ────────────────────────────────
//
// 事業年度 = 決算月の翌月1日 〜 決算月末日。
// 例: 決算月 3 なら 4月1日〜翌年3月31日。決算月 12 なら暦年と同じ。
//
// ⚠️ 決算月が未設定（NULL）なら暦年（1月〜12月）として扱う。
//    個人事業者は暦年が正しく、法人でも12月決算なら一致する。
//    ズレるのは12月以外の決算月の法人だけなので、画面に「決算月が未設定のため
//    暦年で集計しています」と出したうえで、集計自体は止めない。
//
// ⚠️ このファイルに 'use server' を付けてはならない（純粋関数を export しているため）。
//
// ⚠️ 日付は必ずローカル日付の文字列で組み立てる。toISOString() は JST で1日ずれる。
//    詳細は utils/closing-period.ts の同じ注意書きを参照。

import { formatLocalDate } from './closing-period'

/** 決算月が未設定のときに使う既定値（暦年＝12月決算とみなす） */
export const DEFAULT_FISCAL_YEAR_END_MONTH = 12

export function normalizeFiscalYearEndMonth(month: number | null | undefined): number {
  if (month == null) return DEFAULT_FISCAL_YEAR_END_MONTH
  if (!Number.isInteger(month) || month < 1 || month > 12) return DEFAULT_FISCAL_YEAR_END_MONTH
  return month
}

/**
 * 対象年月（'YYYY-MM'）が属する事業年度の範囲を返す。
 * 返り値はローカル日付の 'YYYY-MM-DD'（DB の date 列とそのまま比較できる）。
 */
export function fiscalYearRange(
  yearMonth: string,
  fiscalYearEndMonth: number | null | undefined,
): { from: string; to: string } {
  if (!/^\d{4}-\d{2}$/.test(yearMonth)) {
    throw new Error(`yearMonth は 'YYYY-MM' 形式で渡してください: ${yearMonth}`)
  }
  const endMonth = normalizeFiscalYearEndMonth(fiscalYearEndMonth)
  const [y, m]   = yearMonth.split('-').map(Number)

  // 対象月が決算月より後なら、その年の決算月の翌月に始まった年度。
  // 決算月以前なら、前年の決算月の翌月に始まった年度。
  const startYear = m > endMonth ? y : y - 1

  return {
    from: formatLocalDate(new Date(startYear, endMonth, 1)),          // 決算月の翌月1日
    to:   formatLocalDate(new Date(startYear + 1, endMonth, 0)),      // 決算月の末日
  }
}

/** 事業年度の表示名（例: '2026年4月〜2027年3月'） */
export function fiscalYearLabel(
  yearMonth: string,
  fiscalYearEndMonth: number | null | undefined,
): string {
  const { from, to } = fiscalYearRange(yearMonth, fiscalYearEndMonth)
  const [fy, fm] = from.split('-').map(Number)
  const [ty, tm] = to.split('-').map(Number)
  return `${fy}年${fm}月〜${ty}年${tm}月`
}
