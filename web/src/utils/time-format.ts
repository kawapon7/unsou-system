// ── 時刻表示の共通ヘルパー ────────────────────────────────
//
// ⚠️ work_records.start_time / end_time は timestamptz（完全な ISO タイムスタンプ）。
//    勤務報告書などの帳票は 'HH:MM'（JST）表記を前提にしているため、ここで正規化する。
//    呼び出し側でタイムゾーン変換を個別に実装しないこと。

/**
 * ISO タイムスタンプを 'HH:MM'（既定 Asia/Tokyo）に変換する。
 * null/undefined は null を返す。
 *
 * ⚠️ 一部ランタイムの ja-JP + hour12:false は深夜 0 時台を "24:00" と表記する
 *    （Intl の既定挙動、バグではない）。帳票の 'HH:MM' 表記としては不自然なため
 *    先頭の "24" を "00" に読み替える。
 */
export function toHHMM(iso: string | null | undefined, timeZone = 'Asia/Tokyo'): string | null {
  if (!iso) return null
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) return null

  const formatted = new Intl.DateTimeFormat('ja-JP', {
    hour:   '2-digit',
    minute: '2-digit',
    hour12: false,
    timeZone,
  }).format(date)

  return formatted.startsWith('24') ? `00${formatted.slice(2)}` : formatted
}
