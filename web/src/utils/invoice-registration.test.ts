import { describe, it, expect } from 'vitest'
import {
  normalizeInvoiceRegistration,
  isQualifiedInvoiceIssuer,
  invoiceRegistrationLabel,
} from './invoice-registration'

describe('normalizeInvoiceRegistration', () => {
  // ⚠️ 本番 contractors に実在する5通り。ここが崩れると支払額が狂う
  it('本番に実在する表記ゆれをすべて正しく分類する', () => {
    expect(normalizeInvoiceRegistration('registered')).toBe('registered')
    expect(normalizeInvoiceRegistration('適格')).toBe('registered')
    expect(normalizeInvoiceRegistration('unregistered')).toBe('unregistered')
    expect(normalizeInvoiceRegistration('exempt')).toBe('exempt')
    expect(normalizeInvoiceRegistration('免税')).toBe('exempt')
  })

  it('前後の空白を無視する', () => {
    expect(normalizeInvoiceRegistration(' 適格 ')).toBe('registered')
  })

  it('null / 空文字 / 未知の値は unregistered に倒す（控除する側）', () => {
    expect(normalizeInvoiceRegistration(null)).toBe('unregistered')
    expect(normalizeInvoiceRegistration(undefined)).toBe('unregistered')
    expect(normalizeInvoiceRegistration('')).toBe('unregistered')
    expect(normalizeInvoiceRegistration('なんらかの新しい値')).toBe('unregistered')
  })
})

describe('isQualifiedInvoiceIssuer', () => {
  it('registered と 適格 の両方を登録済とみなす（分裂していた判定の統一点）', () => {
    expect(isQualifiedInvoiceIssuer('registered')).toBe(true)
    expect(isQualifiedInvoiceIssuer('適格')).toBe(true)
  })

  it('免税・未登録は登録済ではない（＝経過措置の控除対象）', () => {
    for (const v of ['exempt', '免税', 'unregistered', '', null]) {
      expect(isQualifiedInvoiceIssuer(v)).toBe(false)
    }
  })
})

describe('invoiceRegistrationLabel', () => {
  it('生値をそのまま返さない', () => {
    expect(invoiceRegistrationLabel('exempt')).toBe('免税事業者（経過措置）')
    expect(invoiceRegistrationLabel('適格')).toBe('インボイス登録済')
    expect(invoiceRegistrationLabel('謎の値')).toBe('未登録（経過措置）')
  })
})
