// ── おおば運送様式の請求書明細を組み立てる補助関数 ──────────────────
//
// ⚠️ このファイルに 'use server' を付けてはならない（純粋関数を export しているため）。
// Task 5 でここに明細の集計関数を追加する。

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
