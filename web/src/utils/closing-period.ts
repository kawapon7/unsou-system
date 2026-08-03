// ── 締め日ベースの請求対象期間を算出する共通モジュール ──────────────
//
// 2026-08-02、ボス判断により「請求金額の集計期間は締め日ベースに統一」と確定した。
// 荷主ごとに設定された締め日（clients.closing_day）で期間を区切る。
// 暦月（1日〜末日）で集計してよいのは、締め日が「月末」の荷主だけである。
//
// ⚠️ 同じ closingRange が billing-actions.ts と admin/sales/actions.ts に
//    重複実装されていた。片方だけ直しても直らない構造だったため 1 本に集約した。
//
// ⚠️ このファイルに 'use server' を付けてはならない（純粋関数を export しているため）。
//
// ⚠️ 日付は必ず「ローカル日付の文字列」として扱う。
//    従来 `new Date(y, m, 0).toISOString().slice(0, 10)` としていたが、これは
//    ローカル時刻の 0 時を UTC へ変換するため、JST（+9）の開発機では 1 日前にずれる
//    （2026-07-31 → '2026-07-30'）。本番の Cloudflare Workers は UTC なのでずれない。
//    つまり開発機と本番で集計対象日が食い違う。formatLocalDate で回避する。

/** 締め日が「月末」を意味する表記。DB は text 型で表記ゆれがある */
const LAST_DAY_ALIASES = ['月末', '末日', '99']

/** Date をローカル日付の 'YYYY-MM-DD' にする（toISOString を使わない） */
export function formatLocalDate(d: Date): string {
  const y  = d.getFullYear()
  const mm = String(d.getMonth() + 1).padStart(2, '0')
  const dd = String(d.getDate()).padStart(2, '0')
  return `${y}-${mm}-${dd}`
}

/** 'YYYY-MM-DD' をローカル日付の Date にする（Date.parse の UTC 解釈を避ける） */
export function parseLocalDate(s: string): Date {
  const [y, m, d] = s.split('-').map(Number)
  return new Date(y, m - 1, d)
}

export function isLastDayClosing(closingDay: string | null | undefined): boolean {
  if (closingDay == null) return true
  const t = String(closingDay).trim()
  if (LAST_DAY_ALIASES.includes(t)) return true
  // '20日' のような表記も許容する
  const n = Number(t.replace(/日$/, ''))
  return !Number.isFinite(n) || n <= 0 || n >= 31
}

/** 締め日の日付部分（1〜30）。月末締めの場合は呼ばない */
function closingDayNumber(closingDay: string): number {
  return Number(String(closingDay).trim().replace(/日$/, ''))
}

/**
 * 請求月 yearMonth（'YYYY-MM'）の集計対象期間を締め日ベースで返す。
 *
 * - 月末締め: 当月1日 〜 当月末日
 * - 20日締め: 前月21日 〜 当月20日
 *
 * 返り値はローカル日付の 'YYYY-MM-DD' 文字列（DB の date 列とそのまま比較できる）。
 */
export function closingRange(
  yearMonth: string,
  closingDay: string | null | undefined,
): { from: string; to: string } {
  if (!/^\d{4}-\d{2}$/.test(yearMonth)) {
    throw new Error(`yearMonth は 'YYYY-MM' 形式で渡してください: ${yearMonth}`)
  }
  const [y, m] = yearMonth.split('-').map(Number)

  if (isLastDayClosing(closingDay)) {
    return {
      from: formatLocalDate(new Date(y, m - 1, 1)),
      to:   formatLocalDate(new Date(y, m, 0)),      // 当月末日
    }
  }

  const day = closingDayNumber(closingDay as string)
  return {
    from: formatLocalDate(new Date(y, m - 2, day + 1)),
    to:   formatLocalDate(new Date(y, m - 1, day)),
  }
}

/**
 * 支払期日 = 締め日 + payment_site 日。
 * 期間の終端（締め日）を起点にする。暦月の末日ではない。
 */
export function computeDueDate(
  yearMonth: string,
  closingDay: string | null | undefined,
  paymentSite: number | null | undefined,
): string {
  const { to } = closingRange(yearMonth, closingDay)
  const due = parseLocalDate(to)
  due.setDate(due.getDate() + (paymentSite ?? 0))
  return formatLocalDate(due)
}

/** 稼働日 workDate（'YYYY-MM-DD'）が対象期間に含まれるか */
export function isWithinRange(
  workDate: string,
  range: { from: string; to: string },
): boolean {
  return workDate >= range.from && workDate <= range.to
}
