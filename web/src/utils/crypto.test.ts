import { describe, it, expect } from 'vitest'
import {
  encryptText,
  decryptText,
  isEncryptedValue,
  decryptBankFieldValue,
  encryptBankFields,
  decryptBankFields,
} from './crypto'

describe('encryptText / decryptText round trip', () => {
  it('decrypts back to the original plaintext', () => {
    const original = 'みずほ銀行 渋谷支店 1234567 タナカ タロウ'
    const encrypted = encryptText(original)
    expect(encrypted).not.toBe(original)
    expect(decryptText(encrypted)).toBe(original)
  })

  it('produces a different ciphertext each time (random IV)', () => {
    const a = encryptText('1234567')
    const b = encryptText('1234567')
    expect(a).not.toBe(b)
  })
})

describe('isEncryptedValue', () => {
  it('recognizes the iv:tag:cipher hex format', () => {
    expect(isEncryptedValue(encryptText('1234567'))).toBe(true)
  })

  it('rejects plain bank account values', () => {
    expect(isEncryptedValue('1234567')).toBe(false)
    expect(isEncryptedValue('みずほ銀行')).toBe(false)
  })
})

describe('decryptBankFieldValue', () => {
  it('decrypts an encrypted value', () => {
    expect(decryptBankFieldValue(encryptText('1234567'))).toBe('1234567')
  })

  it('passes through a legacy plaintext value unchanged', () => {
    expect(decryptBankFieldValue('1234567')).toBe('1234567')
  })

  it('returns empty string for null/undefined', () => {
    expect(decryptBankFieldValue(null)).toBe('')
    expect(decryptBankFieldValue(undefined)).toBe('')
  })
})

describe('encryptBankFields', () => {
  it('encrypts only the four bank fields, leaves others untouched', () => {
    const payload = {
      name: 'テスト商事',
      bank_name: 'みずほ銀行',
      bank_branch: '渋谷支店',
      account_type: '普通',
      account_number: '1234567',
      account_holder: 'テストショウジ',
    }
    const result = encryptBankFields(payload)
    expect(result.name).toBe('テスト商事')
    expect(result.account_type).toBe('普通')
    expect(isEncryptedValue(result.bank_name)).toBe(true)
    expect(isEncryptedValue(result.bank_branch)).toBe(true)
    expect(isEncryptedValue(result.account_number)).toBe(true)
    expect(isEncryptedValue(result.account_holder)).toBe(true)
  })

  it('leaves null/empty bank fields as-is', () => {
    const result = encryptBankFields({ bank_name: null, account_number: '' })
    expect(result.bank_name).toBe(null)
    expect(result.account_number).toBe('')
  })

  it('does not double-encrypt an already-encrypted value', () => {
    const already = encryptText('1234567')
    const result = encryptBankFields({ account_number: already })
    expect(result.account_number).toBe(already)
  })
})

describe('decryptBankFields', () => {
  it('decrypts the four bank fields back to plaintext', () => {
    const encrypted = encryptBankFields({
      bank_name: 'みずほ銀行',
      bank_branch: '渋谷支店',
      account_number: '1234567',
      account_holder: 'テストショウジ',
    })
    const result = decryptBankFields(encrypted)
    expect(result.bank_name).toBe('みずほ銀行')
    expect(result.bank_branch).toBe('渋谷支店')
    expect(result.account_number).toBe('1234567')
    expect(result.account_holder).toBe('テストショウジ')
  })

  it('passes through legacy plaintext values unchanged', () => {
    const result = decryptBankFields({ account_number: '1234567' })
    expect(result.account_number).toBe('1234567')
  })
})
