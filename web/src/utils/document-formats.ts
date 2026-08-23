// 帳票様式レジストリ。おおば運送など導入先様式はここにキーを追加し、
// 描画コンポーネントと Excel マッピングをキーで引く（計画②で追加）。
// ⚠️ 様式の見た目を変えたら version を上げる。発行済み控えは発行時の version を保持し、
//    再表示時にその版で描画する（要件 §5 様式の版管理）。旧版の描画コードは消さない。
export type DocumentKind = 'invoice' | 'payment_notice'

export type DocumentFormat = {
  key: string
  version: number
  label: string
  kinds: DocumentKind[]
}

export const STANDARD_FORMAT_KEY = 'standard'

export const DOCUMENT_FORMATS: Record<string, DocumentFormat> = {
  standard: { key: 'standard', version: 1, label: '標準様式', kinds: ['invoice', 'payment_notice'] },
}

function supports(f: DocumentFormat | undefined, kind: DocumentKind): f is DocumentFormat {
  return !!f && f.kinds.includes(kind)
}

/** 荷主指定 → 会社標準 → standard の順に解決。未知キーは standard。 */
export function resolveDocumentFormat(
  kind: DocumentKind,
  opts: { clientKey?: string | null; companyKey?: string | null },
): DocumentFormat {
  for (const k of [opts.clientKey, opts.companyKey]) {
    if (k && supports(DOCUMENT_FORMATS[k], kind)) return DOCUMENT_FORMATS[k]
  }
  return DOCUMENT_FORMATS[STANDARD_FORMAT_KEY]
}

export function listDocumentFormatOptions(kind: DocumentKind): { key: string; label: string }[] {
  return Object.values(DOCUMENT_FORMATS)
    .filter(f => f.kinds.includes(kind))
    .map(f => ({ key: f.key, label: f.label }))
}
