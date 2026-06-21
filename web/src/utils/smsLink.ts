/** 電話番号から SMS 用に数字のみ抽出（先頭 + は国番号として保持） */
function normalizePhoneForSms(phone: string): string {
  const trimmed = phone.trim()
  if (trimmed.startsWith('+')) {
    return '+' + trimmed.slice(1).replace(/\D/g, '')
  }
  const digits = trimmed.replace(/\D/g, '')
  // 国内形式 090... → +8190... に正規化（11桁・先頭0）
  if (digits.startsWith('0') && digits.length >= 10) {
    return '+81' + digits.slice(1)
  }
  return digits
}

/**
 * iOS / Android 共通の sms: URL スキームを生成する。
 * - Android / 一般的な環境: sms:+81...?body=...
 * - iOS Safari: sms:+81...&body=... （? ではなく & を使用）
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

/**
 * ディフェンシブ・アラートの「SMS催促」ボタン用 URL 生成。
 * iOS / Android の sms: スキーム差異を吸収する。
 */
export function generateSmsUrgentLink(phone: string, message: string): string {
  const normalized = normalizePhoneForSms(phone)
  if (!normalized) {
    throw new Error('有効な電話番号が指定されていません')
  }
  const body = encodeURIComponent(message)
  const isIOS = typeof navigator !== 'undefined'
    && /iPhone|iPad|iPod/i.test(navigator.userAgent)
  const separator = isIOS ? '&' : '?'
  return `sms:${normalized}${separator}body=${body}`
}

/** 5大ディフェンシブ・アラート種別ごとの SMS 定型文 */
export const DEFENSIVE_SMS_MESSAGES: Record<string, string> = {
  missing_input:   '稼働実績の入力がまだ確認できておりません。HIBIKIアプリからご入力をお願いします。',
  pending_notice:  '支払通知書の承認が48時間以上確認できておりません。HIBIKIアプリからご確認・承認をお願いします。',
  threshold:       '稼働実績に確認が必要な項目があります。HIBIKIアプリからご確認をお願いします。',
  duplicate:       '実績データに重複の可能性があります。HIBIKIアプリからご確認をお願いします。',
  invoice_warning: 'インボイス登録番号の確認が必要です。HIBIKIアプリまたは管理者へご連絡ください。',
}

const SMS_MESSAGES = DEFENSIVE_SMS_MESSAGES

/**
 * alertType に応じた定型文で sms: URL を生成する。
 */
export function getSmsReminderUrl(
  phone: string,
  alertType: 'missing_input' | 'pending_notice' | 'threshold' | 'duplicate' | 'invoice_warning',
): string {
  const message = SMS_MESSAGES[alertType] ?? ''
  return generateSmsUrgentLink(phone, message)
}

/**
 * 任意の alertType キーで SMS 催促 URL を生成する（拡張用）。
 */
export function getDefensiveSmsLink(phone: string, alertType: string, customMessage?: string): string {
  const message = customMessage ?? DEFENSIVE_SMS_MESSAGES[alertType] ?? ''
  return generateSmsUrgentLink(phone, message)
}
