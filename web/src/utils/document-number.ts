// 請求書・支払通知書番号の採番書式。
// ⚠️ 'use server' を付けない（非 async export があるため）。DB に触れない純粋関数。
// 書式例: 'INV-{YYYY}{MM}-{SEQ:4}' → INV-202608-0007
// トークン: {YYYY} {YY} {MM} {DD} {FY}(事業年度) {CLIENT}(荷主コード) {SEQ} {SEQ:n}(n桁ゼロ埋め)
// 連番のリセット単位は sequencePeriodKey() が書式中のトークンから決める。

export const DEFAULT_INVOICE_NUMBER_FORMAT = 'INV-{YYYY}{MM}-{SEQ:4}'
// ⚠️ 支払通知書は請求書と同じ issued_documents に入り、番号は UNIQUE(tenant_id, document_number)。
// 会社設定の「請求書番号の書式」を共用すると INV-…-0001 が両種別で衝突するため、支払通知書は固定書式で採番する（書式の設定化は計画③）。
export const DEFAULT_PAYMENT_NOTICE_NUMBER_FORMAT = 'PN-{YYYY}{MM}-{SEQ:4}'

export type NumberContext = {
  date: Date
  /** 決算月 1〜12。未設定（または12）なら FY は暦年 */
  fiscalYearEndMonth?: number | null
  clientCode?: string | null
}

const TOKEN_RE = /\{(YYYY|YY|MM|DD|FY|CLIENT|SEQ)(?::(\d+))?\}/g
const KNOWN = new Set(['YYYY', 'YY', 'MM', 'DD', 'FY', 'CLIENT', 'SEQ'])

/** 事業年度（開始年）。決算月 3 → 2026-04〜2027-03 が FY2026 */
export function fiscalYearOf(date: Date, fiscalYearEndMonth?: number | null): number {
  const y = date.getFullYear()
  const m = date.getMonth() + 1
  if (!fiscalYearEndMonth || fiscalYearEndMonth < 1 || fiscalYearEndMonth >= 12) return y
  return m <= fiscalYearEndMonth ? y - 1 : y
}

export function validateDocumentNumberFormat(format: string): string | null {
  if (!format.trim()) return '採番書式が空です'
  let hasSeq = false
  for (const m of format.matchAll(/\{([^}]*)\}/g)) {
    const body = m[1]
    const [name, width] = body.split(':')
    if (!KNOWN.has(name)) return `未知のトークン {${body}} があります`
    if (name === 'SEQ') {
      hasSeq = true
      if (width !== undefined && !(/^\d+$/.test(width) && Number(width) >= 1)) {
        return '{SEQ:n} の n は 1 以上の整数にしてください'
      }
    } else if (width !== undefined) {
      return `{${name}} に桁指定は使えません`
    }
  }
  if (!hasSeq) return '採番書式には {SEQ} または {SEQ:n} が必要です'
  return null
}

/** 連番カウンタのキー（document_sequences.period_key） */
export function sequencePeriodKey(format: string, ctx: NumberContext): string {
  const hasFY = format.includes('{FY}')
  const hasYear = /\{YYYY\}|\{YY\}/.test(format)
  const hasMonth = format.includes('{MM}')
  const y = ctx.date.getFullYear()
  const mm = String(ctx.date.getMonth() + 1).padStart(2, '0')
  let key: string
  if (hasFY) key = `FY${fiscalYearOf(ctx.date, ctx.fiscalYearEndMonth)}`
  else if (hasYear && hasMonth) key = `Y${y}M${mm}`
  else if (hasYear) key = `Y${y}`
  else key = 'ALL'
  if (format.includes('{CLIENT}') && ctx.clientCode) key += `:${ctx.clientCode}`
  return key
}

export function formatDocumentNumber(format: string, ctx: NumberContext & { seq: number }): string {
  const y = ctx.date.getFullYear()
  return format.replace(TOKEN_RE, (_all, name: string, width?: string) => {
    switch (name) {
      case 'SEQ':    return String(ctx.seq).padStart(width ? Number(width) : 0, '0')
      case 'YYYY':   return String(y)
      case 'YY':     return String(y).slice(-2)
      case 'MM':     return String(ctx.date.getMonth() + 1).padStart(2, '0')
      case 'DD':     return String(ctx.date.getDate()).padStart(2, '0')
      case 'FY':     return String(fiscalYearOf(ctx.date, ctx.fiscalYearEndMonth))
      case 'CLIENT': return ctx.clientCode ?? ''
      default:       return ''
    }
  })
}
