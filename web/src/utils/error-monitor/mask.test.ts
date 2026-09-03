import { describe, it, expect } from 'vitest'
import { mask, MESSAGE_MAX, STACK_MAX } from './mask'

describe('mask', () => {
  it('Postgres の Failing row を丸ごと落とす', () => {
    const s = 'duplicate key\nDETAIL: Failing row contains (a1, みずほ, 1234567, タナカ).\nHINT: x'
    const out = mask(s, 2000)
    expect(out).toContain('DETAIL: [omitted]')
    expect(out).not.toContain('1234567')
    expect(out).toContain('HINT: x')
  })
  it('DETAIL: 行はすべて落とす（Key (...)=(...) 形式も）', () => {
    const out = mask('duplicate key value violates unique constraint\nDETAIL: Key (contractor_name)=(株式会社テスト) already exists.', 2000)
    expect(out).toContain('DETAIL: [omitted]')
    expect(out).not.toContain('株式会社テスト')
  })
  it('括弧を含む行データでも DETAIL 行末まで落とす', () => {
    const out = mask('DETAIL: Failing row contains (1, 株式会社ABC(東京), 1234567).\nHINT: x', 2000)
    expect(out).not.toContain('東京')
    expect(out).not.toContain('1234567')
    expect(out).toContain('HINT: x')
  })
  it('6桁以上の数字列（ハイフン区切り含む）を [digits] にする', () => {
    expect(mask('口座 1234567 支店 001', 2000)).toBe('口座 [digits] 支店 001')
    expect(mask('tel 090-1234-5678', 2000)).toBe('tel [digits]')
    expect(mask('12345', 2000)).toBe('12345')
  })
  it('メールはドメインだけ残す', () => {
    expect(mask('user taro.k@example.co.jp failed', 2000)).toBe('user ***@example.co.jp failed')
  })
  it('JWT と API キーを [token] にする', () => {
    expect(mask('jwt eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxIn0.abc', 2000)).toBe('jwt [token]')
    expect(mask('key re_AbC123xyz', 2000)).toBe('key [token]')
    expect(mask('key sk_live_9zz', 2000)).toBe('key [token]')
    expect(mask('key AIzaSyD-abc', 2000)).toBe('key [token]')
  })
  it('maxLen で切る', () => {
    expect(mask('a'.repeat(50), 10)).toHaveLength(10)
  })
  it('定数', () => {
    expect(MESSAGE_MAX).toBe(2000)
    expect(STACK_MAX).toBe(4000)
  })
})
