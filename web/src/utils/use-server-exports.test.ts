import { describe, it, expect } from 'vitest'
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'

/**
 * `'use server'` ファイルが async 関数以外を export していないことを保証する。
 *
 * 経緯: `'use server'` ファイルは **async 関数しか export できない**。定数（配列など）を
 * 混ぜると `A "use server" file can only export async functions, found object.` が
 * **実行時にだけ**発生し、その Server Action を import している画面が丸ごと落ちる。
 * ⚠️ `tsc --noEmit` も `vitest` も素通りするため、人間の目とこのテストだけが防波堤。
 *
 * 定数・型は `'use server'` を持たない普通のモジュール（utils/ 配下など）へ置き、
 * Server Action 側とクライアント側の両方からそこを import すること。
 * 例: utils/proxy-approval.ts / utils/work-amount.ts / utils/transitional-deduction.ts
 *
 * NOTE: `export type` / `export interface` は型なので実行時に消える＝対象外。
 */
const SRC = join(__dirname, '..')

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

/** 先頭付近に 'use server' ディレクティブがあるか（ファイル冒頭のみ有効） */
function isUseServerFile(code: string): boolean {
  return /^\s*(['"])use server\1/.test(code)
}

/** 許されるのは `export async function` と型だけ。それ以外の export を拾う */
function offendingExports(code: string): string[] {
  const offenders: string[] = []
  const re = /^export\s+(?!async\s+function\b)(?!type\b)(?!interface\b)(.+)$/gm
  for (const m of code.matchAll(re)) {
    offenders.push(m[1].trim().slice(0, 60))
  }
  return offenders
}

describe("'use server' ファイルの export", () => {
  const files = collectSourceFiles(SRC).filter(f => isUseServerFile(readFileSync(f, 'utf8')))

  it("'use server' ファイルを検出できている", () => {
    expect(files.length).toBeGreaterThan(5)
  })

  it('async 関数と型以外を export していない', () => {
    const violations: string[] = []
    for (const f of files) {
      const bad = offendingExports(readFileSync(f, 'utf8'))
      if (bad.length > 0) violations.push(`${relative(SRC, f)}: ${bad.join(' / ')}`)
    }
    expect(violations).toEqual([])
  })
})
