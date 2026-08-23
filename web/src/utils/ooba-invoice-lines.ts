// ── おおば運送様式の請求書明細を組み立てる補助関数 ──────────────────
//
// ⚠️ このファイルに 'use server' を付けてはならない（純粋関数を export しているため）。

import type { InvoicePdfLine } from '@/app/_actions/pdf-actions'

export type OobaInvoiceRow = {
  no: number
  description: string
  quantityLabel: string
  unitPrice: number
  amount: number
}

/** 西暦年を令和年に変換する。例: 2026 → 8 */
export function toReiwa(year: number): number {
  return year - 2018
}

/**
 * おおば様式の請求書件名を組み立てる。例: '2026-06' → 'R8．6月度 業務委託費'
 */
export function buildOobaSubject(yearMonth: string): string {
  const [y, m] = yearMonth.split('-').map(Number)
  return `R${toReiwa(y)}．${m}月度 業務委託費`
}

// v1 の規則: 案件名に作業系の語を含むか。将来は projects にカテゴリ列を持たせて置き換える
const WORK_TYPE_WORDS = ['作業', 'デバンニング', '荷役']

/** 案件が作業系（デバンニング等）か。おおば様式で「※人員結果は別紙参照」を出す判定に使う */
export function isWorkTypeProject(name: string): boolean {
  return WORK_TYPE_WORDS.some(w => name.includes(w))
}

/**
 * おおば様式の請求書明細: 案件（＋本数）ごとに束ね、数量は「○月度 ○日」。
 * ⚠️ 単価は 金額÷日数 の割り戻し（price_rules を直接見ない）。日によって単価が違う案件は
 *    割り切れない単価になる → その場合は Math.round し、amount は実額を保つ（合計が狂わない）。
 */
export function aggregateOobaInvoiceRows(lines: InvoicePdfLine[], yearMonth: string): OobaInvoiceRow[] {
  const month = Number(yearMonth.split('-')[1])
  const groups = new Map<string, { description: string; dates: Set<string>; amount: number }>()
  for (const l of lines) {
    const suffix = l.pieceCount && l.pieceCount > 0 ? ` ${l.pieceCount}本` : ''
    const description = `${l.projectName}${suffix}`
    const g = groups.get(description) ?? { description, dates: new Set(), amount: 0 }
    g.dates.add(l.workDate)
    g.amount += l.netAmount
    groups.set(description, g)
  }
  return [...groups.values()].map((g, i) => ({
    no: i + 1,
    description: g.description,
    quantityLabel: `${month}月度 ${g.dates.size} 日`,
    unitPrice: g.dates.size > 0 ? Math.round(g.amount / g.dates.size) : 0,
    amount: g.amount,
  }))
}
