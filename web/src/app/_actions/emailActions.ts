'use server'

// NOTE: 通知インフラは原点回帰プランで廃止。このファイルは参照互換のために残しているが実処理なし。

export type AlertType = 'missing_input' | 'pending_notice'

export type SendReminderEmailResult = {
  logId:     string
  messageId: string | null
  mocked:    boolean
}

type ActionResult<T = void> =
  | { data: T; error: null }
  | { data: null; error: string }

/** 廃止済み: メール自動送信は行わない。ドライバーへの連絡は tel:/sms: リンクのみ。 */
export async function sendReminderEmail(
  _contractorId: string,
  _alertType: AlertType,
): Promise<ActionResult<SendReminderEmailResult>> {
  return { data: null, error: 'メール自動送信は廃止されました。tel:/sms: リンクから直接連絡してください。' }
}
