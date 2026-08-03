import { describe, it, expect } from 'vitest'
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'

/**
 * 実DBの `work_records` に存在しない列名がソースに書かれていないことを機械的に保証する。
 *
 * 経緯: これらの列は初期スキーマの構想に由来するが実DBには一度も作られておらず、
 * 参照した経路は PostgREST の 42703 で丸ごと停止していた（請求書確定・請求書PDF・
 * 支払通知書PDF・AIスキャン保存・スポット昇格の5経路。2026-08-02 に全て修正）。
 * コピペで再発しやすいため、コード側にガードを置く。
 *
 * 金額は `price_rules` から都度計算する（utils/work-amount.ts）。
 * 数量は `piece_count`、備考は `note`。
 */
const PHANTOM_COLUMNS = [
  'tax_excluded_sales',
  'tax_excluded_payment',
  'spot_generic_id',
] as const

const SRC = join(__dirname, '..')

// 生成物と、列名を文字列として持つガード側のテストは対象外
const EXCLUDED = [
  'types/supabase.ts',
  'utils/phantom-columns.test.ts',
  'utils/work-amount.test.ts',
  // ⚠️ ここだけは列ではなく metadata(jsonb) のキー名として同じ文字列を使っている
  //    （`metaNumber(row.metadata, 'tax_excluded_sales')`）。列参照ではないので 42703 にならない。
  //    なお本ファイルは型だけが2コンポーネントから import されている重複ファイルで、整理は別タスク。
  'app/_actions/pdfActions.ts',
]

function collectSourceFiles(dir: string): string[] {
  const out: string[] = []
  for (const entry of readdirSync(dir)) {
    if (entry === 'node_modules' || entry.startsWith('.')) continue
    const full = join(dir, entry)
    if (statSync(full).isDirectory()) out.push(...collectSourceFiles(full))
    else if (/\.tsx?$/.test(full)) out.push(full)
  }
  return out
}

/** コメントは対象外にする（注意喚起のコメントで列名に触れられるようにするため） */
function stripComments(code: string): string {
  return code
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|[^:])\/\/.*$/gm, '$1')
}

describe('work_records の存在しない列', () => {
  const files = collectSourceFiles(SRC).filter(
    f => !EXCLUDED.some(ex => relative(SRC, f).replace(/\\/g, '/') === ex),
  )

  it('走査対象のソースを見つけられている', () => {
    expect(files.length).toBeGreaterThan(20)
  })

  for (const col of PHANTOM_COLUMNS) {
    it(`\`${col}\` がコード中に現れない`, () => {
      const hits = files.filter(f => stripComments(readFileSync(f, 'utf8')).includes(col))
      expect(hits.map(f => relative(SRC, f))).toEqual([])
    })
  }
})
