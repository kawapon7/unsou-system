import { describe, it, expect } from 'vitest'
import { resolveDocumentFormat, listDocumentFormatOptions, DOCUMENT_FORMATS } from './document-formats'

describe('resolveDocumentFormat', () => {
  it('荷主指定が最優先、無ければ会社、無ければ standard', () => {
    expect(resolveDocumentFormat('invoice', { clientKey: null, companyKey: null }).key).toBe('standard')
    expect(resolveDocumentFormat('invoice', { clientKey: 'standard', companyKey: 'nope' }).key).toBe('standard')
  })
  it('未知キーは standard にフォールバック', () => {
    expect(resolveDocumentFormat('invoice', { clientKey: 'unknown' }).key).toBe('standard')
  })
  it('standard は版番号を持つ', () => {
    expect(DOCUMENT_FORMATS.standard.version).toBe(1)
  })
})

describe('listDocumentFormatOptions', () => {
  it('種別に対応する様式だけ返す', () => {
    expect(listDocumentFormatOptions('invoice')).toEqual([
      { key: 'standard', label: '標準様式' },
      { key: 'ooba', label: 'おおば運送様式' },
    ])
    expect(listDocumentFormatOptions('payment_notice')).toEqual([
      { key: 'standard', label: '標準様式' },
      { key: 'ooba', label: 'おおば運送様式' },
    ])
  })
})

describe('ooba 様式', () => {
  it('ooba 様式は請求書・支払通知書の両方に使える', () => {
    expect(resolveDocumentFormat('invoice', { companyKey: 'ooba' }).key).toBe('ooba')
    expect(resolveDocumentFormat('payment_notice', { companyKey: 'ooba' }).key).toBe('ooba')
    expect(listDocumentFormatOptions('invoice').map(o => o.key)).toContain('ooba')
  })
})
