import { describe, it, expect } from 'vitest'
import { invoiceLockError } from './invoice-lock'

describe('invoiceLockError', () => {
  it('請求書がまだ無いときは通す', () => {
    expect(invoiceLockError(null)).toBeNull()
  })

  it('draft は上書きしてよい', () => {
    expect(invoiceLockError({ status: 'draft' })).toBeNull()
  })

  it('issued は止める（2026-07-31 の上書き事故の再発防止）', () => {
    const err = invoiceLockError({ status: 'issued' })
    expect(err).toContain('issued')
    expect(err).toContain('開発者アンロック')
  })

  it('paid は止める', () => {
    expect(invoiceLockError({ status: 'paid' })).toContain('paid')
  })

  it('開発者アンロックと理由が揃っていれば通す', () => {
    expect(
      invoiceLockError({ status: 'issued' }, { isDeveloperUnlock: true, unlockReason: '金額の誤りを修正' }),
    ).toBeNull()
  })

  it('理由なしの開発者アンロックは止める', () => {
    expect(invoiceLockError({ status: 'issued' }, { isDeveloperUnlock: true })).not.toBeNull()
  })

  it('空白だけの理由は理由なしとみなす', () => {
    expect(
      invoiceLockError({ status: 'issued' }, { isDeveloperUnlock: true, unlockReason: '   ' }),
    ).not.toBeNull()
  })

  it('理由だけあってアンロック指定が無ければ止める', () => {
    expect(invoiceLockError({ status: 'issued' }, { unlockReason: '理由' })).not.toBeNull()
  })

  it('status が null の行は通す（判定不能を理由に止めない）', () => {
    expect(invoiceLockError({ status: null })).toBeNull()
  })
})
