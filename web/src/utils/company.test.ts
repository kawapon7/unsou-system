import { describe, it, expect } from 'vitest'
import { lockableAtFrom } from './company'

/**
 * 支払通知書の「未応答のまま確定」できるようになる日時。
 *
 * ⚠️ ここを間違えると、子分が返事をする機会が無いまま「返事がなかった」という
 *    証跡が立つ（合意証跡としての意味が消える）。境界は必ずテストで固定する。
 */
describe('lockableAtFrom', () => {
  const created = '2026-08-02T00:00:00.000Z'

  it('生成日 + 待機日数 を返す', () => {
    const at = lockableAtFrom(created, 7)
    expect(at?.toISOString()).toBe('2026-08-09T00:00:00.000Z')
  })

  it('0 日なら生成日そのもの（＝待たない運用）', () => {
    expect(lockableAtFrom(created, 0)?.toISOString()).toBe(created)
  })

  it('通知書がまだ無いなら null（「未応答」と言えない状態）', () => {
    expect(lockableAtFrom(null, 7)).toBeNull()
  })

  it('日付として壊れている値は null（既定値で通さない）', () => {
    expect(lockableAtFrom('not-a-date', 7)).toBeNull()
  })

  it('月をまたいでも日数で計算する（暦の月末に引きずられない）', () => {
    const at = lockableAtFrom('2026-08-28T09:00:00.000Z', 7)
    expect(at?.toISOString()).toBe('2026-09-04T09:00:00.000Z')
  })
})
