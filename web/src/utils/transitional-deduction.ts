// ── インボイス制度「免税事業者等からの仕入れに係る経過措置」の唯一の正本 ──────────
//
// ⚠️ この率を持つ実装は、以前は 3 ファイルに重複しており 3 本とも古かった。
//    1 箇所直しても直らない構造だったため、ここへ集約した（2026-08-02）。
//    以下の 3 つは互換のために残してあるが、中身はすべてこのモジュールに委譲している。
//      - utils/tax.ts               getTransitionalDeductionRate(date)
//      - utils/billing/taxCalculator.ts  getTransitionalDeductionRate(isRegistered, date)
//      - lib/invoice.ts             getTransitionDeductionRate(date)
//    ⚠️ 新しい経路でこれらを増やさないこと。率が要るならこのモジュールを直接使う。
//
// ⚠️ このファイルに 'use server' を付けてはならない（純粋関数を export しているため）。
//
// 制度の内容（令和8年度税制改正で「7・5・3割控除」へ改訂・適用期限が2年延長された）:
//
// | 期間                        | 控除できる割合 | 差し引き率 |
// |----------------------------|--------------|----------|
// | 2023-10-01 〜 2026-09-30    | 80%          | 2%       |
// | 2026-10-01 〜 2028-09-30    | 70%          | 3%       |
// | 2028-10-01 〜 2030-09-30    | 50%          | 5%       |
// | 2030-10-01 〜 2031-09-30    | 30%          | 7%       |
// | 2031-10-01 〜               | 0%（終了）    | 10%      |
//
// ⚠️ 改訂前の実装は `2% → 5% → 10%` で、**70%（差し引き3%）の区分が存在しなかった**。
//    2026年10月1日から計算が狂う状態だった。
//
// ⚠️ 未実装の上限条件がある: 一の免税事業者等からの経過措置対象仕入れの合計（税込）が
//    その年・事業年度で 1億円（令和8年10月1日以後開始の課税期間。改正前は10億円）を
//    超える部分は経過措置の対象外。現状は年間累計を持っていないため判定できない。
//    1社あたり年間1億円に達する規模になったら実装が必要。
//
// 出典: 国税庁 インボイスQ&A 問113 ／ 令和8年度税制改正特集
//   https://www.nta.go.jp/taxes/shiraberu/zeimokubetsu/shohi/keigenzeiritsu/invoice-review/index.htm

/** 消費税率。経過措置の差し引き率は「消費税率 × 控除できない割合」で決まる */
const CONSUMPTION_TAX_RATE = 0.10

/**
 * 各区分の開始日（この日から適用）と、仕入税額控除できる割合。
 * 新しい区分が増えたらここへ 1 行足す。ロジックは変えなくてよい。
 */
export const TRANSITIONAL_SCHEDULE: readonly { from: string; creditableRatio: number }[] = [
  { from: '2023-10-01', creditableRatio: 0.8 },
  { from: '2026-10-01', creditableRatio: 0.7 },
  { from: '2028-10-01', creditableRatio: 0.5 },
  { from: '2030-10-01', creditableRatio: 0.3 },
  { from: '2031-10-01', creditableRatio: 0.0 },
] as const

/** 制度開始前（2023-10-01 より前）は全額控除できたため、差し引きは発生しない */
const BEFORE_SCHEME_CREDITABLE_RATIO = 1.0

/**
 * Date をローカル日付の 'YYYY-MM-DD' にする。
 * ⚠️ toISOString を使わない。JST では UTC 変換で 1 日前にずれ、
 *    10月1日の区分切り替わりを 1 日間違える。
 */
function toLocalDateString(d: Date): string {
  const y  = d.getFullYear()
  const mm = String(d.getMonth() + 1).padStart(2, '0')
  const dd = String(d.getDate()).padStart(2, '0')
  return `${y}-${mm}-${dd}`
}

/** 取引日に適用される「仕入税額控除できる割合」を返す */
export function getCreditableRatio(transactionDate: Date): number {
  const key = toLocalDateString(transactionDate)
  let ratio = BEFORE_SCHEME_CREDITABLE_RATIO
  for (const phase of TRANSITIONAL_SCHEDULE) {
    if (key >= phase.from) ratio = phase.creditableRatio
  }
  return ratio
}

/** 'YYYY-MM-DD' をローカル日付の Date にする（Date.parse の UTC 解釈を避ける） */
function parseLocalDate(s: string): Date {
  const [y, m, d] = s.split('-').map(Number)
  return new Date(y, m - 1, d)
}

/** 経過措置の対象となる 1 件の課税仕入れ（税込） */
export type TransitionalPurchase = {
  /** 課税仕入れを行った日（'YYYY-MM-DD'）。稼働日・支出日であって、支払日ではない */
  date: string
  /** その課税仕入れの税込金額 */
  taxIncludedAmount: number
}

export type TransitionalDeductionBreakdown = {
  rate: number
  taxIncludedAmount: number
  deduction: number
}

/**
 * 経過措置による差し引き額を、**課税仕入れを行った日ごとの率**で算出する。
 *
 * ⚠️ 率は「対象月」ではなく「課税仕入れを行った日」で決まる。
 *    消費税法基本通達 11-3-1: 課税仕入れを行った日とは、資産の譲受け・借受けをした日
 *    又は**役務の提供を受けた日**をいう。**支払日でも請求日でもない。**
 *    運送役務なら実際に走った日（work_records.work_date）、立替金なら expense_date。
 *
 * ⚠️ 締め日ベースの期間は月をまたぐため、1 枚の支払通知書に複数の率が混在しうる。
 *    最初に該当するのは 2026-09-21 〜 2026-10-20 の締め期間（20日締め）で、
 *    9月分が 2%、10月分が 3% になる。月単位で 1 つの率を決めると必ず間違える。
 *
 * ⚠️ 端数処理は率のグループごとに 1 回。グループの税込小計を足した額は、
 *    請求書本体の「税抜合計＋四捨五入した消費税額」と数円ずれうる。
 *    **この関数の結果は差し引き額の算出にのみ使い、本体金額の計算に使わないこと。**
 */
export function calcTransitionalDeduction(
  items: readonly TransitionalPurchase[],
  isRegistered = false,
): { deduction: number; breakdown: TransitionalDeductionBreakdown[] } {
  if (isRegistered) return { deduction: 0, breakdown: [] }

  const byRate = new Map<number, number>()
  for (const item of items) {
    const rate = getDeductionRate(parseLocalDate(item.date))
    byRate.set(rate, (byRate.get(rate) ?? 0) + item.taxIncludedAmount)
  }

  const breakdown = [...byRate.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([rate, taxIncludedAmount]) => ({
      rate,
      taxIncludedAmount,
      deduction: Math.round(taxIncludedAmount * rate),
    }))

  return {
    deduction: breakdown.reduce((s, b) => s + b.deduction, 0),
    breakdown,
  }
}

/**
 * 取引日に適用される「支払額からの差し引き率」を返す。
 * 差し引き率 = 消費税率 × 控除できない割合。
 *
 * @param transactionDate 取引日（対象期間の締め日など）
 * @param isRegistered    相手が適格請求書発行事業者なら true → 常に 0
 */
export function getDeductionRate(
  transactionDate: Date,
  isRegistered = false,
): number {
  if (isRegistered) return 0
  const notCreditable = 1 - getCreditableRatio(transactionDate)
  // ⚠️ 0.1 * 0.7 のような積は浮動小数の誤差を持つ（0.030000000000000002）。
  //    率そのものを丸めておかないと、表示にも計算にも滲む。
  return Math.round(CONSUMPTION_TAX_RATE * notCreditable * 10000) / 10000
}
