// ── おおば運送様式の請求書明細を組み立てる補助関数 ──────────────────
//
// ⚠️ このファイルに 'use server' を付けてはならない（純粋関数を export しているため）。

import type { InvoicePdfLine } from '@/app/_actions/pdf-actions'

export type OobaInvoiceRow = {
  /** ①②… の番号（委託先＝担当者ごと。見本では同じ人が別案件でも同じ番号） */
  no: number
  /** この行が担当者ブロックの先頭か（先頭行にだけ「○月度」と①②を印字する） */
  groupStart: boolean
  /** '6月度' */
  monthLabel: string
  description: string
  /** 稼働日数（数量欄。単位は「日」） */
  days: number
  /** 後方互換: '6月度 2 日'（Excel 旧レイアウト用） */
  quantityLabel: string
  unitPrice: number
  amount: number
  isWorkType: boolean
}

/** 印字用の1行。blank＝空行、note＝「※人員結果は別紙参照」行 */
export type OobaInvoiceDisplayRow =
  | { type: 'line'; row: OobaInvoiceRow }
  | { type: 'blank' }
  | { type: 'note'; text: string }

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

/** 案件が作業系（デバンニング等）か。おおば様式で「※人員結果は別紙参照」を出す判定に使う。
 *  判定材料は projects.category のみ。案件名の文字列は見ない（名前は表示専用）。 */
export function isWorkCategory(category: string | null | undefined): boolean {
  return category === 'work'
}

const MARKS = ['①', '②', '③', '④', '⑤', '⑥', '⑦', '⑧', '⑨', '⑩', '⑪', '⑫', '⑬', '⑭', '⑮']
export function circledNumber(n: number): string { return MARKS[n - 1] ?? String(n) }

/**
 * おおば様式の請求書明細（見本 2026-06 エス.アール.シー宛を正とする）:
 *   担当者（委託先）ごとに ①②… を振り、担当者 × 案件（＋本数）で束ねる。数量は稼働日数。
 *   並びは「作業系（デバンニング等）の案件 → それ以外」、各ブロック内は担当者順。
 * ⚠️ 担当者の対応は見本の①②が同一人物を指すという読み（実物で要確認）。contractorName が無い行は
 *    担当者なしの1グループに束ねる（旧データ・スナップショット互換）。
 * ⚠️ 単価は 金額÷日数 の割り戻し（price_rules を直接見ない）。日によって単価が違う案件は
 *    割り切れない単価になる → その場合は Math.round し、amount は実額を保つ（合計が狂わない）。
 */
export function aggregateOobaInvoiceRows(lines: InvoicePdfLine[], yearMonth: string): OobaInvoiceRow[] {
  const month = Number(yearMonth.split('-')[1])
  const monthLabel = `${month}月度`
  const contractorOrder: string[] = []
  const groups = new Map<string, { contractor: string; description: string; dates: Set<string>; amount: number; isWorkType: boolean }>()
  for (const l of lines) {
    const contractor = l.contractorName ?? ''
    if (!contractorOrder.includes(contractor)) contractorOrder.push(contractor)
    const suffix = l.pieceCount && l.pieceCount > 0 ? ` ${l.pieceCount}本` : ''
    const description = `${l.projectName}${suffix}`
    const key = `${contractor}\u0000${description}`
    const g = groups.get(key) ?? { contractor, description, dates: new Set(), amount: 0, isWorkType: l.isWorkType }
    g.dates.add(l.workDate)
    g.amount += l.netAmount
    groups.set(key, g)
  }
  const all = [...groups.values()]
  const ordered = [
    ...all.filter(g => g.isWorkType),
    ...all.filter(g => !g.isWorkType),
  ].sort((a, b) => {
    if (a.isWorkType !== b.isWorkType) return a.isWorkType ? -1 : 1
    return contractorOrder.indexOf(a.contractor) - contractorOrder.indexOf(b.contractor)
  })
  let prevBlock = ''
  return ordered.map(g => {
    const block = `${g.isWorkType}\u0000${g.contractor}`
    const groupStart = block !== prevBlock
    prevBlock = block
    const days = g.dates.size
    return {
      no: contractorOrder.indexOf(g.contractor) + 1,
      groupStart,
      monthLabel,
      description: g.description,
      days,
      quantityLabel: `${monthLabel} ${days} 日`,
      unitPrice: days > 0 ? Math.round(g.amount / days) : 0,
      amount: g.amount,
      isWorkType: g.isWorkType,
    }
  })
}

/**
 * 見本どおりの印字順に並べる: 作業系ブロックは担当者ごとに空行で区切り、末尾に
 * 「※人員結果は別紙参照」を空行で挟んで置く。非作業系は詰めて並べる。最低 minRows 行。
 */
export function layoutOobaInvoiceRows(rows: OobaInvoiceRow[], minRows = 17): OobaInvoiceDisplayRow[] {
  const out: OobaInvoiceDisplayRow[] = []
  const work = rows.filter(r => r.isWorkType)
  const other = rows.filter(r => !r.isWorkType)
  work.forEach((r, i) => {
    if (i > 0 && r.groupStart) out.push({ type: 'blank' })
    out.push({ type: 'line', row: r })
  })
  if (work.length > 0) {
    out.push({ type: 'blank' }, { type: 'note', text: '※人員結果は別紙参照' }, { type: 'blank' })
  }
  other.forEach(r => out.push({ type: 'line', row: r }))
  while (out.length < minRows) out.push({ type: 'blank' })
  return out
}
