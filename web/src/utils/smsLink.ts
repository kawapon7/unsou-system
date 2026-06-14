/** 電話番号から SMS 用に数字のみ抽出（先頭 + は国番号として保持） */
function normalizePhoneForSms(phone: string): string {
  const trimmed = phone.trim()
  if (trimmed.startsWith('+')) {
    return '+' + trimmed.slice(1).replace(/\D/g, '')
  }
  return trimmed.replace(/\D/g, '')
}

/**
 * iOS / Android 共通の sms: URL スキームを生成する。
 * 本文は RFC 3986 に従い encodeURIComponent でエンコードする。
 */
export function generateSmsLink(phone: string, message: string): string {
  const normalized = normalizePhoneForSms(phone)
  if (!normalized) {
    throw new Error('有効な電話番号が指定されていません')
  }
  const body = encodeURIComponent(message)
  return `sms:${normalized}?body=${body}`
}
