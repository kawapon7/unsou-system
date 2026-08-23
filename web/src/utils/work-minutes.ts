// ── 勤務時間（実働分）の計算・整形 ─────────────────────────────
//
// おおば様式の勤務報告書・作業明細支払書（Task 8）と Excel 出力（Task 10）で共有する。
// ⚠️ 深夜またぎ（例: 22:00〜06:00）は end < start になるため 24*60 を足してから休憩を引く。

/**
 * 'HH:MM' の開始・終了時刻と休憩分から実働分を計算する。
 * 開始・終了のどちらかが null なら null（未記録扱い）。
 * 終了 < 開始 は深夜またぎとみなし 24 時間分を加算する。
 */
export function workMinutesFromHHMM(
  start: string | null,
  end: string | null,
  breakMinutes: number | null,
): number | null {
  if (!start || !end) return null
  const [sh, sm] = start.split(':').map(Number)
  const [eh, em] = end.split(':').map(Number)
  let diff = (eh * 60 + em) - (sh * 60 + sm)
  if (diff < 0) diff += 24 * 60 // 深夜またぎ（例: 22:00〜06:00）
  return Math.max(0, diff - (breakMinutes ?? 0))
}

/** 実働分を 'H:MM' 表記に整形する。null は空文字。 */
export function formatHHMM(min: number | null): string {
  if (min === null) return ''
  return `${Math.floor(min / 60)}:${String(min % 60).padStart(2, '0')}`
}
