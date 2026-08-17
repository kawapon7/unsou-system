// ── work_records から売上/支払金額を計算する共通モジュール ──────────────
//
// ⚠️ work_records は金額列を持たない。
//    `tax_excluded_sales` / `tax_excluded_payment` / `quantity` / `spot_generic_id` は
//    **実DBに存在しない**。存在しない列を select すると PostgREST が 42703 を返し、
//    その機能は画面上で丸ごと停止する（2026-08-02 に請求書確定・請求書PDF・スポット昇格の
//    3経路が同時に停止していたのを実測で確認）。
//
//    金額は price_rules の calculation_type から都度計算する。
//    work_records から金額を出す経路は、必ずこのモジュールの
//    WORK_RECORD_AMOUNT_COLUMNS と calcWorkAmount を使うこと。
//
// ⚠️ このファイルに 'use server' を付けてはならない（純粋関数を export しているため）。

/** work_records から金額計算に必要な列（PostgREST の select 文字列） */
export const WORK_RECORD_AMOUNT_COLUMNS =
  'project_id, piece_count, start_time, end_time, break_minutes'

/** price_rules から金額計算に必要な列（PostgREST の select 文字列） */
export const PRICE_RULE_COLUMNS =
  'project_id, calculation_type, selling_price, buying_price, margin_fixed'

export type PriceRuleRecord = {
  project_id:       string
  calculation_type: string
  selling_price:    number | null
  buying_price:     number | null
  margin_fixed:     number | null
}

export type RawWorkRecord = {
  project_id:    string | null
  piece_count:   number | null
  start_time:    string | null
  end_time:      string | null
  break_minutes: number | null
}

/**
 * 1件の稼働記録から税抜金額を算出する。
 * side='selling' は荷主への売上、'buying' は委託先への支払。
 * 対応する price_rule が無い場合は 0（スポット記録など案件マスタ未紐付けが該当する）。
 */
export function calcWorkAmount(
  r: RawWorkRecord,
  rule: PriceRuleRecord | undefined,
  side: 'selling' | 'buying',
): number {
  if (!rule) return 0
  const price = side === 'selling'
    ? Number(rule.selling_price ?? 0)
    : Number(rule.buying_price  ?? 0)

  switch (rule.calculation_type) {
    case 'piece':
      return (r.piece_count ?? 0) * price
    case 'hourly': {
      if (!r.start_time || !r.end_time) return 0
      const ms    = new Date(r.end_time).getTime() - new Date(r.start_time).getTime()
      const hours = ms / 3_600_000 - (r.break_minutes ?? 0) / 60
      return Math.round(hours * price)
    }
    case 'fixed':
      return price
    case 'hybrid': {
      const pieceBonus = (r.piece_count ?? 0) * Number(rule.margin_fixed ?? 0)
      return price + pieceBonus
    }
    default:
      return 0
  }
}

/**
 * project_id → PriceRuleRecord の索引を作る。
 * price_rules には tenant_id 列が無いため、呼び出し側で projectIds を
 * テナント内の案件に絞ってから渡すこと。
 */
export function buildPriceRuleMap(
  rows: readonly PriceRuleRecord[] | null | undefined,
): Map<string, PriceRuleRecord> {
  return new Map((rows ?? []).map(r => [r.project_id, r]))
}

/** 金額の「根拠」を人が読める式にしたもの */
export type AmountBreakdown = {
  /** 画面にそのまま出す式（例: '380個 × ¥85'）。算出できない場合は理由を入れる */
  formula: string
  amount:  number
}

const yen = (n: number) => `¥${n.toLocaleString('ja-JP')}`

/**
 * calcWorkAmount と同じ計算の根拠を式にして返す（ドライバー画面の内訳表示用）。
 *
 * ⚠️ 金額は必ず calcWorkAmount に委譲する。ここで再計算しないこと。
 *    式と金額が食い違うと、根拠として見せる意味が無くなるどころか不信を招く。
 * ⚠️ 算出できないときは 0 円だけを返さず、必ず理由（単価未設定・時間未入力）を出す。
 *    ドライバーの報酬画面で理由なしの 0 円は「働いたのにタダ」に読める。
 */
export function describeWorkAmount(
  r:    RawWorkRecord,
  rule: PriceRuleRecord | undefined,
  side: 'selling' | 'buying',
): AmountBreakdown {
  const amount = calcWorkAmount(r, rule, side)
  if (!rule) return { formula: '単価未設定', amount }

  const price = side === 'selling'
    ? Number(rule.selling_price ?? 0)
    : Number(rule.buying_price  ?? 0)

  switch (rule.calculation_type) {
    case 'piece':
      return { formula: `${r.piece_count ?? 0}個 × ${yen(price)}`, amount }
    case 'hourly': {
      if (!r.start_time || !r.end_time) return { formula: '時間未入力', amount }
      const ms    = new Date(r.end_time).getTime() - new Date(r.start_time).getTime()
      const hours = ms / 3_600_000 - (r.break_minutes ?? 0) / 60
      const shown = Number.isInteger(hours) ? String(hours) : hours.toFixed(1)
      return { formula: `${shown}時間 × ${yen(price)}`, amount }
    }
    case 'fixed':
      return { formula: `固定 ${yen(price)}`, amount }
    case 'hybrid':
      return {
        formula: `固定 ${yen(price)} + ${r.piece_count ?? 0}個 × ${yen(Number(rule.margin_fixed ?? 0))}`,
        amount,
      }
    default:
      return { formula: '単価未設定', amount }
  }
}
