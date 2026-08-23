import { describe, it, expect } from 'vitest'
import {
  DEFAULT_INVOICE_NUMBER_FORMAT, validateDocumentNumberFormat,
  sequencePeriodKey, formatDocumentNumber,
} from './document-number'

const d = new Date(2026, 7, 23) // 2026-08-23 local

describe('formatDocumentNumber', () => {
  it('既定書式: INV-202608-0007', () => {
    expect(formatDocumentNumber(DEFAULT_INVOICE_NUMBER_FORMAT, { date: d, seq: 7 })).toBe('INV-202608-0007')
  })
  it('FY と YY と CLIENT', () => {
    expect(formatDocumentNumber('{CLIENT}-{FY}-{SEQ:3}', { date: d, seq: 12, fiscalYearEndMonth: 3, clientCode: 'OBA' }))
      .toBe('OBA-2026-012')
    expect(formatDocumentNumber('{YY}{MM}{DD}-{SEQ}', { date: d, seq: 3 })).toBe('260823-3')
  })
  it('決算月を跨ぐと FY が前年になる', () => {
    expect(formatDocumentNumber('{FY}-{SEQ}', { date: new Date(2027, 1, 1), seq: 1, fiscalYearEndMonth: 3 })).toBe('2026-1')
    expect(formatDocumentNumber('{FY}-{SEQ}', { date: new Date(2027, 3, 1), seq: 1, fiscalYearEndMonth: 3 })).toBe('2027-1')
  })
  it('決算月未設定なら FY は暦年', () => {
    expect(formatDocumentNumber('{FY}-{SEQ}', { date: d, seq: 1 })).toBe('2026-1')
  })
  it('CLIENT 未設定は空文字', () => {
    expect(formatDocumentNumber('{CLIENT}{SEQ:2}', { date: d, seq: 5 })).toBe('05')
  })
})

describe('sequencePeriodKey', () => {
  it('月次・年次・事業年度・通し', () => {
    expect(sequencePeriodKey('INV-{YYYY}{MM}-{SEQ:4}', { date: d })).toBe('Y2026M08')
    expect(sequencePeriodKey('{YY}-{SEQ}', { date: d })).toBe('Y2026')
    expect(sequencePeriodKey('{FY}-{SEQ}', { date: d, fiscalYearEndMonth: 3 })).toBe('FY2026')
    expect(sequencePeriodKey('NO-{SEQ}', { date: d })).toBe('ALL')
  })
  it('CLIENT があれば荷主ごとに連番を分ける', () => {
    expect(sequencePeriodKey('{CLIENT}-{YYYY}-{SEQ}', { date: d, clientCode: 'OBA' })).toBe('Y2026:OBA')
  })
})

describe('validateDocumentNumberFormat', () => {
  it('SEQ 必須・未知トークン拒否・空拒否', () => {
    expect(validateDocumentNumberFormat('INV-{YYYY}{MM}-{SEQ:4}')).toBeNull()
    expect(validateDocumentNumberFormat('INV-{YYYY}')).toMatch(/SEQ/)
    expect(validateDocumentNumberFormat('{FOO}-{SEQ}')).toMatch(/FOO/)
    expect(validateDocumentNumberFormat('')).not.toBeNull()
    expect(validateDocumentNumberFormat('{SEQ:0}')).not.toBeNull()
  })
})
