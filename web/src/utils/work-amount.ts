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
